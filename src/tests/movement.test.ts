import { describe, expect, it } from 'vitest'
import { cellBounds, cellCenter, screenToWorld, worldToCell, worldToScreen, type Camera } from '../game/Camera'
import { ROUTE, TILE } from '../game/config'
import { InputController } from '../game/InputController'
import { simplifyRoute } from '../game/Routes'
import { makeGame, openRows, stepN } from './helpers'

const view = () => ({ w: 1280, h: 720 })
const setup = (rows = openRows(40, 30)) => {
  const g = makeGame({ rows, towns: [[0, 5, 15], [1, 38, 2]], units: [[0, 8, 15]] })
  const cam: Camera = { x: 0, y: 700, zoom: 1 }
  const input = new InputController(g, cam, view)
  const u = g.units[0]
  const s = () => worldToScreen(cam, u.x, u.y - 10)
  return { g, cam, input, u, s }
}

describe('coordinate helpers', () => {
  it('round-trips screen/world and maps world to cells', () => {
    const cam: Camera = { x: 130, y: -40, zoom: 0.37 }
    const w = screenToWorld(cam, 321, 123)
    const s = worldToScreen(cam, w.x, w.y)
    expect(s.x).toBeCloseTo(321); expect(s.y).toBeCloseTo(123)
    const world = { w: 10, h: 10 }
    expect(worldToCell(world, 64 * 3 + 5, 64 * 2 + 63)).toBe(2 * 10 + 3)
    expect(worldToCell(world, -1, 5)).toBe(-1)
    expect(cellCenter(world, 23)).toEqual({ x: 3.5 * TILE, y: 2.5 * TILE })
    expect(cellBounds(world, 23)).toEqual({ x: 3 * TILE, y: 2 * TILE, w: TILE, h: TILE })
  })
})

describe('input and routes', () => {
  it('a click selects a warrior without issuing a route', () => {
    const { g, input, u, s } = setup()
    const p = s()
    input.down(p.x, p.y); input.up(p.x + 1, p.y)
    expect(g.selection).toEqual({ kind: 'units', ids: [u.id] })
    expect(u.route.length).toBe(0)
  })

  it('a drag creates a route with far fewer points than raw pointer events', () => {
    const { g, input, u, s, cam } = setup()
    const p = s()
    input.down(p.x, p.y)
    let raw = 0
    for (let i = 1; i <= 120; i++) { input.move(p.x + i * 3, p.y - Math.sin(i / 25) * 40); raw++ }
    expect(input.draft).not.toBeNull()
    input.up(p.x + 360, p.y - Math.sin(120 / 25) * 40)
    expect(g.selection?.kind).toBe('units')
    expect(u.route.length / 2).toBeGreaterThan(1)
    expect(u.route.length / 2).toBeLessThan(raw / 4)
    expect(cam.x).toBe(0) // the camera did not pan
  })

  it('simplifies a dense polyline while keeping a sharp turn', () => {
    const pts: number[] = []
    for (let x = 0; x <= 200; x += 5) pts.push(x, 0)
    for (let y = 5; y <= 200; y += 5) pts.push(200, y)
    const s = simplifyRoute(pts)
    expect(s.length / 2).toBe(3)
    expect(s.slice(2, 4)).toEqual([200, 0])
  })

  it('units move in continuous coordinates, not tile to tile', () => {
    const { g, input, u, s } = setup()
    const p = s()
    input.down(p.x, p.y); input.move(p.x + 20, p.y + 5); input.move(p.x + 200, p.y + 50); input.up(p.x + 300, p.y + 60)
    let offCentre = 0, maxStep = 0, px = u.x, py = u.y
    for (let i = 0; i < 160; i++) {
      stepN(g, 1)
      maxStep = Math.max(maxStep, Math.hypot(u.x - px, u.y - py)); px = u.x; py = u.y
      if (Math.abs((u.x % TILE) - TILE / 2) > 3 && Math.abs((u.y % TILE) - TILE / 2) > 3) offCentre++
    }
    expect(offCentre).toBeGreaterThan(60)
    expect(maxStep).toBeLessThan(5) // ≤ speed × dt, never a tile-sized hop
    expect(u.x).toBeGreaterThan(8.5 * TILE + 90)
  })

  it('routes never cross water', () => {
    const rows = openRows(40, 30).map((r, y) => (y >= 0 ? r.slice(0, 20) + '...' + r.slice(23) : r))
    const { g, input, u, s } = setup(rows)
    const p = s()
    input.down(p.x, p.y); input.move(p.x + 30, p.y); input.move(p.x + 400, p.y); input.up(p.x + 800, p.y)
    expect(u.route.length).toBeGreaterThan(0)
    for (let i = 0; i < u.route.length; i += 2) expect(g.isLandAt(u.route[i], u.route[i + 1])).toBe(true)
    let px = u.x, py = u.y
    for (let i = 0; i < u.route.length; i += 2) {
      for (let t = 0; t <= 1; t += 0.05) expect(g.isLandAt(px + (u.route[i] - px) * t, py + (u.route[i + 1] - py) * t)).toBe(true)
      px = u.route[i]; py = u.route[i + 1]
    }
    expect(Math.max(...u.route.filter((_, i) => i % 2 === 0))).toBeLessThan(20 * TILE)
  })

  it('detours around a pond between the start and the endpoint', () => {
    const rows = openRows(40, 30).map((r, y) => (y >= 12 && y <= 18 ? r.slice(0, 14) + '....' + r.slice(18) : r))
    const { g, input, u, s } = setup(rows)
    const p = s()
    input.down(p.x, p.y); input.move(p.x + 30, p.y); input.move(p.x + 700, p.y); input.up(p.x + 700, p.y)
    expect(u.route.length).toBeGreaterThan(2)
    let px = u.x, py = u.y
    for (let i = 0; i < u.route.length; i += 2) {
      for (let t = 0; t <= 1; t += 0.05) expect(g.isLandAt(px + (u.route[i] - px) * t, py + (u.route[i + 1] - py) * t)).toBe(true)
      px = u.route[i]; py = u.route[i + 1]
    }
    expect(Math.abs(u.route[u.route.length - 2] - (u.x + 700))).toBeLessThan(TILE)
  })

  it('dragging empty terrain pans the camera instead of commanding a unit', () => {
    const { g, input, u, cam } = setup()
    const x0 = cam.x, y0 = cam.y
    input.down(900, 300); input.move(850, 260); input.move(700, 200); input.up(700, 200)
    expect(cam.x).toBeGreaterThan(x0 + 100); expect(cam.y).not.toBe(y0)
    expect(g.selection).toBeNull(); expect(u.route.length).toBe(0); expect(input.draft).toBeNull()
  })

  it('has a sensible drag threshold', () => { expect(ROUTE.dragThresholdPx).toBeGreaterThan(2) })
})
