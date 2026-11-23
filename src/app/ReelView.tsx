import { useEffect, useRef, useState } from 'react'
import { clampCamera, fitZoom, zoomAt, type Camera } from '../game/Camera'
import { Game } from '../game/Game'
import { spawnBoat } from '../game/BoatSystem'
import { Renderer } from '../game/Renderer'
import { ReelPlayer, type Reel } from '../game/Reel'
import { sharedAssets } from './ui'

const fmt = (t: number) => `${Math.floor(t / 3600) ? Math.floor(t / 3600) + ':' : ''}${String(Math.floor((t % 3600) / 60)).padStart(Math.floor(t / 3600) ? 2 : 1, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const SPEEDS = [1, 2, 4, 8, 16, 32]

/**
 * The reel player: the recorded positions drawn by the real renderer (real units, ships, art, territory), gliding between one-second snapshots. Scrubbing is
 * instant: there is nothing to simulate, so any moment of the game can be jumped to and watched.
 */
export function ReelView({ reel, title, onClose, onSwitch }: { reel: Reel; title: string; onClose: () => void; onSwitch?: { label: string; go: () => void }[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const total = Math.max(1, reel.endT)
  const [now, setNow] = useState(Math.max(0, reel.frames[0]?.t ?? 0)), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(4), [err, setErr] = useState<string | null>(null)
  const S = useRef({ t: now, playing: false, speed: 4, cam: { x: 0, y: 0, zoom: 0.5 } as Camera, minZoom: 0.1, placed: false, show: (_t: number) => { /* set below */ } })
  S.current.playing = playing; S.current.speed = speed

  useEffect(() => {
    const cv = canvas.current!, assets = sharedAssets.current, st = S.current
    if (!assets) { setErr('The art is not loaded yet'); return }
    if (!reel.frames.length) { setErr('Nothing has been recorded yet: the first moment is captured after a second of play.'); return }
    const p = reel.params
    const g = Game.fromSeed(p.seed, p.kingdoms ?? 0, p.playerTowns, { archipelago: true, playerColor: p.color, startLumber: p.lumber, dynamic: p.dynamic })
    g.rec.disabled = true
    const player = new ReelPlayer(g, reel, (gg, k, kind, x, y) => spawnBoat(gg, k, kind, x, y))
    const renderer = new Renderer(assets, g)
    st.t = Math.max(reel.frames[0].t, Math.min(st.t, reel.endT)); st.show = (t: number) => player.show(t)
    const view = { w: 800, h: 600, dpr: 1 }
    const resize = () => {
      const r = cv.getBoundingClientRect(); view.w = r.width; view.h = r.height; view.dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(r.width * view.dpr); cv.height = Math.round(r.height * view.dpr)
      st.minZoom = Math.max(0.08, fitZoom(view.w, view.h, g.world.w, g.world.h) * 0.9)
      st.cam.zoom = Math.max(st.minZoom, st.cam.zoom)
    }
    resize(); const ro = new ResizeObserver(resize); ro.observe(cv)
    const ctx = cv.getContext('2d', { alpha: false })!
    let raf = 0, last = performance.now(), clock = 0
    const loop = (tm: number) => {
      const dt = Math.min(0.1, (tm - last) / 1000); last = tm
      if (st.playing) { st.t += dt * st.speed; if (st.t >= reel.endT) { st.t = reel.endT; st.playing = false; setPlaying(false) } }
      player.show(st.t)
      if (!st.placed) { const town = g.towns.find(q => q.owner === 0 && !q.ruined) ?? g.towns[0]; st.cam.zoom = Math.max(st.minZoom, 0.5); st.cam.x = town.x - view.w / st.cam.zoom / 2; st.cam.y = town.y - view.h / st.cam.zoom / 2; st.placed = true }
      clampCamera(st.cam, view.w, view.h, g.world.w, g.world.h)
      renderer.draw(ctx, view.w, view.h, view.dpr, st.cam, 1, { draft: null, hoverTree: -1, showPerf: false, hover: null })
      clock += dt; if (clock > 0.2) { clock = 0; setNow(st.t) }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    let down: { x: number; y: number; cx: number; cy: number } | null = null
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, cx: st.cam.x, cy: st.cam.y }; cv.setPointerCapture(e.pointerId) }
    const pm = (e: PointerEvent) => { if (down) { st.cam.x = down.cx - (e.clientX - down.x) / st.cam.zoom; st.cam.y = down.cy - (e.clientY - down.y) / st.cam.zoom } }
    const pu = () => { down = null }
    const wh = (e: WheelEvent) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(st.cam, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0012), st.minZoom) }
    cv.addEventListener('pointerdown', pd); cv.addEventListener('pointermove', pm); cv.addEventListener('pointerup', pu); cv.addEventListener('wheel', wh, { passive: false })
    return () => { cancelAnimationFrame(raf); ro.disconnect(); cv.removeEventListener('pointerdown', pd); cv.removeEventListener('pointermove', pm); cv.removeEventListener('pointerup', pu); cv.removeEventListener('wheel', wh) }
  }, [reel])

  const jump = (t: number) => { S.current.t = Math.max(0, Math.min(reel.endT, t)); setNow(S.current.t) }
  return (
    <div className="film" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }; if (e.key === 'ArrowLeft') jump(S.current.t - 10); if (e.key === 'ArrowRight') jump(S.current.t + 10) }} tabIndex={-1}>
      <canvas ref={canvas} />
      <div className="film-bar panel">
        <b className="film-title">Film · {title}</b>
        <button className="tsbtn small" onClick={() => { if (!playing && now >= total - 0.5) jump(reel.frames[0]?.t ?? 0); setPlaying(p => !p) }}>{playing ? 'Pause' : 'Play'}</button>
        <button className="mini" title="Back 10 seconds" onClick={() => jump(S.current.t - 10)}>‹10s</button>
        <button className="mini" title="Forward 10 seconds" onClick={() => jump(S.current.t + 10)}>10s›</button>
        <div className="film-speed">{SPEEDS.map(s => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
        <span className="film-time">{fmt(now)} / {fmt(total)}</span>
        <input className="film-scrub" type="range" min={0} max={Math.max(1, Math.floor(total))} step={0.5} value={Math.min(total, now)} onChange={e => jump(Number(e.target.value))} aria-label="Timeline" />
        {onSwitch?.map(o => <button key={o.label} className="mini" onClick={o.go}>{o.label}</button>)}
        <button className="mini" onClick={onClose}>Close</button>
      </div>
      {err && <div className="film-busy">{err}</div>}
    </div>
  )
}
