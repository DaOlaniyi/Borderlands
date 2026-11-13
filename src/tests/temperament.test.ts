import { describe, expect, it } from 'vitest'
import { TEMPER, TEMPER_MIX } from '../game/config'
import { Game } from '../game/Game'
import { agitationTick, imperialTick } from '../game/AgitationSystem'
import { placeSettlement } from '../game/Economy'
import { makeGame } from './helpers'

describe('AI temperament', () => {
  it('every AI kingdom is pacifist, neutral or imperialist; every game has 4-6 imperialists; the player has none', () => {
    for (let s = 1; s <= 8; s++) {
      const g = Game.fromSeed(s, 0, 3, { archipelago: true })
      expect(g.kingdoms[0].isPlayer).toBe(true)
      const ai = g.kingdoms.filter(k => !k.isPlayer)
      expect(ai.every(k => k.temperament in TEMPER)).toBe(true)
      const imp = ai.filter(k => k.temperament === 'imperialist')
      expect(imp.length).toBeGreaterThanOrEqual(Math.min(4, Math.floor(ai.length / 2))); expect(imp.length).toBeLessThanOrEqual(Math.max(6, 1))
      expect(ai.every(k => k.temperament !== ('aggressive' as string))).toBe(true)
      expect(imp.every(k => k.harvest === 'unlimited')).toBe(true)
      for (const k of ai) { const [lo, hi] = TEMPER[k.temperament].aggression; expect(k.aggression).toBeGreaterThanOrEqual(lo); expect(k.aggression).toBeLessThanOrEqual(hi) }
    }
  }, 60000)

  it('a pacifist never starts a fight on its own', () => {
    let wars = 0
    for (let trial = 0; trial < 10; trial++) {
      const g = makeGame({ rows: Array(60).fill('#'.repeat(120)), towns: [[1, 30, 30], [1, 34, 30], [2, 40, 30], [3, 100, 50], [3, 104, 50], [4, 100, 10], [4, 104, 10]], units: [], ai: true, relation: 'neutral' })
      g.kingdoms[1].temperament = 'pacifist'; g.kingdoms[1].aggression = TEMPER.pacifist.aggression[0]
      g.time = 400; g.nextReact[1] = 0
      for (let i = 0; i < 1500; i++) { g.time += 1; agitationTick(g); if (g.diplomacy.hostile(1, 2)) break }
      if (g.diplomacy.hostile(1, 2)) wars++
    }
    expect(wars).toBe(0)
  })

  const imperial = (towns: [number, number, number][], pop: number) => {
    const g = makeGame({ rows: Array(60).fill('#'.repeat(120)), towns, units: [], ai: true, relation: 'neutral' })
    g.kingdoms[1].temperament = 'imperialist'
    g.time = 500
    for (let i = 0; i < pop; i++) g.spawnUnit(1, 30 * 64 + i * 40, 30 * 64)
    return g
  }
  it('an imperialist needs some troops (not lots or towers), then takes on a smaller neighbour', () => {
    const g = imperial([[1, 30, 30], [1, 34, 30], [1, 30, 34], [2, 40, 30]], 1)
    imperialTick(g, 1); expect(g.diplomacy.hostile(1, 2)).toBe(false) // not enough troops yet
    for (let i = 0; i < 6; i++) g.spawnUnit(1, 30 * 64 + i * 40, 31 * 64)
    imperialTick(g, 1); expect(g.diplomacy.hostile(1, 2)).toBe(true)
  })
  it('a 3-town imperialist does not strike a 5-town neighbour it borders', () => {
    const g = imperial([[1, 30, 30], [1, 34, 30], [1, 30, 34], [2, 40, 30], [2, 44, 30], [2, 40, 34], [2, 44, 34], [2, 48, 30]], 12)
    imperialTick(g, 1)
    expect(g.diplomacy.hostile(1, 2)).toBe(false)
  })
  it('but it goes after the settlements of a larger nation it does not border', () => {
    const rows = Array.from({ length: 60 }, (_, y) => Array.from({ length: 120 }, (_, x) => ((x >= 20 && x < 50) || (x >= 60 && x < 100 && ((y >= 5 && y < 25) || (y >= 35 && y < 55))) ? '#' : '.')).join(''))
    const g = makeGame({ rows, towns: [[1, 30, 30], [1, 34, 30], [1, 30, 34], [2, 70, 10], [2, 74, 10], [2, 70, 14], [2, 74, 14], [2, 78, 14]], units: [], ai: true, relation: 'neutral' })
    g.kingdoms[1].temperament = 'imperialist'; g.time = 500
    for (let i = 0; i < 12; i++) g.spawnUnit(1, 30 * 64 + i * 40, 31 * 64)
    // kingdom 2 holds a settlement on the far island
    const t = g.towns.find(q => q.owner === 2)!; void t
    const boat = { x: 0, y: 0 }; void boat
    g.towns.push({ id: g.towns.length, cx: 80, cy: 45, x: 80.5 * 64, y: 45.5 * 64, owner: 2, kind: 'settlement', level: 1, store: { lumber: 0, gold: 0, meat: 5 }, meatT: 0, upkeepT: 0, land: g.info.landmass[45 * 120 + 80], crate: null, abandoned: false, hitAt: -99, pawnIds: [], flash: 0, hp: 1500, maxHp: 1500, stock: 0, produce: true, raze: false, ruined: false })
    imperialTick(g, 1)
    expect(g.diplomacy.hostile(1, 2)).toBe(true)
    void placeSettlement
  })
})

describe('imperialists start early', () => {
  it('declare war on a smaller land neighbour after one minute, not before', () => {
    const g = makeGame({ rows: Array(60).fill('#'.repeat(120)), towns: [[1, 30, 30], [1, 34, 30], [2, 40, 30]], units: [], ai: true, relation: 'neutral' })
    g.kingdoms[1].temperament = 'imperialist'
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    for (let i = 0; i < 4; i++) g.spawnUnit(1, 30 * 64 + i * 40, 31 * 64) // 4 of 6 capacity
    g.time = 45; g.nextReact[1] = 0
    agitationTick(g); expect(g.diplomacy.hostile(1, 2)).toBe(false)
    g.time = 62; agitationTick(g); expect(g.diplomacy.hostile(1, 2)).toBe(true)
  })
})
