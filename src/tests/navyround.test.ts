import { describe, expect, it } from 'vitest'
import { CARGO, TILE, UNIT, ZUMWALT } from '../game/config'
import { damageBoat, spawnBoat, undock } from '../game/BoatSystem'
import { makeGame, stepN, withYards } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const sea = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))

describe('navy round', () => {
  it('speeds: Zumwalt 5 % slower, cargo boat 10 % faster', () => {
    expect(ZUMWALT.speed).toBeCloseTo(UNIT.archer.speed * 0.95)
    expect(CARGO.speed).toBeCloseTo(UNIT.archer.speed * 1.1)
  })

  it("an ally's shipyard mends a foreign ship moored beside it, an enemy's does not", () => {
    const g = makeGame({ rows: sea, towns: [[0, 34, 25], [1, 100, 25], [2, 110, 25]], units: [] })
    withYards(g, 0)
    g.diplomacy.set(0, 1, 'allied', 0)
    const yard = g.yards.find(q => q.faction === 0)!
    const mk = (f: number) => { const b = spawnBoat(g, f, 'gunship', yard.x + 2 * TILE, yard.y); undock(g, b); return b }
    // moor one of each right at the yard's coast
    const ally = spawnBoat(g, 1, 'gunship', yard.x + TILE, yard.y), foe = spawnBoat(g, 2, 'gunship', yard.x + TILE, yard.y + 2 * TILE)
    void mk
    for (const b of [ally, foe]) { b.hp = b.maxHp * 0.3; b.docked = true }
    const a0 = ally.hp
    g.diplomacy.set(0, 2, 'war', 0)
    stepN(g, 25 * 5)
    expect(ally.hp).toBeGreaterThan(a0)
    expect(foe.hp).toBeLessThanOrEqual(foe.maxHp * 0.3 + 0.001)
  })

  it('a Zumwalt with no gunships does not sail out on a campaign', () => {
    const g = makeGame({ rows: sea, towns: [[0, 80, 20], [1, 34, 20]], units: [], ai: true, relation: 'war' })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    const z = spawnBoat(g, 1, 'zumwalt', px(41), px(14))
    const x0 = z.x
    g.time = 400
    stepN(g, 25 * 60)
    expect(Math.abs(z.x - x0)).toBeLessThan(8 * TILE)
    void damageBoat
  })

  it('gunships prefer a Zumwalt in range over other ships, and one team focuses on the same one; out of range they take another ship', () => {
    const g = makeGame({ rows: sea, towns: [[0, 80, 20], [1, 34, 20]], units: [] })
    const guns = [0, 1, 2].map(i => { const b = spawnBoat(g, 1, 'gunship', px(50), px(10 + i * 2)); undock(g, b); b.x = b.px = px(50); b.y = b.py = px(10 + i * 2); b.noDock = true; return b })
    const z1 = spawnBoat(g, 0, 'zumwalt', px(56), px(14)), z2 = spawnBoat(g, 0, 'zumwalt', px(56), px(11)), cargo = spawnBoat(g, 0, 'cargo', px(53), px(12))
    for (const b of [z1, z2, cargo]) { undock(g, b); b.noDock = true }
    z1.x = z1.px = px(56); z1.y = z1.py = px(14); z2.x = z2.px = px(56); z2.y = z2.py = px(11); cargo.x = cargo.px = px(53); cargo.y = cargo.py = px(12)
    stepN(g, 25 * 2)
    const ids = guns.map(b => b.target?.kind === 'boat' ? b.target.id : -1)
    expect(ids.every(i => i === z1.id || i === z2.id)).toBe(true)  // Zumwalts, not the nearer cargo boat
    expect(new Set(ids).size).toBe(1)                               // all on the same one
    // out of range: the cargo boat is what they can hit
    const g2 = makeGame({ rows: sea, towns: [[0, 80, 20], [1, 34, 20]], units: [] })
    const gb = spawnBoat(g2, 1, 'gunship', px(50), px(12)); undock(g2, gb); gb.noDock = true; gb.x = gb.px = px(50); gb.y = gb.py = px(12)
    const far = spawnBoat(g2, 0, 'zumwalt', px(68), px(12)), near = spawnBoat(g2, 0, 'cargo', px(55), px(12))
    for (const b of [far, near]) { undock(g2, b); b.noDock = true }
    far.x = far.px = px(68); far.y = far.py = px(12); near.x = near.px = px(55); near.y = near.py = px(12)
    stepN(g2, 25 * 2)
    expect(gb.target?.id).toBe(near.id)
  })
})

import { CARE } from '../game/config'
import { gunshipsWanted } from '../game/ColonyAI'

describe('Zumwalt groups', () => {
  it('an escorted pair crosses to the far side of the map past an island, instead of dithering on its coast', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    try {
      const W = 120, H = 70
      const rows2 = Array.from({ length: H }, (_, y) => '.'.repeat(W).split('').map((c, x) => ((x >= 3 && x < 28 && y >= 20 && y < 50) || (x >= 40 && x < 80 && y >= 14 && y < 56) || (x >= 95 && x < 117 && y >= 20 && y < 50)) ? '#' : c).join(''))
      const g = makeGame({ rows: rows2, towns: [[0, 5, 5], [1, 25, 35], [2, 105, 35]], units: [[1, 24, 35], [2, 104, 35]], pawns: true, ai: true, relation: 'war' })
      for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
      g.diplomacy.set(0, 1, 'neutral', 0); g.diplomacy.set(0, 2, 'neutral', 0)
      g.kingdoms[1].aggression = 1; g.kingdoms[1].lumber = 900; g.kingdoms[1].temperament = 'imperialist'
      withYards(g, 1)
      const zs = [0, 1].map(i => spawnBoat(g, 1, 'zumwalt', px(30), px(30 + i * 5)))
      for (let i = 0; i < 4; i++) spawnBoat(g, 1, 'gunship', px(30), px(22 + i * 4))
      g.time = 200
      stepN(g, 25 * 260)
      for (const z of zs) expect(z.x / TILE).toBeGreaterThan(85)
    } finally { CARE.overcapPct = keep }
  }, 120000)

  it('a nation facing an enemy Zumwalt wants at least three gunships, not one', () => {
    const g = makeGame({ rows: sea, towns: [[0, 80, 20], [1, 34, 20]], units: [], relation: 'war' })
    expect(gunshipsWanted(g, 1)).toBe(0)
    spawnBoat(g, 0, 'zumwalt', px(60), px(10))
    expect(gunshipsWanted(g, 1)).toBeGreaterThanOrEqual(3)
  })

  it('a nation whose naval budget is full (no gunships possible) still moves its Zumwalts out as a group instead of leaving them idle', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    try {
      const W = 120, H = 70
      const rows2 = Array.from({ length: H }, (_, y) => '.'.repeat(W).split('').map((c, x) => ((x >= 3 && x < 28 && y >= 20 && y < 50) || (x >= 95 && x < 117 && y >= 20 && y < 50)) ? '#' : c).join(''))
      const g = makeGame({ rows: rows2, towns: [[0, 5, 5], [1, 25, 35], [2, 105, 35]], units: [[1, 24, 35], [2, 104, 35]], pawns: true, ai: true, relation: 'war' })
      for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
      g.diplomacy.set(0, 1, 'neutral', 0); g.diplomacy.set(0, 2, 'neutral', 0)
      g.kingdoms[1].aggression = 1; g.kingdoms[1].lumber = 0; g.kingdoms[1].temperament = 'imperialist'
      withYards(g, 1)
      const zs = [0, 1].map(i => spawnBoat(g, 1, 'zumwalt', px(30), px(30 + i * 5)))
      g.time = 200
      for (let i = 0; i < 25 * 260; i++) { g.step(1 / 25); g.kingdoms[1].lumber = 0 }
      expect(zs.some(z => z.x / TILE > 60)).toBe(true)
    } finally { CARE.overcapPct = keep }
  }, 120000)

  it('unstickFleets forgets the AI fleets\' plans and cancels their orders (but never touches the player\'s ships)', () => {
    const g = makeGame({ rows: sea, towns: [[0, 80, 20], [1, 34, 20]], units: [], ai: true })
    const mine = spawnBoat(g, 0, 'gunship', px(60), px(10)), theirs = spawnBoat(g, 1, 'zumwalt', px(45), px(10))
    undock(g, mine); undock(g, theirs)
    mine.route = [px(65), px(10)]; theirs.route = [px(65), px(10)]; theirs.strike = { kind: 'ground', id: -1, x: 1, y: 1 }
    g.aiMemo.ship.set(theirs.id, { phase: 'station', since: 0, home: { x: 0, y: 0 }, town: -1, avoid: [] })
    expect(g.unstickFleets()).toBe(1)
    expect(theirs.route.length).toBe(0); expect(theirs.strike).toBeNull(); expect(g.aiMemo.ship.size).toBe(0)
    expect(mine.route.length).toBe(2)
  })
})
