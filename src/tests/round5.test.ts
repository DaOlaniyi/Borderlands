import { describe, expect, it } from 'vitest'
import { AI, REL, TERRITORY, TILE, TOWER } from '../game/config'
import { makeGame, openRows, stepN } from './helpers'

const rows = openRows(80, 36)
const noAttrition = <T,>(fn: () => T): T => { const a = TERRITORY.attritionPct; TERRITORY.attritionPct = 0; try { return fn() } finally { TERRITORY.attritionPct = a } }
const noProd = (g: ReturnType<typeof makeGame>) => { for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false } }

describe('border violation warning and countdown', () => {
  const mk = () => makeGame({ rows, towns: [[0, 5, 5], [1, 40, 18]], units: [], relation: 'neutral' })
  it('starts a conflict at once when the trespass is within 5 tiles of a town', () => {
    const g = mk()
    const u = g.spawnUnit(0, 40.5 * TILE + 4 * TILE, 18.5 * TILE, 'warrior')
    stepN(g, 6)
    expect(g.diplomacy.get(0, 1)).toBe('conflict')
    void u
  })
  it('gives a few seconds of warning, with a countdown, farther out — and a retreat cancels it', () => {
    const g = mk()
    const u = g.spawnUnit(0, 31.5 * TILE, 18.5 * TILE, 'warrior') // ~9 tiles from the town, still in its land
    stepN(g, 6)
    expect(g.diplomacy.get(0, 1)).toBe('neutral')
    const w = g.hud().warnings
    expect(w).toHaveLength(1); expect(w[0].immediate).toBe(false)
    expect(w[0].secs).toBeLessThanOrEqual(REL.warnSeconds); expect(w[0].secs).toBeGreaterThan(0)
    const s1 = w[0].secs
    stepN(g, 25 * 1.5)
    expect(g.hud().warnings[0].secs).toBeLessThan(s1) // counts down
    u.x = 12.5 * TILE; u.cell = g.cellAt(u.x, u.y) // withdraw into neutral ground before time runs out
    stepN(g, 25 * 8)
    expect(g.diplomacy.get(0, 1)).toBe('neutral'); expect(g.hud().warnings).toHaveLength(0)
    // staying put long enough starts the conflict
    const v = g.spawnUnit(0, 31.5 * TILE, 18.5 * TILE, 'warrior')
    stepN(g, 25 * (REL.warnSeconds + 1.5))
    expect(g.diplomacy.get(0, 1)).toBe('conflict')
    void v
  })
  it('does not trigger for allies, or when merely standing on neutral ground', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 40, 18]], units: [], relation: 'allied' })
    g.spawnUnit(0, 41.5 * TILE, 18.5 * TILE, 'warrior'); stepN(g, 25 * 10)
    expect(g.diplomacy.get(0, 1)).toBe('allied')
    const h = mk(); h.spawnUnit(0, 20.5 * TILE, 18.5 * TILE, 'warrior'); stepN(h, 25 * 10)
    expect(h.diplomacy.get(0, 1)).toBe('neutral')
  })
})

describe('conflict is not invasion', () => {
  const setup = (relation: 'conflict' | 'war') => {
    const g = makeGame({ rows, towns: [[0, 62, 18], [1, 14, 18]], units: [[1, 16, 18], [1, 16, 19], [1, 17, 18], [1, 17, 19], [1, 18, 18], [1, 18, 19]], relation, ai: true })
    noProd(g); g.time = 100
    return g
  }
  it('AI in a mere conflict stays home; AI at war marches on the enemy town', () => {
    const conflict = setup('conflict'); stepN(conflict, 25 * 60)
    const nearest = (g: typeof conflict) => Math.min(...g.units.filter(u => u.faction === 1).map(u => Math.abs(u.x - g.towns[0].x)))
    expect(nearest(conflict)).toBeGreaterThan(25 * TILE)
    expect(conflict.aiMemo.target[1] ?? -1).toBe(-1) // no invasion target is ever chosen
    const war = setup('war'); stepN(war, 25 * 60)
    expect(nearest(war)).toBeLessThan(nearest(conflict) - 6 * TILE)
  })
  it('retaliates when one of its units is attacked', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 60, 30], [1, 14, 18]], units: [[1, 16, 18], [1, 16, 20], [1, 18, 18], [1, 18, 20], [0, 30, 10, 'archer']], relation: 'conflict', ai: true })
      noProd(g); g.time = 100
      const victim = g.units[0], archer = g.units[4]
      archer.x = victim.x + 5 * TILE; archer.y = victim.y - 3 * TILE // in the open, 6 tiles away
      const others = g.units.filter(u => u.faction === 1 && u !== victim)
      const d0 = others.map(u => Math.hypot(u.x - archer.x, u.y - archer.y))
      stepN(g, 25 * 12)
      expect(g.aiMemo.grievance[1]?.some(e => e.kind === 'attack')).toBe(true)
      const d1 = others.map(u => Math.hypot(u.x - archer.x, u.y - archer.y))
      expect(Math.min(...d1)).toBeLessThan(Math.min(...d0) - 2 * TILE) // some troops went to answer
    })
  })
  it('sends troops to retrieve territory that was taken', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 60, 30], [1, 14, 18]], units: [[1, 12, 22], [1, 13, 22], [1, 12, 23], [1, 13, 23], [0, 40, 18]], relation: 'conflict', ai: true })
      noProd(g); g.time = 100
      const raider = g.units[4]
      raider.x = 20.5 * TILE; raider.y = 18.5 * TILE; raider.cell = g.cellAt(raider.x, raider.y); raider.mode = 'block'; g.markDirty()
      stepN(g, 2)
      expect(g.aiMemo.grievance[1]?.some(e => e.kind === 'land')).toBe(true)
      const before = g.units.filter(u => u.faction === 1).map(u => Math.hypot(u.x - raider.x, u.y - raider.y))
      stepN(g, 25 * 15)
      const after = g.units.filter(u => u.faction === 1).map(u => Math.hypot(u.x - raider.x, u.y - raider.y))
      expect(Math.min(...after)).toBeLessThan(Math.min(...before) - 2 * TILE)
    })
  })
  it('declares war when a town is taken during a conflict', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 40, 18]], units: [], relation: 'conflict' })
    g.captureTown(g.towns[1], 0)
    expect(g.diplomacy.get(0, 1)).toBe('war')
    stepN(g, 1)
    expect(g.log.some(l => /WAR/i.test(l.text))).toBe(true)
  })
})

describe('archer towers only fight nations in conflict or war', () => {
  const shots = (relation: 'neutral' | 'allied' | 'conflict' | 'war' | 'total') => noAttrition(() => {
    const g = makeGame({ rows, towns: [[0, 20, 18], [1, 70, 3]], units: [], relation })
    g.kingdoms[0].lumber = 100
    const t = g.placeTower(0, 28.5 * TILE, 18.5 * TILE)!; t.built = true
    const a = g.spawnUnit(0, t.x + 40, t.y + 40, 'archer'); g.step(1 / 25)
    const foe = g.spawnUnit(1, t.x + 6 * TILE, t.y, 'warrior'); foe.mode = 'block'
    const lowest = (() => { let m = foe.hp; for (let i = 0; i < 25 * 6; i++) { g.step(1 / 25); m = Math.min(m, foe.hp) } return m })()
    expect(a.inTower).toBe(t.id)
    return lowest < foe.maxHp
  })
  it('ignores neutral and allied units, shoots conflict, war and total-war enemies', () => {
    expect(shots('neutral')).toBe(false); expect(shots('allied')).toBe(false)
    expect(shots('conflict')).toBe(true); expect(shots('war')).toBe(true); expect(shots('total')).toBe(true)
    expect(TOWER.rangeMult).toBe(2); expect(AI.grievanceWindow).toBeGreaterThan(0)
  })
})
