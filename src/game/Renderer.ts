import type { Assets } from './AssetLoader'
import { drawSheet, type Sheet } from './Sprites'
import { drawEmblem } from './Emblems'
import { autotileNumber, flatFrame, isCoastCell } from './Autotile'
import { clampCamera, type Camera } from './Camera'
import { FACTION_COLORS, FACTION_DARK, FACTION_RGB, MAP, PAWN, SWAY_ZOOM, TILE, TOWER, TOWN, UNIT, UNIT_BODY } from './config'
import type { Game } from './Game'
import { hash2 } from './rng'
import { holdFrame, loopFrame } from './SpriteAnimator'
import { forEachBorderEdge } from './TerritorySystem'
import { BOAT, CARGO, DOCK, GOLD, GUNSHIP, MEAT, OUTPOST, SETTLE, ZUMWALT, goldTier, shipLength, type BoatKind } from './config'
import { dockTimeOf, SINK_SECONDS } from './BoatSystem'
import bargeOffsets from './bargeOffsets.json'
import { isShipKind } from './Game'
import { loadPercent } from './Trade'
import type { Boat, GoldDeposit, Outpost, Pawn, Sheep, Tower, Town, Unit, Yard } from './types'
import { yardShoreCells } from './Yards'

export type RenderUi = { draft: number[] | null; hoverTree: number; showPerf: boolean; hover: { x: number; y: number } | null }
type Puff = { x: number; y: number; vx: number; vy: number; t: number; life: number; size: number; set: 0 | 1 }
type Wake = { lx: number; ly: number; lt: number; hx: number; hy: number; acc: number; n: number; pts: { x: number; y: number; t: number }[]; puffs: Puff[] }
export type RenderStats = { visibleSprites: number; dirtyChunks: number; chunksBuilt: number; foamVisible: number; drawMs: number }

const CHUNK = MAP.chunk
const TREE_BASE = [232, 232, 162, 162] // trunk-base y inside each Tree sheet frame
const STUMP_BASE = 232
type Item = { y: number; k: number; i: number }
const K = { tree: 0, stump: 1, bush: 2, rock: 3, town: 4, unit: 5, pawn: 6, tower: 7, boat: 8, gold: 9, sheep: 10, outpost: 11, yard: 12 }
const boatLength = (k: BoatKind) => shipLength(k)
const TOWER_BASE = 250 // foot of Tower.png (128×256)
const TOWER_PLATFORM = 122 // height of the middle of the tower's top platform above its base cell

export class Renderer {
  stats: RenderStats = { visibleSprites: 0, dirtyChunks: 0, chunksBuilt: 0, foamVisible: 0, drawMs: 0 }
  private chunks = new Map<number, HTMLCanvasElement | null>()
  private foam: { x: number; y: number; phase: number }[] = []
  private waterPattern: CanvasPattern | null = null
  private tintCanvas: HTMLCanvasElement
  private tintCtx: CanvasRenderingContext2D
  private drawnVersion = -1
  private colorKey = ''
  private zoomNow = 1
  private borders: Path2D[] = []
  private cutPath = new Path2D()
  private hatch: CanvasPattern | null = null
  private items: Item[] = []
  private itemCount = 0

  constructor(private assets: Assets, private game: Game) {
    const { w, h } = game.world
    this.tintCanvas = document.createElement('canvas'); this.tintCanvas.width = w; this.tintCanvas.height = h
    this.tintCtx = this.tintCanvas.getContext('2d')!
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (game.world.land[y * w + x] && isCoastCell(game.world, x, y)) this.foam.push({ x, y, phase: hash2(x, y, game.world.seed) * 16 })
    const hc = document.createElement('canvas'); hc.width = hc.height = 16
    const hx = hc.getContext('2d')!; hx.strokeStyle = 'rgba(120,20,20,.55)'; hx.lineWidth = 3
    hx.beginPath(); for (let i = -16; i <= 32; i += 8) { hx.moveTo(i, 16); hx.lineTo(i + 16, 0) } hx.stroke()
    this.hatch = hx.createPattern(hc, 'repeat')
  }

  // ------------------------------------------------------------ cached layers
  /** Baked ground for one 8×8 tile chunk, or null for chunks that are open ocean. */
  private chunk(cx: number, cy: number): HTMLCanvasElement | null {
    const key = cy * 1000 + cx
    if (this.chunks.has(key)) return this.chunks.get(key)!
    const { w, h } = this.game.world
    const x0 = cx * CHUNK, y0 = cy * CHUNK, tw = Math.min(CHUNK, w - x0), th = Math.min(CHUNK, h - y0)
    let any = false
    for (let y = 0; y < th && !any; y++) for (let x = 0; x < tw; x++) if (this.game.world.land[(y0 + y) * w + x0 + x]) { any = true; break }
    if (!any) { this.chunks.set(key, null); return null }
    const c = document.createElement('canvas'); c.width = tw * TILE; c.height = th * TILE
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      if (!this.game.world.land[(y0 + y) * w + x0 + x]) continue
      const f = flatFrame(autotileNumber(this.game.world, x0 + x, y0 + y))
      g.drawImage(this.assets.tileset, f.sx, f.sy, f.sw, f.sh, x * TILE, y * TILE, TILE, TILE)
    }
    this.chunks.set(key, c); this.stats.chunksBuilt++
    return c
  }

  private rebuildTerritory() {
    const g = this.game, { w, h } = g.world
    const img = this.tintCtx.createImageData(w, h)
    this.cutPath = new Path2D()
    for (let i = 0; i < w * h; i++) {
      const c = g.controller[i]
      if (!c) continue
      const rgb = FACTION_RGB[g.displayColor(c - 1)]
      img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = g.buffer[i] ? 42 : 84 // an outpost's combat buffer is drawn at half the strength of real territory
      if (!g.supplied[i]) this.cutPath.rect((i % w) * TILE, Math.floor(i / w) * TILE, TILE, TILE)
    }
    this.tintCtx.putImageData(img, 0, 0)
    this.borders = g.kingdoms.map(() => new Path2D())
    forEachBorderEdge(g.controller, w, h, (x0, y0, x1, y1, f, o) => {
      if (o !== 0 && g.displayColor(f - 1) === g.displayColor(o - 1)) return // merged alliance colours: no line between the allies
      const p = this.borders[f - 1]
      let ax = x0 * TILE, ay = y0 * TILE, bx = x1 * TILE, by = y1 * TILE
      if (o !== 0) { // shared frontline: each side draws one half so the line is drawn once, split between the two colours
        const mx = (ax + bx) / 2, my = (ay + by) / 2
        if (f < o) { bx = mx; by = my } else { ax = mx; ay = my }
      }
      p.moveTo(ax, ay); p.lineTo(bx, by)
    })
    this.drawnVersion = g.territoryVersion
  }

  private waterRgb: string | null = null
  /** The water tile's colour (measured once from the sprite; it is a flat colour). */
  private waterColor(img: HTMLImageElement): string {
    if (this.waterRgb) return this.waterRgb
    try {
      const c = document.createElement('canvas'); c.width = c.height = 4
      const x = c.getContext('2d', { willReadFrequently: true })!
      x.drawImage(img, 0, 0, img.width, img.height, 0, 0, 4, 4)
      const d = x.getImageData(2, 2, 1, 1).data
      this.waterRgb = `rgb(${d[0]},${d[1]},${d[2]})`
    } catch { this.waterRgb = 'rgb(71,171,169)' }
    return this.waterRgb
  }

  // ------------------------------------------------------------ main draw
  draw(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, dpr: number, cam: Camera, alpha: number, ui: RenderUi) {
    const t0 = performance.now()
    const g = this.game, a = this.assets, { w, h } = g.world
    const time = performance.now() / 1000
    clampCamera(cam, viewW, viewH, w, h)
    const colorKey = g.kingdoms.map(k => g.displayColor(k.id)).join(',')
    if (this.drawnVersion !== g.territoryVersion || colorKey !== this.colorKey) { this.colorKey = colorKey; this.rebuildTerritory() }
    this.stats.visibleSprites = 0; this.stats.foamVisible = 0; this.stats.chunksBuilt = 0

    this.zoomNow = cam.zoom
    const s = cam.zoom * dpr
    const shk = g.shake > 0 ? Math.min(1, g.shake) * 12 * dpr : 0 // screen shake (town capture / explosions)
    const tx = Math.round(-cam.x * s + (shk ? (Math.random() - 0.5) * shk : 0)), ty = Math.round(-cam.y * s + (shk ? (Math.random() - 0.5) * shk : 0))
    const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + viewW / cam.zoom, vy1 = cam.y + viewH / cam.zoom
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    // 1. water background: the Tiny Swords water tile is one flat colour, so a single solid fill replaces the old solid fill + repeating-pattern
    // fill (two full-screen fills per frame, the pattern one being the slow kind). This was over half of the frame time on a retina screen.
    ctx.fillStyle = this.waterColor(a.water); ctx.fillRect(0, 0, viewW * dpr, viewH * dpr)
    ctx.setTransform(s, 0, 0, s, tx, ty)

    // 2. animated shoreline foam (seeded phase per cell)
    const fs = a.foam
    if (cam.zoom >= 0.17) for (const f of this.foam) { // (too small to see when zoomed far out)
      const px = f.x * TILE, py = f.y * TILE
      if (px + TILE * 2 < vx0 || px - TILE > vx1 || py + TILE * 2 < vy0 || py - TILE > vy1) continue
      const fr = loopFrame(time, 9, fs.frames, f.phase)
      ctx.drawImage(fs.img, fr * fs.fw, 0, fs.fw, fs.fh, px - TILE, py - TILE, fs.fw, fs.fh)
      this.stats.foamVisible++
    }

    // 3. ground chunks (cached, drawn at integer device rectangles)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const cx0 = Math.max(0, Math.floor(vx0 / TILE / CHUNK)), cx1 = Math.min(Math.ceil(w / CHUNK) - 1, Math.floor(vx1 / TILE / CHUNK))
    const cy0 = Math.max(0, Math.floor(vy0 / TILE / CHUNK)), cy1 = Math.min(Math.ceil(h / CHUNK) - 1, Math.floor(vy1 / TILE / CHUNK))
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.chunk(cx, cy)
      if (!c) continue
      const X0 = Math.round(cx * CHUNK * TILE * s + tx), Y0 = Math.round(cy * CHUNK * TILE * s + ty)
      const X1 = Math.round((cx * CHUNK * TILE + c.width) * s + tx), Y1 = Math.round((cy * CHUNK * TILE + c.height) * s + ty)
      ctx.drawImage(c, X0, Y0, X1 - X0, Y1 - Y0)
    }
    this.stats.dirtyChunks = this.stats.chunksBuilt

    // 4. territory tint, unsupplied hatch, borders
    ctx.setTransform(s, 0, 0, s, tx, ty)
    { const gx0 = Math.max(0, Math.floor(vx0 / TILE) - 1), gy0 = Math.max(0, Math.floor(vy0 / TILE) - 1), gx1 = Math.min(w, Math.ceil(vx1 / TILE) + 1), gy1 = Math.min(h, Math.ceil(vy1 / TILE) + 1)
      if (gx1 > gx0 && gy1 > gy0) ctx.drawImage(this.tintCanvas, gx0, gy0, gx1 - gx0, gy1 - gy0, gx0 * TILE, gy0 * TILE, (gx1 - gx0) * TILE, (gy1 - gy0) * TILE) } // (only the tiles on screen)
    if (this.hatch) { ctx.fillStyle = this.hatch; ctx.fill(this.cutPath) }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'
    const lw = Math.max(5, 2.2 / cam.zoom)
    for (let k = 0; k < this.borders.length; k++) {
      ctx.strokeStyle = 'rgba(10,14,20,.35)'; ctx.lineWidth = lw + 3; ctx.stroke(this.borders[k])
      ctx.strokeStyle = FACTION_COLORS[g.displayColor(k)]; ctx.lineWidth = lw; ctx.stroke(this.borders[k])
    }

    this.drawFog(ctx, vx0, vy0, vx1, vy1, time)

    // 5. grid overlay
    { // only the grid lines that are on screen, and only the part of each line in view
      const gx0 = Math.max(0, Math.floor(vx0 / TILE)), gx1 = Math.min(w, Math.ceil(vx1 / TILE)), gy0 = Math.max(0, Math.floor(vy0 / TILE)), gy1 = Math.min(h, Math.ceil(vy1 / TILE))
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = Math.max(1, 1.2 / cam.zoom)
      ctx.beginPath()
      for (let x = gx0; x <= gx1; x++) { ctx.moveTo(x * TILE, gy0 * TILE); ctx.lineTo(x * TILE, gy1 * TILE) }
      for (let y = gy0; y <= gy1; y++) { ctx.moveTo(gx0 * TILE, y * TILE); ctx.lineTo(gx1 * TILE, y * TILE) }
      ctx.stroke() }

    // 6–8. props, towns, towers and units, depth sorted by ground-contact y
    this.sway = cam.zoom >= SWAY_ZOOM // vegetation is static unless the camera is close
    this.collect(vx0 - 160, vy0 - 220, vx1 + 160, vy1 + 280, alpha)
    for (let n = 0; n < this.sorted.length; n++) {
      const it = this.sorted[n]
      switch (it.k) {
        case K.tree: this.drawTree(ctx, g.world.trees[it.i], time, ui.hoverTree === it.i, this.fadeFor(g.world.trees[it.i])); break
        case K.stump: this.drawStump(ctx, g.world.trees[it.i]); break
        case K.bush: { const d = g.world.decor[it.i], sh = a.bushes[d.variant]; const fr = this.sway ? loopFrame(time, 10, sh.frames, d.phase) : 0; ctx.drawImage(sh.img, fr * sh.fw, 0, sh.fw, sh.fh, d.x - 64, d.y - 100, sh.fw, sh.fh); break }
        case K.rock: { const d = g.world.decor[it.i]; ctx.drawImage(a.rocks[d.variant], d.x - 32, d.y - 46); break }
        case K.town: this.drawTown(ctx, it.i); break
        case K.tower: this.drawTower(ctx, g.towers[it.i], time); break
        case K.yard: this.drawYard(ctx, g.yards[it.i]); break
        case K.unit: this.drawUnit(ctx, g.units[it.i], time, alpha); break
        case K.pawn: this.drawPawn(ctx, g.pawns[it.i], alpha); break
        case K.boat: this.drawBoat(ctx, g.boats[it.i], alpha, time); break
        case K.gold: this.drawGold(ctx, g.goldDeps[it.i]); break
        case K.outpost: this.drawOutpost(ctx, g.outposts[it.i]); break
        case K.sheep: this.drawSheep(ctx, g.sheep[it.i], time); break
      }
    }
    for (const d of g.deaths) this.drawGhost(ctx, d)
    this.drawFloaters(ctx, time)
    this.drawWrecks(ctx)
    this.drawCrates(ctx)
    this.drawProjectiles(ctx)
    this.drawShells(ctx)
    this.drawFx(ctx)

    // 9. selection, routes, indicators
    this.drawOverlays(ctx, alpha, ui, time)
    this.stats.drawMs = performance.now() - t0
  }

  // ---- fog of war: a soft drifting mist. The mottled mist is baked once; only a tiny blurred mask (1 px per tile) is rebuilt when
  // exploration changes, and the GPU composites the two. Only the part of the mist in view is drawn, and nothing at all when no fogged
  // island is on screen. ----
  private fogMist: HTMLCanvasElement | null = null // static: slate-blue mist with light wisps and darker pockets (opaque)
  private fogDark: HTMLCanvasElement | null = null // static: the dark slate core layer
  private fogMask2: HTMLCanvasElement | null = null // the core mask (denser than the fringe mask)
  private fogTmp: HTMLCanvasElement | null = null
  private fogMask: HTMLCanvasElement | null = null // w×h, one pixel per fogged tile (blurred); upscaled smoothly
  private fogTex: HTMLCanvasElement | null = null // mist × mask, rebuilt when the mask changes
  private fogVer = -1
  private fogBuiltAt = -9
  private fogBoxes: { land: number; x0: number; y0: number; x1: number; y1: number }[] | null = null
  private static FOG_S = 3 // mist pixels per tile

  private buildMist() {
    const g = this.game, { w, h } = g.world, S = Renderer.FOG_S, W = w * S, H = h * S, seed = g.world.seed
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!, img = ctx.createImageData(W, H), d = img.data
    const dark = document.createElement('canvas'); dark.width = W; dark.height = H
    const dctx = dark.getContext('2d')!, dimg = dctx.createImageData(W, H), dd = dimg.data
    const hv = (gx: number, gy: number) => hash2(gx, gy, seed + 77)
    const vnoise = (x: number, y: number, o: number) => { const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); return hv(x0 + o, y0) * (1 - sx) * (1 - sy) + hv(x0 + 1 + o, y0) * sx * (1 - sy) + hv(x0 + o, y0 + 1) * (1 - sx) * sy + hv(x0 + 1 + o, y0 + 1) * sx * sy }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const m = vnoise(x / (S * 2.2), y / (S * 2.2), 0) * 0.65 + vnoise(x / (S * 0.9), y / (S * 0.9), 90) * 0.35, wisp = (m - 0.5) * 70, i = (y * W + x) * 4
      d[i] = 150 + wisp; d[i + 1] = 166 + wisp; d[i + 2] = 192 + wisp * 0.9
      d[i + 3] = Math.max(150, Math.min(255, 225 + (m - 0.5) * 110)) // the mottling shows in the opacity too
      dd[i] = 104 + wisp * 0.9; dd[i + 1] = 118 + wisp * 0.9; dd[i + 2] = 150 + wisp * 0.8; dd[i + 3] = Math.max(70, Math.min(215, 150 + (m - 0.5) * 120)) // the core: a soft slate blue (not solid)
    }
    ctx.putImageData(img, 0, 0); dctx.putImageData(dimg, 0, 0)
    this.fogMist = c; this.fogDark = dark
    this.fogTex = document.createElement('canvas'); this.fogTex.width = W; this.fogTex.height = H
    this.fogMask = document.createElement('canvas'); this.fogMask.width = w; this.fogMask.height = h
    this.fogMask2 = document.createElement('canvas'); this.fogMask2.width = w; this.fogMask2.height = h
    this.fogTmp = document.createElement('canvas'); this.fogTmp.width = W; this.fogTmp.height = H
  }

  /** Mask: the fogged tiles blurred over about 2 tiles (so the island's outline melts into a round cloud), composited onto the mist. */
  private rebuildFog(time: number) {
    const g = this.game, { w, h } = g.world, S = Renderer.FOG_S
    let a = new Float32Array(w * h), b = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) a[i] = g.fog[i] ? 1 : 0
    const R = 2
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -R; k <= R; k++) s += a[y * w + Math.min(w - 1, Math.max(0, x + k))]; b[y * w + x] = s / (2 * R + 1) }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -R; k <= R; k++) s += b[Math.min(h - 1, Math.max(0, y + k)) * w + x]; a[y * w + x] = s / (2 * R + 1) }
    }
    const mc = this.fogMask!.getContext('2d')!, mc2 = this.fogMask2!.getContext('2d')!, img = mc.createImageData(w, h), img2 = mc2.createImageData(w, h), d = img.data, d2 = img2.data
    for (let i = 0; i < w * h; i++) {
      const k = Math.min(1, a[i] * 1.4), sm = k * k * (3 - 2 * k) * 0.9 + k * 0.1
      d[i * 4 + 3] = Math.round(255 * Math.min(1, sm * 1.05))                 // fringe + body: pale mist
      d2[i * 4 + 3] = Math.round(255 * Math.pow(Math.max(0, k - 0.15) / 0.85, 1.6)) // core only: dark slate
    }
    mc.putImageData(img, 0, 0); mc2.putImageData(img2, 0, 0)
    const comp = (dst: HTMLCanvasElement, src: HTMLCanvasElement, mask: HTMLCanvasElement) => {
      const c = dst.getContext('2d')!
      c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w * S, h * S)
      c.drawImage(src, 0, 0)
      c.globalCompositeOperation = 'destination-in'; c.imageSmoothingEnabled = true // the mask is scaled up smoothly: soft edges for free
      c.drawImage(mask, 0, 0, w, h, 0, 0, w * S, h * S)
      c.globalCompositeOperation = 'source-over'
    }
    comp(this.fogTex!, this.fogMist!, this.fogMask!)
    comp(this.fogTmp!, this.fogDark!, this.fogMask2!)
    this.fogTex!.getContext('2d')!.drawImage(this.fogTmp!, 0, 0)
    this.fogVer = g.fogVersion; this.fogBuiltAt = time
  }

  private drawFog(ctx: CanvasRenderingContext2D, vx0: number, vy0: number, vx1: number, vy1: number, time = 0) {
    const g = this.game
    if (!g.fogLands.size) return
    const { w, h } = g.world, S = Renderer.FOG_S
    if (!this.fogBoxes) { // bounding box (in tiles) of each fogged island, once
      const boxes = new Map<number, { land: number; x0: number; y0: number; x1: number; y1: number }>()
      for (let i = 0; i < w * h; i++) { const L = g.info.landmass[i]; if (L < 0 || !g.fogLands.has(L)) continue; const x = i % w, y = (i / w) | 0, b = boxes.get(L) ?? { land: L, x0: x, y0: y, x1: x, y1: y }; b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); boxes.set(L, b) }
      this.fogBoxes = [...boxes.values()]
    }
    const tx0 = vx0 / TILE - 3, ty0 = vy0 / TILE - 3, tx1 = vx1 / TILE + 3, ty1 = vy1 / TILE + 3
    if (!this.fogBoxes.some(b => !g.revealedLands.has(b.land) && b.x1 + 3 >= tx0 && b.x0 - 3 <= tx1 && b.y1 + 3 >= ty0 && b.y0 - 3 <= ty1)) return // no fog on screen: no cost
    if (!this.fogMist) this.buildMist()
    if (this.fogVer !== g.fogVersion && time - this.fogBuiltAt > 0.2) this.rebuildFog(time)
    const tex = this.fogTex!
    const sx0 = Math.max(0, Math.floor(tx0 * S)), sy0 = Math.max(0, Math.floor(ty0 * S)), sx1 = Math.min(w * S, Math.ceil(tx1 * S)), sy1 = Math.min(h * S, Math.ceil(ty1 * S))
    if (sx1 <= sx0 || sy1 <= sy0) return
    const prev = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = true
    const dx = sx0 / S * TILE, dy = sy0 / S * TILE, dw = (sx1 - sx0) / S * TILE, dh = (sy1 - sy0) / S * TILE
    ctx.drawImage(tex, sx0, sy0, sx1 - sx0, sy1 - sy0, dx, dy, dw, dh)
    if (this.zoomNow >= 0.3) { // a second, drifting copy: wisps sliding slowly across the mist (skipped when zoomed out, where it cannot be seen)
      ctx.globalAlpha = 0.34
      ctx.drawImage(tex, sx0, sy0, sx1 - sx0, sy1 - sy0, dx + Math.sin(time * 0.11) * 46, dy + Math.cos(time * 0.08) * 34, dw, dh)
      ctx.globalAlpha = 1
    }
    ctx.imageSmoothingEnabled = prev
  }

  // ------------------------------------------------------------ collection & entities
  private sorted: Item[] = []
  private occ: number[] = [] // x,y of visible units and pawns, for see-through trees
  private treeFade = new Float32Array(0)
  private sway = false
  private push(y: number, k: number, i: number) {
    let it = this.items[this.itemCount]
    if (!it) { it = { y: 0, k: 0, i: 0 }; this.items[this.itemCount] = it }
    it.y = y; it.k = k; it.i = i; this.itemCount++
    this.sorted.push(it)
    this.stats.visibleSprites++
  }
  private collect(x0: number, y0: number, x1: number, y1: number, alpha: number) {
    const g = this.game
    this.itemCount = 0; this.sorted.length = 0; this.occ.length = 0
    const inView = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1
    const fog = g.fog
    // level of detail: the further out the camera, the fewer trees, and no stumps / shrubs / rocks at all
    const z = this.zoomNow
    const treeMod = z < 0.2 ? 5 : z < 0.28 ? 3 : z < 0.38 ? 2 : 1
    const showStump = z >= 0.4, showBush = z >= 0.34, showRock = z >= 0.26
    for (const t of g.world.trees) {
      if (!inView(t.x, t.y) || fog[t.cell]) continue // fogged land hides its trees
      if (t.chopped) { if (showStump) this.push(t.y, K.stump, t.id) } else if (treeMod === 1 || t.id % treeMod === 0) this.push(t.y, K.tree, t.id)
    }
    g.world.decor.forEach((d, i) => { if (inView(d.x, d.y) && !fog[d.cell] && (d.type === 'bush' ? showBush : showRock)) this.push(d.y, d.type === 'bush' ? K.bush : K.rock, i) })
    g.towns.forEach((t, i) => { if (!t.ruined && inView(t.x, t.y)) this.push(t.y + 40, K.town, i) })
    g.outposts.forEach((o, i) => { if (inView(o.x, o.y)) this.push(o.y + 22, K.outpost, i) })
    g.goldDeps.forEach((d, i) => { if (!d.taken && !fog[d.cell] && inView(d.x, d.y) && (z >= 0.18 || d.stone >= 3)) this.push(d.y, K.gold, i) })
    if (z >= MEAT.sheepHideZoom) g.sheep.forEach((s, i) => { if (inView(s.x, s.y)) this.push(s.y, K.sheep, i) }) // sheep vanish when the camera is zoomed far out
    g.towers.forEach((t, i) => { if (inView(t.x, t.y)) this.push(t.y + 36, K.tower, i) })
    g.yards.forEach((q, i) => { if (inView(q.x, q.y)) this.push(q.y + 34, K.yard, i) })
    g.boats.forEach((b, i) => { const y = b.py + (b.y - b.py) * alpha; if (inView(b.x, y)) this.push(y - 40, K.boat, i) }) // hulls sit under land units standing on the shore
    g.pawns.forEach((p, i) => { const y = p.py + (p.y - p.py) * alpha; if (inView(p.x, y)) this.push(y, K.pawn, i) }) // pawns never make trees see-through
    g.units.forEach((u, i) => { if (u.inTower >= 0 || (u.faction !== 0 && u.cell >= 0 && fog[u.cell])) return; // strangers in the fog are not seen
      const y = u.py + (u.y - u.py) * alpha; if (inView(u.x, y)) { this.push(y, K.unit, i); this.occ.push(u.x, y) } })
    this.sorted.sort((p, q) => p.y - q.y)
  }

  /** Trees turn 25 % opaque while a unit stands behind (or just beside) their canopy, easing in and out so units stay visible in forests. */
  private fadeFor(t: { id: number; x: number; y: number; kind: number }): number {
    if (this.treeFade.length !== this.game.world.trees.length) this.treeFade = new Float32Array(this.game.world.trees.length).fill(1)
    const halfW = (t.kind <= 1 ? 56 : 50) + 10, height = t.kind <= 1 ? 200 : 150
    let target = 1
    for (let i = 0; i < this.occ.length; i += 2) {
      const dx = Math.abs(this.occ[i] - t.x), dy = t.y - this.occ[i + 1] // dy > 0: the unit is further up the screen, i.e. behind the trunk
      if (dx < halfW && dy > -6 && dy < height) { target = 0.25; break }
    }
    const f = this.treeFade[t.id] + (target - this.treeFade[t.id]) * 0.3
    this.treeFade[t.id] = Math.abs(f - target) < 0.01 ? target : f
    return this.treeFade[t.id]
  }
  private drawTree(ctx: CanvasRenderingContext2D, t: { x: number; y: number; kind: number; phase: number; progress: number; claimedBy: number }, time: number, hover: boolean, fade = 1) {
    const sh = this.assets.trees[t.kind], fr = this.sway ? loopFrame(time, 10, sh.frames, t.phase) : 0
    const chopping = t.progress > 0 && t.claimedBy >= 0
    const shake = chopping ? Math.sin(time * 28) * 1.2 : 0
    if (fade < 1) ctx.globalAlpha = fade
    ctx.drawImage(sh.img, fr * sh.fw, 0, sh.fw, sh.fh, t.x - sh.fw / 2 + shake, t.y - TREE_BASE[t.kind], sh.fw, sh.fh)
    ctx.globalAlpha = 1
    if (hover || (chopping && this.game.selection?.kind === 'pawn')) {
      const spec = t.kind <= 1 ? PAWN.conifer : PAWN.broadleaf, p = Math.min(1, t.progress / spec.time)
      if (t.progress > 0) this.bar(ctx, t.x, t.y - TREE_BASE[t.kind] + 40, 40, p, '#f0cf6a')
    }
  }
  private drawStump(ctx: CanvasRenderingContext2D, t: { x: number; y: number; kind: number }) {
    ctx.drawImage(this.assets.stumps[t.kind], t.x - 96, t.y - STUMP_BASE)
  }
  private yardGeo = new Map<number, { segs: number[]; flip: boolean }>()
  /** A yard's coast is static: the edges of its shore cells that face open sea (the white line) and which side the water lies on (the slipway faces it), worked out once. */
  private yardGeometry(q: Yard) {
    let geo = this.yardGeo.get(q.id)
    if (geo) return geo
    const g = this.game, { w, h } = g.world, segs: number[] = []
    for (const i of yardShoreCells(g, q)) {
      const cx = i % w, cy = (i / w) | 0
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= w || y >= h || g.world.land[y * w + x] || !g.info.sea[y * w + x]) continue
        if (dy) { const ey = (dy < 0 ? cy : cy + 1) * TILE; segs.push(cx * TILE, ey, (cx + 1) * TILE, ey) } else { const ex = (dx < 0 ? cx : cx + 1) * TILE; segs.push(ex, cy * TILE, ex, (cy + 1) * TILE) }
      }
    }
    let east = 0, west = 0
    for (let yy = Math.max(0, q.cy - 4); yy <= Math.min(h - 1, q.cy + 4); yy++) for (let xx = Math.max(0, q.cx - 5); xx <= Math.min(w - 1, q.cx + 5); xx++) if (!g.world.land[yy * w + xx] && g.info.sea[yy * w + xx]) { if (xx > q.cx) east++; else if (xx < q.cx) west++ }
    geo = { segs, flip: west > east }
    this.yardGeo.set(q.id, geo)
    return geo
  }
  private drawYard(ctx: CanvasRenderingContext2D, q: Yard) {
    const img = this.assets.props.yard, geo = this.yardGeometry(q)
    ctx.save()
    ctx.translate(q.x, q.y + 34)
    if (geo.flip) ctx.scale(-1, 1)
    ctx.drawImage(img, -img.width * 0.62, -img.height + 4)
    ctx.restore()
    this.badge(ctx, q.faction, q.x + (geo.flip ? 38 : -38), q.y + 34 - img.height - 2, 22)
    if (q.flash > 0) { ctx.strokeStyle = `rgba(255,248,200,${Math.min(1, q.flash)})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(q.x, q.y + 10, 55 + (1 - q.flash) * 55, 0, Math.PI * 2); ctx.stroke() }
  }
  /** The white line along each of the player's yards: where ships may be laid down (bright while placing a ship or yard, faint otherwise). */
  private drawYardLines(ctx: CanvasRenderingContext2D) {
    const g = this.game, strong = !!g.placing && g.placing !== 'tower' && g.placing !== 'lot' && g.placing !== 'outpost' && g.placing !== 'settlement'
    for (const q of g.yards) {
      if (q.faction !== 0) continue
      const { segs } = this.yardGeometry(q)
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass === 0 ? `rgba(0,0,0,${strong ? 0.5 : 0.2})` : `rgba(255,255,255,${strong ? 0.95 : 0.4})`; ctx.lineWidth = pass === 0 ? 7 : 3.5; ctx.lineCap = 'round'
        ctx.beginPath(); for (let i = 0; i < segs.length; i += 4) { ctx.moveTo(segs[i], segs[i + 1]); ctx.lineTo(segs[i + 2], segs[i + 3]) } ctx.stroke()
      }
    }
  }
  private drawTown(ctx: CanvasRenderingContext2D, i: number) {
    const t = this.game.towns[i], color = this.game.kingdoms[Math.max(0, t.owner)].color
    if (t.kind === 'settlement') { this.drawSettlement(ctx, t); return }
    const img = t.kind === 'barracks' ? this.assets.barracks[color] : t.level >= 2 ? this.assets.monasteries[color] : this.assets.houses[color] // (an upgraded town becomes a monastery)
    const top = t.y + 46 - img.height // (the roof: the badge, health bar and labels hang from it, whatever the sprite's height)
    ctx.drawImage(img, t.x - img.width / 2, top)
    this.badge(ctx, t.owner, t.x, top - 4, 26)
    if (t.level >= 2) this.levelPip(ctx, t.x + img.width * 0.32, top + 6, t.level)
    if (t.hp < t.maxHp - 1) this.bar(ctx, t.x, top + 26, 70, t.hp / t.maxHp, '#78d46a')
    if (t.raze && t.owner !== 0) { ctx.fillStyle = 'rgba(150,20,20,.9)'; ctx.fillRect(t.x - 26, top - 4, 52, 16); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('RAZE', t.x, top + 8) }
    if (t.flash > 0) { ctx.strokeStyle = `rgba(255,248,200,${t.flash / 1.2})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(t.x, t.y + 20, TOWN.captureRadius + (1.2 - t.flash) * 60, 0, Math.PI * 2); ctx.stroke() }
  }
  private levelPip(ctx: CanvasRenderingContext2D, x: number, y: number, level: number) {
    ctx.fillStyle = 'rgba(12,16,22,.85)'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffd86a'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(String(level), x, y + 4)
  }
  /** A settlement: a stone pillar (level 1) or the statue (level 2, with its crates), plus a meat gauge and a collapse countdown. */
  private drawSettlement(ctx: CanvasRenderingContext2D, t: Town) {
    const P = this.assets.props, sc = 2, img = t.level >= 2 ? P.statue : P.pillar
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(t.x, t.y + 40, 34, 12, 0, 0, Math.PI * 2); ctx.fill()
    const hh = img.height * sc
    if (t.level >= 2) { for (const [dx, dy] of (t.level >= 3 ? [[52, 34], [78, 44], [58, 56], [90, 62], [40, 60]] : [[52, 34], [78, 44], [58, 56]])) ctx.drawImage(P.crate, t.x + dx - 24, t.y + dy - 62, P.crate.width * 1.5, P.crate.height * 1.5) }
    ctx.drawImage(img, t.x - img.width * sc / 2, t.y + 44 - hh, img.width * sc, hh)
    if (t.owner >= 0) this.badge(ctx, t.owner, t.x, t.y + 44 - hh - 6, 24)
    else { ctx.fillStyle = 'rgba(60,60,70,.9)'; ctx.fillRect(t.x - 44, t.y - hh - 6, 88, 16); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('ABANDONED', t.x, t.y - hh + 6) }
    if (t.level >= 2) this.levelPip(ctx, t.x + 34, t.y + 44 - hh + 14, t.level)
    const s = t.owner >= 0 ? t.store : null
    if (s) {
      this.bar(ctx, t.x, t.y + 58, 50, s.meat / MEAT.store, s.meat > 0.001 ? '#e07a6a' : '#555')
      if (t.meatT > 1) { ctx.fillStyle = 'rgba(150,20,20,.92)'; ctx.fillRect(t.x - 34, t.y - hh - 8, 68, 16); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`FADING ${Math.max(0, Math.ceil(SETTLE.decaySeconds - t.meatT))}s`, t.x, t.y - hh + 4) }
    }
    if (t.hp < t.maxHp - 1) this.bar(ctx, t.x, t.y + 70, 54, t.hp / t.maxHp, '#78d46a')
    if (t.flash > 0) { ctx.strokeStyle = `rgba(255,248,200,${t.flash / 1.2})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(t.x, t.y + 20, 50 + (1.2 - t.flash) * 60, 0, Math.PI * 2); ctx.stroke() }
  }
  /** An outpost: a short stake with a pennant in the kingdom's colour (it has 1 hp, so it is drawn small and plain). */
  private drawOutpost(ctx: CanvasRenderingContext2D, o: Outpost) {
    const color = FACTION_COLORS[this.game.kingdoms[o.faction].color]
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(o.x, o.y + 22, 16, 6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(o.x - 2, o.y - 40, 4, 62)
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(o.x + 2, o.y - 40); ctx.lineTo(o.x + 30, o.y - 30); ctx.lineTo(o.x + 2, o.y - 20); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = 'rgba(10,14,20,.7)'; ctx.lineWidth = 2; ctx.stroke()
  }
  private drawGold(ctx: CanvasRenderingContext2D, d: GoldDeposit) {
    const tier = d.stone <= 2 ? d.stone : goldTier(d.amount) // a large stone shrinks to smaller pieces as it is mined
    const img = this.assets.gold[tier - 1], sc = 0.5 + 0.06 * tier, w = 128 * sc
    ctx.drawImage(img, d.x - w / 2, d.y - w * 0.82, w, w)
    if (d.progress > 0 && d.claimedBy >= 0) this.bar(ctx, d.x, d.y - w * 0.9, 40, Math.min(1, d.progress / GOLD.time), '#ffd86a')
  }
  private drawSheep(ctx: CanvasRenderingContext2D, s: Sheep, time: number) {
    const moving = Math.hypot(s.tx - s.x, s.ty - s.y) > 3, sh = moving ? this.assets.sheep.move : this.assets.sheep.idle, fr = loopFrame(time, 8, sh.frames, s.phase), sc = 1.1 // (sheep are drawn twice their old size)
    ctx.save(); ctx.translate(s.x, s.y); if (s.facing < 0) ctx.scale(-1, 1)
    drawSheet(ctx, sh, fr, -sh.fw * sc / 2, -sh.fh * sc * 0.82, sh.fw * sc, sh.fh * sc)
    ctx.restore()
    if (s.ripe) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(s.x, s.y - 96, 6, 0, Math.PI * 2); ctx.fill() }
  }
  /** Crates left by a destroyed settlement: their contents are written over them until a nearby new settlement takes them. */
  private drawCrates(ctx: CanvasRenderingContext2D) {
    for (const c of this.game.crates) {
      for (const [dx, dy] of [[0, 0], [30, 10], [-26, 14]]) ctx.drawImage(this.assets.props.crate, c.x + dx - 24, c.y + dy - 62, 48, 69)
      ctx.fillStyle = 'rgba(12,16,22,.85)'; ctx.fillRect(c.x - 52, c.y - 86, 104, 16); ctx.fillStyle = '#ffd86a'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'
      ctx.fillText(`${Math.round(c.load.lumber)}L ${Math.round(c.load.gold)}G ${Math.round(c.load.meat)}M`, c.x, c.y - 74)
    }
  }
  /** A sinking Zumwalt: the hull lists over and slides under the waterline (clipped there), the guns still smoking, with ripples and bubbles where it goes down. */
  private drawWrecks(ctx: CanvasRenderingContext2D) {
    for (const w of this.game.wrecks) {
      const p = Math.min(1, w.t / SINK_SECONDS), color = this.game.kingdoms[w.faction].color, img = this.shipImg(w.kind, color, w.dir)
      const standing = w.dir === 'up' || w.dir === 'down', fy = w.y + img.height * (standing ? 0.04 : 0.2)
      const ease = p * p * (3 - 2 * p), R = Math.max(img.width, img.height)
      for (let k = 0; k < 3; k++) { const q = Math.min(1, Math.max(0, p * 1.3 - k * 0.2)); if (q <= 0 || q >= 1) continue; ctx.strokeStyle = `rgba(235,250,255,${0.5 * (1 - q)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(w.x, fy, img.width * (0.3 + q * 0.5), img.height * (0.2 + q * 0.3) * (standing ? 0.5 : 1), 0, 0, Math.PI * 2); ctx.stroke() }
      ctx.save()
      ctx.beginPath(); ctx.rect(w.x - R, w.y - R, R * 2, fy - (w.y - R) + 4); ctx.clip() // (everything below the waterline is hidden)
      ctx.translate(w.x, w.y + ease * img.height * 0.9); ctx.rotate(w.list * ease * 0.35)
      ctx.globalAlpha = 1 - Math.max(0, p - 0.7) / 0.3 * 0.6
      if (w.flip) ctx.scale(1, -1)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      ctx.restore()
      for (let k = 0; k < 7; k++) { // bubbles rising where the hull was
        const ph = (p * 1.6 + k * 0.37) % 1, bx = w.x + Math.sin(k * 2.7) * img.width * 0.3, by = fy - ph * 30
        ctx.fillStyle = `rgba(230,250,255,${0.55 * (1 - ph) * Math.min(1, p * 4)})`; ctx.beginPath(); ctx.arc(bx, by, 2 + (k % 3), 0, Math.PI * 2); ctx.fill()
      }
    }
  }
  private drawFloaters(ctx: CanvasRenderingContext2D, time: number) {
    for (const f of this.game.floaters) {
      const bob = Math.sin(time * 2 + f.id) * 3
      ctx.fillStyle = 'rgba(10,40,60,.3)'; ctx.beginPath(); ctx.ellipse(f.x, f.y + 6, 22, 9, 0, 0, Math.PI * 2); ctx.fill()
      ctx.drawImage(this.assets.props.crate, f.x - 24, f.y - 40 + bob, 48, 69)
      ctx.fillStyle = '#ffd86a'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'
      ctx.fillText(`${f.load.lumber ? Math.round(f.load.lumber) + 'L ' : ''}${f.load.gold ? Math.round(f.load.gold) + 'G ' : ''}${f.load.meat ? Math.round(f.load.meat) + 'M' : ''}`, f.x, f.y - 46 + bob)
    }
  }
  /** A kingdom's emblem badge above a point; it grows as the camera zooms out so it stays readable (≈ 20 px on screen). */
  private badge(ctx: CanvasRenderingContext2D, kingdom: number, x: number, y: number, size: number) {
    const k = this.game.kingdoms[kingdom]
    if (!k) return
    const sz = Math.min(110, Math.max(size, 20 / this.zoomNow)), hex = FACTION_COLORS[k.color]
    const lum = (parseInt(hex.slice(1, 3), 16) * 0.3 + parseInt(hex.slice(3, 5), 16) * 0.59 + parseInt(hex.slice(5, 7), 16) * 0.11) / 255
    drawEmblem(ctx, k.emblem, x, y - sz / 2, sz, hex, lum > 0.62 ? FACTION_DARK[k.color] : '#ffffff')
  }
  /** Towers and lots. A garrisoned archer stands at full size on the middle of the tower's platform. */
  private drawTower(ctx: CanvasRenderingContext2D, t: Tower, time: number) {
    if (t.kind === 'boat' || t.kind === 'zumwalt' || t.kind === 'cargo' || t.kind === 'gunship' || t.kind === 'barge') { // a ship under construction: translucent hull on the slipway with a progress bar
      const color = this.game.kingdoms[t.faction].color, vertical = !t.shore || Math.abs(t.shore.x - t.x) > Math.abs(t.shore.y - t.y)
      const img = this.shipImg(t.kind, color, vertical ? 'up' : 'right'), total = this.game.buildTimeOf(t)
      ctx.globalAlpha = 0.35 + 0.4 * (t.progress / total); ctx.drawImage(img, t.x - img.width / 2, t.y - img.height / 2); ctx.globalAlpha = 1
      this.bar(ctx, t.x, t.y - img.height / 2 - 8, 48, t.progress / total, '#f0cf6a')
      return
    }
    const color = this.game.kingdoms[t.faction].color, img = t.kind === 'tower' ? this.assets.towers[color] : this.assets.lots[color]
    const total = this.game.buildTimeOf(t), base = t.kind === 'tower' ? TOWER_BASE : 188
    ctx.globalAlpha = t.built ? 1 : 0.4 + 0.3 * (t.progress / total)
    ctx.drawImage(img, t.x - img.width / 2, t.y + 36 - base)
    ctx.globalAlpha = 1
    if (!t.built) this.bar(ctx, t.x, t.y - 20, 48, t.progress / total, '#f0cf6a')
    else if (t.kind === 'tower' && t.archer >= 0) {
      const u = this.game.unitById(t.archer)
      if (u) {
        const ac = this.game.kingdoms[u.faction].color, sh = this.assets.archer[ac][u.state === 'attacking' ? 'Shoot' : 'Idle']
        const fr = u.state === 'attacking' ? holdFrame(u.attackT / UNIT.archer.attackDuration, sh.frames) : loopFrame(time, 10, sh.frames, u.phase), sc = UNIT.archer.scale
        ctx.save(); ctx.translate(t.x, t.y - TOWER_PLATFORM); if (u.facing < 0) ctx.scale(-1, 1)
        drawSheet(ctx, sh, fr, -sh.fw * sc / 2, -UNIT.archer.foot * sc, sh.fw * sc, sh.fh * sc); ctx.restore()
      }
    }
    if (!t.built) { const cost = this.game.costOf(t); this.bar(ctx, t.x, t.y - 36, 48, t.hp / cost, '#e8c23c') } // hit points = wood placed
    else if (t.hp < t.maxHp) this.bar(ctx, t.x, t.y - (t.kind === 'tower' ? 190 : 150), 54, t.hp / t.maxHp, '#78d46a')
  }

  private shipImg(kind: BoatKind, color: number, dir: 'up' | 'down' | 'left' | 'right') { return this.assets.ships[kind][color][dir] }
  private drawBoat(ctx: CanvasRenderingContext2D, b: Boat, alpha: number, time: number) {
    const g = this.game, color = g.kingdoms[b.faction].color
    const x = b.px + (b.x - b.px) * alpha, y0 = b.py + (b.y - b.py) * alpha
    const bob = b.docked ? 0 : Math.sin(time * 2.2 + b.id) * 2
    const y = y0 + bob
    const img = this.shipImg(b.kind, color, b.dir)
    const standing = b.dir === 'up' || b.dir === 'down'
    const fy = y + img.height * (standing ? 0.04 : 0.2) // where the hull meets the water: everything that lies on the sea (shadow, wake, rings) is centred here, not on the sprite's middle
    this.drawWake(ctx, b, x, fy, time, img)
    // soft shadow on the water
    ctx.fillStyle = 'rgba(10,40,60,.28)'; ctx.beginPath(); ctx.ellipse(x, fy + 2, img.width * 0.42, img.height * 0.3, 0, 0, Math.PI * 2); ctx.fill()
    if (b.flash > 0) ctx.filter = 'brightness(1.8)'
    if (b.kind === 'barge' && b.open && b.docked) { // ramp down: the open sprite is registered to the closed one by its hull, so it just sits offset by that much
      const o = this.assets.bargeOpen[color][b.dir], off = (bargeOffsets as Record<string, number[]>)[b.dir]
      ctx.drawImage(o, x - img.width / 2 - off[0], y - img.height / 2 - off[1])
    } else if (b.flip) { ctx.save(); ctx.translate(x, y); ctx.scale(1, -1); ctx.drawImage(img, -img.width / 2, -img.height / 2); ctx.restore() } else ctx.drawImage(img, x - img.width / 2, y - img.height / 2)
    ctx.filter = 'none'
    if ((b.fireT ?? 0) > 0) this.drawShipFire(ctx, b, x, y, img, time)
    const sel = g.selection?.kind === 'boats' && g.selection.ids.includes(b.id)
    const top = y - img.height / 2 - 10
    this.badge(ctx, b.faction, x, top - 10, 18)
    if (b.hp < b.maxHp - 0.5 || sel) this.bar(ctx, x, top, 50, b.hp / b.maxHp, '#78d46a')
    if (b.cargo.length && b.faction === 0) { ctx.fillStyle = 'rgba(12,16,22,.85)'; ctx.fillRect(x - 18, top + 8, 36, 13); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${b.cargo.length > 0 ? g.unitCargo(b) : 0}/${b.cap}`, x, top + 18) }
    if (b.kind === 'cargo') {
      const pct = loadPercent(b), tot = b.load.lumber + b.load.gold + b.load.meat
      if (pct >= 0 && b.faction === 0) { ctx.fillStyle = 'rgba(12,16,22,.9)'; ctx.fillRect(x - 21, top - 26, 42, 15); ctx.fillStyle = pct >= 100 ? '#8be28b' : '#ffd86a'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${pct}%`, x, top - 14) }
      else if (tot > 0 && b.faction === 0) { ctx.fillStyle = 'rgba(12,16,22,.85)'; ctx.fillRect(x - 26, top + 8, 52, 13); ctx.fillStyle = '#ffd86a'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(b.load.lumber)}L ${Math.round(b.load.gold)}G ${Math.round(b.load.meat)}M`, x, top + 18) }
    }
    if (b.kind === 'zumwalt' && b.lockT > 0 && b.target) { ctx.strokeStyle = '#ff8a6a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, fy, boatLength(b.kind) * 0.5 + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.lockT / ZUMWALT.lockSeconds)); ctx.stroke() } // locking on
    if (b.docking && !b.docked) { // lying beside the coast, waiting to moor: a ring fills over DOCK seconds (red while defenders hold the beach)
      const p = Math.min(1, b.dockT / dockTimeOf(b)), rad = boatLength(b.kind) * 0.5 + 8
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, fy, rad, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = b.dockBlocked ? '#ff5a4a' : '#fff3a9'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, fy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (b.dockBlocked ? 1 : p)); ctx.stroke()
    }
    if (b.docked) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(x, fy, boatLength(b.kind) * 0.5 + 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
    if (sel) { ctx.strokeStyle = '#fff3a9'; ctx.lineWidth = 3; ctx.beginPath(); if (standing) ctx.ellipse(x, fy, img.width / 2 + 8, img.height / 2 + 6, 0, 0, Math.PI * 2); else ctx.ellipse(x, fy, img.width / 2 + 6, img.height * 0.3 + 8, 0, 0, Math.PI * 2); ctx.stroke() }
  }

  private wakes = new Map<number, Wake>()
  /**
   * Water effects for a ship under way: purely visual, driven by how far the hull actually moves on screen (nothing here touches the game state).
   * From the bottom up: a darker lane of churned water, thin ripple rings, foam puffs (the pack's dust sprites, which swell, break up and fade) that
   * drift outward so the trail fans into a V behind the stern, and spray at the bow. A Zumwalt churns more, wider and for longer.
   */
  private drawWake(ctx: CanvasRenderingContext2D, b: Boat, x: number, fy: number, time: number, img: { width: number; height: number }) {
    if (b.docked) { this.wakes.delete(b.id); return }
    let w = this.wakes.get(b.id)
    if (!w) {
      if (this.wakes.size > this.game.boats.length + 8) for (const id of [...this.wakes.keys()]) if (!this.game.boatById(id)) this.wakes.delete(id)
      w = { lx: x, ly: fy, lt: time, hx: 0, hy: 1, acc: 0, n: 0, pts: [], puffs: [] }; this.wakes.set(b.id, w)
    }
    const K = 0.5 // (the whole wake is kept faint: it should read as disturbed water, not as an overlay)
    const big = b.kind === 'zumwalt', vertical = b.dir === 'up' || b.dir === 'down'
    const len = vertical ? img.height : img.width, beam = vertical ? img.width : img.height
    const life = big ? 2.8 : 1.8, scale = big ? 1.5 : b.kind === 'gunship' ? 0.95 : b.kind === 'cargo' ? 0.8 : b.kind === 'barge' ? 1.15 : 1
    const dt = time - w.lt, moved = Math.hypot(x - w.lx, fy - w.ly)
    // the bow points where the SPRITE points (not where the last frames happened to move), so the stern, bow and spray always sit on the drawn hull
    w.hx = b.dir === 'left' ? -1 : b.dir === 'right' ? 1 : 0; w.hy = b.dir === 'up' ? -1 : b.dir === 'down' ? 1 : 0
    let speed = 0
    if (dt > 0 && dt < 0.5) {
      speed = moved / dt
      if (speed > 12) {
        const sx = x - w.hx * len * 0.42, sy = fy - w.hy * len * 0.42, px = -w.hy, py = w.hx
        const last = w.pts[w.pts.length - 1]
        if (!last || Math.hypot(last.x - sx, last.y - sy) >= 9) w.pts.push({ x: sx, y: sy, t: time })
        w.acc += moved
        const gap = big ? 11 : 15
        while (w.acc >= gap) { // foam: lanes along the hull's quarter lines, each puff drifting outward and a little astern
          w.acc -= gap
          const lanes = big ? [-0.34, 0, 0.34] : [-0.26, 0.26]
          for (const lane of lanes) {
            const r1 = hash2(b.id, w.n++, 61), r2 = hash2(b.id, w.n++, 62), side = lane === 0 ? (r2 < 0.5 ? -1 : 1) : Math.sign(lane)
            const off = lane * beam, drift = (7 + r1 * 13) * scale * (lane === 0 ? 0.5 : 1)
            w.puffs.push({ x: sx + px * off * 0.6 + (r2 - 0.5) * 5, y: sy + py * off * 0.6 + (r1 - 0.5) * 4, vx: px * side * drift - w.hx * (5 + r2 * 7), vy: py * side * drift * 0.6 - w.hy * (5 + r2 * 7), t: time, life: life * (0.7 + r1 * 0.5), size: (24 + r2 * 14) * scale, set: r1 < 0.5 ? 0 : 1 })
          }
          if (big) { // a Zumwalt's screws: a denser boil right at the stern
            const r = hash2(b.id, w.n++, 63)
            w.puffs.push({ x: sx + (vertical ? (r - 0.5) * beam * 0.5 : 0), y: sy + (vertical ? 0 : (r - 0.5) * beam * 0.3), vx: -w.hx * 8, vy: -w.hy * 8, t: time, life: 0.9 + r * 0.6, size: 34 + r * 16, set: 0 })
          }
        }
      }
    }
    w.lx = x; w.ly = fy; w.lt = time
    while (w.pts.length && time - w.pts[0].t > life) w.pts.shift()
    for (let i = w.puffs.length - 1; i >= 0; i--) if (time - w.puffs[i].t > w.puffs[i].life) w.puffs.splice(i, 1)
    if (!w.pts.length && !w.puffs.length && speed <= 12) return
    ctx.save()
    // 1. the lane of churned water: a little darker than the sea, widening as it ages
    for (const p of w.pts) {
      const age = (time - p.t) / life, fade = 1 - age, r = (beam * 0.4 + age * 34) * scale
      ctx.fillStyle = `rgba(14,78,98,${(fade * fade * (big ? 0.2 : 0.15) * K).toFixed(3)})`
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill()
    }
    // 2. thin ripple rings, every other trail point (a pale aqua, not white)
    ctx.lineWidth = 1.6
    for (let i = 0; i < w.pts.length; i += 2) {
      const p = w.pts[i], age = (time - p.t) / life, r = (8 + age * (big ? 62 : 38)) * scale
      ctx.strokeStyle = `rgba(170,224,228,${((1 - age) * 0.34 * K).toFixed(3)})`
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.46, 0, 0, Math.PI * 2); ctx.stroke()
    }
    // 3. foam puffs, oldest first so fresh foam sits on top (water-tinted copies of the pack's dust sprites)
    for (const p of w.puffs) {
      const age = (time - p.t) / p.life, el = time - p.t, sh = p.set ? this.assets.fx.wake2 : this.assets.fx.wake1
      const fr = Math.min(sh.frames - 1, Math.floor(age * sh.frames)), size = p.size * (0.65 + 0.5 * age)
      ctx.globalAlpha = Math.min(1, (1 - age) * 1.7) * 0.9 * K
      drawSheet(ctx, sh, fr, p.x + p.vx * el - size / 2, p.y + p.vy * el - size * 0.62, size, size)
    }
    ctx.globalAlpha = 1
    // 4. bow: spray thrown up on both sides of the stem, and a thin pale lip of water
    if (speed > 14) {
      const bx = x + w.hx * len * 0.48, by = fy + w.hy * len * 0.48, px = -w.hy, py = w.hx, ang = Math.atan2(w.hy, w.hx), sp = this.assets.fx.wakeSplash
      const rate = Math.min(1, speed / 55)
      for (const side of [-1, 1]) {
        const fr = 2 + (Math.floor(time * 9 + (side > 0 ? 3 : 0) + b.id) % 4), size = (62 + (big ? 34 : 0)) * scale * (0.7 + 0.3 * rate)
        ctx.globalAlpha = 0.8 * rate * K
        drawSheet(ctx, sp, fr, bx + px * side * beam * 0.26 * (vertical ? 1 : 0.6) - size / 2, by + py * side * beam * 0.26 * (vertical ? 0.6 : 1) - size * 0.62, size, size)
      }
      ctx.globalAlpha = (big ? 0.6 : 0.45) * rate * K; ctx.strokeStyle = '#cdeff2'; ctx.lineWidth = big ? 3.2 : 2.4; ctx.lineCap = 'round'
      ctx.save(); ctx.translate(bx, by); ctx.scale(1, 0.55); ctx.beginPath(); ctx.arc(0, 0, (big ? 26 : 15) * (0.8 + 0.2 * rate), ang - 1.05, ang + 1.05); ctx.stroke(); ctx.restore()
    }
    ctx.restore()
  }

  /** A burning Zumwalt (cosmetic). The pack's fire is a one-shot puff that swells and turns to smoke, so the blaze is several of them out of step along the deck; they thin out and shrink over the last few seconds. */
  private drawShipFire(ctx: CanvasRenderingContext2D, b: Boat, x: number, y: number, img: { width: number; height: number }, time: number) {
    const sh = this.assets.fx.fire, fade = Math.min(1, b.fireT / 5), vertical = b.dir === 'up' || b.dir === 'down'
    const len = vertical ? img.height : img.width, puffs = Math.max(2, Math.ceil(7 * fade))
    ctx.save(); ctx.globalAlpha = 0.6 + 0.4 * fade
    for (let i = 0; i < puffs; i++) {
      const t = (i + 0.5) / 7, along = (t - 0.5) * len * 0.7, side = ((i * 37) % 11 - 5) * 2.2, size = (96 + (i % 3) * 22) * (0.55 + 0.45 * fade)
      const fx = x + (vertical ? side : along), fy = y + (vertical ? along : side) + 8
      drawSheet(ctx, sh, loopFrame(time, 9, sh.frames, i * 0.47 + b.id * 0.19), fx - size / 2, fy - size * 0.88, size, size)
    }
    ctx.restore()
  }

  /** Sprite sheet + frame for the unit's current action. */
  private unitFrame(u: Unit, time: number): { sh: Sheet; fr: number } {
    const c = this.game.kingdoms[u.faction].color
    if (u.type === 'archer') {
      const set = this.assets.archer[c]
      if (u.state === 'attacking') return { sh: set.Shoot, fr: holdFrame(u.attackT / UNIT.archer.attackDuration, set.Shoot.frames) }
      if (u.state === 'moving') return { sh: set.Run, fr: loopFrame(time, 10, set.Run.frames, u.phase) }
      return { sh: set.Idle, fr: loopFrame(time, 10, set.Idle.frames, u.phase) }
    }
    if (u.type === 'lancer') {
      const set = this.assets.lancer[c]
      if (u.state === 'attacking') {
        const a = Math.atan2(u.aimY, Math.abs(u.aimX)) * 180 / Math.PI
        const sh = a < -67 ? set.AtkUp : a < -22 ? set.AtkUpRight : a <= 22 ? set.AtkRight : a <= 67 ? set.AtkDownRight : set.AtkDown
        return { sh, fr: holdFrame(u.attackT / UNIT.lancer.attackDuration, sh.frames) }
      }
      if (u.state === 'guarding') return { sh: set.Defence, fr: loopFrame(time, 10, set.Defence.frames) }
      if (u.state === 'moving') return { sh: set.Run, fr: loopFrame(time, 10, set.Run.frames, u.phase) }
      return { sh: set.Idle, fr: loopFrame(time, 10, set.Idle.frames, u.phase) }
    }
    if (u.type === 'knight') { // gallops when moving, idles when still, and couches its lance and thrusts when attacking (the blow lands as the thrust peaks)
      const set = this.assets.knight[c]
      if (u.state === 'attacking') return { sh: set.Attack, fr: holdFrame(u.attackT / UNIT.knight.attackDuration, set.Attack.frames) }
      if (u.state === 'moving') return { sh: set.Run, fr: loopFrame(time, 12, set.Run.frames, u.phase) }
      return { sh: set.Idle, fr: loopFrame(time, 7, set.Idle.frames, u.phase) }
    }
    const set = this.assets.warrior[c]
    if (u.state === 'attacking') { const sh = set[u.attackVariant === 0 ? 'Attack1' : 'Attack2']; return { sh, fr: holdFrame(u.attackT / UNIT.warrior.attackDuration, sh.frames) } }
    if (u.state === 'guarding') return { sh: set.Guard, fr: loopFrame(time, 10, set.Guard.frames) }
    if (u.state === 'moving') return { sh: set.Run, fr: loopFrame(time, 10, set.Run.frames, u.phase) }
    return { sh: set.Idle, fr: loopFrame(time, 10, set.Idle.frames, u.phase) }
  }
  private static SQUAD = [[0, 0], [-20, -8], [20, -8], [-10, 12], [10, 12]]
  private drawUnit(ctx: CanvasRenderingContext2D, u: Unit, time: number, alpha: number) {
    const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha
    const { sh, fr } = this.unitFrame(u, time), st = UNIT[u.type], sc = st.scale
    const order = u.count > 1 ? [...Array(u.count).keys()].sort((a, b) => Renderer.SQUAD[a][1] - Renderer.SQUAD[b][1]) : [0]
    for (const k of order) {
      const [ox, oy] = u.count > 1 ? Renderer.SQUAD[k] : [0, 0]
      ctx.save(); ctx.translate(x + ox, y + oy)
      if (u.facing < 0) ctx.scale(-1, 1)
      drawSheet(ctx, sh, fr, -sh.fw * sc / 2, -st.foot * sc, sh.fw * sc, sh.fh * sc)
      ctx.restore()
    }
    const sel = this.game.selection?.kind === 'units' && this.game.selection.ids.includes(u.id)
    const top = y - st.foot * 0.72 * sc - 6 - (u.count > 1 ? 14 : 0)
    if (u.hp < u.maxHp - 0.5 || sel) this.bar(ctx, x, top, 36 + u.count * 4, u.hp / u.maxHp, u.cutOff || u.overcap ? '#e0603a' : '#78d46a')
    if (sel && this.game.healingAtTown(u)) { // green plus: near a friendly town and injured, so it mends faster
      const px = x + (36 + u.count * 4) / 2 + 12, py = top + 2
      ctx.fillStyle = 'rgba(12,16,22,.85)'; ctx.fillRect(px - 9, py - 9, 18, 18); ctx.fillStyle = '#4ade5a'; ctx.fillRect(px - 6, py - 2, 12, 4); ctx.fillRect(px - 2, py - 6, 4, 12)
    }
    if (u.count > 1) { ctx.fillStyle = 'rgba(12,16,22,.85)'; ctx.fillRect(x - 11, top + 8, 22, 12); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`×${u.count}`, x, top + 18) }
    if (u.cutOff || u.overcap) { ctx.fillStyle = '#e0503a'; ctx.beginPath(); ctx.arc(x + 24, top - 4, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', x + 24, top + 0.5) }
  }
  private drawPawn(ctx: CanvasRenderingContext2D, p: Pawn, alpha: number) {
    const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha
    const set = this.assets.pawn[this.game.kingdoms[p.faction].color]
    const moving = Math.hypot(p.vx, p.vy) > 6
    // hunting, mining and repairing all use the hammer animation
    const carried = p.carry > 0 ? (p.carryKind === 'meat' ? 'Meat' : p.carryKind === 'gold' ? 'Gold' : 'Wood') : ''
    const key = p.state === 'chopping' ? 'Chop' : p.state === 'building' || p.state === 'hitting' || p.state === 'mining' || p.state === 'repair' ? 'Build' : carried ? (moving ? 'Run' : 'Idle') + carried : moving ? 'Run' : 'Idle'
    const sh = set[key], fr = loopFrame(p.animT, 10, sh.frames), sc = PAWN.spriteScale
    ctx.save(); ctx.translate(x, y)
    if (p.facing < 0) ctx.scale(-1, 1)
    drawSheet(ctx, sh, fr, -sh.fw * sc / 2, -122 * sc, sh.fw * sc, sh.fh * sc)
    ctx.restore()
  }
  private drawGhost(ctx: CanvasRenderingContext2D, d: { x: number; y: number; faction: number; type: string; t: number }) {
    const color = this.game.kingdoms[d.faction].color
    const sh = d.type === 'archer' ? this.assets.archer[color].Idle : d.type === 'lancer' ? this.assets.lancer[color].Idle : d.type === 'knight' ? this.assets.knight[color].Idle : this.assets.warrior[color].Idle
    const st = UNIT[d.type as keyof typeof UNIT], sc = st.scale
    ctx.globalAlpha = Math.max(0, 1 - d.t); drawSheet(ctx, sh, 0, d.x - sh.fw * sc / 2, d.y - st.foot * sc - d.t * 20, sh.fw * sc, sh.fh * sc); ctx.globalAlpha = 1
  }
  private drawProjectiles(ctx: CanvasRenderingContext2D) {
    const arrow = this.assets.arrow
    for (const p of this.game.projectiles) {
      const f = Math.min(1, p.t / p.dur), x = p.x0 + (p.x1 - p.x0) * f, y = p.y0 + (p.y1 - p.y0) * f - Math.sin(f * Math.PI) * 24
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(p.y1 - p.y0, p.x1 - p.x0)); ctx.drawImage(arrow, -22, -22, 44, 44); ctx.restore()
    }
  }
  private drawShells(ctx: CanvasRenderingContext2D) {
    for (const s of this.game.shells) {
      const f = Math.min(1, s.t / s.dur), x = s.x0 + (s.x1 - s.x0) * f, y = s.y0 + (s.y1 - s.y0) * f - Math.sin(f * Math.PI) * 70
      ctx.fillStyle = '#20242c'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,220,140,.8)'; ctx.beginPath(); ctx.arc(x - 2, y - 2, 2.5, 0, Math.PI * 2); ctx.fill()
    }
  }
  /** Hit sparks, capture / explosion rings. */
  private drawFx(ctx: CanvasRenderingContext2D) {
    for (const f of this.game.fx) {
      if (f.kind === 'hit') {
        const p = f.t / 0.25
        if (p >= 1) continue
        ctx.strokeStyle = `rgba(255,${200 - 80 * p | 0},80,${1 - p})`; ctx.lineWidth = 3
        for (let i = 0; i < 6; i++) { const a = i * 1.047 + f.x * 0.1, r0 = 4 + p * 8, r1 = 10 + p * 22; ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0); ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); ctx.stroke() }
      } else if (f.kind === 'boom') {
        const sh = this.assets.fx.explosion, p = f.t / 0.8
        if (p >= 1) continue
        const fr = Math.min(sh.frames - 1, Math.floor(p * sh.frames))
        ctx.drawImage(sh.img, fr * sh.fw, 0, sh.fw, sh.fh, f.x - sh.fw * 0.4, f.y - sh.fh * 0.55, sh.fw * 0.8, sh.fh * 0.8)
      } else if (f.kind === 'splash') {
        const sh = this.assets.fx.splash, p = f.t / 0.9
        if (p >= 1) continue
        const fr = Math.min(sh.frames - 1, Math.floor(p * sh.frames))
        ctx.drawImage(sh.img, fr * sh.fw, 0, sh.fw, sh.fh, f.x - sh.fw * 0.4, f.y - sh.fh * 0.7, sh.fw * 0.8, sh.fh * 0.8)
      } else if (f.kind === 'capture') {
        const p = f.t / 1.0
        if (p >= 1) continue
        ctx.strokeStyle = `rgba(255,248,200,${1 - p})`; ctx.lineWidth = 6 * (1 - p) + 1
        ctx.beginPath(); ctx.arc(f.x, f.y + 10, 30 + p * 150, 0, Math.PI * 2); ctx.stroke()
      }
    }
  }
  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, p: number, color: string) {
    ctx.fillStyle = 'rgba(12,16,22,.85)'; ctx.fillRect(x - w / 2 - 2, y - 2, w + 4, 8)
    ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, p)), 4)
  }

  // ------------------------------------------------------------ overlays
  private drawOverlays(ctx: CanvasRenderingContext2D, alpha: number, ui: RenderUi, time: number) {
    const g = this.game
    // each tower / lot is tied to the nearest town of its owner by a faint dashed line
    for (const st of g.towers) {
      const town = g.towns[st.town]
      if (!town) continue
      ctx.strokeStyle = FACTION_COLORS[g.kingdoms[st.faction].color]; ctx.globalAlpha = 0.55; ctx.lineWidth = 2; ctx.setLineDash([6, 8])
      ctx.beginPath(); ctx.moveTo(st.x, st.y + 10); ctx.lineTo(town.x, town.y + 10); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
    }
    if (g.showRange) this.drawRanges(ctx)
    if (g.focusKingdom !== null) this.drawRelationArrows(ctx, g.focusKingdom)
    // block rings for every blocking unit (a blocker occupies twice the usual space)
    for (const u of g.units) {
      if (u.mode !== 'block' || u.state === 'dead') continue
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha
      ctx.strokeStyle = FACTION_COLORS[g.kingdoms[u.faction].color]; ctx.globalAlpha = 0.85; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -time * 14
      ctx.beginPath(); ctx.ellipse(x, y - 4, UNIT_BODY.blockSeparation, UNIT_BODY.blockSeparation * 0.7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
    }
    const sel = g.selection
    const selectedIds = sel?.kind === 'units' ? new Set(sel.ids) : new Set<number>()
    // every friendly unit's route stays visible so movements can be coordinated; the selection is highlighted
    for (const u of g.units) {
      if (u.faction !== 0 || u.state === 'dead' || !u.route.length || u.routeIdx >= u.route.length / 2) continue
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha
      const on = selectedIds.has(u.id)
      this.polyline(ctx, [x, y, ...u.route.slice(u.routeIdx * 2)], on ? '#fff6c0' : 'rgba(255,255,255,.5)', on ? 3 : 2, [9, 7], time)
      const ex = u.route[u.route.length - 2], ey = u.route[u.route.length - 1]
      ctx.fillStyle = on ? '#fff6c0' : 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(ex, ey, on ? 6 : 4, 0, Math.PI * 2); ctx.fill()
    }
    // every friendly ship's sailing route stays visible too (the selected ones are brighter), like the land routes above
    const selBoats = sel?.kind === 'boats' ? new Set(sel.ids) : new Set<number>()
    for (const b of g.boats) {
      if (b.faction !== 0 || b.route.length === 0 || b.routeIdx >= b.route.length / 2) continue
      const on = selBoats.has(b.id)
      this.polyline(ctx, [b.x, b.y, ...b.route.slice(b.routeIdx * 2)], on ? '#9fe8ff' : 'rgba(159,232,255,.5)', on ? 3 : 2, [9, 7], time)
      const ex = b.route[b.route.length - 2], ey = b.route[b.route.length - 1]
      ctx.fillStyle = on ? '#9fe8ff' : 'rgba(159,232,255,.55)'; ctx.beginPath(); ctx.arc(ex, ey, on ? 6 : 4, 0, Math.PI * 2); ctx.fill()
    }
    // standing trade routes: faint dashed lines between the two ports (bright for the selected boat)
    for (const b of g.boats) {
      if (b.faction !== 0 || !b.trade || b.trade.path.length < 4) continue
      const on = selBoats.has(b.id)
      this.polyline(ctx, b.trade.path, on ? 'rgba(255,214,106,.9)' : 'rgba(255,214,106,.32)', on ? 3 : 2, [4, 10], time)
      for (const id of [b.trade.a, b.trade.b]) { const t = g.towns[id]; if (t && !t.ruined) { ctx.strokeStyle = on ? '#ffd86a' : 'rgba(255,214,106,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(t.x, t.y + 20, 30, 0, Math.PI * 2); ctx.stroke() } }
    }
    if (g.routePick) { const b = g.boatById(g.routePick.boat); if (b) { ctx.fillStyle = 'rgba(255,214,106,.95)'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText(g.routePick.step === 'a' ? 'Click the town or settlement to LOAD at' : 'Click the town or settlement to UNLOAD at', b.x, b.y - 80) } }
    // manual strike targets: an X, red when in range and grey when out of it
    for (const id of selBoats) {
      const b = g.boatById(id)
      if (!b || !b.strike) continue
      const range = (b.kind === 'zumwalt' ? ZUMWALT.rangeTiles : GUNSHIP.rangeTiles) * TILE, inRange = Math.hypot(b.strike.x - b.x, b.strike.y - b.y) <= range
      const tg = b.strike.kind === 'ground' ? b.strike : { x: b.strike.x, y: b.strike.y }
      ctx.strokeStyle = inRange ? '#ff3b30' : '#9aa0a8'; ctx.lineWidth = 5; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(tg.x - 16, tg.y - 16); ctx.lineTo(tg.x + 16, tg.y + 16); ctx.moveTo(tg.x + 16, tg.y - 16); ctx.lineTo(tg.x - 16, tg.y + 16); ctx.stroke()
    }
    if (sel?.kind === 'units') {
      for (const id of sel.ids) {
        const u = g.unitById(id)
        if (!u) continue
        const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha
        ctx.strokeStyle = '#fff3a9'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y - 2, 30 + u.count * 3, 18 + u.count * 2, 0, 0, Math.PI * 2); ctx.stroke()
      }
      const lead = g.unitById(sel.ids[0])
      if (lead && ui.draft && ui.draft.length >= 2) this.polyline(ctx, [lead.x, lead.y, ...ui.draft], '#7af0d0', 4, [], time)
    } else if (sel?.kind === 'boats') {
      const lead = g.boatById(sel.ids[0])
      if (lead && ui.draft && ui.draft.length >= 2) this.polyline(ctx, [lead.x, lead.y, ...ui.draft], '#7af0d0', 4, [], time)
      for (const id of sel.ids) { const b = g.boatById(id); if (b?.kind === 'gunship' && !b.docked) { ctx.strokeStyle = 'rgba(255,150,120,.5)'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.beginPath(); ctx.arc(b.x, b.y, GUNSHIP.rangeTiles * TILE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) } if (b?.kind === 'zumwalt' && !b.docked) { ctx.strokeStyle = 'rgba(255,200,120,.55)'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.beginPath(); ctx.arc(b.x, b.y, ZUMWALT.rangeTiles * TILE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) } }
    } else if (sel?.kind === 'town') {
      const t = g.towns[sel.id]
      if (t && !t.ruined) { ctx.strokeStyle = t.owner === 0 ? '#fff3a9' : t.raze ? '#ff5a4a' : '#7af0d0'; ctx.lineWidth = 4; ctx.setLineDash([12, 8]); ctx.lineDashOffset = -time * 16; ctx.beginPath(); ctx.ellipse(t.x, t.y + 22, 96, 58, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
    } else if (sel?.kind === 'structure') {
      const t = g.towerById(sel.id)
      if (t) { ctx.strokeStyle = '#fff3a9'; ctx.lineWidth = 3; ctx.setLineDash([10, 7]); ctx.lineDashOffset = -time * 16; ctx.beginPath(); ctx.ellipse(t.x, t.y + 20, 52, 30, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
    } else if (sel?.kind === 'pawn') {
      const p = g.pawnById(sel.id)
      if (p) {
        const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha
        ctx.strokeStyle = '#fff3a9'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y - 2, 24, 14, 0, 0, Math.PI * 2); ctx.stroke()
        // what the pawn is doing (or has been told to do next): a dashed line to the tree, stone, sheep or cargo boat, ringed
        const marks: { x: number; y: number; r: number; next: boolean }[] = []
        if (p.tree >= 0) { const t = g.world.trees[p.tree]; marks.push({ x: t.x, y: t.y - 6, r: 22, next: false }) }
        if (p.job <= -2) { const d = g.goldDeps[-p.job - 2]; if (d) marks.push({ x: d.x, y: d.y - 8, r: 26, next: false }) }
        else if (p.job >= 0) { const sh = g.sheep.find(q => q.id === p.job); if (sh) marks.push({ x: sh.x, y: sh.y - 8, r: 22, next: false }) }
        const hb = p.haul ? g.boatById(p.haul.boat) : p.haulBoat >= 0 ? g.boatById(p.haulBoat) : null
        if (hb) marks.push({ x: hb.x, y: hb.y, r: 46, next: !p.haul })
        if (p.pendingJob) { const j = p.pendingJob, d = j.kind === 'gold' ? g.goldDeps[j.id] : g.sheep.find(q => q.id === j.id); if (d) marks.push({ x: d.x, y: d.y - 8, r: 26, next: true }) }
        if (p.pendingTree >= 0) { const t = g.world.trees[p.pendingTree]; if (t) marks.push({ x: t.x, y: t.y - 6, r: 22, next: true }) }
        for (const m of marks) {
          ctx.strokeStyle = m.next ? '#9fd8ff' : '#f0cf6a'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -time * 12
          ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.stroke()
          ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([])
        }
      }
    }
    this.drawYardLines(ctx)
    if (g.placing && ui.hover) { // tower placement ghost
      const cx = Math.floor(ui.hover.x / TILE), cy = Math.floor(ui.hover.y / TILE), x = (cx + 0.5) * TILE, y = (cy + 0.5) * TILE
      const kind = g.placing, ok = g.structureError(kind, 0, ui.hover.x, ui.hover.y) === null
      if (kind === 'outpost') {
        const color = FACTION_COLORS[g.kingdoms[0].color]
        ctx.strokeStyle = ok ? '#7af07a' : '#f06a6a'; ctx.lineWidth = 3; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.arc(x, y, OUTPOST.radius * TILE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
        ctx.globalAlpha = 0.7; ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 2, y - 40, 4, 62); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x + 2, y - 40); ctx.lineTo(x + 30, y - 30); ctx.lineTo(x + 2, y - 20); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1
        ctx.lineWidth = 4; ctx.strokeRect(cx * TILE + 2, cy * TILE + 2, TILE - 4, TILE - 4)
        return
      }
      if (kind === 'yard') {
        const img = this.assets.props.yard
        ctx.globalAlpha = 0.6; ctx.drawImage(img, x - img.width * 0.62, y + 34 - img.height + 4); ctx.globalAlpha = 1
        ctx.strokeStyle = ok ? '#7af07a' : '#f06a6a'; ctx.lineWidth = 4; ctx.strokeRect(cx * TILE + 2, cy * TILE + 2, TILE - 4, TILE - 4)
        return
      }
      if (kind === 'settlement') {
        const img = this.assets.props.pillar
        ctx.globalAlpha = 0.6; ctx.drawImage(img, x - img.width, y + 40 - img.height * 2, img.width * 2, img.height * 2); ctx.globalAlpha = 1
        ctx.strokeStyle = ok ? '#7af07a' : '#f06a6a'; ctx.lineWidth = 3; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.arc(x, y, SETTLE.radius[0] * TILE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
        ctx.lineWidth = 4; ctx.strokeRect(cx * TILE + 2, cy * TILE + 2, TILE - 4, TILE - 4)
        return
      }
      if (isShipKind(kind)) {
        const sh = g.shoreFor(0, ui.hover.x, ui.hover.y), img = this.shipImg(kind, g.kingdoms[0].color, sh && Math.abs(sh.x - x) > Math.abs(sh.y - y) ? 'up' : 'right')
        ctx.globalAlpha = 0.6; ctx.drawImage(img, x - img.width / 2, y - img.height / 2); ctx.globalAlpha = 1
        if (sh) { ctx.strokeStyle = ok ? '#7af07a' : '#f06a6a'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sh.x, sh.y); ctx.stroke(); ctx.setLineDash([]) }
        ctx.strokeStyle = ok ? '#7af07a' : '#f06a6a'; ctx.lineWidth = 4; ctx.strokeRect(cx * TILE + 2, cy * TILE + 2, TILE - 4, TILE - 4)
        return
      }
      const img = kind === 'tower' ? this.assets.towers[g.kingdoms[0].color] : this.assets.lots[g.kingdoms[0].color]
      ctx.globalAlpha = 0.55; ctx.drawImage(img, x - img.width / 2, y + 36 - (kind === 'tower' ? TOWER_BASE : 188)); ctx.globalAlpha = 1
      const home = g.nearestTown(0, x, y)
      if (home) { ctx.strokeStyle = ok ? '#7af07a' : '#f06a6a'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(home.x, home.y); ctx.stroke(); ctx.setLineDash([]) }
      ctx.strokeStyle = ok ? '#7af07a' : '#f06a6a'; ctx.lineWidth = 4; ctx.strokeRect(cx * TILE + 2, cy * TILE + 2, TILE - 4, TILE - 4)
    }
  }
  /** Thin arrows from the highlighted nation to everyone it is at war with (red), in conflict with (yellow) or allied to (green). */
  private drawRelationArrows(ctx: CanvasRenderingContext2D, k: number) {
    const colors = { war: '#ff3b30', conflict: '#ffd23c', allied: '#3ddc5a' }
    const px = 1 / this.zoomNow // world units per screen pixel keeps the arrows thin at every zoom
    ctx.lineCap = 'round'
    for (const a of this.game.relationArrows(k)) {
      const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
      const pad = 70, x0 = a.from.x + ux * pad, y0 = a.from.y + uy * pad, x1 = a.to.x - ux * pad, y1 = a.to.y - uy * pad
      if (len < pad * 2 + 20) continue
      const head = 11 * px
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,.55)' : colors[a.kind]; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = (pass === 0 ? 3.4 : 1.8) * px
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * head * 0.8, y1 - uy * head * 0.8); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * head - uy * head * 0.45, y1 - uy * head + ux * head * 0.45); ctx.lineTo(x1 - ux * head + uy * head * 0.45, y1 - uy * head - ux * head * 0.45); ctx.closePath(); ctx.fill()
      }
    }
  }

  /** Strike-range circle for each *selected* archer only; one equal radius around the centre of its tower when garrisoned. */
  private drawRanges(ctx: CanvasRenderingContext2D) {
    const g = this.game
    for (const u of g.selectedUnits()) {
      if (u.type !== 'archer') continue
      const tower = u.inTower >= 0 ? g.towerById(u.inTower) : null
      const x = tower ? tower.x : u.x, y = tower ? tower.y : u.y, r = UNIT.archer.range * (tower ? TOWER.rangeMult : 1)
      ctx.strokeStyle = 'rgba(255,240,150,.9)'; ctx.lineWidth = 3; ctx.setLineDash([12, 8])
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
    }
  }
  private polyline(ctx: CanvasRenderingContext2D, pts: number[], color: string, width: number, dash: number[], time: number) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(dash); ctx.lineDashOffset = -time * 20
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.stroke(); ctx.setLineDash([])
  }
}
