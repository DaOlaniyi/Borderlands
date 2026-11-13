import { CARGO, GOLD, HARVEST, MEAT, PAWN, SETTLE, TILE, TOWER } from './config'
import { deposit, goldYield, isSettlement, meatCap, slaughter, stockOfTown, RESOURCES, type Res } from './Economy'
import { bfsPath } from './Grid'
import { pathBetween, type Walkable } from './Routes'
import type { Game } from './Game'
import type { Boat, GoldDeposit, Pawn, Sheep, Tower, Tree } from './types'

/** Whether this pawn's kingdom currently wants lumber (harvest setting and stock cap). Player-ordered jobs always proceed. */
export function mayHarvest(g: Game, p: Pawn): boolean {
  if (p.manual) return true
  const town = g.towns[p.town]
  const k = g.kingdoms[p.faction], h = HARVEST[k.harvest]
  return h.rate > 0 && (town ? stockOfTown(g, town) : k).lumber <= h.cap
}

export const treeSpec = (t: Tree) => (t.kind <= 1 ? PAWN.conifer : PAWN.broadleaf)

/** Walkable predicate restricted to the pawn faction's currently controlled territory. */
export function ownTerritory(g: Game, faction: number, neutral = false): Walkable {
  const { w, h } = g.world
  const own = (i: number) => g.world.land[i] === 1 && (g.controller[i] === faction + 1 || (neutral && g.controller[i] === 0)) && !g.buffer[i] // (neutral: unclaimed ground, for porters walking out to a moored boat) // (an outpost's combat buffer is not workable ground)
  return {
    w, h,
    at: (x, y) => { const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE); return cx >= 0 && cy >= 0 && cx < w && cy < h && own(cy * w + cx) },
    cell: own,
  }
}

/** Where a builder stands for a site: ships are built from the shore, everything else from just below the structure. */
export const siteSpot = (s: Tower) => s.shore ?? { x: s.x, y: s.y + 40 }
const siteOwned = (g: Game, s: Tower) => { const sp = siteSpot(s); return g.controller[g.cellAt(sp.x, sp.y)] === s.faction + 1 }
const siteReached = (s: Tower, p: Pawn) => (s.shore ? Math.hypot(s.shore.x - p.x, s.shore.y - p.y) < 40 : Math.hypot(s.x - p.x, s.y - p.y) < TOWER.radius + 30)

export function releaseTree(g: Game, p: Pawn) {
  if (p.tree >= 0) { const t = g.world.trees[p.tree]; if (t && t.claimedBy === p.id) t.claimedBy = -1 }
  p.tree = -1
}

export function releaseJob(g: Game, p: Pawn) {
  if (p.job >= 0) { const sh = g.sheep.find(q => q.id === p.job); if (sh && sh.claimedBy === p.id) { sh.claimedBy = -1; sh.hits = 0 } } // job >= 0: a sheep id
  else if (p.job <= -2) { const d = g.goldDeps[-p.job - 2]; if (d && d.claimedBy === p.id) d.claimedBy = -1 } // job <= -2: a gold deposit (-id - 2)
  p.job = -1
}

export function releaseSite(g: Game, p: Pawn) {
  if (p.site >= 0) { const t = g.towerById(p.site); if (t && t.builder === p.id) t.builder = -1 }
  p.site = -1
}

export function switchPawnAllegiance(g: Game, p: Pawn, faction: number) {
  releaseTree(g, p); releaseSite(g, p)
  if (p.pendingTree >= 0) p.pendingTree = -1
  p.faction = faction
  if (p.carry > 0) { const t = g.towns[p.town]; if (t) deposit(g, t, p.carryKind, p.carry); else g.kingdoms[faction].lumber += p.carry; p.carry = 0; p.carryKind = 'lumber' }
  releaseJob(g, p); p.haul = null; p.haulBoat = -1; p.pendingJob = null // the load the pawn carried goes to the new owner with the town
  p.route = []; p.routeIdx = 0; p.vx = p.vy = 0
  p.state = 'wander'; p.planT = 0.4; p.manual = false; p.destTown = -1
}

function setRoute(p: Pawn, pts: number[] | null): boolean {
  if (!pts || !pts.length) return false
  p.route = pts; p.routeIdx = 0
  return true
}

function planToTree(g: Game, p: Pawn, t: Tree): boolean {
  const ok = ownTerritory(g, p.faction)
  const dx = p.x - t.x, dy = p.y - t.y, d = Math.hypot(dx, dy) || 1
  let tx = t.x + (dx / d) * 30, ty = t.y + (dy / d) * 30
  if (!ok.at(tx, ty)) { tx = t.x; ty = t.y }
  if (!ok.at(tx, ty)) return false
  return setRoute(p, pathBetween(ok, p.x, p.y, tx, ty))
}

function nearestTown(g: Game, p: Pawn): number {
  const ok = ownTerritory(g, p.faction)
  const mine = g.towns.filter(t => t.owner === p.faction).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
  for (const t of mine) {
    if (Math.hypot(t.x - p.x, t.y - p.y) < PAWN.depositRange) return t.id
    const path = pathBetween(ok, p.x, p.y, t.x, t.y + 30)
    if (path) { p.route = path; p.routeIdx = 0; return t.id }
  }
  return -1
}

function planReturn(g: Game, p: Pawn): boolean {
  const id = nearestTown(g, p)
  if (id < 0) return false
  p.destTown = id; p.state = 'return-to-town'
  return true
}

function findSite(g: Game, p: Pawn): Tower | null {
  let best: Tower | null = null, bd = Infinity
  for (const t of g.towers) {
    if (t.built || t.faction !== p.faction) continue
    if (t.builder >= 0 && t.builder !== p.id && g.pawnById(t.builder)?.site === t.id) continue
    if (!siteOwned(g, t)) continue
    const d = Math.hypot(t.x - p.x, t.y - p.y)
    if (d < bd) { bd = d; best = t }
  }
  return best
}

function findTree(g: Game, p: Pawn): Tree | null {
  if (!mayHarvest(g, p)) return null
  let best: Tree | null = null, bd = Infinity
  for (const t of g.world.trees) {
    if (t.chopped || (t.claimedBy >= 0 && t.claimedBy !== p.id)) continue
    if (g.controller[t.cell] !== p.faction + 1 || !g.supplied[t.cell] || g.buffer[t.cell]) continue
    const d = Math.hypot(t.x - p.x, t.y - p.y)
    if (d < bd) { bd = d; best = t }
  }
  return best
}

function wanderTarget(g: Game, p: Pawn): boolean {
  const { w, h } = g.world
  const cx = p.cell % w, cy = (p.cell / w) | 0
  let best = -1, bestScore = -Infinity
  for (let k = 0; k < 14; k++) {
    const x = cx + g.rng.int(-7, 7), y = cy + g.rng.int(-7, 7)
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const i = y * w + x
    if (g.controller[i] !== p.faction + 1 || !g.world.land[i]) continue
    let neutral = 0, enemy = 0
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !g.world.land[ny * w + nx]) continue
      const c = g.controller[ny * w + nx]
      if (c === 0) neutral++; else if (c !== p.faction + 1) enemy++
    }
    if (enemy > 0) continue // keep away from enemy frontlines
    const score = (neutral > 0 ? 2 : 0) + g.rng.next()
    if (score > bestScore) { bestScore = score; best = i }
  }
  if (best < 0) return false
  return setRoute(p, pathBetween(ownTerritory(g, p.faction), p.x, p.y, (best % w + 0.5) * TILE, (Math.floor(best / w) + 0.5) * TILE))
}

/** Walk back toward the nearest safe cell we own (never entering enemy-controlled tiles). */
function retreat(g: Game, p: Pawn) {
  const { w, h } = g.world
  const safe = (i: number) => g.world.land[i] === 1 && (g.controller[i] === 0 || g.controller[i] === p.faction + 1)
  const start = p.cell
  if (start < 0 || !safe(start)) { p.state = 'wander'; return }
  const prev = new Int32Array(w * h).fill(-2); const q = [start]; prev[start] = -1
  for (let head = 0; head < q.length; head++) {
    const i = q[head]
    if (g.controller[i] === p.faction + 1 && g.supplied[i]) {
      const path = bfsPath(w, h, start, i, safe)
      if (path && path.length > 1) { p.route = path.slice(1).flatMap(c => [(c % w + 0.5) * TILE, (Math.floor(c / w) + 0.5) * TILE]); p.routeIdx = 0 }
      p.state = 'retreat'; return
    }
    const x = i % w, y = (i / w) | 0
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (prev[j] === -2 && safe(j)) { prev[j] = i; q.push(j) }
    }
  }
  p.state = 'wander'
}

/** Unbuilt towers pull the nearest free pawn off whatever it is doing (except delivering a load). */
function assignBuilders(g: Game) {
  for (const site of g.towers) {
    if (site.built) continue
    if (site.builder >= 0) { const b = g.pawnById(site.builder); if (b && b.site === site.id) continue; site.builder = -1 }
    if (!siteOwned(g, site)) continue
    let best: Pawn | null = null, bd = Infinity
    for (const p of g.pawns) {
      if (p.faction !== site.faction || p.carry > 0 || p.site >= 0) continue
      if (p.state !== 'wander' && p.state !== 'seek-tree' && p.state !== 'travel-to-tree' && p.state !== 'chopping') continue
      const d = Math.hypot(p.x - site.x, p.y - site.y)
      if (d < bd) { bd = d; best = p }
    }
    if (!best) continue
    const spot = siteSpot(site)
    const path = pathBetween(ownTerritory(g, best.faction), best.x, best.y, spot.x, spot.y)
    if (!path) continue
    releaseTree(g, best)
    site.builder = best.id; best.site = site.id; best.route = path; best.routeIdx = 0; best.state = 'travel-to-build'; best.planT = PAWN.replanEvery; best.manual = false
  }
}

function planToPoint(g: Game, p: Pawn, x: number, y: number, neutral = false): boolean {
  const ok = ownTerritory(g, p.faction, neutral)
  const path = pathBetween(ok, p.x, p.y, x, y)
  if (!path || !path.length) return false
  p.route = path; p.routeIdx = 0
  return true
}

/** A ripe sheep of a town on the pawn's own landmass that nobody else is hunting (the nearest one). */
function findSheep(g: Game, p: Pawn): Sheep | null {
  if (!mayHarvest(g, p)) return null
  const town = g.towns[p.town]
  if (!town || isSettlement(town)) return null
  if (stockOfTown(g, town).meat + MEAT.yield > meatCap(g, town) + 0.01) return null // the larder of this landmass is full (5 meat per town)
  let best: Sheep | null = null, bd = Infinity
  for (const s of g.sheep) {
    if (!s.ripe || s.claimedBy >= 0) continue
    const t = g.towns[s.town]
    if (!t || t.ruined || t.owner !== p.faction || t.land !== town.land) continue
    const i = g.cellAt(s.x, s.y)
    if (i < 0 || g.controller[i] !== p.faction + 1) continue
    const d = Math.hypot(s.x - p.x, s.y - p.y)
    if (d < bd) { bd = d; best = s }
  }
  return best
}

/** A gold stone inside the pawn's supplied territory that nobody is working. */
function findGold(g: Game, p: Pawn): GoldDeposit | null {
  if (!mayHarvest(g, p)) return null
  let best: GoldDeposit | null = null, bd = Infinity
  for (const d of g.goldDeps) {
    if (d.taken || d.claimedBy >= 0 || d.cell < 0 || g.controller[d.cell] !== p.faction + 1 || !g.supplied[d.cell] || g.buffer[d.cell]) continue
    const dist = Math.hypot(d.x - p.x, d.y - p.y)
    if (dist < bd) { bd = dist; best = d }
  }
  return best
}

/** Porter errands: carry resources between the region's stockpile and a moored cargo boat, as the player's plus / minus buttons ask. */
function findHaul(g: Game, p: Pawn, only = -1): Pawn['haul'] {
  const town = g.towns[p.town]
  if (!town || town.ruined || p.carry > 0) return null
  const store = stockOfTown(g, town)
  for (const b of g.boats) {
    if (only >= 0 && b.id !== only) continue
    if (b.faction !== p.faction || b.kind !== 'cargo' || !b.docked || b.dockCell < 0 || g.info.landmass[b.dockCell] !== town.land) continue
    if (only < 0 && g.pawns.filter(q => q !== p && q.haul?.boat === b.id).length >= 3) continue
    for (const k of RESOURCES) {
      const inflight = g.pawns.reduce((n, q) => n + (q.haul?.boat === b.id && q.haul.kind === k && q.haul.dir === 'load' && q.haul.phase === 'deliver' ? q.carry : 0), 0)
      if (b.load[k] + inflight < b.want[k] - 0.01 && store[k] >= 1) return { boat: b.id, dir: 'load', kind: k, phase: 'fetch' }
      if (b.unload[k] > 0.01 && b.load[k] > 0.01 && !(k === 'meat' && store.meat >= meatCap(g, town) - 0.01)) return { boat: b.id, dir: 'unload', kind: k, phase: 'fetch' } // (a full larder takes no more meat)
    }
  }
  return null
}

const dockPoint = (g: Game, b: Boat) => ({ x: (b.dockCell % g.world.w + 0.5) * TILE, y: (Math.floor(b.dockCell / g.world.w) + 0.5) * TILE })

function runHaul(g: Game, p: Pawn, dt: number) {
  const h = p.haul, boat = h ? g.boatById(h.boat) : null, town = g.towns[p.town]
  if (!h || !boat || !boat.docked || boat.dockCell < 0 || !town || town.ruined || town.owner !== p.faction) { // the boat left: take any load back to the town
    p.haul = null; p.route = []; p.state = p.carry > 0 ? 'carrying' : 'wander'; p.planT = 0.3
    return
  }
  const toTown = (h.dir === 'load') === (h.phase === 'fetch')
  const dest = toTown ? { x: town.x, y: town.y + 30 } : dockPoint(g, boat)
  if (Math.hypot(dest.x - p.x, dest.y - p.y) > PAWN.depositRange * (toTown ? 1 : 0.9)) {
    p.planT -= dt
    if (p.routeIdx >= p.route.length / 2 && p.planT <= 0) { p.planT = PAWN.replanEvery; if (!planToPoint(g, p, dest.x, dest.y, true)) { p.haul = null; p.state = p.carry > 0 ? 'carrying' : 'wander' } }
    return
  }
  const store = stockOfTown(g, town), step = CARGO.loadAmount[h.kind]
  if (h.dir === 'load' && h.phase === 'fetch') {
    const amt = Math.min(step, Math.max(0, boat.want[h.kind] - boat.load[h.kind]), store[h.kind])
    if (amt <= 0) { p.haul = null; p.state = 'wander'; return }
    store[h.kind] -= amt; p.carry = amt; p.carryKind = h.kind; h.phase = 'deliver'; p.route = []
  } else if (h.dir === 'load') {
    boat.load[h.kind] = Math.min(CARGO.cap[h.kind], boat.load[h.kind] + p.carry)
    p.carry = 0; p.carryKind = 'lumber'; p.haul = null; p.state = 'wander'; p.planT = 0.2; p.route = []
  } else if (h.phase === 'fetch') {
    const space = h.kind === 'meat' ? meatCap(g, town) - store.meat : Infinity
    const amt = Math.min(step, boat.unload[h.kind], boat.load[h.kind], space)
    if (amt <= 0) { if (boat.load[h.kind] <= 0.01) boat.unload[h.kind] = 0; p.haul = null; p.state = 'wander'; return }
    boat.unload[h.kind] = Math.max(0, boat.unload[h.kind] - amt); boat.load[h.kind] -= amt; p.carry = amt; p.carryKind = h.kind; h.phase = 'deliver'; p.route = []
  } else {
    deposit(g, town, h.kind, p.carry)
    p.carry = 0; p.carryKind = 'lumber'; p.haul = null; p.state = 'wander'; p.planT = 0.2; p.route = []
  }
}

export function updatePawns(g: Game, dt: number) {
  if (g.tickCount % 50 === 0) { // a claim whose owner is gone (or no longer on that job) would keep a stone or sheep out of work for ever
    for (const d of g.goldDeps) if (d.claimedBy >= 0) { const q = g.pawnById(d.claimedBy); if (!q || q.job !== -d.id - 2) d.claimedBy = -1 }
    for (const sh of g.sheep) if (sh.claimedBy >= 0) { const q = g.pawnById(sh.claimedBy); if (!q || q.job !== sh.id) sh.claimedBy = -1 }
  }
  if (g.towers.length && g.tickCount % 25 === 0) assignBuilders(g)
  for (const p of g.pawns) {
    p.animT += dt
    p.cell = g.cellAt(p.x, p.y)
    const ownHere = p.cell >= 0 && (g.controller[p.cell] === p.faction + 1 || (p.state === 'haul' && g.controller[p.cell] === 0 && g.world.land[p.cell] === 1)) && !g.buffer[p.cell] // (a porter may cross unclaimed ground to reach its boat)
    if (!ownHere && p.state !== 'retreat') { releaseTree(g, p); releaseSite(g, p); releaseJob(g, p); p.haul = null; p.route = []; retreat(g, p); continue }
    if (p.state === 'retreat') {
      if (ownHere && g.supplied[p.cell] && p.routeIdx >= p.route.length / 2) { p.state = p.carry > 0 ? 'carrying' : 'wander'; p.planT = 0.3 }
      continue
    }
    if ((p.state === 'travel-to-tree' || p.state === 'travel-to-sheep' || p.state === 'travel-to-gold' || p.state === 'seek-tree') && g.tickCount % 10 === p.id % 10 && (p.haulBoat >= 0 || p.pendingJob || (!p.manual && findHaul(g, p)))) { // not yet working: drop the walk, a boat's order (or the player's pick) goes first
      releaseTree(g, p); releaseJob(g, p); p.route = []; p.routeIdx = 0; p.state = 'wander'; p.planT = 0
    }
    const tree = p.tree >= 0 ? g.world.trees[p.tree] : null
    switch (p.state) {
      case 'travel-to-build': {
        const site = g.towerById(p.site)
        if (!site || site.built || site.faction !== p.faction || !siteOwned(g, site)) { releaseSite(g, p); p.state = 'wander'; p.route = []; p.planT = 0.3; break }
        if (siteReached(site, p)) { p.state = 'building'; p.route = []; p.routeIdx = 0; break }
        if (p.routeIdx >= p.route.length / 2) {
          p.planT -= dt
          if (p.planT <= 0) { p.planT = PAWN.replanEvery; const ok = ownTerritory(g, p.faction), sp = siteSpot(site); const path = pathBetween(ok, p.x, p.y, sp.x, sp.y); if (path) { p.route = path; p.routeIdx = 0 } else { releaseSite(g, p); p.state = 'wander' } }
        }
        break
      }
      case 'building': {
        const site = g.towerById(p.site)
        if (!site || site.built) { releaseSite(g, p); p.state = 'wander'; p.planT = 0.3; break }
        p.vx = p.vy = 0; p.facing = site.x < p.x ? -1 : 1
        if (site.faction !== p.faction) { releaseSite(g, p); p.state = 'wander'; p.planT = 0.3; break } // the town changed hands
        g.advanceBuild(site, dt)
        if (site.built) { releaseSite(g, p); p.state = 'wander'; p.planT = 0.3 }
        break
      }
      case 'haul': runHaul(g, p, dt); break
      case 'travel-to-sheep': {
        const sh = g.sheep.find(q => q.id === p.job)
        if (!sh || sh.claimedBy !== p.id) { releaseJob(g, p); p.state = 'wander'; p.route = []; p.planT = 0.3; break }
        if (Math.hypot(sh.x - p.x, sh.y - p.y) < PAWN.interactRange) { p.state = 'hitting'; p.route = []; p.routeIdx = 0; p.hitT = MEAT.hitGap; break }
        if (p.routeIdx >= p.route.length / 2) { p.planT -= dt; if (p.planT <= 0) { p.planT = PAWN.replanEvery; if (!planToPoint(g, p, sh.x - Math.sign(sh.x - p.x) * 30, sh.y)) { releaseJob(g, p); p.state = 'wander' } } }
        break
      }
      case 'hitting': {
        const sh = g.sheep.find(q => q.id === p.job)
        p.vx = p.vy = 0
        if (!sh || sh.claimedBy !== p.id) { releaseJob(g, p); p.state = 'wander'; p.planT = 0.3; break }
        p.facing = sh.x < p.x ? -1 : 1
        p.hitT -= dt
        if (p.hitT <= 0) {
          p.hitT = MEAT.hitGap; sh.hits++
          g.fx.push({ kind: 'hit', x: sh.x, y: sh.y - 20, t: 0 })
          if (sh.hits >= MEAT.hits) { slaughter(g, sh); p.job = -1; p.carry = MEAT.yield; p.carryKind = 'meat'; p.state = 'carrying'; p.planT = 0 }
        }
        break
      }
      case 'travel-to-gold': {
        const d = p.job <= -2 ? g.goldDeps[-p.job - 2] : null
        if (!d || d.taken || d.claimedBy !== p.id || g.controller[d.cell] !== p.faction + 1 || !mayHarvest(g, p)) { releaseJob(g, p); p.state = 'wander'; p.route = []; p.planT = 0.3; break }
        const near = Math.hypot(d.x - p.x, d.y - 6 - p.y)
        if (near < 30 || (p.routeIdx >= p.route.length / 2 && near < 90)) { p.state = 'mining'; p.route = []; p.routeIdx = 0; break } // stand beside the stone before swinging (a pawn halted by the coast or a crowd a little short of it works from there)
        if (p.routeIdx >= p.route.length / 2) { p.planT -= dt; if (p.planT <= 0) { p.planT = PAWN.replanEvery; if (!planToPoint(g, p, d.x, d.y + 6)) { releaseJob(g, p); p.state = 'wander' } } }
        break
      }
      case 'mining': {
        const d = p.job <= -2 ? g.goldDeps[-p.job - 2] : null
        p.vx = p.vy = 0
        if (!d || d.taken || d.claimedBy !== p.id || !mayHarvest(g, p)) { releaseJob(g, p); p.state = 'wander'; p.planT = 0.3; break }
        p.facing = d.x < p.x ? -1 : 1
        d.progress += dt * (p.manual ? 1 : HARVEST[g.kingdoms[p.faction].harvest].rate)
        if (d.progress >= GOLD.time) { // a piece of gold every 30 s of work (the stone shrinks as it is mined)
          d.amount -= 1; d.progress = 0
          if (d.amount <= 0.01) d.taken = true
          d.claimedBy = -1; p.job = -1; p.carry = goldYield(g, d); p.carryKind = 'gold'; p.state = 'carrying'; p.planT = 0
          g.fx.push({ kind: 'hit', x: d.x, y: d.y - 30, t: 0 })
        }
        break
      }
      case 'repair': {
        const t = g.towns[p.town]
        if (!t || t.ruined || t.owner !== p.faction || g.time - t.hitAt > SETTLE.repairWindow + 4) { p.state = 'wander'; p.planT = 0.3; p.route = []; break }
        if (Math.hypot(t.x - p.x, t.y + 20 - p.y) > 2.5 * TILE) { p.planT -= dt; if (p.routeIdx >= p.route.length / 2 && p.planT <= 0) { p.planT = PAWN.replanEvery; planToPoint(g, p, t.x + Math.cos(p.id) * 50, t.y + 36) } } else { p.vx = p.vy = 0; p.facing = t.x < p.x ? -1 : 1 }
        break
      }
      case 'chopping': {
        if (!tree || tree.chopped) { p.state = 'wander'; p.tree = -1; break }
        p.vx = p.vy = 0
        p.facing = tree.x < p.x ? -1 : 1
        if (!mayHarvest(g, p)) { releaseTree(g, p); p.state = 'wander'; p.planT = PAWN.replanEvery; break } // setting changed or stock cap reached
        tree.progress += dt * (p.manual ? 1 : HARVEST[g.kingdoms[p.faction].harvest].rate)
        if (tree.progress >= treeSpec(tree).time) {
          tree.chopped = true; tree.claimedBy = -1
          p.carry = treeSpec(tree).yield; p.tree = -1; p.manual = false
          g.chopped.push(tree.id)
          g.fellTree(tree)
          p.state = 'carrying'; p.planT = 0
        }
        break
      }
      case 'travel-to-tree': {
        if (!tree || tree.chopped || g.controller[tree.cell] !== p.faction + 1 || !mayHarvest(g, p)) { releaseTree(g, p); p.state = 'wander'; p.route = []; p.planT = 0.3; break }
        if (Math.hypot(tree.x - p.x, tree.y - p.y) < PAWN.interactRange) { p.state = 'chopping'; p.route = []; p.routeIdx = 0; break }
        if (p.routeIdx >= p.route.length / 2 && Math.hypot(tree.x - p.x, tree.y - p.y) >= PAWN.interactRange) {
          p.planT -= dt
          if (p.planT <= 0) { p.planT = PAWN.replanEvery; if (!planToTree(g, p, tree)) { releaseTree(g, p); p.state = 'wander' } }
        }
        break
      }
      case 'return-to-town': {
        const town = g.towns[p.destTown]
        if (!town || town.owner !== p.faction) { if (!planReturn(g, p)) { p.state = 'carrying'; p.planT = PAWN.replanEvery } break }
        if (Math.hypot(town.x - p.x, town.y - p.y) < PAWN.depositRange) {
          g.stats.k[p.faction].gathered[p.carryKind] += p.carry
          deposit(g, town, p.carryKind, p.carry)
          p.carry = 0; p.carryKind = 'lumber'; p.route = []; p.routeIdx = 0; p.state = 'deposit'
        } else if (p.routeIdx >= p.route.length / 2) {
          p.planT -= dt
          if (p.planT <= 0) { p.planT = PAWN.replanEvery; if (!planReturn(g, p)) p.state = 'carrying' }
        }
        break
      }
      case 'deposit': {
        if (p.pendingTree >= 0) {
          const t = g.world.trees[p.pendingTree]; p.pendingTree = -1
          if (t && !t.chopped && (t.claimedBy < 0 || t.claimedBy === p.id) && g.controller[t.cell] === p.faction + 1 && planToTree(g, p, t)) { t.claimedBy = p.id; p.tree = t.id; p.state = 'travel-to-tree'; break }
        }
        p.state = 'wander'; p.planT = 0.5
        break
      }
      case 'carrying': {
        p.planT -= dt
        if (p.planT <= 0) { p.planT = PAWN.replanEvery; if (!planReturn(g, p)) wanderTarget(g, p) }
        break
      }
      case 'seek-tree':
      case 'wander': {
        p.planT -= dt
        if (p.planT > 0) break
        p.planT = PAWN.replanEvery * (0.8 + g.rng.next() * 0.4)
        if (p.carry > 0) { if (planReturn(g, p)) break }
        if (!p.pendingJob && p.haulBoat < 0) p.manual = false
        // a cargo boat's order comes first (a picked one, then any), right after the last task is done
        if (p.haulBoat >= 0) { const hl = findHaul(g, p, p.haulBoat); if (hl) { p.haul = hl; p.state = 'haul'; p.route = []; p.routeIdx = 0; p.planT = 0; break } p.haulBoat = -1 }
        if (p.pendingJob) {
          const j = p.pendingJob; p.pendingJob = null; p.manual = true
          if (j.kind === 'gold') { const d = g.goldDeps[j.id]; if (d && !d.taken && !takeClaim(g, p, d.claimedBy) && g.controller[d.cell] === p.faction + 1 && planToPoint(g, p, d.x, d.y + 6)) { d.claimedBy = p.id; p.job = -d.id - 2; p.state = 'travel-to-gold'; p.planT = PAWN.replanEvery; break } }
          else { const sh = g.sheep.find(q => q.id === j.id); if (sh && sh.ripe && !takeClaim(g, p, sh.claimedBy) && planToPoint(g, p, sh.x - 26, sh.y)) { sh.claimedBy = p.id; sh.hits = 0; p.job = sh.id; p.state = 'travel-to-sheep'; p.planT = PAWN.replanEvery; break } }
          if (p.faction === 0) g.say(j.kind === 'gold' ? 'The pawn cannot get to that stone' : 'The pawn cannot get to that sheep')
          p.manual = false
        }
        const hl0 = findHaul(g, p)
        if (hl0) { p.haul = hl0; p.state = 'haul'; p.route = []; p.routeIdx = 0; p.planT = 0; break }
        const site = findSite(g, p)
        if (site) {
          const ok = ownTerritory(g, p.faction), sp = siteSpot(site), path = pathBetween(ok, p.x, p.y, sp.x, sp.y)
          if (path) { site.builder = p.id; p.site = site.id; p.route = path; p.routeIdx = 0; p.state = 'travel-to-build'; p.planT = PAWN.replanEvery; break }
        }
        const home = g.towns[p.town]
        if (home && !home.ruined && isSettlement(home) && home.owner === p.faction && g.time - home.hitAt < SETTLE.repairWindow && home.hp < home.maxHp) { p.state = 'repair'; p.route = []; p.routeIdx = 0; p.planT = 0; break } // mend the village while ships shell it
        const sheep = findSheep(g, p)
        if (sheep && planToPoint(g, p, sheep.x - 26, sheep.y)) { sheep.claimedBy = p.id; sheep.hits = 0; p.job = sheep.id; p.state = 'travel-to-sheep'; p.planT = PAWN.replanEvery; break }
        const gd = findGold(g, p)
        if (gd && planToPoint(g, p, gd.x, gd.y + 6)) { gd.claimedBy = p.id; p.job = -gd.id - 2; p.state = 'travel-to-gold'; p.planT = PAWN.replanEvery; break }
        const t = findTree(g, p)
        if (t) {
          p.state = 'seek-tree'
          if (planToTree(g, p, t)) { t.claimedBy = p.id; p.tree = t.id; p.state = 'travel-to-tree'; break }
          p.state = 'wander'
        }
        if (p.routeIdx >= p.route.length / 2) wanderTarget(g, p)
        break
      }
    }
  }
}

/** Player redirects a pawn to harvest a specific tree. Returns false when the order is invalid. */
export function orderPawnToTree(g: Game, p: Pawn, treeId: number): boolean {
  const t = g.world.trees[treeId]
  if (!t || t.chopped || (t.claimedBy >= 0 && t.claimedBy !== p.id)) return false
  if (g.controller[t.cell] !== p.faction + 1) return false
  if (p.carry > 0) { // deliver the current load first, then go
    if (p.pendingTree >= 0) { /* replace previous pending order */ }
    releaseTree(g, p)
    p.pendingTree = treeId
    if (p.state !== 'return-to-town') { p.state = 'carrying'; p.planT = 0 }
    return true
  }
  releaseTree(g, p)
  if (!planToTree(g, p, t)) return false
  t.claimedBy = p.id; p.tree = treeId; p.state = 'travel-to-tree'; p.manual = true
  return true
}

/** The player's pick beats an automatic claim: a pawn that is merely walking to it is called off; one already working it keeps it (returns that pawn). */
function takeClaim(g: Game, p: Pawn, claimedBy: number): Pawn | null {
  if (claimedBy < 0 || claimedBy === p.id) return null
  const q = g.pawnById(claimedBy)
  if (!q) return null // (a stale claim: its owner is gone)
  if (q.state === 'mining' || q.state === 'hitting') return q
  releaseJob(g, q); q.route = []; q.routeIdx = 0; q.state = 'wander'; q.planT = 0.3
  return null
}

/**
 * The player picked something for a selected pawn: a docked cargo boat to serve, a gold stone or a sheep. A pawn that is already cutting, mining,
 * hitting or building drops that task at once.
 * Returns an error message, or null when the order was taken.
 */
export function orderPawnToTarget(g: Game, p: Pawn, t: { kind: 'boat' | 'gold' | 'sheep'; id: number }): string | null {
  const town = g.towns[p.town]
  if (!town || town.ruined) return 'This pawn has no town'
  if (t.kind === 'boat') {
    const b = g.boatById(t.id)
    if (!b || b.faction !== p.faction || b.kind !== 'cargo') return 'Pick a cargo boat'
    if (!b.docked || b.dockCell < 0) return 'The cargo boat must be docked first'
    if (g.info.landmass[b.dockCell] !== town.land) return 'That boat is moored at another island'
    p.haulBoat = b.id; p.pendingJob = null
  } else if (t.kind === 'gold') {
    const d = g.goldDeps[t.id]
    if (!d || d.taken) return 'That stone is gone'
    if (g.controller[d.cell] !== p.faction + 1) return 'Gold must lie inside your territory'
    if (takeClaim(g, p, d.claimedBy)) return 'Another pawn is already mining that stone'
    if (d.claimedBy >= 0 && d.claimedBy !== p.id && !g.pawnById(d.claimedBy)) d.claimedBy = -1
    p.pendingJob = { kind: 'gold', id: t.id }; p.haulBoat = -1
  } else {
    const sh = g.sheep.find(q => q.id === t.id)
    if (!sh || !sh.ripe) return 'That sheep is not ready'
    if (takeClaim(g, p, sh.claimedBy)) return 'Another pawn is already hunting that sheep'
    if (sh.claimedBy >= 0 && sh.claimedBy !== p.id && !g.pawnById(sh.claimedBy)) sh.claimedBy = -1
    p.pendingJob = { kind: 'sheep', id: t.id }; p.haulBoat = -1
  }
  p.manual = true
  // the player's word beats whatever the pawn was doing: the task is dropped on the spot (a load it carried goes into the store)
  const town2 = g.towns[p.town]
  if (p.carry > 0 && town2 && !town2.ruined) { deposit(g, town2, p.carryKind, p.carry); p.carry = 0; p.carryKind = 'lumber' }
  releaseTree(g, p); releaseJob(g, p); releaseSite(g, p); p.pendingTree = -1; p.haul = null
  p.route = []; p.routeIdx = 0; p.vx = p.vy = 0; p.state = 'wander'; p.planT = 0
  return null
}
