import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { damageUnit } from '../game/CombatSystem'
import { SIM_DT, TERRITORY, UNIT, UNIT_BODY } from '../game/config'
import { makeGame, openRows, stepN } from './helpers'

const W = UNIT.warrior
const duel = () => {
  const g = makeGame({ rows: openRows(40, 20), towns: [[0, 4, 4], [1, 36, 16]], units: [[0, 20, 10], [1, 20, 10]] })
  g.units[1].x = g.units[0].x + 44; g.units[1].y = g.units[0].y
  return g
}

describe('contact combat', () => {
  const attrition = TERRITORY.attritionPct
  beforeEach(() => { TERRITORY.attritionPct = 0 }) // isolate combat damage from supply attrition
  afterEach(() => { TERRITORY.attritionPct = attrition })

  it('hostile warriors engage automatically on contact', () => {
    const g = duel()
    stepN(g, 1)
    expect(['attacking', 'cooldown']).toContain(g.units[0].state)
    stepN(g, 40)
    expect(g.units[0].hp).toBeLessThan(W.hp)
    expect(g.units[1].hp).toBeLessThan(W.hp)
  })

  it('does not fight when out of range', () => {
    const g = duel()
    g.units[1].x = g.units[0].x + 300
    stepN(g, 60)
    expect(g.units[0].hp).toBe(W.hp)
  })

  it('applies damage on the active frame and cooldown, independent of render frame rate', () => {
    const run = (frame: number) => {
      const g = duel(); let guard = 0
      while (g.tickCount < 125 && guard++ < 10000) g.advance(frame)
      return [g.units[0].hp, g.units[1].hp, g.tickCount]
    }
    expect(run(1 / 60)).toEqual(run(1 / 144))
    const g = duel()
    const hits: number[] = []
    for (let i = 0; i < 110; i++) { const hp = g.units[1].hp; stepN(g, 1); if (g.units[1].hp < hp) hits.push(g.time) }
    expect(hits[0]).toBeGreaterThanOrEqual(W.attackDuration * W.activeAt - SIM_DT)
    expect(Math.abs(hits[1] - hits[0] - (W.attackDuration + W.cooldown))).toBeLessThan(0.1)
  })

  it('blocking reduces incoming damage by 90%', () => {
    const g = duel()
    const [a, b] = g.units
    damageUnit(g, a, 20)
    g.setBlock(b, true)
    damageUnit(g, b, 20)
    expect(W.hp - a.hp).toBeCloseTo(20); expect(W.hp - b.hp).toBeCloseTo(2)
  })

  it('blockers stop enemies but let friendly units pass; a blocker takes twice the space', () => {
    expect(UNIT_BODY.blockSeparation).toBe(UNIT_BODY.separation * 2)
    const corridor = Array.from({ length: 20 }, (_, y) => (y === 10 ? '#'.repeat(40) : '.'.repeat(40)))
    const mk = (faction: number) => {
      const g = makeGame({ rows: corridor, towns: [[0, 4, 10], [1, 36, 10]], units: [[0, 20, 10], [faction, 14, 10]] })
      const blocker = g.units[0], mover = g.units[1]
      g.setBlock(blocker, true)
      g.applyRoute(mover, [28 * 64, 10.5 * 64])
      mover.disengageT = 99 // isolate the movement rule from combat
      return { g, blocker, mover }
    }
    const e = mk(1)
    let minD = Infinity
    for (let i = 0; i < 500; i++) { stepN(e.g, 1); minD = Math.min(minD, Math.hypot(e.mover.x - e.blocker.x, e.mover.y - e.blocker.y)) }
    expect(minD).toBeGreaterThanOrEqual(UNIT_BODY.blockSeparation - 1)
    expect(e.mover.x).toBeLessThan(e.blocker.x) // the one-tile corridor cannot be bypassed
    const f = mk(0)
    stepN(f.g, 500)
    expect(f.mover.x).toBeGreaterThan(f.blocker.x + 100)
  })

  it('stays in block mode until toggled off or a new order is issued', () => {
    const g = duel()
    const u = g.units[0]
    g.setBlock(u, true); stepN(g, 50)
    expect(u.mode).toBe('block'); expect(u.state).toBe('guarding'); expect(u.route.length).toBe(0)
    g.toggleBlock(u); expect(u.mode).toBe('fight')
    g.setBlock(u, true)
    expect(g.orderRoute(u, [u.x - 100, u.y, u.x - 200, u.y])).toBe(true) // documented rule: a new order leaves block mode
    expect(u.mode).toBe('fight')
  })

  it('removes dead units from play', () => {
    const g = duel()
    g.killUnit(g.units[1]); stepN(g, 1)
    expect(g.units).toHaveLength(1)
  })
})
