import { ROUTE, TILE } from './config'
import { bfsPath } from './Grid'

/** Flat [x0,y0,x1,y1,...] helpers — routes are kept flat to avoid per-point objects. */

function perpDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Ramer–Douglas–Peucker on a flat polyline. Keeps sharp tactical turns larger than `tol`. */
export function simplifyRoute(pts: number[], tol = ROUTE.rdpTolerance): number[] {
  const n = pts.length / 2
  if (n <= 2) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = 0, idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i * 2], pts[i * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (idx >= 0 && maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}

/** Append a pointer sample only when it is far enough from the previous one. Returns true if added. */
export function sampleDraft(draft: number[], x: number, y: number, minDist = ROUTE.sampleDist): boolean {
  const n = draft.length
  if (n >= 2 && Math.hypot(x - draft[n - 2], y - draft[n - 1]) < minDist) return false
  draft.push(x, y)
  return true
}

export type Walkable = {
  /** Point test in world coordinates. */
  at(x: number, y: number): boolean
  /** Cell test used for local detours. */
  cell(i: number): boolean
  w: number
  h: number
}

/** Line-of-sight test sampled every few pixels. */
export function clearLine(ok: Walkable, x0: number, y0: number, x1: number, y1: number): boolean {
  const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(len / 8))
  for (let i = 1; i <= steps; i++) { const t = i / steps; if (!ok.at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false }
  return true
}

const cellOf = (ok: Walkable, x: number, y: number) => { const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE); return cx < 0 || cy < 0 || cx >= ok.w || cy >= ok.h ? -1 : cy * ok.w + cx }

/** Route from (x0,y0) to (x1,y1) over walkable cells: direct if clear, else a BFS cell path string-pulled into few points. */
export function pathBetween(ok: Walkable, x0: number, y0: number, x1: number, y1: number): number[] | null {
  if (clearLine(ok, x0, y0, x1, y1)) return [x1, y1]
  const a = cellOf(ok, x0, y0), b = cellOf(ok, x1, y1)
  if (a < 0 || b < 0) return null
  const cells = bfsPath(ok.w, ok.h, a, b, ok.cell)
  if (!cells) return null
  const pts: number[] = []
  for (let k = 1; k < cells.length; k++) pts.push((cells[k] % ok.w + 0.5) * TILE, (Math.floor(cells[k] / ok.w) + 0.5) * TILE)
  pts[pts.length - 2] = x1; pts[pts.length - 1] = y1
  // string pulling
  const out: number[] = []
  let cx = x0, cy = y0, i = 0
  const n = pts.length / 2
  while (i < n) {
    let far = i
    for (let j = n - 1; j >= i; j--) if (clearLine(ok, cx, cy, pts[j * 2], pts[j * 2 + 1])) { far = j; break }
    out.push(pts[far * 2], pts[far * 2 + 1]); cx = pts[far * 2]; cy = pts[far * 2 + 1]; i = far + 1
  }
  return out
}

/**
 * Clip a drawn polyline to walkable ground. Water sections are detoured locally when the polyline re-enters walkable
 * ground nearby, otherwise the route ends at the last valid point.
 */
export function clipRoute(ok: Walkable, startX: number, startY: number, pts: number[]): number[] {
  const out: number[] = []
  let cx = startX, cy = startY
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const tx = pts[i * 2], ty = pts[i * 2 + 1]
    if (ok.at(tx, ty) && clearLine(ok, cx, cy, tx, ty)) { out.push(tx, ty); cx = tx; cy = ty; continue }
    if (ok.at(tx, ty)) { // reachable only around an obstacle: local detour
      const d = pathBetween(ok, cx, cy, tx, ty)
      if (d && d.length / 2 <= 10) { for (let k = 0; k < d.length; k += 2) out.push(d[k], d[k + 1]); cx = tx; cy = ty; continue }
      break
    }
    // target is on water: slide to the last walkable sample along the segment, then look for the next walkable point
    const len = Math.hypot(tx - cx, ty - cy), steps = Math.max(1, Math.ceil(len / ROUTE.step))
    let lx = cx, ly = cy
    for (let s = 1; s <= steps; s++) { const t = s / steps, px = cx + (tx - cx) * t, py = cy + (ty - cy) * t; if (!ok.at(px, py)) break; lx = px; ly = py }
    if (lx !== cx || ly !== cy) { out.push(lx, ly); cx = lx; cy = ly }
    let resumed = false
    for (let j = i + 1; j < n && j < i + 6; j++) {
      if (!ok.at(pts[j * 2], pts[j * 2 + 1])) continue
      const d = pathBetween(ok, cx, cy, pts[j * 2], pts[j * 2 + 1])
      if (d && d.length / 2 <= 10) { for (let k = 0; k < d.length; k += 2) out.push(d[k], d[k + 1]); cx = pts[j * 2]; cy = pts[j * 2 + 1]; i = j; resumed = true }
      break
    }
    if (!resumed) break
  }
  return out
}

/** One Chaikin pass that skips sharp corners and any cut that would leave walkable ground. */
export function smoothRoute(ok: Walkable, sx: number, sy: number, pts: number[], sharpDeg = 70): number[] {
  const n = pts.length / 2
  if (n < 2) return pts.slice()
  const P = (i: number): [number, number] => (i < 0 ? [sx, sy] : [pts[i * 2], pts[i * 2 + 1]])
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const [px, py] = P(i - 1), [cx, cy] = P(i)
    if (i === n - 1) { out.push(cx, cy); break }
    const [nx, ny] = P(i + 1)
    const a1 = Math.atan2(cy - py, cx - px), a2 = Math.atan2(ny - cy, nx - cx)
    let turn = Math.abs(a2 - a1) * 180 / Math.PI; if (turn > 180) turn = 360 - turn
    if (turn > sharpDeg) { out.push(cx, cy); continue }
    const bx = cx + (px - cx) * 0.25, by = cy + (py - cy) * 0.25, ax = cx + (nx - cx) * 0.25, ay = cy + (ny - cy) * 0.25
    if (ok.at(bx, by) && ok.at(ax, ay) && clearLine(ok, bx, by, ax, ay)) out.push(bx, by, ax, ay)
    else out.push(cx, cy)
  }
  return out
}

/** Full commit pipeline for a raw dragged route. */
export function buildRoute(ok: Walkable, startX: number, startY: number, raw: number[]): number[] {
  if (raw.length < 4) return raw.length === 2 && ok.at(raw[0], raw[1]) ? clipRoute(ok, startX, startY, raw) : []
  const simplified = simplifyRoute([startX, startY, ...raw])
  const clipped = clipRoute(ok, startX, startY, simplified.slice(2))
  return smoothRoute(ok, startX, startY, clipped)
}
