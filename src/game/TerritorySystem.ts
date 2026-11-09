import { MAX_KINGDOMS, TERRITORY } from './config'
import { N4 } from './Grid'
import type { World } from './types'

export type Source = { faction: number; cx: number; cy: number; kind: 'town' | 'unit'; radius?: number; weight?: number; count?: number }

const MAX_F = MAX_KINGDOMS
/** Contribution multiplier for the n-th friendly source (0-based) overlapping a tile. */
export const stackContribution = (index: number) => (index === 0 ? TERRITORY.firstFriendly : TERRITORY.extraFriendly)

/** Combine overlapping friendly contributions: strongest counts fully, every additional one at half weight, capped. */
export const stack = (best: number, sum: number) => (best <= 0 ? 0 : Math.min(best * TERRITORY.stackCap, best * TERRITORY.firstFriendly + TERRITORY.extraFriendly * (sum - best)))

/** Per-tile, per-kingdom accumulators. They stay zeroed between calls: only the tiles a call touched are cleared afterwards (cheap on a big map). */
let scratch: { n: number; tb: Float32Array; ts: Float32Array; ub: Float32Array; us: Float32Array; touched: Uint8Array; list: number[] } | null = null
const getScratch = (n: number) => {
  if (!scratch || scratch.n !== n) scratch = { n, tb: new Float32Array(n * MAX_F), ts: new Float32Array(n * MAX_F), ub: new Float32Array(n * MAX_F), us: new Float32Array(n * MAX_F), touched: new Uint8Array(n), list: [] }
  scratch.list.length = 0
  return scratch
}

/** Influence of one source at offset (dx,dy), or 0 when the tile is outside its reach. */
export function influenceAt(kind: 'town' | 'unit', dx: number, dy: number, radius = TERRITORY.townRadius, weight = TERRITORY.townWeight): number {
  if (kind === 'town') {
    const d = Math.hypot(dx, dy)
    return d > radius ? 0 : weight * (1 - d / (radius + 1))
  }
  if (Math.abs(dx) > TERRITORY.unitRadius || Math.abs(dy) > TERRITORY.unitRadius) return 0
  return TERRITORY.unitWeight * (1 - Math.hypot(dx, dy) / TERRITORY.unitFalloff)
}

/**
 * Weighted, radius-limited competition on the logical grid. Writes `controller` (0 = neutral, otherwise faction+1).
 * Only sources whose reach covers a tile compete for it, and only land can be claimed.
 * After competition every unit keeps a guaranteed `TERRITORY.blob`-square patch (so a unit deep in enemy land is always
 * a visible pocket), and town tiles always belong to their owner.
 */
export function computeController(world: World, sources: Source[], controller: Uint8Array, townCells: { cell: number; faction: number }[] = [], allied?: (a: number, b: number) => boolean) {
  const { w, h, land } = world
  const sc = getScratch(w * h)
  for (const s of sources) {
    const r = s.kind === 'town' ? (s.radius ?? TERRITORY.townRadius) : TERRITORY.unitRadius
    const best = s.kind === 'town' ? sc.tb : sc.ub, sum = s.kind === 'town' ? sc.ts : sc.us
    const n = s.count ?? 1
    for (let y = Math.max(0, s.cy - r); y <= Math.min(h - 1, s.cy + r); y++) for (let x = Math.max(0, s.cx - r); x <= Math.min(w - 1, s.cx + r); x++) {
      const i = y * w + x
      if (!land[i]) continue
      const v = influenceAt(s.kind, x - s.cx, y - s.cy, s.radius, s.weight)
      if (v <= 0) continue
      if (!sc.touched[i]) { sc.touched[i] = 1; sc.list.push(i) }
      const k = i * MAX_F + s.faction
      sum[k] += v * n
      if (v > best[k]) best[k] = v
    }
  }
  controller.fill(0)
  for (let li = 0; li < sc.list.length; li++) {
    const i = sc.list[li]
    let win = 0, top = 0
    for (let f = 0; f < MAX_F; f++) {
      const k = i * MAX_F + f
      let unitPart = stack(sc.ub[k], sc.us[k])
      if (unitPart > 0 && allied) for (let g2 = 0; g2 < MAX_F; g2++) if (g2 !== f && sc.tb[i * MAX_F + g2] > 0 && allied(f, g2)) { unitPart = 0; break } // troops never take land from an ally's town
      const v = stack(sc.tb[k], sc.ts[k]) + unitPart
      if (v > top + 1e-9) { top = v; win = f + 1 }
    }
    controller[i] = win
  }
  for (let li = 0; li < sc.list.length; li++) { // leave the scratch zeroed for the next call
    const i = sc.list[li]
    sc.touched[i] = 0
    for (let f = 0; f < MAX_F; f++) { const k = i * MAX_F + f; sc.tb[k] = 0; sc.ts[k] = 0; sc.ub[k] = 0; sc.us[k] = 0 }
  }
  // Guaranteed patch: every unit owns a blob×blob area (and always its own tile) regardless of the competition above.
  // Overlapping patches of different factions are resolved by stacked unit weight (bigger squads count more); true ties keep
  // the competition result when it is among the tied factions, otherwise the lower faction id.
  const forced = new Map<number, Float32Array>()
  const add = (i: number, f: number, v: number) => {
    let e = forced.get(i)
    if (!e) { e = new Float32Array(MAX_F * 2); forced.set(i, e) }
    e[f * 2 + 1] += v
    if (v > e[f * 2]) e[f * 2] = v
  }
  for (const u of sources) {
    if (u.kind !== 'unit') continue
    const n = u.count ?? 1
    for (let dy = 0; dy < TERRITORY.blob; dy++) for (let dx = 0; dx < TERRITORY.blob; dx++) {
      const x = u.cx + dx, y = u.cy + dy
      if (x < w && y < h && land[y * w + x]) add(y * w + x, u.faction, n + (dx === 0 && dy === 0 ? 1 : 0))
    }
  }
  forced.forEach((e, i) => {
    let top = 0, win = -1, tied = false
    const vals: number[] = []
    for (let f = 0; f < MAX_F; f++) vals.push(stack(e[f * 2], e[f * 2 + 1]))
    for (let f = 0; f < MAX_F; f++) { if (vals[f] > top + 1e-9) { top = vals[f]; win = f; tied = false } else if (vals[f] > 0 && Math.abs(vals[f] - top) <= 1e-9) tied = true }
    if (win < 0) return
    if (tied) { const cur = controller[i] - 1; if (cur >= 0 && Math.abs(vals[cur] - top) <= 1e-9) win = cur }
    const holder = controller[i] - 1
    if (allied && holder >= 0 && holder !== win && allied(win, holder)) return // an ally's territory is left untouched
    controller[i] = win + 1
  })
  for (const t of townCells) controller[t.cell] = t.faction + 1
}

/**
 * 4-directional flood fill from each faction's towns through that faction's own tiles. With `blocOf` (faction → alliance id) the
 * fill spreads over every tile of the same alliance bloc, so an ally's land is a supply bridge: a unit that steps from ally land
 * into enemy or free ground is still connected to supply.
 */
export function computeSupply(controller: Uint8Array, w: number, h: number, towns: { cell: number; faction: number }[], supplied: Uint8Array, blocOf?: number[]) {
  supplied.fill(0)
  const queue: number[] = []
  for (const t of towns) if (controller[t.cell] === t.faction + 1 && !supplied[t.cell]) { supplied[t.cell] = 1; queue.push(t.cell) }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % w, y = (i / w) | 0, f = controller[i]
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx, c = controller[j]
      if (supplied[j] || !c) continue
      if (blocOf ? blocOf[c - 1] === blocOf[f - 1] : c === f) { supplied[j] = 1; queue.push(j) }
    }
  }
}

/**
 * Visits every tile edge that separates different owners. Edges are axis aligned, expressed in cell units and always
 * oriented left→right / top→bottom, so each shared frontline is produced once per side (callers split colour between sides).
 * `faction`/`other` are controller values (0 = neutral/water).
 */
export function forEachBorderEdge(controller: Uint8Array, w: number, h: number, cb: (x0: number, y0: number, x1: number, y1: number, faction: number, other: number) => void) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const f = controller[y * w + x]
    if (!f) continue
    const at = (cx: number, cy: number) => (cx < 0 || cy < 0 || cx >= w || cy >= h ? 0 : controller[cy * w + cx])
    let o = at(x, y - 1); if (o !== f) cb(x, y, x + 1, y, f, o)
    o = at(x + 1, y); if (o !== f) cb(x + 1, y, x + 1, y + 1, f, o)
    o = at(x, y + 1); if (o !== f) cb(x, y + 1, x + 1, y + 1, f, o)
    o = at(x - 1, y); if (o !== f) cb(x, y, x, y + 1, f, o)
  }
}
