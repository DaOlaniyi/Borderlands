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
import { BOAT, DOCK, ZUMWALT } from './config'
import type { Boat, Pawn, Tower, Unit } from './types'

export type RenderUi = { draft: number[] | null; hoverTree: number; showPerf: boolean; hover: { x: number; y: number } | null }
export type RenderStats = { visibleSprites: number; dirtyChunks: number; chunksBuilt: number; foamVisible: number; drawMs: number }

const CHUNK = MAP.chunk
const TREE_BASE = [232, 232, 162, 162] // trunk-base y inside each Tree sheet frame
const STUMP_BASE = 232
type Item = { y: number; k: number; i: number }
const K = { tree: 0, stump: 1, bush: 2, rock: 3, town: 4, unit: 5, pawn: 6, tower: 7, boat: 8 }
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
  private gridPath = new Path2D()
  private hatch: CanvasPattern | null = null
  private items: Item[] = []
  private itemCount = 0

  constructor(private assets: Assets, private game: Game) {
    const { w, h } = game.world
    this.tintCanvas = document.createElement('canvas'); this.tintCanvas.width = w; this.tintCanvas.height = h
    this.tintCtx = this.tintCanvas.getContext('2d')!
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (game.world.land[y * w + x] && isCoastCell(game.world, x, y)) this.foam.push({ x, y, phase: hash2(x, y, game.world.seed) * 16 })
    for (let x = 0; x <= w; x++) { this.gridPath.moveTo(x * TILE, 0); this.gridPath.lineTo(x * TILE, h * TILE) }
    for (let y = 0; y <= h; y++) { this.gridPath.moveTo(0, y * TILE); this.gridPath.lineTo(w * TILE, y * TILE) }
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
      img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 84
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
    ctx.fillStyle = '#4a9cb0'; ctx.fillRect(0, 0, viewW * dpr, viewH * dpr)

    // 1. water background
    if (!this.waterPattern) this.waterPattern = ctx.createPattern(a.water, 'repeat')
    ctx.setTransform(s, 0, 0, s, tx, ty)
    if (this.waterPattern) { ctx.fillStyle = this.waterPattern; ctx.fillRect(vx0 - 64, vy0 - 64, vx1 - vx0 + 128, vy1 - vy0 + 128) }

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
    ctx.drawImage(this.tintCanvas, 0, 0, w, h, 0, 0, w * TILE, h * TILE)
    if (this.hatch) { ctx.fillStyle = this.hatch; ctx.fill(this.cutPath) }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'
    const lw = Math.max(5, 2.2 / cam.zoom)
    for (let k = 0; k < this.borders.length; k++) {
      ctx.strokeStyle = 'rgba(10,14,20,.35)'; ctx.lineWidth = lw + 3; ctx.stroke(this.borders[k])
      ctx.strokeStyle = FACTION_COLORS[g.displayColor(k)]; ctx.lineWidth = lw; ctx.stroke(this.borders[k])
    }

    // 5. grid overlay
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = Math.max(1, 1.2 / cam.zoom); ctx.stroke(this.gridPath)

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
        case K.unit: this.drawUnit(ctx, g.units[it.i], time, alpha); break
        case K.pawn: this.drawPawn(ctx, g.pawns[it.i], alpha); break
        case K.boat: this.drawBoat(ctx, g.boats[it.i], alpha, time); break
      }
    }
    for (const d of g.deaths) this.drawGhost(ctx, d)
    this.drawProjectiles(ctx)
    this.drawShells(ctx)
    this.drawFx(ctx)

    // 9. selection, routes, indicators
    this.drawOverlays(ctx, alpha, ui, time)
    this.stats.drawMs = performance.now() - t0
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
    // level of detail: the further out the camera, the fewer trees, and no stumps / shrubs / rocks at all
    const z = this.zoomNow
    const treeMod = z < 0.2 ? 5 : z < 0.28 ? 3 : z < 0.38 ? 2 : 1
    const showStump = z >= 0.4, showBush = z >= 0.34, showRock = z >= 0.26
    for (const t of g.world.trees) {
      if (!inView(t.x, t.y)) continue
      if (t.chopped) { if (showStump) this.push(t.y, K.stump, t.id) } else if (treeMod === 1 || t.id % treeMod === 0) this.push(t.y, K.tree, t.id)
    }
    g.world.decor.forEach((d, i) => { if (inView(d.x, d.y) && (d.type === 'bush' ? showBush : showRock)) this.push(d.y, d.type === 'bush' ? K.bush : K.rock, i) })
    g.towns.forEach((t, i) => { if (!t.ruined && inView(t.x, t.y)) this.push(t.y + 40, K.town, i) })
    g.towers.forEach((t, i) => { if (inView(t.x, t.y)) this.push(t.y + 36, K.tower, i) })
    g.boats.forEach((b, i) => { const y = b.py + (b.y - b.py) * alpha; if (inView(b.x, y)) this.push(y - 40, K.boat, i) }) // hulls sit under land units standing on the shore
    g.pawns.forEach((p, i) => { const y = p.py + (p.y - p.py) * alpha; if (inView(p.x, y)) this.push(y, K.pawn, i) }) // pawns never make trees see-through
    g.units.forEach((u, i) => { if (u.inTower >= 0) return; const y = u.py + (u.y - u.py) * alpha; if (inView(u.x, y)) { this.push(y, K.unit, i); this.occ.push(u.x, y) } })
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
  private drawTown(ctx: CanvasRenderingContext2D, i: number) {
    const t = this.game.towns[i], color = this.game.kingdoms[t.owner].color
    const img = t.kind === 'barracks' ? this.assets.barracks[color] : this.assets.houses[color]
    ctx.drawImage(img, t.x - img.width / 2, t.y + 46 - img.height)
    this.badge(ctx, t.owner, t.x, t.y + 46 - img.height - 4, 26)
    if (t.hp < t.maxHp - 1) this.bar(ctx, t.x, t.y - 120, 70, t.hp / t.maxHp, '#78d46a')
    if (t.raze && t.owner !== 0) { ctx.fillStyle = 'rgba(150,20,20,.9)'; ctx.fillRect(t.x - 26, t.y - 150, 52, 16); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('RAZE', t.x, t.y - 138) }
    if (t.flash > 0) { ctx.strokeStyle = `rgba(255,248,200,${t.flash / 1.2})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(t.x, t.y + 20, TOWN.captureRadius + (1.2 - t.flash) * 60, 0, Math.PI * 2); ctx.stroke() }
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
    if (t.kind === 'boat' || t.kind === 'zumwalt') { // a ship under construction: translucent hull on the slipway with a progress bar
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

  private shipImg(kind: 'boat' | 'zumwalt', color: number, dir: 'up' | 'down' | 'left' | 'right') { return this.assets.ships[kind][color][dir] }
  private drawBoat(ctx: CanvasRenderingContext2D, b: Boat, alpha: number, time: number) {
    const g = this.game, color = g.kingdoms[b.faction].color
    const x = b.px + (b.x - b.px) * alpha, y0 = b.py + (b.y - b.py) * alpha
    const bob = b.docked ? 0 : Math.sin(time * 2.2 + b.id) * 2
    const y = y0 + bob
    const img = this.shipImg(b.kind, color, b.dir)
    // soft shadow on the water
    ctx.fillStyle = 'rgba(10,40,60,.28)'; ctx.beginPath(); ctx.ellipse(x, y + 10, img.width * 0.42, img.height * 0.3, 0, 0, Math.PI * 2); ctx.fill()
    if (b.flash > 0) ctx.filter = 'brightness(1.8)'
    if (b.flip) { ctx.save(); ctx.translate(x, y); ctx.scale(1, -1); ctx.drawImage(img, -img.width / 2, -img.height / 2); ctx.restore() } else ctx.drawImage(img, x - img.width / 2, y - img.height / 2)
    ctx.filter = 'none'
    const sel = g.selection?.kind === 'boats' && g.selection.ids.includes(b.id)
    const top = y - img.height / 2 - 10
    this.badge(ctx, b.faction, x, top - 10, 18)
    if (b.hp < b.maxHp - 0.5 || sel) this.bar(ctx, x, top, 50, b.hp / b.maxHp, '#78d46a')
    if (b.cargo.length && b.faction === 0) { ctx.fillStyle = 'rgba(12,16,22,.85)'; ctx.fillRect(x - 18, top + 8, 36, 13); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${b.cargo.length > 0 ? g.unitCargo(b) : 0}/${b.cap}`, x, top + 18) }
    if (b.docking && !b.docked) { // lying beside the coast, waiting to moor: a ring fills over DOCK seconds (red while defenders hold the beach)
      const p = Math.min(1, b.dockT / DOCK.time), rad = (b.kind === 'zumwalt' ? ZUMWALT.length : BOAT.length) * 0.5 + 8
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = b.dockBlocked ? '#ff5a4a' : '#fff3a9'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (b.dockBlocked ? 1 : p)); ctx.stroke()
    }
    if (b.docked) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(x, y, (b.kind === 'zumwalt' ? ZUMWALT.length : BOAT.length) * 0.5 + 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
    if (sel) { ctx.strokeStyle = '#fff3a9'; ctx.lineWidth = 3; ctx.beginPath(); if (b.dir === 'up' || b.dir === 'down') ctx.ellipse(x, y, img.width / 2 + 8, img.height / 2 + 6, 0, 0, Math.PI * 2); else ctx.ellipse(x, y, img.width / 2 + 6, img.height / 2 + 8, 0, 0, Math.PI * 2); ctx.stroke() }
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
    const key = p.state === 'chopping' ? 'Chop' : p.state === 'building' ? 'Build' : p.carry > 0 ? (moving ? 'RunWood' : 'IdleWood') : moving ? 'Run' : 'Idle'
    const sh = set[key], fr = loopFrame(p.animT, 10, sh.frames), sc = PAWN.spriteScale
    ctx.save(); ctx.translate(x, y)
    if (p.facing < 0) ctx.scale(-1, 1)
    drawSheet(ctx, sh, fr, -sh.fw * sc / 2, -122 * sc, sh.fw * sc, sh.fh * sc)
    ctx.restore()
  }
  private drawGhost(ctx: CanvasRenderingContext2D, d: { x: number; y: number; faction: number; type: string; t: number }) {
    const color = this.game.kingdoms[d.faction].color
    const sh = d.type === 'archer' ? this.assets.archer[color].Idle : d.type === 'lancer' ? this.assets.lancer[color].Idle : this.assets.warrior[color].Idle
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
      for (const id of sel.ids) { const b = g.boatById(id); if (b?.kind === 'zumwalt' && !b.docked) { ctx.strokeStyle = 'rgba(255,200,120,.55)'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.beginPath(); ctx.arc(b.x, b.y, ZUMWALT.rangeTiles * TILE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) } }
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
        if (p.tree >= 0) { const t = g.world.trees[p.tree]; ctx.strokeStyle = '#f0cf6a'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(t.x, t.y - 6, 22, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
      }
    }
    if (g.placing && ui.hover) { // tower placement ghost
      const cx = Math.floor(ui.hover.x / TILE), cy = Math.floor(ui.hover.y / TILE), x = (cx + 0.5) * TILE, y = (cy + 0.5) * TILE
      const kind = g.placing, ok = g.structureError(kind, 0, ui.hover.x, ui.hover.y) === null
      if (kind === 'boat' || kind === 'zumwalt') {
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
