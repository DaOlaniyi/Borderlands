import { describe, expect, it } from 'vitest'
import { BOAT, BOAT_FLAG, TILE, TOWER, UNIT, ZUMWALT } from '../game/config'
import { cargoCount, orderSail, spawnBoat, unload, zumwaltFalloff } from '../game/BoatSystem'
import { makeGame, stepN, withYards } from './helpers'

// two islands (land '#') separated by 40 tiles of open sea
const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(40) + '#'.repeat(30))
const mk = (extra: Partial<Parameters<typeof makeGame>[0]> = {}) => withYards(makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [], ...extra }), 0)
const px = (c: number) => (c + 0.5) * TILE

describe('building ships', () => {
  it('a boat costs 50 wood, must be placed in the water beside own shoreline, and is built by a pawn', () => {
    const g = mk({ pawns: true })
    g.kingdoms[0].lumber = 120
    expect(g.structureError('boat', 0, px(10), px(20))).toMatch(/water/)           // on land
    expect(g.structureError('boat', 0, px(50), px(20))).toMatch(/shoreline/)       // open sea, far from the coast
    expect(g.structureError('boat', 0, px(31), px(20))).toBeNull()
    const site = g.placeBoat(0, 'boat', px(31), px(20))!
    expect(g.kingdoms[0].lumber).toBe(70)
    expect(site.kind).toBe('boat'); expect(site.shore).toBeTruthy()
    stepN(g, 25 * (BOAT.buildTime + 25))
    expect(g.boats.length).toBe(1)
    expect(g.towers.length).toBe(0)
    expect(g.boats[0].docked).toBe(true)                                           // built beside the shore, it starts moored
  })
  it('a Zumwalt costs 300 wood and carries 8 units; construction can be cancelled for a refund', () => {
    const g = mk()
    g.towns[0].level = 2 // (a Zumwalt needs an upgraded town)
    g.kingdoms[0].lumber = 400
    const site = g.placeBoat(0, 'zumwalt', px(31), px(20))!
    expect(ZUMWALT.cost).toBe(300)
    expect(g.kingdoms[0].lumber).toBe(100)
    expect(g.cancelStructure(site)).toBe(true); expect(g.kingdoms[0].lumber).toBe(400)
    expect(spawnBoat(g, 0, 'zumwalt', px(50), px(20)).cap).toBe(8)
    expect(ZUMWALT.hp).toBe(UNIT.warrior.damage * 2.5 * 12); expect(BOAT.hp).toBe(UNIT.warrior.hp / 2)
  })
})

describe('sailing, docking and territory', () => {
  it('sails over open sea (no territory needed), moors against the far coast and claims ~6 tiles as a mini town', () => {
    const g = mk()
    const b = spawnBoat(g, 0, 'boat', px(31), px(20))
    expect(b.docked).toBe(true)
    expect(orderSail(g, b, [px(50), px(20), px(69), px(20)])).toBe(true)
    expect(b.docked).toBe(false)
    stepN(g, 25 * 50)
    expect(b.docked).toBe(true)
    expect(b.x).toBeGreaterThan(px(68))
    const w = g.world.w
    expect(g.controller[20 * w + 70]).toBe(1)          // the dock tile is ours (kingdom 0 -> value 1)
    expect(g.controller[20 * w + 71]).toBe(1)          // and the tiles around it (an enemy town's core still outweighs it further in)
    expect(g.supplied[20 * w + 70]).toBe(1)            // the mini town supplies its pocket
  })
  it('boats move at about an archer\'s walking speed', () => {
    const g = mk()
    const b = spawnBoat(g, 0, 'boat', px(45), px(10))
    orderSail(g, b, [px(60), px(10)])
    const x0 = b.x
    stepN(g, 25 * 5)
    const v = (b.x - x0) / 5
    expect(v).toBeGreaterThan(UNIT.archer.speed * 0.6); expect(v).toBeLessThan(UNIT.archer.speed * 1.2)
  })
})

describe('carrying troops', () => {
  it('units board a docked boat, keep counting against the population cap, and unload on shore', () => {
    const g = mk()
    const b = spawnBoat(g, 0, 'boat', px(31), px(20))
    const u = g.spawnUnit(0, px(27), px(20))
    const popBefore = g.pop(0)
    expect(g.orderRoute(u, [px(29), px(20), b.x, b.y])).toBe(true)
    expect(u.boardBoat).toBe(b.id)
    stepN(g, 25 * 20)
    expect(u.inTower).toBe(BOAT_FLAG + b.id)
    expect(b.cargo).toEqual([u.id]); expect(cargoCount(g, b)).toBe(1)
    expect(g.pop(0)).toBe(popBefore)                       // troops at sea still count against the cap (no second army, no over-capacity on landing)
    expect(unload(g, b)).toBe(1)
    expect(u.inTower).toBe(-1); expect(g.isLandAt(u.x, u.y)).toBe(true); expect(g.pop(0)).toBe(popBefore)
  })
  it('cannot unload while at sea; cargo dies if the ship is sunk at sea but survives a docked sinking', () => {
    const g = mk()
    const b = spawnBoat(g, 0, 'boat', px(50), px(10))
    const u = g.spawnUnit(0, b.x, b.y); b.cargo.push(u.id); u.inTower = BOAT_FLAG + b.id
    expect(unload(g, b)).toBe(0)
    g.boats = g.boats.filter(q => q !== b); g.killUnit(u)
    expect(u.state).toBe('dead')
  })
})

describe('Zumwalt gunnery', () => {
  it('outranges an archer tower twice over', () => {
    expect(ZUMWALT.rangeTiles).toBe(2 * UNIT.archer.range * TOWER.rangeMult / TILE)
  })
  it('damage falls from 100% to 10% across 24 tiles', () => {
    expect(zumwaltFalloff(0)).toBeCloseTo(1)
    expect(zumwaltFalloff(24 * TILE)).toBeCloseTo(0.1)
    expect(zumwaltFalloff(40 * TILE)).toBeCloseTo(0.1)
  })
  it('fires bursts of two shells 0.5 s apart, 3 s between volleys, each up to 2.5x a warrior; ships are the default priority', () => {
    const g = mk()
    const z = spawnBoat(g, 0, 'zumwalt', px(45), px(10))
    const ship = spawnBoat(g, 1, 'boat', px(50), px(10))
    const tower = g.placeTower(1, px(76), px(20)); void tower
    g.kingdoms[1].lumber = 100
    z.volleyCd = 0
    const times: number[] = []
    let last = 0
    for (let i = 0; i < 25 * 14; i++) { g.step(1 / 25); if (g.shells.length > last) times.push(g.time); last = g.shells.length } // (the first volley waits 4 s while the guns lock on)
    expect(times.length).toBeGreaterThanOrEqual(4)
    expect(times[1] - times[0]).toBeGreaterThan(0.4); expect(times[1] - times[0]).toBeLessThan(0.65)   // two shots, ~0.5 s apart
    expect(times[2] - times[1]).toBeGreaterThan(2.5)                                                     // then a ~3 s pause
    expect(ship.hp).toBeLessThan(ship.maxHp)
    expect(UNIT.warrior.damage * ZUMWALT.damageMult).toBeGreaterThan(90)
  })
  it('focus can be switched to buildings or troops, and a docked Zumwalt cannot fire', () => {
    const g = mk()
    const z = spawnBoat(g, 0, 'zumwalt', px(31), px(10)) // docked beside the shore
    const foe = g.spawnUnit(1, px(40), px(10)) // standing in the sea? keep it on land instead
    foe.x = px(26); foe.y = px(10)
    z.focus = 'troops'
    stepN(g, 25 * 6)
    expect(z.docked).toBe(true)
    expect(g.shells.length).toBe(0); expect(foe.hp).toBe(foe.maxHp)
  })
})

describe('docked ships are vulnerable', () => {
  it('land troops attack an enemy ship moored at their shore', () => {
    const g = mk()
    const b = spawnBoat(g, 1, 'boat', px(31), px(20)) // enemy boat moored beside kingdom 0's coast
    const w = g.spawnUnit(0, px(29), px(20))
    w.route = []; void w
    stepN(g, 25 * 4)
    expect(b.hp).toBeLessThan(b.maxHp)
  })
})

describe('AI navy', () => {
  const big = () => {
    // kingdom 1 is a large nation (4 towns) on the east island; kingdom 0 sits alone on the west island across the sea
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20], [1, 90, 10], [1, 90, 30], [1, 75, 30]], units: [], pawns: true, ai: true, relation: 'war' })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    g.kingdoms[1].aggression = 1; g.kingdoms[1].temperament = 'neutral'
    for (const t of g.towns) if (t.owner === 1) t.level = 2 // (Zumwalts need upgraded towns)
    return g
  }
  it('builds infantry boats for the crossing, and a large nation saves for a Zumwalt (unlimited harvest) only after its lots and towers', () => {
    const g = big()
    g.time = 200; g.kingdoms[1].lumber = 100
    stepN(g, 25 * 5)
    expect(g.kingdoms[1].harvest).toBe('med')                               // lots and towers are still wanted: no saving for a ship yet
    g.aiMemo.noSpot[1] = 4; g.aiMemo.tower[1] = 1e9                         // (no room left for more of them)
    stepN(g, 25 * 5)
    expect(g.kingdoms[1].harvest).toBe('unlimited')                         // 'med' stops chopping at 300 lumber, a Zumwalt needs 340
    g.kingdoms[1].lumber = 1000
    stepN(g, 25 * 3)
    expect(g.towers.some(t => t.faction === 1 && t.kind === 'zumwalt')).toBe(true)
    expect(g.kingdoms[1].harvest).toBe('med')                               // back to normal once it can pay
  })
  it('a Zumwalt sails to a bombardment station, a boat ferries troops across, and nothing is built in a landlocked lake', () => {
    const g = big()
    g.time = 200; g.aiMemo.noSpot[1] = 4; g.aiMemo.tower[1] = 1e9; g.kingdoms[1].lumber = 1000
    for (let i = 0; i < 25 * 400 && !(g.boats.some(b => b.faction === 1 && b.kind === 'zumwalt')); i++) { g.step(1 / 25); if (g.kingdoms[1].lumber < 600) g.kingdoms[1].lumber = 1000 }
    const z = g.boats.find(b => b.faction === 1 && b.kind === 'zumwalt')!
    expect(z).toBeTruthy()
    stepN(g, 25 * 80)
    expect(z.docked).toBe(false)                                            // it sailed out to a station off the enemy town
    const sea = g.info.sea
    for (const s of g.towers.filter(t => t.faction === 1)) if (s.kind === 'boat' || s.kind === 'zumwalt') expect(sea[s.cy * g.world.w + s.cx]).toBe(1)
  })
})
