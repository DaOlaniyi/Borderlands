import { hash2, makeRng } from './rng'

/**
 * "Dynamic" island shapes. The classic generator makes every island one noise-warped, slightly stretched blob; here an island can instead be a
 * flooded caldera ring around a lagoon (Deception Island), a crescent bent round a bay with sea stacks off its horns, a branching ridge continent
 * with peninsulas, or a dumbbell of two lobes joined by a narrow isthmus. The rest are still blobs, but with fjords, bites out of the coast and
 * skerries (tiny rocks) around them. Everything is derived from the island's own seed (the planner's rng stream is untouched), and every shape keeps
 * channels and bodies wide enough for ships and towns: at least 4 tiles of water at a lagoon mouth, at least ~4 tiles of land everywhere.
 */
export type Shape = 'blob' | 'ring' | 'arc' | 'spine' | 'dumbbell'
export type BP = { cx: number; cy: number; r: number; kind: 'large' | 'medium' | 'small' | 'islet'; aspect: number; rot: number; seed: number }

/** Share of the large/medium/small islands that get a special shape (the rest are improved ordinary islands): about 40 % of all islands overall, mostly the big ones. */
export const SPECIAL_SHARE = { large: 0.8, medium: 0.55, small: 0.3 }
const WEIGHTS: Record<'large' | 'medium' | 'small', [Shape, number][]> = {
  large: [['spine', 0.35], ['dumbbell', 0.2], ['arc', 0.25], ['ring', 0.2]],
  medium: [['ring', 0.3], ['arc', 0.3], ['spine', 0.2], ['dumbbell', 0.2]],
  small: [['ring', 0.4], ['arc', 0.35], ['dumbbell', 0.25]],
}

export function shapeFor(b: Pick<BP, 'kind' | 'seed'>): Shape {
  if (b.kind === 'islet' || hash2(b.seed, 7, 99) >= SPECIAL_SHARE[b.kind]) return 'blob'
  let pick = hash2(b.seed, 11, 98)
  for (const [s, w] of WEIGHTS[b.kind]) { if (pick < w) return s; pick -= w }
  return 'blob'
}

function smoothNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
const fbm = (x: number, y: number, seed: number) => smoothNoise(x, y, seed) * 0.55 + smoothNoise(x * 2.1, y * 2.1, seed + 7) * 0.3 + smoothNoise(x * 4.3, y * 4.3, seed + 13) * 0.15
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

type Seg = { x0: number; y0: number; x1: number; y1: number; h0: number; h1: number }
export type Stamp = {
  shape: Shape
  /** How far (tiles) from the island's centre the shape can reach: the loop bound. */
  reach: number
  /** Land where this is above 0.2 (the same scale the classic blobs use). */
  value: (x: number, y: number) => number
  /** Channels to clear after smoothing (absolute tile coordinates), so a lagoon always opens to the sea. */
  channels: { x0: number; y0: number; x1: number; y1: number; half: number }[]
  /** Tiny rocks added around or inside the island: absolute tile coordinates and radius. */
  rocks: { x: number; y: number; r: number }[]
}

/** Everything needed to evaluate one island's shape: built once per blueprint. */
export function makeStamp(b0: BP, force?: Shape): Stamp {
  const shape = force ?? shapeFor(b0)
  // the shapes cover less ground than a filled blob of the same radius, so they are drawn a little larger (the world keeps the land the classic one has)
  const boost = shape === 'blob' ? 1.04 : b0.kind === 'large' ? 1.22 : b0.kind === 'medium' ? 1.14 : 1.08
  const b: BP = { ...b0, r: b0.r * boost }
  const rng = makeRng(b.seed ^ 0x9e3779b1)
  const ox = hash2(1, 2, b.seed) * 100, oy = hash2(3, 4, b.seed) * 100
  const c = Math.cos(b.rot), sn = Math.sin(b.rot)
  const warp = Math.min(8, b.r * 0.5), scale = 5.5 * Math.max(1, (2 * b.r) / 50)
  const local = (x: number, y: number) => { const dx = x + 0.5 - b.cx, dy = y + 0.5 - b.cy; return [dx * c + dy * sn, -dx * sn + dy * c] as const }
  const toAbs = (ux: number, uy: number) => [b.cx + ux * c - uy * sn, b.cy + ux * sn + uy * c] as const
  const noise = (x: number, y: number, k = 1) => {
    const wx = x + (smoothNoise(x / 9 + ox, y / 9 + oy, b.seed + 3) - 0.5) * warp, wy = y + (smoothNoise(x / 9 - oy, y / 9 + ox, b.seed + 5) - 0.5) * warp
    return (fbm(wx / scale + ox, wy / scale + oy, b.seed) - 0.5) * k
  }
  // natural irregularity: a periodic noise around the island's angle (so a ring's radius and thickness wander), and fine roughness for a jagged coast
  const radial = (th: number, k: number, salt: number) => smoothNoise(Math.cos(th) * k + ox + salt, Math.sin(th) * k + oy - salt, b.seed + 41 + salt) - 0.5
  const fr = Math.max(0.4, Math.min(1, b.r / 28)) // (small islands keep a calmer shore: the roughness is sized for big ones)
  const rough = (x: number, y: number) => ((smoothNoise(x / 2.3 + oy, y / 2.3 + ox, b.seed + 61) - 0.5) * 0.7 + (smoothNoise(x / 1.1 + ox, y / 1.1 - oy, b.seed + 67) - 0.5) * 0.3) * fr
  const channels: Stamp['channels'] = [], rocks: Stamp['rocks'] = []
  const ring = (rad: number, n: number, lo: number, hi: number) => { for (let i = 0; i < n; i++) { const a = rng.next() * Math.PI * 2, d = rad * (lo + rng.next() * (hi - lo)), [ax, ay] = toAbs(Math.cos(a) * d, Math.sin(a) * d); rocks.push({ x: ax, y: ay, r: 1.5 + rng.next() * 1.3 }) } }

  if (shape === 'ring') {
    const rho0 = 0.72 + (rng.next() - 0.5) * 0.08, T = 0.34, asp = Math.max(0.85, Math.min(1.18, b.aspect))
    const gaps: { a: number; w: number }[] = []
    const nGaps = rng.chance(0.3) && b.r >= 16 ? 2 : 1, a0 = rng.next() * Math.PI * 2
    for (let i = 0; i < nGaps; i++) { const w = Math.max(0.14, Math.asin(Math.min(1, (i ? 1.9 : 2.1) / (rho0 * b.r)))); gaps.push({ a: a0 + i * (2.2 + rng.next() * 1.2), w }) } // (a mouth at least ~5 tiles across)
    for (const g of gaps) { const [x0, y0] = toAbs(Math.cos(g.a) * rho0 * b.r * 0.55, Math.sin(g.a) * rho0 * b.r * 0.55), [x1, y1] = toAbs(Math.cos(g.a) * b.r * 1.5, Math.sin(g.a) * b.r * 1.5); channels.push({ x0, y0, x1, y1, half: 1.9 + 0.05 * Math.max(0, b.r - 14) }) }
    if (rng.chance(0.3) && b.r >= 14) { const [ax, ay] = toAbs((rng.next() - 0.5) * 0.2 * b.r, (rng.next() - 0.5) * 0.2 * b.r); rocks.push({ x: ax, y: ay, r: 2.4 + rng.next() * 1.4 }) } // a little island in the lagoon
    ring(b.r, rng.int(0, 2), 1.05, 1.3)
    return {
      shape, reach: b.r * 1.5 + 4, channels, rocks,
      value: (x, y) => {
        const [ux, uy] = local(x, y), th = Math.atan2(uy, ux), rho = Math.hypot(ux / (b.r * asp), uy * asp / b.r)
        const rr = rho0 * (1 + 0.55 * radial(th, 1.5, 0)), TT = T * (1 + 1.0 * radial(th, 2.2, 5)) // (the ring's radius and its thickness both wander round the circle)
        let p = 1 - Math.pow((rho - rr) / Math.max(0.12, TT), 2)
        for (const g of gaps) { let d = Math.abs(th - g.a) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d; d += 0.5 * g.w * rough(x * 1.7, y * 1.7); p -= 2.4 * (1 - smoothstep(g.w * 0.75, g.w, d)) } // (a jagged mouth)
        return p * 0.85 + noise(x, y, 0.75 * (0.6 + 0.4 * fr)) + rough(x, y)
      },
    }
  }

  if (shape === 'arc') { // a crescent bent round a bay: thick in the middle, tapering to uneven horns, with headlands and a wandering shore
    const Rr = 0.64 * b.r, span = (150 + rng.next() * 95) * Math.PI / 180, skew = (rng.next() - 0.5) * 0.7
    const t0 = -span / 2 + skew, hwMax = Math.max(3.8, 0.33 * b.r), nPhase = rng.next() * 10, gam = 0.7 + rng.next() * 0.8
    const hwAt = (t: number) => Math.max(2.9, hwMax * (0.22 + 0.78 * Math.pow(Math.sin(Math.PI * Math.pow(t, gam)), 0.8)) * (0.6 + 0.9 * smoothNoise(t * 4 + nPhase, 0.5, b.seed + 21)))
    const lumps: { x: number; y: number; r: number }[] = [] // headlands bulging off the arc
    for (let i = 0, n = 1 + rng.int(0, 2); i < n; i++) { const t = 0.2 + rng.next() * 0.6, th = t0 + t * span, out = rng.chance(0.6) ? 1 : -1, rl = Math.max(3.2, hwMax * (0.5 + rng.next() * 0.35)); lumps.push({ x: -Math.cos(th) * (Rr + out * hwMax * 0.7), y: Math.sin(th) * (Rr + out * hwMax * 0.7), r: rl }) }
    for (let i = 0, n = 3 + rng.int(0, 3); i < n; i++) { const a = Math.PI + (rng.next() - 0.5) * 1.7, d = (0.15 + rng.next() * 0.45) * b.r; const [ax, ay] = toAbs(Math.cos(a) * d * -1, Math.sin(a) * d); rocks.push({ x: ax, y: ay, r: 1.7 + rng.next() * 1.4 }) } // sea stacks in the bay
    ring(b.r, rng.int(0, 2), 1.05, 1.25)
    return {
      shape, reach: b.r * 1.35 + hwMax + 6, channels, rocks,
      value: (x, y) => {
        const [ux, uy] = local(x, y), th = Math.atan2(uy, -ux) // angle measured so the arc is centred on theta = 0
        const rad = Math.hypot(ux, uy), Rw = Rr * (1 + 0.5 * radial(th, 1.3, 9)) // (the arc's radius wanders)
        let d: number, t: number
        if (th >= t0 && th <= t0 + span) { d = Math.abs(rad - Rw); t = (th - t0) / span } else {
          const e = th > t0 + span ? t0 + span : t0, ex = -Math.cos(e) * Rw, ey = Math.sin(e) * Rw
          d = Math.hypot(ux - ex, uy - ey); t = th > t0 + span ? 1 : 0
        }
        let p = 1 - Math.pow(d / hwAt(Math.max(0, Math.min(1, t))), 2)
        for (const l of lumps) p = Math.max(p, 1 - Math.pow(Math.hypot(ux - l.x, uy - l.y) / l.r, 2))
        return p * 0.85 + noise(x, y, 0.75 * (0.6 + 0.4 * fr)) + rough(x, y)
      },
    }
  }

  if (shape === 'spine') { // a continent: a central body with curved limbs of tapering width (peninsulas), bays between them
    const segs: Seg[] = []
    const hub = Math.max(5, 0.44 * b.r), nLimbs = 4 + rng.int(0, 1), a0 = rng.next() * Math.PI * 2
    segs.push({ x0: 0, y0: 0, x1: 0, y1: 0, h0: hub, h1: hub })
    let far = hub
    for (let i = 0; i < nLimbs; i++) {
      let a = a0 + (i / nLimbs) * Math.PI * 2 + (rng.next() - 0.5) * 0.7
      const steps = 3 + rng.int(0, 1), reachLimb = (0.5 + rng.next() * 0.4) * b.r, step = reachLimb / steps
      let x = Math.cos(a) * hub * 0.6, y = Math.sin(a) * hub * 0.6, h = Math.max(3.6, hub * (0.7 + rng.next() * 0.3))
      for (let k = 0; k < steps; k++) {
        a += (rng.next() - 0.5) * 0.9
        const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step, nh = Math.max(3, h * (0.86 - 0.04 * k))
        segs.push({ x0: x, y0: y, x1: nx, y1: ny, h0: h, h1: nh }); x = nx; y = ny; h = nh
        if (k === 1 && rng.chance(0.5)) { // a side peninsula
          const sa = a + (rng.chance(0.5) ? 1 : -1) * (0.8 + rng.next() * 0.6), sl = step * (0.8 + rng.next() * 0.7)
          segs.push({ x0: x, y0: y, x1: x + Math.cos(sa) * sl, y1: y + Math.sin(sa) * sl, h0: Math.max(3, h * 0.85), h1: 3 })
          far = Math.max(far, Math.hypot(x + Math.cos(sa) * sl, y + Math.sin(sa) * sl) + 3)
        }
      }
      far = Math.max(far, Math.hypot(x, y) + h)
    }
    ring(b.r, rng.int(0, 3), 0.95, 1.3)
    return {
      shape, reach: Math.max(far, b.r) + 4, channels, rocks,
      value: (x, y) => {
        const [ux, uy] = local(x, y)
        let best = -1
        for (const s of segs) {
          const ex = s.x1 - s.x0, ey = s.y1 - s.y0, l2 = ex * ex + ey * ey
          const u = l2 > 0 ? Math.max(0, Math.min(1, ((ux - s.x0) * ex + (uy - s.y0) * ey) / l2)) : 0
          const d = Math.hypot(ux - (s.x0 + ex * u), uy - (s.y0 + ey * u)), hw = s.h0 + (s.h1 - s.h0) * u
          const p = 1 - Math.pow(d / hw, 2)
          if (p > best) best = p
        }
        return best * 0.85 + noise(x, y, 0.8) + rough(x, y) * 0.8
      },
    }
  }

  if (shape === 'dumbbell') { // a ridge continent: a wandering spine with branches (peninsulas); the dumbbell pinches it to a thin isthmus
    const dumb = shape === 'dumbbell', N = dumb ? 9 : 7 + rng.int(0, 2), len = (dumb ? 1.8 : 1.65) * b.r
    const segs: Seg[] = []
    let hd = dumb ? (rng.next() - 0.5) * 0.5 : (rng.next() - 0.5) * 1.2
    let x = -len / 2, y = (rng.next() - 0.5) * b.r * 0.3
    const pts: { x: number; y: number; h: number }[] = []
    const hwBase = Math.max(3.6, 0.28 * b.r), phase = rng.next() * 10
    const bulb = [rng.next() * 0.6 + 0.2, rng.next() * 0.6 + 0.2]
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      let m = 0.7 + 0.7 * smoothNoise(t * 3 + phase, 0.5, b.seed + 31)
      if (dumb) m = 1.55 * (1 - 0.7 * Math.exp(-Math.pow((t - 0.5) / 0.14, 2))) * (0.9 + 0.2 * smoothNoise(t * 4 + phase, 0.5, b.seed + 33)) // two big lobes, a narrow neck between them
      else { m *= 1 + 0.55 * Math.exp(-Math.pow((t - bulb[0]) / 0.16, 2)) + 0.35 * Math.exp(-Math.pow((t - bulb[1]) / 0.12, 2)) }
      m *= 0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)) ** 0.6 // tapering at both ends
      pts.push({ x, y, h: Math.max(dumb && Math.abs(t - 0.5) < 0.12 ? 2.4 : 2.6, hwBase * m) })
      hd += (rng.next() - 0.5) * (dumb ? 0.3 : 0.9)
      x += Math.cos(hd) * (len / (N - 1)); y += Math.sin(hd) * (len / (N - 1))
    }
    for (let i = 0; i + 1 < pts.length; i++) segs.push({ x0: pts[i].x, y0: pts[i].y, x1: pts[i + 1].x, y1: pts[i + 1].y, h0: pts[i].h, h1: pts[i + 1].h })
    const nBr = dumb ? rng.int(0, 1) : 2 + rng.int(0, 2)
    for (let k = 0; k < nBr; k++) { // peninsulas: short side spines from the middle nodes
      const i = 1 + rng.int(0, N - 3), p = pts[i], side = rng.chance(0.5) ? 1 : -1
      let bx = p.x, by = p.y, ba = Math.atan2(pts[i + 1].y - pts[i - 1].y, pts[i + 1].x - pts[i - 1].x) + side * (0.7 + rng.next() * 0.7), h = p.h * 0.75
      const steps = 2 + rng.int(0, 1), step = (0.3 + rng.next() * 0.3) * b.r / steps
      for (let s = 0; s < steps; s++) {
        const nx = bx + Math.cos(ba) * step, ny = by + Math.sin(ba) * step, nh = Math.max(2.4, h * 0.78)
        segs.push({ x0: bx, y0: by, x1: nx, y1: ny, h0: h, h1: nh }); bx = nx; by = ny; h = nh; ba += (rng.next() - 0.5) * 0.6
      }
    }
    // centre the whole spine on the blueprint's centre
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9
    for (const s of segs) for (const [px, py] of [[s.x0, s.y0], [s.x1, s.y1]]) { mnx = Math.min(mnx, px); mxx = Math.max(mxx, px); mny = Math.min(mny, py); mxy = Math.max(mxy, py) }
    const sx = (mnx + mxx) / 2, sy = (mny + mxy) / 2
    for (const s of segs) { s.x0 -= sx; s.x1 -= sx; s.y0 -= sy; s.y1 -= sy }
    ring(b.r, rng.int(0, 2), 0.95, 1.25)
    const reach = Math.max(Math.abs(mxx - mnx), Math.abs(mxy - mny)) / 2 + hwBase * 1.8 + 4
    return {
      shape, reach: Math.max(reach, b.r * 1.2), channels, rocks,
      value: (x, y) => {
        const [ux, uy] = local(x, y)
        let best = -1
        for (const s of segs) {
          const ex = s.x1 - s.x0, ey = s.y1 - s.y0, l2 = ex * ex + ey * ey
          const u = l2 > 0 ? Math.max(0, Math.min(1, ((ux - s.x0) * ex + (uy - s.y0) * ey) / l2)) : 0
          const d = Math.hypot(ux - (s.x0 + ex * u), uy - (s.y0 + ey * u)), hw = s.h0 + (s.h1 - s.h0) * u
          const p = 1 - Math.pow(d / hw, 2)
          if (p > best) best = p
        }
        return best * 0.85 + noise(x, y, 0.6) + rough(x, y) * 0.8
      },
    }
  }

  // an improved ordinary island: the classic blob with fjords, bites out of the coast, and skerries around it
  const asp = b.aspect * (0.9 + rng.next() * 0.35)
  const cuts: { ax: number; ay: number; bx: number; by: number; w: number; deep: number }[] = []
  for (let i = 0, n = 1 + rng.int(0, 2); i < n; i++) { // fjords: a narrow cut running in from the coast
    const a = rng.next() * Math.PI * 2, d0 = b.r * 1.15, d1 = b.r * (0.45 + rng.next() * 0.25)
    cuts.push({ ax: Math.cos(a) * d0, ay: Math.sin(a) * d0, bx: Math.cos(a + (rng.next() - 0.5) * 0.5) * d1, by: Math.sin(a + (rng.next() - 0.5) * 0.5) * d1, w: 2.2 + rng.next() * 1.6, deep: 1.0 })
  }
  const bites: { x: number; y: number; r: number }[] = []
  for (let i = 0, n = 1 + rng.int(0, 2); i < n; i++) { const a = rng.next() * Math.PI * 2; bites.push({ x: Math.cos(a) * b.r * 1.05, y: Math.sin(a) * b.r * 1.05, r: b.r * (0.2 + rng.next() * 0.16) }) } // bays
  if (b.kind !== 'small') ring(b.r, 1 + rng.int(0, 3), 0.98, 1.3)
  const amp = 1.5 * Math.min(1, 0.5 + b.r / 40)
  return {
    shape, reach: b.r * 1.6 + 2, channels, rocks,
    value: (x, y) => {
      const [ux, uy] = local(x, y), d = Math.hypot(ux / (b.r * asp), uy * asp / b.r)
      let v = (1 - Math.pow(d, 2.1)) * 0.85 + noise(x, y, amp)
      for (const c2 of cuts) { // distance to the fjord's centre line
        const ex = c2.bx - c2.ax, ey = c2.by - c2.ay, l2 = ex * ex + ey * ey, u = Math.max(0, Math.min(1, ((ux - c2.ax) * ex + (uy - c2.ay) * ey) / l2))
        const dd = Math.hypot(ux - (c2.ax + ex * u), uy - (c2.ay + ey * u)), w = c2.w * (1.7 - 1.15 * u) // (wide at the coast, narrowing inland)
        if (dd < w * 1.4) v -= c2.deep * (1 - smoothstep(w * 0.6, w * 1.4, dd))
      }
      for (const bt of bites) { const dd = Math.hypot(ux - bt.x, uy - bt.y); if (dd < bt.r) v -= 0.9 * (1 - smoothstep(bt.r * 0.5, bt.r, dd)) }
      return v
    },
  }
}
