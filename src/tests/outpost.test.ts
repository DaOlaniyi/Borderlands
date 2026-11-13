import { describe, expect, it } from 'vitest'
import { CARE, OUTPOST, TILE } from '../game/config'
import type { Game } from '../game/Game'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const land = Array.from({ length: 40 }, () => '#'.repeat(120))
const mk = (extra: Partial<Parameters<typeof makeGame>[0]> = {}) => makeGame({ rows: land, towns: [[0, 20, 20], [1, 100, 20]], units: [], pawns: true, relation: 'war', ...extra })
const at = (g: Game, x: number, y: number) => y * g.world.w + x

describe('outposts', () => {
  it('cost 100 power, are instant, and need your own ground within a few tiles', () => {
    const g = mk()
    g.kingdoms[0].power = 150
    expect(g.outpostError(0, px(60), px(20))).toMatch(/own ground/)                  // far from anything of yours
    expect(g.outpostError(0, px(32), px(20))).toBeNull()                             // at the edge of your territory
    const o = g.placeOutpost(0, px(32), px(20))!
    expect(o).toBeTruthy(); expect(o.hp).toBe(1)
    expect(g.kingdoms[0].power).toBe(50)
    expect(g.outpostError(0, px(33), px(20))).toMatch(/power|close/)                 // spacing and cost
    g.kingdoms[0].power = 500
    expect(g.outpostError(0, px(33), px(20))).toMatch(/close/)
    expect(g.placing).toBe(false)
  })
  it('extend friendly, supplied territory as a half-strength buffer that pawns cannot use', () => {
    const g = mk()
    g.kingdoms[0].power = 500
    const edge = 31                                                                 // the territory of a town ends ~11 tiles out
    const before = g.controller[at(g, edge + 5, 20)]
    expect(before).toBe(0)
    g.placeOutpost(0, px(edge + 2), px(20)); g.recomputeTerritory()
    const i = at(g, edge + 4, 20)
    expect(g.controller[i]).toBe(1)                                                 // friendly ground now
    expect(g.supplied[i]).toBe(1)                                                   // and supplied: a unit there is not cut off
    expect(g.buffer[i]).toBe(1)                                                     // but only as a combat buffer
    expect(g.buffer[at(g, 15, 20)]).toBe(0)                                         // real territory is not buffer
    const u = g.spawnUnit(0, px(edge + 5), px(20)); stepN(g, 25 * 30)
    expect(u.cutOff).toBe(false)
    // pawns do not treat it as theirs
    const p = g.pawns[0]
    expect(g.canPawnStand(p, px(edge + 4), px(20))).toBe(false)
    expect(g.canPawnStand(p, px(15), px(20))).toBe(true)
    // a unit beyond the buffer WITHOUT an outpost is cut off for comparison
    const g2 = mk(); const v = g2.spawnUnit(0, px(edge + 5), px(20)); stepN(g2, 25 * 3)
    expect(v.cutOff).toBe(true)
  })
  it('any hostile land unit destroys one with a single strike; the buffer vanishes with it', () => {
    const g = mk()
    g.kingdoms[0].power = 500
    const o = g.placeOutpost(0, px(33), px(20))!
    const foe = g.spawnUnit(1, o.x + 60, o.y)
    stepN(g, 25 * 4)
    expect(g.outposts.includes(o)).toBe(false)
    expect(foe.state).not.toBe('dead')
    g.recomputeTerritory()
    expect(g.buffer[at(g, 35, 20)]).toBe(0)
  })
  it('archer towers cannot shoot them', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    const g = mk({ towns: [[0, 20, 20], [1, 46, 20]] })
    g.kingdoms[0].power = 500; g.kingdoms[1].lumber = 100
    const o = g.placeOutpost(0, px(30), px(20))!
    const t = g.placeTower(1, px(38), px(20))!; t.built = true; t.hp = t.maxHp          // an enemy tower a few tiles from it
    const a = g.spawnUnit(1, t.x, t.y, 'archer'); t.archer = a.id; a.inTower = t.id
    g.diplomacy.set(0, 1, 'war', 0)
    stepN(g, 25 * 8)
    expect(g.outposts.includes(o)).toBe(true)                                       // the garrison never fired at it
    CARE.overcapPct = keep
  })
})

describe('AI outposts', () => {
  it('an advancing army lays a trail of outposts so it is not cut off', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    const units: [number, number, number][] = []
    for (let i = 0; i < 8; i++) units.push([1, 96 + (i % 4), 18 + Math.floor(i / 4)])
    const g = makeGame({ rows: land, towns: [[0, 62, 20], [1, 100, 20], [1, 104, 24], [1, 100, 28]], units, relation: 'war', ai: true })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    g.kingdoms[1].power = 1000; g.time = 100
    let most = 0
    for (let i = 0; i < 25 * 300; i++) { g.step(1 / 25); g.kingdoms[1].power = Math.max(g.kingdoms[1].power, 400); most = Math.max(most, g.outposts.filter(o => o.faction === 1).length) }
    expect(most).toBeGreaterThanOrEqual(1)
    expect(most).toBeLessThanOrEqual(OUTPOST.max)
    CARE.overcapPct = keep
  }, 60000)
})

describe('a beachhead pushes inland with outposts', () => {
  it('troops landed on an island they have no town on keep advancing toward a far inland town, laying outposts as they go', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    const rows = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(140) : '#'.repeat(30) + '.'.repeat(30) + '#'.repeat(80)))
    const units: [number, number, number][] = []
    for (let i = 0; i < 10; i++) units.push([1, 62 + (i % 3), 20 + Math.floor(i / 3)])      // landed on the east island's west beach
    const g = makeGame({ rows, towns: [[0, 125, 20], [1, 15, 20], [1, 12, 28]], units, relation: 'war', ai: true })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    g.kingdoms[1].power = 1500; g.time = 200
    const x0 = g.units.filter(u => u.faction === 1).reduce((n, u) => n + u.x, 0) / 10 / TILE
    let most = 0
    for (let i = 0; i < 25 * 360; i++) { g.step(1 / 25); g.kingdoms[1].power = Math.max(g.kingdoms[1].power, 600); most = Math.max(most, g.outposts.filter(o => o.faction === 1).length) }
    const alive = g.units.filter(u => u.faction === 1)
    const x1 = alive.reduce((n, u) => n + u.x, 0) / Math.max(1, alive.length) / TILE
    expect(most).toBeGreaterThanOrEqual(2)                // a trail, not one stake
    expect(x1).toBeGreaterThan(x0 + 12)                   // and the column really went inland
    expect(alive.length).toBeGreaterThanOrEqual(7)        // without being bled white by attrition
    CARE.overcapPct = keep
  }, 120000)
})
