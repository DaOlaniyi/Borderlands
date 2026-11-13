import { describe, expect, it } from 'vitest'
import { TILE, YARD } from '../game/config'
import { spawnBoat } from '../game/BoatSystem'
import { navalBudget, placeYard, yardError, yardShoreCells } from '../game/Yards'
import { upgradeTown } from '../game/Economy'
import { makeGame, stepN, withYards } from './helpers'

// west island x 0..29 (kingdom 0, town at 20,20), east island x 70..99 (kingdom 1); 40 tiles of sea between
const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(40) + '#'.repeat(30))
const px = (c: number) => (c + 0.5) * TILE
const mk = (extra: Partial<Parameters<typeof makeGame>[0]> = {}) => makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [], ...extra })

describe('shipyards', () => {
  it('are free, built on your own coast beside one of your towns, one per kingdom', () => {
    const g = mk(); g.kingdoms[0].lumber = 0
    expect(yardError(g, 0, px(10), px(20))).toMatch(/sea/)                    // inland
    expect(yardError(g, 0, px(40), px(20))).toMatch(/land/)                   // in the water
    expect(yardError(g, 0, px(75), px(20))).toMatch(/territory/)             // the enemy's coast
    expect(yardError(g, 0, px(29), px(20))).toBeNull()
    expect(placeYard(g, 0, px(29), px(20))).toBeTruthy()
    expect(g.kingdoms[0].lumber).toBe(0)                                      // free
    expect(yardError(g, 0, px(29), px(26))).toMatch(/already/)               // one per kingdom
  })
  it('ships may only be laid down along the 10-tile white line of a yard', () => {
    const g = mk(); g.kingdoms[0].lumber = 500
    expect(g.structureError('boat', 0, px(31), px(20))).toMatch(/shipyard/)   // no yard yet
    const y = placeYard(g, 0, px(29), px(20))!
    expect(g.structureError('boat', 0, px(31), px(20))).toBeNull()
    expect(g.structureError('boat', 0, px(31), px(20 + YARD.zoneTiles + 4))).toMatch(/shipyard|shoreline/) // off the end of the line
    expect(yardShoreCells(g, y).length).toBeGreaterThanOrEqual(YARD.zoneTiles)
  })
  it('a town supports one gunboat; an upgraded town two more, or one Zumwalt; Zumwalts also need a yard per five', () => {
    const g = withYards(mk(), 0); g.kingdoms[0].lumber = 5000; g.kingdoms[0].gold = 20
    let nb = navalBudget(g, 0)
    expect(nb.points).toBe(1); expect(nb.canGunship).toBe(true); expect(nb.canZumwalt).toBe(false)
    expect(g.structureError('zumwalt', 0, px(31), px(20))).toMatch(/level 2/)
    expect(upgradeTown(g, 0, g.towns[0].id)).toBe(true)
    nb = navalBudget(g, 0)
    expect(nb.points).toBe(1 + YARD.upgradePoints); expect(nb.zumCap).toBe(1); expect(nb.canZumwalt).toBe(true)
    const z = g.placeBoat(0, 'zumwalt', px(31), px(20))!
    expect(z).toBeTruthy()
    nb = navalBudget(g, 0)
    expect(nb.zum).toBe(1); expect(nb.canZumwalt).toBe(false); expect(nb.canGunship).toBe(true) // 2 of 3 points used: one gunboat left
    expect(g.placeBoat(0, 'gunship', px(31), px(24))).toBeTruthy()
    expect(navalBudget(g, 0).canGunship).toBe(false)
    expect(g.structureError('gunship', 0, px(31), px(16))).toMatch(/limit/)
    expect(YARD.zumwaltsPerYard).toBe(5)
    for (let i = 0; i < 6; i++) spawnBoat(g, 0, 'cargo', px(40 + i), px(30))       // cargo and infantry boats are outside the cap
    expect(navalBudget(g, 0).used).toBe(YARD.zumwaltPoints + YARD.gunshipPoints)
  })
  it('an AI places its one shipyard within the first 20 seconds; it is lost with its ground', () => {
    const g = mk({ ai: true })
    stepN(g, 25 * 20)
    expect(g.yards.filter(y => y.faction === 1).length).toBe(1)
    g.towns[1].owner = 0; g.markDirty(); g.recomputeTerritory(); stepN(g, 25 * 2)
    expect(g.yards.some(y => y.faction === 1)).toBe(false)
  })
})
