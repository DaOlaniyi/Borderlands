import { ROUTE, UNIT_BODY } from './config'
import { clampCamera, screenToWorld, zoomAt, type Camera } from './Camera'
import type { Game } from './Game'
import { sampleDraft } from './Routes'

type Mode = 'none' | 'pan' | 'units' | 'pawn' | 'place' | 'brush' | 'boats'

/**
 * Pointer logic without DOM dependencies (the canvas glue just forwards events), so it can be unit tested.
 * Press on a player unit selects it (shift adds to the selection); dragging from it draws one route that every selected
 * unit follows; clicking a tree with a pawn selected sends the pawn there; anything else pans the camera.
 */
export class InputController {
  draft: number[] | null = null
  hoverTree = -1
  hover: { x: number; y: number } | null = null
  private mode: Mode = 'none'
  private startX = 0
  private startY = 0
  private camX = 0
  private camY = 0
  private dragging = false
  private unitId = -1
  private shift = false
  /** Brush mode (C): paint a hollow circle over units to select several. */
  brush = false
  static BRUSH_PX = 30
  rawSamples = 0 // number of pointer samples that reached the draft logic (diagnostics/tests)

  constructor(private game: Game, public cam: Camera, private view: () => { w: number; h: number }) {}

  private hitR() { return Math.max(UNIT_BODY.hitRadius, 22 / this.cam.zoom) }

  down(sx: number, sy: number, shift = false) {
    const g = this.game
    this.startX = sx; this.startY = sy; this.dragging = false; this.draft = null; this.shift = shift
    this.camX = this.cam.x; this.camY = this.cam.y
    if (this.brush) { this.mode = 'brush'; this.paint(sx, sy); return }
    if (g.placing) { this.mode = 'place'; return }
    const w = screenToWorld(this.cam, sx, sy)
    const pick = g.pickUnit(w.x, w.y, this.hitR())
    if (pick?.kind === 'units') {
      const id = pick.ids[0], cur = g.selection?.kind === 'units' ? g.selection.ids : []
      if (shift) g.selection = { kind: 'units', ids: cur.includes(id) ? cur.filter(i => i !== id) : [...cur, id] }
      else if (!cur.includes(id)) g.selection = { kind: 'units', ids: [id] }
      if (g.selection?.kind === 'units' && !g.selection.ids.length) g.selection = null
      this.unitId = id; this.mode = 'units'
      return
    }
    const boat = pick ? null : g.pickBoat(w.x, w.y)
    if (boat) { // ships are selected like units: drag from one to draw its sailing route
      const cur = g.selection?.kind === 'boats' ? g.selection.ids : []
      if (shift) g.selection = { kind: 'boats', ids: cur.includes(boat.id) ? cur.filter(i => i !== boat.id) : [...cur, boat.id] }
      else if (!cur.includes(boat.id)) g.selection = { kind: 'boats', ids: [boat.id] }
      if (g.selection?.kind === 'boats' && !g.selection.ids.length) g.selection = null
      this.unitId = boat.id; this.mode = 'boats'
      return
    }
    if (pick?.kind === 'pawn') { g.selection = pick; this.unitId = pick.id; this.mode = 'pawn'; return }
    this.mode = 'pan'
  }

  move(sx: number, sy: number, pressed = true) {
    const g = this.game
    const w = screenToWorld(this.cam, sx, sy)
    this.hover = w
    if (this.mode === 'brush' && pressed) { this.paint(sx, sy); return }
    if (!pressed || this.mode === 'none') {
      this.hoverTree = g.selection?.kind === 'pawn' ? g.pickTree(w.x, w.y, 40) : g.pickTree(w.x, w.y, 28)
      return
    }
    const moved = Math.hypot(sx - this.startX, sy - this.startY)
    if (this.mode === 'pan' || this.mode === 'place') {
      if (moved > ROUTE.dragThresholdPx) this.dragging = true
      if (this.dragging) {
        this.cam.x = this.camX - (sx - this.startX) / this.cam.zoom
        this.cam.y = this.camY - (sy - this.startY) / this.cam.zoom
        const v = this.view(); clampCamera(this.cam, v.w, v.h, g.world.w, g.world.h)
      }
    } else if (this.mode === 'units') {
      if (!this.dragging && moved > ROUTE.dragThresholdPx) {
        const inSel = g.selection?.kind === 'units' && g.selection.ids.includes(this.unitId)
        if (inSel) { this.dragging = true; this.draft = [] }
        else this.mode = 'none'
      }
      if (this.dragging && this.draft) { this.rawSamples++; sampleDraft(this.draft, w.x, w.y) }
    } else if (this.mode === 'boats') {
      if (!this.dragging && moved > ROUTE.dragThresholdPx) {
        const inSel = g.selection?.kind === 'boats' && g.selection.ids.includes(this.unitId)
        if (inSel) { this.dragging = true; this.draft = [] } else this.mode = 'none'
      }
      if (this.dragging && this.draft) { this.rawSamples++; sampleDraft(this.draft, w.x, w.y) }
    } else if (this.mode === 'pawn') {
      if (moved > ROUTE.dragThresholdPx) this.dragging = true
      this.hoverTree = g.pickTree(w.x, w.y, 40)
    }
  }

  up(sx: number, sy: number) {
    const g = this.game, w = screenToWorld(this.cam, sx, sy)
    if (this.mode === 'units') {
      if (this.dragging && this.draft) {
        sampleDraft(this.draft, w.x, w.y, 1)
        g.orderRouteMany(g.selectedUnits(), this.draft)
      } else if (!this.shift && g.selection?.kind === 'units' && g.selection.ids.length > 1) {
        g.selection = { kind: 'units', ids: [this.unitId] } // plain click on one member narrows the selection
      }
    } else if (this.mode === 'boats') {
      if (this.dragging && this.draft) { sampleDraft(this.draft, w.x, w.y, 1); g.orderBoats(g.selectedBoats(), this.draft) }
      else if (!this.shift && g.selection?.kind === 'boats' && g.selection.ids.length > 1) g.selection = { kind: 'boats', ids: [this.unitId] }
    } else if (this.mode === 'pawn') {
      const p = g.pawnById(this.unitId), t = g.pickTree(w.x, w.y, 44)
      if (p && t >= 0 && g.selection?.kind === 'pawn') g.orderPawn(p, t)
    } else if (this.mode === 'place' && !this.dragging) {
      const kind = g.placing as Exclude<typeof g.placing, false>
      const err = g.structureError(kind, 0, w.x, w.y)
      if (err) g.say(err)
      else { g.placeStructure(kind, 0, w.x, w.y); if (!this.shift) g.placing = false }
    } else if (this.mode === 'pan' && !this.dragging) {
      // click on empty ground: pawn orders go to a tree under the pointer, otherwise clear the selection
      const t = g.selection?.kind === 'pawn' ? g.pickTree(w.x, w.y, 44) : -1
      const p = g.selection?.kind === 'pawn' ? g.pawnById(g.selection.id) : null
      if (p && t >= 0) g.orderPawn(p, t)
      else {
        const site = g.pickStructure(w.x, w.y), town = site ? null : g.pickTown(w.x, w.y)
        if (site) g.selection = { kind: 'structure', id: site.id }
        else if (town) { // clicking an enemy town a second time flips its objective (CAPTURE ⇄ RAZE)
          if (g.selection?.kind === 'town' && g.selection.id === town.id && town.owner !== 0) g.toggleTownRaze(town.id)
          g.selection = { kind: 'town', id: town.id }
        } else g.selection = null
      }
    }
    this.draft = null; this.dragging = false; this.mode = 'none'
  }

  /** Add every friendly unit under the brush circle to the selection. */
  private paint(sx: number, sy: number) {
    const g = this.game, w = screenToWorld(this.cam, sx, sy), r = InputController.BRUSH_PX / this.cam.zoom + 12
    const ids = g.selection?.kind === 'units' ? [...g.selection.ids] : []
    for (const u of g.units) if (u.faction === 0 && u.state !== 'dead' && u.inTower < 0 && !ids.includes(u.id) && Math.hypot(u.x - w.x, u.y - 14 - w.y) <= r) ids.push(u.id)
    g.selection = ids.length ? { kind: 'units', ids } : g.selection
  }

  /** C: toggle brush selection. */
  toggleBrush() { this.brush = !this.brush; this.draft = null; this.mode = 'none'; return this.brush }

  /** S: abandon the order being drawn (even mid-drag) and stop the selected units. */
  stop() { this.draft = null; this.dragging = false; this.mode = 'none'; this.game.stopSelected() }

  wheel(sx: number, sy: number, deltaY: number, minZoom?: number) {
    zoomAt(this.cam, sx, sy, Math.exp(-deltaY * 0.0012), minZoom)
    const v = this.view(); clampCamera(this.cam, v.w, v.h, this.game.world.w, this.game.world.h)
  }
}
