import { useEffect, useRef, useState } from 'react'
import { SIM_DT } from '../game/config'
import { clampCamera, fitZoom, zoomAt, type Camera } from '../game/Camera'
import { Game } from '../game/Game'
import { inputCursor, keyBefore, keyText, stepFilm, type Film } from '../game/Film'
import { Renderer } from '../game/Renderer'
import { applySave } from '../game/SaveLoad'
import { sharedAssets } from './ui'

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const SPEEDS = [1, 2, 4, 8]
const yieldUi = () => new Promise<void>(r => setTimeout(r, 0))

/**
 * The film player: a second game is restored from a keyframe and the real simulation runs forward with the player's logged commands, drawn by the real
 * renderer (units, art, territory, fog), so the game unfolds as it did when it was played. The timeline can be scrubbed: a jump restores the nearest earlier
 * keyframe and runs the simulation up to the chosen moment (a few seconds at most), then plays on from there.
 */
export function FilmView({ film, title, endT, onClose, onSwitch }: { film: Film; title: string; endT: number; onClose: () => void; onSwitch?: { label: string; go: () => void }[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [now, setNow] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(2)
  const [busy, setBusy] = useState<string | null>('Preparing the film…'), [drag, setDrag] = useState<number | null>(null)
  const st = useRef({ game: null as Game | null, renderer: null as Renderer | null, cursor: { i: 0 }, token: 0, playing: false, speed: 2, busy: true, cam: { x: 0, y: 0, zoom: 0.5 } as Camera, minZoom: 0.1, accum: 0, timer: 0 as unknown as ReturnType<typeof setTimeout>, placed: false })
  const total = Math.max(1, endT || film.keys[film.keys.length - 1]?.t || 1)
  st.current.playing = playing; st.current.speed = speed

  /** Jump to game time `t`: restore the nearest earlier keyframe and run the simulation up to it (the film plays on afterwards). */
  const seek = async (t: number) => {
    const S = st.current, g = S.game, assets = sharedAssets.current
    if (!g || !assets) return
    const token = ++S.token
    S.busy = true; setBusy('Rewinding…')
    const k = keyBefore(film, t)
    if (!k) { setBusy('This game has no film yet'); return }
    applySave(g, await keyText(k))
    S.cursor.i = inputCursor(film, k.tick)
    S.renderer = new Renderer(assets, g)
    const target = k.tick + Math.max(0, Math.round((t - k.t) / SIM_DT))
    while (g.tickCount < target) {
      if (token !== S.token) return // (a newer jump took over)
      stepFilm(g, film, S.cursor, Math.min(75, target - g.tickCount))
      setBusy(`Rewinding… ${Math.round(100 * (1 - (target - g.tickCount) / Math.max(1, target - k.tick)))}%`)
      await yieldUi()
    }
    S.accum = 0; S.busy = false; setBusy(null); setNow(g.time)
  }

  useEffect(() => {
    const cv = canvas.current!, assets = sharedAssets.current, S = st.current
    if (!assets) { setBusy('The art is not loaded yet'); return }
    const p = film.params
    const g = Game.fromSeed(p.seed, p.kingdoms ?? 0, p.playerTowns, { archipelago: true, playerColor: p.color, startLumber: p.lumber, dynamic: p.dynamic, playAs: p.playAs })
    g.rec.disabled = true; S.game = g
    const view = { w: 800, h: 600, dpr: 1 }
    const resize = () => {
      const r = cv.getBoundingClientRect(); view.w = r.width; view.h = r.height; view.dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(r.width * view.dpr); cv.height = Math.round(r.height * view.dpr)
      S.minZoom = Math.max(0.08, fitZoom(view.w, view.h, g.world.w, g.world.h) * 0.9)
      S.cam.zoom = Math.max(S.minZoom, S.cam.zoom)
    }
    resize(); const ro = new ResizeObserver(resize); ro.observe(cv)
    let raf = 0, last = performance.now(), clock = 0
    const ctx = cv.getContext('2d', { alpha: false })!
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000); last = t
      const game = S.game!
      if (S.playing && !S.busy) {
        S.accum += dt * S.speed
        const steps = Math.min(40, Math.floor(S.accum / SIM_DT)); S.accum -= steps * SIM_DT
        if (steps) stepFilm(game, film, S.cursor, steps)
        if (game.time >= total) { S.playing = false; setPlaying(false) }
      }
      if (!S.placed && S.renderer) { // first look: over the player's first town
        const town = game.towns.find(q => q.owner === 0 && !q.ruined) ?? game.towns[0]
        S.cam.zoom = Math.max(S.minZoom, 0.5); S.cam.x = town.x - view.w / S.cam.zoom / 2; S.cam.y = town.y - view.h / S.cam.zoom / 2; S.placed = true
      }
      clampCamera(S.cam, view.w, view.h, game.world.w, game.world.h)
      if (S.renderer) S.renderer.draw(ctx, view.w, view.h, view.dpr, S.cam, S.busy ? 1 : Math.min(1, S.accum / SIM_DT), { draft: null, hoverTree: -1, showPerf: false, hover: null })
      clock += dt; if (clock > 0.25) { clock = 0; setNow(game.time) }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    void seek(0)
    // drag to pan, wheel to zoom
    let down: { x: number; y: number; cx: number; cy: number } | null = null
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y }; cv.setPointerCapture(e.pointerId) }
    const pm = (e: PointerEvent) => { if (down) { S.cam.x = down.cx - (e.clientX - down.x) / S.cam.zoom; S.cam.y = down.cy - (e.clientY - down.y) / S.cam.zoom } }
    const pu = () => { down = null }
    const wh = (e: WheelEvent) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(S.cam, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0012), S.minZoom) }
    cv.addEventListener('pointerdown', pd); cv.addEventListener('pointermove', pm); cv.addEventListener('pointerup', pu); cv.addEventListener('wheel', wh, { passive: false })
    return () => { cancelAnimationFrame(raf); ro.disconnect(); S.token++; cv.removeEventListener('pointerdown', pd); cv.removeEventListener('pointermove', pm); cv.removeEventListener('pointerup', pu); cv.removeEventListener('wheel', wh) }
  }, [film]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrubTo = (t: number) => { setDrag(t); clearTimeout(st.current.timer); st.current.timer = setTimeout(() => { setDrag(null); void seek(t) }, 250) }
  const shown = drag ?? now
  return (
    <div className="film" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) } }} tabIndex={-1}>
      <canvas ref={canvas} />
      <div className="film-bar panel">
        <b className="film-title">Film · {title}</b>
        <button className="tsbtn small" disabled={!!busy} onClick={() => { if (!playing && now >= total - 1) void seek(0); setPlaying(p => !p) }}>{playing ? 'Pause' : 'Play'}</button>
        <div className="film-speed">{SPEEDS.map(s => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
        <span className="film-time">{fmt(shown)} / {fmt(total)}</span>
        <input className="film-scrub" type="range" min={0} max={Math.floor(total)} step={1} value={Math.min(Math.floor(total), Math.floor(shown))} onChange={e => scrubTo(Number(e.target.value))} aria-label="Timeline" />
        {onSwitch?.map(o => <button key={o.label} className="mini" onClick={o.go}>{o.label}</button>)}
        <button className="mini" onClick={onClose}>Close</button>
      </div>
      {busy && <div className="film-busy">{busy}</div>}
    </div>
  )
}
