import { describe, expect, it } from 'vitest'
import { AI, BOAT_FLAG, CARE, TILE } from '../game/config'
import { makeGame, withYards } from './helpers'

// one big island (x < 80) shared by kingdoms 1 and 2, sea, and a small island (x >= 96) of kingdom 3
const rows = Array.from({ length: 60 }, () => '#'.repeat(80) + '.'.repeat(16) + '#'.repeat(24))

describe('land war is not sidelined by the navy', () => {
  it('a nation at war with a neighbour on its own island marches on it even with an overseas enemy, and ships only a slice of its army', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    try {
      const units: [number, number, number][] = []
      for (let i = 0; i < 40; i++) units.push([1, 66 + (i % 8), 24 + Math.floor(i / 8)])
      for (let i = 0; i < 20; i++) units.push([2, 38 + (i % 5), 24 + Math.floor(i / 5)])
      const g = makeGame({ rows, towns: [[0, 110, 5], [1, 70, 28], [2, 40, 28], [3, 105, 28]], units, pawns: true, ai: true, relation: 'war' })
      for (const k of g.kingdoms) { k.produce = { warrior: false, archer: false, lancer: false, knight: false }; if (!k.isPlayer) k.temperament = 'neutral' }
      withYards(g, 1)
      g.kingdoms[1].aggression = 1; g.kingdoms[1].lumber = 900
      let boarded = 0, marched = false, barges = 0
      for (let i = 0; i < 25 * 150; i++) {
        g.step(1 / 25)
        if (g.towns.some(t => t.owner === 2 && !t.ruined)) boarded = Math.max(boarded, g.units.filter(u => u.faction === 1 && u.state !== 'dead' && (u.inTower >= BOAT_FLAG || u.boardBoat >= 0)).reduce((n, u) => n + u.count, 0))
        barges = Math.max(barges, g.boats.filter(b => b.faction === 1 && b.kind === 'barge').length)
        if (g.units.some(u => u.faction === 1 && u.state !== 'dead' && u.x / TILE < 52)) marched = true
      }
      expect(barges).toBeGreaterThan(0)                                       // (it did plan a naval invasion)
      expect(marched).toBe(true)                                              // the army went for the neighbour within 2.5 minutes
      expect(boarded).toBeLessThanOrEqual(Math.ceil(40 * AI.navyShareAtLandWar) + 2) // ...and no more than a slice of it was sent to the boats while the land war lasted
    } finally { CARE.overcapPct = keep }
  }, 120000)
})
