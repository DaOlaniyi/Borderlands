import { describe, expect, it } from 'vitest'
import { TILE, ZUMWALT } from '../game/config'
import { mooringNear, spawnBoat } from '../game/BoatSystem'
import { atShipyard, yardLand } from '../game/Yards'
import { makeGame, stepN, withYards } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
// one wide island (x 10..109, y 10..39) in open sea
const rows = Array.from({ length: 50 }, (_, y) => '.'.repeat(120).split('').map((c, x) => (x >= 10 && x < 110 && y >= 10 && y < 40 ? '#' : c)).join(''))
const mk = (towns: [number, number, number][]) => {
  const g = makeGame({ rows, towns, units: [], ai: true, pawns: false, relation: 'neutral' })
  for (const k of g.kingdoms) { k.produce = { warrior: false, archer: false, lancer: false, knight: false }; k.aggression = 0 }
  return g
}

describe('AI shipyard management', () => {
  it('a nation with two yards on one island spreads them between its towns', () => {
    const g = mk([[1, 25, 12], [1, 45, 12], [1, 65, 12], [1, 85, 12], [1, 25, 37], [1, 45, 37], [1, 65, 37], [1, 85, 37], [0, 100, 25]])
    stepN(g, 25 * 20)
    const ys = g.yards.filter(q => q.faction === 1)
    expect(ys.length).toBe(2)
    expect(Math.hypot(ys[0].x - ys[1].x, ys[0].y - ys[1].y)).toBeGreaterThan(25 * TILE)
    void yardLand
  })

  it('a finished, mended warship leaves the white line for open water a few tiles out', () => {
    const g = mk([[1, 60, 12], [0, 100, 25]])
    withYards(g, 1)
    const yard = g.yards.find(q => q.faction === 1)!
    const gun = spawnBoat(g, 1, 'gunship', yard.x, yard.y - TILE)
    stepN(g, 25 * 2)
    expect(gun.docked).toBe(true)
    expect(atShipyard(g, gun)).toBe(true)
    stepN(g, 25 * 40)
    expect(gun.docked).toBe(false)
    expect(mooringNear(g, gun.x, gun.y, 3.2)).toBeNull()      // clear of the berths
    expect(Math.hypot(gun.x - yard.x, gun.y - yard.y)).toBeLessThan(18 * TILE)
  })

  it('a burning Zumwalt with no mission goes to a shipyard berth, is mended, then returns to station', () => {
    const g = mk([[1, 60, 12], [0, 100, 25]])
    withYards(g, 1)
    const yard = g.yards.find(q => q.faction === 1)!
    const z = spawnBoat(g, 1, 'zumwalt', yard.x, yard.y - TILE)
    stepN(g, 25 * 40)                                          // first it parks out in the water
    expect(z.docked).toBe(false)
    z.hp = z.maxHp * ZUMWALT.fireBelow * 0.8
    z.fireT = 5
    let docked = false
    for (let i = 0; i < 25 * 120 && !docked; i++) { g.step(1 / 25); docked = z.docked && atShipyard(g, z) }
    expect(docked).toBe(true)
    stepN(g, 25 * 120)
    expect(z.hp).toBeGreaterThan(z.maxHp * 0.9)
  }, 60000)

  it('an empty waiting barge moors on a stretch of coast beyond the yard so the berths stay free', () => {
    const g = mk([[1, 60, 12], [0, 100, 25]])
    withYards(g, 1)
    const yard = g.yards.find(q => q.faction === 1)!
    const barge = spawnBoat(g, 1, 'barge', yard.x, yard.y - TILE)
    stepN(g, 25 * 2)
    expect(barge.docked && atShipyard(g, barge)).toBe(true)
    stepN(g, 25 * 60)
    expect(barge.docked).toBe(true)                            // it still waits at a quay, for its troops...
    expect(atShipyard(g, barge)).toBe(false)                   // ...but not on the yard's building coast
  }, 60000)
})
