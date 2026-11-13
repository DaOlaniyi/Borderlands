import { describe, expect, it } from 'vitest'
import { AI, TILE, TOWN, UNIT } from '../game/config'
import { makeGame, openRows, stepN } from './helpers'

const rows = openRows(130, 40)

describe('existential threat', () => {
  it('when the player holds more towns than everyone else combined, warring AI kingdoms make peace, ally and fight the player', () => {
    const g = makeGame({ rows, towns: [[0, 10, 10], [0, 20, 10], [0, 30, 10], [0, 40, 10], [1, 60, 20], [2, 90, 20]], units: [], relation: 'neutral' })
    g.diplomacy.set(1, 2, 'war', 0)
    g.time = 100
    stepN(g, 30)
    expect(g.diplomacy.get(1, 2)).toBe('allied')
    expect(g.diplomacy.hostile(1, 0)).toBe(true); expect(g.diplomacy.hostile(2, 0)).toBe(true)
  })
  it('also rallies against a runaway AI kingdom, and leaves the player alone', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20], [1, 30, 20], [1, 40, 20], [1, 50, 20], [2, 80, 20], [3, 110, 20]], units: [], relation: 'neutral' })
    g.diplomacy.set(2, 3, 'war', 0)
    g.time = 100
    stepN(g, 30)
    expect(g.diplomacy.get(2, 3)).toBe('allied')
    expect(g.diplomacy.hostile(2, 1)).toBe(true); expect(g.diplomacy.hostile(3, 1)).toBe(true)
    expect(g.diplomacy.hostile(0, 2)).toBe(false)
  })
})

describe('AI never freezes in a block pose forever', () => {
  it('a blocking unit is released by the watchdog even if the threat never leaves', () => {
    const g = makeGame({ rows, towns: [[1, 20, 20], [0, 100, 20]], units: [[1, 22, 20], [0, 26, 20]], ai: true, relation: 'war' })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    const guard = g.units.find(u => u.faction === 1)!, foe = g.units.find(u => u.faction === 0)!
    foe.mode = 'block'; foe.hp = foe.maxHp
    stepN(g, 25 * (AI.maxBlockSeconds + AI.blockCooldown + 20))
    // whatever it is doing, it must not still be holding the same frozen pose after a minute
    const since = g.aiMemo.blockSince.get(guard.id)
    expect(since === undefined || g.time - since <= AI.maxBlockSeconds + 2).toBe(true)
  })
})

describe('towns: razing, health, production toggle', () => {
  it('a town has 3x the health of an archer tower and mends when no enemy is near', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 100, 20]], units: [] })
    const t = g.towns[0]
    expect(t.maxHp).toBe(UNIT.warrior.hp * 3 * TOWN.hpMult)
    t.hp = t.maxHp / 2
    stepN(g, 25 * 20)
    expect(t.hp).toBeGreaterThan(t.maxHp / 2)
  })
  it('RAZE destroys an enemy town instead of capturing it; CAPTURE (default) takes it', () => {
    const cap = makeGame({ rows, towns: [[0, 20, 20], [1, 100, 20]], units: [[0, 100, 20]] })
    stepN(cap, 25 * 2)
    expect(cap.towns[1].owner).toBe(0)
    const raze = makeGame({ rows, towns: [[0, 20, 20], [1, 100, 20]], units: [[0, 100, 20, 'warrior'], [0, 100, 21, 'warrior']] })
    raze.toggleTownRaze(1); expect(raze.towns[1].raze).toBe(true)
    raze.towns[1].hp = 200
    stepN(raze, 25 * 15)
    expect(raze.towns[1].ruined).toBe(true); expect(raze.ownedTowns(1)).toBe(0)
  })
  it('production can be switched off per town', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [0, 60, 20]], units: [] })
    g.kingdoms[0].produce.warrior = true; g.kingdoms[0].power = 1000
    g.toggleTownProduce(0)
    for (let i = 0; i < 6; i++) { g.kingdoms[0].prodTimer = 0; g.tryProduce(g.kingdoms[0]) }
    const spawned = g.units.filter(u => u.faction === 0)
    expect(spawned.length).toBeGreaterThan(0)
    expect(spawned.every(u => Math.hypot(u.x - g.towns[1].x, u.y - g.towns[1].y) < Math.hypot(u.x - g.towns[0].x, u.y - g.towns[0].y))).toBe(true)
  })
})

describe('damage and building', () => {
  it('damage scales with max(0.2, health fraction)', async () => {
    const { healthFactor } = await import('../game/CombatSystem')
    expect(healthFactor({ hp: 80, maxHp: 100 })).toBeCloseTo(0.8)
    expect(healthFactor({ hp: 10, maxHp: 100 })).toBeCloseTo(0.2)
    expect(healthFactor({ hp: 100, maxHp: 100 })).toBe(1)
  })
  it('warriors hit 60% harder than before (24 -> 38.4)', () => { expect(UNIT.warrior.damage).toBeCloseTo(38.4) })
  it('an unfinished tower can be cancelled for a refund', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 100, 20]], units: [] })
    g.kingdoms[0].lumber = 100
    const t = g.placeTower(0, 24.5 * TILE, 20.5 * TILE)!
    expect(g.kingdoms[0].lumber).toBe(70)
    expect(g.cancelStructure(t)).toBe(true)
    expect(g.towers.length).toBe(0); expect(g.kingdoms[0].lumber).toBe(100)
  })
  it('a hurt unit near its own town reports healing (green plus)', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 100, 20]], units: [[0, 20, 21]] })
    const u = g.units[0]; u.hp = u.maxHp / 2
    expect(g.healingAtTown(u)).toBe(true)
    u.x += 20 * TILE
    expect(g.healingAtTown(u)).toBe(false)
  })
})
