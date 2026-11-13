import { describe, expect, it } from 'vitest'
import { AI, CARE, TILE } from '../game/config'
import { orderSail, spawnBoat, undock } from '../game/BoatSystem'
import type { Game } from '../game/Game'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const land = Array.from({ length: 40 }, () => '#'.repeat(120))
const sea = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))
const park = (g: Game, b: ReturnType<typeof spawnBoat>, x: number, y: number) => { undock(g, b); b.x = b.px = px(x); b.y = b.py = px(y); b.vx = b.vy = 0; b.route = []; b.docking = false }

describe('troops pull back only when nearly dead, and stay until healed', () => {
  it('a wounded unit keeps fighting down to 10 %, then rests until 85 % (recruits 50 %)', () => {
    const g = makeGame({ rows: land, towns: [[0, 10, 20], [1, 90, 20]], units: [[1, 88, 20], [1, 88, 21]], relation: 'war', ai: true })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    g.time = 100
    const [a, b] = g.units
    a.hp = a.maxHp * 0.4                                                    // hurt, but not nearly dead: stays in the fight
    b.hp = b.maxHp * 0.06                                                   // nearly dead
    stepN(g, 25 * 3)
    expect(g.resting.has(a.id)).toBe(false)
    expect(g.resting.get(b.id)).toBe(AI.restUntil)
    b.hp = b.maxHp * 0.5; stepN(g, 25 * 3); expect(g.resting.has(b.id)).toBe(true)     // at 50 % it is still recovering (no flapping)
    b.hp = b.maxHp * 0.86; stepN(g, 25 * 3); expect(g.resting.has(b.id)).toBe(false)
  })
  it('a unit pushing at an enemy town with the upper hand never pulls back, even at 5 hp', () => {
    const units: [number, number, number][] = [[1, 22, 20], [1, 22, 21], [1, 23, 20], [1, 23, 21], [1, 21, 20], [1, 21, 21]]
    const g = makeGame({ rows: land, towns: [[0, 25, 20], [1, 90, 20]], units, relation: 'war', ai: true })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    g.time = 100
    const hero = g.units[0]; hero.hp = 5
    stepN(g, 25 * 2)
    expect(g.resting.has(hero.id)).toBe(false)
    // far from any enemy town the same unit does go home to heal
    hero.x = hero.px = px(80); hero.y = hero.py = px(40); hero.cell = g.cellAt(hero.x, hero.y); stepN(g, 25 * 2)
    expect(g.resting.has(hero.id)).toBe(true)
  })
})

describe('warships stay afloat and answer their attackers', () => {
  it('an AI Zumwalt idling beside a coast never moors', () => {
    const g = makeGame({ rows: sea, towns: [[0, 10, 5], [1, 20, 20], [2, 100, 20]], units: [], pawns: true, ai: true, relation: 'war' })
    const z = spawnBoat(g, 1, 'zumwalt', px(41), px(20)); park(g, z, 41, 25)           // right beside the east coast of the west island
    stepN(g, 25 * 30)
    expect(z.docked).toBe(false)
  })
  it('a gunship told to hit something far away still fires on a warship that closes in on it', () => {
    const g = makeGame({ rows: sea, towns: [[0, 10, 5], [1, 20, 20], [2, 100, 20]], units: [], relation: 'war' })
    const mine = spawnBoat(g, 1, 'gunship', px(41), px(10)); park(g, mine, 55, 20)
    const attacker = spawnBoat(g, 2, 'gunship', px(69), px(10)); park(g, attacker, 61, 20)
    mine.strike = { kind: 'ground', id: -1, x: px(100), y: px(40) } // (an out-of-range order)
    mine.strike = { kind: 'tower', id: 99999, x: px(110), y: px(40) }
    stepN(g, 25 * 15)
    expect(attacker.hp).toBeLessThan(attacker.maxHp)
  })
})

describe('two boats, one beach', () => {
  it('a second ship sent to an occupied mooring finds a free one nearby instead of waiting beside it', () => {
    const g = makeGame({ rows: sea, towns: [[0, 10, 5], [1, 20, 20], [2, 100, 20]], units: [] })
    const a = spawnBoat(g, 1, 'cargo', px(45), px(25)), b = spawnBoat(g, 1, 'boat', px(45), px(30))
    park(g, a, 45, 25); park(g, b, 45, 30)
    orderSail(g, a, [px(39), px(25)]); orderSail(g, b, [px(39), px(25)])
    stepN(g, 25 * 60)
    expect(a.docked && b.docked).toBe(true)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1.9 * TILE)
  })
})

describe('barges join the naval campaign', () => {
  it('they sail out with the warships, wait offshore, and go in once the enemy navy and towers are gone (or after 90 s: a barge can moor under fire)', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    try {
      const units: [number, number, number][] = []
      for (let i = 0; i < 12; i++) units.push([1, 30 + (i % 5), 15 + Math.floor(i / 5)])
      for (let i = 0; i < 3; i++) units.push([0, 77 + (i % 2), 20 + Math.floor(i / 2)])
      const g = makeGame({ rows: sea, towns: [[0, 79, 20], [0, 81, 26], [1, 34, 20], [1, 34, 25], [1, 30, 28]], units, pawns: true, ai: true, relation: 'war' })
      for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
      g.kingdoms[1].aggression = 1; g.kingdoms[1].lumber = 900; g.aiMemo.noSpot[1] = 4; g.aiMemo.tower[1] = 1e9; g.kingdoms[0].lumber = 400
      const tw = g.placeTower(0, px(76), px(24)); if (tw) { tw.built = true; tw.hp = tw.maxHp; const a = g.spawnUnit(0, tw.x, tw.y, 'archer'); tw.archer = a.id; a.inTower = tw.id }
      const foeShip = spawnBoat(g, 0, 'gunship', px(69), px(10)); park(g, foeShip, 66, 18)
      for (let i = 0; i < 2; i++) spawnBoat(g, 1, 'zumwalt', px(41), px(10 + i * 6))
      for (let i = 0; i < 4; i++) spawnBoat(g, 1, 'gunship', px(41), px(8 + i * 3))
      spawnBoat(g, 1, 'barge', px(41), px(14))                                             // a barge already at the quay, loaded before the navy has finished
      g.time = 300
      let staged = false, taken = -1
      for (let i = 0; i < 25 * 1200; i++) {
        g.step(1 / 25)
        if (g.kingdoms[1].lumber < 400) g.kingdoms[1].lumber = 900
        const inf = g.boats.filter(b => b.faction === 1 && b.kind === 'barge')
        if (inf.some(b => g.aiMemo.ship.get(b.id)?.phase === 'stage' && b.cargo.length > 0)) staged = true
        if (taken < 0 && g.towns.some(t => t.owner === 1 && (t.id === 0 || t.id === 1))) { taken = g.time; break }
      }
      expect({ staged, taken: taken > 0 }).toEqual({ staged: true, taken: true })
    } finally { CARE.overcapPct = keep }
  }, 300000)
})

describe('boats do not get wedged', () => {
  it('a ship whose straight line to its last waypoint is blocked by a coast corner is re-planned round it', () => {
    const rows = Array.from({ length: 50 }, (_, y) => '.'.repeat(120).split('').map((c, x) => (x >= 50 && x <= 56 && y >= 20 && y <= 26) || x < 30 ? '#' : c).join(''))
    const g = makeGame({ rows, towns: [[0, 10, 5], [1, 100, 40]], units: [] })
    const b = spawnBoat(g, 1, 'boat', px(60), px(18)); park(g, b, 48, 18)
    b.noDock = true
    b.route = [px(58), px(28)]; b.routeIdx = 0                                           // straight through the corner of the block
    stepN(g, 25 * 60)
    expect(Math.hypot(b.x - px(58), b.y - px(28))).toBeLessThan(2 * TILE)                  // it got there the long way round
  })
  it('a landing held off by troops on the beach moves to another stretch of coast', () => {
    const g = makeGame({ rows: sea, towns: [[0, 10, 5], [1, 20, 20], [2, 100, 20]], units: [], relation: 'neutral' })
    const b = spawnBoat(g, 1, 'boat', px(45), px(25)); park(g, b, 45, 25)
    g.spawnUnit(2, px(39), px(25))                                                         // a stranger's unit stands on the beach
    orderSail(g, b, [px(41), px(25)])
    stepN(g, 25 * 60)
    expect(b.docked).toBe(true)
    expect(Math.abs(b.y - px(25))).toBeGreaterThan(3 * TILE)                              // at a different, unguarded spot
  })
})
