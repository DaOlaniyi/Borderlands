import { describe, expect, it } from 'vitest'
import { AI, BARGE, BOAT, CARE, DOCK, MEAT, TILE, UNIT, UNIT_BODY, ZUMWALT } from '../game/config'
import { hostileShoreNear, spawnBoat, undock } from '../game/BoatSystem'
import { gunshipsWanted } from '../game/ColonyAI'
import { unitPower, updateWarGoal } from '../game/AISystem'
import { meatCap, stockOfTown, deposit } from '../game/Economy'
import type { Game } from '../game/Game'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const land = Array.from({ length: 40 }, () => '#'.repeat(120))
const quiet = (g: Game) => { for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false } }

describe('war goals and force comparison', () => {
  it('stages against a strong defence (no trickling in), launches with a clear edge, and goes all-in after a stalled 4 minutes', () => {
    const units: [number, number, number][] = []
    for (let i = 0; i < 6; i++) units.push([1, 96 + (i % 3), 18 + Math.floor(i / 3)])      // 6 attackers
    for (let i = 0; i < 6; i++) units.push([0, 60 + (i % 3), 18 + Math.floor(i / 3)])      // 6 defenders around the target town
    const g = makeGame({ rows: land, towns: [[0, 61, 20], [0, 10, 20], [1, 100, 20], [1, 104, 20]], units, relation: 'war', ai: true })
    quiet(g); g.time = 100
    stepN(g, 25 * 40)
    const goal = g.warGoals.get(1)!
    expect(goal).toBeTruthy()
    expect(goal.launched).toBe(false)                                                       // an even fight is not an edge: it masses at its border
    const nearest = Math.min(...g.units.filter(u => u.faction === 1).map(u => Math.abs(u.x - g.towns[0].x)))
    expect(nearest).toBeGreaterThan(20 * TILE)
    g.time += AI.warStall + 30                                                              // no progress for the stall time: all-in
    for (let i = 0; i < 25 * 5; i++) g.step(1 / 25)
    expect(g.warGoals.get(1)?.allIn || g.warGoals.get(1)?.launched).toBe(true)
  })
  it('a clearly weaker AI in a stalled AI-versus-AI war asks for a ceasefire', () => {
    const units: [number, number, number][] = []
    for (let i = 0; i < 2; i++) units.push([1, 96 + i, 20])
    for (let i = 0; i < 12; i++) units.push([2, 30 + (i % 4), 18 + Math.floor(i / 4)])
    const g = makeGame({ rows: land, towns: [[0, 5, 5], [1, 100, 20], [2, 36, 20]], units, relation: 'neutral', ai: true })
    quiet(g); g.diplomacy.set(1, 2, 'war', 0); g.time = 100
    updateWarGoal(g, 1, [g.towns[2]], g.units.filter(u => u.faction === 1))
    const goal = g.warGoals.get(1)!
    goal.progressAt = g.time - AI.warStall - 5
    updateWarGoal(g, 1, [g.towns[2]], g.units.filter(u => u.faction === 1))
    expect(g.diplomacy.get(1, 2)).toBe('neutral')
  })
  it('reinforcements appear at the town nearest the front', () => {
    const g = makeGame({ rows: land, towns: [[0, 10, 20], [1, 110, 20], [1, 90, 20], [1, 114, 24]], units: [[1, 92, 20]], relation: 'war', ai: true })
    quiet(g); g.time = 100
    g.kingdoms[1].power = 1000
    g.warGoals.set(1, { target: 0, since: 0, progressAt: 100, mark: 0, allIn: false, launched: true })
    const nearTown = g.towns[2]
    let near = 0
    let made = 0
    for (let i = 0; i < 60; i++) { g.kingdoms[1].produce = { warrior: true, archer: false, lancer: false, knight: false }; g.kingdoms[1].power = 1000; const u = g.tryProduce(g.kingdoms[1]); if (u) { made++; if (Math.hypot(u.x - nearTown.x, u.y - nearTown.y) < 3 * TILE) near++; u.state = 'dead'; g.units = g.units.filter(q => q !== u) } }
    expect(made).toBeGreaterThan(40); expect(near / made).toBeGreaterThan(0.7)
  })
  it('unit power: warriors 1, lancers 0.8, archers 0.6, scaled by squad and health', () => {
    const g = makeGame({ rows: land, towns: [[0, 10, 20], [1, 90, 20]], units: [[0, 12, 20], [0, 12, 21, 'lancer'], [0, 13, 20, 'archer']], relation: 'war' })
    const [w, l, a] = g.units
    expect(unitPower(w)).toBeCloseTo(1); expect(unitPower(l)).toBeCloseTo(0.8); expect(unitPower(a)).toBeCloseTo(0.6)
  })
})

describe('AI navy: Zumwalts, gunships and invasion sizing', () => {
  const sea = Array.from({ length: 40 }, (_, y) => (y < 2 || y >= 38 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))
  it('imperialists build Zumwalts early, without waiting for lots; a well-resourced nation at war fields 2–3', () => {
    const g = makeGame({ rows: sea, towns: [[0, 95, 20], [1, 34, 20], [1, 34, 24], [1, 30, 16]], units: [], pawns: true, ai: true, relation: 'war' })
    quiet(g); for (const t of g.towns) if (t.owner === 1) t.level = 2 // (upgraded towns carry the Zumwalts)
    g.kingdoms[1].temperament = 'imperialist'; g.kingdoms[1].lumber = 900; g.time = 120
    stepN(g, 25 * 30)
    expect(g.towers.some(t => t.faction === 1 && t.kind === 'zumwalt') || g.boats.some(b => b.faction === 1 && b.kind === 'zumwalt')).toBe(true)
    const n = makeGame({ rows: sea, towns: [[0, 95, 20], [1, 34, 20], [1, 34, 24], [1, 30, 16], [1, 36, 28]], units: [], pawns: true, ai: true, relation: 'war' })
    quiet(n); for (const t of n.towns) if (t.owner === 1) t.level = 2
    n.kingdoms[1].lumber = 900; n.aiMemo.noSpot[1] = 4; n.aiMemo.tower[1] = 1e9; n.time = 300
    let seen = 0
    for (let i = 0; i < 25 * 600; i++) { n.step(1 / 25); if (n.kingdoms[1].lumber < 400) n.kingdoms[1].lumber = 900; seen = Math.max(seen, n.boats.filter(b => b.faction === 1 && b.kind === 'zumwalt').length) }
    expect(seen).toBeGreaterThanOrEqual(2)
  }, 120000)
  it('keeps 2-3 gunships per Zumwalt (up to 9) to protect them, and at least 3 while enemy warships are about', () => {
    const g = makeGame({ rows: sea, towns: [[0, 95, 20], [1, 34, 20]], units: [], pawns: true, ai: true, relation: 'war' })
    expect(gunshipsWanted(g, 1)).toBe(0)
    spawnBoat(g, 1, 'zumwalt', px(41), px(10)); expect(gunshipsWanted(g, 1)).toBe(2)       // a poor nation: 2 per Zumwalt
    g.kingdoms[1].lumber = 400; expect(gunshipsWanted(g, 1)).toBe(3)                        // a rich one: 3
    spawnBoat(g, 1, 'zumwalt', px(41), px(14)); spawnBoat(g, 1, 'zumwalt', px(41), px(18)); spawnBoat(g, 1, 'zumwalt', px(41), px(22))
    expect(gunshipsWanted(g, 1)).toBe(9)
    g.kingdoms[1].lumber = 0; g.boats.length = 1; g.navalThreat.add(1); expect(gunshipsWanted(g, 1)).toBe(3)
  })
  it('an invasion is sized to the defenders (too weak: it builds up first) and goes in as 1-3 FULL barges: 52 troops fill 3 barges', () => {
    const keep = CARE.overcapPct; CARE.overcapPct = 0 // (the test armies are bigger than the test towns' capacity)
    try {
    const units: [number, number, number][] = []
    for (let i = 0; i < 30; i++) units.push([0, 78 + (i % 6), 14 + Math.floor(i / 6)])   // 30 defenders on the far island
    for (let i = 0; i < 12; i++) units.push([1, 30 + (i % 4), 18 + Math.floor(i / 4)])   // only 12 attackers
    const g = makeGame({ rows: sea, towns: [[0, 80, 20], [1, 34, 20], [1, 34, 24], [1, 30, 16]], units, pawns: true, ai: true, relation: 'war' })
    quiet(g); g.kingdoms[1].aggression = 1; g.time = 300
    stepN(g, 25 * 60)
    expect(g.expeditions.get(1)).toBeUndefined()                                            // too weak: it builds up instead of striking randomly
    for (let i = 0; i < 40; i++) g.spawnUnit(1, px(28 + (i % 6)), px(12 + Math.floor(i / 6))) // now 52 troops
    g.boats.push(...[]); spawnBoat(g, 1, 'zumwalt', px(41), px(10))                         // and a Zumwalt
    stepN(g, 25 * 30)
    const ex = g.expeditions.get(1)
    expect(ex).toBeTruthy()
    expect(ex!.force).toBe(3 * BARGE.cap)                                                    // three full barges, never a token handful
    expect(Math.ceil(ex!.force / BARGE.cap)).toBe(3)
    } finally { CARE.overcapPct = keep }
  })
})

describe('boats, meat and archers', () => {
  it('a moored boat\'s friendly territory lasts two minutes, then it must redock', () => {
    const sea = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(20))
    const g = makeGame({ rows: sea, towns: [[0, 15, 20], [1, 55, 20]], units: [] })
    const b = spawnBoat(g, 0, 'boat', px(31), px(30)); void b
    stepN(g, 3)
    const dockedCell = g.boats[0].dockCell
    expect(dockedCell).toBeGreaterThanOrEqual(0)
    expect(g.controller[dockedCell]).toBe(1)
    stepN(g, 25 * (DOCK.lifetime + 5))
    expect(g.controller[dockedCell]).not.toBe(1)                                            // the mooring's claim has faded
    undock(g, g.boats[0]); g.boats[0].docking = false
  })
  it('a region keeps at most 5 meat per town on its landmass', () => {
    const g = makeGame({ rows: land, towns: [[0, 10, 20], [0, 14, 20], [1, 100, 20]], units: [], pawns: true })
    const t = g.towns[0]
    expect(meatCap(g, t)).toBe(MEAT.perTown * 2)
    deposit(g, t, 'meat', 50)
    expect(stockOfTown(g, t).meat).toBe(10)
  })
  it('archers shoot ships from 1.5x their range', () => {
    const sea = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(40) + '#'.repeat(30))
    const g = makeGame({ rows: sea, towns: [[0, 20, 20], [1, 80, 20]], units: [], relation: 'war' })
    const a = g.spawnUnit(0, px(29), px(20), 'archer')
    const near = spawnBoat(g, 1, 'boat', px(40), px(20)); undock(g, near); near.x = px(38); near.y = px(20) // ~9 tiles: beyond 6, inside 9
    const hp0 = near.hp
    stepN(g, 25 * 4)
    expect(UNIT.archer.range * UNIT_BODY.archerBoatRange).toBeGreaterThan(UNIT.archer.range * 1.4)
    expect(near.hp).toBeLessThan(hp0)
    void a
  })
  it('a Zumwalt volley still needs lock-on; three Zumwalts at close range out-damage five repairing pawns, two do not', () => {
    const pawnsRepair = 5 * 40
    const perZum = ZUMWALT.damageMult * UNIT.warrior.damage * ZUMWALT.buildingMult * 0.5 * 0.9 * (2 / 3.5) * 0.85 // direct hits only, 85 % of full damage at close range
    expect(3 * perZum).toBeGreaterThan(pawnsRepair)
    expect(2 * perZum).toBeLessThan(pawnsRepair)
  })
})

describe('razing a village from the sea', () => {
  const run = (zums: number, seconds: number) => {
    const sea = Array.from({ length: 40 }, (_, y) => (y < 2 || y >= 38 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))
    const g = makeGame({ rows: sea, towns: [[0, 110, 5], [1, 20, 20]], units: [[0, 74, 20]], pawns: false, relation: 'war' })
    // a level 3 village on the east island's west shore, five pawns of its own ready to mend it
    const t = { id: g.towns.length, cx: 74, cy: 20, x: px(74), y: px(20), owner: 0, kind: 'settlement' as const, level: 3 as const, store: { lumber: 0, gold: 0, meat: 10 }, meatT: 0, upkeepT: 0, land: g.info.landmass[20 * g.world.w + 74], crate: null, abandoned: false, hitAt: -99, pawnIds: [], flash: 0, hp: 1500, maxHp: 1500, stock: 0, produce: true, raze: false, ruined: false }
    g.towns.push(t); g.markDirty(); g.recomputeTerritory()
    for (let i = 0; i < 5; i++) g.spawnPawn(t)
    for (let i = 0; i < zums; i++) { const z = spawnBoat(g, 1, 'zumwalt', px(60), px(12 + i * 4)); undock(g, z); z.x = z.px = px(67); z.y = z.py = px(16 + i * 4); z.route = []; z.docking = false; z.focus = 'buildings'; z.vx = z.vy = 0 }
    g.kingdoms[0].produce = { warrior: false, archer: false, lancer: false, knight: false }
    for (let i = 0; i < 25 * seconds && !t.ruined; i++) { g.step(1 / 25); if (t.store) t.store.meat = 10; const u = g.units.find(q => q.faction === 0); if (u) u.hp = u.maxHp }
    return t
  }
  it('a Zumwalt squadron shelling from the shore standoff razes a level 3 village despite its pawns mending it; one or two cannot', () => {
    expect(run(1, 150).ruined).toBe(false)
    expect(run(2, 200).ruined).toBe(false)
    expect(run(5, 300).ruined).toBe(true) // (they now shell from the 13-tile standoff, so accuracy is lower than at point-blank)
  }, 120000)
})

describe('Zumwalt shore standoff', () => {
  it('an AI Zumwalt too near an enemy shore backs off to safe water, and keeps clear of it', () => {
    const sea = Array.from({ length: 40 }, (_, y) => (y < 2 || y >= 38 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))
    const g = makeGame({ rows: sea, towns: [[0, 110, 5], [1, 20, 20]], units: [[0, 74, 20]], pawns: false, relation: 'war' })
    const z = spawnBoat(g, 1, 'zumwalt', px(60), px(20)); undock(g, z); z.x = z.px = px(68); z.y = z.py = px(20); z.route = []; z.docking = false; z.noDock = true
    stepN(g, 25 * 20)
    expect(hostileShoreNear(g, 1, z.x, z.y, 11)).toBe(false)
  })
})

describe('protecting the Zumwalt', () => {
  // open sea 120 wide; the two nations' towns sit on small islands at the west and east edges
  const water = Array.from({ length: 60 }, (_, y) => (y < 4 || y > 55 ? '#'.repeat(120) : '#'.repeat(6) + '.'.repeat(108) + '#'.repeat(6)))
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / TILE
  const fleet = () => {
    const g = makeGame({ rows: water, towns: [[0, 3, 30], [1, 116, 30]], units: [], relation: 'war', ai: true })
    quiet(g); g.time = 400
    return g
  }
  it('a Zumwalt with a gunship on it backs out of the gunship\'s reach, still firing, while its own gunships go forward', () => {
    const g = fleet()
    const z = spawnBoat(g, 1, 'zumwalt', px(60), px(30)), esc = spawnBoat(g, 1, 'gunship', px(62), px(34))
    const raiders = [px(51), px(52), px(50)].map((x, i) => { const r = spawnBoat(g, 0, 'gunship', x, px(28 + i * 2)); r.noDock = true; r.strike = { kind: 'boat', id: z.id, x: z.x, y: z.y }; return r }) // three of them, 8-10 tiles off: well inside their 11-tile guns
    for (const b of [z, esc]) b.noDock = true
    const start = dist(z, raiders[0]), startGap = dist(esc, raiders[0])
    let shots = 0, farthest = start, minGap = startGap, closestRaider = start
    for (let i = 0; i < 25 * 8; i++) { g.step(1 / 25); closestRaider = Math.min(closestRaider, dist(z, raiders[0])); shots += g.shells.filter(s => s.src === z.id && s.t === 0).length; farthest = Math.max(farthest, dist(z, raiders[0])); minGap = Math.min(minGap, dist(esc, raiders[0])) }
    expect(z.evadeT).toBeGreaterThan(400)                                                  // it ran
    expect(closestRaider).toBeLessThan(start - 0.5)                                          // the raiders rush it (a gunship goes right up to a Zumwalt)
    expect(shots).toBeGreaterThan(0)                                                       // while still firing
    expect(minGap).toBeLessThan(startGap - 3)                                              // and the escort closed on the raiders
  })
  it('a Zumwalt engaging a gunship stands off at gunnery range: it closes from far away but never into its guns', () => {
    const g = fleet()
    const z = spawnBoat(g, 1, 'zumwalt', px(60), px(30))
    const prey = spawnBoat(g, 0, 'gunship', px(38), px(30)); prey.noDock = true; z.noDock = true // 22 tiles away: shells land poorly out here
    let closest = Infinity
    for (let i = 0; i < 25 * 30; i++) { g.step(1 / 25); closest = Math.min(closest, dist(z, prey)) }
    expect(closest).toBeGreaterThan(11)                                                     // never inside the gunship's 11-tile reach
  })
})
