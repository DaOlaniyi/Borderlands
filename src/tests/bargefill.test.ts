import { describe, expect, it } from 'vitest'
import { CARE, TILE } from '../game/config'
import { orderSail, spawnBoat, undock } from '../game/BoatSystem'
import { cargoCount } from '../game/BoatSystem'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const sea = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))

describe('barges', () => {
  it('the AI sends every barge out completely full', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    try {
      const units: [number, number, number][] = []
      for (let i = 0; i < 40; i++) units.push([1, 30 + (i % 8), 15 + Math.floor(i / 8)])
      for (let i = 0; i < 3; i++) units.push([0, 77 + (i % 2), 20 + Math.floor(i / 2)])
      const g = makeGame({ rows: sea, towns: [[0, 79, 20], [1, 34, 20]], units, pawns: true, ai: true, relation: 'war' })
      for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
      g.kingdoms[1].aggression = 1; g.kingdoms[1].lumber = 900; g.time = 300
      spawnBoat(g, 1, 'barge', px(41), px(14)); spawnBoat(g, 1, 'barge', px(41), px(24))
      const left: number[] = []
      const seen = new Set<number>()
      for (let i = 0; i < 25 * 120; i++) {
        g.step(1 / 25)
        for (const b of g.boats) if (b.kind === 'barge' && b.faction === 1 && g.aiMemo.ship.get(b.id)?.phase === 'sail' && !seen.has(b.id)) { seen.add(b.id); left.push(cargoCount(g, b)) }
      }
      expect(left.length).toBeGreaterThan(0)
      expect(left.every(n => n === 12)).toBe(true)
    } finally { CARE.overcapPct = keep }
  }, 120000)

  it('barges sent to one beach each find their own berth', () => {
    const g = makeGame({ rows: sea, towns: [[0, 10, 5], [1, 20, 20], [2, 100, 20]], units: [] })
    const bs = [0, 1, 2, 3].map(i => { const b = spawnBoat(g, 1, 'barge', px(55), px(10 + i * 4)); undock(g, b); b.x = b.px = px(55); b.y = b.py = px(10 + i * 4); b.route = []; b.docking = false; return b })
    for (const b of bs) orderSail(g, b, [px(39), px(25)])
    stepN(g, 25 * 90)
    expect(bs.every(b => b.docked)).toBe(true)
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y)).toBeGreaterThan(2.5 * TILE)
  })

  it('a docked barge claims a wider territory than an infantry boat', () => {
    const g = makeGame({ rows: sea, towns: [[0, 10, 5], [1, 20, 20]], units: [] })
    const a = spawnBoat(g, 1, 'barge', px(39), px(10)), b = spawnBoat(g, 1, 'boat', px(39), px(40))
    g.recomputeTerritory()
    const owned = (y: number) => { let n = 0; for (let x = 25; x < 40; x++) if (g.controller[y * g.world.w + x] === 2) n++; return n }
    expect(a.docked && b.docked).toBe(true)
    expect(owned(10)).toBeGreaterThan(owned(40))
  })
})

import { sinkBoat, damageBoat } from '../game/BoatSystem'
describe('player ship orders and sinking', () => {
  it('a route dragged from the water onto land docks the boat where it first meets the shore', () => {
    const g = makeGame({ rows: sea, towns: [[0, 10, 5], [1, 20, 20]], units: [] })
    const b = spawnBoat(g, 0, 'boat', px(55), px(25)); undock(g, b); b.x = b.px = px(55); b.y = b.py = px(25); b.route = []; b.docking = false
    expect(orderSail(g, b, [px(55), px(25), px(30), px(25)])).toBe(true) // ends deep inland (x=30 is land)
    expect(b.docking).toBe(true)
    stepN(g, 25 * 60)
    expect(b.docked).toBe(true)
    expect(b.x / TILE).toBeGreaterThan(39.5); expect(b.x / TILE).toBeLessThan(41)
  })
  it('a sunk Zumwalt leaves a short sinking wreck behind', () => {
    const g = makeGame({ rows: sea, towns: [[0, 10, 5], [1, 20, 20]], units: [] })
    const z = spawnBoat(g, 1, 'zumwalt', px(55), px(25)); undock(g, z)
    sinkBoat(g, z, 0)
    expect(g.boats.includes(z)).toBe(false)
    expect(g.wrecks.length).toBe(1)
    stepN(g, 25 * 4)
    expect(g.wrecks.length).toBe(0)
  })

  it('an AI barge stays moored after landing (holding the beachhead) and its troops march on the enemy town', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    try {
      const units: [number, number, number][] = []
      for (let i = 0; i < 12; i++) units.push([1, 30 + (i % 6), 15 + Math.floor(i / 6)])
      units.push([0, 85, 30])
      const g = makeGame({ rows: sea, towns: [[0, 80, 20], [1, 34, 20]], units, pawns: true, ai: true, relation: 'war' })
      for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
      g.kingdoms[1].aggression = 1; g.kingdoms[1].lumber = 900; g.time = 300
      const b = spawnBoat(g, 1, 'barge', px(41), px(14))
      let landed = -1, held = 0
      for (let i = 0; i < 25 * 300; i++) {
        g.step(1 / 25)
        if (g.aiMemo.ship.get(b.id)?.phase === 'hold') { held++; if (landed < 0) landed = g.time }
      }
      expect(landed).toBeGreaterThan(0)                        // it landed its troops
      expect(held).toBeGreaterThan(25 * 20)                    // and stayed moored for a good while
      const marched = g.units.filter(u => u.faction === 1 && u.state !== 'dead' && u.x / TILE > 74)
      expect(marched.length).toBeGreaterThan(0)                // the troops did not idle on the beach: they went inland
    } finally { CARE.overcapPct = keep }
  }, 120000)
})
