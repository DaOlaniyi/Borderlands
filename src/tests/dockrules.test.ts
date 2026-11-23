import { describe, expect, it } from 'vitest'
import { TILE } from '../game/config'
import { orderSail, spawnBoat } from '../game/BoatSystem'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const sea = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))
/** Kingdom 1's AI (archers and a warrior ashore) lives beside the dock where kingdom 0's ship moors. */
const harbour = (rel: 'neutral' | 'allied', kind: 'zumwalt' | 'gunship' | 'cargo' | 'boat') => {
  const g = makeGame({ rows: sea, towns: [[0, 5, 20], [1, 80, 20]], units: [[1, 72, 20, 'archer'], [1, 73, 22, 'archer'], [1, 74, 18, 'archer'], [1, 76, 20, 'warrior']], relation: rel, ai: true })
  const b = spawnBoat(g, 0, kind, px(66), px(20))
  orderSail(g, b, [px(69.5), px(20)])
  stepN(g, 25 * 90)
  return { g, b }
}

describe('mooring at somebody else\'s dock', () => {
  for (const kind of ['zumwalt', 'gunship'] as const) it(`an empty ${kind} may moor at a peaceful nation's dock without being attacked`, () => {
    const { g, b } = harbour('neutral', kind)
    expect(b.docked).toBe(true)
    expect(g.diplomacy.get(0, 1)).toBe('neutral')
    expect(b.hp).toBe(b.maxHp)
  })

  it('an ally\'s dock is safe too', () => {
    const { g, b } = harbour('allied', 'zumwalt')
    expect(g.diplomacy.get(0, 1)).toBe('allied'); expect(b.hp).toBe(b.maxHp)
  })

  it('a troop boat landing on a peaceful nation\'s shore is still a border violation', () => {
    const { g } = harbour('neutral', 'boat')
    expect(g.diplomacy.get(0, 1)).toBe('conflict')
  })

  it('a Zumwalt with troops aboard is a landing ship, so it still violates the border', () => {
    const g = makeGame({ rows: sea, towns: [[0, 5, 20], [1, 80, 20]], units: [[0, 8, 20, 'warrior'], [1, 72, 20, 'archer'], [1, 76, 20, 'warrior']], relation: 'neutral', ai: true })
    const z = spawnBoat(g, 0, 'zumwalt', px(66), px(20)); z.cargo = [g.units.find(u => u.faction === 0)!.id]
    orderSail(g, z, [px(69.5), px(20)])
    stepN(g, 25 * 30)
    expect(g.diplomacy.get(0, 1)).toBe('conflict')
  })

  it('an ally never attacks a friend\'s warship, even with troops aboard: allies may station units on allied ground', () => {
    const g = makeGame({ rows: sea, towns: [[0, 5, 20], [1, 80, 20]], units: [[0, 8, 20, 'warrior'], [1, 72, 20, 'archer'], [1, 73, 22, 'archer'], [1, 76, 20, 'warrior']], relation: 'allied', ai: true })
    const z = spawnBoat(g, 0, 'zumwalt', px(66), px(20)); z.cargo = [g.units.find(u => u.faction === 0)!.id]
    orderSail(g, z, [px(69.5), px(20)])
    stepN(g, 25 * 90)
    expect(z.docked).toBe(true)
    expect(g.diplomacy.get(0, 1)).toBe('allied'); expect(z.hp).toBe(z.maxHp)
  })
})
