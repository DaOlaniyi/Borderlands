import { describe, expect, it } from 'vitest'
import { Game } from '../game/Game'
import { damageBoat, spawnBoat } from '../game/BoatSystem'
import { debugSnapshot } from '../game/DebugInfo'
import { REGROW, SIM_DT, TILE, YARD, ZUMWALT } from '../game/config'
import { placeSettlement } from '../game/Economy'
import { placeYard, yardError, yardQuota, pruneYards } from '../game/Yards'
import type { Tree } from '../game/types'
import { sum } from './util'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
// one big island (x 0..29) for kingdom 0, sea to the east; kingdom 1 far away on its own island
const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(40) + '#'.repeat(30))

describe('shipyards per landmass', () => {
  it('a landmass gets one yard for its first town and one more for every four towns on it', () => {
    const towns: [number, number, number][] = [[0, 22, 6], [0, 22, 12], [0, 22, 18], [0, 22, 24], [0, 16, 8], [0, 16, 14], [0, 16, 20], [0, 16, 26], [0, 9, 17], [1, 80, 20]]
    const g = makeGame({ rows, towns, units: [] })
    const land = g.towns[0].land
    expect(g.towns.filter(t => t.owner === 0).length).toBe(9)
    expect(yardQuota(g, 0, land)).toBe(YARD.holdingsPerYard ? Math.floor(9 / YARD.holdingsPerYard) : 0) // 9 towns: 2 yards
    expect(yardQuota(g, 0, land)).toBe(2)
    expect(placeYard(g, 0, px(29), px(10))).toBeTruthy()
    expect(yardError(g, 0, px(29), px(24))).toBeNull()                        // the second one is allowed
    expect(placeYard(g, 0, px(29), px(24))).toBeTruthy()
    expect(yardError(g, 0, px(29), px(17))).toMatch(/already/)               // a third is not
    // losing towns lowers the quota: the newest yard goes
    for (const t of g.towns.slice(0, 5)) { t.owner = 1 }
    g.markDirty(); g.recomputeTerritory(); pruneYards(g)
    expect(g.yards.filter(y => y.faction === 0).length).toBeLessThanOrEqual(1)
  })
  it('settlements do not count as villages', () => {
    const g = makeGame({ rows, towns: [[0, 22, 20], [1, 80, 20]], units: [] })
    g.kingdoms[0].lumber = 999
    const land = g.towns[0].land
    for (const [x, y] of [[8, 5], [8, 10], [8, 30], [8, 35]]) { const s = placeSettlement(g, 0, px(x), px(y)); void s }
    expect(yardQuota(g, 0, land)).toBe(1)
  })
})

describe('trees grow back', () => {
  it('a felled tree returns after 15-25 minutes, but waits while something stands on the spot', () => {
    const g = makeGame({ rows, towns: [[0, 22, 20], [1, 80, 20]], units: [] })
    const plant = (cx: number, cy: number) => { const t: Tree = { id: g.world.trees.length, kind: 2, x: px(cx), y: px(cy), cell: cy * g.world.w + cx, phase: 0, chopped: false, progress: 0, claimedBy: -1 }; g.world.trees.push(t); return t }
    const t = plant(14, 12)
    t.chopped = true; g.fellTree(t)
    expect(t.regrowAt! - g.time).toBeGreaterThanOrEqual(REGROW.min); expect(t.regrowAt! - g.time).toBeLessThanOrEqual(REGROW.min + REGROW.spread)
    expect(g.stumps).toContain(t.id)
    g.time = t.regrowAt! - 5; stepN(g, 50)
    expect(t.chopped).toBe(true)
    g.time = t.regrowAt! + 1; stepN(g, 50)
    expect(t.chopped).toBe(false); expect(t.regrowAt).toBeUndefined(); expect(g.stumps).not.toContain(t.id)
    // built over: it waits
    const u = plant(10, 8)
    u.chopped = true; g.fellTree(u)
    g.towers.push({ id: 9999, kind: 'tower', town: 0, faction: 0, cx: u.cell % g.world.w, cy: (u.cell / g.world.w) | 0, x: u.x, y: u.y, hp: 1, maxHp: 1, progress: 0, built: true, builder: -1, archer: -1 })
    g.time = u.regrowAt! + 1; stepN(g, 50)
    expect(u.chopped).toBe(true)
  })
})

describe('Zumwalts and towns', () => {
  it('a Zumwalt shell does three times the damage to a town (a village) that it used to', () => {
    const loss = (dmg: number) => {
      const g = makeGame({ rows, towns: [[0, 22, 20], [1, 80, 20]], units: [] })
      const t = g.towns[0]; t.hp = t.maxHp = 50000
      g.diplomacy.set(0, 1, 'war', 0)
      g.shells.push({ x0: 0, y0: 0, x1: t.x, y1: t.y, t: 1, dur: 0.1, dmg, faction: 1, kind: 'town', id: t.id, src: -1, direct: true, splash: true })
      stepN(g, 2)
      return 50000 - t.hp
    }
    expect(loss(20) - loss(10)).toBeCloseTo(10 * ZUMWALT.buildingMult * ZUMWALT.villageMult, 0) // (the difference cancels town regeneration)
  })
})

describe('match analytics', () => {
  it('records production, gathering, kills and ships consistently, and the review snapshot reads them', () => {
    const g = Game.fromSeed('REVIEW', 0, undefined, { archipelago: true, playerColor: 0 })
    for (let i = 0; i < Math.round(420 / SIM_DT); i++) g.step(SIM_DT)
    const st = g.stats
    expect(st.k.reduce((n, s) => n + sum(s.trained), 0)).toBeGreaterThan(0)
    expect(st.k.reduce((n, s) => n + s.gathered.lumber, 0)).toBeGreaterThan(0)
    expect(st.series.t.length).toBeGreaterThan(10)
    expect(st.k.reduce((n, s) => n + sum(s.killed), 0)).toBe(st.k.reduce((n, s) => n + s.lostToEnemy, 0)) // every kill is someone's loss
    const snap = debugSnapshot(g)
    expect(snap.kingdoms.length).toBe(g.kingdoms.length)
    for (const k of snap.kingdoms) { expect(k.total.lumber).toBeGreaterThanOrEqual(k.home.lumber); expect(['building', 'idle', 'blocked', 'n/a']).toContain(k.diagnosis.status) }
    expect(snap.kingdoms.some(k => k.trees.standing > 0)).toBe(true)
  }, 120000)
})

describe('ship repair', () => {
  it('a moored ship mends only beside one of its own shipyards', () => {
    const g = makeGame({ rows, towns: [[0, 22, 20], [1, 80, 20]], units: [] })
    placeYard(g, 0, px(29), px(20))
    const near = spawnBoat(g, 0, 'boat', px(30), px(21)), far = spawnBoat(g, 0, 'boat', px(30), px(33))
    stepN(g, 75)
    expect(near.docked).toBe(true); expect(far.docked).toBe(true)
    near.hp = far.hp = near.maxHp * 0.3
    const before = near.hp
    stepN(g, 25 * 20)
    expect(near.hp).toBeGreaterThan(before + 1)       // beside the yard: mended
    expect(far.hp).toBe(before)                       // moored in its own territory, but away from any yard: not
  })
})

describe('burning Zumwalts', () => {
  it('catch fire under 15 % hull, burn for 30 s, burn again when a ship\'s guns hit them, and are put out by repairs', () => {
    const g = makeGame({ rows, towns: [[0, 22, 20], [1, 80, 20]], units: [] })
    const z = spawnBoat(g, 0, 'zumwalt', px(40), px(20)), gun = spawnBoat(g, 0, 'gunship', px(45), px(20))
    z.noDock = true
    damageBoat(g, z, z.maxHp * 0.5, 1, true)
    expect(z.fireT).toBe(0)                                  // half health: no fire
    damageBoat(g, z, z.maxHp * 0.4, 1, true)
    expect(z.fireT).toBe(ZUMWALT.fireSeconds)                // down to 10 %: alight
    stepN(g, 25 * 31)
    expect(z.fireT).toBe(0)                                  // it burns out after 30 s
    damageBoat(g, z, 1, -1, false)
    expect(z.fireT).toBe(0)                                  // fire that is not naval does not relight it
    damageBoat(g, z, 1, 1, true)
    expect(z.fireT).toBe(ZUMWALT.fireSeconds)                // a naval hit does
    z.hp = z.maxHp * 0.5; stepN(g, 2)
    expect(z.fireT).toBe(0)                                  // repaired above 15 %: out
    damageBoat(g, gun, gun.maxHp * 0.9, 1, true)
    expect(gun.fireT).toBe(0)                                // only Zumwalts burn
  })
})
