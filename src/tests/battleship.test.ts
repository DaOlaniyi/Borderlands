import { describe, expect, it } from 'vitest'
import { BATTLESHIP, GUNSHIP, TILE, UNIT, ZUMWALT, fleetLimits } from '../game/config'
import { spawnBoat } from '../game/BoatSystem'
import { navalBudget } from '../game/Yards'
import { serializeGame } from '../game/SaveLoad'
import { makeGame, stepN, withYards } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const rows = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))
const SHELL = UNIT.warrior.damage * ZUMWALT.damageMult
/** Kingdom 0 with ten towns on the west island, all upgraded, a shipyard, plenty of lumber. */
const navy = (towns = 10) => {
  const spots: [number, number, number][] = [34, 28, 22].flatMap(x => [20, 24, 16, 28, 12].map(y => [0, x, y] as [number, number, number])) // (the first column is on the coast, where a shipyard reaches)
  const g = makeGame({ rows, towns: [...spots.slice(0, towns), [1, 80, 20]], units: [], relation: 'war' })
  for (const t of g.towns) if (t.owner === 0) t.level = 2
  withYards(g, 0); g.kingdoms[0].lumber = 6000
  return g
}

describe('battleship', () => {
  it('has the stats asked for: 3x the hull, 1.5x the range, 70 % of the speed, 1 500 lumber in three stages; a Zumwalt takes twice as long to build as it did', () => {
    expect(BATTLESHIP.hp).toBeCloseTo(ZUMWALT.hp * 3)
    expect(BATTLESHIP.rangeTiles).toBeCloseTo(ZUMWALT.rangeTiles * 1.5)
    expect(BATTLESHIP.speed).toBeCloseTo(ZUMWALT.speed * 0.7)
    expect(BATTLESHIP.damageMult).toBe(0.8); expect(BATTLESHIP.accuracy).toBe(2); expect(BATTLESHIP.minRangeTiles).toBe(6)
    expect(BATTLESHIP.cost).toBe(1500); expect(BATTLESHIP.stages).toBe(3)
    expect(ZUMWALT.buildTime).toBe(120)
  })

  it('fleet limits follow the town-count table (Zumwalts, battleships, gunboats = 2 per Zumwalt + extras)', () => {
    expect(fleetLimits(1)).toMatchObject({ zumwalts: 0, battleships: 0 })
    expect(fleetLimits(3)).toEqual({ zumwalts: 1, battleships: 0, gunboats: 2 })
    expect(fleetLimits(4).zumwalts).toBe(1)
    expect(fleetLimits(5)).toEqual({ zumwalts: 2, battleships: 0, gunboats: 6 })
    expect(fleetLimits(10)).toEqual({ zumwalts: 3, battleships: 1, gunboats: 9 })
    expect(fleetLimits(15)).toEqual({ zumwalts: 6, battleships: 1, gunboats: 16 })
    expect(fleetLimits(20)).toEqual({ zumwalts: 8, battleships: 2, gunboats: 21 })
    expect(fleetLimits(25)).toEqual({ zumwalts: 8, battleships: 2, gunboats: 22 })
    expect(fleetLimits(30)).toEqual({ zumwalts: 10, battleships: 3, gunboats: 28 })
  })

  it('a ten-town kingdom may keep 3 Zumwalts and 1 battleship, but each needs a level 2 town of its own', () => {
    const g = navy()
    let nb = navalBudget(g, 0)
    expect(nb.zumCap).toBe(3); expect(nb.bsCap).toBe(1); expect(nb.gunCap).toBe(9); expect(nb.canBattleship).toBe(true)
    expect(g.placeBoat(0, 'battleship', px(41), px(20))).toBeTruthy()
    nb = navalBudget(g, 0)
    expect(nb.bs).toBe(1); expect(nb.canBattleship).toBe(false)
    expect(g.structureError('battleship', 0, px(41), px(26))).toMatch(/Battleship limit/)
    for (const t of g.towns) if (t.owner === 0) t.level = 1                          // no upgraded town: no big ship at all
    expect(navalBudget(g, 0).canZumwalt).toBe(false)
    expect(g.structureError('zumwalt', 0, px(41), px(30))).toMatch(/level 2/)
    const small = navy(9)                                                           // nine towns: no battleship yet
    expect(navalBudget(small, 0).bsCap).toBe(0)
  })

  it('is built in three stages of 500 lumber: each is paid when reached, and the work waits for the lumber', () => {
    const g = navy(); g.kingdoms[0].lumber = 500
    const site = g.placeBoat(0, 'battleship', px(41), px(20))!
    expect(g.kingdoms[0].lumber).toBe(0); expect(site.paid).toBe(1)
    for (let t = 0; t < 130; t++) g.advanceBuild(site, 1)                            // stage one done, but stage two is not paid for
    expect(site.stalled).toBe(true); expect(site.progress).toBeCloseTo(BATTLESHIP.buildTime / 3)
    g.kingdoms[0].lumber = 500; stepN(g, 50)                                         // the lumber arrives: the next stage is paid
    expect(site.stalled).toBe(false); expect(site.paid).toBe(2); expect(g.kingdoms[0].lumber).toBe(0)
    g.kingdoms[0].lumber = 500
    for (let t = 0; t < 130; t++) g.advanceBuild(site, 1)                            // stage two done; stage three paid at once
    expect(site.paid).toBe(3); expect(g.kingdoms[0].lumber).toBe(0)
    for (let t = 0; t < 130; t++) g.advanceBuild(site, 1)
    const b = g.boats.find(q => q.kind === 'battleship')!
    expect(b).toBeTruthy(); expect(b.hp).toBeCloseTo(BATTLESHIP.hp); expect(g.towers.includes(site)).toBe(false)
    expect(g.stats.k[0].spentLumber.battleship).toBe(1500)
  })

  it('cannot shoot what is inside 6 tiles, and shoots from its deck turrets (80 % damage) beyond that', () => {
    const g = navy()
    const bs = spawnBoat(g, 0, 'battleship', px(50), px(24))
    const near = spawnBoat(g, 1, 'barge', px(50 + 4), px(24))                       // 4 tiles away: inside the blind zone
    stepN(g, 25 * 12)
    expect(g.shells.filter(s => s.src === bs.id).length).toBe(0)
    near.x = near.px = px(50 + 20); near.y = near.py = px(24) - 0.5 * TILE            // 20 tiles away
    near.hp = near.maxHp = 1e9
    const seen = new Set<object>(); const dmg: number[] = []; let direct = 0, total = 0
    for (let i = 0; i < 25 * 90; i++) { g.step(1 / 25); for (const s of g.shells) if (s.src === bs.id && !seen.has(s)) { seen.add(s); total++; if (s.direct) direct++; dmg.push(s.dmg) } }
    expect(total).toBeGreaterThanOrEqual(8)
    expect(direct / total).toBeGreaterThan(0.9)                                      // twice a Zumwalt's accuracy (which is under 60 % out here)
    const max = Math.max(...dmg)
    expect(max).toBeLessThanOrEqual(SHELL * BATTLESHIP.damageMult + 1e-6)
    expect(bs.tAng).toBeTruthy()
  }, 60000)

  it('is more accurate than a Zumwalt at the same range', () => {
    const rate = (kind: 'zumwalt' | 'battleship') => {
      const g = navy(); const s = spawnBoat(g, 0, kind, px(50), px(24)); const t = spawnBoat(g, 1, 'barge', px(50 + 20), px(24) - 0.5 * TILE); t.hp = t.maxHp = 1e9
      const seen = new Set<object>(); let d = 0, n = 0
      for (let i = 0; i < 25 * 120; i++) { g.step(1 / 25); for (const sh of g.shells) if (sh.src === s.id && !seen.has(sh)) { seen.add(sh); n++; if (sh.direct) d++ } }
      return { rate: d / Math.max(1, n), n }
    }
    const z = rate('zumwalt'), b = rate('battleship')
    expect(z.n).toBeGreaterThan(5); expect(b.n).toBeGreaterThan(5)
    expect(b.rate).toBeGreaterThan(z.rate + 0.2)
  }, 120000)
})

describe('bombardment fires (cosmetic)', () => {
  it('a stray shell does not light the grass, but a region that keeps being shelled burns, with more flames the heavier the fire', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [] })
    g.noteBombardment(px(10), px(10)); expect(g.flames.length).toBe(0)
    for (let i = 0; i < 4; i++) { g.time += 1; g.noteBombardment(px(10), px(10)) }
    const light = g.flames.length
    expect(light).toBeGreaterThan(0)
    for (let i = 0; i < 14; i++) { g.time += 0.5; g.noteBombardment(px(10) + i * 6, px(10)) }
    expect(g.flames.length).toBeGreaterThan(light)                                   // a heavier bombardment: more fire
    const big = Math.max(...g.flames.map(f => f.size)); expect(big).toBeGreaterThan(0.9)
    g.noteBombardment(px(30), px(40)); expect(g.flames.filter(f => f.x > px(25)).length).toBe(0) // far away: untouched
  })

  it('fires burn out, and they are not part of a saved game', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [] })
    for (let i = 0; i < 10; i++) { g.time += 0.4; g.noteBombardment(px(10), px(10)) }
    expect(g.flames.length).toBeGreaterThan(0)
    expect(serializeGame(g)).not.toContain('"flames"')
    stepN(g, 25 * 140)
    expect(g.flames.length).toBe(0); expect(g.burnHeat.size).toBe(0)
  })
})
void GUNSHIP
