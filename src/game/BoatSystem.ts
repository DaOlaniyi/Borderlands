import { AI, BOAT, BOAT_FLAG, DOCK, TILE, TOWER, TOWN, TURN, UNIT, ZUMWALT, type BoatKind } from './config'
import { damageTower, damageTown, damageUnit } from './CombatSystem'
import type { Game } from './Game'
import { followRoute } from './MovementSystem'
import { buildRoute, pathBetween } from './Routes'
import type { Boat, BoatDir, Unit } from './types'

export type Shell = { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; dmg: number; faction: number; kind: 'boat' | 'tower' | 'town' | 'unit'; id: number; src: number }
type Target = { kind: Shell['kind']; id: number; x: number; y: number }

export const boatStats = (k: BoatKind) => (k === 'boat' ? BOAT : ZUMWALT)
export const isAboard = (u: { inTower: number }) => u.inTower >= BOAT_FLAG
const N4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]

export const isWaterCell = (g: Game, cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < g.world.w && cy < g.world.h && g.world.land[cy * g.world.w + cx] === 0
export const isWaterAt = (g: Game, x: number, y: number) => isWaterCell(g, Math.floor(x / TILE), Math.floor(y / TILE))

/** Water cells a ship may sail through (the whole padded ocean; it is never restricted by territory). */
export function seaWalkable(g: Game) {
  const { w, h } = g.world
  return { w, h, at: (x: number, y: number) => isWaterAt(g, x, y), cell: (i: number) => g.world.land[i] === 0 }
}

/** The water cell nearest to (x,y) that touches land, together with the land cell it touches. Searches `r` tiles around. */
export function mooringNear(g: Game, x: number, y: number, r: number): { x: number; y: number; land: number; dx: number; dy: number } | null {
  const { w } = g.world
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE)
  let best: { x: number; y: number; land: number; dx: number; dy: number } | null = null, bd = Infinity
  const R = Math.ceil(r)
  for (let yy = cy - R; yy <= cy + R; yy++) for (let xx = cx - R; xx <= cx + R; xx++) {
    if (!isWaterCell(g, xx, yy)) continue
    for (const [dx, dy] of N4) {
      const lx = xx + dx, ly = yy + dy
      if (lx < 0 || ly < 0 || lx >= w || ly >= g.world.h || g.world.land[ly * w + lx] !== 1) continue
      const px = (xx + 0.5) * TILE, py = (yy + 0.5) * TILE, d = Math.hypot(px - x, py - y)
      if (d < bd && d <= r * TILE) { bd = d; best = { x: px, y: py, land: ly * w + lx, dx, dy } }
      break
    }
  }
  return best
}

const dirOfVelocity = (b: Boat): BoatDir => (Math.abs(b.vx) >= Math.abs(b.vy) ? (b.vx < 0 ? 'left' : 'right') : (b.vy < 0 ? 'up' : 'down'))

export function spawnBoat(g: Game, faction: number, kind: BoatKind, x: number, y: number): Boat {
  const st = boatStats(kind)
  const b: Boat = {
    id: g.allocId(), kind, faction, x, y, px: x, py: y, vx: 0, vy: 0, hp: st.hp, maxHp: st.hp, route: [], routeIdx: 0, stuck: 0, chkX: x, chkY: y,
    facing: 1, dir: 'up', docked: false, docking: false, dockT: 0, dockBlocked: false, side: 'E', flip: false, turnT: 0, muzzle: 0, target: null, scanT: 0,
    dockCell: -1, cargo: [], cap: st.cap, focus: 'ships', volleyCd: 1.5, shotsLeft: 0, shotT: 0, flash: 0, seq: g.nextSeq(),
  }
  g.boats.push(b)
  const m = mooringNear(g, x, y, DOCK.snapTiles)
  if (m) { b.x = b.px = m.x; b.y = b.py = m.y; moor(g, b, m.land, m.dx, m.dy) }
  return b
}

/** Moor against a land cell: the hull lies along the coast and the dock becomes a small friendly source of territory. */
function moor(g: Game, b: Boat, land: number, dx: number, dy: number) {
  b.docked = true; b.docking = false; b.dockT = 0; b.dockBlocked = false; b.dockCell = land; b.vx = b.vy = 0; b.route = []; b.routeIdx = 0
  // land to the left/right of the ship -> the hull lies vertically; land above/below -> horizontally
  if (dx !== 0) b.dir = b.dir === 'down' ? 'down' : 'up'
  else b.dir = b.dir === 'left' ? 'left' : 'right'
  g.markDirty()
}

export function undock(g: Game, b: Boat) {
  if (!b.docked && !b.docking) return
  b.docked = false; b.docking = false; b.dockT = 0; b.dockBlocked = false; b.dockCell = -1
  g.markDirty()
}

/** Player / AI sailing order. `raw` is a drawn route; it is clipped to water and snaps to a mooring if it ends near the coast. */
export function orderSail(g: Game, b: Boat, raw: number[]): boolean {
  if (raw.length < 2) return false
  const sea = seaWalkable(g)
  const ex = raw[raw.length - 2], ey = raw[raw.length - 1]
  const moor = mooringNear(g, ex, ey, DOCK.snapTiles)
  const goal = moor ? { x: moor.x, y: moor.y } : { x: ex, y: ey }
  if (!sea.at(goal.x, goal.y)) return false
  const raw2 = raw.slice(); raw2[raw2.length - 2] = goal.x; raw2[raw2.length - 1] = goal.y
  let route = buildRoute(sea, b.x, b.y, raw2)
  if (!route.length) route = pathBetween(sea, b.x, b.y, goal.x, goal.y) ?? []
  if (!route.length) return false
  undock(g, b)
  b.route = route; b.routeIdx = 0; b.stuck = 0; b.docking = !!moor; b.dockT = 0; b.dockBlocked = false
  return true
}

/** Unload every unit aboard onto open land beside a docked ship. Returns how many landed. */
export function unload(g: Game, b: Boat, force = false): number {
  if (!b.docked && !force) return 0
  let n = 0
  for (const id of [...b.cargo]) {
    const u = g.unitById(id)
    b.cargo = b.cargo.filter(c => c !== id)
    if (!u || u.state === 'dead') continue
    const spot = landingSpot(g, b)
    u.inTower = -1; u.boardBoat = -1
    if (spot) { u.x = u.px = spot.x; u.y = u.py = spot.y } else { u.state = 'dead'; u.hp = 0; continue }
    u.cell = g.cellAt(u.x, u.y); u.route = []; u.routeIdx = 0; u.vx = u.vy = 0; u.state = 'idle'; u.seq = g.nextSeq(); u.noGarrisonT = 3
    n++
  }
  g.markDirty()
  return n
}

function landingSpot(g: Game, b: Boat): { x: number; y: number } | null {
  const base = b.dockCell >= 0 ? { x: (b.dockCell % g.world.w + 0.5) * TILE, y: (Math.floor(b.dockCell / g.world.w) + 0.5) * TILE } : { x: b.x, y: b.y }
  for (let i = 0; i < 30; i++) {
    const a = g.rng.next() * Math.PI * 2, d = 40 + g.rng.next() * 110
    const x = base.x + Math.cos(a) * d, y = base.y + Math.sin(a) * d
    if (g.isLandAt(x, y) && !g.units.some(u => u.state !== 'dead' && u.inTower < 0 && Math.hypot(u.x - x, u.y - y) < 36)) return { x, y }
  }
  return g.isLandAt(base.x, base.y) ? base : null
}

export function cargoCount(g: Game, b: Boat) { let n = 0; for (const id of b.cargo) n += g.unitById(id)?.count ?? 0; return n }

/** Units walking to a docked friendly ship climb aboard when they reach it. */
function boarding(g: Game, b: Boat) {
  if (!b.docked) return
  let used = cargoCount(g, b)
  for (const u of g.units) {
    if (u.boardBoat !== b.id || u.state === 'dead' || u.inTower >= 0) continue
    if (Math.hypot(u.x - b.x, u.y - b.y) > TILE * 2) { // walk to the shore beside the ship
      if (u.routeIdx >= u.route.length / 2 && b.dockCell >= 0 && g.tickCount % 25 === 0) g.orderMoveTo(u, (b.dockCell % g.world.w + 0.5) * TILE, (Math.floor(b.dockCell / g.world.w) + 0.5) * TILE)
      continue
    }
    if (used + u.count > b.cap) { u.boardBoat = -1; g.say('The ship is full'); continue }
    used += u.count
    b.cargo.push(u.id); u.inTower = BOAT_FLAG + b.id; u.boardBoat = -1
    u.route = []; u.routeIdx = 0; u.vx = u.vy = 0; u.state = 'idle'; u.mode = 'fight'; u.chase = -1
    u.x = u.px = b.x; u.y = u.py = b.y
    g.markDirty()
  }
}

// ---------------------------------------------------------------- damage & sinking
export function damageBoat(g: Game, b: Boat, amount: number, attackerFaction: number) {
  if (b.hp <= 0) return
  b.hp -= amount; b.flash = 0.15; b.dockT = 0 // fire interrupts the mooring
  if (attackerFaction >= 0) g.diplomacy.fighting(attackerFaction, b.faction, g.time)
  g.fx.push({ kind: 'hit', x: b.x, y: b.y - 10, t: 0 })
  if (b.hp <= 0) sinkBoat(g, b)
}

export function sinkBoat(g: Game, b: Boat) {
  const wasDocked = b.docked
  if (wasDocked) unload(g, b, true) // moored: the crew wades ashore
  else for (const id of [...b.cargo]) { const u = g.unitById(id); if (u) { u.inTower = -1; g.killUnit(u, -1) } } // lost at sea
  b.cargo = []
  g.boats = g.boats.filter(q => q !== b)
  if (g.selection?.kind === 'boats') { const ids = g.selection.ids.filter(i => i !== b.id); g.selection = ids.length ? { kind: 'boats', ids } : null }
  g.fx.push({ kind: 'boom', x: b.x, y: b.y, t: 0 }); g.fx.push({ kind: 'splash', x: b.x, y: b.y, t: 0 }); g.sounds.push({ name: 'boom', x: b.x, y: b.y })
  g.shake = Math.max(g.shake, 0.5)
  g.markDirty()
  g.say(`A ${g.label(b.faction)} ${b.kind === 'zumwalt' ? 'Zumwalt' : 'boat'} was sunk`)
}

// ---------------------------------------------------------------- Zumwalt gunnery
/** Damage multiplier by distance: 100 % point blank, falling linearly to 10 % at maximum range. */
export const zumwaltFalloff = (dist: number) => { const r = ZUMWALT.rangeTiles * TILE; return Math.max(ZUMWALT.minDamage, 1 - (1 - ZUMWALT.minDamage) * Math.min(1, dist / r)) }

function pickTarget(g: Game, b: Boat): Target | null {
  const range = ZUMWALT.rangeTiles * TILE
  const near = <T extends { x: number; y: number }>(list: T[], f: (t: T) => Target): Target | null => {
    let best: Target | null = null, bd = range
    for (const t of list) { const d = Math.hypot(t.x - b.x, t.y - b.y); if (d < bd) { bd = d; best = f(t) } }
    return best
  }
  const classes: Record<string, () => Target | null> = {
    ships: () => near(g.boats.filter(o => o !== b && o.hp > 0 && g.hostile(b.faction, o.faction)), o => ({ kind: 'boat', id: o.id, x: o.x, y: o.y })),
    buildings: () => near(g.towers.filter(t => g.hostile(b.faction, t.faction)), t => ({ kind: 'tower', id: t.id, x: t.x, y: t.y }))
      ?? (b.faction === 0 ? near(g.towns.filter(t => !t.ruined && t.raze && g.hostile(b.faction, t.owner)), t => ({ kind: 'town', id: t.id, x: t.x, y: t.y })) : null),
    troops: () => near(g.units.filter(u => u.state !== 'dead' && u.inTower < 0 && g.hostile(b.faction, u.faction)), u => ({ kind: 'unit', id: u.id, x: u.x, y: u.y })),
  }
  const order = [b.focus, ...['ships', 'buildings', 'troops'].filter(c => c !== b.focus)]
  for (const c of order) { const t = classes[c](); if (t) return t }
  return null
}

/** Where a remembered target is now (null if it is gone). */
function locate(g: Game, tg: Boat['target']): Target | null {
  if (!tg) return null
  if (tg.kind === 'boat') { const o = g.boatById(tg.id); return o && o.hp > 0 ? { kind: 'boat', id: o.id, x: o.x, y: o.y } : null }
  if (tg.kind === 'tower') { const o = g.towerById(tg.id); return o ? { kind: 'tower', id: o.id, x: o.x, y: o.y } : null }
  if (tg.kind === 'town') { const o = g.towns[tg.id]; return o && !o.ruined ? { kind: 'town', id: o.id, x: o.x, y: o.y } : null }
  const u = g.unitById(tg.id)
  return u && u.state !== 'dead' && u.inTower < 0 ? { kind: 'unit', id: u.id, x: u.x, y: u.y } : null
}

// The Zumwalt's cannons are on one side of the hull: it must swing that side toward its target (a quarter turn at a time).
type Side = 'N' | 'E' | 'S' | 'W'
const SIDES: Side[] = ['E', 'S', 'W', 'N'] // clockwise
export const sideToward = (dx: number, dy: number): Side => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'E' : 'W') : dy >= 0 ? 'S' : 'N')
export const sideOf = (b: Boat): Side => (b.dir === 'up' ? 'E' : b.dir === 'down' ? 'W' : b.flip ? 'N' : 'S')
function setSide(b: Boat, side: Side) {
  b.flip = side === 'N'
  b.dir = side === 'E' ? 'up' : side === 'W' ? 'down' : b.dir === 'left' ? 'left' : 'right'
  b.side = side
}

function fire(g: Game, b: Boat) {
  const tg = locate(g, b.target)
  if (!tg) return false
  const off = ZUMWALT.muzzles[b.dir][b.muzzle++ % 2], mx = b.x + off[0], my = b.y + (b.flip ? -off[1] : off[1])
  const d = Math.hypot(tg.x - mx, tg.y - my)
  g.shells.push({ x0: mx, y0: my - 6, x1: tg.x, y1: tg.y - 10, t: 0, dur: 0.3 + d / 1800, dmg: UNIT.warrior.damage * ZUMWALT.damageMult * zumwaltFalloff(d), faction: b.faction, kind: tg.kind, id: tg.id, src: b.id })
  g.sounds.push({ name: 'cannon', x: mx, y: my })
  g.fx.push({ kind: 'hit', x: mx, y: my - 8, t: 0 })
  return true
}

function landShells(g: Game, dt: number) {
  for (const s of g.shells) s.t += dt
  if (!g.shells.some(s => s.t >= s.dur)) return
  const rest: Shell[] = []
  for (const s of g.shells) {
    if (s.t < s.dur) { rest.push(s); continue }
    g.fx.push({ kind: 'boom', x: s.x1, y: s.y1 + 10, t: 0 }); g.sounds.push({ name: 'boom', x: s.x1, y: s.y1 })
    if (s.kind === 'boat') { const t = g.boatById(s.id); if (t) damageBoat(g, t, s.dmg, s.faction); else g.fx.push({ kind: 'splash', x: s.x1, y: s.y1, t: 0 }) }
    else if (s.kind === 'tower') { const t = g.towerById(s.id); if (t) damageTower(g, t, s.dmg, s.faction) }
    else if (s.kind === 'town') { const t = g.towns[s.id]; if (t && !t.ruined) damageTown(g, t, s.dmg, s.faction) }
    else { const t = g.unitById(s.id); if (t && t.state !== 'dead' && t.inTower < 0) { damageUnit(g, t, s.dmg, s.faction, { x: s.x0, y: s.y0 }); if ((t.state as string) !== 'dead') g.shelled(t, s.src, s.x0, s.y0) } }
  }
  g.shells = rest
}

// ---------------------------------------------------------------- per-tick update
export function updateBoats(g: Game, dt: number) {
  landShells(g, dt)
  if (!g.boats.length) return
  const sea = (x: number, y: number) => isWaterAt(g, x, y)
  for (const b of [...g.boats]) {
    b.px = b.x; b.py = b.y
    if (b.flash > 0) b.flash -= dt
    const moving = b.route.length > 0 && b.routeIdx < b.route.length / 2
    if (!b.docked) {
      const st = boatStats(b.kind)
      const sailing = followRoute(b, dt, st.speed, st.accel, 60, 70, sea, 40, 14)
      if (sailing || Math.hypot(b.vx, b.vy) > 4) { b.dir = dirOfVelocity(b); b.flip = false }
      if (!sailing) {
        if (b.docking) tryMoor(g, b, dt)
        else if (b.route.length === 0) { // idle beside the coast: head for the shore (this is how a ship "aligns to the coastline")
          const m = mooringNear(g, b.x, b.y, DOCK.snapTiles)
          if (m) { b.route = [m.x, m.y]; b.routeIdx = 0; b.docking = true; b.dockT = 0 }
        } else { b.route = []; b.routeIdx = 0 }
      } else b.dockT = 0
    } else { b.vx = b.vy = 0 }
    // cargo rides along
    for (const id of b.cargo) { const u = g.unitById(id); if (u) { u.px = u.x; u.py = u.y; u.x = b.x; u.y = b.y; u.cell = g.cellAt(b.x, b.y) } }
    boarding(g, b)
    if (b.docking && !b.docked && g.tickCount % 25 === 0) defendShore(g, b)
    if (b.kind === 'zumwalt' && !b.docked) aimAndFire(g, b, dt, moving)
    else { b.shotsLeft = 0; b.target = null }
  }
}

/** Pick a target now and then, swing the broadside toward it, and fire bursts once it faces the right way. */
function aimAndFire(g: Game, b: Boat, dt: number, sailing: boolean) {
  b.side = sideOf(b)
  b.scanT -= dt
  if (b.scanT <= 0) { b.scanT = 0.4; b.target = pickTarget(g, b) }
  const tg = locate(g, b.target)
  if (!tg) { b.target = null; b.shotsLeft = 0; b.turnT = 0; if (b.volleyCd > 0) b.volleyCd -= dt; return }
  const want = sideToward(tg.x - b.x, tg.y - b.y)
  const aimed = b.side === want
  if (!aimed && !sailing) { // stationary: swing the hull round
    b.turnT += dt
    if (b.turnT >= TURN.quarter) {
      b.turnT = 0
      const cur = SIDES.indexOf(b.side), delta = (SIDES.indexOf(want) - cur + 4) % 4
      setSide(b, SIDES[(cur + (delta <= 2 ? 1 : 3)) % 4])
    }
  } else b.turnT = 0
  if (b.shotsLeft > 0) {
    if (!aimed) return // the burst waits for the guns to bear
    b.shotT -= dt
    if (b.shotT <= 0) { fire(g, b); b.shotsLeft--; b.shotT = ZUMWALT.shotGap; if (b.shotsLeft <= 0) b.volleyCd = ZUMWALT.volleyGap }
  } else {
    b.volleyCd -= dt
    if (b.volleyCd <= 0 && aimed) { b.shotsLeft = ZUMWALT.shots; b.shotT = 0 }
  }
}

/**
 * Defenders rush to stand on the shore where a ship is trying to land (their presence keeps it from mooring): units that were
 * shelled by this ship, and idle troops of any AI kingdom that is not allied with it.
 */
function defendShore(g: Game, b: Boat) {
  // the landing spot is where the route ends (defenders start running as soon as the ship heads in), or where the ship lies if it has arrived
  const ex = b.route.length ? b.route[b.route.length - 2] : b.x, ey = b.route.length ? b.route[b.route.length - 1] : b.y
  if (Math.hypot(b.x - ex, b.y - ey) > 14 * TILE) return
  const m = mooringNear(g, ex, ey, 1.2)
  if (!m) return
  const { w } = g.world, gx = ((m.land % w) + 0.5) * TILE, gy = (Math.floor(m.land / w) + 0.5) * TILE, reach = AI.blockRushTiles * TILE
  for (const u of g.units) {
    if (u.state === 'dead' || u.inTower >= 0 || u.mode === 'block' || g.diplomacy.allied(b.faction, u.faction) || Math.hypot(u.x - gx, u.y - gy) > reach) continue
    const ambushed = u.evadeBoat === b.id && u.evadeT > g.time
    const ai = !g.kingdoms[u.faction].isPlayer && u.aiRole === '' && u.routeIdx >= u.route.length / 2 && u.state === 'idle' && u.hp >= u.maxHp * AI.readyHp
    if (!ambushed && !ai) continue
    if (Math.hypot(u.x - gx, u.y - gy) <= DOCK.guardTiles * TILE * 0.6 || g.time - u.lastOrderT < 2) continue
    if (g.orderMoveTo(u, gx, gy) && !g.kingdoms[u.faction].isPlayer) { u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + 20) }
  }
}

/** Lie beside the coast for DOCK.time seconds before mooring. Unfriendly units at the spot hold the ship off; fire interrupts it. */
function tryMoor(g: Game, b: Boat, dt: number) {
  const m = mooringNear(g, b.x, b.y, 0.8)
  if (!m) { b.docking = false; b.dockT = 0; b.dockBlocked = false; return }
  const { w } = g.world, gx = ((m.land % w) + 0.5) * TILE, gy = (Math.floor(m.land / w) + 0.5) * TILE
  const guard = DOCK.guardTiles * TILE
  b.dockBlocked = g.units.some(u => u.state !== 'dead' && u.inTower < 0 && !g.diplomacy.allied(b.faction, u.faction) && Math.hypot(u.x - gx, u.y - gy) <= guard)
  if (b.dockBlocked) { b.dockT = 0; return }
  b.dockT += dt
  const owner = g.baseOwnerAt(gx, gy) // landing on a peaceful nation's shore is a violation of its border
  if (owner >= 0 && b.dockT >= 1.5 && !g.diplomacy.allied(b.faction, owner) && g.diplomacy.get(b.faction, owner) === 'neutral') g.diplomacy.violation(b.faction, owner, g.time, g.label, 'moored a ship on')
  if (b.dockT >= DOCK.time) { b.x = m.x; b.y = m.y; moor(g, b, m.land, m.dx, m.dy) }
}

export { TOWN, TOWER }
