import { HARVEST, PAWN, TILE, TOWER } from './config'
import { bfsPath } from './Grid'
import { pathBetween, type Walkable } from './Routes'
import type { Game } from './Game'
import type { Pawn, Tower, Tree } from './types'

/** Whether this pawn's kingdom currently wants lumber (harvest setting and stock cap). Player-ordered jobs always proceed. */
export function mayHarvest(g: Game, p: Pawn): boolean {
  if (p.manual) return true
  const k = g.kingdoms[p.faction], h = HARVEST[k.harvest]
  return h.rate > 0 && k.lumber <= h.cap
}

export const treeSpec = (t: Tree) => (t.kind <= 1 ? PAWN.conifer : PAWN.broadleaf)

/** Walkable predicate restricted to the pawn faction's currently controlled territory. */
export function ownTerritory(g: Game, faction: number): Walkable {
  const { w, h } = g.world
  const own = (i: number) => g.world.land[i] === 1 && g.controller[i] === faction + 1
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

export function releaseSite(g: Game, p: Pawn) {
  if (p.site >= 0) { const t = g.towerById(p.site); if (t && t.builder === p.id) t.builder = -1 }
  p.site = -1
}

export function switchPawnAllegiance(g: Game, p: Pawn, faction: number) {
  releaseTree(g, p); releaseSite(g, p)
  if (p.pendingTree >= 0) p.pendingTree = -1
  p.faction = faction
  if (p.carry > 0) { const t = g.towns[p.town]; if (t) g.depositLumber(t, p.carry); else g.kingdoms[faction].lumber += p.carry; p.carry = 0 } // the load the pawn carried goes to the new owner with the town
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
    if (g.controller[t.cell] !== p.faction + 1 || !g.supplied[t.cell]) continue
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

export function updatePawns(g: Game, dt: number) {
  if (g.towers.length && g.tickCount % 25 === 0) assignBuilders(g)
  for (const p of g.pawns) {
    p.animT += dt
    p.cell = g.cellAt(p.x, p.y)
    const ownHere = p.cell >= 0 && g.controller[p.cell] === p.faction + 1
    if (!ownHere && p.state !== 'retreat') { releaseTree(g, p); releaseSite(g, p); p.route = []; retreat(g, p); continue }
    if (p.state === 'retreat') {
      if (ownHere && g.supplied[p.cell] && p.routeIdx >= p.route.length / 2) { p.state = p.carry > 0 ? 'carrying' : 'wander'; p.planT = 0.3 }
      continue
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
          g.depositLumber(town, p.carry)
          p.carry = 0; p.route = []; p.routeIdx = 0; p.state = 'deposit'
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
        const site = findSite(g, p)
        if (site) {
          const ok = ownTerritory(g, p.faction), sp = siteSpot(site), path = pathBetween(ok, p.x, p.y, sp.x, sp.y)
          if (path) { site.builder = p.id; p.site = site.id; p.route = path; p.routeIdx = 0; p.state = 'travel-to-build'; p.planT = PAWN.replanEvery; break }
        }
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
