import { SETTLE, UNIT_TYPES } from './config'
import { gz, gunz, type FilmParams } from './Film'
import type { Game } from './Game'
import type { Boat, BoatDir, Pawn, PawnState, Tower, Town, Unit, UnitState } from './types'
import { BOAT_KINDS } from './Stats'

/**
 * The reel: a literal replay made of positions instead of re-simulation. Every second the game keeps where everything is (units, ships, pawns, towns, towers),
 * how it looks (facing, what it is doing, hit points) and, less often, the territory map and which trees are felled. The player draws those with the real
 * renderer and glides everything between two snapshots, so it plays back as the game looked, and can never drift from what happened: it is a recording,
 * not a re-run. (What it does not keep: individual swings and arrows in flight; boats that are firing are shown firing at their target.)
 */
export const REEL_EVERY = 1
const SNAP_EVERY = 5 // territory and trees
const STATES: UnitState[] = ['idle', 'moving', 'engaging', 'attacking', 'cooldown', 'blocked', 'guarding', 'dead']
const DIRS: BoatDir[] = ['up', 'down', 'left', 'right']
const PAWN_STATES: PawnState[] = ['wander', 'seek-tree', 'travel-to-tree', 'chopping', 'carrying', 'return-to-town', 'deposit', 'retreat', 'travel-to-build', 'building', 'travel-to-sheep', 'hitting', 'travel-to-gold', 'mining', 'haul']
const CARRY = ['lumber', 'gold', 'meat'] as const
const TOWER_KINDS = ['tower', 'lot', 'settlement', ...BOAT_KINDS] as const

export type ReelFrame = {
  t: number
  units: Int32Array // x7: id, x, y, meta, hp, maxHp, aim   (meta: faction | type<<6 | facing<<9 | state<<10 | (count-1)<<14 | overcap<<17)
  boats: Int32Array // x9: id, x, y, meta, hp, maxHp, cargo, tx, ty   (meta: kind | faction<<3 | dir<<9 | docked<<11 | open<<12 | flip<<13 | burning<<14 | firing<<15; tx,ty = what it fires at)
  pawns: Int32Array // x7: id, x, y, meta, carry, vx, vy   (meta: faction | state<<6 | carryKind<<10 | facing<<12)
  towns: Int32Array // x8: id, cx, cy, owner+1, kind*4+level-1, hp, maxHp, land
  towers: Int32Array // x10: id, kind, x, y, faction, built, hp, maxHp, progress*10, town
}
export type ReelSnap = { t: number; ctl: Int32Array; trees: Uint8Array; yards: number[] } // ctl = run lengths of the controller map: value, count, value, count...
export type Reel = { v: 1; params: FilmParams; w: number; h: number; trees: number; frames: ReelFrame[]; snaps: ReelSnap[]; endT: number }

const rle = (a: Uint8Array): Int32Array => {
  const out: number[] = []
  let v = a[0], n = 0
  for (let i = 0; i < a.length; i++) { if (a[i] === v) n++; else { out.push(v, n); v = a[i]; n = 1 } }
  out.push(v, n)
  return Int32Array.from(out)
}
const unrle = (r: Int32Array, into: Uint8Array) => { let at = 0; for (let i = 0; i < r.length; i += 2) { into.fill(r[i], at, at + r[i + 1]); at += r[i + 1] } }

export function newReel(g: Game, params: FilmParams): Reel { return { v: 1, params, w: g.world.w, h: g.world.h, trees: g.world.trees.length, frames: [], snaps: [], endT: 0 } }

/** Take a frame (call between simulation steps). */
export function captureReel(g: Game, reel: Reel) {
  const u: number[] = [], b: number[] = [], p: number[] = [], tw: number[] = [], to: number[] = []
  for (const x of g.units) {
    if (x.state === 'dead' || x.inTower >= 0) continue
    const aim = Math.round((Math.atan2(x.aimY, x.aimX) * 180) / Math.PI + 180) + 360 * Math.min(99, Math.round(x.attackT * 100))
    u.push(x.id, Math.round(x.x), Math.round(x.y), x.faction | (Math.max(0, UNIT_TYPES.indexOf(x.type)) << 6) | ((x.facing > 0 ? 1 : 0) << 9) | (STATES.indexOf(x.state) << 10) | ((x.count - 1) << 14) | ((x.overcap ? 1 : 0) << 17), Math.round(x.hp), Math.round(x.maxHp), aim)
  }
  for (const x of g.boats) {
    if (x.hp <= 0) continue
    const tg = x.target
    const firing = (x.kind === 'zumwalt' || x.kind === 'battleship' || x.kind === 'gunship') && !!tg && (x.shotsLeft > 0 || x.gunCd > 0 || x.volleyCd > 0) && !x.docked
    const t = tg ? (tg.kind === 'boat' ? g.boatById(tg.id) : tg.kind === 'tower' ? g.towerById(tg.id) : tg.kind === 'unit' ? g.unitById(tg.id) : tg.kind === 'town' ? g.towns[tg.id] : { x: tg.x, y: tg.y }) : null
    b.push(x.id, Math.round(x.x), Math.round(x.y), Math.max(0, BOAT_KINDS.indexOf(x.kind)) | (x.faction << 3) | (DIRS.indexOf(x.dir) << 9) | ((x.docked ? 1 : 0) << 11) | ((x.open ? 1 : 0) << 12) | ((x.flip ? 1 : 0) << 13) | (((x.fireT ?? 0) > 0 ? 1 : 0) << 14) | ((firing ? 1 : 0) << 15), Math.round(x.hp), Math.round(x.maxHp), x.cargo.length, t && firing ? Math.round((t as { x: number }).x) : 0, t && firing ? Math.round((t as { y: number }).y) : 0)
  }
  for (const x of g.pawns) p.push(x.id, Math.round(x.x), Math.round(x.y), x.faction | (Math.max(0, PAWN_STATES.indexOf(x.state)) << 6) | (CARRY.indexOf(x.carryKind) << 10) | ((x.facing > 0 ? 1 : 0) << 12), Math.round(x.carry), Math.round(x.vx), Math.round(x.vy))
  for (const x of g.towns) if (!x.ruined) tw.push(x.id, x.cx, x.cy, x.owner + 1, (x.kind === 'barracks' ? 1 : x.kind === 'settlement' ? 2 : 0) * 4 + x.level - 1, Math.round(x.hp), Math.round(x.maxHp), x.land)
  for (const x of g.towers) to.push(x.id, TOWER_KINDS.indexOf(x.kind as never), Math.round(x.x), Math.round(x.y), x.faction, x.built ? 1 : 0, Math.round(x.hp), Math.round(x.maxHp), Math.round(x.progress * 10), x.town)
  reel.frames.push({ t: g.time, units: Int32Array.from(u), boats: Int32Array.from(b), pawns: Int32Array.from(p), towns: Int32Array.from(tw), towers: Int32Array.from(to) })
  reel.endT = g.time
  const last = reel.snaps[reel.snaps.length - 1]
  if (!last || g.time - last.t >= SNAP_EVERY) {
    const trees = new Uint8Array(Math.ceil(g.world.trees.length / 8))
    g.world.trees.forEach((t, i) => { if (t.chopped) trees[i >> 3] |= 1 << (i & 7) })
    reel.snaps.push({ t: g.time, ctl: rle(g.controller), trees, yards: g.yards.flatMap(y => [Math.round(y.x), Math.round(y.y), y.faction]) })
  }
}

// ---------------------------------------------------------------- packing: one gzip'd blob (all the frames' numbers, one after another, behind a small JSON header)
export async function packReel(reel: Reel): Promise<Uint8Array> {
  const parts: Int32Array[] = []
  const head = { v: reel.v, params: reel.params, w: reel.w, h: reel.h, trees: reel.trees, endT: reel.endT, frames: [] as number[][], snaps: [] as number[][] }
  for (const f of reel.frames) { head.frames.push([f.t, f.units.length, f.boats.length, f.pawns.length, f.towns.length, f.towers.length]); parts.push(f.units, f.boats, f.pawns, f.towns, f.towers) }
  for (const s of reel.snaps) { head.snaps.push([s.t, s.ctl.length, s.trees.length, s.yards.length]); parts.push(s.ctl, Int32Array.from(s.trees), Int32Array.from(s.yards)) }
  const hb = new TextEncoder().encode(JSON.stringify(head))
  const words = parts.reduce((n, a) => n + a.length, 0)
  const raw = new Uint8Array(4 + hb.length + words * 4)
  new DataView(raw.buffer).setUint32(0, hb.length)
  raw.set(hb, 4)
  let at = 4 + hb.length
  const dv = new DataView(raw.buffer)
  for (const a of parts) for (let i = 0; i < a.length; i++, at += 4) dv.setInt32(at, a[i])
  return gz2(raw)
}
async function gz2(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return raw
  return new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}
export async function unpackReel(bytes: Uint8Array): Promise<Reel> {
  let raw = bytes
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream !== 'undefined') raw = new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const hl = dv.getUint32(0)
  const h = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hl))) as { v: 1; params: FilmParams; w: number; h: number; trees: number; endT: number; frames: number[][]; snaps: number[][] }
  let at = 4 + hl
  const take = (n: number) => { const a = new Int32Array(n); for (let i = 0; i < n; i++, at += 4) a[i] = dv.getInt32(at); return a }
  const frames: ReelFrame[] = h.frames.map(([t, nu, nb, np, nt, ns]) => ({ t, units: take(nu), boats: take(nb), pawns: take(np), towns: take(nt), towers: take(ns) }))
  const snaps: ReelSnap[] = h.snaps.map(([t, nc, ntr, ny]) => ({ t, ctl: take(nc), trees: Uint8Array.from(take(ntr)), yards: Array.from(take(ny)) }))
  return { v: h.v, params: h.params, w: h.w, h: h.h, trees: h.trees, frames, snaps, endT: h.endT }
}
void gz; void gunz

// ---------------------------------------------------------------- the player's side: turning two frames into objects the renderer can draw
type Pool<T> = Map<number, T>
export class ReelPlayer {
  private units: Pool<Unit> = new Map(); private boats: Pool<Boat> = new Map(); private pawns: Pool<Pawn> = new Map(); private towns: Pool<Town> = new Map(); private towers: Pool<Tower> = new Map()
  private tplUnit: Unit; private tplBoat: Boat; private tplPawn: Pawn | null; private tplTown: Town
  private snapAt = -1
  private idx = 0
  constructor(readonly game: Game, readonly reel: Reel, spawnBoat: (g: Game, k: number, kind: 'boat', x: number, y: number) => Boat) {
    const g = game
    this.tplUnit = structuredClone(g.spawnUnit(1, 10, 10, 'warrior')); g.units = []; (g as unknown as { unitMap: Map<number, Unit> }).unitMap.clear()
    this.tplBoat = structuredClone(spawnBoat(g, 1, 'boat', 10, 10)); g.boats = []
    this.tplPawn = g.pawns[0] ? structuredClone(g.pawns[0]) : null
    this.tplTown = structuredClone(g.towns[0])
    g.pawns = []; g.towers = []
    g.fog.fill(0) // (the replay shows the whole map: no fog)
  }
  /** Show game time `t` (seconds). Returns the interpolation fraction used. */
  show(t: number) {
    const { frames } = this.reel
    if (!frames.length) return
    if (this.idx >= frames.length || frames[this.idx].t > t) this.idx = 0
    let lo = this.idx, hi = frames.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1 }
    this.idx = lo
    const A = frames[lo], B = frames[Math.min(frames.length - 1, lo + 1)]
    const f = B === A ? 0 : Math.max(0, Math.min(1, (t - A.t) / (B.t - A.t)))
    const g = this.game
    g.time = t
    this.applySnap(t)
    this.fillTowns(A); this.fillTowers(A)
    this.fillUnits(A, B, f); this.fillBoats(A, B, f); this.fillPawns(A, B, f)
  }
  private applySnap(t: number) {
    const { snaps } = this.reel
    let s = -1; for (let i = 0; i < snaps.length; i++) { if (snaps[i].t <= t + 0.001) s = i; else break }
    if (s < 0 || s === this.snapAt) return
    this.snapAt = s
    const g = this.game, sn = snaps[s]
    unrle(sn.ctl, g.controller); g.territoryVersion++
    g.world.trees.forEach((tr, i) => { tr.chopped = (sn.trees[i >> 3] & (1 << (i & 7))) !== 0 })
    g.yards = []; for (let i = 0; i < sn.yards.length; i += 3) g.yards.push({ x: sn.yards[i], y: sn.yards[i + 1], faction: sn.yards[i + 2] } as never)
  }
  private index(a: Int32Array, stride: number): Map<number, number> { const m = new Map<number, number>(); for (let i = 0; i < a.length; i += stride) m.set(a[i], i); return m }
  private fillUnits(A: ReelFrame, B: ReelFrame, f: number) {
    const g = this.game, inB = this.index(B.units, 7), seen = new Set<number>(), out: Unit[] = []
    for (let i = 0; i < A.units.length; i += 7) {
      const id = A.units[i]; seen.add(id)
      let u = this.units.get(id); if (!u) { u = structuredClone(this.tplUnit); u.id = id; this.units.set(id, u) }
      const j = inB.get(id), x1 = j !== undefined ? B.units[j + 1] : A.units[i + 1], y1 = j !== undefined ? B.units[j + 2] : A.units[i + 2]
      const meta = A.units[i + 3]
      u.x = u.px = A.units[i + 1] + (x1 - A.units[i + 1]) * f; u.y = u.py = A.units[i + 2] + (y1 - A.units[i + 2]) * f
      u.faction = meta & 63; u.type = UNIT_TYPES[(meta >> 6) & 7] ?? 'warrior'; u.facing = (meta >> 9) & 1 ? 1 : -1; u.state = STATES[(meta >> 10) & 15] ?? 'idle'; u.count = ((meta >> 14) & 7) + 1; u.overcap = ((meta >> 17) & 1) === 1
      u.hp = A.units[i + 4]; u.maxHp = A.units[i + 5]
      const aim = A.units[i + 6], ang = ((aim % 360) - 180) * Math.PI / 180
      u.aimX = Math.cos(ang); u.aimY = Math.sin(ang); u.attackT = Math.floor(aim / 360) / 100
      u.inTower = -1; u.phase = (id * 0.37) % 3
      out.push(u)
    }
    for (const id of this.units.keys()) if (!seen.has(id)) this.units.delete(id)
    g.units = out; (g as unknown as { unitMap: Map<number, Unit> }).unitMap = new Map(out.map(u => [u.id, u]))
  }
  private fillBoats(A: ReelFrame, B: ReelFrame, f: number) {
    const g = this.game, inB = this.index(B.boats, 9), seen = new Set<number>(), out: Boat[] = []
    for (let i = 0; i < A.boats.length; i += 9) {
      const id = A.boats[i]; seen.add(id)
      let b = this.boats.get(id); if (!b) { b = structuredClone(this.tplBoat); b.id = id; this.boats.set(id, b) }
      const j = inB.get(id), x1 = j !== undefined ? B.boats[j + 1] : A.boats[i + 1], y1 = j !== undefined ? B.boats[j + 2] : A.boats[i + 2]
      const meta = A.boats[i + 3]
      b.x = b.px = A.boats[i + 1] + (x1 - A.boats[i + 1]) * f; b.y = b.py = A.boats[i + 2] + (y1 - A.boats[i + 2]) * f
      b.kind = BOAT_KINDS[meta & 7] ?? 'boat'; b.faction = (meta >> 3) & 63; b.dir = DIRS[(meta >> 9) & 3]; b.docked = ((meta >> 11) & 1) === 1; b.open = ((meta >> 12) & 1) === 1; b.flip = ((meta >> 13) & 1) === 1
      b.fireT = ((meta >> 14) & 1) ? 5 : 0
      b.hp = A.boats[i + 4]; b.maxHp = A.boats[i + 5]; b.cargo = new Array(A.boats[i + 6]).fill(-1)
      out.push(b)
    }
    for (const id of this.boats.keys()) if (!seen.has(id)) this.boats.delete(id)
    g.boats = out
  }
  private fillPawns(A: ReelFrame, B: ReelFrame, f: number) {
    const g = this.game
    if (!this.tplPawn) { g.pawns = []; return }
    const inB = this.index(B.pawns, 7), seen = new Set<number>(), out: Pawn[] = []
    for (let i = 0; i < A.pawns.length; i += 7) {
      const id = A.pawns[i]; seen.add(id)
      let p = this.pawns.get(id); if (!p) { p = structuredClone(this.tplPawn); p.id = id; p.animT = (id * 0.31) % 3; this.pawns.set(id, p) }
      const j = inB.get(id), x1 = j !== undefined ? B.pawns[j + 1] : A.pawns[i + 1], y1 = j !== undefined ? B.pawns[j + 2] : A.pawns[i + 2]
      const meta = A.pawns[i + 3]
      p.x = p.px = A.pawns[i + 1] + (x1 - A.pawns[i + 1]) * f; p.y = p.py = A.pawns[i + 2] + (y1 - A.pawns[i + 2]) * f
      p.faction = meta & 63; p.state = PAWN_STATES[(meta >> 6) & 15] ?? 'wander'; p.carryKind = CARRY[(meta >> 10) & 3] ?? 'lumber'; p.facing = (meta >> 12) & 1 ? 1 : -1
      p.carry = A.pawns[i + 4]; p.vx = A.pawns[i + 5]; p.vy = A.pawns[i + 6]; p.animT += 1 / 60
      out.push(p)
    }
    for (const id of this.pawns.keys()) if (!seen.has(id)) this.pawns.delete(id)
    g.pawns = out
  }
  private fillTowns(A: ReelFrame) {
    const g = this.game, seen = new Set<number>()
    for (let i = 0; i < A.towns.length; i += 8) {
      const id = A.towns[i]; seen.add(id)
      let t = this.towns.get(id) ?? g.towns[id]
      if (!t) { t = structuredClone(this.tplTown); t.id = id; t.store = null; t.pawnIds = [] }
      this.towns.set(id, t); g.towns[id] = t
      const code = A.towns[i + 4]
      t.cx = A.towns[i + 1]; t.cy = A.towns[i + 2]; t.x = (t.cx + 0.5) * 64; t.y = (t.cy + 0.5) * 64
      t.owner = A.towns[i + 3] - 1; t.kind = (code >> 2) === 2 ? 'settlement' : (code >> 2) === 1 ? 'barracks' : 'town'; t.level = ((code & 3) + 1) as 1 | 2 | 3
      t.hp = A.towns[i + 5]; t.maxHp = A.towns[i + 6]; t.land = A.towns[i + 7]; t.ruined = false; t.abandoned = t.owner < 0
      t.crate = t.kind === 'settlement' && t.level >= 2 ? { x: t.x + SETTLE.crateOffset[Math.min(2, t.level - 1)], y: t.y + 36 } : null
    }
    for (let id = 0; id < g.towns.length; id++) if (g.towns[id] && !seen.has(id)) g.towns[id].ruined = true
    g.towns.length = Math.max(g.towns.length, 0)
  }
  private fillTowers(A: ReelFrame) {
    const g = this.game, out: Tower[] = []
    for (let i = 0; i < A.towers.length; i += 10) {
      const id = A.towers[i]
      let t = this.towers.get(id); if (!t) { t = { id, kind: 'tower', town: 0, faction: 0, cx: 0, cy: 0, x: 0, y: 0, hp: 1, maxHp: 1, progress: 0, built: true, builder: -1, archer: -1 }; this.towers.set(id, t) }
      t.kind = (TOWER_KINDS[A.towers[i + 1]] ?? 'tower') as Tower['kind']; t.x = A.towers[i + 2]; t.y = A.towers[i + 3]; t.cx = Math.floor(t.x / 64); t.cy = Math.floor(t.y / 64)
      t.faction = A.towers[i + 4]; t.built = A.towers[i + 5] === 1; t.hp = A.towers[i + 6]; t.maxHp = A.towers[i + 7]; t.progress = A.towers[i + 8] / 10; t.town = A.towers[i + 9]
      out.push(t)
    }
    g.towers = out
  }
}
