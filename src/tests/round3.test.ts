import { describe, expect, it } from 'vitest'
import { CARE, HARVEST, TERRITORY, TILE, UNIT, UNIT_BODY } from '../game/config'
import { Game } from '../game/Game'
import type { Tree } from '../game/types'
import { makeWorldFromMask } from '../game/WorldGenerator'
import { makeGame, openRows, stepN } from './helpers'

const rows = openRows(60, 30)
const noAttrition = <T,>(fn: () => T): T => { const a = TERRITORY.attritionPct; TERRITORY.attritionPct = 0; try { return fn() } finally { TERRITORY.attritionPct = a } }
const tree = (id: number, kind: 0 | 1 | 2 | 3, cx: number, cy: number): Tree => ({ id, kind, x: (cx + 0.5) * TILE, y: (cy + 0.7) * TILE, cell: cy * 40 + cx, phase: 0, chopped: false, progress: 0, claimedBy: -1 })

describe('unit tuning', () => {
  it('doubles archer damage and halves troop speeds; lancers are drawn at the same scale as the others', () => {
    expect(UNIT.archer.damage).toBe(16)
    expect(UNIT.warrior.speed).toBe(32); expect(UNIT.archer.speed).toBe(64); expect(UNIT.lancer.speed).toBeGreaterThan(32); expect(UNIT.lancer.speed).toBeLessThan(64)
    expect(UNIT.lancer.scale).toBe(UNIT.warrior.scale)
  })
  it('archers cannot block', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [[0, 8, 15, 'archer'], [0, 9, 15, 'warrior']] })
    const [a, w] = g.units
    g.setBlock(a, true); expect(a.mode).toBe('fight')
    g.selection = { kind: 'units', ids: [a.id, w.id] }
    g.toggleBlockSelection()
    expect(a.mode).toBe('fight'); expect(w.mode).toBe('block')
    expect(g.hud().canBlock).toBe(true)
    g.selection = { kind: 'units', ids: [a.id] }
    expect(g.hud().canBlock).toBe(false)
  })
  it('new units start at 1 HP and recover with normal regeneration, 2.5× faster beside a town (not instantly)', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [] })
    const k = g.kingdoms[0]; k.power = 100; k.produce.warrior = true
    const u = g.tryProduce(k)!
    expect(u.hp).toBe(1)
    stepN(g, 25 * 5)
    expect(u.hp).toBeGreaterThan(5); expect(u.hp).toBeLessThan(u.maxHp * 0.2) // nowhere near full after 5 s
    const gain = u.hp - 1
    expect(gain).toBeGreaterThanOrEqual(u.maxHp * CARE.baseRegenPct * 5 * 0.9) // at least the base rate
    expect(gain).toBeLessThanOrEqual(u.maxHp * CARE.baseRegenPct * CARE.townMult * 5 * 1.1) // at most the town-boosted rate
  })

})

describe('archers and towers', () => {
  it('an archer that finishes a route at a tower climbs in', () => {
    const g = makeGame({ rows, towns: [[0, 20, 15], [1, 55, 2]], units: [[0, 20, 20, 'archer']] })
    g.kingdoms[0].lumber = 100
    const t = g.placeTower(0, 24.5 * TILE, 18.5 * TILE)!; t.built = true
    const a = g.units[0]
    g.applyRoute(a, [t.x, t.y + 40])
    stepN(g, 25 * 40)
    expect(a.inTower).toBe(t.id); expect(t.archer).toBe(a.id)
  })
})

describe('lancer shove and refocus', () => {
  it('glides the target back over several ticks (no teleport), then the pushed warrior re-engages', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 5, 5], [1, 55, 25]], units: [[0, 30, 15, 'lancer'], [1, 30, 15, 'warrior']] })
      const [l, w] = g.units
      w.x = l.x + 20; w.y = l.y
      const xs: number[] = []
      let pushed = false
      for (let i = 0; i < 25 * 6; i++) {
        const before = w.x
        g.step(1 / 25)
        if (w.kbT >= 0 || w.x - before > 3) { pushed = true; xs.push(w.x - before) }
        if (pushed && xs.length > 14) break
      }
      const moving = xs.filter(d => d > 0.5)
      expect(moving.length).toBeGreaterThanOrEqual(3) // smooth glide over multiple ticks
      expect(Math.max(...moving)).toBeLessThan(40) // never a one-tick jump of a whole tile
      expect(moving[0]).toBeGreaterThan(moving[moving.length - 1]) // sharp start, eased finish
      // the shoved warrior turns back toward the lancer instead of standing idle
      while (w.kbT >= 0) g.step(1 / 25)
      const d0 = Math.hypot(w.x - l.x, w.y - l.y)
      stepN(g, 25 * 0.8)
      expect(w.chase).toBe(l.id)
      expect(Math.hypot(w.x - l.x, w.y - l.y)).toBeLessThan(d0 - 10)
    })
  })
})

describe('routes survive combat', () => {
  it('a unit blocked by an enemy fights it, then resumes the assigned route', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [[0, 10, 15], [1, 14, 15]] })
      const [a, e] = g.units
      e.mode = 'block'; e.hp = 60
      g.applyRoute(a, [20 * TILE, a.y])
      a.disengageT = 0
      let sawFight = false
      for (let i = 0; i < 25 * 60; i++) { g.step(1 / 25); if (a.state === 'attacking') { sawFight = true; expect(a.route.length).toBeGreaterThan(0) } }
      expect(sawFight).toBe(true)
      expect(e.hp).toBeLessThanOrEqual(0)
      expect(a.x).toBeGreaterThan(19 * TILE) // continued to the end of the path
    })
  })
  it('a retreating unit is not stopped by enemies behind it', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2]], units: [[0, 20, 15], [1, 21, 15]] })
      const [a, e] = g.units
      e.mode = 'block'
      g.applyRoute(a, [10 * TILE, a.y]); a.disengageT = 0
      stepN(g, 25 * 6)
      expect(a.x).toBeLessThan(20 * TILE) // ran off instead of turning to fight
    })
  })
})

describe('conflict and war tallies', () => {
  it('counts losses and kills per conflict and resets when relations calm down', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2], [2, 30, 4]], units: [[0, 8, 15], [0, 9, 15], [1, 40, 15]], relation: 'conflict' })
    g.killUnit(g.units[0], 1)
    g.killUnit(g.units[2], 0)
    g.killUnit(g.units[1], 1)
    const tab = g.conflictTabs().find(t => t.kind === 'player' && t.id === 1)!
    expect(tab).toMatchObject({ kind: 'player', losses: 2, kills: 1, relation: 'conflict' })
    g.diplomacy.set(0, 1, 'war', g.time)
    expect(g.conflictTabs().find(t => t.kind === 'player' && t.id === 1)).toMatchObject({ relation: 'war', losses: 2 }) // war continues the same tally
    g.diplomacy.set(0, 1, 'neutral', g.time)
    expect(g.diplomacy.casualties(0, 1)).toBe(0)
    expect(g.conflictTabs().some(t => t.kind === 'player' && t.id === 1)).toBe(false)
  })
  it('shows AI-versus-AI conflict tabs immediately and war tabs as they escalate', () => {
    const g = makeGame({ rows, towns: [[0, 5, 15], [1, 55, 2], [2, 30, 4]], units: [[1, 40, 15], [2, 30, 8]], relation: 'neutral' })
    g.diplomacy.set(1, 2, 'conflict', g.time)
    expect(g.conflictTabs()).toHaveLength(1) // the conflict tab appears at once, before any casualties
    expect(g.conflictTabs()[0]).toMatchObject({ kind: 'ai', relation: 'conflict', aLost: 0, bLost: 0 })
    g.killUnit(g.units[0], 2)
    const tabs = g.conflictTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ kind: 'ai', a: 1, b: 2, aLost: 1, bLost: 0 })
    g.diplomacy.set(1, 2, 'war', g.time)
    expect(g.conflictTabs()[0]).toMatchObject({ relation: 'war', aLost: 1 }) // …and turns into a war tab as it escalates
  })
})

describe('pawn harvest modes', () => {
  const mk = (mode: 'none' | 'low' | 'med' | 'high' | 'unlimited', lumber = 0) => {
    const world = makeWorldFromMask(openRows(40, 20))
    world.trees = [tree(0, 2, 12, 8), tree(1, 3, 13, 9), tree(2, 2, 11, 10)]
    const g = new Game({ world, spawns: [{ kingdom: 0, cx: 8, cy: 8 }, { kingdom: 1, cx: 35, cy: 15 }], units: [], plainRelations: true })
    g.aiEnabled = false
    g.kingdoms[0].lumber = lumber; g.kingdoms[0].harvest = mode
    return g
  }
  it('NONE never cuts trees', () => {
    const g = mk('none'); stepN(g, 25 * 150)
    expect(g.world.trees.every(t => !t.chopped && t.progress === 0)).toBe(true)
  })
  it('chops faster on HIGH than MED than LOW', () => {
    const progress = (m: 'low' | 'med' | 'high') => { const g = mk(m); stepN(g, 25 * 40); return g.world.trees.reduce((n, t) => n + t.progress, 0) }
    expect(progress('high')).toBeGreaterThan(progress('med')); expect(progress('med')).toBeGreaterThan(progress('low'))
    expect(HARVEST.low.rate).toBeLessThan(HARVEST.med.rate)
  })
  it('stops extracting above the stock cap (LOW 99, MED 300, HIGH 500) but UNLIMITED never does', () => {
    expect([HARVEST.low.cap, HARVEST.med.cap, HARVEST.high.cap]).toEqual([99, 300, 500])
    for (const [mode, lumber, expectChop] of [['low', 120, false], ['med', 320, false], ['high', 520, false], ['med', 250, true], ['unlimited', 5000, true]] as const) {
      const g = mk(mode, lumber); stepN(g, 25 * 20)
      expect(g.world.trees.some(t => t.progress > 0)).toBe(expectChop)
    }
  })
})

describe('AI building and bridging', () => {
  it('builds border towers, never more than five', () => {
    const g = makeGame({ rows: openRows(60, 30), towns: [[0, 10, 15], [1, 33, 15]], units: [], relation: 'neutral', ai: true })
    g.kingdoms[1].lumber = 2000; g.kingdoms[1].produce = { warrior: false, archer: false, lancer: false, knight: false }
    for (let i = 0; i < 25 * 400; i++) { g.step(1 / 25); g.kingdoms[1].lumber = Math.max(g.kingdoms[1].lumber, 500) }
    const n = g.towers.filter(t => t.faction === 1).length
    expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(5)
    // each tower stands on its own land, facing the neighbour
    for (const t of g.towers.filter(q => q.faction === 1)) expect(t.x).toBeLessThan(33.5 * TILE + 12 * TILE)
  })
  it('turns a fallen-back assault unit into a stationary bridge on friendly ground far from home', () => {
    const g = makeGame({ rows: openRows(60, 30), towns: [[0, 55, 2], [1, 10, 15]], units: [[1, 20, 15], [1, 11, 17], [1, 12, 17], [1, 13, 17]], relation: 'war', ai: true })
    const u = g.units[0]
    expect(g.supplied[u.cell]).toBe(1)
    u.aiRole = 'retreat'
    g.step(1 / 25)
    expect(u.aiRole).toBe('bridge'); expect(u.hold).toBe(true); expect(u.route.length).toBe(0)
  })
  it('does not bridge when the group is too small or the unit is still near home', () => {
    const small = makeGame({ rows: openRows(60, 30), towns: [[0, 55, 2], [1, 10, 15]], units: [[1, 20, 15], [1, 11, 17]], relation: 'war', ai: true })
    small.units[0].aiRole = 'retreat'; small.step(1 / 25)
    expect(small.units[0].aiRole).toBe('')
    const near = makeGame({ rows: openRows(60, 30), towns: [[0, 55, 2], [1, 10, 15]], units: [[1, 12, 15], [1, 11, 17], [1, 12, 17], [1, 13, 17]], relation: 'war', ai: true })
    near.units[0].aiRole = 'retreat'; near.step(1 / 25)
    expect(near.units[0].aiRole).toBe('')
  })
  it('keeps the unit body constants sane', () => { expect(UNIT_BODY.knockbackTime).toBeLessThan(0.4) })
})

describe('archer towers: enter, leave, and territory size', () => {
  const mk = () => {
    const g = makeGame({ rows, towns: [[0, 20, 15], [1, 55, 2]], units: [[0, 20, 20, 'archer']] })
    g.kingdoms[0].lumber = 100
    const t = g.placeTower(0, 24.5 * TILE, 18.5 * TILE)!; t.built = true
    return { g, t, a: g.units[0] }
  }
  it('an archer dragged onto the tower sprite (not just its base) climbs in', () => {
    const { g, t, a } = mk()
    expect(g.orderRoute(a, [a.x + 20, a.y - 20, t.x, t.y - 120])).toBe(true) // drag ends on the tall sprite
    stepN(g, 25 * 40)
    expect(a.inTower).toBe(t.id); expect(g.pop(0)).toBe(0)
  })
  it('an archer can leave its tower on request and does not hop straight back in', () => {
    const { g, t, a } = mk()
    g.applyRoute(a, [t.x, t.y + 40]); stepN(g, 25 * 40)
    expect(a.inTower).toBe(t.id)
    g.selection = { kind: 'units', ids: [a.id] }
    g.exitTower(a)
    expect(a.inTower).toBe(-1); expect(t.archer).toBe(-1); expect(g.pop(0)).toBe(1)
    stepN(g, 25 * 3)
    expect(a.inTower).toBe(-1) // cooldown
    stepN(g, 25 * 6)
    expect(a.inTower).toBe(t.id) // idle beside a free tower again → re-garrisons
    // leaving by drawing a route works too
    expect(g.orderRoute(a, [t.x + 300, t.y + 40, t.x + 360, t.y + 40])).toBe(true)
    expect(a.inTower).toBe(-1)
  })
  it('tracks territory size per kingdom, refreshed only when territory is recomputed', () => {
    const g = makeGame({ rows, towns: [[0, 10, 15], [1, 45, 15]], units: [[0, 28, 15]] })
    const count = (k: number) => { let n = 0; for (const c of g.controller) if (c === k + 1) n++; return n }
    expect(g.tileCounts[0]).toBe(count(0)); expect(g.tileCounts[1]).toBe(count(1))
    const before = g.tileCounts
    stepN(g, 3) // nothing moved: the same array, no recount
    expect(g.tileCounts).toBe(before)
    g.killUnit(g.units[0]); stepN(g, 1)
    expect(g.tileCounts[0]).toBe(count(0))
    expect(g.hud().kingdoms[0].tiles).toBe(count(0))
  })
})
