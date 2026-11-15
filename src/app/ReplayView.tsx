import { useEffect, useMemo, useRef, useState } from 'react'
import { FACTION_COLORS } from '../game/config'
import { frameAt, isLand, recTerrScale, type RecData, type RecEvent } from '../game/Recorder'
import type { Film } from '../game/Film'
import { FilmView } from './FilmView'
import { ReelView } from './ReelView'
import type { Reel } from '../game/Reel'
import { sharedAssets } from './ui'

const SIZE = 640
const fmtClock = (t: number) => `${Math.floor(t / 3600) ? Math.floor(t / 3600) + ':' : ''}${String(Math.floor((t % 3600) / 60)).padStart(Math.floor(t / 3600) ? 2 : 1, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const SPEEDS = [1, 2, 4, 8, 16, 32]
const MARK_KINDS = new Set(['war', 'town', 'elim'])
const UNIT_NAMES = ['warrior', 'archer', 'lancer', 'knight']

/**
 * The replay page: scrub through a recording (see Recorder.ts). The map shows territory, towns, troops and ships at the chosen moment; markers
 * on the timeline are wars, captured towns and eliminated nations; the table and the event list follow the moment.
 */
export function ReplayView({ data, title, onClose, film, filmEndT, reel }: { data: RecData; title: string; onClose: () => void; film?: Film | null; filmEndT?: number; reel?: Reel | null }) {
  const canFilm = !!film && film.keys.length > 0 && !!sharedAssets.current
  const canReel = !!reel && reel.frames.length > 0 && !!sharedAssets.current
  const [mode, setMode] = useState<'reel' | 'film' | 'map'>(canReel ? 'reel' : canFilm ? 'film' : 'map') // the position-recording film first when there is one; the other views stay one click away
  const n = data.frames.length
  const [pos, setPos] = useState(Math.max(0, n - 1)) // frame index (fractional while playing)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4) // frames per second
  const [show, setShow] = useState({ territory: true, units: true, ships: true })
  const canvas = useRef<HTMLCanvasElement>(null)
  const base = useRef<HTMLCanvasElement | null>(null)
  const idx = Math.max(0, Math.min(n - 1, Math.round(pos)))
  const frame = n ? frameAt(data, idx) : null
  const colorOf = (k: number) => FACTION_COLORS[data.kingdoms[k]?.color ?? 0] ?? '#888'

  // playback clock
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000; last = now
      setPos(p => { const q = p + dt * speed; if (q >= n - 1) { setPlaying(false); return n - 1 } return q })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, n])

  // the land, drawn once
  useEffect(() => {
    const c = document.createElement('canvas'); c.width = data.w; c.height = data.h
    const x = c.getContext('2d')!, img = x.createImageData(data.w, data.h)
    for (let i = 0; i < data.w * data.h; i++) { const l = isLand(data, i), o = i * 4; img.data[o] = l ? 196 : 43; img.data[o + 1] = l ? 184 : 111; img.data[o + 2] = l ? 128 : 132; img.data[o + 3] = 255 }
    x.putImageData(img, 0, 0); base.current = c
  }, [data])

  // the moment
  useEffect(() => {
    const cv = canvas.current, b = base.current
    if (!cv || !b || !frame) return
    const ctx = cv.getContext('2d')!, S = SIZE, sx = S / data.w, sy = S / data.h
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(b, 0, 0, S, S)
    if (show.territory) {
      const tw = Math.ceil(data.w / recTerrScale), th = Math.ceil(data.h / recTerrScale)
      const t = document.createElement('canvas'); t.width = tw; t.height = th
      const tx = t.getContext('2d')!, img = tx.createImageData(tw, th)
      const rgb = new Map<number, [number, number, number]>()
      for (let i = 0; i < tw * th; i++) {
        const o = frame.terr[i]; if (!o) continue
        let c = rgb.get(o); if (!c) { const hex = colorOf(o - 1); c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; rgb.set(o, c) }
        img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 120
      }
      tx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true; ctx.drawImage(t, 0, 0, S, S); ctx.imageSmoothingEnabled = false
    }
    for (let i = 0; i < frame.towns.length; i += 4) {
      const x = (frame.towns[i] + 0.5) * sx, y = (frame.towns[i + 1] + 0.5) * sy, owner = frame.towns[i + 2], kind = frame.towns[i + 3] >> 2
      ctx.fillStyle = owner ? colorOf(owner - 1) : '#ddd'; ctx.strokeStyle = '#1b130b'; ctx.lineWidth = 1.5
      if (kind === 2) { ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke() } else { ctx.fillRect(x - 4.5, y - 4.5, 9, 9); ctx.strokeRect(x - 4.5, y - 4.5, 9, 9) }
    }
    if (show.units) for (let i = 0; i < frame.units.length; i += 3) { ctx.fillStyle = colorOf(frame.units[i + 2] >> 3); ctx.fillRect(frame.units[i] / 4 * sx - 1, frame.units[i + 1] / 4 * sy - 1, 2.4, 2.4) }
    if (show.ships) for (let i = 0; i < frame.boats.length; i += 3) {
      const x = frame.boats[i] / 4 * sx, y = frame.boats[i + 1] / 4 * sy, big = (frame.boats[i + 2] & 7) === 4 || (frame.boats[i + 2] & 7) === 1
      ctx.fillStyle = colorOf(frame.boats[i + 2] >> 3); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 3.5, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 3.5, y); ctx.closePath(); ctx.fill(); if (big) ctx.stroke()
    }
  }, [frame, data, show])

  const marks = useMemo(() => {
    const out: (RecEvent & { frame: number })[] = []
    data.frames.forEach((f, i) => { for (const e of f.events) if (MARK_KINDS.has(e.kind)) out.push({ ...e, frame: i }) })
    return out
  }, [data])
  const feed = useMemo(() => {
    const out: RecEvent[] = []
    for (let i = Math.min(idx, n - 1); i >= 0 && out.length < 14; i--) for (const e of [...data.frames[i].events].reverse()) { out.push(e); if (out.length >= 14) break }
    return out
  }, [data, idx, n])
  const table = useMemo(() => {
    if (!frame) return []
    const rows = data.kingdoms.map((k, id) => ({ id, k, towns: 0, colonies: 0, units: 0, ships: 0, land: 0 }))
    for (let i = 0; i < frame.towns.length; i += 4) { const o = frame.towns[i + 2] - 1; if (o >= 0 && rows[o]) { if (frame.towns[i + 3] >> 2 === 2) rows[o].colonies++; else rows[o].towns++ } }
    for (let i = 0; i < frame.units.length; i += 3) { const r = rows[frame.units[i + 2] >> 3]; if (r) r.units++ }
    for (let i = 0; i < frame.boats.length; i += 3) { const r = rows[frame.boats[i + 2] >> 3]; if (r) r.ships++ }
    for (let i = 0; i < frame.terr.length; i++) { const o = frame.terr[i] - 1; if (o >= 0 && rows[o]) rows[o].land++ }
    return rows.filter(r => r.towns + r.colonies + r.units + r.ships > 0).sort((a, b) => b.towns + b.colonies - (a.towns + a.colonies) || b.units - a.units)
  }, [frame, data])

  const others = (except: string) => [canReel && except !== 'reel' ? { label: 'Film', go: () => setMode('reel') } : null, canFilm && except !== 'film' ? { label: 'Exact re-run', go: () => setMode('film') } : null, except !== 'map' ? { label: 'Map view', go: () => setMode('map') } : null].filter((x): x is { label: string; go: () => void } => !!x)
  if (mode === 'reel' && reel) return <ReelView reel={reel} title={title} onClose={onClose} onSwitch={others('reel')} />
  if (mode === 'film' && film) return <FilmView film={film} title={title} endT={filmEndT ?? 0} onClose={onClose} onSwitch={others('film')} />
  if (!n || !frame) return (
    <div className="menu over" onKeyDown={e => e.stopPropagation()}><div className="panel menu-card"><div className="panelhead"><h2>Replay</h2><button className="min" onClick={onClose}>×</button></div><small className="hint2">Nothing has been recorded yet: the first moment is captured after 10 seconds of play.</small></div></div>
  )
  const lastT = data.frames[n - 1].t
  return (
    <div className="menu over replay" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) } if (e.key === 'ArrowLeft') setPos(p => Math.max(0, Math.round(p) - 1)); if (e.key === 'ArrowRight') setPos(p => Math.min(n - 1, Math.round(p) + 1)) }} tabIndex={-1}>
      <div className="panel menu-card replay-card">
        <div className="panelhead"><h2>Replay · {title}</h2>{canReel && <button className="mini" title="Watch the game unfold: the real units, art and territories" onClick={() => setMode('reel')}>Film</button>}{canFilm && <button className="mini" title="Re-run the real simulation from a snapshot (exact, but only for the game version it was recorded on)" onClick={() => setMode('film')}>Exact re-run</button>}<button className="min" title="Close (Esc)" onClick={onClose}>×</button></div>
        <div className="replay-body">
          <div className="replay-map">
            <canvas ref={canvas} width={SIZE} height={SIZE} />
            <div className="replay-time"><b>{fmtClock(frame.t)}</b><small> of {fmtClock(lastT)} · {n} moments recorded</small></div>
            <div className="replay-controls">
              <button className="tsbtn small" onClick={() => { if (!playing && pos >= n - 1) setPos(0); setPlaying(p => !p) }}>{playing ? 'Pause' : 'Play'}</button>
              <button className="mini" title="Back one moment" onClick={() => { setPlaying(false); setPos(p => Math.max(0, Math.round(p) - 1)) }}>‹</button>
              <button className="mini" title="Forward one moment" onClick={() => { setPlaying(false); setPos(p => Math.min(n - 1, Math.round(p) + 1)) }}>›</button>
              <div className="replay-scrub">
                <input type="range" min={0} max={Math.max(1, n - 1)} step={0.01} value={pos} onChange={e => setPos(Number(e.target.value))} aria-label="Timeline" />
                <div className="replay-marks">{marks.map((m, i) => <i key={i} className={'mk-' + m.kind} title={`${fmtClock(m.t)} · ${m.text}`} style={{ left: `${(m.frame / Math.max(1, n - 1)) * 100}%` }} onClick={() => { setPlaying(false); setPos(m.frame) }} />)}</div>
              </div>
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))} title="Moments per second">{SPEEDS.map(s => <option key={s} value={s}>{s * 10}× speed</option>)}</select>
            </div>
            <small className="hint2">Markers: <b className="mk-war">wars</b> · <b className="mk-town">towns taken</b> · <b className="mk-elim">nations lost</b>. Space plays, ← → step.</small>
          </div>
          <div className="replay-side">
            <div className="replay-toggles">{(['territory', 'units', 'ships'] as const).map(k => <label key={k}><input type="checkbox" checked={show[k]} onChange={e => setShow(s => ({ ...s, [k]: e.target.checked }))} />{k}</label>)}</div>
            <table className="dtable mini2"><thead><tr><th>Nation</th><th title="Towns">T</th><th title="Colonies">C</th><th title="Units">U</th><th title="Ships">S</th><th title="Territory (tiles)">Land</th></tr></thead>
              <tbody>{table.map(r => <tr key={r.id} className={r.k.isPlayer ? 'me' : ''}><td><i style={{ background: colorOf(r.id) }} />{r.k.name}{r.k.isPlayer ? ' (you)' : ''}</td><td>{r.towns}</td><td>{r.colonies}</td><td>{r.units}</td><td>{r.ships}</td><td>{r.land * recTerrScale * recTerrScale}</td></tr>)}</tbody></table>
            <div className="replay-feed">{feed.map((e, i) => <p key={i} className={'ev ' + e.kind}><span>{fmtClock(e.t)}</span>{e.text}</p>)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
void UNIT_NAMES
