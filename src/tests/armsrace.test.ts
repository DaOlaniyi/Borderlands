import { describe, expect, it } from 'vitest'
import { TILE } from '../game/config'
import { spawnBoat } from '../game/BoatSystem'
import { enemyFleet } from '../game/AISystem'
import { makeGame, stepN, withYards } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const sea = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))

/** Kingdom 1 (west, AI, level 2 town, a yard) faces kingdom 2 (east) with `foe` Zumwalts. */
function race(foe: number, mine = 0) {
  const g = makeGame({ rows: sea, towns: [[0, 5, 5], [1, 36, 20], [1, 36, 28], [1, 36, 12], [2, 80, 20]], units: [], pawns: true, ai: true, relation: 'war' })
  for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
  g.diplomacy.set(0, 1, 'neutral', 0); g.diplomacy.set(0, 2, 'neutral', 0)
  g.kingdoms[1].temperament = 'pacifist'; g.kingdoms[1].lumber = 1000
  for (const t of g.towns) if (t.owner === 1) t.level = 2
  withYards(g, 1)
  for (let i = 0; i < foe; i++) spawnBoat(g, 2, 'zumwalt', px(75), px(10 + i * 4))
  for (let i = 0; i < mine; i++) spawnBoat(g, 1, 'zumwalt', px(30), px(10 + i * 4))
  g.time = 200
  return g
}
const zums = (g: ReturnType<typeof race>, k: number) => g.boats.filter(b => b.faction === k && b.kind === 'zumwalt' && b.hp > 0).length + g.towers.filter(t => t.faction === k && t.kind === 'zumwalt').length

describe('zumwalt arms race', () => {
  it('measures the strongest enemy fleet at war, ignoring peace', () => {
    const g = race(3)
    expect(enemyFleet(g, 1)).toBe(3)
    g.diplomacy.set(1, 2, 'neutral', 0)
    expect(enemyFleet(g, 1)).toBe(0)
  })

  it('a nation with no Zumwalts lays one down against an enemy fleet, and puts the fleet before lots and towers', () => {
    const g = race(3)
    const built = () => g.towers.filter(t => t.faction === 1 && (t.kind === 'lot' || t.kind === 'tower')).length
    stepN(g, 25 * 2)
    const before = built()
    stepN(g, 25 * 20)
    expect(zums(g, 1)).toBeGreaterThanOrEqual(1)
    expect(g.aiMemo.fleetFirst.has(1)).toBe(true)
    expect(built()).toBe(before)
  }, 60000)

  it('never builds beyond one more than the enemy has', () => {
    const g = race(1, 1)
    g.kingdoms[1].lumber = 3000
    stepN(g, 25 * 120)
    expect(zums(g, 1)).toBeLessThanOrEqual(2)
  }, 60000)
})

describe('old saves', () => {
  it('a save without the arms-race memo loads and the AI keeps running', async () => {
    const { serializeGame, restoreGame } = await import('../game/SaveLoad')
    const { Game } = await import('../game/Game')
    const g = Game.fromSeed('oldsave', 6, undefined, { archipelago: true, playerColor: 0 })
    stepN(g, 25 * 3)
    const json = JSON.parse(serializeGame(g))
    delete json.fields.aiMemo.fleetFirst; delete json.fields.aiMemo.fleetPeak // what a save from before the arms race looks like
    const h = restoreGame({ seed: 'oldsave', color: 0, kingdoms: 6 }, JSON.stringify(json))
    expect(() => stepN(h, 25 * 5)).not.toThrow()
  }, 120000)
})

describe('long sea crossings', () => {
  it('a ship can be ordered around a wall that forces a 250-tile detour (the path search used to give up after 20 000 cells)', async () => {
    const { orderSail } = await import('../game/BoatSystem')
    const W = 260, H = 260
    const rows = Array.from({ length: H }, (_, y) => '.'.repeat(130) + (y < 250 ? '#' : '.') + '.'.repeat(W - 131))
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 255, 5]], units: [], relation: 'neutral' })
    const b = spawnBoat(g, 0, 'barge', px(10), px(10))
    expect(orderSail(g, b, [px(250), px(10)])).toBe(true)
  })
})
