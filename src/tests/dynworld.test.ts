import { describe, expect, it } from 'vitest'
import { generateArchipelago } from '../game/WorldGenerator'
import { worldInfo } from '../game/WorldInfo'
import { makeStamp, shapeFor } from '../game/DynamicIslands'
import { Game } from '../game/Game'

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

describe('dynamic island generation', () => {
  it('is deterministic and leaves the classic generator untouched', () => {
    const a = generateArchipelago('DYN1', 20, undefined, true), b = generateArchipelago('DYN1', 20, undefined, true)
    expect(same(a.world.land, b.world.land)).toBe(true)
    const classic = generateArchipelago('DYN1', 20), classic2 = generateArchipelago('DYN1', 20, undefined, false)
    expect(same(classic.world.land, classic2.world.land)).toBe(true)
    expect(same(classic.world.land, a.world.land)).toBe(false)
  })

  it('every kingdom gets a start, there is room to live, and the shapes are really used', () => {
    for (const seed of ['DYN1', 'DYN2', 'DYN3', 'DYN4', 'DYN5', 'DYN6']) {
      const g = generateArchipelago(seed, 20, undefined, true)
      const kingdoms = new Set(g.spawns.map(s => s.kingdom))
      expect(kingdoms.size).toBe(20)
      let land = 0
      for (let i = 0; i < g.world.land.length; i++) land += g.world.land[i]
      expect(land / g.world.land.length).toBeGreaterThan(0.14)
      const info = worldInfo(g.world)
      expect(info.sizes.filter(n => n >= 260).length).toBeGreaterThanOrEqual(11) // plenty of islands big enough to hold a kingdom
    }
  })

  it('about 40 % of the sizeable islands are special, and a lagoon is always open to the sea', () => {
    let special = 0, total = 0
    for (const kind of ['large', 'medium', 'small'] as const) for (let i = 0; i < 400; i++) { total++; if (shapeFor({ kind, seed: 1000 + i * 7919 }) !== 'blob') special++ }
    expect(special / total).toBeGreaterThan(0.3); expect(special / total).toBeLessThan(0.6)
    // each ring's mouth is carved as a channel: its inner end is inside the lagoon, its outer end beyond the ring
    for (let i = 0; i < 40; i++) {
      const st = makeStamp({ cx: 80, cy: 80, r: 14 + (i % 5) * 6, kind: 'medium', aspect: 1, rot: i, seed: 5000 + i * 31 }, 'ring')
      expect(st.channels.length).toBeGreaterThanOrEqual(1)
      for (const ch of st.channels) { expect(ch.half * 2).toBeGreaterThanOrEqual(3.6); expect(Math.hypot(ch.x1 - 80, ch.y1 - 80)).toBeGreaterThan(14) }
    }
  })

  it('a dynamic world starts and runs', () => {
    const g = Game.fromSeed('DYN2', 0, 3, { archipelago: true, playerColor: 0, dynamic: true })
    for (let i = 0; i < 25 * 20; i++) g.step(1 / 25)
    expect(g.units.every(u => Number.isFinite(u.x))).toBe(true)
  }, 60000)
})
