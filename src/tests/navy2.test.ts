import { describe, expect, it } from 'vitest'
import { CARE, GUNSHIP, TILE, UNIT, ZUMWALT, SETTLE, CARGO } from '../game/config'
import { damageBoat, setStrike, spawnBoat, undock, orderSail } from '../game/BoatSystem'
import { bestSettlementSite, placeSettlement, settlementError, isOuterTile, waterWithin } from '../game/Economy'
import { setTradeRoute } from '../game/Trade'
import type { Game } from '../game/Game'
import { placeShip } from '../game/AISystem'
import { makeGame, stepN } from './helpers'
import { bestYardSite, placeYard } from '../game/Yards'

const px = (c: number) => (c + 0.5) * TILE
const sea = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))
const park = (g: Game, b: ReturnType<typeof spawnBoat>, x: number, y: number) => { undock(g, b); b.x = b.px = px(x); b.y = b.py = px(y); b.vx = b.vy = 0; b.route = []; b.docking = false }

describe('ship durability', () => {
  it('a Zumwalt survives 11 direct hits from another Zumwalt and sinks on the 12th; it takes 32 gunship hits', () => {
    const g = makeGame({ rows: sea, towns: [[0, 20, 20], [1, 90, 20]], units: [], relation: 'war' })
    const z = spawnBoat(g, 0, 'zumwalt', px(45), px(20)); park(g, z, 55, 20)
    for (let i = 0; i < 11; i++) damageBoat(g, z, UNIT.warrior.damage * 2.5, 1)
    expect(g.boats.includes(z)).toBe(true)
    damageBoat(g, z, UNIT.warrior.damage * 2.5, 1)
    expect(g.boats.includes(z)).toBe(false)
    const z2 = spawnBoat(g, 0, 'zumwalt', px(45), px(30)); park(g, z2, 55, 30)
    for (let i = 0; i < 31; i++) damageBoat(g, z2, GUNSHIP.damage, 1)
    expect(g.boats.includes(z2)).toBe(true)
    damageBoat(g, z2, GUNSHIP.damage, 1)
    expect(g.boats.includes(z2)).toBe(false)
  })
})

describe('the target button', () => {
  it('a Zumwalt engages any chosen ship even when the nations are at peace, sailing into range, firing on the move', () => {
    const g = makeGame({ rows: sea, towns: [[0, 20, 20], [1, 90, 20]], units: [], relation: 'neutral' })
    const z = spawnBoat(g, 0, 'zumwalt', px(41), px(10)); park(g, z, 42, 25)
    const foe = spawnBoat(g, 1, 'zumwalt', px(69), px(10)); park(g, foe, 66, 25)     // a peaceful nation's Zumwalt, ~24 tiles away
    expect(g.hostile(0, 1)).toBe(false)
    setStrike(g, z, foe.x, foe.y)
    expect(z.strike?.kind).toBe('boat')
    let shotWhileMoving = false
    for (let i = 0; i < 25 * 60; i++) { g.step(1 / 25); if (g.shells.length && z.route.length && z.routeIdx < z.route.length / 2) shotWhileMoving = true }
    expect(foe.hp).toBeLessThan(foe.maxHp)                                              // it went and hit it
    expect(shotWhileMoving).toBe(true)
  }, 60000)
  it('a gunship can be told to hit a building or a troop too', () => {
    const g = makeGame({ rows: sea, towns: [[0, 20, 20], [1, 90, 20]], units: [], relation: 'neutral' })
    const gun = spawnBoat(g, 0, 'gunship', px(41), px(20)); park(g, gun, 66, 20)
    const u = g.spawnUnit(1, px(72), px(20))
    setStrike(g, gun, u.x, u.y)
    expect(gun.strike?.kind).toBe('unit')
    stepN(g, 25 * 20)
    expect(u.hp).toBeLessThan(u.maxHp)
  })
})

describe('boats keep their distance', () => {
  it('two ships dropped on the same spot are pushed apart', () => {
    const g = makeGame({ rows: sea, towns: [[0, 20, 20], [1, 90, 20]], units: [] })
    const a = spawnBoat(g, 0, 'boat', px(50), px(20)); const b = spawnBoat(g, 0, 'boat', px(50), px(20)); park(g, a, 50, 20); park(g, b, 50, 20)
    stepN(g, 25 * 3)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * TILE)
  })
})

describe('settlements anywhere on a landed island', () => {
  const setup = () => {
    const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(20))
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 95, 20]], units: [], pawns: true, relation: 'neutral' })
    g.kingdoms[0].lumber = 500; g.kingdoms[1].lumber = 500
    const cargo = spawnBoat(g, 0, 'cargo', px(31), px(10)); park(g, cargo, 39, 20); orderSail(g, cargo, [px(39), px(20)])
    stepN(g, 25 * 8)
    g.spawnUnit(0, px(41), px(20)); stepN(g, 3)
    return { g, cargo }
  }
  it('may be placed far from the landing, on neutral ground only, never on a gold stone', () => {
    const { g } = setup()
    expect(settlementError(g, 0, px(66), px(30))).toBeNull()                       // the far side of the island, 25 tiles from the troop
    g.goldDeps.length = 0
    g.goldDeps.push({ id: 0, stone: 5, x: px(55), y: px(25), cell: 25 * g.world.w + 55, amount: 24, progress: 0, claimedBy: -1, jackpot: false, taken: false, cycleT: 150 })
    expect(settlementError(g, 0, px(55), px(25))).toMatch(/gold/)
    expect(settlementError(g, 0, px(57), px(25))).toBeNull()
    g.controller[30 * g.world.w + 62] = 3                                           // somebody else's ground
    expect(settlementError(g, 0, px(62), px(30))).toMatch(/someone else/)
  })
  it('the AI picks inland ground near the richest gold, off the outer tiles and off the stones', () => {
    const { g } = setup()
    g.goldDeps.length = 0
    g.goldDeps.push({ id: 0, stone: 6, x: px(60), y: px(22), cell: 22 * g.world.w + 60, amount: 36, progress: 0, claimedBy: -1, jackpot: false, taken: false, cycleT: 150 })
    const land = g.info.landmass[20 * g.world.w + 50]
    const site = bestSettlementSite(g, 0, land, { x: px(41), y: px(20) })!
    expect(site).toBeTruthy()
    expect(isOuterTile(g, Math.floor(site.x / TILE), Math.floor(site.y / TILE))).toBe(false)
    expect(Math.hypot(site.x - px(60), site.y - px(22))).toBeGreaterThanOrEqual(1.5 * TILE)
    expect(Math.hypot(site.x - px(60), site.y - px(22)) / TILE).toBeLessThan(9)       // within reach of the stone
    expect(waterWithin(g, Math.floor(site.x / TILE), Math.floor(site.y / TILE), 5)).toBe(true)   // and its territory reaches the coast
    expect(placeSettlement(g, 0, site.x, site.y)).toBeTruthy()
  })
  it('two kingdoms can each plant a settlement on the same island (second pick for the latecomer)', () => {
    const { g } = setup()
    const first = placeSettlement(g, 0, px(48), px(20))!
    expect(first).toBeTruthy()
    // kingdom 1 lands too and plants on unowned ground at least 8 tiles from the first
    const c1 = spawnBoat(g, 1, 'cargo', px(75), px(10)); park(g, c1, 70, 30); orderSail(g, c1, [px(70), px(30)])
    stepN(g, 25 * 8)
    g.spawnUnit(1, px(66), px(30)); stepN(g, 3)
    expect(settlementError(g, 1, px(66), px(32))).toBeNull()
    expect(settlementError(g, 1, px(50), px(21))).toMatch(/close|someone/)
    expect(placeSettlement(g, 1, px(66), px(32))).toBeTruthy()
    expect(g.diplomacy.hostile(0, 1)).toBe(false)                                     // neutral neighbours do not fight over it
  })
})

describe('AI outposts are maintained', () => {
  it('a collapsed AI settlement is queued for re-establishment', () => {
    const { g } = (() => {
      const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(60))
      const g = makeGame({ rows, towns: [[0, 20, 20], [1, 85, 20]], units: [], pawns: true, ai: true, relation: 'neutral' })
      return { g }
    })()
    g.kingdoms[1].lumber = 600
    const s = { id: g.towns.length, cx: 50, cy: 20, x: px(50), y: px(20), owner: 1, kind: 'settlement' as const, level: 1 as const, store: { lumber: 0, gold: 0, meat: 0 }, meatT: 130, upkeepT: 0, land: g.info.landmass[20 * g.world.w + 50], crate: null, abandoned: false, hitAt: -99, pawnIds: [], flash: 0, hp: 1500, maxHp: 1500, stock: 0, produce: true, raze: false, ruined: false }
    g.towns.push(s)
    stepN(g, 25 * 2)
    expect(s.ruined).toBe(true)
    expect(g.lostColonies.some(l => l.owner === 1 && l.land === s.land)).toBe(true)
  })
  it('a cargo route with a return leg brings the settlement\'s gold home', () => {
    const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(20) + '.'.repeat(10) + '#'.repeat(30))
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 90, 20]], units: [], pawns: true })
    g.kingdoms[0].lumber = 400; g.kingdoms[0].meat = 20
    const cargo = spawnBoat(g, 0, 'cargo', px(31), px(10)); park(g, cargo, 39, 20); orderSail(g, cargo, [px(39), px(20)])
    stepN(g, 25 * 8); g.spawnUnit(0, px(41), px(20)); stepN(g, 3)
    const s = placeSettlement(g, 0, px(44), px(20))!
    s.store!.gold = 11; s.store!.meat = 4
    expect(setTradeRoute(g, cargo, 0, s.id, { lumber: 0, gold: 0, meat: 10 }, { lumber: 0, gold: CARGO.cap.gold, meat: 0 })).toBeNull()
    for (let i = 0; i < 25 * 900 && g.kingdoms[0].gold < 4; i++) g.step(1 / 25)
    expect(g.kingdoms[0].gold).toBeGreaterThanOrEqual(4) // (the settlement keeps the 5 gold its level 3 upgrade needs)
    expect(SETTLE.cost).toBe(100)
  }, 60000)
})

describe('naval campaign', () => {
  it('a nation with Zumwalts and gunships sinks the enemy ship, strips the tower, then lands and takes a town', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0
    try {
      const units: [number, number, number][] = []
      for (let i = 0; i < 14; i++) units.push([1, 30 + (i % 5), 15 + Math.floor(i / 5)])        // 14 attackers
      for (let i = 0; i < 4; i++) units.push([0, 77 + (i % 2), 20 + Math.floor(i / 2)])        // 4 defenders
      const g = makeGame({ rows: sea, towns: [[0, 79, 20], [0, 81, 26], [1, 34, 20], [1, 34, 25], [1, 30, 28]], units, pawns: true, ai: true, relation: 'war' })
      for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
      g.kingdoms[1].aggression = 1; g.kingdoms[1].lumber = 900; g.aiMemo.noSpot[1] = 4; g.aiMemo.tower[1] = 1e9
      g.kingdoms[0].lumber = 400
      // the defenders have a tower and a warship; the attackers have two Zumwalts and four gunships
      const tw = g.placeTower(0, px(76), px(24)); if (tw) { tw.built = true; tw.hp = tw.maxHp }
      const enemyShip = spawnBoat(g, 0, 'gunship', px(69), px(10)); park(g, enemyShip, 66, 18)
      for (let i = 0; i < 2; i++) { const z = spawnBoat(g, 1, 'zumwalt', px(41), px(10 + i * 6)); void z }
      for (let i = 0; i < 4; i++) { const b = spawnBoat(g, 1, 'gunship', px(41), px(8 + i * 3)); void b }
      g.time = 300
      let sunk = -1, towerGone = -1, taken = -1
      for (let i = 0; i < 25 * 1500; i++) {
        g.step(1 / 25)
        if (g.kingdoms[1].lumber < 400) g.kingdoms[1].lumber = 900
        if (sunk < 0 && !g.boats.includes(enemyShip)) sunk = g.time
        if (towerGone < 0 && tw && !g.towers.includes(tw)) towerGone = g.time
        if (taken < 0 && g.towns.some(t => t.owner === 1 && (t.id === 0 || t.id === 1))) { taken = g.time; break }
      }
      expect({ sunk: sunk > 0, towerGone: towerGone > 0 || !tw, taken: taken > 0, secs: { sunk: Math.round(sunk), tower: Math.round(towerGone), taken: Math.round(taken) } }).toMatchObject({ sunk: true, towerGone: true, taken: true })
      if (tw && towerGone > 0) expect(sunk).toBeLessThanOrEqual(towerGone + 5) // the sea was won before (or while) the walls came down
    } finally { CARE.overcapPct = keep }
  }, 300000)
})

describe('answering an attack from the sea', () => {
  it('a nation whose coast is shelled builds warships of its own and sends them against the attackers', () => {
    // kingdom 0 is the (passive) player; kingdom 1 is the AI under attack; kingdom 2 sends a Zumwalt
    const rows2 = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '.'.repeat(30) + '#'.repeat(50) + '.'.repeat(40)))
    const g = makeGame({ rows: rows2, towns: [[0, 10, 5], [1, 35, 20], [1, 74, 20], [2, 100, 20]], units: [], pawns: true, ai: true, relation: 'war' })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    g.kingdoms[1].lumber = 900; g.time = 100
    const raider = spawnBoat(g, 2, 'zumwalt', px(100), px(10)); park(g, raider, 22, 20)           // an enemy Zumwalt off their west coast
    let built = false, engaged = false
    void engaged
    for (let i = 0; i < 25 * 400; i++) {
      g.step(1 / 25); if (g.kingdoms[1].lumber < 400) g.kingdoms[1].lumber = 900
      if (g.towers.some(t => t.faction === 1 && (t.kind === 'zumwalt' || t.kind === 'gunship')) || g.boats.some(b => b.faction === 1 && (b.kind === 'zumwalt' || b.kind === 'gunship'))) built = true
      if (raider.hp < raider.maxHp || !g.boats.includes(raider)) engaged = true // their new warships went out and hit it
    }
    expect({ built, engaged }).toEqual({ built: true, engaged: true })
  }, 120000)
})

describe('shipyards out of the enemy\'s reach', () => {
  it('an AI under naval attack lays its ship down on the coast the enemy Zumwalt cannot reach', () => {
    const rows = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '.'.repeat(30) + '#'.repeat(50) + '.'.repeat(40)))
    const g = makeGame({ rows, towns: [[0, 10, 5], [1, 35, 20], [1, 74, 20], [2, 100, 20]], units: [], pawns: true, ai: true, relation: 'war' })
    { const e = bestYardSite(g, g.towns[2]); placeYard(g, 1, e!.x, e!.y) } // the kingdom's one yard stands on the east coast
    g.kingdoms[1].lumber = 900; g.time = 200
    const raider = spawnBoat(g, 2, 'zumwalt', px(100), px(10)); park(g, raider, 22, 20) // off the west coast
    for (let n = 0; n < 6; n++) {
      g.towers = g.towers.filter(t => t.faction !== 1 || t.kind === 'lot')
      expect(placeShip(g, 1, 'gunship')).toBe(true)
      const site = g.towers.find(t => t.faction === 1 && t.kind === 'gunship')!
      expect(site.shore!.x).toBeGreaterThan(60 * TILE)                                  // the east coast, well away from the raider
    }
  })
})
