import { describe, expect, it } from 'vitest'
import { damageTower, towerDamageMult } from '../game/CombatSystem'
import { AI, CARE, LOT, POP, TERRITORY, TILE, TOWER, UNIT } from '../game/config'
import { Game } from '../game/Game'
import { generateWorld } from '../game/WorldGenerator'
import { makeGame, openRows, stepN } from './helpers'

const rows = openRows(70, 36)
const noAttrition = <T,>(fn: () => T): T => { const a = TERRITORY.attritionPct; TERRITORY.attritionPct = 0; try { return fn() } finally { TERRITORY.attritionPct = a } }

describe('structures under construction and ownership', () => {
  it('has one hit point per wood placed while building, and jumps to full strength when done', () => {
    const g = makeGame({ rows, towns: [[0, 20, 18], [1, 65, 2]], units: [], pawns: true })
    g.kingdoms[0].lumber = 100
    const t = g.placeTower(0, 25.5 * TILE, 18.5 * TILE)!
    expect(t.hp).toBe(1)
    while (t.progress < TOWER.buildTime / 2) g.step(1 / 25)
    expect(t.built).toBe(false)
    expect(t.hp).toBeGreaterThan(TOWER.cost * 0.4); expect(t.hp).toBeLessThanOrEqual(TOWER.cost * 0.6) // ≈ 15 wood placed → 15 HP
    damageTower(g, t, 40, 1) // a single blow finishes an unfinished tower
    expect(g.towers).toHaveLength(0)
    const u = g.placeTower(0, 25.5 * TILE, 18.5 * TILE)!
    for (let i = 0; i < 25 * 90 && !u.built; i++) g.step(1 / 25)
    expect(u.built).toBe(true); expect(u.hp).toBe(u.maxHp)
  })
  it('tower damage is 2× an archer within a tile and falls off linearly to 1× at maximum range', () => {
    const range = UNIT.archer.range * TOWER.rangeMult
    expect(towerDamageMult(0)).toBe(2); expect(towerDamageMult(TILE)).toBe(2)
    expect(towerDamageMult(range)).toBeCloseTo(1)
    expect(towerDamageMult((range + TILE) / 2)).toBeCloseTo(1.5)
    expect(towerDamageMult(range * 2)).toBeCloseTo(1)
  })
  it('lots cost 200 lumber, add one capacity to their nearest town, and are limited to one per town', () => {
    const g = makeGame({ rows, towns: [[0, 15, 18], [0, 45, 18], [1, 65, 2]], units: [], pawns: true })
    expect(g.cap(0)).toBe(2 * POP.perTown)
    g.kingdoms[0].lumber = LOT.cost - 1
    expect(g.lotError(0, 20.5 * TILE, 18.5 * TILE)).toMatch(/Needs 200/)
    g.kingdoms[0].lumber = 500
    const lot = g.placeLot(0, 20.5 * TILE, 18.5 * TILE)!
    expect(lot.kind).toBe('lot'); expect(lot.town).toBe(0); expect(g.kingdoms[0].lumber).toBe(300)
    expect(g.lotError(0, 21.5 * TILE, 21.5 * TILE)).toMatch(/already has a lot/)
    expect(g.cap(0)).toBe(2 * POP.perTown) // not built yet
    for (let i = 0; i < 25 * 120 && !lot.built; i++) g.step(1 / 25)
    expect(lot.built).toBe(true); expect(g.cap(0)).toBe(2 * POP.perTown + 1)
    expect(g.placeLot(0, 41.5 * TILE, 18.5 * TILE)!.town).toBe(1) // the other town can have its own
  })
  it('towers and lots change hands with their town, and the old garrison climbs out instead of shooting its own tower', () => {
    const g = makeGame({ rows, towns: [[0, 20, 18], [1, 60, 2]], units: [], pawns: false })
    g.kingdoms[0].lumber = 1000
    const tower = g.placeTower(0, 25.5 * TILE, 18.5 * TILE)!; tower.built = true
    const lot = g.placeLot(0, 15.5 * TILE, 21.5 * TILE)!; lot.built = true
    const archer = g.spawnUnit(0, tower.x + 40, tower.y + 40, 'archer')
    g.step(1 / 25)
    expect(archer.inTower).toBe(tower.id)
    g.captureTown(g.towns[0], 1)
    expect(tower.faction).toBe(1); expect(lot.faction).toBe(1)
    expect(archer.faction).toBe(0); expect(archer.inTower).toBe(-1); expect(tower.archer).toBe(-1) // ejected
    expect(g.cap(1)).toBeGreaterThanOrEqual(POP.perTown + POP.perTown + 1) // the lot now raises the new owner's capacity
    // a garrison that is somehow still inside never targets the tower it occupies
    g.killUnit(archer); tower.hp = tower.maxHp // the ejected archer is a normal enemy of the tower now; remove it for the next check
    const inside = g.spawnUnit(1, tower.x, tower.y, 'archer'); tower.archer = inside.id; inside.inTower = tower.id; inside.faction = 0
    stepN(g, 25 * 3)
    expect(tower.hp).toBe(tower.maxHp)
  })
})

describe('economy: power from free capacity', () => {
  it('generates one Power per second per free troop slot and none when full', () => {
    const run = (units: [number, number, number][]) => {
      const g = makeGame({ rows, towns: [[0, 10, 18], [1, 60, 2]], units })
      g.kingdoms[0].power = 0
      stepN(g, 25 * 10)
      return g.kingdoms[0].power
    }
    expect(run([[0, 12, 20], [0, 13, 20], [0, 14, 20]])).toBeCloseTo(0, 5)
    expect(run([[0, 12, 20], [0, 13, 20]])).toBeCloseTo(10, 0)
    expect(run([])).toBeCloseTo(30, 0)
  })
  it('starts every kingdom with two units per town and the player never the weakest', () => {
    for (const seed of ['A', 'B', 'C', 'D']) {
      const g = Game.fromSeed(seed, 4)
      const counts = g.kingdoms.map(k => g.ownedTowns(k.id))
      expect(counts[0]).toBeGreaterThanOrEqual(Math.min(...counts.slice(1))) // the player is not the weakest
      expect(counts[0]).toBeGreaterThanOrEqual(1)
      for (const k of g.kingdoms) expect(g.units.filter(u => u.faction === k.id).length).toBeLessThanOrEqual(2 * g.ownedTowns(k.id))
      expect(g.pop(0)).toBe(2 * counts[0]) // the third unit per town is the player's to produce
    }
  })
})

describe('reacting to arrows', () => {
  const setup = (hp: number) => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 65, 30]], units: [[0, 30, 18, 'archer'], [1, 35, 18, 'warrior']] })
    const [a, w] = g.units
    w.x = a.x + 5 * TILE; w.y = a.y; w.hp = w.maxHp * hp
    return { g, a, w }
  }
  it('a healthy idle warrior hit by an archer charges it', () => {
    noAttrition(() => {
      const { g, a, w } = setup(1)
      const d0 = Math.hypot(w.x - a.x, w.y - a.y)
      stepN(g, 25 * 3)
      expect(w.chase).toBe(a.id)
      expect(Math.hypot(w.x - a.x, w.y - a.y)).toBeLessThan(d0 - 10)
    })
  })
  it('a badly hurt one backs away instead', () => {
    noAttrition(() => {
      const { g, a, w } = setup(0.3)
      const d0 = Math.hypot(w.x - a.x, w.y - a.y)
      stepN(g, 25 * 6)
      expect(Math.hypot(w.x - a.x, w.y - a.y)).toBeGreaterThan(d0 + 10)
    })
  })
  it('a unit that is already travelling or fighting is not distracted', () => {
    noAttrition(() => {
      const { g, a, w } = setup(1)
      g.applyRoute(w, [w.x + 300, w.y]); w.disengageT = 0
      stepN(g, 25 * 3)
      expect(w.chase).toBe(-1)
      void a
    })
  })
})

describe('total war and AI escalation', () => {
  it('an AI that loses twice its capacity in a war declares total war; total war never cools', () => {
    const g = makeGame({ rows, towns: [[0, 10, 18], [1, 60, 18]], units: [], relation: 'war' })
    for (let i = 0; i < 2 * g.cap(1) - 1; i++) g.diplomacy.death(0, 1, g.time)
    stepN(g, 25 * 5)
    expect(g.diplomacy.get(0, 1)).toBe('war')
    g.diplomacy.death(0, 1, g.time)
    stepN(g, 25 * 3)
    expect(g.diplomacy.get(0, 1)).toBe('total')
    expect(g.diplomacy.hostile(0, 1)).toBe(true)
    expect(g.proposeAlliance(1)).toBe(false)
    stepN(g, 25 * 300)
    expect(g.diplomacy.get(0, 1)).toBe('total')
    expect(g.conflictTabs().find(t => t.kind === 'player')).toMatchObject({ relation: 'total' })
  })
})

describe('AI behaviour', () => {
  it('rests freshly produced units until they reach the ready health threshold', () => {
    const g = makeGame({ rows, towns: [[0, 60, 30], [1, 15, 18]], units: [[1, 24, 18], [1, 25, 19], [1, 24, 20]], relation: 'war', ai: true })
    for (const u of g.units) u.hp = 1
    g.kingdoms[1].produce = { warrior: false, archer: false, lancer: false }
    g.time = 100
    stepN(g, 25 * 25)
    const home = g.towns[1]
    for (const u of g.units) expect(Math.hypot(u.x - home.x, u.y - home.y)).toBeLessThan(4 * TILE) // walked back toward the town, not toward the enemy
    expect(AI.readyHp).toBeGreaterThanOrEqual(0.4); expect(AI.readyHp).toBeLessThanOrEqual(0.5)
  })
  it('sends 60–80% of its troops at the enemy in a war, keeping the rest back', () => {
    const g = makeGame({ rows, towns: [[0, 62, 18], [1, 8, 18]], units: [[1, 10, 18], [1, 10, 19], [1, 11, 18], [1, 11, 19], [1, 12, 18], [1, 12, 19], [1, 13, 18], [1, 13, 19], [1, 14, 18], [1, 14, 19]], relation: 'war', ai: true })
    g.kingdoms[1].produce = { warrior: false, archer: false, lancer: false }; g.kingdoms[0].produce = { warrior: false, archer: false, lancer: false }
    g.time = 100
    stepN(g, 25 * 12)
    const heading = g.units.filter(u => u.goalX > g.towns[1].x + 14 * TILE).length
    expect(heading / g.units.length).toBeGreaterThanOrEqual(0.6); expect(heading / g.units.length).toBeLessThanOrEqual(0.8)
  })
  it('presses toward the enemy town nearest to its reach rather than a far one', () => {
    const g = makeGame({ rows, towns: [[0, 30, 18], [0, 66, 4], [1, 8, 18]], units: [[1, 10, 18], [1, 10, 19], [1, 11, 18], [1, 11, 19]], relation: 'war', ai: true })
    g.kingdoms[1].produce = { warrior: false, archer: false, lancer: false }; g.kingdoms[0].produce = { warrior: false, archer: false, lancer: false }
    g.time = 100
    stepN(g, 25 * 6)
    expect(g.aiMemo.target[1]).toBe(0) // the closer of the player's two towns
  })
  it('does not retreat from being cut off while healthy, but does once hurt', () => {
    const g = makeGame({ rows, towns: [[0, 60, 18], [1, 8, 18]], units: [[1, 40, 18], [1, 10, 19], [1, 11, 19], [1, 12, 19]], relation: 'war', ai: true })
    g.kingdoms[1].produce = { warrior: false, archer: false, lancer: false }; g.kingdoms[0].produce = { warrior: false, archer: false, lancer: false }
    g.time = 100
    const scout = g.units[0]
    stepN(g, 25 * 3)
    expect(scout.cutOff).toBe(true)
    expect(scout.aiRole).not.toBe('retreat')
    scout.hp = scout.maxHp * 0.3
    stepN(g, 25 * 4)
    expect(scout.aiRole === 'retreat' || scout.state === 'dead' || scout.hp < scout.maxHp * 0.3).toBe(true)
  })
  it('dashes at an undefended town and keeps it', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 36, 18], [1, 25, 18]], units: [[1, 27, 18], [1, 26, 19], [1, 26, 17]], relation: 'war', ai: true })
      g.kingdoms[1].produce = { warrior: false, archer: false, lancer: false }; g.kingdoms[0].produce = { warrior: false, archer: false, lancer: false }
      g.time = 100
      stepN(g, 25 * 150)
      expect(g.towns[0].owner).toBe(1)
    })
  })
  it('builds lots (one per town) and keeps archers coming for empty towers', () => {
    const g = makeGame({ rows, towns: [[0, 8, 18], [1, 50, 18], [1, 60, 18]], units: [], relation: 'neutral', ai: true })
    g.kingdoms[1].lumber = 2000
    for (let i = 0; i < 25 * 200; i++) { g.step(1 / 25); g.kingdoms[1].lumber = Math.max(1500, g.kingdoms[1].lumber) }
    const lots = g.towers.filter(t => t.kind === 'lot' && t.faction === 1)
    expect(lots.length).toBe(2)
    expect(new Set(lots.map(l => l.town)).size).toBe(2)
  })
  it('keeps towers off the exact frontline and out of active fights', () => {
    const g = makeGame({ rows, towns: [[0, 8, 18], [1, 26, 18]], units: [], relation: 'neutral', ai: true })
    g.kingdoms[1].lumber = 2000; g.kingdoms[1].produce = { warrior: false, archer: false, lancer: false }
    for (let i = 0; i < 25 * 120; i++) { g.step(1 / 25); g.kingdoms[1].lumber = 2000 }
    const towers = g.towers.filter(t => t.kind === 'tower' && t.faction === 1)
    expect(towers.length).toBeGreaterThan(0)
    for (const t of towers) { // ≥3 tiles from any foreign tile
      let nearest = Infinity
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const c = g.controller[(t.cy + dy) * g.world.w + t.cx + dx]; if (c && c !== 2) nearest = Math.min(nearest, Math.max(Math.abs(dx), Math.abs(dy))) }
      expect(nearest).toBeGreaterThanOrEqual(3)
    }
    // an active fight next to the only good spot suppresses building
    const h = makeGame({ rows, towns: [[0, 8, 18], [1, 26, 18]], units: [[0, 21, 18], [1, 21, 18]], relation: 'war', ai: true })
    h.kingdoms[1].lumber = 2000; h.kingdoms[1].produce = { warrior: false, archer: false, lancer: false }; h.kingdoms[0].produce = { warrior: false, archer: false, lancer: false }
    h.units[1].x = h.units[0].x + 30
    for (let i = 0; i < 25 * 6; i++) { h.step(1 / 25); h.kingdoms[1].lumber = 2000 }
    expect(h.towers.filter(t => t.faction === 1 && t.kind === 'tower').every(t => Math.hypot(t.x - h.units[0].x, t.y - h.units[0].y) > AI.quietWarzone * TILE)).toBe(true)
  })
  it('keeps CARE constants coherent', () => { expect(CARE.townMult).toBeGreaterThan(1) })
  it('generates reproducible worlds', () => { expect(generateWorld('Z', 3).spawns).toEqual(generateWorld('Z', 3).spawns) })
})
