import { describe, expect, it } from 'vitest'
import { GUNSHIP, TILE, ZUMWALT } from '../game/config'
import { damageBoat, spawnBoat } from '../game/BoatSystem'
import { RANK_MAX, RANK_TUNE, RANK_XP, awardXp, rankBonus, rankInfo, rankMult } from '../game/Ranks'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const sea = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))
const arena = () => makeGame({ rows: sea, towns: [[0, 20, 20], [1, 100, 20]], units: [], relation: 'war' })

describe('ship ranks', () => {
  it('the bonus grows exponentially from nothing to +50 % at brigadier general', () => {
    expect(rankBonus(0)).toBe(0)
    expect(rankBonus(RANK_MAX)).toBeCloseTo(0.5)
    const steps = Array.from({ length: RANK_MAX }, (_, i) => rankBonus(i + 1) - rankBonus(i))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]) // each promotion is worth more than the one before
    expect(steps[RANK_MAX - 1]).toBeGreaterThan(steps[0] * 8)
    expect(RANK_XP.length).toBe(RANK_MAX + 1)
  })

  it('XP promotes a ship, raising its hull while keeping the same share of it', () => {
    const g = arena()
    const z = spawnBoat(g, 0, 'zumwalt', px(55), px(20))
    z.hp = z.maxHp / 2
    awardXp(g, z, RANK_XP[3])
    expect(z.rank).toBe(3)
    expect(z.maxHp).toBeCloseTo(ZUMWALT.hp * (1 + rankBonus(3)))
    expect(z.hp / z.maxHp).toBeCloseTo(0.5)
    awardXp(g, z, 1e6)
    expect(z.rank).toBe(RANK_MAX)
    expect(z.maxHp).toBeCloseTo(ZUMWALT.hp * 1.5); expect(rankMult(z)).toBeCloseTo(1.5)
    expect(rankInfo(z).bonus).toBe(50)
  })

  it('only gunships and Zumwalts earn rank', () => {
    const g = arena()
    const c = spawnBoat(g, 0, 'cargo', px(55), px(20))
    awardXp(g, c, 5000)
    expect(c.rank ?? 0).toBe(0)
  })

  it('a hit on a ship pays the shooter at once; the victim is paid for damage taken only once the fight is over and it is still afloat', () => {
    const g = arena()
    const a = spawnBoat(g, 0, 'zumwalt', px(55), px(20)), v = spawnBoat(g, 1, 'gunship', px(60), px(20))
    damageBoat(g, v, 200, 0, true, a.id)
    expect(a.xp).toBeCloseTo(200 * RANK_TUNE.dealt)
    expect(v.xp ?? 0).toBe(0); expect(v.pendXp).toBeCloseTo(200 * RANK_TUNE.taken)
    g.boats = g.boats.filter(q => q !== a) // (nobody left to shoot back and earn XP of its own)
    stepN(g, 25 * 5)
    expect(v.xp ?? 0).toBe(0) // still inside the encounter
    stepN(g, 25 * 12)
    expect(v.xp).toBeCloseTo(200 * RANK_TUNE.taken); expect(v.pendXp).toBe(0)
  })

  it('a ship that is sunk earns nothing for the damage it took, and the killing blow pays the killer extra', () => {
    const g = arena()
    const a = spawnBoat(g, 0, 'zumwalt', px(55), px(20)), v = spawnBoat(g, 1, 'gunship', px(60), px(20))
    const hull = v.maxHp
    damageBoat(g, v, v.hp - 1, 0, true, a.id)
    const before = a.xp ?? 0
    damageBoat(g, v, 50, 0, true, a.id)
    expect(g.boats).not.toContain(v)
    expect(v.xp ?? 0).toBe(0)
    expect((a.xp ?? 0) - before).toBeGreaterThan(hull * RANK_TUNE.kill * 0.99) // 1 hp of damage plus the kill bonus
  })

  it('a Zumwalt fight earns a first promotion, but ranks come slowly', () => {
    const g = arena()
    const a = spawnBoat(g, 0, 'zumwalt', px(55), px(20)), v = spawnBoat(g, 1, 'zumwalt', px(60), px(20))
    for (let i = 0; i < 6; i++) damageBoat(g, v, 96, 0, true, a.id) // half of the other ship's hull
    expect(a.rank ?? 0).toBeGreaterThanOrEqual(1)
    expect(a.rank ?? 0).toBeLessThan(3)
  })

  it('a ranked ship hits harder and sails faster', () => {
    const g = arena()
    const hit = (rank: number) => {
      const g2 = arena()
      const a = spawnBoat(g2, 0, 'gunship', px(55), px(20)); spawnBoat(g2, 1, 'gunship', px(60), px(20))
      if (rank) awardXp(g2, a, RANK_XP[rank])
      let dmg = 0
      for (let i = 0; i < 200 && !dmg; i++) { stepN(g2, 1); dmg = g2.shells.find(s => s.src === a.id)?.dmg ?? 0 }
      return dmg
    }
    const base = hit(0), top = hit(RANK_MAX)
    expect(base).toBeCloseTo(GUNSHIP.damage)
    expect(top).toBeCloseTo(GUNSHIP.damage * 1.5)
    void g
    const run = (rank: number) => {
      const g3 = arena(); const b = spawnBoat(g3, 0, 'gunship', px(45), px(20)); if (rank) awardXp(g3, b, RANK_XP[rank])
      b.route = [px(65), px(20)]; b.routeIdx = 0; stepN(g3, 25 * 4); return b.x
    }
    expect(run(RANK_MAX) - px(45)).toBeGreaterThan((run(0) - px(45)) * 1.25)
  })
})
