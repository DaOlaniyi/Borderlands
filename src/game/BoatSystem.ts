import { AI, BARGE, BOAT, BOAT_FLAG, CARGO, DOCK, GUNSHIP, SETTLE, SHIP_NAME, TILE, shipLength, TOWER, TOWN, TURN, UNIT, ZUMWALT, type BoatKind, type Stock } from './config'
import { damageTower, damageTown, damageUnit, knockback } from './CombatSystem'
import type { Game } from './Game'
import { followRoute } from './MovementSystem'
import { buildRoute, pathBetween } from './Routes'
import type { Boat, BoatDir, Unit } from './types'
import { logEvent } from './Stats'
import { atShipyard } from './Yards'

/** A shell in flight. (x1,y1) is where it lands (scattered for Zumwalts); `direct` means it lands on its target, `splash` that it bursts. */
export type Shell = { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; dmg: number; faction: number; kind: 'boat' | 'tower' | 'town' | 'unit' | 'ground'; id: number; src: number; direct: boolean; splash: boolean }
type Target = { kind: Shell['kind']; id: number; x: number; y: number }

export const boatStats = (k: BoatKind) => (k === 'boat' ? BOAT : k === 'zumwalt' ? ZUMWALT : k === 'cargo' ? CARGO : k === 'barge' ? BARGE : GUNSHIP)
export const emptyStock = (): Stock => ({ lumber: 0, gold: 0, meat: 0 })
export const stockTotal = (s: Stock) => s.lumber + s.gold + s.meat
export const isArmed = (b: Boat) => b.kind === 'zumwalt' || b.kind === 'gunship'
/** Radius (px) used to hit-test and target a ship. */
export const boatRadius = (b: Boat) => (b.kind === 'zumwalt' ? 80 : b.kind === 'barge' ? 54 : 46)
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
    facing: 1, dir: 'up', docked: false, docking: false, dockT: 0, dockBlocked: false, side: 'E', flip: false, turnT: 0, muzzle: 0, target: null, scanT: 0, hpSeen: 0, evadeT: 0, fireT: 0, open: false, retaliating: false,
    dockCell: -1, cargo: [], cap: typeof st.cap === 'number' ? st.cap : 0, focus: 'ships', volleyCd: 1.5, shotsLeft: 0, shotT: 0, flash: 0, seq: g.nextSeq(),
    lockT: 0, lockKey: '', strike: null, load: emptyStock(), want: emptyStock(), unload: emptyStock(), trade: null, gunCd: 1, loading: 0, blockedT: 0, stallT: 0, noDock: false, dockSince: -1, dockSpent: false,
  }
  g.boats.push(b)
  const m = mooringNear(g, x, y, DOCK.snapTiles)
  if (m) { b.x = b.px = m.x; b.y = b.py = m.y; moor(g, b, m.land, m.dx, m.dy) }
  return b
}

/** Moor against a land cell: the hull lies along the coast and the dock becomes a small friendly source of territory. */
function moor(g: Game, b: Boat, land: number, dx: number, dy: number) {
  b.dockSince = g.time; b.dockSpent = false
  b.docked = true; b.docking = false; b.dockT = 0; b.dockBlocked = false; b.dockCell = land; b.vx = b.vy = 0; b.route = []; b.routeIdx = 0
  if (b.kind === 'barge') { // the ramp is the bow: it touches down pointing at the beach; enemy troops there are thrown back so the landing party can walk off
    b.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up'
    if (!g.kingdoms[b.faction].isPlayer) { b.open = true; shoveBack(g, b, land) } // (the AI drops the ramp at once; a player does it with F, and only then are the defenders thrown back)
    g.markDirty()
    return
  }
  // land to the left/right of the ship -> the hull lies vertically; land above/below -> horizontally
  if (dx !== 0) b.dir = b.dir === 'down' ? 'down' : 'up'
  else b.dir = b.dir === 'left' ? 'left' : 'right'
  g.markDirty()
}

/** Seconds a ship must lie beside the coast before it moors. */
/** How long a moored ship's territory lasts. An AI barge that has landed troops holds its beachhead for as long as it stays moored. */
export const dockLifetime = (g: Game, b: { kind: BoatKind; faction: number }) => (b.kind === 'barge' && !g.kingdoms[b.faction].isPlayer ? Infinity : DOCK.lifetime)
export const dockTimeOf = (b: { kind: BoatKind }) => (b.kind === 'barge' ? BARGE.dockTime : DOCK.time)

/** A barge touching down: every hostile unit within BARGE.shoveTiles of the landing is thrown back out of the way (nobody can hold a beach against it). */
function shoveBack(g: Game, b: Boat, land: number) {
  const { w } = g.world, gx = ((land % w) + 0.5) * TILE, gy = (Math.floor(land / w) + 0.5) * TILE, R = BARGE.shoveTiles * TILE
  for (const u of g.units) {
    if (u.state === 'dead' || u.inTower >= 0 || !g.hostile(b.faction, u.faction)) continue
    const d = Math.hypot(u.x - gx, u.y - gy)
    if (d >= R) continue
    knockback(g, u, b.x, b.y, R - d + TILE) // (straight away from the ship, so always inland, and out past the edge of the cleared ring)
    u.route = []; u.routeIdx = 0; u.chase = -1; u.target = -1
  }
  g.fx.push({ kind: 'splash', x: b.x, y: b.y, t: 0 }); g.shake = Math.max(g.shake, 0.4)
}

export function undock(g: Game, b: Boat) {
  if (!b.docked && !b.docking) return
  b.docked = false; b.docking = false; b.dockT = 0; b.dockBlocked = false; b.dockCell = -1; b.open = false
  g.markDirty()
}

/** A drawn route that ends on land: cut it where it first leaves the water and end it at the mooring there. Unchanged when it never touches a shore. */
function clipAtShore(g: Game, b: Boat, raw: number[]): number[] {
  let px = b.x, py = b.y, wx = b.x, wy = b.y // (wx, wy: the last point seen on the water)
  const out: number[] = []
  for (let i = 0; i < raw.length; i += 2) {
    const x = raw[i], y = raw[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 16))
    for (let k = 1; k <= n; k++) {
      const sx = px + (x - px) * k / n, sy = py + (y - py) * k / n
      if (isWaterAt(g, sx, sy)) { wx = sx; wy = sy; continue }
      const m = mooringNear(g, wx, wy, DOCK.snapTiles + 0.5) ?? mooringNear(g, sx, sy, DOCK.snapTiles + 1)
      if (!m) return raw
      out.push(m.x, m.y)
      return out
    }
    out.push(x, y); px = x; py = y
  }
  return raw
}

/** Player / AI sailing order. `raw` is a drawn route; it is clipped to water and snaps to a mooring if it ends near the coast. */
export function orderSail(g: Game, b: Boat, raw: number[]): boolean {
  if (raw.length < 2) return false
  const sea = seaWalkable(g)
  if (!b.noDock && !isWaterAt(g, raw[raw.length - 2], raw[raw.length - 1])) raw = clipAtShore(g, b, raw) // a path dragged from the water onto land means "land where it first meets the shore"
  const ex = raw[raw.length - 2], ey = raw[raw.length - 1]
  const moor = b.noDock ? null : mooringNear(g, ex, ey, DOCK.snapTiles) // (a ship told to stay afloat never snaps to the shore)
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
  if (b.kind === 'barge' && b.docked && !b.open) { b.open = true; if (b.dockCell >= 0) shoveBack(g, b, b.dockCell) } // (the ramp comes down to let them off: whoever holds the beach is thrown back as it drops)
  let n = 0
  for (const id of [...b.cargo]) {
    const u = g.unitById(id)
    b.cargo = b.cargo.filter(c => c !== id)
    if (!u || u.state === 'dead') continue
    const spot = landingSpot(g, b)
    u.inTower = -1; u.boardBoat = -1
    if (spot) { u.x = u.px = spot.x; u.y = u.py = spot.y } else { u.state = 'dead'; u.hp = 0; continue }
    u.cell = g.cellAt(u.x, u.y); u.route = []; u.routeIdx = 0; u.vx = u.vy = 0; u.state = 'idle'; u.seq = g.nextSeq(); u.noGarrisonT = 3
    u.aiRole = ''; g.aiMemo.respond.delete(u.id) // landed: free to fight
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
  if (!b.docked || (b.kind === 'barge' && !b.open)) return // (a barge takes troops aboard only with its ramp down)
  let used = cargoCount(g, b)
  for (const u of g.units) {
    if (u.boardBoat !== b.id || u.state === 'dead' || u.inTower >= 0) continue
    if (Math.hypot(u.x - b.x, u.y - b.y) > TILE * 2) { // walk to the shore beside the ship
      if (u.routeIdx >= u.route.length / 2 && b.dockCell >= 0 && g.tickCount % 25 === 0) g.orderMoveTo(u, (b.dockCell % g.world.w + 0.5) * TILE, (Math.floor(b.dockCell / g.world.w) + 0.5) * TILE)
      continue
    }
    if (used + u.count > b.cap) { u.boardBoat = -1; g.say('The ship is full'); continue }
    used += u.count
    if (u.aiRole === 'respond') { u.aiRole = ''; g.aiMemo.respond.delete(u.id) } // aboard: the 'go to the boat' job is done
    b.cargo.push(u.id); u.inTower = BOAT_FLAG + b.id; u.boardBoat = -1
    u.route = []; u.routeIdx = 0; u.vx = u.vy = 0; u.state = 'idle'; u.mode = 'fight'; u.chase = -1
    u.x = u.px = b.x; u.y = u.py = b.y
    g.markDirty()
  }
}

// ---------------------------------------------------------------- damage & sinking
export function damageBoat(g: Game, b: Boat, amount: number, attackerFaction: number, naval = false) {
  if (b.hp <= 0) return
  const wasHealthy = b.hp >= b.maxHp * ZUMWALT.fireBelow
  if (b.kind === 'barge' && !naval) amount *= BARGE.landDamage // (armoured against everything on land: only ships hurt it properly)
  b.hp -= amount; b.flash = 0.15; if (b.kind !== 'barge') b.dockT = 0 // fire interrupts the mooring (a barge presses on)
  if (attackerFaction >= 0 && attackerFaction !== b.faction) {
    g.diplomacy.fighting(attackerFaction, b.faction, g.time)
    if (g.diplomacy.get(attackerFaction, b.faction) === 'neutral') g.diplomacy.set(attackerFaction, b.faction, 'conflict', g.time, `${g.label(attackerFaction)} fired on a ${g.label(b.faction)} ship — relations: In Conflict`) // shooting at somebody's ships starts a conflict at once
  }
  g.fx.push({ kind: 'hit', x: b.x, y: b.y - 10, t: 0 })
  if (b.kind === 'zumwalt' && b.hp > 0 && b.hp < b.maxHp * ZUMWALT.fireBelow && (naval || wasHealthy)) b.fireT = ZUMWALT.fireSeconds // (cosmetic) set alight on dropping below 15 %, and again by every later hit from a ship's guns
  if (b.hp <= 0) sinkBoat(g, b, attackerFaction)
}

export function sinkBoat(g: Game, b: Boat, by = -1) {
  if (by >= 0 && by !== b.faction) { // sinking three of a nation's ships is a declaration of war
    const key = by * 100 + b.faction, n = (g.shipSinkings.get(key) ?? 0) + 1
    g.shipSinkings.set(key, n)
    const rel = g.diplomacy.get(by, b.faction)
    if (n >= 3 && rel !== 'war' && rel !== 'total' && rel !== 'allied') g.diplomacy.declareWar(by, b.faction, g.time, k => g.label(k))
  }
  g.stats.k[b.faction].ships[b.kind].lost++
  if (by >= 0 && by !== b.faction) g.stats.k[by].ships[b.kind].sunk++
  logEvent(g, 'ship', `${g.label(b.faction)} ${SHIP_NAME[b.kind]} sunk${by >= 0 && by !== b.faction ? ` by ${g.label(by)}` : ''}`, b.faction)
  const wasDocked = b.docked
  if (wasDocked) unload(g, b, true) // moored: the crew wades ashore
  else for (const id of [...b.cargo]) { const u = g.unitById(id); if (u) { u.inTower = -1; g.killUnit(u, by) } } // lost at sea: the troops count as war dead
  if (!b.docked && stockTotal(b.load) > 0) g.floaters.push({ id: g.allocId(), x: b.x, y: b.y, load: { ...b.load }, t: 0 }) // cargo floats until somebody scoops it up
  b.load = emptyStock()
  b.cargo = []
  if (b.kind === 'zumwalt') g.wrecks.push({ kind: b.kind, faction: b.faction, dir: b.dir, flip: b.flip, x: b.x, y: b.y, t: 0, list: b.id % 2 ? 1 : -1 }) // a Zumwalt does not just vanish: it rolls over and goes down
  g.boats = g.boats.filter(q => q !== b)
  if (g.selection?.kind === 'boats') { const ids = g.selection.ids.filter(i => i !== b.id); g.selection = ids.length ? { kind: 'boats', ids } : null }
  g.fx.push({ kind: 'boom', x: b.x, y: b.y, t: 0 }); g.fx.push({ kind: 'splash', x: b.x, y: b.y, t: 0 }); g.sounds.push({ name: 'boom', x: b.x, y: b.y })
  g.shake = Math.max(g.shake, 0.5)
  g.markDirty()
  g.say(`A ${g.label(b.faction)} ${SHIP_NAME[b.kind]} was sunk`)
}

// ---------------------------------------------------------------- Zumwalt gunnery
/** Damage multiplier by distance: 100 % point blank, falling linearly to 10 % at maximum range. */
export const zumwaltFalloff = (dist: number) => { const r = ZUMWALT.rangeTiles * TILE; return Math.max(ZUMWALT.minDamage, 1 - (1 - ZUMWALT.minDamage) * Math.min(1, dist / r)) }

function nearestIn<T extends { x: number; y: number }>(b: Boat, range: number, list: T[], f: (t: T) => Target): Target | null {
  let best: Target | null = null, bd = range
  for (const t of list) { const d = Math.hypot(t.x - b.x, t.y - b.y); if (d < bd) { bd = d; best = f(t) } }
  return best
}

/**
 * A gunship's favourite prey: any hostile Zumwalt within range. Gunships of one team FOCUS their fire: the Zumwalt most of them (and their allies)
 * are already shooting at wins, then the weakest, then the nearest.
 */
function zumwaltInRange(g: Game, b: Boat, range: number): Target | null {
  const zs = g.boats.filter(o => o.kind === 'zumwalt' && o.hp > 0 && g.hostile(b.faction, o.faction) && Math.hypot(o.x - b.x, o.y - b.y) <= range)
  if (!zs.length) return null
  const mates = g.boats.filter(o => o !== b && o.kind === 'gunship' && o.hp > 0 && (o.faction === b.faction || g.diplomacy.allied(o.faction, b.faction)))
  const aimed = (z: Boat) => mates.reduce((n, m) => n + ((m.target?.kind === 'boat' && m.target.id === z.id) || (m.strike?.kind === 'boat' && m.strike.id === z.id) ? 1 : 0), 0)
  zs.sort((p, q) => aimed(q) - aimed(p) || p.hp - q.hp || Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))
  return { kind: 'boat', id: zs[0].id, x: zs[0].x, y: zs[0].y }
}

/** Gunships hunt ships only: cargo boats first (that is what they are for), then anything else afloat. */
function pickShipTarget(g: Game, b: Boat, range: number): Target | null {
  const zum = zumwaltInRange(g, b, range)
  if (zum) return zum
  const foes = g.boats.filter(o => o !== b && o.hp > 0 && g.hostile(b.faction, o.faction))
  const cargo = nearestIn(b, range, foes.filter(o => o.kind === 'cargo'), o => ({ kind: 'boat', id: o.id, x: o.x, y: o.y }))
  return cargo ?? nearestIn(b, range, foes, o => ({ kind: 'boat', id: o.id, x: o.x, y: o.y }))
}

function pickTarget(g: Game, b: Boat): Target | null {
  const range = ZUMWALT.rangeTiles * TILE
  const near = <T extends { x: number; y: number }>(list: T[], f: (t: T) => Target): Target | null => nearestIn(b, range, list, f)
  const classes: Record<string, () => Target | null> = {
    ships: () => near(g.boats.filter(o => o !== b && o.hp > 0 && g.hostile(b.faction, o.faction)), o => ({ kind: 'boat', id: o.id, x: o.x, y: o.y })),
    buildings: () => near(g.towers.filter(t => g.hostile(b.faction, t.faction)), t => ({ kind: 'tower', id: t.id, x: t.x, y: t.y }))
      ?? near(g.towns.filter(t => !t.ruined && g.hostile(b.faction, t.owner) && (t.kind === 'settlement' || (b.faction === 0 && t.raze))), t => ({ kind: 'town', id: t.id, x: t.x, y: t.y })),
    troops: () => near(g.units.filter(u => u.state !== 'dead' && u.inTower < 0 && g.hostile(b.faction, u.faction)), u => ({ kind: 'unit', id: u.id, x: u.x, y: u.y })),
  }
  const order = [b.focus, ...['ships', 'buildings', 'troops'].filter(c => c !== b.focus)]
  for (const c of order) { const t = classes[c](); if (t) return t }
  return null
}

/** Where a remembered target is now (null if it is gone). */
function locate(g: Game, tg: Boat['target']): Target | null {
  if (!tg) return null
  if (tg.kind === 'ground') return { kind: 'ground', id: -1, x: tg.x, y: tg.y }
  if (tg.kind === 'boat') { const o = g.boatById(tg.id); return o && o.hp > 0 ? { kind: 'boat', id: o.id, x: o.x, y: o.y } : null }
  if (tg.kind === 'tower') { const o = g.towerById(tg.id); return o ? { kind: 'tower', id: o.id, x: o.x, y: o.y } : null }
  if (tg.kind === 'town') { const o = g.towns[tg.id]; return o && !o.ruined ? { kind: 'town', id: o.id, x: o.x, y: o.y } : null }
  const u = g.unitById(tg.id)
  return u && u.state !== 'dead' && u.inTower < 0 ? { kind: 'unit', id: u.id, x: u.x, y: u.y } : null
}

/**
 * The player's manual target: an enemy under the X (ship, tower, town, troop) or a bare spot of ground. Returns null once an enemy
 * target is gone (the ship then falls back to its usual priorities); ground targets stay until replaced or cleared.
 */
function manualTarget(g: Game, b: Boat): Target | null {
  const st = b.strike
  if (!st) return null
  if (st.kind === 'ground') return { kind: 'ground', id: -1, x: st.x, y: st.y }
  const t = locate(g, st)
  if (!t) b.strike = null
  return t
}

/**
 * Target button: click any ship, building or troop (hostile or not: a ship ordered to attack a peaceful nation's vessel does so and takes the
 * diplomatic consequences) and the ship will always engage it, sailing into range if it has to. A Zumwalt may also aim at bare ground.
 */
export function setStrike(g: Game, b: Boat, x: number, y: number) {
  if (!isArmed(b)) return
  const R = 1.5 * TILE
  let best: Target | null = null, bd = R
  const consider = (kind: Target['kind'], id: number, px: number, py: number) => { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = { kind, id, x: px, y: py } } }
  for (const o of g.boats) if (o !== b && o.hp > 0 && o.faction !== b.faction) consider('boat', o.id, o.x, o.y)
  for (const t of g.towers) if (t.faction !== b.faction) consider('tower', t.id, t.x, t.y)
  for (const t of g.towns) if (!t.ruined && t.owner >= 0 && t.owner !== b.faction) consider('town', t.id, t.x, t.y)
  for (const u of g.units) if (u.state !== 'dead' && u.inTower < 0 && u.faction !== b.faction) consider('unit', u.id, u.x, u.y)
  const pick = best as Target | null
  b.strike = pick ? { kind: pick.kind as Exclude<Target['kind'], never>, id: pick.id, x: pick.x, y: pick.y } : b.kind === 'zumwalt' ? { kind: 'ground', id: -1, x, y } : null
  b.loading = 0
}
/** AI / scripted order: engage this specific enemy (an entity, not ground). */
export function setStrikeOn(b: Boat, kind: 'boat' | 'tower' | 'town' | 'unit', id: number, x: number, y: number) { b.strike = { kind, id, x, y }; b.loading = 0 }
export const clearStrike = (b: Boat) => { b.strike = null }

// A Zumwalt has three cannons on EACH flank. Seen from above (bow up/down) it fires east or west; seen from the side (bow left/right) north or
// south. A target off both flanks costs a quarter turn (the hull goes from lying across to standing up, or back); never an upside-down flip.
type Side = 'N' | 'E' | 'S' | 'W'
export const sideToward = (dx: number, dy: number): Side => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'E' : 'W') : dy >= 0 ? 'S' : 'N')
const standing = (b: Boat) => b.dir === 'up' || b.dir === 'down'
/** Do the guns on one of the hull's two flanks already cover this side? */
export const bearsOn = (b: Boat, want: Side) => (standing(b) ? want === 'E' || want === 'W' : want === 'N' || want === 'S')
/** One quarter turn toward a target that lies off both flanks. */
function quarterTurn(b: Boat, want: Side) {
  if (want === 'E' || want === 'W') b.dir = 'up'
  else b.dir = b.dir === 'up' ? 'right' : 'left'
  b.flip = false
}

/** Chance a Zumwalt shell lands exactly on its target at a given distance, and how far a miss can stray (a circle that widens with range). */
export const zumwaltDirectChance = (dist: number) => { const f = Math.min(1, dist / (ZUMWALT.rangeTiles * TILE)); return ZUMWALT.directBase + (ZUMWALT.directFar - ZUMWALT.directBase) * f }
export const zumwaltSpread = (dist: number) => ZUMWALT.spreadTiles * TILE * Math.min(1, dist / (ZUMWALT.rangeTiles * TILE))

function fire(g: Game, b: Boat) {
  const tg = b.target ? (b.target.kind === 'ground' ? b.target : locate(g, b.target)) : null
  if (!tg) return false
  const flank: Side = standing(b) ? (tg.x >= b.x ? 'E' : 'W') : tg.y >= b.y ? 'S' : 'N' // the flank facing the target
  b.side = flank
  const guns = ZUMWALT.muzzles[b.dir][flank]!, off = guns[b.muzzle++ % guns.length], mx = b.x + off[0], my = b.y + off[1] // (the cannons take turns: a volley of two uses two of the three, and the next volley carries on round)
  const d = Math.hypot(tg.x - mx, tg.y - my)
  const direct = tg.kind !== 'ground' && g.rng.next() < zumwaltDirectChance(d)
  let ix = tg.x, iy = tg.y
  if (!direct) { const a = g.rng.next() * Math.PI * 2, r = zumwaltSpread(d) * Math.sqrt(g.rng.next()); ix += Math.cos(a) * r; iy += Math.sin(a) * r }
  g.shells.push({ x0: mx, y0: my - 6, x1: ix, y1: iy - 10, t: 0, dur: 0.3 + d / 1800, dmg: SHELL_DAMAGE * zumwaltFalloff(d), faction: b.faction, kind: tg.kind, id: tg.id, src: b.id, direct, splash: true })
  g.sounds.push({ name: 'cannon', x: mx, y: my })
  g.fx.push({ kind: 'hit', x: mx, y: my - 8, t: 0 })
  return true
}
const SHELL_DAMAGE = UNIT.warrior.damage * ZUMWALT.damageMult

/** Ship fire on a town or village: villages shrug off half of it, and note the hit so their pawns run out to repair them. */
function shellTown(g: Game, t: import('./types').Town, dmg: number, faction: number, zumwalt = false) {
  if (t.kind === 'settlement') { dmg *= SETTLE.shipResist; t.hitAt = g.time }
  else if (zumwalt) dmg *= ZUMWALT.villageMult // (a Zumwalt hits a village, i.e. a town, three times as hard)
  damageTown(g, t, dmg, faction)
}

/** A bursting shell: the direct hit (if it landed) plus splash on everything hostile within the blast, with troops shoved away in a spread. */
function burst(g: Game, s: Shell) {
  const R = ZUMWALT.splashTiles * TILE, ix = s.x1, iy = s.y1 + 10
  const direct = s.direct
  let hitSomething = false
  const falloff = (d: number) => Math.max(0.25, 1 - d / R * 0.75)
  if (direct) {
    if (s.kind === 'boat') { const t = g.boatById(s.id); if (t) { damageBoat(g, t, s.dmg, s.faction, true); hitSomething = true } }
    else if (s.kind === 'tower') { const t = g.towerById(s.id); if (t) { damageTower(g, t, s.dmg * ZUMWALT.buildingMult, s.faction); hitSomething = true } }
    else if (s.kind === 'town') { const t = g.towns[s.id]; if (t && !t.ruined) { shellTown(g, t, s.dmg * ZUMWALT.buildingMult, s.faction, true); hitSomething = true } }
    else if (s.kind === 'unit') { const t = g.unitById(s.id); if (t && t.state !== 'dead' && t.inTower < 0) { damageUnit(g, t, s.dmg, s.faction, { x: s.x0, y: s.y0 }); hitSomething = true; if ((t.state as string) !== 'dead') g.shelled(t, s.src, s.x0, s.y0) } }
  }
  if (!s.splash) return
  const splashDmg = s.dmg * ZUMWALT.splashMult
  // troops caught in the blast (the shell's own victim already took the full hit): damage and a shove away from the impact, fanned out
  for (const u of [...g.units]) {
    if (u.state === 'dead' || u.inTower >= 0 || !g.hostile(s.faction, u.faction)) continue
    if (direct && s.kind === 'unit' && u.id === s.id) { if ((u.state as string) !== 'dead') knockback(g, u, ix + (g.rng.next() - 0.5) * 20, iy + (g.rng.next() - 0.5) * 20, ZUMWALT.splashKnock); continue }
    const d = Math.hypot(u.x - ix, u.y - iy)
    if (d > R) continue
    hitSomething = true
    const f = falloff(d)
    damageUnit(g, u, splashDmg * f, s.faction, { x: s.x0, y: s.y0 })
    if ((u.state as string) !== 'dead') { const jit = (g.rng.next() - 0.5) * 0.9, a = Math.atan2(u.y - iy, u.x - ix) + jit; knockback(g, u, u.x - Math.cos(a) * 10, u.y - Math.sin(a) * 10, ZUMWALT.splashKnock * f) }
  }
  for (const t of [...g.towers]) if (g.hostile(s.faction, t.faction) && !(direct && s.kind === 'tower' && t.id === s.id) && Math.hypot(t.x - ix, t.y - iy) <= R + TOWER.radius) { damageTower(g, t, splashDmg * ZUMWALT.buildingMult * falloff(Math.hypot(t.x - ix, t.y - iy)), s.faction); hitSomething = true }
  for (const t of [...g.towns]) if (!t.ruined && g.hostile(s.faction, t.owner) && !(direct && s.kind === 'town' && t.id === s.id) && Math.hypot(t.x - ix, t.y - iy) <= R + TOWN.captureRadius * 0.7) { shellTown(g, t, splashDmg * ZUMWALT.buildingMult * falloff(Math.hypot(t.x - ix, t.y - iy)), s.faction, true); hitSomething = true }
  for (const o of [...g.boats]) if (g.hostile(s.faction, o.faction) && !(direct && s.kind === 'boat' && o.id === s.id) && Math.hypot(o.x - ix, o.y - iy) <= R + boatRadius(o) * 0.5) { damageBoat(g, o, splashDmg * falloff(Math.hypot(o.x - ix, o.y - iy)), s.faction, true); hitSomething = true }
  if (!hitSomething && !g.isLandAt(ix, iy)) g.fx.push({ kind: 'splash', x: ix, y: iy, t: 0 })
}

function landShells(g: Game, dt: number) {
  for (const s of g.shells) s.t += dt
  if (!g.shells.some(s => s.t >= s.dur)) return
  const rest: Shell[] = [], landed: Shell[] = []
  for (const s of g.shells) (s.t < s.dur ? rest : landed).push(s)
  g.shells = rest
  for (const s of landed) {
    g.fx.push({ kind: 'boom', x: s.x1, y: s.y1 + 10, t: 0 }); g.sounds.push({ name: 'boom', x: s.x1, y: s.y1 })
    if (s.splash) burst(g, s)
    else if (s.kind === 'boat') { const t = g.boatById(s.id); if (t) damageBoat(g, t, s.dmg, s.faction, true); else g.fx.push({ kind: 'splash', x: s.x1, y: s.y1, t: 0 }) } // a gunship's round
    else if (s.kind === 'tower') { const t = g.towerById(s.id); if (t) damageTower(g, t, s.dmg, s.faction) }
    else if (s.kind === 'town') { const t = g.towns[s.id]; if (t && !t.ruined) shellTown(g, t, s.dmg, s.faction) }
    else if (s.kind === 'unit') { const t = g.unitById(s.id); if (t && t.state !== 'dead' && t.inTower < 0) damageUnit(g, t, s.dmg, s.faction, { x: s.x0, y: s.y0 }) }
  }
}

// ---------------------------------------------------------------- per-tick update
export const SINK_SECONDS = 3
export function updateBoats(g: Game, dt: number) {
  landShells(g, dt)
  if (g.wrecks.length) { for (const w of g.wrecks) w.t += dt; g.wrecks = g.wrecks.filter(w => w.t < SINK_SECONDS) }
  if (!g.boats.length) return
  if (g.boats.length > 1) separateBoats(g)
  const sea = (x: number, y: number) => isWaterAt(g, x, y)
  for (const b of [...g.boats]) {
    b.px = b.x; b.py = b.y
    if (b.flash > 0) b.flash -= dt
    if ((b.fireT ?? 0) > 0) b.fireT = b.hp >= b.maxHp * ZUMWALT.fireBelow ? 0 : Math.max(0, b.fireT - dt) // (repairs put the fire out)
    if (b.docked && b.hp < b.maxHp && atShipyard(g, b)) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.012 * dt) // only a ship moored beside one of its own shipyards is mended (about 80 s from wreck to whole)
    const moving = b.route.length > 0 && b.routeIdx < b.route.length / 2
    if (b.noDock && b.docking && !b.docked) { b.docking = false; b.dockT = 0; b.dockBlocked = false } // a ship told to stay afloat gives up any mooring attempt
    if (!b.docked) {
      const st = boatStats(b.kind)
      const sailing = followRoute(b, dt, st.speed, st.accel, 60, 70, sea, 40, 14)
      // watchdog: a ship that wants to move but barely does (wedged against a coast corner at its last waypoint, say) is re-planned from the centre of
      // its water cell; if there is no way through, it gives the order up instead of sitting there for ever
      if (sailing && Math.hypot(b.vx, b.vy) < 6) b.stallT += dt; else b.stallT = 0
      if (b.stallT > 3 && b.route.length >= 2) {
        b.stallT = 0
        const ex = b.route[b.route.length - 2], ey = b.route[b.route.length - 1]
        const cx = Math.floor(b.x / TILE), cy = Math.floor(b.y / TILE)
        if (isWaterCell(g, cx, cy)) { b.x = (cx + 0.5) * TILE; b.y = (cy + 0.5) * TILE }
        const fresh = pathBetween(seaWalkable(g), b.x, b.y, ex, ey)
        if (fresh && fresh.length >= 2) { b.route = fresh; b.routeIdx = 0; b.stuck = 0 }
        else { b.route = []; b.routeIdx = 0; b.docking = false; b.vx = b.vy = 0 }
      }
      if (sailing || Math.hypot(b.vx, b.vy) > 4) { b.dir = dirOfVelocity(b); b.flip = false }
      if (!sailing) {
        if (b.docking) tryMoor(g, b, dt)
        else if (b.route.length === 0 && !b.noDock) { // idle beside the coast: head for the shore (this is how a ship "aligns to the coastline")
          const m = mooringNear(g, b.x, b.y, DOCK.snapTiles)
          if (m) { b.route = [m.x, m.y]; b.routeIdx = 0; b.docking = true; b.dockT = 0 }
        } else if (b.route.length > 0) { b.route = []; b.routeIdx = 0 }
      } else b.dockT = 0
    } else { b.vx = b.vy = 0; if (!b.dockSpent && g.time - b.dockSince >= dockLifetime(g, b)) { b.dockSpent = true; g.markDirty() } } // a mooring's territory fades after DOCK.lifetime
    // cargo rides along
    for (const id of b.cargo) { const u = g.unitById(id); if (u) { u.px = u.x; u.py = u.y; u.x = b.x; u.y = b.y; u.cell = g.cellAt(b.x, b.y) } }
    boarding(g, b)
    if (b.docking && !b.docked && g.tickCount % 25 === 0) defendShore(g, b)
    if (isArmed(b) && b.docked && b.strike) { // a moored warship with a chosen target casts off and goes after it
      const man = manualTarget(g, b)
      if (man) approachTarget(g, b, man, (b.kind === 'zumwalt' ? ZUMWALT.rangeTiles : GUNSHIP.rangeTiles) * TILE, dt)
    }
    if (aiZumwalt(g, b) && !b.docked) { shoreDiscipline(g, b); protectZumwalt(g, b) }
    if (b.kind === 'zumwalt' && !b.docked) aimAndFire(g, b, dt, moving)
    else if (b.kind === 'gunship' && !b.docked) gunshipFire(g, b, dt)
    else { b.shotsLeft = 0; b.target = null }
    if (b.kind === 'cargo' || b.kind === 'gunship') scoop(g, b)
  }
}

/** Ships keep their distance: two hulls closer than their combined radii are pushed apart (a moored ship stays put; the other gives way). */
function separateBoats(g: Game) {
  const bs = g.boats
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j]
    if (a.docked && b.docked) continue
    if ((a.docked && b.docking) || (b.docked && a.docking)) continue
    if ((a.docked && b.route.length > 0) || (b.docked && a.route.length > 0)) continue // a ship under way passes a moored one (only idle ships are nudged clear) // a ship making its final approach to a mooring beside a moored one is not shoved away (it picks a free mooring instead)
    const min = (shipLength(a.kind) + shipLength(b.kind)) * 0.36
    let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy)
    if (d >= min) continue
    if (d < 1) { dx = Math.cos(a.id); dy = Math.sin(a.id); d = 1 }
    const push = Math.min(min - d, 6), ux = dx / d, uy = dy / d
    const share = a.docked ? [0, 1] : b.docked ? [1, 0] : [0.5, 0.5]
    const move = (o: Boat, f: number, sx: number, sy: number) => { if (f <= 0) return; const nx = o.x + sx * push * f, ny = o.y + sy * push * f; if (isWaterAt(g, nx, ny)) { o.x = nx; o.y = ny } }
    move(a, share[0], -ux, -uy); move(b, share[1], ux, uy)
  }
}

/** Standing distance (tiles) a ship likes to keep from a target: close enough to hit hard. */
export const standTiles = (b: Boat, kind: string) => (b.kind === 'gunship' ? 8 : kind === 'boat' ? 13 : kind === 'tower' ? 14 : 9) // (a Zumwalt shells towers from just outside their 12-tile reach)

/** How close (tiles) an AI Zumwalt will go to hostile ground: outside tower arrows (12) and archers on the beach (9 vs ships), so it can only shell what lies about 11 tiles inland. */
export const SHORE_STANDOFF = 13
/** True when land held by a nation hostile to `faction` lies within `tiles` of the point. */
export function hostileShoreNear(g: Game, faction: number, x: number, y: number, tiles = SHORE_STANDOFF): boolean {
  const { w, h } = g.world, cx = Math.floor(x / TILE), cy = Math.floor(y / TILE), r = Math.ceil(tiles)
  for (let yy = Math.max(0, cy - r); yy <= Math.min(h - 1, cy + r); yy++) for (let xx = Math.max(0, cx - r); xx <= Math.min(w - 1, cx + r); xx++) {
    const i = yy * w + xx
    if (!g.world.land[i] || !g.controller[i] || (xx - cx) ** 2 + (yy - cy) ** 2 > tiles * tiles) continue
    if (g.hostile(faction, g.controller[i] - 1)) return true
  }
  return false
}
const aiZumwalt = (g: Game, b: Boat) => b.kind === 'zumwalt' && !g.kingdoms[b.faction].isPlayer

/**
 * How far (tiles) an AI Zumwalt keeps from a gunship: just outside its guns (11 tiles), and no farther, because a shell's chance of landing
 * falls from 90 % point blank to 40 % at 24 tiles; at 13 tiles it is still about 60 % and the gunship cannot answer.
 */
export const KITE_TILES = GUNSHIP.rangeTiles + 2
/** Is this Zumwalt in the middle of backing away from gunships? */
export const evading = (g: Game, b: Boat) => g.time < (b.evadeT ?? 0)

/**
 * Zumwalts are precious: an AI one never trades blows with gunships. When any gets inside their guns' reach it backs off to the nearest open
 * water just beyond it (preferring the shortest retreat, and the side where its own gunships are), still firing as it sails, while its escorts
 * go forward to deal with the attackers (see manageNavalForces).
 */
function protectZumwalt(g: Game, b: Boat) {
  if (g.tickCount % 8 !== b.id % 8 || b.docked) return
  const danger = (GUNSHIP.rangeTiles + 1.5) * TILE
  const threats = g.boats.filter(o => o.hp > 0 && o.kind === 'gunship' && g.hostile(b.faction, o.faction) && Math.hypot(o.x - b.x, o.y - b.y) < danger)
  if (!threats.length) return
  if (evading(g, b) && g.time < (b.evadeT ?? 0) - 3) return // (a retreat ordered in the last few seconds is still under way)
  const safe = KITE_TILES * TILE
  const friends = g.boats.filter(o => o !== b && o.faction === b.faction && o.kind === 'gunship' && o.hp > 0)
  const cands: { x: number; y: number; score: number }[] = []
  for (let a = 0; a < 24; a++) for (const r of [4, 7, 10, 13]) {
    const x = b.x + Math.cos((a / 24) * Math.PI * 2) * r * TILE, y = b.y + Math.sin((a / 24) * Math.PI * 2) * r * TILE
    if (!isWaterAt(g, x, y) || !g.info.sea[g.cellAt(x, y)] || hostileShoreNear(g, b.faction, x, y) || towerShadow(g, b.faction, x, y)) continue
    const clear = threats.reduce((m, t) => Math.min(m, Math.hypot(t.x - x, t.y - y)), Infinity)
    const escort = friends.reduce((m, f) => Math.min(m, Math.hypot(f.x - x, f.y - y)), 0 + (friends.length ? Infinity : 0)) / TILE
    cands.push({ x, y, score: Math.max(0, safe - clear) / TILE * 4 + r * 0.25 + escort * 0.05 }) // short of the safe distance costs most, then the length of the retreat
  }
  cands.sort((p, q) => p.score - q.score)
  for (const c of cands.slice(0, 3)) if (orderSail(g, b, [c.x, c.y])) { b.evadeT = g.time + 6; b.loading = 3; return }
}

/** A hostile garrisoned tower whose arrows reach this point (13 tiles), if any: warships keep out of it. */
export function towerShadow(g: Game, faction: number, x: number, y: number, reach = 13 * TILE) {
  return g.towers.find(t => t.built && t.kind === 'tower' && t.archer >= 0 && g.hostile(faction, t.faction) && Math.hypot(t.x - x, t.y - y) < reach) ?? null
}

/** A hostile warship that is shooting at this ship right now and is within `range` (the nearest), if any: it is answered at once, ahead of any other order. */
function attackerOf(g: Game, b: Boat, range: number): Target | null {
  let best: Target | null = null, bd = range
  for (const o of g.boats) {
    if (o === b || o.hp <= 0 || !isArmed(o) || !g.hostile(b.faction, o.faction) || !o.target || o.target.kind !== 'boat' || o.target.id !== b.id) continue
    const d = Math.hypot(o.x - b.x, o.y - b.y)
    if (d < bd) { bd = d; best = { kind: 'boat', id: o.id, x: o.x, y: o.y } }
  }
  return best
}

/** The nearest hostile warship within `range` (a ship under attack always answers its attackers, whatever else it was told to do). */
function selfDefence(g: Game, b: Boat, range: number): Target | null {
  let best: Target | null = null, bd = range
  for (const o of g.boats) { if (o === b || o.hp <= 0 || !isArmed(o) || !g.hostile(b.faction, o.faction)) continue; const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; best = { kind: 'boat', id: o.id, x: o.x, y: o.y } } }
  return best
}

/** The open-sea cell nearest to a point (searching outward up to `maxTiles`), or null. */
function nearestSea(g: Game, x: number, y: number, maxTiles = 14): { x: number; y: number } | null {
  const { w, h } = g.world, cx = Math.floor(x / TILE), cy = Math.floor(y / TILE)
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let yy = Math.max(0, cy - maxTiles); yy <= Math.min(h - 1, cy + maxTiles); yy++) for (let xx = Math.max(0, cx - maxTiles); xx <= Math.min(w - 1, cx + maxTiles); xx++) {
    if (g.world.land[yy * w + xx] || !g.info.sea[yy * w + xx]) continue
    const d = (xx - cx) ** 2 + (yy - cy) ** 2
    if (d < bd) { bd = d; best = { x: (xx + 0.5) * TILE, y: (yy + 0.5) * TILE } }
  }
  return best
}

/**
 * A chosen enemy that is far away: sail to a firing position at the ship's standing distance FROM THE TARGET (on the side we come from),
 * snapped to open water so the pathfinder takes it round any land in between. Re-planned every few seconds.
 */
function approachTarget(g: Game, b: Boat, tg: Target, range: number, dt: number) {
  if (b.kind === 'zumwalt' && evading(g, b)) return // (backing away from gunships: no going after anything meanwhile)
  b.loading -= dt
  if (b.loading > 0) return
  b.loading = 3
  const ground = tg.kind === 'ground'
  const prey = tg.kind === 'boat' ? g.boatById(tg.id) : null
  const rush = b.kind === 'gunship' && prey?.kind === 'zumwalt' // (a gunship goes right up to a Zumwalt: it is under the big guns' best range at a distance and cannot be missed up close)
  const stand = rush ? 2.5 * TILE : ground ? range * 0.85 : Math.min(range * 0.9, standTiles(b, tg.kind) * TILE), d = Math.hypot(tg.x - b.x, tg.y - b.y)
  if (d <= (ground ? range * 0.95 : stand * 1.15)) return // (a bare patch of ground is shelled from anywhere in range)
  const ux = (b.x - tg.x) / d, uy = (b.y - tg.y) / d
  const want = { x: tg.x + ux * stand, y: tg.y + uy * stand }
  let spot = isWaterAt(g, want.x, want.y) && g.info.sea[g.cellAt(want.x, want.y)] ? want : nearestSea(g, want.x, want.y)
  if (ground || !spot || Math.hypot(spot.x - tg.x, spot.y - tg.y) > range * 0.95) { // far inland (or the line of approach is all land): the open water nearest to us that is still within the guns' reach
    const reach = seaWithin(g, b, tg.x, tg.y, range * 0.9)
    if (reach) spot = reach
  }
  for (let i = 0; i < 4 && spot && tg.kind !== 'tower'; i++) { // keep out of garrisoned towers' arrow reach: back off along the line from the tower
    const t = towerShadow(g, b.faction, spot.x, spot.y)
    if (!t) break
    const dx = spot.x - t.x, dy = spot.y - t.y, dd = Math.hypot(dx, dy) || 1
    spot = nearestSea(g, t.x + (dx / dd) * 13.6 * TILE, t.y + (dy / dd) * 13.6 * TILE)
  }
  if (spot && aiZumwalt(g, b) && hostileShoreNear(g, b.faction, spot.x, spot.y)) { // a firing station must keep the shore standoff: find safe water within range of the target
    const safe = safeWater(g, b.faction, tg.x, tg.y, ZUMWALT.rangeTiles * 0.95, { x: tg.x, y: tg.y, range: range * 0.95 })
    if (safe) spot = safe; else { b.strike = null; b.target = null; return } // the target sits too deep inland to shell from safe water: leave it
  }
  if (spot && Math.hypot(spot.x - b.x, spot.y - b.y) > 2 * TILE) orderSail(g, b, [spot.x, spot.y])
}

/** Open sea within `reach` px of (x, y), the cell nearest to the ship. */
function seaWithin(g: Game, b: Boat, x: number, y: number, reach: number): { x: number; y: number } | null {
  const { w, h } = g.world, cx = Math.floor(x / TILE), cy = Math.floor(y / TILE), r = Math.ceil(reach / TILE)
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let yy = Math.max(0, cy - r); yy <= Math.min(h - 1, cy + r); yy++) for (let xx = Math.max(0, cx - r); xx <= Math.min(w - 1, cx + r); xx++) {
    if (g.world.land[yy * w + xx] || !g.info.sea[yy * w + xx]) continue
    const px = (xx + 0.5) * TILE, py = (yy + 0.5) * TILE
    if (Math.hypot(px - x, py - y) > reach) continue
    const d = Math.hypot(px - b.x, py - b.y)
    if (d < bd) { bd = d; best = { x: px, y: py } }
  }
  return best
}

/** Open sea within `reach` tiles of (x, y) that is clear of hostile shore and tower arrows, nearest to `from` (optionally also within `range` px of `near`). */
function safeWater(g: Game, faction: number, x: number, y: number, reach: number, near?: { x: number; y: number; range: number }): { x: number; y: number } | null {
  const { w, h } = g.world, cx = Math.floor(x / TILE), cy = Math.floor(y / TILE), r = Math.ceil(reach)
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let yy = Math.max(0, cy - r); yy <= Math.min(h - 1, cy + r); yy += 2) for (let xx = Math.max(0, cx - r); xx <= Math.min(w - 1, cx + r); xx += 2) {
    if (g.world.land[yy * w + xx] || !g.info.sea[yy * w + xx]) continue
    const px = (xx + 0.5) * TILE, py = (yy + 0.5) * TILE
    if (near && Math.hypot(px - near.x, py - near.y) > near.range) continue
    const d = Math.hypot(px - x, py - y)
    if (d >= bd || hostileShoreNear(g, faction, px, py) || towerShadow(g, faction, px, py)) continue
    bd = d; best = { x: px, y: py }
  }
  return best
}

/**
 * AI Zumwalts never hug an enemy shoreline. Inside the standoff, or while hostile troops/towers can reach it (or it is losing hull to something
 * that is not a ship), it pulls back to the nearest safe water; its chosen target is kept and re-approached from there, or given up when it
 * lies too far inland to be shelled from a safe spot.
 */
function shoreDiscipline(g: Game, b: Boat) {
  if (g.tickCount % 12 !== (b.id % 12)) return
  const hurt = b.hp < b.hpSeen - 1
  b.hpSeen = b.hp
  const tooClose = hostileShoreNear(g, b.faction, b.x, b.y, SHORE_STANDOFF - 1.5)
  const reachPx = UNIT.archer.range * 1.5 + 2 * TILE
  const shot = hurt && (!!towerShadow(g, b.faction, b.x, b.y, 14 * TILE) || g.units.some(u => u.state !== 'dead' && g.hostile(b.faction, u.faction) && Math.hypot(u.x - b.x, u.y - b.y) < reachPx))
  if (!tooClose && !shot) return
  const spot = safeWater(g, b.faction, b.x, b.y, 22)
  if (!spot) return
  const man = b.strike && b.strike.kind !== 'ground' ? manualTarget(g, b) : null
  if (man && Math.hypot(man.x - spot.x, man.y - spot.y) > ZUMWALT.rangeTiles * TILE) { b.strike = null; b.target = null } // too far inland to shell from safe water
  if (Math.hypot(spot.x - b.x, spot.y - b.y) > 1.5 * TILE) { b.loading = 3; orderSail(g, b, [spot.x, spot.y]) }
}

/** Pick a target now and then, swing the broadside toward it, lock on (4 s for a new target) and fire bursts once it faces the right way. */
function aimAndFire(g: Game, b: Boat, dt: number, sailing: boolean) {
  b.scanT -= dt
  const range = ZUMWALT.rangeTiles * TILE
  if (b.scanT <= 0) {
    b.scanT = 0.4
    const man = manualTarget(g, b)
    const atk = attackerOf(g, b, range) // whoever is shooting at us comes first, whatever we were told to do
    b.retaliating = !!atk
    b.target = atk ?? (man && Math.hypot(man.x - b.x, man.y - b.y) <= range ? man : (man ? selfDefence(g, b, range) : pickTarget(g, b))) // an out-of-range manual target: still answer any warship that comes into range
    if (man && !b.target) { b.lockKey = ''; b.shotsLeft = 0 }
  }
  { const man = b.strike ? manualTarget(g, b) : null // a chosen enemy (or patch of ground) out of range: go and get it (unless something is shooting at us)
    if (man && !sailing && !b.retaliating) approachTarget(g, b, man, range, dt) }
  if (!sailing && !b.retaliating && aiZumwalt(g, b) && !evading(g, b) && b.target?.kind === 'boat') { // a lighter ship far off: close to the distance where the shells land (never nearer than its guns reach)
    const tg = locate(g, b.target), o = tg ? g.boatById(tg.id) : null
    if (tg && o && o.kind !== 'zumwalt' && Math.hypot(tg.x - b.x, tg.y - b.y) > (KITE_TILES + 3) * TILE) approachTarget(g, b, tg, range, dt)
  }
  const tg = b.target ? (b.target.kind === 'ground' ? b.target : locate(g, b.target)) : null
  if (!tg) { b.target = null; b.shotsLeft = 0; b.turnT = 0; if (b.volleyCd > 0) b.volleyCd -= dt; return }
  const key = `${tg.kind}:${tg.kind === 'ground' ? Math.round(tg.x / 8) + ',' + Math.round(tg.y / 8) : tg.id}`
  if (key !== b.lockKey) { b.lockKey = key; b.lockT = b.retaliating ? 0.4 : ZUMWALT.lockSeconds; b.shotsLeft = 0; if (b.retaliating) b.volleyCd = 0 } // (a ship under fire shoots back at once) // new target: the guns need time to lock on
  const want = sideToward(tg.x - b.x, tg.y - b.y)
  const aimed = sailing || bearsOn(b, want) // the guns traverse while the ship is under way: it can strike while moving
  if (bearsOn(b, want)) b.side = want
  if (!aimed && !sailing) { // stationary and neither flank bears: a quarter turn
    b.turnT += dt
    if (b.turnT >= TURN.quarter) { b.turnT = 0; quarterTurn(b, want) }
  } else b.turnT = 0
  if (b.lockT > 0) { b.lockT -= dt; return }
  if (b.shotsLeft > 0) {
    if (!aimed) return // the burst waits for the guns to bear
    b.shotT -= dt
    if (b.shotT <= 0) { fire(g, b); b.shotsLeft--; b.shotT = ZUMWALT.shotGap; if (b.shotsLeft <= 0) b.volleyCd = ZUMWALT.volleyGap }
  } else {
    b.volleyCd -= dt
    if (b.volleyCd <= 0 && aimed) { b.shotsLeft = ZUMWALT.shots; b.shotT = 0 }
  }
}

/** Gunship: hits ships only (a manual strike picks a ship; otherwise cargo boats first), 11 tiles, one round at a time. */
function gunshipFire(g: Game, b: Boat, dt: number) {
  const range = GUNSHIP.rangeTiles * TILE
  b.scanT -= dt; b.gunCd -= dt
  if (b.scanT <= 0) {
    b.scanT = 0.4
    const man = manualTarget(g, b)
    const atk = attackerOf(g, b, range)
    b.retaliating = !!atk
    const zum = zumwaltInRange(g, b, range) // (a hostile Zumwalt in range outranks everything but an explicit order that is itself in range)
    b.target = man && Math.hypot(man.x - b.x, man.y - b.y) <= range ? man : zum ?? atk ?? (man ? selfDefence(g, b, range) : pickShipTarget(g, b, range)) // (a chosen target may be a building or troop; on its own it hunts ships only; a ship under attack always answers its attackers)
  }
  { const man = b.strike && b.strike.kind !== 'ground' ? manualTarget(g, b) : null
    if (man && (b.route.length === 0 || man.kind === 'boat') && (!b.retaliating || (man.kind === 'boat' && b.target?.id === man.id))) approachTarget(g, b, man, range, dt) } // (a chased ship keeps moving: re-plan every few seconds)
  const tg = b.target ? locate(g, b.target) : null
  if (!tg || tg.kind === 'ground') { b.target = null; return }
  if (Math.hypot(tg.x - b.x, tg.y - b.y) > range) { b.target = null; return }
  b.dir = Math.abs(tg.x - b.x) >= Math.abs(tg.y - b.y) ? (tg.x < b.x ? 'left' : 'right') : (tg.y < b.y ? 'up' : 'down')
  if (b.gunCd > 0) return
  b.gunCd = GUNSHIP.cooldown
  g.shells.push({ x0: b.x, y0: b.y - 8, x1: tg.x, y1: tg.y - 6, t: 0, dur: 0.2 + Math.hypot(tg.x - b.x, tg.y - b.y) / 1800, dmg: GUNSHIP.damage, faction: b.faction, kind: tg.kind, id: tg.id, src: b.id, direct: true, splash: false })
  g.sounds.push({ name: 'cannon', x: b.x, y: b.y })
}

/** Cargo boats and gunships scoop up floating cargo (any nation's) they sail through, up to their capacity. */
function scoop(g: Game, b: Boat) {
  if (!g.floaters.length || b.docked) return
  const cap = CARGO.cap
  for (const f of g.floaters) {
    if (Math.hypot(f.x - b.x, f.y - b.y) > 1.6 * TILE) continue
    for (const k of ['lumber', 'gold', 'meat'] as const) { const take = Math.min(f.load[k], cap[k] - b.load[k]); if (take > 0) { b.load[k] += take; f.load[k] -= take } }
  }
  g.floaters = g.floaters.filter(f => stockTotal(f.load) > 0.01)
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
/** The nearest mooring (water beside land) within `r` tiles of a point that no moored ship is close to. */
/** Tiles two hulls need between their mooring cells (a barge is 3.4 tiles long and must not share a beach with anybody). */
const berthGap = (a: Boat, o: Boat) => Math.max(2.2, (shipLength(a.kind) + shipLength(o.kind)) / 2 / TILE * 0.85)
/** Is another ship lying at (or still creeping into) this spot? A ship that is already docking there for longer keeps it. */
function berthTaken(g: Game, b: Boat, x: number, y: number) {
  return g.boats.some(o => o !== b && Math.hypot(o.x - x, o.y - y) < berthGap(b, o) * TILE && (o.docked || (o.docking && (o.dockT > b.dockT || (o.dockT === b.dockT && o.id < b.id)))))
}
function freeMooring(g: Game, b: Boat, x: number, y: number, r: number): { x: number; y: number } | null {
  const { w, h } = g.world, cx = Math.floor(x / TILE), cy = Math.floor(y / TILE)
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let yy = Math.max(1, cy - r); yy <= Math.min(h - 2, cy + r); yy++) for (let xx = Math.max(1, cx - r); xx <= Math.min(w - 2, cx + r); xx++) {
    if (!isWaterCell(g, xx, yy)) continue
    if (!N4.some(([dx, dy]) => g.world.land[(yy + dy) * w + xx + dx] === 1)) continue
    const px = (xx + 0.5) * TILE, py = (yy + 0.5) * TILE
    if (g.boats.some(o => o !== b && (o.docked || o.docking) && Math.hypot((o.docking && o.route.length ? o.route[o.route.length - 2] : o.x) - px, (o.docking && o.route.length ? o.route[o.route.length - 1] : o.y) - py) < berthGap(b, o) * TILE)) continue
    if (g.units.some(u => u.state !== 'dead' && u.inTower < 0 && !g.diplomacy.allied(b.faction, u.faction) && Math.hypot(u.x - px, u.y - py) <= (DOCK.guardTiles + 1) * TILE)) continue // not a beach someone else is holding
    const d = Math.hypot(px - x, py - y)
    if (d < bd) { bd = d; best = { x: px, y: py } }
  }
  return best
}

function tryMoor(g: Game, b: Boat, dt: number) {
  const m = mooringNear(g, b.x, b.y, 0.8)
  if (!m) { b.docking = false; b.dockT = 0; b.dockBlocked = false; return }
  const { w } = g.world, gx = ((m.land % w) + 0.5) * TILE, gy = (Math.floor(m.land / w) + 0.5) * TILE
  // another ship already lies at this mooring: look for a free one nearby instead of waiting beside it forever
  if (berthTaken(g, b, m.x, m.y)) {
    const alt = freeMooring(g, b, m.x, m.y, b.kind === 'barge' ? 10 : 7)
    if (alt) { b.route = [alt.x, alt.y]; b.routeIdx = 0; b.docking = true; b.dockT = 0; return }
  }
  const guard = DOCK.guardTiles * TILE
  b.dockBlocked = b.kind !== 'barge' && g.units.some(u => u.state !== 'dead' && u.inTower < 0 && !g.diplomacy.allied(b.faction, u.faction) && Math.hypot(u.x - gx, u.y - gy) <= guard) // (nothing on the beach stops a barge)
  if (b.dockBlocked) { // someone holds the beach: after 12 s look for another, unguarded mooring
    b.dockT = 0; b.blockedT += dt
    if (b.blockedT > 12 && !g.kingdoms[b.faction].isPlayer) { // (AI ships only: a player's ship stays where it was told)
      b.blockedT = 0
      const alt = freeMooring(g, b, m.x, m.y, 9)
      if (alt) { b.route = [alt.x, alt.y]; b.routeIdx = 0; b.docking = true } // (no other beach: keep waiting offshore, as before)
    }
    return
  }
  b.blockedT = 0
  b.dockT += dt
  const owner = g.baseOwnerAt(gx, gy) // landing on a peaceful nation's shore is a violation of its border
  if (owner >= 0 && b.dockT >= 1.5 && !g.diplomacy.allied(b.faction, owner) && g.diplomacy.get(b.faction, owner) === 'neutral') g.diplomacy.violation(b.faction, owner, g.time, g.label, 'moored a ship on')
  if (b.dockT >= dockTimeOf(b)) { b.x = m.x; b.y = m.y; moor(g, b, m.land, m.dx, m.dy) }
}

export { TOWN, TOWER }
