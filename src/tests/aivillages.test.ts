import { describe, expect, it } from 'vitest'
import { CARE, TILE } from '../game/config'
import type { Game } from '../game/Game'
import type { Town } from '../game/types'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const village = (g: Game, owner: number, cx: number, cy: number, level: 1 | 2 | 3 = 1): Town => {
  const t: Town = { id: g.towns.length, cx, cy, x: px(cx), y: px(cy), owner, kind: 'settlement', level, store: { lumber: 10, gold: 0, meat: 8 }, meatT: 0, upkeepT: 0, land: g.info.landmass[cy * g.world.w + cx], crate: null, abandoned: false, hitAt: -99, pawnIds: [], flash: 0, hp: 1500, maxHp: 1500, stock: 0, produce: true, raze: false, ruined: false }
  g.towns.push(t); g.markDirty(); g.recomputeTerritory()
  return t
}

describe('AI destroys villages it can clearly take', () => {
  it('on the same land: a village held by a single defender is taken by an AI at war with a few troops', () => {
    const rows = Array.from({ length: 40 }, () => '#'.repeat(120))
    const g = makeGame({ rows, towns: [[0, 10, 20], [1, 100, 20]], units: [[0, 76, 20], [1, 98, 20], [1, 98, 21], [1, 99, 20], [1, 99, 21], [1, 97, 20], [1, 97, 21]], relation: 'war', ai: true })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    const v = village(g, 0, 78, 20)
    g.time = 100
    for (let i = 0; i < 25 * 600 && !v.ruined && v.owner === 0; i++) g.step(1 / 25)
    expect(v.ruined || v.owner !== 0).toBe(true) // (enemy troops landing on a village take it over)
  }, 60000)

  it('on the same land: a village with a couple of defenders falls to a massive troop advantage', () => {
    const rows = Array.from({ length: 40 }, () => '#'.repeat(120))
    const units: [number, number, number][] = [[0, 77, 21], [0, 78, 21]]
    for (let i = 0; i < 14; i++) units.push([1, 96 + (i % 4), 18 + Math.floor(i / 4)])
    const g = makeGame({ rows, towns: [[0, 10, 20], [1, 100, 20]], units, relation: 'war', ai: true })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    const v = village(g, 0, 78, 20)
    g.time = 100
    for (let i = 0; i < 25 * 900 && !v.ruined && v.owner === 0; i++) g.step(1 / 25)
    expect(v.ruined || v.owner !== 0).toBe(true) // (enemy troops landing on a village take it over)
  }, 90000)

  it('over a long march: a 3-town AI with 9 troops takes a village 35 tiles away held by two defenders', () => {
    const rows = Array.from({ length: 40 }, () => '#'.repeat(120))
    const units: [number, number, number][] = [[0, 64, 20], [0, 64, 21]]
    for (let i = 0; i < 9; i++) units.push([1, 96 + (i % 3), 18 + Math.floor(i / 3)])
    const g = makeGame({ rows, towns: [[0, 10, 20], [1, 100, 20], [1, 104, 20], [1, 100, 24]], units, relation: 'war', ai: true })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    const v = village(g, 0, 65, 20)
    g.time = 100
    let t = 0
    for (; t < 25 * 1200 && !v.ruined; t++) g.step(1 / 25)
    expect({ ruined: v.ruined, secs: Math.round(t / 25), aiUnits: g.units.filter(u => u.faction === 1).length }).toMatchObject({ ruined: true })
  }, 120000)

  it('across the sea: an AI with boats takes a village held by one defender', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0 // (the test army is bigger than its two towns' capacity)
    try {
    const rows = Array.from({ length: 40 }, (_, y) => (y < 2 || y >= 38 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(10)))
    // kingdom 1 on the west island (with troops), kingdom 0's village alone on the east island
    const g = makeGame({ rows, towns: [[0, 95, 5], [1, 33, 20]], units: [[1, 31, 20], [1, 31, 21], [1, 30, 20], [1, 30, 21], [1, 29, 20], [1, 29, 21], [1, 28, 20], [1, 28, 21], [0, 84, 20]], pawns: true, relation: 'war', ai: true })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    g.kingdoms[1].lumber = 600
    g.kingdoms[1].aggression = 1
    const v = village(g, 0, 85, 20)
    g.time = 200
    let t = 0
    for (; t < 25 * 1500 && !v.ruined; t++) { g.step(1 / 25); if (g.kingdoms[1].lumber < 300) g.kingdoms[1].lumber = 600 }
    expect({ ruined: v.ruined, secs: Math.round(t / 25), boats: g.boats.filter(b => b.faction === 1).length }).toMatchObject({ ruined: true })
    } finally { CARE.overcapPct = keep }
  }, 120000)
})
