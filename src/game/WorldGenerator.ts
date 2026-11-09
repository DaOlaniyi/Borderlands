import { DEFAULT_KINGDOMS, islandScale, kingdomsForSeed, MAP, MAX_KINGDOMS, maxStartTowns, START, TILE } from './config'
import { worldInfo } from './WorldInfo'
import { N4, N8, countComponents, inBounds, largestComponent } from './Grid'
import { hash2, hashSeed, makeRng, type Rng } from './rng'
import type { Decor, Tree, TreeKind, TownSpawn, World } from './types'

export const MIN_TOWN_SEP = 9 // minimum distance between towns of different kingdoms
export const MIN_OWN_SEP = 5

export type Generated = { world: World; spawns: TownSpawn[] }

export function makeWorldFromMask(rows: string[], seed = 1): World {
  const h = rows.length, w = rows[0].length
  const land = new Uint8Array(w * h)
  rows.forEach((r, y) => { for (let x = 0; x < w; x++) land[y * w + x] = r[x] === '#' ? 1 : 0 })
  return { seed, w, h, land, trees: [], decor: [], island: { x: 0, y: 0, w, h } }
}

function smoothNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
const fbm = (x: number, y: number, seed: number) => smoothNoise(x, y, seed) * 0.55 + smoothNoise(x * 2.1, y * 2.1, seed + 7) * 0.3 + smoothNoise(x * 4.3, y * 4.3, seed + 13) * 0.15

function smoothMask(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(w, h, x + dx, y + dy) && m[(y + dy) * w + x + dx]) n++
    out[y * w + x] = n >= 5 ? 1 : 0
  }
  return out
}

function fillSmallLakes(m: Uint8Array, w: number, h: number, maxSize: number) {
  const seen = new Uint8Array(w * h)
  for (let s = 0; s < w * h; s++) {
    if (m[s] || seen[s]) continue
    const cells: number[] = [s]; seen[s] = 1
    let touchesEdge = false
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k], x = i % w, y = (i / w) | 0
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy
        if (!inBounds(w, h, nx, ny)) continue
        const j = ny * w + nx
        if (!m[j] && !seen[j]) { seen[j] = 1; cells.push(j) }
      }
    }
    if (!touchesEdge && cells.length <= maxSize) for (const i of cells) m[i] = 1
  }
}

/** Thicken diagonal-only contacts so 4-neighbour movement/supply never relies on a corner touch. */
function fixDiagonals(m: Uint8Array, w: number, h: number, seed: number) {
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = m[y * w + x], b = m[y * w + x + 1], c = m[(y + 1) * w + x], d = m[(y + 1) * w + x + 1]
    if (a && d && !b && !c) { if (hash2(x, y, seed) < 0.5) m[y * w + x + 1] = 1; else m[(y + 1) * w + x] = 1 }
    else if (b && c && !a && !d) { if (hash2(x, y, seed) < 0.5) m[y * w + x] = 1; else m[(y + 1) * w + x + 1] = 1 }
  }
}

function removeSpurs(m: Uint8Array, w: number, h: number) {
  for (let pass = 0; pass < 2; pass++) {
    const kill: number[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue
      let n = 0
      for (const [dx, dy] of N4) if (inBounds(w, h, x + dx, y + dy) && m[(y + dy) * w + x + dx]) n++
      if (n <= 1) kill.push(y * w + x)
    }
    for (const i of kill) m[i] = 0
  }
}

export function generateIsland(seed: number, w: number, h: number): Uint8Array {
  const total = w * h
  for (let attempt = 0; attempt < 16; attempt++) {
    const s = seed + attempt * 977
    const ox = hash2(1, 2, s) * 100, oy = hash2(3, 4, s) * 100
    const thr = 0.2 - attempt * 0.02
    const scale = 5.5 * Math.max(1, (w + h) / 100)
    let m: Uint8Array = new Uint8Array(total)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - w / 2) / (w / 2), ny = (y + 0.5 - h / 2) / (h / 2)
      // domain-warped coordinates give bays and headlands instead of a smooth blob
      const wx = x + (smoothNoise(x / 9 + ox, y / 9 + oy, s + 3) - 0.5) * 9, wy = y + (smoothNoise(x / 9 - oy, y / 9 + ox, s + 5) - 0.5) * 9
      const d = Math.hypot(nx, ny)
      const n = fbm(wx / scale + ox, wy / scale + oy, s)
      const v = (1 - Math.pow(d, 2.1)) * 0.85 + (n - 0.5) * 1.9
      m[y * w + x] = v > thr && x > 0 && y > 0 && x < w - 1 && y < h - 1 ? 1 : 0
    }
    m = smoothMask(smoothMask(m, w, h), w, h)
    m = largestComponent(m, w, h)
    fillSmallLakes(m, w, h, 6)
    fixDiagonals(m, w, h, s)
    removeSpurs(m, w, h)
    fixDiagonals(m, w, h, s + 1)
    m = largestComponent(m, w, h)
    let land = 0
    for (let i = 0; i < total; i++) land += m[i]
    if (land / total >= 0.38) return m
  }
  // Deterministic fallback: filled rounded rectangle.
  const m = new Uint8Array(total)
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) m[y * w + x] = 1
  return m
}

function coastDistance(land: Uint8Array, w: number, h: number): Int16Array {
  const dist = new Int16Array(w * h).fill(-1)
  const q: number[] = []
  for (let i = 0; i < w * h; i++) if (!land[i]) { dist[i] = 0; q.push(i) }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w, y = (i / w) | 0
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy
      if (!inBounds(w, h, nx, ny)) continue
      const j = ny * w + nx
      if (dist[j] < 0) { dist[j] = dist[i] + 1; q.push(j) }
    }
  }
  // Cells touching the map edge count as coast.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) dist[y * w + x] = Math.min(dist[y * w + x], 1)
  return dist
}

const dist2 = (a: number, b: number, w: number) => Math.hypot((a % w) - (b % w), ((a / w) | 0) - ((b / w) | 0))

/**
 * Keep neighbouring kingdoms within one town of each other (repeated to a fixpoint). Normally the larger one is lowered; the
 * `fixed` kingdom (the player's chosen start) is never changed — its neighbours are raised or lowered toward it instead.
 */
export function relaxCounts(counts: number[], neigh: number[][], fixed = -1, tol = 1) {
  for (let pass = 0; pass < 60; pass++) {
    let changed = false
    for (let a = 0; a < counts.length; a++) for (const b of neigh[a]) {
      const [hi, lo] = counts[a] >= counts[b] ? [a, b] : [b, a]
      if (counts[hi] - counts[lo] <= tol) continue
      // meet in the middle so the spread of big / medium / small powers survives; the fixed (player) count never moves
      if (hi === fixed) counts[lo] = Math.min(START.maxStartTowns, counts[lo] + 1)
      else if (lo === fixed) counts[hi] -= 1
      else { counts[hi] -= 1; counts[lo] = Math.min(START.maxStartTowns, counts[lo] + 1) }
      changed = true
    }
    if (!changed) break
  }
}

/**
 * Start sizes (1..maxPer) for each capital. The sizes form an even spread from big to small (8 kingdoms with a 5-town cap →
 * 5,4,4,3,3,2,2,1: a few big, medium and small powers). They are dealt to the capitals by trying many random arrangements and
 * keeping the one where neighbouring capitals differ by at most one town (big powers end up next to big or medium ones, small
 * next to small or medium).
 */
export function assignCounts(cxy: { x: number; y: number }[], neigh: number[][], maxPer: number, kingdomCount: number, rng: Rng, tol = 1): number[] {
  const n = cxy.length
  if (maxPer <= 1 || n < 2) return cxy.map(() => 1)
  const base = Array.from({ length: n }, (_, i) => Math.round(maxPer - (i * (maxPer - 1)) / Math.max(1, n - 1)))
  const cost = (c: number[]) => neigh.reduce((sum, list, a) => sum + list.reduce((t, b) => t + Math.max(0, Math.abs(c[a] - c[b]) - tol) * 10 + Math.abs(c[a] - c[b]) * 0.01, 0), 0)
  let best = base.slice(), bestCost = Infinity
  for (let trial = 0; trial < 3000; trial++) {
    const c = base.slice()
    for (let i = n - 1; i > 0; i--) { const j = rng.int(0, i); [c[i], c[j]] = [c[j], c[i]] }
    const v = cost(c)
    if (v < bestCost) { bestCost = v; best = c; if (v < 0.5 && trial > 200) break }
  }
  void kingdomCount
  return best
}

export function placeTowns(world: World, rng: Rng, kingdomCount: number, playerTowns?: number): TownSpawn[] {
  const { w, h } = world
  const cd = coastDistance(world.land, w, h)
  const cellsWith = (minCoast: number) => { const out: number[] = []; for (let i = 0; i < w * h; i++) if (world.land[i] && cd[i] >= minCoast) out.push(i); return out }
  // Capitals via farthest-point sampling so they start well apart. Prefer inland cells, relaxing only if separation fails.
  const sample = (pool: number[]): number[] => {
    const picked: number[] = [rng.pick(pool)]
    while (picked.length < kingdomCount) {
      let best = -1, bestD = -1
      for (const c of pool) {
        const d = Math.min(...picked.map(k => dist2(c, k, w))) + hash2(c, 5, world.seed) * 0.5
        if (d > bestD) { bestD = d; best = c }
      }
      picked.push(best)
    }
    return picked
  }
  const minPair = (cs: number[]) => Math.min(...cs.flatMap((a, i) => cs.slice(i + 1).map(b => dist2(a, b, w))))
  let capitals: number[] = []
  for (const level of [4, 3, 2, 1]) {
    const pool = cellsWith(level)
    if (pool.length < kingdomCount) continue
    const cs = sample(pool)
    if (!capitals.length || minPair(cs) > minPair(capitals)) capitals = cs
    if (minPair(cs) >= MIN_TOWN_SEP + 1) break
  }
  for (let i = capitals.length - 1; i > 0; i--) { const j = rng.int(0, i); [capitals[i], capitals[j]] = [capitals[j], capitals[i]] }

  const spawns: TownSpawn[] = capitals.map((c, k) => ({ kingdom: k, cx: c % w, cy: (c / w) | 0 }))
  const ok = (cell: number, kingdom: number, sepOther: number, sepOwn: number) =>
    spawns.every(s => { const d = dist2(cell, s.cy * w + s.cx, w); return s.kingdom === kingdom ? d >= sepOwn : d >= sepOther })

  // Strength varies between kingdoms (some start bigger), but neighbours stay comparable: a smooth spatial field decides each
  // capital's town count and a relaxation pass keeps any two neighbouring kingdoms within one town of each other, so a big
  // kingdom always borders other big ones and a small one other small ones.
  let landCount = 0
  for (let i = 0; i < w * h; i++) landCount += world.land[i]
  const tol = kingdomCount >= 6 ? 2 : 1 // big 6–8 kingdom games allow big and medium neighbours to differ by two towns, never more
  const maxPer = Math.max(1, Math.min(maxStartTowns(kingdomCount), Math.floor(landCount / (kingdomCount * 110))))
  const ox = rng.next() * 100, oy = rng.next() * 100
  const cxy = capitals.map(c => ({ x: c % w, y: (c / w) | 0 }))
  // Strength is laid out geographically: a couple of "big" seeds (the more kingdoms, the more of them) and a couple of "small"
  // seeds far from them; every other capital interpolates by relative distance, so big powers cluster with big ones and small with
  // small, with medium kingdoms in between. (The relaxation pass below then only has to nudge neighbours to within one town.)
  const neigh: number[][] = cxy.map((p, a) => {
    const order = cxy.map((q, b) => ({ b, d: Math.hypot(p.x - q.x, p.y - q.y) })).filter(o => o.b !== a).sort((u, v) => u.d - v.d)
    return order.slice(0, 2).map(o => o.b)
  })
  const counts = assignCounts(cxy, neigh, maxPer, kingdomCount, rng, tol)
  if (playerTowns !== undefined) { // the player chose their strength: neighbours are balanced around it
    counts[0] = Math.max(1, Math.min(START.maxPlayerTowns, Math.round(playerTowns)))
    relaxCounts(counts, neigh, 0, tol)
  } else {
    relaxCounts(counts, neigh, -1, tol)
    counts[0] = Math.max(counts[0], Math.min(...counts.slice(1))) // the player is never the weakest on the island…
    relaxCounts(counts, neigh, -1, tol) // …unless that would make them out-sized next to a neighbour
  }
  for (let k = 0; k < kingdomCount; k++) {
    const want = counts[k] - 1
    const cap = capitals[k]
    for (let n = 0; n < want; n++) {
      const tiers: [number, number, number, number][] = [[3, MIN_TOWN_SEP + 3, MIN_OWN_SEP + 1, 14], [2, MIN_TOWN_SEP + 1, MIN_OWN_SEP, 18], [2, MIN_TOWN_SEP, MIN_OWN_SEP, 24], [1, MIN_TOWN_SEP, MIN_OWN_SEP, 30]]
      let placed = false
      for (const [minCoast, sepO, sepW, maxD] of tiers) {
        const own = spawns.filter(s => s.kingdom === k)
        const cands: number[] = []
        for (let i = 0; i < w * h; i++) {
          if (!world.land[i] || cd[i] < minCoast) continue
          if (dist2(i, cap, w) > maxD || !ok(i, k, sepO, sepW)) continue
          if (!own.some(s => dist2(i, s.cy * w + s.cx, w) <= 13)) continue
          cands.push(i)
        }
        if (cands.length) { const c = rng.pick(cands); spawns.push({ kingdom: k, cx: c % w, cy: (c / w) | 0 }); placed = true; break }
      }
      if (!placed) break
    }
  }
  // If a crowded island could not fit everyone's towns, trim kingdoms that ended up more than one town ahead of a neighbour.
  const actual = Array.from({ length: kingdomCount }, (_, k) => spawns.filter(t => t.kingdom === k).length)
  const target = actual.slice()
  relaxCounts(target, neigh, playerTowns !== undefined ? 0 : -1, tol)
  for (let k = 0; k < kingdomCount; k++) {
    let extra = actual[k] - target[k]
    for (let i = spawns.length - 1; i >= 0 && extra > 0; i--) if (spawns[i].kingdom === k) { spawns.splice(i, 1); extra-- }
  }
  for (let k = 1; k < kingdomCount; k++) { // a kingdom that starts with 4+ towns (never, with balanced starts) would get a barracks capital
    const own = spawns.filter(t => t.kingdom === k)
    if (own.length >= START.barracksMinTowns) own[0].barracks = true
  }
  return spawns
}

export function populateProps(world: World, rng: Rng, spawns: TownSpawn[]) {
  const { w, h, land } = world
  const cd = coastDistance(land, w, h)
  const nearTown = (cx: number, cy: number, r: number) => spawns.some(s => Math.max(Math.abs(s.cx - cx), Math.abs(s.cy - cy)) <= r)
  const taken = new Uint8Array(w * h)
  let treeId = 0, decorId = 0
  const addTree = (cx: number, cy: number, kind?: TreeKind) => {
    const i = cy * w + cx
    taken[i] = 1
    const k: TreeKind = kind ?? (rng.chance(0.55) ? (rng.int(0, 1) as TreeKind) : (rng.int(2, 3) as TreeKind))
    const t: Tree = { id: treeId++, kind: k, x: (cx + 0.5) * TILE + (rng.next() - 0.5) * 30, y: (cy + 0.62) * TILE + (rng.next() - 0.5) * 18, cell: i, phase: rng.next() * 8, chopped: false, progress: 0, claimedBy: -1 }
    world.trees.push(t)
  }
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const i = cy * w + cx
    if (!land[i] || cd[i] < 2 || nearTown(cx, cy, 3)) continue
    const forest = smoothNoise(cx / 5 + 40, cy / 5 + 40, world.seed + 31)
    const p = forest > 0.56 ? 0.5 : forest > 0.45 ? 0.1 : 0.015
    if (rng.chance(p)) addTree(cx, cy)
  }
  // Guarantee a few harvestable trees around every town (outside the exclusion ring).
  for (const s of spawns) {
    let have = world.trees.filter(t => Math.hypot((t.cell % w) - s.cx, ((t.cell / w) | 0) - s.cy) <= 9).length
    for (let tries = 0; have < 7 && tries < 120; tries++) {
      const a = rng.next() * Math.PI * 2, r = 4 + rng.next() * 5
      const cx = Math.round(s.cx + Math.cos(a) * r), cy = Math.round(s.cy + Math.sin(a) * r)
      if (!inBounds(w, h, cx, cy) || !land[cy * w + cx] || cd[cy * w + cx] < 2 || taken[cy * w + cx] || nearTown(cx, cy, 3)) continue
      addTree(cx, cy); have++
    }
  }
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const i = cy * w + cx
    if (!land[i] || taken[i] || nearTown(cx, cy, 2)) continue
    const isBush = rng.chance(0.045), isRock = !isBush && cd[i] >= 1 && rng.chance(0.02)
    if (!isBush && !isRock) continue
    taken[i] = 1
    world.decor.push({ id: decorId++, type: isBush ? 'bush' : 'rock', variant: rng.int(0, 3), x: (cx + 0.5) * TILE + (rng.next() - 0.5) * 24, y: (cy + 0.7) * TILE + (rng.next() - 0.5) * 12, cell: i, phase: rng.next() * 8 } as Decor)
  }
  world.trees.sort((a, b) => a.y - b.y)
  world.trees.forEach((t, i) => { t.id = i })
}

export function generateWorld(seedInput: string | number, kingdomCount: number, playerTowns?: number): Generated {
  const seed = typeof seedInput === 'number' ? seedInput >>> 0 : hashSeed(seedInput)
  const rng = makeRng(seed)
  const kcount = Math.max(2, Math.min(MAX_KINGDOMS, kingdomCount)), sc = islandScale(kcount)
  const iw = Math.round(rng.int(MAP.minSize, MAP.maxSize) * sc), ih = Math.round(rng.int(MAP.minSize, MAP.maxSize) * sc)
  const island = generateIsland(seed, iw, ih)
  // Embed the island in a larger grid of open ocean so the world feels expansive.
  const P = MAP.pad, w = iw + P * 2, h = ih + P * 2
  const land = new Uint8Array(w * h)
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) land[(y + P) * w + x + P] = island[y * iw + x]
  const world: World = { seed, w, h, land, trees: [], decor: [], island: { x: P, y: P, w: iw, h: ih } }
  const spawns = placeTowns(world, rng, kcount, playerTowns)
  populateProps(world, rng, spawns)
  return { world, spawns }
}

export const isEdgeConnected = (world: World) => countComponents(world.land, world.w, world.h) === 1


// ====================================================================================================================
// Archipelago: a MAP.size × MAP.size ocean with a few large land masses, several medium and small islands and chains of islets.
// ====================================================================================================================
export type Blueprint = { cx: number; cy: number; r: number; kind: 'large' | 'medium' | 'small' | 'islet'; aspect: number; rot: number; seed: number }

/** Where the islands go: big ones first, then smaller ones in the gaps, then curved chains of tiny islets between them. */
export function planIslands(rng: Rng, size: number): Blueprint[] {
  const out: Blueprint[] = []
  const free = (cx: number, cy: number, r: number, gap: number) => out.every(o => Math.hypot(o.cx - cx, o.cy - cy) >= (r + o.r) * (o.kind === 'islet' || gap < 1.2 ? gap : Math.max(gap, 1.3)) + 3)
  const add = (kind: Blueprint['kind'], lo: number, hi: number, gap: number, tries = 500): Blueprint | null => {
    for (let t = 0; t < tries; t++) {
      const r = lo + rng.next() * (hi - lo) * (1 - t / (tries * 1.6)) // shrink slowly when space is tight
      const m = r * 1.15 + 3
      if (size - 2 * m <= 1) continue
      const cx = m + rng.next() * (size - 2 * m), cy = m + rng.next() * (size - 2 * m)
      if (!free(cx, cy, r, gap)) continue
      const b: Blueprint = { cx, cy, r, kind, aspect: 0.8 + rng.next() * 0.45, rot: rng.next() * Math.PI, seed: rng.int(1, 1e9) }
      out.push(b); return b
    }
    return null
  }
  add('large', 40, 50, 1.3); add('large', 34, 44, 1.3)
  if (rng.chance(0.45)) add('large', 30, 38, 1.3)
  for (let i = 0, n = rng.int(3, 5); i < n; i++) add('medium', 16, 26, 1.25)
  for (let i = 0, n = rng.int(5, 8); i < n; i++) add('small', 8, 14, 1.2)
  // chains of islets (stepping stones): each starts in open water and bends gently
  for (let c = 0, chains = rng.int(4, 6); c < chains; c++) {
    let x = rng.next() * size, y = rng.next() * size, ang = rng.next() * Math.PI * 2, bend = (rng.next() - 0.5) * 0.5
    for (let i = 0, n = rng.int(6, 10); i < n; i++) {
      const r = 3.4 + rng.next() * 3.4
      if (x > r + 3 && y > r + 3 && x < size - r - 3 && y < size - r - 3 && free(x, y, r, 1.05)) out.push({ cx: x, cy: y, r, kind: 'islet', aspect: 0.8 + rng.next() * 0.5, rot: rng.next() * Math.PI, seed: rng.int(1, 1e9) })
      const step = 7 + rng.next() * 5
      ang += bend + (rng.next() - 0.5) * 0.5; x += Math.cos(ang) * step; y += Math.sin(ang) * step
    }
  }
  return out
}

/** The land mask for a set of blueprints: each island is a noise-warped, slightly stretched blob; their union is smoothed. */
export function landFromBlueprints(bps: Blueprint[], w: number, h: number, seed: number): Uint8Array {
  let m: Uint8Array = new Uint8Array(w * h)
  for (const b of bps) {
    const ox = hash2(1, 2, b.seed) * 100, oy = hash2(3, 4, b.seed) * 100
    const scale = 5.5 * Math.max(1, (2 * b.r) / 50), amp = b.kind === 'islet' ? 0.9 : 1.9 * Math.min(1, 0.5 + b.r / 40)
    const R = Math.ceil(b.r * 1.6) + 2, c = Math.cos(b.rot), sn = Math.sin(b.rot), warp = Math.min(9, b.r * 0.6)
    for (let y = Math.max(2, Math.floor(b.cy - R)); y <= Math.min(h - 3, Math.ceil(b.cy + R)); y++) for (let x = Math.max(2, Math.floor(b.cx - R)); x <= Math.min(w - 3, Math.ceil(b.cx + R)); x++) {
      const wx = x + (smoothNoise(x / 9 + ox, y / 9 + oy, b.seed + 3) - 0.5) * warp, wy = y + (smoothNoise(x / 9 - oy, y / 9 + ox, b.seed + 5) - 0.5) * warp
      const dx = x + 0.5 - b.cx, dy = y + 0.5 - b.cy
      const ux = (dx * c + dy * sn) / (b.r * b.aspect), uy = (-dx * sn + dy * c) / (b.r / b.aspect)
      const d = Math.hypot(ux, uy)
      const v = (1 - Math.pow(d, 2.1)) * 0.85 + (fbm(wx / scale + ox, wy / scale + oy, b.seed) - 0.5) * amp
      if (v + (b.kind === 'islet' ? 0.3 : 0) > 0.2) m[y * w + x] = 1
    }
    const ix = Math.round(b.cx), iy = Math.round(b.cy) // an island always has at least its centre
    if (ix > 1 && iy > 1 && ix < w - 2 && iy < h - 2) m[iy * w + ix] = 1
  }
  m = smoothMask(smoothMask(m, w, h), w, h)
  fillSmallLakes(m, w, h, 6)
  fixDiagonals(m, w, h, seed)
  removeSpurs(m, w, h)
  fixDiagonals(m, w, h, seed + 1)
  // drop specks (islets need a handful of tiles to be worth a coast)
  const seen = new Uint8Array(w * h)
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || seen[s]) continue
    const cells = [s]; seen[s] = 1
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k], x = i % w, y = (i / w) | 0
      for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (!inBounds(w, h, nx, ny)) continue; const j = ny * w + nx; if (m[j] && !seen[j]) { seen[j] = 1; cells.push(j) } }
    }
    if (cells.length < 5) for (const i of cells) m[i] = 0
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) m[y * w + x] = 0
  return m
}

/** How many kingdoms each landmass hosts (largest-remainder by area; every sizeable island gets one, tiny ones none). */
export function allocateKingdoms(sizes: number[], kingdoms: number): number[] {
  const MIN_HOST = 260, ONE_PER = 330, OWN_ISLAND = 550
  const q = sizes.map(() => 0)
  const eligible = sizes.map((n, i) => ({ n, i })).filter(e => e.n >= MIN_HOST).sort((a, b) => b.n - a.n)
  if (!eligible.length) { const best = sizes.indexOf(Math.max(...sizes)); q[best] = kingdoms; return q }
  const total = eligible.reduce((n, e) => n + e.n, 0)
  const cap = (n: number) => Math.max(1, Math.floor(n / ONE_PER))
  let left = kingdoms
  // every island of a couple of kingdoms' worth keeps one kingdom for itself (while at least 40 % of the kingdoms are left for the big land masses); the rest is shared out by area
  for (const e of eligible) if (e.n >= OWN_ISLAND && left > Math.ceil(kingdoms * 0.4)) { q[e.i] = 1; left-- }
  const share = eligible.map(e => ({ ...e, want: (kingdoms * e.n) / total })).sort((a, b) => (b.want - Math.floor(b.want)) - (a.want - Math.floor(a.want)))
  for (const e of eligible) { const add = Math.min(left, Math.max(0, Math.floor((kingdoms * e.n) / total) - q[e.i]), cap(e.n) - q[e.i]); q[e.i] += add; left -= add }
  for (let pass = 0; left > 0 && pass < 50; pass++) for (const e of share) { if (left > 0 && q[e.i] < cap(e.n)) { q[e.i]++; left-- } }
  for (let pass = 0; left > 0 && pass < 50; pass++) for (const e of eligible) { if (left > 0) { q[e.i]++; left-- } } // every island full: squeeze the surplus in
  return q
}

export type ArchipelagoOptions = { playerTowns?: number; kingdoms?: number }

export function generateArchipelago(seedInput: string | number, kingdomCount?: number, playerTowns?: number): Generated {
  const seed = typeof seedInput === 'number' ? seedInput >>> 0 : hashSeed(seedInput)
  const kcount = Math.max(2, Math.min(MAX_KINGDOMS, kingdomCount ?? kingdomsForSeed(seed)))
  const size = MAP.size
  let world: World | null = null
  for (let attempt = 0; attempt < 12 && !world; attempt++) {
    const rng = makeRng(seed + attempt * 7919)
    const bps = planIslands(rng, size)
    const land = landFromBlueprints(bps, size, size, seed + attempt)
    let total = 0
    for (let i = 0; i < land.length; i++) total += land[i]
    const w0: World = { seed, w: size, h: size, land, trees: [], decor: [], island: { x: 0, y: 0, w: size, h: size } }
    const sizes = worldInfo(w0).sizes
    const big = sizes.filter(n => n >= 3500).length
    if (total / (size * size) >= 0.26 && big >= 1 && sizes.filter(n => n >= 260).length >= Math.min(6, kcount)) world = w0
    else if (attempt === 11) world = w0
  }
  const w0 = world!
  const info = worldInfo(w0)
  // the "main island" box is that of the largest land mass (kept for callers that want a single bounding box)
  const main = info.sizes.indexOf(Math.max(...info.sizes))
  let x0 = size, y0 = size, x1 = 0, y1 = 0
  for (let i = 0; i < w0.land.length; i++) if (info.landmass[i] === main) { const x = i % size, y = (i / size) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  w0.island = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  const rng = makeRng(seed ^ 0x51ed270b)
  const spawns = placeArchipelagoTowns(w0, rng, kcount, playerTowns)
  populateProps(w0, rng, spawns)
  return { world: w0, spawns }
}

/** Capitals and starting towns for every kingdom, island by island (kingdom 0, the player, lands on a random capital anywhere). */
export function placeArchipelagoTowns(world: World, rng: Rng, kingdomCount: number, playerTowns?: number): TownSpawn[] {
  const { w, h } = world
  const info = worldInfo(world)
  const cd = coastDistance(world.land, w, h)
  const quota = allocateKingdoms(info.sizes, kingdomCount)
  // capitals per island: farthest-point sampling over inland cells
  type Cap = { island: number; cell: number }
  const caps: Cap[] = []
  for (let isl = 0; isl < quota.length; isl++) {
    const q = quota[isl]
    if (!q) continue
    const cellsOf = (minCoast: number) => { const out: number[] = []; for (let i = 0; i < w * h; i++) if (info.landmass[i] === isl && cd[i] >= minCoast) out.push(i); return out }
    let best: number[] = []
    for (const level of [4, 3, 2, 1]) {
      const pool = cellsOf(level)
      if (pool.length < q) continue
      const picked = [rng.pick(pool)]
      while (picked.length < q) {
        let bc = -1, bd = -1
        for (const c of pool) { const d = Math.min(...picked.map(k => dist2(c, k, w))) + hash2(c, 5, world.seed) * 0.5; if (d > bd) { bd = d; bc = c } }
        picked.push(bc)
      }
      const minPair = (cs: number[]) => (cs.length < 2 ? Infinity : Math.min(...cs.flatMap((a, i) => cs.slice(i + 1).map(b => dist2(a, b, w)))))
      if (!best.length || minPair(picked) > minPair(best)) best = picked
      if (minPair(picked) >= MIN_TOWN_SEP + 1) break
    }
    if (!best.length) { const pool = cellsOf(0); best = pool.length >= q ? pool.slice(0, q) : pool } // a sliver of an island: whatever fits
    for (const c of best) caps.push({ island: isl, cell: c })
  }
  const K = caps.length
  const playerIdx = rng.int(0, K - 1)
  const spawnsByCap: { cap: number; cx: number; cy: number }[] = caps.map((c, i) => ({ cap: i, cx: c.cell % w, cy: (c.cell / w) | 0 }))
  const all = spawnsByCap.slice() // capitals first; extra towns are appended below, tagged with the capital index
  const ok = (cell: number, capIdx: number, sepOther: number, sepOwn: number) =>
    all.every(s => { const d = dist2(cell, s.cy * w + s.cx, w); return s.cap === capIdx ? d >= sepOwn : d >= sepOther })
  for (let isl = 0; isl < quota.length; isl++) {
    const mine = caps.map((c, i) => ({ c, i })).filter(e => e.c.island === isl)
    if (!mine.length) continue
    const cxy = mine.map(e => ({ x: e.c.cell % w, y: (e.c.cell / w) | 0 }))
    const neigh: number[][] = cxy.map((p, a) => cxy.map((q, b) => ({ b, d: Math.hypot(p.x - q.x, p.y - q.y) })).filter(o => o.b !== a).sort((u, v) => u.d - v.d).slice(0, 2).map(o => o.b))
    const maxPer = Math.max(1, Math.min(START.maxStartTowns, Math.floor(info.sizes[isl] / (mine.length * 110))))
    const tol = mine.length >= 6 ? 2 : 1
    let counts: number[]
    if (mine.length === 1) counts = [rng.int(Math.max(1, Math.ceil(maxPer * 0.6)), maxPer)]
    else counts = assignCounts(cxy, neigh, maxPer, mine.length, rng, tol)
    const pLocal = mine.findIndex(e => e.i === playerIdx)
    if (pLocal >= 0 && playerTowns !== undefined) {
      counts[pLocal] = Math.max(1, Math.min(START.maxPlayerTowns, Math.round(playerTowns)))
      if (mine.length > 1) relaxCounts(counts, neigh, pLocal, tol)
    } else if (mine.length > 1) relaxCounts(counts, neigh, -1, tol)
    if (pLocal >= 0 && playerTowns === undefined && mine.length > 1) { counts[pLocal] = Math.max(counts[pLocal], Math.min(...counts.filter((_, j) => j !== pLocal))); relaxCounts(counts, neigh, -1, tol) }
    mine.forEach((e, a) => {
      const cap = e.c.cell
      for (let n = 0; n < counts[a] - 1; n++) {
        const tiers: [number, number, number, number][] = [[3, MIN_TOWN_SEP + 3, MIN_OWN_SEP + 1, 14], [2, MIN_TOWN_SEP + 1, MIN_OWN_SEP, 18], [2, MIN_TOWN_SEP, MIN_OWN_SEP, 24], [1, MIN_TOWN_SEP, MIN_OWN_SEP, 30]]
        let placed = false
        for (const [minCoast, sepO, sepW, maxD] of tiers) {
          const own = all.filter(s => s.cap === e.i)
          const cands: number[] = []
          const r0 = Math.max(0, Math.floor((cap / w | 0) - maxD)), r1 = Math.min(h - 1, Math.ceil((cap / w | 0) + maxD)), c0 = Math.max(0, (cap % w) - maxD), c1 = Math.min(w - 1, (cap % w) + maxD)
          for (let yy = r0; yy <= r1; yy++) for (let xx = c0; xx <= c1; xx++) {
            const i = yy * w + xx
            if (info.landmass[i] !== isl || cd[i] < minCoast || dist2(i, cap, w) > maxD || !ok(i, e.i, sepO, sepW)) continue
            if (!own.some(s => dist2(i, s.cy * w + s.cx, w) <= 13)) continue
            cands.push(i)
          }
          if (cands.length) { const c = rng.pick(cands); all.push({ cap: e.i, cx: c % w, cy: (c / w) | 0 }); placed = true; break }
        }
        if (!placed) break
      }
    })
  }
  // kingdom ids: the player (0) is the capital chosen above; everyone else is shuffled
  const order = caps.map((_, i) => i).filter(i => i !== playerIdx)
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(0, i); [order[i], order[j]] = [order[j], order[i]] }
  const kingdomOf = new Map<number, number>([[playerIdx, 0]])
  order.forEach((c, i) => kingdomOf.set(c, i + 1))
  const spawns: TownSpawn[] = all.map(s => ({ kingdom: kingdomOf.get(s.cap)!, cx: s.cx, cy: s.cy }))
  spawns.sort((a, b) => a.kingdom - b.kingdom) // capitals keep their place at the head of each kingdom's list (stable sort)
  for (let k = 1; k < K; k++) { const own = spawns.filter(t => t.kingdom === k); if (own.length >= START.barracksMinTowns) own[0].barracks = true }
  void DEFAULT_KINGDOMS; void maxStartTowns; void islandScale
  return spawns
}
