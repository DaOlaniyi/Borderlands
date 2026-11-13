import { describe, expect, it } from 'vitest'
import { CARE, TILE } from '../game/config'
import { makeGame } from './helpers'

const land = Array.from({ length: 60 }, () => '#'.repeat(120))

describe('pacifists at war', () => {
  it('a pacifist at war marches on its enemy and fights, instead of sitting at home', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    try {
      const units: [number, number, number][] = []
      for (let i = 0; i < 30; i++) units.push([1, 30 + (i % 6), 25 + Math.floor(i / 6)])
      for (let i = 0; i < 30; i++) units.push([2, 80 + (i % 6), 25 + Math.floor(i / 6)])
      const g = makeGame({ rows: land, towns: [[0, 5, 5], [1, 25, 28], [2, 95, 28]], units, pawns: true, ai: true, relation: 'war' })
      for (const k of g.kingdoms) { k.produce = { warrior: false, archer: false, lancer: false, knight: false }; if (!k.isPlayer) k.temperament = 'pacifist' }
      g.diplomacy.set(0, 1, 'neutral', 0); g.diplomacy.set(0, 2, 'neutral', 0)
      const base = g.kingdoms[1].aggression
      let met = false
      for (let i = 0; i < 25 * 120; i++) {
        g.step(1 / 25)
        if (g.units.some(u => u.faction === 1 && u.state !== 'dead' && u.x / TILE > 55) && g.units.some(u => u.faction === 2 && u.state !== 'dead' && u.x / TILE < 65)) met = true
      }
      expect(met).toBe(true)                                         // both armies came out to the middle within two minutes
      expect(g.kingdoms[1].aggression).toBeGreaterThanOrEqual(0.9)   // a pacifist at war is as aggressive as an imperialist...
      g.diplomacy.set(1, 2, 'neutral', g.time)
      for (let i = 0; i < 25 * 5; i++) g.step(1 / 25)
      expect(g.kingdoms[1].aggression).toBeCloseTo(base)             // ...and goes back to its own nature in peace
    } finally { CARE.overcapPct = keep }
  }, 120000)
})
