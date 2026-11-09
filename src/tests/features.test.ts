import { describe, expect, it } from 'vitest'
import { CARE, POP, TERRITORY, TILE, TOWER, UNIT, UNIT_BODY } from '../game/config'
import { InputController } from '../game/InputController'
import type { Camera } from '../game/Camera'
import { Game } from '../game/Game'
import { UNIT_NAMES, kingdomTier } from '../game/names'
import { generateWorld, makeWorldFromMask } from '../game/WorldGenerator'
import { cellCenterPx, ctrl, makeGame, openRows, stepN } from './helpers'

const rows = openRows(60, 30)
const noAttrition = <T,>(fn: () => T): T => { const a = TERRITORY.attritionPct; TERRITORY.attritionPct = 0; try { return fn() } finally { TERRITORY.attritionPct = a } }

describe('unit stats', () => {
  it('has triple-health warriors and archers/lancers at 25% / 40% of a warrior', () => {
    expect(UNIT.warrior.hp).toBe(900)
    expect(UNIT.archer.hp).toBe(UNIT.warrior.hp * 0.25)
    expect(UNIT.lancer.hp).toBe(UNIT.warrior.hp * 0.36) // 40% of a warrior, reduced by 10%
  })
  it('archers shoot 6 tiles, lancers about 1.5, and deal less damage than warriors', () => {
    expect(UNIT.archer.range).toBe(6 * TILE)
    expect(UNIT.lancer.range).toBeLessThan(UNIT.archer.range / 3)
    expect(UNIT.archer.damage).toBeLessThan(UNIT.warrior.damage); expect(UNIT.lancer.damage).toBeLessThan(UNIT.warrior.damage)
    expect(UNIT.lancer.attackDuration + UNIT.lancer.cooldown).toBeCloseTo(2) // one strike every two seconds
  })
  const crossTime = (type: 'warrior' | 'archer' | 'lancer') => {
    const g = makeGame({ rows, towns: [[0, 2, 15], [1, 57, 15]], units: [[0, 10, 15, type]] })
    const u = g.units[0]
    g.applyRoute(u, [u.x + 5 * TILE, u.y])
    let t = 0
    while (u.route.length && u.routeIdx < u.route.length / 2 && t < 40) { g.step(1 / 25); t += 1 / 25 }
    return t
  }
  it('moves 5 tiles in about 10 s (warrior), 5 s (archer), and in between for lancers', () => {
    const w = crossTime('warrior'), a = crossTime('archer'), l = crossTime('lancer')
    expect(w).toBeGreaterThan(8.5); expect(w).toBeLessThan(12.5)
    expect(a).toBeGreaterThan(4.2); expect(a).toBeLessThan(6.5)
    expect(l).toBeGreaterThan(a); expect(l).toBeLessThan(w)
  })
  it('counts a waypoint as reached inside a tolerance radius and does not creep to exact points', () => {
    const g = makeGame({ rows, towns: [[0, 2, 15], [1, 57, 15]], units: [[0, 10, 15]] })
    const u = g.units[0]
    g.applyRoute(u, [u.x + 200, u.y, u.x + 400, u.y + 5])
    stepN(g, 25 * 22)
    expect(u.state).toBe('idle')
    expect(Math.hypot(u.x - (cellCenterPx(10, 15).x + 400), u.y - (cellCenterPx(10, 15).y + 5))).toBeLessThanOrEqual(UNIT_BODY.endTol + 1)
  })
  it('gives up on a point it cannot physically reach instead of getting stuck', () => {
    const g = makeGame({ rows, towns: [[0, 2, 15], [1, 57, 15]], units: [[0, 30, 15], [1, 25, 15]] })
    const [blocker, mover] = [g.units[0], g.units[1]]
    g.setBlock(blocker, true)
    g.applyRoute(mover, [blocker.x, blocker.y]) // the end point sits inside the blocker's no-go zone
    mover.disengageT = 99
    stepN(g, 25 * 30)
    expect(mover.state === 'idle' || mover.state === 'blocked').toBe(true)
    expect(mover.route.length === 0 || mover.routeIdx >= mover.route.length / 2).toBe(true)
  })
})

describe('guaranteed 2×2 territory', () => {
  it('an isolated unit deep in enemy land always keeps a 2×2 patch', () => {
    const g = makeGame({ rows, towns: [[0, 10, 15], [1, 55, 2]], units: [[1, 10, 17]] })
    expect(ctrl(g, 10, 15)).toBe(1) // town tile stays with its owner
    for (const [x, y] of [[10, 17], [11, 17], [10, 18], [11, 18]]) expect(ctrl(g, x, y)).toBe(2)
    stepN(g, 3)
    for (const [x, y] of [[10, 17], [11, 17], [10, 18], [11, 18]]) expect(ctrl(g, x, y)).toBe(2)
    expect(g.units[0].cutOff).toBe(true) // and, being disconnected, it is unsupplied
  })
})

describe('care: attrition, healing and population', () => {
  it('cut-off armies burn down on a percentage basis', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [[0, 40, 15]] })
    stepN(g, 25 * (TERRITORY.cutGrace - 2))
    expect(g.units[0].hp).toBe(UNIT.warrior.hp) // grace period: no damage while it pushes deep
    stepN(g, 25 * 3)
    expect(g.units[0].hp).toBeLessThan(UNIT.warrior.hp)
    stepN(g, 25 * 130)
    expect(g.units.length).toBe(0) // …but a unit that stays cut off still dies
  })
  it('units regenerate when no enemy is within 5 tiles, 2.5× faster beside their town, and not when cut off', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [0, 25, 15], [1, 55, 2]], units: [[0, 5, 17], [0, 15, 15], [1, 40, 28]] })
    const atTown = g.units[0], field = g.units[1], enemy = g.units[2]
    for (const u of [atTown, field]) u.hp = 300
    enemy.mode = 'block'
    stepN(g, 25 * 4)
    const gainTown = atTown.hp - 300, gainField = field.hp - 300
    expect(gainField).toBeGreaterThan(0)
    expect(gainTown / gainField).toBeGreaterThan(CARE.townMult * 0.8); expect(gainTown / gainField).toBeLessThan(CARE.townMult * 1.2)
    // enemy within 5 tiles stops regeneration
    field.hp = 300; enemy.x = field.x + 4 * TILE; enemy.y = field.y; enemy.cell = g.cellAt(enemy.x, enemy.y)
    stepN(g, 25 * 2)
    expect(field.hp).toBeLessThanOrEqual(300)
  })
  it('caps the population at 3 per town and 5 per barracks; towers free the cap', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 40, 15], [1, 50, 15], [1, 45, 20], [1, 52, 22]], units: [], barracks: [1] })
    expect(g.cap(0)).toBe(POP.perTown)
    expect(g.cap(1)).toBe(POP.perBarracks + 3 * POP.perTown)
  })
  it('produces toggled unit types every 10 s while there is room and Power, deducting the cost', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [] })
    const k = g.kingdoms[0]
    k.power = 100; k.prodTimer = POP.spawnInterval; k.produce.archer = true
    stepN(g, 25 * 9); expect(g.units).toHaveLength(0)
    stepN(g, 25 * 2); expect(g.units).toHaveLength(1)
    expect(g.units[0].type).toBe('archer')
    expect(k.power).toBeLessThanOrEqual(100 - UNIT.archer.cost + 3 * 11 + 1) // spent 20, earned ≤ free capacity (3) per second
    // room limit of 3
    for (let i = 0; i < 6; i++) g.tryProduce(k)
    expect(g.pop(0)).toBe(3)
    // not enough power
    k.power = 5; k.produce.warrior = true; k.produce.archer = false
    expect(g.tryProduce(k)).toBeNull()
  })
  it('units above the cap take damage until the mismatch is reconciled', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [[0, 6, 17], [0, 7, 17], [0, 8, 17], [0, 9, 17]] })
    expect(g.pop(0)).toBe(4); expect(g.cap(0)).toBe(3)
    stepN(g, 25 * 3)
    const hurt = g.units.filter(u => u.hp < u.maxHp)
    expect(hurt).toHaveLength(1)
    expect(hurt[0].overcap).toBe(true)
  })
})

describe('diplomacy', () => {
  it('starts neutral between the player and every AI kingdom', () => {
    const g = Game.fromSeed('REL', 5)
    for (let k = 1; k < 5; k++) expect(g.diplomacy.get(0, k)).toBe('neutral')
    expect(g.kingdoms.every(k => k.name.length > 0)).toBe(true)
  })
  it('only conflict and war fight; neutral and allied units ignore each other', () => {
    const fight = (relation: 'neutral' | 'allied' | 'conflict' | 'war') => noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 25, 15], [1, 55, 2]], units: [[0, 25, 28], [1, 25, 28]], relation })
      g.units[1].x = g.units[0].x + 20 // same tile, so no territory is exchanged
      stepN(g, 25 * 6)
      return g.units.some(u => u.hp < u.maxHp)
    })
    expect(fight('neutral')).toBe(false); expect(fight('allied')).toBe(false)
    expect(fight('conflict')).toBe(true); expect(fight('war')).toBe(true)
  })
  it('seizing a region of a neutral kingdom turns relations to In Conflict', () => {
    const g = makeGame({ rows, towns: [[0, 25, 15], [1, 55, 2]], units: [], relation: 'neutral' })
    expect(g.diplomacy.get(0, 1)).toBe('neutral')
    g.spawnUnit(1, ...Object.values(cellCenterPx(27, 17)) as [number, number])
    stepN(g, 6) // beside a town: no countdown
    expect(g.diplomacy.get(0, 1)).toBe('conflict')
  })
  it('escalates to a permanent war after kills, and quiet conflicts cool back to neutral', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [], relation: 'neutral' })
    g.diplomacy.set(0, 1, 'conflict', g.time)
    g.diplomacy.death(1, 0, g.time); g.diplomacy.death(0, 1, g.time)
    stepN(g, 25 * 60)
    expect(g.diplomacy.get(0, 1)).toBe('war')
    stepN(g, 25 * 400)
    expect(g.diplomacy.get(0, 1)).toBe('war') // war does not cool off
    const h = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [], relation: 'neutral' })
    h.diplomacy.set(0, 1, 'conflict', h.time)
    stepN(h, 25 * 100)
    expect(h.diplomacy.get(0, 1)).toBe('neutral')
  })
  it('accepts the player\'s alliance requests rarely early on, readily when the receiver is under attack', () => {
    let early = 0
    for (let i = 0; i < 200; i++) {
      const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [], relation: 'neutral' })
      g.rng = { ...g.rng, next: (() => { let x = (i + 1) * 0.0049; return () => ((x += 0.6180339) % 1) })() }
      if (g.proposeAlliance(1)) early++
    }
    expect(early / 200).toBeLessThan(0.2)
    const h = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2], [2, 30, 4]], units: [], relation: 'neutral' })
    h.diplomacy.set(1, 2, 'war', 0)
    expect(h.proposeAlliance(1)).toBe(true); expect(h.diplomacy.get(0, 1)).toBe('allied')
  })
})

describe('towns, last-town survival and capture rules', () => {
  const setup = (relation: 'allied' | 'war') => makeGame({ rows, towns: [[0, 20, 15], [1, 55, 2]], units: [[0, 20, 19]], relation })
  it('requires hostility and that no defender is within 2 tiles', () => {
    const neutral = setup('allied')
    neutral.spawnUnit(1, neutral.towns[0].x + 30, neutral.towns[0].y)
    stepN(neutral, 3); expect(neutral.towns[0].owner).toBe(0)

    const g = setup('war')
    g.units[0].x = g.towns[0].x + 3 * TILE; g.units[0].y = g.towns[0].y; g.units[0].cell = g.cellAt(g.units[0].x, g.units[0].y) // defender 3 tiles away
    g.spawnUnit(1, g.towns[0].x + 30, g.towns[0].y)
    stepN(g, 1); expect(g.towns[0].owner).toBe(1)

    const h = setup('war')
    h.units[0].x = h.towns[0].x + 1.5 * TILE; h.units[0].y = h.towns[0].y // inside 2 tiles
    h.spawnUnit(1, h.towns[0].x - 30, h.towns[0].y)
    h.setBlock(h.units[0], true)
    stepN(h, 3); expect(h.towns[0].owner).toBe(0) // protected while the defender stands
    h.killUnit(h.units[0]); stepN(h, 2); expect(h.towns[0].owner).toBe(1)
  })
  it('keeps units alive after the last town falls, and they can retake it', () => {
    const g = setup('war')
    g.units[0].x = g.towns[0].x + 3 * TILE; g.units[0].y = g.towns[0].y; g.units[0].cell = g.cellAt(g.units[0].x, g.units[0].y)
    g.spawnUnit(1, g.towns[0].x + 30, g.towns[0].y)
    stepN(g, 2)
    expect(g.ownedTowns(0)).toBe(0)
    expect(g.units.some(u => u.faction === 0)).toBe(true) // not wiped out
    expect(g.status).toBe('playing')
    stepN(g, 25 * 3)
    expect(g.units.find(u => u.faction === 0)!.cutOff).toBe(true) // but now unsupplied
    // the exiled unit walks back and, with no defender in range, takes the town again
    const exile = g.units.find(u => u.faction === 0)!
    g.units.filter(u => u.faction === 1).forEach(u => g.killUnit(u))
    g.orderMoveTo(exile, g.towns[0].x, g.towns[0].y)
    stepN(g, 25 * 8)
    expect(g.towns[0].owner).toBe(0)
  })
  it('labels kingdoms by town count', () => {
    expect([1, 2, 3].map(n => kingdomTier(n).title)).toEqual(['Clan', 'Clan', 'Clan'])
    expect([4, 5].map(n => kingdomTier(n).title)).toEqual(['Village', 'Village'])
    expect([6, 10].map(n => kingdomTier(n).title)).toEqual(['Tribe', 'Tribe'])
    expect([11, 20].map(n => kingdomTier(n).title)).toEqual(['Kingdom', 'Kingdom'])
    expect([21, 30].map(n => kingdomTier(n).title)).toEqual(['Empire', 'Empire'])
    expect(kingdomTier(0).title).toBe('Exiles')
  })
  it('lets the player rename their kingdom', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [] })
    g.renameKingdom(0, '  Thornhold ')
    expect(g.kingdoms[0].name).toBe('Thornhold')
  })
  it('gives large AI kingdoms a barracks with larger influence', () => {
    const { spawns } = generateWorld('BARRACKS', 4)
    for (let k = 1; k < 4; k++) { const own = spawns.filter(s => s.kingdom === k); expect(own.some(s => s.barracks)).toBe(own.length >= 4) }
    const g = makeGame({ rows, towns: [[0, 30, 15], [1, 5, 5]], units: [], barracks: [0] })
    expect(ctrl(g, 30 + 13, 15)).toBe(1); expect(ctrl(g, 30 + 14, 15)).toBe(0)
  })
  it('generates 100 distinct medieval names', () => {
    expect(new Set(UNIT_NAMES).size).toBe(100)
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [[0, 6, 17], [0, 7, 17], [0, 8, 17]] })
    expect(new Set(g.units.map(u => u.name)).size).toBe(3)
  })
  it('spawns two pawns per town', () => {
    const { world, spawns } = generateWorld('PAWNS', 3)
    const g = new Game({ world, spawns })
    for (const t of g.towns) expect(t.pawnIds).toHaveLength(2)
    expect(g.pawns).toHaveLength(2 * g.towns.length)
  })
})

describe('archers, lancers and combat roles', () => {
  it('archers hit from 6 tiles but not beyond; lancers knock back and strike every 2 s', () => {
    noAttrition(() => {
      const lowest = (g: ReturnType<typeof makeGame>, secs: number) => { let m = Infinity; for (let i = 0; i < 25 * secs; i++) { g.step(1 / 25); m = Math.min(m, g.units[1].hp) } return m }
      const mk = (d: number) => { const g = makeGame({ rows, towns: [[0, 5, 5], [1, 55, 25]], units: [[0, 20, 15, 'archer'], [1, 20, 15, 'warrior']] }); g.units[1].x = g.units[0].x + d; g.units[1].mode = 'block'; return g }
      expect(lowest(mk(5.5 * TILE), 3)).toBeLessThan(UNIT.warrior.hp)
      expect(lowest(mk(6.6 * TILE), 3)).toBe(UNIT.warrior.hp)
      const open = makeGame({ rows, towns: [[0, 5, 5], [1, 55, 25]], units: [[0, 20, 15, 'lancer'], [1, 20, 15, 'warrior']] })
      const [l0, w0] = open.units; w0.x = l0.x + 10; w0.y = l0.y; w0.mode = 'block'
      const px = w0.x
      stepN(open, 25 * 1)
      expect(w0.x).toBeGreaterThan(px + TILE * 0.5) // each strike pushes the enemy back about a tile
      // against the shore the push fails, which exposes the strike cadence
      const g = makeGame({ rows: openRows(23, 30), towns: [[0, 5, 5], [1, 20, 25]], units: [[0, 21, 15, 'lancer'], [1, 21, 15, 'warrior']] })
      const [l, w] = g.units; l.x = 1380; w.x = 1460; w.y = l.y; w.mode = 'block'
      const hits: number[] = []
      let prev = w.hp
      for (let i = 0; i < 25 * 7; i++) { g.step(1 / 25); if (w.hp < prev - 0.5) hits.push(g.time); prev = w.hp }
      expect(hits.length).toBeGreaterThanOrEqual(3)
      expect(hits[1] - hits[0]).toBeGreaterThan(1.8); expect(hits[1] - hits[0]).toBeLessThan(2.2)
    })
  })
})

describe('squads', () => {
  const mk = () => makeGame({ rows, towns: [[0, 10, 15], [0, 30, 15], [1, 55, 2]], units: [[0, 10, 17], [0, 11, 17], [0, 12, 17], [0, 30, 17, 'archer'], [0, 31, 17, 'archer'], [0, 32, 17, 'archer'], [0, 33, 17, 'archer'], [0, 34, 17, 'archer'], [0, 35, 17, 'archer']] })
  it('joins same-type full-health units into a squad with doubled health and damage; breaking restores units', () => {
    const g = mk()
    const [a, b] = [g.units[0], g.units[1]]
    expect(g.joinLabel([a.id, b.id])).toBe('Create Squad')
    const lead = g.joinUnits([a.id, b.id])!
    expect(lead.count).toBe(2); expect(lead.maxHp).toBe(UNIT.warrior.hp * 2); expect(lead.hp).toBe(lead.maxHp)
    g.step(1 / 25)
    expect(g.units.filter(u => u.type === 'warrior')).toHaveLength(2) // squad + remaining individual
    expect(g.joinLabel([lead.id, g.units.find(u => u.type === 'warrior' && u !== lead)!.id])).toBe('Merge')
    lead.hp = lead.maxHp * 0.5
    const parts = g.breakSquad(lead.id)
    expect(parts).toHaveLength(2)
    for (const u of parts) { expect(u.count).toBe(1); expect(u.hp).toBeCloseTo(UNIT.warrior.hp * 0.5) }
    expect(parts.map(u => u.name).sort()).toEqual([a.name, b.name].sort())
  })
  it('refuses to join mixed types, wounded units, and more than five members', () => {
    const g = mk()
    expect(g.joinReason([g.units[0].id, g.units[3].id])).toMatch(/same type/)
    g.units[1].hp = 10
    expect(g.joinReason([g.units[0].id, g.units[1].id])).toMatch(/full strength/)
    const archers = g.units.filter(u => u.type === 'archer')
    expect(g.joinReason(archers.map(u => u.id))).toMatch(/at most 5/)
    expect(g.joinReason(archers.slice(0, 5).map(u => u.id))).toBeNull()
    const sq = g.joinUnits(archers.slice(0, 5).map(u => u.id))!
    expect(sq.count).toBe(5)
  })
  it('a squad deals proportionally more damage and dies when its joined health is gone', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 25, 15], [1, 55, 2]], units: [[0, 20, 15], [0, 20, 16], [1, 20, 15]] })
      const [a, b, e] = g.units
      g.joinUnits([a.id, b.id]); e.x = a.x + 40; e.y = a.y; e.mode = 'block'
      stepN(g, 25 * 3)
      expect(UNIT.warrior.hp - e.hp).toBeGreaterThanOrEqual(UNIT.warrior.damage * 2 * 0.1 * 1) // blocking cuts to 10% of 2×24
      a.hp = 5
      g.killUnit(a)
      expect(a.state).toBe('dead')
    })
  })
  it('shift-click multi-selects and every selected unit follows the drawn route', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [[0, 10, 15], [0, 10, 17]] })
    const cam: Camera = { x: 0, y: 500, zoom: 1 }
    const input = new InputController(g, cam, () => ({ w: 1400, h: 800 }))
    const s = (u: { x: number; y: number }) => ({ x: (u.x - cam.x) * cam.zoom, y: (u.y - 10 - cam.y) * cam.zoom })
    const [a, b] = g.units
    input.down(s(a).x, s(a).y); input.up(s(a).x, s(a).y)
    input.down(s(b).x, s(b).y, true); input.up(s(b).x, s(b).y)
    expect(g.selection).toEqual({ kind: 'units', ids: [a.id, b.id] })
    input.down(s(a).x, s(a).y); input.move(s(a).x + 40, s(a).y); input.move(s(a).x + 200, s(a).y); input.up(s(a).x + 300, s(a).y)
    expect(a.route.length).toBeGreaterThan(0); expect(b.route.length).toBeGreaterThan(0)
  })
})

describe('towers', () => {
  const mk = () => { const g = makeGame({ rows, towns: [[0, 20, 15], [1, 55, 2]], units: [], pawns: true }); g.kingdoms[0].lumber = 100; return g }
  it('costs 30 lumber, needs own territory, and is built by a pawn in 30 s without changing territory', () => {
    const g = mk()
    expect(g.towerError(0, 20.5 * TILE, 15.5 * TILE)).toMatch(/town/) // too close to a town
    expect(g.towerError(0, 50 * TILE, 5 * TILE)).toMatch(/territory/)
    const before = g.controller.slice()
    const t = g.placeTower(0, 24.5 * TILE, 15.5 * TILE)!
    expect(t).not.toBeNull(); expect(g.kingdoms[0].lumber).toBe(70)
    let builtAt = -1
    for (let i = 0; i < 25 * 90 && builtAt < 0; i++) { g.step(1 / 25); if (t.built) builtAt = g.time }
    expect(builtAt).toBeGreaterThanOrEqual(TOWER.buildTime)
    expect(Array.from(g.controller)).toEqual(Array.from(before)) // towers add no territory
  })
  it('garrisons an idle archer: doubled range and damage, excluded from the unit count, killed with the tower', () => {
    noAttrition(() => {
      const g = mk()
      const t = g.placeTower(0, 24.5 * TILE, 15.5 * TILE)!
      t.built = true
      const archer = g.spawnUnit(0, t.x + 60, t.y + 40, 'archer')
      g.step(1 / 25)
      expect(archer.inTower).toBe(t.id); expect(t.archer).toBe(archer.id)
      expect(g.pop(0)).toBe(0) // not in the counting pool
      const foe = g.spawnUnit(1, t.x + 10.5 * TILE, t.y, 'warrior'); foe.mode = 'block'
      stepN(g, 25 * 4)
      expect(foe.hp).toBeLessThan(foe.maxHp) // 10.5 tiles is beyond a normal archer's 6 but inside the tower's 12
      const enemy = g.spawnUnit(1, t.x + 50, t.y + 20, 'warrior')
      void enemy
      g.destroyTower(t)
      expect(archer.state).toBe('dead')
    })
  })
  it('lets an archer leave the tower; exceeding the cap hurts it until reconciled', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 20, 15], [1, 55, 2]], units: [[0, 20, 17], [0, 21, 17], [0, 22, 17]], pawns: true })
      const t = g.placeTower(0, 24.5 * TILE, 15.5 * TILE) ?? (g.kingdoms[0].lumber = 100, g.placeTower(0, 24.5 * TILE, 15.5 * TILE)!)
      t.built = true
      const archer = g.spawnUnit(0, t.x + 40, t.y + 40, 'archer')
      g.step(1 / 25)
      expect(archer.inTower).toBe(t.id); expect(g.pop(0)).toBe(3) // 3 warriors + garrisoned archer not counted
      expect(g.orderRoute(archer, [t.x + 300, t.y + 40, t.x + 360, t.y + 40])).toBe(true)
      expect(archer.inTower).toBe(-1); expect(g.pop(0)).toBe(4)
      stepN(g, 25 * 2)
      expect(archer.hp).toBeLessThan(archer.maxHp); expect(archer.overcap).toBe(true)
    })
  })
})

describe('pawn construction priority', () => {
  it('pulls a busy chopping pawn off its tree to build a tower', () => {
    const g = makeGame({ rows, towns: [[0, 20, 15], [1, 55, 2]], units: [], pawns: true })
    g.kingdoms[0].lumber = 100
    g.world.trees = [{ id: 0, kind: 0, x: 22 * TILE, y: 18 * TILE, cell: 18 * 60 + 22, phase: 0, chopped: false, progress: 0, claimedBy: -1 }]
    stepN(g, 25 * 40)
    expect(g.pawns.some(p => p.state === 'chopping')).toBe(true)
    const t = g.placeTower(0, 24.5 * TILE, 15.5 * TILE)!
    let at = -1
    for (let i = 0; i < 25 * 90 && at < 0; i++) { g.step(1 / 25); if (t.built) at = g.time }
    expect(at).toBeGreaterThan(0)
  })
})
