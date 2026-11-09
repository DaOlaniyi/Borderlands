import { useEffect, useRef, useState } from 'react'
import type { Assets } from '../game/AssetLoader'
import { fitZoom, type Camera } from '../game/Camera'
import { TILE, type BoatKind, type UnitType, type ZumFocus } from '../game/config'
import { Game, type HudSnapshot } from '../game/Game'
import { Sfx } from '../game/Audio'
import { spawnBoat } from '../game/BoatSystem'
import { InputController } from '../game/InputController'
import { Renderer } from '../game/Renderer'
import { Hud, type HudActions } from './Hud'
import type { NewGameParams } from './NewGameScreen'

/** Hollow-circle cursor used by brush selection (30 px radius, matching InputController.BRUSH_PX). */
const BRUSH_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="29" fill="none" stroke="black" stroke-width="5" opacity=".55"/><circle cx="32" cy="32" r="29" fill="none" stroke="white" stroke-width="2.5"/></svg>')}") 32 32, crosshair`

/** Dev-only (`?demo=ships`): drop a boat, a Zumwalt and an enemy boat beside the player's coast and look at them. */
function demoShips(game: Game, cam: Camera, view: { w: number; h: number }) {
  const { w, h } = game.world
  for (let i = 0; i < w * h; i++) {
    if (game.controller[i] !== 1 || !game.world.land[i]) continue
    const cx = i % w, cy = (i / w) | 0
    const sea = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => !game.world.land[(cy + dy) * w + cx + dx] && !game.world.land[(cy + dy * 6) * w + cx + dx * 6])
    if (!sea) continue
    const [dx, dy] = sea, P = (k: number) => ({ x: (cx + dx * k + 0.5) * TILE, y: (cy + dy * k + 0.5) * TILE })
    const a = P(1), z = P(5), e = P(12)
    spawnBoat(game, 0, 'boat', a.x, a.y); const zb = spawnBoat(game, 0, 'zumwalt', z.x, z.y); spawnBoat(game, 1, 'boat', e.x, e.y)
    zb.volleyCd = 0.2
    game.diplomacy.set(0, 1, 'war', 0)
    for (let i = 0; i < 25 * 12 && !game.fx.some(f => f.kind === 'boom' && f.t > 0.25); i++) game.step(1 / 25) // fast-forward to the first explosion
    const dock = /demo=dock/.test(location.search), me = game.boats.find(q => q.faction === 0 && q.kind === 'boat')!
    game.selection = { kind: 'boats', ids: [dock ? me.id : zb.id] }
    const c = dock ? { x: me.x, y: me.y } : P(6)
    cam.zoom = dock ? 1.2 : 0.9; cam.x = c.x - view.w / cam.zoom / 2; cam.y = c.y - view.h / cam.zoom / 2
    return
  }
}

export function GameView({ assets, params, onExit }: { assets: Assets; params: NewGameParams; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const apiRef = useRef<HudActions | null>(null)
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [perf, setPerf] = useState<string | null>(null)
  const [brush, setBrush] = useState(false)
  const showPerf = useRef(import.meta.env.DEV || /[?&]debug/.test(location.search))

  useEffect(() => {
    const canvas = canvasRef.current!
    const game = Game.fromSeed(params.seed, params.kingdoms ?? 0, params.playerTowns, { archipelago: true, playerColor: params.color, startLumber: params.lumber })
    const renderer = new Renderer(assets, game)
    const view = { w: 800, h: 600, dpr: 1 }
    const cam: Camera = { x: 0, y: 0, zoom: 0.4 }
    const town = game.towns.find(t => t.owner === 0)!
    let minZoom = 0.1, placed = false
    const input = new InputController(game, cam, () => view)
    const sfx = new Sfx()

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      view.w = r.width; view.h = r.height; view.dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(r.width * view.dpr); canvas.height = Math.round(r.height * view.dpr)
      minZoom = Math.max(0.08, fitZoom(view.w, view.h, game.world.w, game.world.h) * 0.9)
      if (!placed) { // start wide, centred on the player's town
        cam.zoom = Math.min(0.55, Math.max(minZoom, 0.45))
        cam.x = town.x - view.w / cam.zoom / 2; cam.y = town.y - view.h / cam.zoom / 2
        placed = true
      }
      cam.zoom = Math.max(minZoom, cam.zoom)
    }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(canvas)
    if (import.meta.env.DEV && /[?&]demo=(ships|dock)/.test(location.search)) demoShips(game, cam, view) // dev aid: ships next to the player's coast
    const camQ = import.meta.env.DEV ? new URLSearchParams(location.search).get('cam') : null // dev aid: ?cam=tileX,tileY,zoom looks at a spot
    if (camQ) { const [cx, cy, z] = camQ.split(',').map(Number); cam.zoom = Math.max(minZoom, z || 0.2); cam.x = (cx + 0.5) * TILE - view.w / cam.zoom / 2; cam.y = (cy + 0.5) * TILE - view.h / cam.zoom / 2 }

    const pos = (e: PointerEvent | WheelEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    let pressed = false
    const down = (e: PointerEvent) => { if (e.button !== 0) return; canvas.setPointerCapture(e.pointerId); sfx.unlock(); pressed = true; const p = pos(e); input.down(p.x, p.y, e.shiftKey) }
    const move = (e: PointerEvent) => { const p = pos(e); input.move(p.x, p.y, pressed) }
    const up = (e: PointerEvent) => { if (!pressed) return; pressed = false; const p = pos(e); input.up(p.x, p.y); if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId) }
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = pos(e); input.wheel(p.x, p.y, e.deltaY, minZoom) }
    const ctxMenu = (e: Event) => e.preventDefault()
    const actions: HudActions = {
      toggleBlock: () => game.toggleBlockSelection(),
      join: () => { if (game.selection?.kind === 'units') game.joinUnits(game.selection.ids) },
      breakSquad: () => game.breakSelection(),
      setProduce: (t: UnitType, on: boolean) => game.setProduce(0, t, on),
      placeTower: () => { game.placing = game.placing === 'tower' ? false : 'tower' },
      placeLot: () => { game.placing = game.placing === 'lot' ? false : 'lot' },
      placeBoat: (k: BoatKind) => { game.placing = game.placing === k ? false : k },
      unloadBoat: () => game.unloadSelected(),
      setZumFocus: (f: ZumFocus) => game.setZumwaltFocus(f),
      toggleRange: () => { game.showRange = !game.showRange },
      toggleTownProduce: (id: number) => game.toggleTownProduce(id),
      toggleTownRaze: (id: number) => game.toggleTownRaze(id),
      cancelBuild: (id: number) => { const t = game.towerById(id); if (t) game.cancelStructure(t) },
      leaveTower: () => { for (const u of game.selectedUnits()) game.exitTower(u) },
      alliance: k => game.proposeAlliance(k),
      breakAlliance: k => game.breakAlliance(k),
      toggleBlocColor: k => game.toggleBlocColor(k),
      focusKingdom: k => game.toggleFocus(k),
      rename: n => game.renameKingdom(0, n),
      setSpeed: n => { game.speed = n },
      setHarvest: m => game.setHarvest(0, m),
      exit: onExit,
    }
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'b' || e.key === 'B') game.toggleBlockSelection()
      if (e.key === 's' || e.key === 'S') input.stop() // S cancels the order being drawn and stops the selected units
      if (e.key === 'c' || e.key === 'C') { const on = input.toggleBrush(); setBrush(on); canvas.style.cursor = on ? BRUSH_CURSOR : '' }
      if (e.key === 'm' || e.key === 'M') sfx.toggleMute()
      if (e.key === '`') showPerf.current = !showPerf.current
      if (e.key === 'Escape') { game.selection = null; game.placing = false; if (input.brush) { input.toggleBrush(); setBrush(false); canvas.style.cursor = '' } }
    }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('contextmenu', ctxMenu); window.addEventListener('keydown', key)
    apiRef.current = actions
    if (showPerf.current) (window as unknown as Record<string, unknown>).__borderlands = { game, cam, view }

    const ctx = canvas.getContext('2d', { alpha: false })!
    let raf = 0, last = performance.now(), hudClock = 0, frames = 0, fpsClock = 0, fps = 0
    const loop = (now: number) => {
      const dt = (now - last) / 1000; last = now
      const alpha = game.advance(dt)
      if (game.sounds.length) { // play effects near the camera, quieter with distance
        const cx = cam.x + view.w / cam.zoom / 2, cy = cam.y + view.h / cam.zoom / 2, reach = Math.max(view.w, view.h) / cam.zoom * 0.75
        for (const s of game.sounds) sfx.play(s.name, Math.max(0, 1 - Math.hypot(s.x - cx, s.y - cy) / reach))
        game.sounds.length = 0
      }
      renderer.draw(ctx, view.w, view.h, view.dpr, cam, alpha, { draft: input.draft, hoverTree: input.hoverTree, showPerf: showPerf.current, hover: input.hover })
      frames++; fpsClock += dt; hudClock += dt
      if (fpsClock >= 0.5) { fps = frames / fpsClock; frames = 0; fpsClock = 0 }
      if (hudClock > 0.2) {
        hudClock = 0; setHud(game.hud())
        const st = renderer.stats
        setPerf(showPerf.current ? `fps ${fps.toFixed(0)}  sim ${game.simMs.toFixed(2)}ms  territory ${game.territoryMs.toFixed(2)}ms (${game.recomputeCount}x)\ndraw ${st.drawMs.toFixed(2)}ms  sprites ${st.visibleSprites}  foam ${st.foamVisible}  chunks built/frame ${st.chunksBuilt}\nmap ${game.world.w}×${game.world.h}  units ${game.units.length}  towers ${game.towers.length}  zoom ${cam.zoom.toFixed(2)}` : null)
      }
      raf = requestAnimationFrame(loop)
    }
    setHud(game.hud())
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf); ro.disconnect()
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', ctxMenu); window.removeEventListener('keydown', key)
      apiRef.current = null
    }
  }, [assets, params, onExit])

  return (
    <div className="stage">
      <canvas ref={canvasRef} aria-label="Borderlands map" />
      {hud && apiRef.current && <Hud hud={hud} perf={perf} actions={apiRef.current} brush={brush} />}
    </div>
  )
}
