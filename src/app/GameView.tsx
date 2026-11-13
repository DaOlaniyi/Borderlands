import { useEffect, useRef, useState } from 'react'
import type { Assets } from '../game/AssetLoader'
import { fitZoom, type Camera } from '../game/Camera'
import { TILE, type BoatKind, type UnitType, type ZumFocus } from '../game/config'
import { Game, type HudSnapshot } from '../game/Game'
import { Sfx } from '../game/Audio'
import { orderSail, spawnBoat } from '../game/BoatSystem'
import { InputController } from '../game/InputController'
import { Renderer } from '../game/Renderer'
import { restoreGame, serializeGame } from '../game/SaveLoad'
import { DebugPanel } from './DebugPanel'
import { Hud, type HudActions } from './Hud'
import type { NewGameParams } from './NewGameScreen'
import { SavesDialog } from './SavesDialog'
import { AUTOSAVE_ID, putSave } from './saves'

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
    spawnBoat(game, 0, /demo=barge/.test(location.search) ? 'barge' : 'boat', a.x, a.y); const zb = spawnBoat(game, 0, 'zumwalt', z.x, z.y); spawnBoat(game, 1, 'boat', e.x, e.y)
    if (/demo=fleet/.test(location.search)) { for (const [k, kind] of [[3, 'cargo'], [7, 'gunship'], [9, 'boat'], [11, 'barge']] as const) { const p = P(k); const b = spawnBoat(game, 0, kind, p.x + dy * 120, p.y - dx * 120); b.x = b.px = p.x + dy * 150 * (k % 2 ? 1 : -1); b.y = b.py = p.y - dx * 150 * (k % 2 ? 1 : -1) } } // (also lines up a cargo boat, a gunship and an infantry boat to compare sprite sizes)
    zb.volleyCd = 0.2
    game.diplomacy.set(0, 1, 'war', 0)
    for (let i = 0; i < 25 * 12 && !game.fx.some(f => f.kind === 'boom' && f.t > 0.25); i++) game.step(1 / 25) // fast-forward to the first explosion
    if (/demo=burn/.test(location.search)) { zb.hp = zb.maxHp * 0.1; zb.fireT = 40 } // (dev aid: a burning Zumwalt)
    if (/demo=sail/.test(location.search)) { // (dev aid: the player's ships sail on past the camera, to look at their wakes)
      game.diplomacy.set(0, 1, 'neutral', 0)
      game.boats.filter(q => q.faction === 0).forEach((q, i) => { const p = P(4 + i * 2); orderSail(game, q, [p.x + dy * 60 * i, p.y - dx * 60 * i, P(24).x + dy * 120 * i, P(24).y - dx * 120 * i]) })
    }
    if (/demo=barge/.test(location.search)) for (const q of game.boats) if (q.kind === 'barge' && q.docked) q.open = true // (dev aid: the shoreline barge has its ramp down)
    const dock = /demo=dock/.test(location.search), me = game.boats.find(q => q.faction === 0 && q.kind === 'boat')!
    game.selection = { kind: 'boats', ids: [dock ? me.id : zb.id] }
    const c = dock ? { x: me.x, y: me.y } : P(6)
    cam.zoom = dock ? 1.2 : 0.9; cam.x = c.x - view.w / cam.zoom / 2; cam.y = c.y - view.h / cam.zoom / 2
    return
  }
}

export function GameView({ assets, params, onExit, onLoad }: { assets: Assets; params: NewGameParams; onExit: () => void; onLoad: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const camRef = useRef<Camera | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [dialog, setDialog] = useState<null | 'saves' | 'debug'>(() => (import.meta.env.DEV && /[?&]panel=debug/.test(location.search) ? 'debug' : null)) // (dev aid: ?panel=debug opens the War Room at once)
  const [paused, setPaused] = useState(false)
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog
  const apiRef = useRef<HudActions | null>(null)
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [perf, setPerf] = useState<string | null>(null)
  const [brush, setBrush] = useState(false)
  const showPerf = useRef(import.meta.env.DEV || /[?&]debug/.test(location.search))

  useEffect(() => {
    const canvas = canvasRef.current!
    const game = params.save ? restoreGame(params, params.save.json) : Game.fromSeed(params.seed, params.kingdoms ?? 0, params.playerTowns, { archipelago: true, playerColor: params.color, startLumber: params.lumber })
    gameRef.current = game; setGame(game)
    if (import.meta.env.DEV && !params.save) { const ff = Number(new URLSearchParams(location.search).get('ff')); for (let i = 0; i < ff * 25; i++) game.step(1 / 25) } // dev aid: ?ff=600 fast-forwards ten minutes
    const renderer = new Renderer(assets, game)
    const view = { w: 800, h: 600, dpr: 1 }
    const cam: Camera = { x: 0, y: 0, zoom: 0.4 }
    const town = game.towns.find(t => t.owner === 0 && !t.ruined) ?? game.towns.find(t => !t.ruined) ?? game.towns[0]
    camRef.current = cam
    let minZoom = 0.1, placed = false
    if (params.save?.cam) { Object.assign(cam, params.save.cam); placed = true } // (a loaded match looks where it was saved)
    let dprNow = 2 // internal pixel density (adaptive: lowered when the frame rate stays low, raised again when there is headroom)
    let slow = 0, fast = 0
    const input = new InputController(game, cam, () => view)
    const sfx = new Sfx()

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      view.w = r.width; view.h = r.height; view.dpr = Math.min(dprNow, window.devicePixelRatio || 1)
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
    if (import.meta.env.DEV && /[?&]demo=(ships|dock|fleet|burn|sail|barge)/.test(location.search)) demoShips(game, cam, view) // dev aid: ships next to the player's coast
    if (import.meta.env.DEV && /demo=knight/.test(location.search) && town) { // dev aid: a few knights beside the player's town, some of them galloping
      for (let i = 0; i < 5; i++) { const u = game.spawnUnit(0, town.x + 110 + (i % 3) * 70, town.y + 90 + Math.floor(i / 3) * 80, 'knight'); u.hp = u.maxHp; if (i % 2 === 0) game.orderMoveTo(u, u.x + 900, u.y - 300) }
      game.kingdoms[0].produce.knight = true
      if (/demo=knightfight/.test(location.search)) { // (and a fight to watch the lance thrust: two enemy warriors charge them)
        game.diplomacy.set(0, 1, 'war', 0)
        for (let i = 0; i < 2; i++) { const e = game.spawnUnit(1, town.x + 330 + i * 40, town.y + 120 + i * 50, 'warrior'); e.hp = e.maxHp; game.orderMoveTo(e, town.x + 200, town.y + 130 + i * 40) }
        for (const u of game.units) if (u.type === 'knight' && u.faction === 0) game.orderMoveTo(u, town.x + 420, town.y + 140) // (the knights ride out to meet them)
      }
      cam.zoom = 1.3; cam.x = town.x + 280 - view.w / cam.zoom / 2; cam.y = town.y + 40 - view.h / cam.zoom / 2
    }
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
      placeSettlement: () => { game.placing = game.placing === 'settlement' ? false : 'settlement' },
      placeYard: () => { game.placing = game.placing === 'yard' ? false : 'yard' },
      placeOutpost: () => { game.placing = game.placing === 'outpost' ? false : 'outpost' },
      strike: () => { game.strikeMode = !game.strikeMode; game.routePick = null },
      clearStrikes: () => game.clearStrikes(),
      adjustWant: (k, d) => game.adjustWant(k, d),
      beginRoute: () => { game.beginRoutePick(); game.strikeMode = false },
      cancelRoute: () => game.cancelRoutePick(),
      clearRoute: () => game.clearRoute(),
      upgradeTown: id => game.upgradeTown(id),
      unloadCargo: (k, n) => game.unloadCargo(k, n),
      abandonSettlement: id => { if (window.confirm('Abandon this settlement?\n\nYou lose your claim on it and everything stored there. The first unit of any kingdom — even a rival — to reach it will claim it.')) game.abandonSettlement(id) },
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
      openSaves: () => setDialog('saves'),
      openRamp: () => game.toggleRamp(),
      openDebug: () => setDialog('debug'),
    }
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Tab') { e.preventDefault(); setDialog(d => (d === 'debug' ? null : 'debug')); return }
      if (dialogRef.current) { if (e.key === 'Escape') setDialog(null); return } // (a dialog is open: the map keys stay quiet)
      if (e.key === 'b' || e.key === 'B') game.toggleBlockSelection()
      if (e.key === 's' || e.key === 'S') input.stop() // S cancels the order being drawn and stops the selected units
      if (e.key === 'c' || e.key === 'C') { const on = input.toggleBrush(); setBrush(on); canvas.style.cursor = on ? BRUSH_CURSOR : '' }
      if (e.key === 'm' || e.key === 'M') sfx.toggleMute()
      if (e.key === 'f' || e.key === 'F') game.toggleRamp() // lower / raise the ramp of the selected docked barge
      if (e.key === '`') showPerf.current = !showPerf.current
      if (e.key === 'Escape') { game.selection = null; game.placing = false; game.strikeMode = false; game.routePick = null; if (input.brush) { input.toggleBrush(); setBrush(false); canvas.style.cursor = '' } }
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
      if (fpsClock >= 0.5) {
        fps = frames / fpsClock; frames = 0; fpsClock = 0
        // adaptive resolution: ~1.5 s under 30 fps drops the pixel density a notch; ~8 s over 55 fps brings it back up
        slow = fps < 30 ? slow + 1 : 0; fast = fps > 55 ? fast + 1 : 0
        const native = Math.min(2, window.devicePixelRatio || 1)
        if (slow >= 3 && dprNow > 1) { dprNow = Math.max(1, dprNow - 0.5); slow = 0; resize() }
        else if (fast >= 16 && dprNow < native) { dprNow = Math.min(native, dprNow + 0.5); fast = 0; resize() }
      }
      if (hudClock > 0.2) {
        hudClock = 0; setHud(game.hud())
        const st = renderer.stats
        setPerf(showPerf.current ? `fps ${fps.toFixed(0)}  sim ${game.simMs.toFixed(2)}ms  territory ${game.territoryMs.toFixed(2)}ms (${game.recomputeCount}x)\ndraw ${st.drawMs.toFixed(2)}ms  sprites ${st.visibleSprites}  foam ${st.foamVisible}  chunks built/frame ${st.chunksBuilt}\nmap ${game.world.w}×${game.world.h}  units ${game.units.length}  towers ${game.towers.length}  zoom ${cam.zoom.toFixed(2)}` : null)
      }
      raf = requestAnimationFrame(loop)
    }
    setHud(game.hud())
    raf = requestAnimationFrame(loop)
    const auto = setInterval(() => { if (!dialogRef.current && game.status === 'playing') void saveGame(game, cam, params, 'Autosave', AUTOSAVE_ID, true).catch(() => { /* storage unavailable: autosave is best-effort */ }) }, 4 * 60 * 1000)
    return () => {
      clearInterval(auto)
      cancelAnimationFrame(raf); ro.disconnect()
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', ctxMenu); window.removeEventListener('keydown', key)
      apiRef.current = null
      gameRef.current = null; camRef.current = null
    }
  }, [assets, params, onExit])

  // the saves dialog always freezes the match; the War Room only when asked to
  useEffect(() => {
    if (!game || !(dialog === 'saves' || (dialog === 'debug' && paused))) return
    const prev = game.speed || 1
    game.speed = 0
    return () => { game.speed = prev }
  }, [game, dialog, paused])

  const saveFromDialog = async (name: string, overwriteId?: string) => {
    if (!gameRef.current || !camRef.current) return
    await saveGame(gameRef.current, camRef.current, params, name, overwriteId ?? `save-${Date.now().toString(36)}`, false)
  }

  return (
    <div className="stage">
      <canvas ref={canvasRef} aria-label="Borderlands map" />
      {hud && apiRef.current && <Hud hud={hud} perf={perf} actions={apiRef.current} brush={brush} />}
      {game && dialog === 'debug' && <DebugPanel game={game} paused={paused} onPause={setPaused} onClose={() => setDialog(null)} />}
      {game && dialog === 'saves' && <SavesDialog defaultName={`${game.kingdoms[0].name} · ${Math.floor(game.time / 60)} min`} onSave={saveFromDialog} onLoad={id => { setDialog(null); onLoad(id) }} onClose={() => setDialog(null)} />}
    </div>
  )
}

/** Write the match to browser storage (see saves.ts). */
async function saveGame(game: Game, cam: Camera, params: NewGameParams, name: string, id: string, auto: boolean) {
  await putSave({
    id, name, auto, savedAt: new Date().toISOString(), cam: { x: cam.x, y: cam.y, zoom: cam.zoom },
    params: { seed: params.seed, color: params.color, kingdoms: params.kingdoms, playerTowns: params.playerTowns, lumber: params.lumber },
    gameTime: game.time, kingdomName: game.kingdoms[0].name, towns: game.ownedTowns(0), kingdoms: game.kingdoms.length,
  }, serializeGame(game))
}
