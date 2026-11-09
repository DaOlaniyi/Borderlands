/** Banner emblems: the second identifier of a kingdom besides its colour. 10 shapes × 2 frames = 20 distinct emblems. */
export const EMBLEM_SHAPES = 10
export const EMBLEM_COUNT = EMBLEM_SHAPES * 2

/** Unique emblem per kingdom: a seeded shuffle, so the 20 colours never share one. */
export function assignEmblems(count: number, rand: () => number): number[] {
  const all = Array.from({ length: EMBLEM_COUNT }, (_, i) => i)
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]] }
  return Array.from({ length: count }, (_, i) => all[i % EMBLEM_COUNT])
}

type Ctx = CanvasRenderingContext2D
/** Draw an emblem centred on (x,y), `size` px across, in `fill` on a `bg` badge (shield for 0..9, disc for 10..19). */
export function drawEmblem(ctx: Ctx, emblem: number, x: number, y: number, size: number, bg: string, fill: string) {
  const r = size / 2, shape = emblem % EMBLEM_SHAPES, round = emblem >= EMBLEM_SHAPES
  ctx.save(); ctx.translate(x, y)
  ctx.beginPath()
  if (round) ctx.arc(0, 0, r, 0, Math.PI * 2)
  else { ctx.moveTo(-r * 0.85, -r * 0.9); ctx.lineTo(r * 0.85, -r * 0.9); ctx.lineTo(r * 0.85, r * 0.1); ctx.quadraticCurveTo(r * 0.8, r * 0.7, 0, r); ctx.quadraticCurveTo(-r * 0.8, r * 0.7, -r * 0.85, r * 0.1); ctx.closePath() }
  ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = Math.max(1, size * 0.07); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.stroke()
  ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineWidth = Math.max(1.2, size * 0.1); ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  const k = r * 0.55
  const poly = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a * k, b * k) : ctx.moveTo(a * k, b * k))); ctx.closePath(); ctx.fill() }
  switch (shape) {
    case 0: { const p: [number, number][] = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 0.45 : 1; p.push([Math.cos(a) * rr, Math.sin(a) * rr]) } poly(p); break } // star
    case 1: ctx.fillRect(-k * 0.28, -k, k * 0.56, k * 2); ctx.fillRect(-k, -k * 0.28, k * 2, k * 0.56); break // cross
    case 2: ctx.beginPath(); ctx.arc(0, 0, k, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(k * 0.45, -k * 0.1, k * 0.85, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; break // crescent
    case 3: ctx.beginPath(); ctx.moveTo(-k, k * 0.5); ctx.lineTo(0, -k * 0.6); ctx.lineTo(k, k * 0.5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-k, k * 1.0); ctx.lineTo(0, -k * 0.1); ctx.lineTo(k, k * 1.0); ctx.stroke(); break // chevrons
    case 4: poly([[0, -1], [0.8, 0], [0, 1], [-0.8, 0]]); break // diamond
    case 5: ctx.beginPath(); ctx.arc(0, 0, k * 0.8, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, k * 0.22, 0, Math.PI * 2); ctx.fill(); break // ring
    case 6: poly([[0, -1], [0.95, 0.8], [-0.95, 0.8]]); break // triangle
    case 7: ctx.fillRect(-k, -k * 0.85, k * 2, k * 0.42); ctx.fillRect(-k, -k * 0.2, k * 2, k * 0.42); ctx.fillRect(-k, k * 0.45, k * 2, k * 0.42); break // bars
    case 8: ctx.beginPath(); for (let i = 0; i <= 12; i++) { const a = -k + (i / 12) * k * 2, b = Math.sin((i / 12) * Math.PI * 3) * k * 0.45; i ? ctx.lineTo(a, b) : ctx.moveTo(a, b) } ctx.stroke(); break // wave
    default: poly([[-1, 0.8], [-1, -0.5], [-0.5, 0.05], [0, -0.9], [0.5, 0.05], [1, -0.5], [1, 0.8]]) // crown
  }
  ctx.restore()
}
