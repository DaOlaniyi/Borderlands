import { describe, expect, it } from 'vitest'
import { TERRITORY } from '../game/config'
import { computeSupply, forEachBorderEdge, stack, stackContribution } from '../game/TerritorySystem'
import { ctrl, makeGame, openRows, stepN } from './helpers'
import { Game } from '../game/Game'

const open40 = openRows(40, 20)

describe('territory competition', () => {
  it('town influence radius is exactly 11', () => {
    const g = makeGame({ rows: open40, towns: [[0, 10, 10], [1, 38, 18]] })
    expect(TERRITORY.townRadius).toBe(11)
    expect(ctrl(g, 21, 10)).toBe(1) // distance 11
    expect(ctrl(g, 22, 10)).toBe(0) // distance 12
    expect(ctrl(g, 17, 17)).toBe(1) // diagonal distance ≈ 9.9
    expect(ctrl(g, 18, 18)).toBe(0) // diagonal distance ≈ 11.3
  })

  it('battle units claim a radius-2 square', () => {
    const g = makeGame({ rows: open40, towns: [[0, 4, 2], [1, 38, 18]], units: [[1, 22, 8]] })
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) expect(ctrl(g, 22 + dx, 8 + dy)).toBe(2)
    expect(ctrl(g, 25, 8)).toBe(0); expect(ctrl(g, 22, 11)).toBe(0)
  })

  it('pawns contribute no influence', () => {
    const g = makeGame({ rows: open40, towns: [[0, 4, 2], [1, 38, 18]], pawns: true })
    const p = g.pawns[0]
    p.x = 25 * 64; p.y = 8 * 64; p.cell = g.cellAt(p.x, p.y)
    g.markDirty(); g.recomputeTerritory()
    expect(ctrl(g, 25, 8)).toBe(0)
  })

  it('does not recompute for movement inside a tile and does when a new tile is entered', () => {
    const g = makeGame({ rows: open40, towns: [[0, 4, 2], [1, 38, 18]], units: [[0, 22, 8]] })
    stepN(g, 2)
    const before = g.recomputeCount
    const u = g.units[0]
    u.x += 6; u.y += 6 // stays inside the same 64px tile
    stepN(g, 1)
    expect(g.recomputeCount).toBe(before)
    g.applyRoute(u, [(22 + 1.5) * 64, (8 + 0.5) * 64]) // into the next tile
    let steps = 0
    while (g.recomputeCount === before && steps++ < 120) stepN(g, 1)
    expect(g.recomputeCount).toBeGreaterThan(before)
    expect(u.cell % g.world.w).toBe(23)
  })

  it('first friendly unit counts 1.0, extra units 0.5, with a cap', () => {
    expect(stackContribution(0)).toBe(1); expect(stackContribution(1)).toBe(0.5); expect(stackContribution(5)).toBe(0.5)
    expect(stack(1, 1)).toBeCloseTo(1); expect(stack(1, 2)).toBeCloseTo(1.5); expect(stack(1, 3)).toBeCloseTo(2)
    expect(stack(1, 50)).toBeLessThanOrEqual(TERRITORY.stackCap + 1e-9)
  })

  it('two overlapping friendly units beat one equal opposing unit; a stronger force wins', () => {
    const g = makeGame({ rows: open40, towns: [[0, 4, 2], [1, 38, 18]], units: [[0, 22, 8], [0, 22, 8], [1, 22, 8]] })
    expect(ctrl(g, 22, 8)).toBe(1)
    const h = makeGame({ rows: open40, towns: [[0, 4, 2], [1, 38, 18]], units: [[0, 22, 8], [1, 22, 8]] })
    expect(ctrl(h, 22, 8)).toBe(0 + 1) // tie resolves to the lower faction id deterministically
    const big = makeGame({ rows: open40, towns: [[0, 4, 2], [1, 38, 18]], units: [...Array(12).fill([0, 22, 8]), [1, 22, 8], [1, 22, 8], [1, 22, 8], [1, 22, 8]] })
    // 12 stacked units are capped, so four opposing units (1 + 3×0.5 = 2.5) are not infinitely out-dominated
    expect(ctrl(big, 22, 8)).toBe(1)
    const flipped = makeGame({ rows: open40, towns: [[0, 4, 2], [1, 38, 18]], units: [...Array(12).fill([0, 22, 8]), ...Array(12).fill([1, 22, 8])] })
    expect(ctrl(flipped, 22, 8)).toBe(1) // equal capped strength — no runaway dominance
  })

  it('temporary enemy influence disappears when the enemy leaves', () => {
    const g = makeGame({ rows: open40, towns: [[0, 10, 10], [1, 38, 18]], units: [[1, 19, 10]] })
    expect(ctrl(g, 19, 10)).toBe(2)
    g.killUnit(g.units[0]); stepN(g, 1)
    expect(ctrl(g, 19, 10)).toBe(1)
    expect(ctrl(g, 20, 10)).toBe(1)
  })

  it('dead units stop contributing immediately', () => {
    const g = makeGame({ rows: open40, towns: [[0, 4, 2], [1, 38, 18]], units: [[0, 22, 8]] })
    expect(ctrl(g, 22, 8)).toBe(1)
    g.killUnit(g.units[0])
    expect(g.isDirty).toBe(true)
    stepN(g, 1)
    expect(ctrl(g, 22, 8)).toBe(0)
  })

  it('has no internal borders inside merged friendly regions', () => {
    const g = makeGame({ rows: open40, towns: [[0, 10, 10], [0, 17, 10], [1, 38, 18]] })
    let internal = 0, total = 0
    forEachBorderEdge(g.controller, g.world.w, g.world.h, (x0, y0, x1, y1, f, o) => {
      total++
      expect(f).not.toBe(o)
      if (f === 1 && o === 1) internal++
      if (x0 >= 12 && x1 <= 16 && y0 >= 9 && y1 <= 12 && f === 1) expect(o).toBe(0)
    })
    expect(internal).toBe(0); expect(total).toBeGreaterThan(0)
    expect(ctrl(g, 13, 10)).toBe(1) // the merged bridge exists
  })

  it('shares a single frontline between opposing towns', () => {
    const g = makeGame({ rows: openRows(40, 20), towns: [[0, 10, 10], [1, 26, 10]] })
    const edges: [number, number][] = []
    forEachBorderEdge(g.controller, 40, 20, (x0, y0, x1, y1, f, o) => { if (o !== 0 && f !== o && f === 1) edges.push([x0, y0]) })
    expect(edges.length).toBeGreaterThan(0)
    expect(new Set(edges.map(e => e[0])).size).toBe(1) // a straight vertical frontline midway between them
  })
})

describe('supply', () => {
  const sup = (cells: [number, number][], town: [number, number]) => {
    const w = 5, h = 5, c = new Uint8Array(w * h), s = new Uint8Array(w * h)
    for (const [x, y] of cells) c[y * w + x] = 1
    computeSupply(c, w, h, [{ cell: town[1] * w + town[0], faction: 0 }], s)
    return (x: number, y: number) => s[y * w + x]
  }
  it('does not connect tiles that only touch at a corner', () => {
    const at = sup([[0, 0], [1, 1]], [0, 0])
    expect(at(0, 0)).toBe(1); expect(at(1, 1)).toBe(0)
  })
  it('connects tiles along an edge-connected corridor', () => {
    const at = sup([[0, 0], [1, 0], [1, 1], [1, 2]], [0, 0])
    expect(at(1, 2)).toBe(1)
  })
})

describe('isolated pockets', () => {
  const rows = openRows(50, 9)
  const base = (): Game => makeGame({ rows, towns: [[0, 3, 4], [1, 48, 2]], units: [[0, 18, 4]] })

  it('a unit beyond the town corridor keeps local influence but is unsupplied and takes attrition', () => {
    const g = base()
    const u = g.units[0]
    expect(ctrl(g, 18, 4)).toBe(1)
    expect(g.supplied[4 * 50 + 18]).toBe(0)
    expect(g.supplied[4 * 50 + 3]).toBe(1)
    stepN(g, 25 * (TERRITORY.cutGrace + 1))
    expect(u.cutOff).toBe(true)
    expect(u.hp).toBeLessThan(900) // attrition starts only after the grace period
    expect(u.hp).toBeCloseTo(900 - 900 * TERRITORY.attritionPct, 0)
  })

  it('reopening a real territorial path restores supply', () => {
    const g = base()
    stepN(g, 5)
    expect(g.supplied[4 * 50 + 18]).toBe(0)
    g.spawnWarrior(0, 15.5 * 64, 4.5 * 64) // bridges the neutral gap between town reach (x≤14) and the pocket (x≥16)
    stepN(g, 2)
    expect(g.supplied[4 * 50 + 18]).toBe(1)
    expect(g.units[0].cutOff).toBe(false)
  })

  it('an enemy pushing across the corridor cuts the pocket off', () => {
    const g = makeGame({ rows, towns: [[0, 3, 4], [1, 48, 2]], units: [[0, 15, 4], [0, 18, 4]] })
    expect(g.supplied[4 * 50 + 18]).toBe(1)
    g.spawnWarrior(1, 15.5 * 64, 4.5 * 64); g.spawnWarrior(1, 15.5 * 64, 4.5 * 64); g.spawnWarrior(1, 15.5 * 64, 4.5 * 64)
    g.killUnit(g.units[0]) // the blocker unit dies
    g.recomputeTerritory()
    expect(ctrl(g, 15, 4)).toBe(2)
    expect(g.supplied[4 * 50 + 18]).toBe(0)
    expect(ctrl(g, 18, 4)).toBe(1) // still locally owned
  })
})
