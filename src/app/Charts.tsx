import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Small SVG chart kit for the match review page (themed to the game's parchment panels). */
export const fmtN = (n: number) => (Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(0)}k` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n * 10) / 10))
export const fmtClock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

export type Series = { id: number; name: string; color: string; v: number[]; emblem?: string }

/** A "nice" axis ceiling and step for a maximum value. */
function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { top: 1, step: 1 / ticks }
  const raw = max / ticks, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  return { top: step * Math.ceil(max / step), step }
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null), [w, setW] = useState(640)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth))); ro.observe(el); setW(Math.max(280, el.clientWidth))
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Multi-line chart over match time: 2 px lines, quiet grid, hover crosshair with a ranked tooltip. */
export function LineChart({ t, series, fmt = fmtN, height = 270, unit = '' }: { t: number[]; series: Series[]; fmt?: (n: number) => string; height?: number; unit?: string }) {
  const [wrap, W] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const M = { l: 46, r: 14, t: 10, b: 24 }, H = height, iw = W - M.l - M.r, ih = H - M.t - M.b
  const n = t.length
  const max = Math.max(0, ...series.flatMap(s => s.v))
  const { top, step } = niceScale(max)
  const x = (i: number) => M.l + (n <= 1 ? 0 : (i / (n - 1)) * iw), y = (v: number) => M.t + ih - (v / top) * ih
  const yTicks: number[] = []; for (let v = 0; v <= top + 1e-9; v += step) yTicks.push(v)
  const span = t.length ? t[t.length - 1] - t[0] : 0, xStep = [30, 60, 120, 300, 600, 900, 1800, 3600].find(s => span / s <= Math.max(3, iw / 90)) ?? 3600
  const xTicks: number[] = []; for (let s = Math.ceil((t[0] ?? 0) / xStep) * xStep; s <= (t[n - 1] ?? 0); s += xStep) xTicks.push(s)
  const idxOfTime = (s: number) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < s) lo = m + 1; else hi = m } return lo }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left
    if (n) setHover(Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / iw) * (n - 1)))))
  }
  const ranked = hover === null ? [] : series.map(s => ({ s, val: s.v[hover] ?? 0 })).sort((a, b) => b.val - a.val)
  const tipLeft = hover === null ? 0 : x(hover) > W * 0.6 ? x(hover) - 196 : x(hover) + 14
  return (
    <div className="chart" ref={wrap} style={{ height: H }}>
      <svg width={W} height={H} role="img" aria-label="Line chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {yTicks.map(v => <g key={v}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="grid" /><text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="axis">{fmt(v)}</text></g>)}
        {xTicks.map(s => <text key={s} x={x(idxOfTime(s))} y={H - 6} textAnchor="middle" className="axis">{fmtClock(s)}</text>)}
        {series.map(s => {
          const d = s.v.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
          return <g key={s.id}><path d={d} className="halo" /><path d={d} stroke={s.color} className="line" /></g>
        })}
        {hover !== null && <g>
          <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} className="cross" />
          {series.map(s => <circle key={s.id} cx={x(hover)} cy={y(s.v[hover] ?? 0)} r={4} fill={s.color} className="dot" />)}
        </g>}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: tipLeft, top: 8 }}>
          <b>{fmtClock(t[hover])}</b>
          {ranked.slice(0, 9).map(({ s, val }) => <div key={s.id}><i style={{ background: s.color }} />{s.name}<span>{fmt(val)}{unit}</span></div>)}
          {ranked.length > 9 && <small>+{ranked.length - 9} more</small>}
        </div>
      )}
      {!n && <div className="chartempty">Collecting data…</div>}
    </div>
  )
}

/** Toggleable legend: colour swatch + name for every series (identity is never colour alone). */
export function Legend({ items, shown, onToggle, onPreset }: { items: { id: number; name: string; color: string; emblem?: string }[]; shown: Set<number>; onToggle: (id: number) => void; onPreset?: (p: 'top' | 'all' | 'none') => void }) {
  return (
    <div className="legend">
      {onPreset && <span className="presets"><button className="mini" onClick={() => onPreset('top')}>Top 6</button><button className="mini" onClick={() => onPreset('all')}>All</button><button className="mini" onClick={() => onPreset('none')}>None</button></span>}
      {items.map(it => (
        <button key={it.id} className={'chip2' + (shown.has(it.id) ? ' on' : '')} aria-pressed={shown.has(it.id)} onClick={() => onToggle(it.id)} title={shown.has(it.id) ? 'Hide from the chart' : 'Show on the chart'}>
          <i style={{ background: it.color }} />{it.emblem && <img src={it.emblem} alt="" />}{it.name}
        </button>
      ))}
    </div>
  )
}

/** A row of proportional horizontal bars with a 2 px gap between segments (stacked), value labels in text ink. */
export function StackBar({ parts, total, height = 14 }: { parts: { label: string; value: number; color: string }[]; total?: number; height?: number }) {
  const sum = total ?? parts.reduce((n, p) => n + p.value, 0)
  if (sum <= 0) return <div className="stack empty" style={{ height }} />
  return (
    <div className="stack" style={{ height }}>
      {parts.filter(p => p.value > 0).map(p => <span key={p.label} title={`${p.label}: ${fmtN(p.value)}`} style={{ flex: p.value, background: p.color }} />)}
    </div>
  )
}

/** One horizontal bar scaled against `max`, rounded at the data end, value printed beside it. */
export function Bar({ value, max, color, label }: { value: number; max: number; color: string; label?: ReactNode }) {
  return <div className="hbar"><span style={{ width: `${max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0}%`, background: color }} /><em>{label ?? fmtN(value)}</em></div>
}

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return <div className={'tile' + (tone ? ' ' + tone : '')}><small>{label}</small><b>{value}</b>{sub && <span>{sub}</span>}</div>
}
