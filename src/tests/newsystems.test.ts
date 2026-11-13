import { describe, expect, it } from 'vitest'
import { CARGO, GOLD, GUNSHIP, MEAT, SETTLE, SHELL_MAX, TILE, TOWN_LEVEL, UNIT, ZUMWALT, goldTier } from '../game/config'
import { damageBoat, orderSail, setStrike, sinkBoat, spawnBoat, undock, zumwaltDirectChance, zumwaltSpread } from '../game/BoatSystem'
import { placeSettlement, settlementError, stockAt, upgradeTown } from '../game/Economy'
import { generateArchipelago } from '../game/WorldGenerator'
import { worldInfo } from '../game/WorldInfo'
import { setTradeRoute, portFor, queueUnload } from '../game/Trade'
import type { Game } from '../game/Game'
import { makeGame, stepN, withYards } from './helpers'

// west island x 0..29 (kingdom 0), an empty island x 40..59, east island x 70..99 (kingdom 1); sea between
const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(20) + '.'.repeat(10) + '#'.repeat(30))
const px = (c: number) => (c + 0.5) * TILE
const mk = (extra: Partial<Parameters<typeof makeGame>[0]> = {}) => makeGame({ rows, towns: [[0, 20, 20], [1, 85, 20]], units: [], ...extra })
const park = (g: Game, b: ReturnType<typeof spawnBoat>, x: number, y: number) => { undock(g, b); b.x = b.px = px(x); b.y = b.py = px(y); b.vx = b.vy = 0 }

describe('Zumwalt rework', () => {
  it('lands 90 % of shells on target up close, 40 % at maximum range, and misses stray up to 8 tiles', () => {
    expect(zumwaltDirectChance(0)).toBeCloseTo(0.9); expect(zumwaltDirectChance(ZUMWALT.rangeTiles * TILE)).toBeCloseTo(0.4)
    expect(zumwaltSpread(0)).toBe(0); expect(zumwaltSpread(ZUMWALT.rangeTiles * TILE)).toBeCloseTo(8 * TILE)
  })
  it('hits buildings four times as hard', () => {
    const g = mk()
    g.kingdoms[1].lumber = 500
    const t = g.placeTower(1, px(82), px(14))!; t.built = true; t.hp = t.maxHp
    g.shells.push({ x0: 0, y0: 0, x1: t.x, y1: t.y, t: 1, dur: 0.1, dmg: 100, faction: 0, kind: 'tower', id: t.id, src: -1, direct: true, splash: true })
    stepN(g, 2)
    expect(t.maxHp - t.hp).toBeCloseTo(100 * ZUMWALT.buildingMult)
  })
  it('splash hurts and shoves back the troops around the impact, within 3 tiles only', () => {
    const g = mk()
    const a = g.spawnUnit(1, px(80), px(10)), b = g.spawnUnit(1, px(82), px(10)), far = g.spawnUnit(1, px(90), px(10))
    for (const u of [a, b, far]) u.hp = u.maxHp
    g.shells.push({ x0: 0, y0: 0, x1: px(80), y1: px(10) - 10, t: 1, dur: 0.1, dmg: 96, faction: 0, kind: 'unit', id: a.id, src: -1, direct: true, splash: true })
    stepN(g, 2)
    expect(a.hp).toBeLessThan(a.maxHp)
    expect(b.hp).toBeLessThan(b.maxHp)           // 2 tiles from the blast
    expect(far.hp).toBe(far.maxHp)               // 10 tiles away
    expect(a.kbT >= 0 || b.kbT >= 0 || Math.hypot(a.x - px(80), a.y - px(10)) > 2).toBe(true)
  })
  it('needs 4 s to lock onto a target and waits when a manual target is out of range', () => {
    const g = mk()
    const z = spawnBoat(g, 0, 'zumwalt', px(31), px(10)); undock(g, z)
    z.x = z.px = px(35); z.vx = z.vy = 0
    const e = spawnBoat(g, 1, 'boat', px(33), px(10)); park(g, e, 33, 10)
    stepN(g, 25 * 2); expect(g.shells.length).toBe(0)                     // still locking on
    stepN(g, 25 * 8); expect(e.hp).toBeLessThan(e.maxHp)                  // then it fires
    // manual strike on the ground far away (beyond 24 tiles): the X is out of range, so it holds its fire
    const g2 = mk()
    const z2 = spawnBoat(g2, 0, 'zumwalt', px(31), px(10)); park(g2, z2, 35, 10)
    setStrike(g2, z2, px(90), px(30))
    expect(z2.strike?.kind).toBe('ground')
    stepN(g2, 25 * 8); expect(g2.shells.length).toBe(0)
  })
  it('a manual X on an enemy ship in range makes the Zumwalt fire on it', () => {
    const g = mk()
    const z = spawnBoat(g, 0, 'zumwalt', px(31), px(10)); park(g, z, 35, 10)
    const e = spawnBoat(g, 1, 'boat', px(33), px(25)); park(g, e, 41, 12)
    setStrike(g, z, e.x + 20, e.y)
    expect(z.strike?.kind).toBe('boat')
    stepN(g, 25 * 12)
    expect(e.hp).toBeLessThan(e.maxHp)
  })
})

describe('ships: capacity, cargo boats and gunships', () => {
  it('infantry boats carry 10 and Zumwalts have 3x the HP', () => {
    const g = mk()
    expect(spawnBoat(g, 0, 'boat', px(31), px(10)).cap).toBe(10)
    expect(ZUMWALT.hp).toBe(SHELL_MAX * 12)
  })
  it('sinking a boat counts the troops aboard as war dead', () => {
    const g = mk({ relation: 'war' })
    const b = spawnBoat(g, 0, 'boat', px(31), px(10)); undock(g, b); b.x = px(35)
    const u = g.spawnUnit(0, px(20), px(10)); u.inTower = 1_000_000 + b.id; b.cargo.push(u.id)
    const before = g.diplomacy.casualties(0, 1)
    sinkBoat(g, b, 1)
    expect(g.diplomacy.casualties(0, 1)).toBe(before + 1)
  })
  it('a cargo boat costs 20 lumber, carries 100 lumber / 10 gold and sinks to two full Zumwalt volleys', () => {
    expect(CARGO.cost).toBe(20); expect(CARGO.cap.lumber).toBe(100); expect(CARGO.cap.gold).toBe(10)
    expect(CARGO.hp).toBe(GUNSHIP.damage * 7)
    expect(GUNSHIP.damage * 7).toBeCloseTo(CARGO.hp)                   // seven gunship hits
    expect(ZUMWALT.hp / GUNSHIP.damage).toBeCloseTo(32)                // a Zumwalt takes about 32 gunship hits...
    expect(ZUMWALT.hp / SHELL_MAX).toBeCloseTo(12)                     // ...and 12 direct hits from another Zumwalt
    expect(GUNSHIP.hp).toBeCloseTo(CARGO.hp * 1.5)
    expect(GUNSHIP.speed).toBeCloseTo(UNIT.archer.speed * 0.9) // (unchanged when the cargo boat got 10 % faster)
    expect(GUNSHIP.rangeTiles).toBe(11); expect(GUNSHIP.cost).toBe(60)
  })
  it('lost cargo floats and any cargo boat or gunship scoops it up', () => {
    const g = mk({ relation: 'war' })
    const c = spawnBoat(g, 0, 'cargo', px(31), px(10)); park(g, c, 45, 10)
    c.load = { lumber: 60, gold: 4, meat: 10 }
    sinkBoat(g, c, 1)
    expect(g.floaters.length).toBe(1)
    const pirate = spawnBoat(g, 1, 'gunship', px(69), px(10)); park(g, pirate, 45, 10)
    stepN(g, 3)
    expect(pirate.load.lumber).toBe(60); expect(pirate.load.gold).toBe(4)
    expect(g.floaters.length).toBe(0)
  })
  it('a gunship shoots ships only, never land targets, and seven hits sink a cargo boat', () => {
    const g = mk({ relation: 'war' })
    const gun = spawnBoat(g, 1, 'gunship', px(69), px(10)); park(g, gun, 45, 10)
    const c = spawnBoat(g, 0, 'cargo', px(31), px(10)); park(g, c, 50, 10)       // 5 tiles away
    g.spawnUnit(0, px(39), px(10))
    stepN(g, 25 * 15)
    expect(g.boats.includes(c)).toBe(false)                                       // sunk
    expect(g.units.filter(u => u.faction === 0).every(u => u.hp === u.maxHp)).toBe(true)
  })
  it('cargo boats and gunships can be built (20 / 60 lumber) like other ships', () => {
    const g = withYards(mk({ pawns: true }), 0)
    g.kingdoms[0].lumber = 200
    expect(g.placeBoat(0, 'cargo', px(31), px(20))).toBeTruthy(); expect(g.kingdoms[0].lumber).toBe(180)
    expect(g.placeBoat(0, 'gunship', px(31), px(24))).toBeTruthy(); expect(g.kingdoms[0].lumber).toBe(120)
  })
})

describe('settlements', () => {
  const setup = () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].lumber = 400
    const cargo = spawnBoat(g, 0, 'cargo', px(31), px(10)); park(g, cargo, 39, 20)
    orderSail(g, cargo, [px(39), px(20)])
    stepN(g, 25 * 8)                                                             // moors beside the empty island
    const trooper = g.spawnUnit(0, px(41), px(20))
    stepN(g, 3)
    return { g, cargo, trooper }
  }
  it('needs troops, a moored cargo boat, an empty landmass, friendly ground and 100 lumber', () => {
    const { g, cargo, trooper } = setup()
    expect(cargo.docked).toBe(true)
    expect(settlementError(g, 0, px(12), px(20))).toMatch(/territory|town/)        // home island
    expect(settlementError(g, 0, px(45), px(20))).toBeNull()
    g.kingdoms[0].lumber = 90; expect(settlementError(g, 0, px(45), px(20))).toMatch(/lumber/); g.kingdoms[0].lumber = 400
    trooper.state = 'dead'; g.units = g.units.filter(u => u !== trooper)
    expect(settlementError(g, 0, px(45), px(20))).toMatch(/troop|territory/)
  })
  it('plants a mini town with its own stockpile, 1 pawn, +2 capacity; home lumber pays, the cargo boat unloads into it', () => {
    const { g, cargo } = setup()
    cargo.load = { lumber: 30, gold: 0, meat: 8 }
    const cap0 = g.cap(0), pawns0 = g.pawns.length
    const s = placeSettlement(g, 0, px(45), px(20))!
    expect(s.kind).toBe('settlement')
    expect(g.kingdoms[0].lumber).toBe(300)
    expect(s.store!.lumber).toBe(30); expect(s.store!.meat).toBeCloseTo(Math.min(MEAT.store, MEAT.startStock + 8))
    expect(cargo.load.lumber).toBe(0)
    expect(g.cap(0)).toBe(cap0 + SETTLE.cap[0]); expect(g.pawns.length).toBe(pawns0 + 1)
    expect(g.ownedTowns(0)).toBe(1)                                              // settlements are not towns
    expect(stockAt(g, 0, px(45), px(20))).toBe(s.store)                          // that landmass has its own stockpile
    expect(stockAt(g, 0, px(12), px(20))).toBe(g.kingdoms[0])
    expect(g.controller[20 * g.world.w + 47]).toBe(1)                            // its territory
  })
  it('eats 5 meat per 10 minutes, and collapses after 2 minutes without meat or without troops', () => {
    const { g } = setup()
    const s = placeSettlement(g, 0, px(45), px(20))!
    s.store!.meat = 10
    for (let i = 0; i < 25 * 60; i++) g.step(1 / 25)
    expect(s.store!.meat).toBeCloseTo(10 - 5 * 60 / 600, 1)
    s.store!.meat = 0
    for (let i = 0; i < 25 * (SETTLE.decaySeconds - 10); i++) g.step(1 / 25)
    expect(s.ruined).toBe(false)
    for (let i = 0; i < 25 * 15; i++) g.step(1 / 25)
    expect(s.ruined).toBe(true)
  })
  it('a settlement without troops also collapses', () => {
    const { g, trooper } = setup()
    const s = placeSettlement(g, 0, px(45), px(20))!
    s.store!.meat = 10
    trooper.state = 'dead'; g.units = g.units.filter(u => u !== trooper)
    for (let i = 0; i < 25 * (SETTLE.decaySeconds + 10); i++) g.step(1 / 25)
    expect(s.ruined).toBe(true)
  })
  it('level 2 costs 200 lumber, level 3 costs 450 lumber + 5 gold (from its own store); level 2 unlocks towers, level 3 ships', () => {
    const { g } = setup()
    const s = placeSettlement(g, 0, px(45), px(20))!
    expect(g.structureError('tower', 0, px(49), px(20))).toMatch(/level 2/)
    s.store!.lumber = 150; expect(upgradeTown(g, 0, s.id)).toBe(false)           // 200 needed
    s.store!.lumber = 700
    expect(upgradeTown(g, 0, s.id)).toBe(true)
    expect(s.level).toBe(2); expect(s.maxHp).toBe(200); expect(s.store!.lumber).toBe(500); expect(s.pawnIds.length).toBe(SETTLE.pawns[1])
    expect(g.structureError('tower', 0, px(50), px(22))).toBeNull()
    expect(upgradeTown(g, 0, s.id)).toBe(false)                                   // level 3 also needs 5 gold
    s.store!.gold = 5
    expect(upgradeTown(g, 0, s.id)).toBe(true)
    expect(s.level).toBe(3); expect(s.maxHp).toBe(300); expect(s.store!.lumber).toBe(50); expect(s.store!.gold).toBe(0)
    expect(s.pawnIds.length).toBe(SETTLE.pawns[2]); expect(g.cap(0)).toBeGreaterThanOrEqual(SETTLE.cap[2])
    expect(SETTLE.radius[0]).toBeGreaterThan(4 * 1.4); expect(SETTLE.radius[1]).toBeGreaterThan(7 * 1.4) // 1.5x the old reach
  })
  it('ships can be built beside a settlement only at level 3, paid from its own store', () => {
    const { g } = setup()
    const s = placeSettlement(g, 0, px(45), px(20))!
    s.level = 2; s.store!.lumber = 100; g.recomputeTerritory()
    const site0 = [[39, 24], [39, 22], [39, 26], [39, 18], [39, 20]].find(([x, y]) => (g.structureError('boat', 0, px(x), px(y)) ?? '').includes('level 3'))
    expect(site0).toBeTruthy()                                                   // a level 2 settlement may not build ships yet
    s.level = 3; g.recomputeTerritory()
    // find a water cell beside the settlement's land
    const site = [[39, 24], [39, 22], [39, 26], [39, 18]].find(([x, y]) => g.structureError('boat', 0, px(x), px(y)) === null)
    expect(site).toBeTruthy()
    const lumberHome = g.kingdoms[0].lumber
    g.placeBoat(0, 'boat', px(site![0]), px(site![1]))
    expect(s.store!.lumber).toBe(50); expect(g.kingdoms[0].lumber).toBe(lumberHome)
  })
  it('enemy troops standing on an undefended settlement take it over, stores and all; a razed one leaves its crates and is no atrocity', () => {
    const { g } = setup()
    const s = placeSettlement(g, 0, px(45), px(20))!
    s.level = 2; s.store = { lumber: 120, gold: 3, meat: 6 }
    g.diplomacy.set(0, 1, 'war', 0)
    g.units = g.units.filter(u => u.faction !== 0)
    g.spawnUnit(1, s.x + 20, s.y + 20)
    stepN(g, 3)
    expect(s.ruined).toBe(false); expect(s.owner).toBe(1); expect(s.store!.lumber).toBe(120)
    // raze it instead: the contents stay behind as crates until someone founds a settlement beside them
    const g2 = setup().g
    const s2 = placeSettlement(g2, 0, px(45), px(20))!
    s2.level = 2; s2.store = { lumber: 120, gold: 3, meat: 6 }
    g2.destroyTown(s2, 1)
    expect(s2.ruined).toBe(true)
    expect(g2.crates.length).toBe(1); expect(g2.crates[0].load.lumber).toBe(120)
  })
  it('the player can abandon a settlement; the first unit of any kingdom to reach it claims it with its stock', () => {
    const { g } = setup()
    const s = placeSettlement(g, 0, px(45), px(20))!
    s.store = { lumber: 50, gold: 0, meat: 9 }
    expect(g.abandonSettlement(s.id)).toBe(true)
    expect(s.owner).toBe(-1); expect(s.abandoned).toBe(true); expect(g.pawns.some(p => p.town === s.id)).toBe(false)
    g.units = g.units.filter(u => u.faction !== 0)
    g.spawnUnit(1, s.x + 30, s.y + 10)
    stepN(g, 3)
    expect(s.owner).toBe(1); expect(s.abandoned).toBe(false); expect(s.store!.lumber).toBe(50)
  })
  it('ship fire does half damage to a settlement, and pawns repair it (5 pawns at most) while it is struck', () => {
    const { g } = setup()
    const s = placeSettlement(g, 0, px(45), px(20))!
    s.level = 3; while (s.pawnIds.length < 5) g.spawnPawn(s)
    s.hp = s.maxHp = 1500
    g.shells.push({ x0: 0, y0: 0, x1: s.x, y1: s.y, t: 1, dur: 0.1, dmg: 100, faction: 1, kind: 'town', id: s.id, src: -1, direct: true, splash: false })
    g.diplomacy.set(0, 1, 'war', 0)
    // (a non-splash shell is treated as a gunship round, so use a splash one)
    g.shells[0].splash = true
    stepN(g, 2)
    expect(s.maxHp - s.hp).toBeCloseTo(100 * ZUMWALT.buildingMult * SETTLE.shipResist, 0)
    expect(g.time - s.hitAt).toBeLessThan(SETTLE.repairWindow)
    stepN(g, 25 * 4)
    expect(g.pawns.filter(p => p.state === 'repair').length).toBeGreaterThan(0)
    expect(s.hp).toBeGreaterThan(s.maxHp - 100 * ZUMWALT.buildingMult * SETTLE.shipResist)
  })
  it('a new settlement beside crates left by a destroyed one takes their contents', () => {
    const { g } = setup()
    g.crates.push({ id: 999, x: px(46), y: px(21), load: { lumber: 80, gold: 2, meat: 4 } })
    const s = placeSettlement(g, 0, px(45), px(20))!
    expect(g.crates.length).toBe(0); expect(s.store!.lumber).toBe(80); expect(s.store!.gold).toBe(2)
  })
})

describe('meat, regions and trade', () => {
  it('each town keeps a sheep; a pawn hunts it when ripe and carries 5 meat home', () => {
    const g = mk({ pawns: true })
    expect(g.sheep.filter(s => s.town === 0).length).toBe(1)
    const sheep = g.sheep.find(s => s.town === 0)!
    g.towns[0].meatT = 0; sheep.ripe = true
    for (let i = 0; i < 25 * 70 && g.kingdoms[0].meat < MEAT.yield; i++) g.step(1 / 25)
    expect(g.kingdoms[0].meat).toBe(MEAT.yield)
    expect(g.sheep.some(s => s.id === sheep.id)).toBe(false)                     // the sheep died
    stepN(g, 25 * 20)
    expect(g.sheep.some(s => s.town === 0)).toBe(true)                          // a lamb has grown back
  })
  it('pawns load a moored cargo boat to the plus / minus amounts out of the region stock', () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].lumber = 80
    const b = spawnBoat(g, 0, 'cargo', px(31), px(16)); orderSail(g, b, [px(31), px(16)])
    stepN(g, 25 * 8)
    expect(b.docked).toBe(true)
    b.want.lumber = 40
    stepN(g, 25 * 90)
    expect(b.load.lumber).toBe(40); expect(g.kingdoms[0].lumber).toBe(40)
    b.want.lumber = 0                                                           // minus only lowers the target: nothing is unloaded by itself
    stepN(g, 25 * 30); expect(b.load.lumber).toBe(40)
    queueUnload(b, 'lumber', 20)                                                // the Unload button puts exactly that much ashore
    stepN(g, 25 * 90)
    expect(b.load.lumber).toBe(20); expect(g.kingdoms[0].lumber).toBe(60)
  })
  it('a trade route shuttles meat from home to a settlement', () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].lumber = 400; g.kingdoms[0].meat = 30
    const cargo = spawnBoat(g, 0, 'cargo', px(31), px(10)); park(g, cargo, 39, 20); orderSail(g, cargo, [px(39), px(20)])
    stepN(g, 25 * 8)
    g.spawnUnit(0, px(41), px(20)); stepN(g, 3)
    const s = placeSettlement(g, 0, px(45), px(20))!
    s.store!.meat = 2
    expect(portFor(g, g.towns[0])).toBeTruthy(); expect(portFor(g, s)).toBeTruthy()
    expect(setTradeRoute(g, cargo, 0, s.id, { lumber: 0, gold: 0, meat: 10 })).toBeNull()
    expect(cargo.trade?.path.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < 25 * 900 && s.store!.meat < 5 && !s.ruined; i++) g.step(1 / 25)
    expect(s.ruined).toBe(false)
    expect(s.store!.meat).toBeGreaterThan(5)
    expect(g.kingdoms[0].meat).toBeLessThan(30)
  }, 60000)
})

describe('gold and town levels', () => {
  it('every stone pays 1 gold per 30 s of mining, shrinks as it is mined, and a stone 6 (40-50 gold) takes 20-25 minutes', () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].harvest = 'unlimited'
    g.goldDeps.length = 0
    const d = g.goldDeps[g.goldDeps.push({ id: 0, stone: 3, x: px(18), y: px(23), cell: 23 * g.world.w + 18, amount: GOLD.reserve[3], progress: 0, claimedBy: -1, jackpot: false, taken: false, cycleT: GOLD.time }) - 1]
    for (let i = 0; i < 25 * 120 && g.kingdoms[0].gold < 1; i++) g.step(1 / 25)
    expect(g.kingdoms[0].gold).toBe(1)
    expect(d.amount).toBe(GOLD.reserve[3] - 1)                                    // the stone shrank by the one piece it paid
    expect(d.taken).toBe(false)
    expect(GOLD.time).toBe(30)
    expect(GOLD.largeRange[0] * GOLD.time).toBeGreaterThanOrEqual(1200); expect(GOLD.largeRange[1] * GOLD.time).toBeLessThanOrEqual(1500)
    expect(goldTier(45)).toBe(6); expect(goldTier(5)).toBe(3); expect(goldTier(1)).toBe(1)
    const big = mk(); expect(big.goldDeps.every(x => x.stone < 6 || (x.amount >= 40 && x.amount <= 50))).toBe(true)
  }, 60000)
  it('a small nugget (stone 1) is mined once, for exactly 1 gold', () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].harvest = 'unlimited'
    g.goldDeps.length = 0
    const d = g.goldDeps[g.goldDeps.push({ id: 0, stone: 1, x: px(18), y: px(23), cell: 23 * g.world.w + 18, amount: 1, progress: 0, claimedBy: -1, jackpot: false, taken: false, cycleT: 0 }) - 1]
    for (let i = 0; i < 25 * 200 && !d.taken; i++) g.step(1 / 25)
    expect(d.taken).toBe(true)
    for (let i = 0; i < 25 * 60 && g.kingdoms[0].gold < 1; i++) g.step(1 / 25)
    expect(g.kingdoms[0].gold).toBe(1)
  }, 60000)
  it('10 gold lifts a town to level 2: wider territory and 5 units of capacity', () => {
    const g = mk()
    const t = g.towns[0]
    const cap0 = g.cap(0)
    expect(upgradeTown(g, 0, t.id)).toBe(false)
    g.kingdoms[0].gold = 10
    const tiles0 = g.tileCounts[0]
    expect(upgradeTown(g, 0, t.id)).toBe(true)
    expect(t.level).toBe(2); expect(g.kingdoms[0].gold).toBe(0)
    expect(g.cap(0)).toBe(cap0 + TOWN_LEVEL.cap[1] - TOWN_LEVEL.cap[0])
    g.recomputeTerritory()
    expect(g.tileCounts[0]).toBeGreaterThan(tiles0)
  })
})

describe('gold on the map', () => {
  it('stones 3-5 and 6 sit only on uninhabited islands; jackpots turn up in about one world in three', () => {
    let jackpots = 0
    const n = 9
    for (let seed = 1; seed <= n; seed++) {
      const { world, spawns } = generateArchipelago(seed, 8, 3)
      const info = worldInfo(world), inhabited = new Set(spawns.map(s => info.landmass[s.cy * world.w + s.cx]))
      const gold = world.gold ?? []
      expect(gold.length).toBeGreaterThan(0)
      for (const gs of gold) {
        const L = info.landmass[Math.floor(gs.y / TILE) * world.w + Math.floor(gs.x / TILE)]
        if (gs.stone >= 3 && !gs.jackpot) expect(inhabited.has(L)).toBe(false)
        expect(L).toBeGreaterThanOrEqual(0)
      }
      if (gold.some(gs => gs.jackpot)) {
        jackpots++
        const jp = gold.filter(gs => gs.jackpot).map(gs => gs.stone).sort()
        expect(jp).toContain(6); expect(jp).toContain(5); expect(jp.filter(s => s === 4).length).toBeGreaterThanOrEqual(2)
      }
      expect(gold.filter(gs => gs.stone <= 2).length).toBeGreaterThan(gold.filter(gs => gs.stone >= 3).length) // nuggets dominate
    }
    expect(jackpots).toBeLessThanOrEqual(Math.ceil(n * 0.7))
  }, 120000)
})

describe('fog of war on uninhabited islands', () => {
  it('hides an island nobody started on until a unit explores it; a settlement (anyone\'s) reveals all of it for good', () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].lumber = 400
    const w = g.world.w, at = (x: number, y: number) => y * w + x
    expect(g.fogLands.size).toBe(1)                                   // the middle island; both home islands are inhabited
    expect(g.fog[at(50, 20)]).toBe(1); expect(g.fog[at(10, 20)]).toBe(0); expect(g.fog[at(85, 5)]).toBe(0)
    expect(g.isFogged(px(50), px(20))).toBe(true)
    // a unit lands: tiles around it (and friendly territory) are seen, the far side is not
    g.spawnUnit(0, px(41), px(20)); stepN(g, 10)
    expect(g.fog[at(43, 20)]).toBe(0); expect(g.fog[at(58, 20)]).toBe(1)
    // it walks on and explores: the fog lifts there
    const u = g.units.find(q => q.faction === 0)!; u.x = u.px = px(55); u.cell = g.cellAt(u.x, u.y); stepN(g, 10)
    expect(g.fog[at(57, 20)]).toBe(0)
    // the unit leaves again: the fog returns (exploration is temporary)
    u.x = u.px = px(2); u.cell = g.cellAt(u.x, u.y); g.markDirty(); stepN(g, 10)
    expect(g.fog[at(57, 20)]).toBe(1)
    // a settlement placed by anyone reveals the whole island permanently
    g.revealLand([...g.fogLands][0])
    expect(g.fog[at(58, 25)]).toBe(0)
    expect(g.fog[at(50, 20)]).toBe(0)
  })
  it('placing a settlement reveals its island', () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].lumber = 400
    const cargo = spawnBoat(g, 0, 'cargo', px(31), px(10)); park(g, cargo, 39, 20); orderSail(g, cargo, [px(39), px(20)])
    stepN(g, 25 * 8)
    g.spawnUnit(0, px(41), px(20)); stepN(g, 3)
    expect(g.fog[20 * g.world.w + 58]).toBe(1)
    placeSettlement(g, 0, px(45), px(20))
    stepN(g, 6)
    expect(g.fog[20 * g.world.w + 58]).toBe(0)
  })
})

describe('settlement pawns', () => {
  it('a level 1 settlement\'s pawn chops trees and fills the settlement\'s own store', () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].lumber = 400
    const cargo = spawnBoat(g, 0, 'cargo', px(31), px(10)); park(g, cargo, 39, 20)
    orderSail(g, cargo, [px(39), px(20)])
    stepN(g, 25 * 8)
    g.spawnUnit(0, px(41), px(20)); stepN(g, 3)
    const s = placeSettlement(g, 0, px(45), px(20))!
    s.store!.meat = 10
    for (let i = 0; i < 4; i++) g.world.trees.push({ id: g.world.trees.length, kind: 2, x: px(44 + i), y: px(23), cell: 23 * g.world.w + 44 + i, phase: 0, chopped: false, progress: 0, claimedBy: -1 } as any)
    g.recomputeTerritory()
    stepN(g, 25 * 120)
    expect(s.level).toBe(1); expect(s.store!.lumber).toBeGreaterThan(0)
  })
})

describe('ship incidents and return fire', () => {
  const open = Array.from({ length: 40 }, (_, y) => (y < 2 || y >= 38 ? '.'.repeat(120) : '#'.repeat(10) + '.'.repeat(100) + '#'.repeat(10)))
  const arena = () => { const g = makeGame({ rows: open, towns: [[0, 5, 20], [1, 114, 20]], units: [] }); g.diplomacy.set(0, 1, 'neutral', 0); return g }
  it('striking a peaceful nation\'s ship starts a conflict at once; sinking the third ship is war', () => {
    const g = arena()
    const v = spawnBoat(g, 1, 'boat', px(60), px(20)); park(g, v, 60, 20)
    expect(g.diplomacy.get(0, 1)).toBe('neutral')
    damageBoat(g, v, 1, 0)
    expect(g.diplomacy.get(0, 1)).toBe('conflict')
    sinkBoat(g, v, 0)
    for (let i = 0; i < 2; i++) { expect(g.diplomacy.get(0, 1)).not.toBe('war'); const w = spawnBoat(g, 1, 'boat', px(60), px(20)); park(g, w, 60, 22 + i); sinkBoat(g, w, 0) }
    expect(g.diplomacy.get(0, 1)).toBe('war')
  })
  it('a Zumwalt answers the gunship that is shooting at it, ahead of the target it was told to hit', () => {
    const g = arena(); g.diplomacy.set(0, 1, 'war', 0)
    const z = spawnBoat(g, 0, 'zumwalt', px(40), px(20)); park(g, z, 40, 20)
    const far = spawnBoat(g, 1, 'boat', px(60), px(20)); park(g, far, 60, 20)
    const gun = spawnBoat(g, 1, 'gunship', px(48), px(20)); park(g, gun, 48, 20)
    z.strike = { kind: 'boat', id: far.id, x: far.x, y: far.y }
    stepN(g, 25 * 6)
    expect(z.target?.kind === 'boat' ? z.target.id : -1).toBe(gun.id)
  })
})

describe('shore defence', () => {
  it('an AI nation\'s troops destroy a foreign cargo boat moored on its settlement\'s shore, but not an ally\'s', () => {
    for (const ally of [false, true]) {
      const g = mk({ ai: true })
      g.diplomacy.set(0, 1, ally ? 'allied' : 'neutral', 0)
      for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
      g.units = g.units.filter(u => u.faction !== 1)
      const v = { id: g.towns.length, cx: 74, cy: 20, x: px(74), y: px(20), owner: 1, kind: 'settlement' as const, level: 2 as const, store: { lumber: 0, gold: 0, meat: 15 }, meatT: 0, upkeepT: 0, land: g.info.landmass[20 * g.world.w + 85], crate: null, abandoned: false, hitAt: -99, pawnIds: [], flash: 0, hp: 200, maxHp: 200, stock: 0, produce: true, raze: false, ruined: false }
      g.towns.push(v); g.markDirty(); g.recomputeTerritory()
      for (let i = 0; i < 3; i++) { const u = g.spawnUnit(1, px(75), px(18 + i)); u.hp = u.maxHp }
      const c = spawnBoat(g, 0, 'cargo', px(65), px(20)); park(g, c, 65, 20)
      orderSail(g, c, [px(69), px(20)])
      stepN(g, 25 * 60)
      expect(g.boats.includes(c)).toBe(ally)
    }
  }, 60000)
})
