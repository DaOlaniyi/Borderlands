import { describe, expect, it } from 'vitest'
import { AI, DOCK, MAX_KINGDOMS, RESCUE, TILE, ZUMWALT, kingdomsForSeed } from '../game/config'
import { EMBLEM_COUNT, assignEmblems } from '../game/Emblems'
import { Game } from '../game/Game'
import { MENU_ORDER, PALETTE, assignColors, isTeamPixel, tintPixel } from '../game/Palette'
import { orderSail, sideToward, spawnBoat, undock } from '../game/BoatSystem'
import { allocateKingdoms, generateArchipelago, generateWorld } from '../game/WorldGenerator'
import { worldInfo } from '../game/WorldInfo'
import { makeRng } from '../game/rng'
import { makeGame, stepN } from './helpers'

// two islands (land '#') separated by 40 tiles of open sea; west island x 0..29, east island x 70..99
const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(40) + '#'.repeat(30))
const px = (c: number) => (c + 0.5) * TILE
const sail = (g: Game, b: ReturnType<typeof spawnBoat>, x: number, y: number) => { undock(g, b); b.x = b.px = px(x); b.y = b.py = px(y); b.vx = b.vy = 0 }

describe('palette and emblems', () => {
  it('has 20 distinct colours; the five native Tiny Swords ones come first in the menu', () => {
    expect(PALETTE.length).toBe(20); expect(MAX_KINGDOMS).toBe(20)
    expect(new Set(PALETTE.map(c => c.name)).size).toBe(20); expect(new Set(PALETTE.map(c => c.hex)).size).toBe(20)
    expect(MENU_ORDER.slice(0, 5).every(i => PALETTE[i].recommended && PALETTE[i].native)).toBe(true)
    expect(MENU_ORDER.slice(5).every(i => !PALETTE[i].recommended)).toBe(true)
    expect(new Set(MENU_ORDER).size).toBe(20)
  })
  it('hands every kingdom its own colour (the player picks theirs) and its own emblem', () => {
    const cols = assignColors(15, 7)
    expect(cols[0]).toBe(7); expect(new Set(cols).size).toBe(15)
    const em = assignEmblems(20, makeRng(3).next)
    expect(new Set(em).size).toBe(20); expect(Math.max(...em)).toBe(EMBLEM_COUNT - 1)
  })
  it('recolours only the blue team pixels, and moves them to the new hue', () => {
    expect(isTeamPixel(60, 120, 200)).toBe(true)                  // blue cloth
    expect(isTeamPixel(200, 150, 90)).toBe(false)                 // wood
    expect(isTeamPixel(120, 120, 120)).toBe(false)                // steel
    const orange = tintPixel(60, 120, 200, PALETTE.find(c => c.name === 'Orange')!)
    expect(orange[0]).toBeGreaterThan(orange[2] + 40)             // red-ish now
    const green = tintPixel(60, 120, 200, PALETTE.find(c => c.name === 'Green')!)
    expect(green[1]).toBeGreaterThan(green[0]); expect(green[1]).toBeGreaterThan(green[2])
    const white = tintPixel(60, 120, 200, PALETTE.find(c => c.name === 'White')!)
    expect(Math.max(...white) - Math.min(...white)).toBeLessThan(40)
  })
})

describe('archipelago', () => {
  it('is a reproducible 200×200 world with 10–15 kingdoms derived from the seed', () => {
    const a = generateArchipelago('ISLES'), b = generateArchipelago('ISLES')
    expect(a.world.w).toBe(200); expect(a.world.h).toBe(200)
    expect(Array.from(a.world.land)).toEqual(Array.from(b.world.land)); expect(a.spawns).toEqual(b.spawns)
    const k = new Set(a.spawns.map(s => s.kingdom)).size
    expect(k).toBeGreaterThanOrEqual(10); expect(k).toBeLessThanOrEqual(15)
    for (let i = 0; i < 40; i++) expect(kingdomsForSeed(i * 7919)).toBeGreaterThanOrEqual(10)
  })
  it('has large land masses as big as the old 8-kingdom island, plenty of smaller islands and landlocked lakes only inland', () => {
    for (const seed of ['A1', 'B2', 'C3', 'D4', 'E5', 'F6']) {
      const { world, spawns } = generateArchipelago(seed)
      const info = worldInfo(world), sizes = [...info.sizes].sort((p, q) => q - p)
      expect(sizes[0]).toBeGreaterThan(3500)                         // a great land mass (the old largest island: ~114×114 × 38 %+)
      expect(info.sizes.length).toBeGreaterThanOrEqual(8)            // …and a scatter of medium / small islands and islets
      expect(sizes.filter(n => n < 400).length).toBeGreaterThanOrEqual(3)
      const land = world.land.reduce((n, v) => n + v, 0) / world.land.length
      expect(land).toBeGreaterThan(0.2); expect(land).toBeLessThan(0.45)
      for (const s of spawns) expect(world.land[s.cy * world.w + s.cx]).toBe(1)
      // every kingdom has a town; the ocean mask excludes lakes and land
      for (let k = 0; k < new Set(spawns.map(s => s.kingdom)).size; k++) expect(spawns.some(s => s.kingdom === k)).toBe(true)
      for (let i = 0; i < world.land.length; i++) if (world.land[i]) expect(info.sea[i]).toBe(0)
      expect(info.sea[0]).toBe(1)
    }
  })
  it('puts kingdoms on every sizeable island of the right size and keeps rival towns apart', () => {
    expect(allocateKingdoms([5000, 1200, 700, 300, 40], 12).reduce((n, v) => n + v, 0)).toBe(12)
    expect(allocateKingdoms([5000, 1200, 700, 300, 40], 12)[4]).toBe(0)            // a speck hosts nobody
    expect(allocateKingdoms([5000, 1200, 700, 300, 40], 12)[1]).toBeGreaterThanOrEqual(1)
    const { world, spawns } = generateArchipelago('SEP')
    for (const a of spawns) for (const b of spawns) if (a.kingdom < b.kingdom) expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThanOrEqual(8)
    const info = worldInfo(world)
    for (const k of new Set(spawns.map(s => s.kingdom))) expect(new Set(spawns.filter(s => s.kingdom === k).map(s => info.landmass[s.cy * world.w + s.cx])).size).toBe(1) // a kingdom starts on one island
  })
  it('lets the player pick a colour and builds a playable game (the legacy single island is still available)', () => {
    const g = Game.fromSeed('PLAY', 0, undefined, { archipelago: true, playerColor: 9 })
    expect(g.kingdoms[0].color).toBe(9); expect(new Set(g.kingdoms.map(k => k.color)).size).toBe(g.kingdoms.length)
    expect(new Set(g.kingdoms.map(k => k.emblem)).size).toBe(g.kingdoms.length)
    expect(g.kingdoms.length).toBeGreaterThanOrEqual(10)
    stepN(g, 25 * 10)
    expect(g.status).toBe('playing')
    expect(generateWorld('LEGACY', 3).world.w).toBeLessThan(200)
  })
})

describe('docking takes time and can be stopped', () => {
  const east = (extra: Parameters<typeof makeGame>[0]['units'] = [], rel: 'war' | 'neutral' = 'war') => makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: extra, relation: rel })
  it('a ship lies beside the shore for 5 seconds before it moors', () => {
    const g = east()
    const b = spawnBoat(g, 0, 'boat', px(31), px(20))
    orderSail(g, b, [px(50), px(20), px(69), px(20)])
    let arrived = -1
    for (let i = 0; i < 25 * 80 && !b.docked; i++) { g.step(1 / 25); if (arrived < 0 && b.docking && b.dockT > 0) arrived = g.time }
    expect(b.docked).toBe(true)
    expect(g.time - arrived).toBeGreaterThanOrEqual(DOCK.time - 0.3)
  })
  it('enemy troops standing near the shore keep it off; it moors once they are gone', () => {
    const g = east([[1, 71, 20]])
    const guard = g.units.find(u => u.faction === 1)!
    g.setBlock(guard, true)
    const b = spawnBoat(g, 0, 'boat', px(31), px(20))
    orderSail(g, b, [px(50), px(20), px(69), px(20)])
    stepN(g, 25 * 60)
    expect(b.docked).toBe(false); expect(b.dockBlocked).toBe(true)
    g.killUnit(guard, 0)
    stepN(g, 25 * 8)
    expect(b.docked).toBe(true)
  })
  it('fire interrupts the mooring: a ship under arrow fire never settles, and melee troops strike a hull at the shore', () => {
    const g = east([[1, 72, 20, 'archer']])
    const b = spawnBoat(g, 0, 'boat', px(67), px(20)); sail(g, b, 68, 20)
    b.route = [px(69), px(20)]; b.routeIdx = 0; b.docking = true
    stepN(g, 25 * 9)
    expect(b.hp).toBeLessThan(b.maxHp)
    expect(b.docked).toBe(false)
    const g2 = east([[1, 70, 20, 'warrior']])
    const b2 = spawnBoat(g2, 0, 'boat', px(69), px(20))
    stepN(g2, 25 * 6)
    expect(b2.hp).toBeLessThan(b2.maxHp)
  })
  it('a peaceful kingdom treats a foreign ship mooring on its shore as a border violation', () => {
    const g = east([], 'neutral')
    const b = spawnBoat(g, 0, 'boat', px(31), px(20))
    orderSail(g, b, [px(50), px(20), px(69), px(20)])
    stepN(g, 25 * 80)
    expect(g.diplomacy.hostile(0, 1)).toBe(true)
    const g2 = east([], 'neutral'); g2.diplomacy.set(0, 1, 'allied', 0)
    const b2 = spawnBoat(g2, 0, 'boat', px(31), px(20)); orderSail(g2, b2, [px(50), px(20), px(69), px(20)])
    stepN(g2, 25 * 80)
    expect(g2.diplomacy.get(0, 1)).toBe('allied'); expect(b2.docked).toBe(true) // allies are welcome
  })
})

describe('a kingdom with no towns may keep troops on its ships', () => {
  it('allows 2 troops per ship, up to 5', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [] })
    expect(g.cap(0)).toBe(3)                                         // with a town: the ordinary capacity
    g.destroyTown(g.towns[0], 1)
    expect(g.cap(0)).toBe(0)
    spawnBoat(g, 0, 'boat', px(31), px(20)); expect(g.cap(0)).toBe(RESCUE.perShip)
    spawnBoat(g, 0, 'zumwalt', px(31), px(26)); expect(g.cap(0)).toBe(4)
    spawnBoat(g, 0, 'boat', px(31), px(32)); expect(g.cap(0)).toBe(RESCUE.max)
    spawnBoat(g, 0, 'boat', px(31), px(10)); expect(g.cap(0)).toBe(RESCUE.max)
  })
})

describe('lumber stays with the town', () => {
  it('moves to the captor with the town (and with the pawns\' loads), and a razed town\'s stock goes to the razers', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [], pawns: true })
    const t = g.towns[0], l0 = g.kingdoms[0].lumber, l1 = g.kingdoms[1].lumber
    g.depositLumber(t, 80)
    expect(t.stock).toBe(80); expect(g.kingdoms[0].lumber).toBe(l0 + 80)
    g.spendLumber(0, (l0 + 80) / 2)                                  // spending draws the stock down in proportion
    expect(t.stock).toBeCloseTo(40, 5)
    const p = g.pawns.find(q => q.town === t.id)!; p.carry = 10
    g.captureTown(t, 1)
    expect(g.kingdoms[1].lumber).toBeCloseTo(l1 + 40 + 10, 5)        // the stock plus the load the pawn was carrying
    expect(t.stock).toBeCloseTo(50, 5)
    const t2 = g.towns[1]; g.depositLumber(t2, 30)
    const before = g.kingdoms[0].lumber
    g.destroyTown(t2, 0)
    expect(g.kingdoms[0].lumber).toBeGreaterThan(before)             // loot from the razed town
  })
})

describe('Zumwalt gunnery', () => {
  const sea = () => makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [], relation: 'war' })
  it('swings its cannon side toward the target and fires from the muzzles of the way it points', () => {
    expect(sideToward(5, 1)).toBe('E'); expect(sideToward(-5, 1)).toBe('W'); expect(sideToward(1, 5)).toBe('S'); expect(sideToward(1, -5)).toBe('N')
    const g = sea()
    const z = spawnBoat(g, 0, 'zumwalt', px(50), px(24)); sail(g, z, 50, 24)
    const e = spawnBoat(g, 1, 'boat', px(50), px(14)); sail(g, e, 50, 14)      // an enemy ship due north
    expect(z.side).toBe('E')
    stepN(g, 12)
    expect(g.shells.length).toBe(0)                                            // still turning: nothing fired yet
    stepN(g, 25 * 4)
    expect(z.side).toBe('N'); expect(z.flip).toBe(true)
    const s = g.shells[0] ?? null
    const fired = s ? s : null
    if (fired) {
      const off = Math.hypot(fired.x0 - z.x, fired.y0 - z.y)
      expect(off).toBeGreaterThan(10)                                          // it leaves the muzzle, not the hull centre
      expect(fired.y0).toBeLessThan(z.y)                                       // a north-facing broadside: the muzzles are on the north side
    }
    expect(e.hp).toBeLessThan(e.maxHp)
    // a target to the east: the bow-up hull carries its cannons on its east side
    const g2 = sea()
    const z2 = spawnBoat(g2, 0, 'zumwalt', px(50), px(24)); sail(g2, z2, 50, 24)
    z2.dir = 'down'; z2.side = 'W'
    const e2 = spawnBoat(g2, 1, 'boat', px(60), px(24)); sail(g2, e2, 60, 24)
    stepN(g2, 25 * 6)
    expect(z2.side).toBe('E'); expect(z2.dir).toBe('up')
    expect(ZUMWALT.muzzles.up[0][0]).toBeGreaterThan(0)
  })
  it('units shelled out of the blue pull back out of range, remember the ship, and rush back to stop it landing', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [[1, 72, 20, 'warrior']], relation: 'war' })
    const u = g.units[0], z = spawnBoat(g, 0, 'zumwalt', px(60), px(20)); sail(g, z, 60, 20); z.focus = 'troops'
    const x0 = u.x
    stepN(g, 25 * 20)
    expect(u.evadeBoat).toBe(z.id)
    expect(u.x).toBeGreaterThan(x0 + 2 * TILE)                                 // it retreated inland
    // an infantry boat now tries to land: the ambushed unit comes back to the beach to block it
    const g2 = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [[1, 85, 20, 'warrior']], relation: 'war' })
    const w = g2.units[0], b = spawnBoat(g2, 0, 'boat', px(40), px(20)); sail(g2, b, 40, 20)
    w.evadeBoat = b.id; w.evadeT = g2.time + 60
    orderSail(g2, b, [px(50), px(20), px(69), px(20)])
    const startX = w.x
    stepN(g2, 25 * 55)
    expect(w.x).toBeLessThan(startX - 3 * TILE)                                // it ran back toward the beach as the ship came in
  })
})

describe('AI expansion across the water', () => {
  it('a kingdom alone on its island eventually goes to war with a neighbour overseas', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [], pawns: true, ai: true, relation: 'neutral' })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false }
    g.kingdoms[1].aggression = 1
    g.time = AI.expandAfter + 100
    for (let i = 0; i < 25 * 600 && !g.diplomacy.hostile(0, 1); i++) g.step(1 / 25)
    expect(g.diplomacy.hostile(0, 1)).toBe(true)
  })
})
