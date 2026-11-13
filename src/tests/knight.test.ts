import { describe, expect, it } from 'vitest'
import { TILE, UNIT, UNIT_TYPES, type UnitType } from '../game/config'
import { unitPower } from '../game/AISystem'
import { makeGame } from './helpers'

const rows = Array.from({ length: 40 }, () => '#'.repeat(80))
/** A staged fight on open ground (towns nearby so nobody is cut off): [kingdom 0's survivors' health, kingdom 1's], in units of one full-health unit. */
function fight(a: [UnitType, number], b: [UnitType, number]): [number, number] {
  const units: [number, number, number, UnitType][] = []
  for (let i = 0; i < a[1]; i++) units.push([0, 35, 18 + i, a[0]])
  for (let i = 0; i < b[1]; i++) units.push([1, 45, 18 + i, b[0]])
  const g = makeGame({ rows, towns: [[0, 30, 18], [1, 50, 18]], units, relation: 'war' })
  for (const u of g.units) { u.hp = u.maxHp; g.orderMoveTo(u, (u.faction === 0 ? 45 : 36) * TILE, u.y) }
  for (let t = 0; t < 25 * 120; t++) { g.step(1 / 25); if (!g.units.some(u => u.faction === 0 && u.state !== 'dead') || !g.units.some(u => u.faction === 1 && u.state !== 'dead')) break }
  const left = (f: number) => g.units.filter(u => u.faction === f && u.state !== 'dead').reduce((n, u) => n + u.hp / u.maxHp, 0)
  return [left(0), left(1)]
}

describe('knight', () => {
  it('costs 40 power, runs 1.5x an archer\'s speed, and is a glass cannon', () => {
    expect(UNIT_TYPES).toContain('knight')
    expect(UNIT.knight.cost).toBe(40)
    expect(UNIT.knight.speed).toBeCloseTo(UNIT.archer.speed * 1.5, 6)
    expect(UNIT.knight.damage).toBeGreaterThan(UNIT.warrior.damage * 1.8)
    expect(UNIT.knight.hp).toBeLessThan(UNIT.warrior.hp * 0.55)
    expect(unitPower({ type: 'knight', count: 1, hp: 1, maxHp: 1 } as never)).toBeGreaterThan(0.5)
  })

  it('runs down archers and lancers cheaply, and trades roughly evenly with an equal-cost warrior (slightly worse one on one)', () => {
    const [kHp, lHp] = fight(['knight', 2], ['lancer', 2])
    expect(lHp).toBe(0); expect(kHp).toBeGreaterThan(1.4)                 // two knights beat two lancers (30 power each) with most of their health
    const [k1, w1] = fight(['knight', 1], ['warrior', 1])
    expect(w1).toBeGreaterThan(k1)                                         // an equal-cost warrior still takes the duel...
    expect(w1).toBeLessThan(0.4)                                           // ...but only just
    const [k3, w2] = fight(['knight', 3], ['warrior', 2])
    expect(w2).toBe(0); expect(k3).toBeGreaterThan(0.8)                    // 3 knights (120 power) beat 2 warriors (80)
  }, 120000)

  it('is produced like any other unit', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 40, 20]], units: [], ai: true })
    const k = g.kingdoms[1]; k.produce = { warrior: false, archer: false, lancer: false, knight: true }; k.power = 1000
    const u = g.tryProduce(k)
    expect(u?.type).toBe('knight'); expect(k.power).toBe(960)
    expect(g.stats.k[1].trained.knight).toBe(1)
  })
})
