import { describe, expect, it } from 'vitest'
import { autotileNumber } from '../game/Autotile'
import { islandAreaBonus, islandScale, MAP, maxStartTowns } from '../game/config'
import { bfsPath, countComponents } from '../game/Grid'
import { generateWorld, makeWorldFromMask, MIN_OWN_SEP, MIN_TOWN_SEP } from '../game/WorldGenerator'

const seeds = Array.from({ length: 24 }, (_, i) => `seed-${i}`)

describe('world generation', () => {
  const nearest2 = (spawns: { kingdom: number; cx: number; cy: number }[], k: number) => {
    const cap = spawns.filter(t => t.kingdom === k)[0]
    return [...new Set(spawns.map(t => t.kingdom))].filter(o => o !== k)
      .map(o => { const c = spawns.filter(t => t.kingdom === o)[0]; return { o, d: Math.hypot(c.cx - cap.cx, c.cy - cap.cy) } })
      .sort((p, q) => p.d - q.d).slice(0, 2).map(x => x.o)
  }
  it('lets strengths differ but keeps neighbouring kingdoms within one town of each other (two in 6–8 kingdom games)', () => {
    let varied = 0
    for (const [i, seed] of seeds.entries()) {
      const k = 2 + (i % 7), { spawns } = generateWorld(seed, k)
      const counts = Array.from({ length: k }, (_, q) => spawns.filter(t => t.kingdom === q).length)
      if (new Set(counts).size > 1) varied++
      for (let q = 0; q < k; q++) for (const o of nearest2(spawns, q)) expect(Math.abs(counts[q] - counts[o])).toBeLessThanOrEqual(k >= 6 ? 2 : 1)
    }
    expect(varied).toBeGreaterThan(0) // some matches open with stronger and weaker nations
  })
  it('gives 5–8 kingdom games 40 / 55 / 70 / 85 % more land than 1–4 kingdom games', () => {
    for (const k of [2, 3, 4]) expect(islandAreaBonus(k)).toBe(0)
    expect([5, 6, 7, 8].map(k => Math.round(islandAreaBonus(k) * 100))).toEqual([40, 55, 70, 85])
    for (const k of [5, 6, 7, 8]) expect(islandScale(k) ** 2).toBeCloseTo(1 + islandAreaBonus(k))
  })
  it('lets 6–8 kingdom games open with a few big (4–5 town), medium and small powers', () => {
    let sawBig = 0, sawSmall = 0, games = 0
    for (const seed of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']) for (const k of [6, 7, 8]) {
      const { spawns } = generateWorld(seed, k), counts = Array.from({ length: k }, (_, q) => spawns.filter(t => t.kingdom === q).length)
      games++
      if (counts.some(c => c >= 4)) sawBig++
      if (counts.some(c => c <= 2) && counts.some(c => c >= 3)) sawSmall++
      expect(Math.max(...counts)).toBeLessThanOrEqual(5)
    }
    expect(sawBig / games).toBeGreaterThan(0.5) // most large games feature at least one 4–5 town kingdom
    expect(sawSmall / games).toBeGreaterThan(0.7) // and a spread of sizes
    expect(maxStartTowns(4)).toBe(3); expect(maxStartTowns(8)).toBe(5)
  })
  it('supports up to 7 AI kingdoms (8 total), each with a town', () => {
    for (const seed of ['E1', 'E2', 'E3']) {
      for (const k of [6, 7, 8]) {
        const { spawns } = generateWorld(seed, k)
        for (let q = 0; q < k; q++) expect(spawns.some(t => t.kingdom === q)).toBe(true)
      }
    }
  })
  it('honours the player\'s chosen starting town count and balances rivals around it', () => {
    for (const want of [1, 2, 3, 4]) {
      let exact = 0
      for (const seed of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
        const { spawns } = generateWorld(seed, 3, want)
        const counts = Array.from({ length: 3 }, (_, q) => spawns.filter(t => t.kingdom === q).length)
        if (counts[0] === want) exact++
        for (const o of nearest2(spawns, 0)) expect(Math.abs(counts[0] - counts[o])).toBeLessThanOrEqual(1)
      }
      expect(exact).toBeGreaterThanOrEqual(4) // crowded islands may trim the odd extra town
    }
  })
  it('is reproducible for the same seed', () => {
    const a = generateWorld('BORDER', 4), b = generateWorld('BORDER', 4)
    expect(Array.from(a.world.land)).toEqual(Array.from(b.world.land))
    expect(a.spawns).toEqual(b.spawns)
    expect(a.world.trees.map(t => [t.kind, Math.round(t.x), Math.round(t.y)])).toEqual(b.world.trees.map(t => [t.kind, Math.round(t.x), Math.round(t.y)]))
    expect(Array.from(generateWorld('OTHER', 4).world.land)).not.toEqual(Array.from(a.world.land))
  })

  it('makes islands 56–84 tiles wide (larger for 5+ kingdoms) inside open ocean, with land as one edge-connected component', () => {
    for (const [i, s] of seeds.entries()) {
      const { world } = generateWorld(s, 2 + (i % 4))
      const sc = islandScale(2 + (i % 4))
      expect(world.island.w).toBeGreaterThanOrEqual(Math.round(MAP.minSize * sc)); expect(world.island.w).toBeLessThanOrEqual(Math.round(MAP.maxSize * sc))
      expect(world.island.h).toBeGreaterThanOrEqual(Math.round(MAP.minSize * sc)); expect(world.island.h).toBeLessThanOrEqual(Math.round(MAP.maxSize * sc))
      expect(world.w).toBe(world.island.w + MAP.pad * 2); expect(world.h).toBe(world.island.h + MAP.pad * 2)
      expect(countComponents(world.land, world.w, world.h)).toBe(1)
      // every edge of the world is ocean, at least `pad` tiles deep
      for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) if (x < MAP.pad || y < MAP.pad || x >= world.w - MAP.pad || y >= world.h - MAP.pad) expect(world.land[y * world.w + x]).toBe(0)
    }
  })

  it('has no diagonal-only land contacts', () => {
    for (const s of seeds.slice(0, 10)) {
      const { world: { land, w, h } } = generateWorld(s, 3)
      for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
        const a = land[y * w + x], b = land[y * w + x + 1], c = land[(y + 1) * w + x], d = land[(y + 1) * w + x + 1]
        expect(a && d && !b && !c).toBeFalsy(); expect(b && c && !a && !d).toBeFalsy()
      }
    }
  })

  it('places valid, separated, reachable towns for every kingdom', () => {
    for (const [i, s] of seeds.entries()) {
      const k = 2 + (i % 4)
      const { world, spawns } = generateWorld(s, k)
      for (let kingdom = 0; kingdom < k; kingdom++) {
        const own = spawns.filter(t => t.kingdom === kingdom)
        expect(own.length).toBeGreaterThanOrEqual(1)
        expect(own.length).toBeLessThanOrEqual(5)
      }
      const counts = Array.from({ length: k }, (_, q) => spawns.filter(t => t.kingdom === q).length)
      for (const c of counts) { expect(c).toBeGreaterThanOrEqual(1); expect(c).toBeLessThanOrEqual(maxStartTowns(k)) }
      for (const t of spawns) expect(world.land[t.cy * world.w + t.cx]).toBe(1)
      for (const a of spawns) for (const b of spawns) {
        if (a === b) continue
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy)
        expect(d).toBeGreaterThanOrEqual(a.kingdom === b.kingdom ? MIN_OWN_SEP : MIN_TOWN_SEP)
      }
      const from = spawns[0].cy * world.w + spawns[0].cx
      for (const t of spawns) expect(bfsPath(world.w, world.h, from, t.cy * world.w + t.cx, i => world.land[i] === 1, 60000)).not.toBeNull()
    }
  })

  it('selects Tiny Swords flat-ground tiles from cardinal neighbours', () => {
    const w = makeWorldFromMask(['.....', '.###.', '.###.', '.###.', '.....', '.#...', '.....'])
    expect(autotileNumber(w, 1, 1)).toBe(1); expect(autotileNumber(w, 2, 1)).toBe(2); expect(autotileNumber(w, 3, 1)).toBe(3)
    expect(autotileNumber(w, 1, 2)).toBe(4); expect(autotileNumber(w, 2, 2)).toBe(5); expect(autotileNumber(w, 3, 2)).toBe(6)
    expect(autotileNumber(w, 1, 3)).toBe(7); expect(autotileNumber(w, 2, 3)).toBe(8); expect(autotileNumber(w, 3, 3)).toBe(9)
    expect(autotileNumber(w, 1, 5)).toBe(16)
    const strip = makeWorldFromMask(['.....', '.###.', '.....', '..#..', '..#..', '..#..'])
    expect([1, 2, 3].map(x => autotileNumber(strip, x, 1))).toEqual([10, 11, 12])
    expect([3, 4, 5].map(y => autotileNumber(strip, 2, y))).toEqual([13, 14, 15])
  })
})
