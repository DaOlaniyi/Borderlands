import { describe, expect, it } from 'vitest'
import { AGIT, TERRITORY, TILE } from '../game/config'
import { blocsClash } from '../game/AgitationSystem'
import { Game } from '../game/Game'
import { makeGame, openRows, stepN } from './helpers'

const rows = openRows(130, 40)
const quiet = (g: ReturnType<typeof makeGame>) => { for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false } }

describe('allied land is a supply bridge', () => {
  it('a unit that steps from an ally\'s land into free ground stays supplied; without the alliance it is cut off', () => {
    const mk = (relation: 'allied' | 'neutral') => makeGame({ rows, towns: [[0, 20, 20], [1, 100, 5]], units: [[1, 33, 20]], relation })
    const ally = mk('allied'), other = mk('neutral')
    expect(ally.units[0].cutOff).toBe(false)
    stepN(ally, 5); stepN(other, 5)
    expect(ally.units[0].cutOff).toBe(false); expect(ally.supplied[20 * ally.world.w + 33]).toBe(1) // its own 2×2 patch joins the ally's supplied region
    expect(other.units[0].cutOff).toBe(true)
  })
})

describe('softer cut-off', () => {
  const lonely = (n: number) => {
    const units: [number, number, number][] = Array.from({ length: n }, (_, i) => [0, 60 + (i % 3), 20 + Math.floor(i / 3)])
    const g = makeGame({ rows, towns: [[0, 10, 20], [1, 120, 5]], units })
    g.kingdoms[0].produce = { warrior: false, archer: false, lancer: false, knight: false }
    return g
  }
  it('gives a grace period before attrition; every extra unit in the pocket multiplies it by 1.25, clamped to 2x', () => {
    const solo = lonely(1), group = lonely(5)
    stepN(solo, 25 * (TERRITORY.cutGrace - 2)); expect(solo.units[0].hp).toBe(solo.units[0].maxHp)
    const t = 25 * 12
    stepN(solo, t); stepN(group, 25 * (TERRITORY.cutGrace - 2)); stepN(group, t)
    const lossSolo = solo.units[0].maxHp - solo.units[0].hp, lossGroup = group.units[0].maxHp - group.units[0].hp
    expect(lossSolo).toBeGreaterThan(0); expect(lossGroup).toBeGreaterThan(0)
    expect(lossGroup / lossSolo).toBeGreaterThan(1.5) // 5 units in one pocket: 1.25^4 = 2.4, clamped to 2x
    expect(lossGroup / lossSolo).toBeLessThan(2.1)
  })
})

describe('defeat and refuge', () => {
  it('the player is only defeated with no towns AND no units; units may shelter in allied land', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 60, 20], [2, 100, 20]], units: [[0, 30, 20]], relation: 'neutral' })
    g.diplomacy.set(0, 1, 'allied', 0)
    g.captureTown = g.captureTown.bind(g)
    g.towns[0].owner = 2; g.markDirty(); stepN(g, 3)
    expect(g.ownedTowns(0)).toBe(0); expect(g.status).toBe('playing') // units remain
    const u = g.units.find(q => q.faction === 0)!
    u.x = 58.5 * TILE; u.y = 20.5 * TILE; u.cell = g.cellAt(u.x, u.y) // runs into allied territory
    stepN(g, 25 * 40)
    expect(u.cutOff).toBe(false); expect(u.hp).toBe(u.maxHp)
    g.killUnit(u); stepN(g, 3)
    expect(g.status).toBe('defeat')
  })
})

describe('allies defend one another', () => {
  const setup = (enemyAt: number) => {
    const g = makeGame({ rows, towns: [[0, 120, 5], [1, 20, 20], [2, 60, 20], [3, 100, 30]], units: [[1, 22, 20], [1, 23, 21], [1, 22, 22], [1, 24, 20], [3, 58, enemyAt, 'warrior'], [3, 59, enemyAt + 1, 'warrior']], relation: 'war', ai: true })
    g.diplomacy.set(1, 2, 'allied', 0); g.diplomacy.set(0, 1, 'neutral', 0); g.diplomacy.set(0, 2, 'neutral', 0); g.diplomacy.set(0, 3, 'neutral', 0)
    quiet(g); g.time = 100
    return g
  }
  it('spare troops go to a threatened ally', () => {
    const g = setup(20)
    stepN(g, 25 * 6)
    const toward = g.units.filter(u => u.faction === 1 && u.goalX > 40 * TILE && u.goalX < 75 * TILE).length // near the ally's town (the war target lies further east)
    expect(toward).toBeGreaterThanOrEqual(1) // (the war target is too far to march on, so nobody is sent east: the troops mass toward the ally's frontier)
  })
  it('but a kingdom under threat itself defends first', () => {
    const g = setup(20)
    g.units.filter(u => u.faction === 3).forEach((u, i) => { u.x = (24 + i) * TILE; u.y = 22 * TILE; u.cell = g.cellAt(u.x, u.y) }) // enemies at our own gate
    stepN(g, 25 * 6)
    expect(g.units.filter(u => u.faction === 1 && u.goalX > 40 * TILE && u.goalX < 75 * TILE).length).toBe(0)
  })
})

describe('alliances: rules and upkeep', () => {
  it('a player at war with a member cannot ally with that member\'s alliance', () => {
    const g = makeGame({ rows, towns: [[0, 10, 10], [1, 50, 20], [2, 90, 20]], units: [], relation: 'neutral' })
    g.diplomacy.set(1, 2, 'allied', 0); g.diplomacy.set(0, 2, 'war', 0)
    expect(g.allyBlockedReason(1)).toMatch(/fighting/)
    expect(g.proposeAlliance(1)).toBe(false); expect(g.diplomacy.get(0, 1)).toBe('neutral')
    expect(g.hud().kingdoms[1].allyBlocked).not.toBeNull()
    expect(blocsClash(g, 0, 1)).toBe(true)
  })
  it('a wiped-out member leaves the alliance; a two-nation alliance closes, a larger one carries on', () => {
    const g = makeGame({ rows, towns: [[0, 10, 10], [1, 50, 20], [2, 90, 20], [3, 60, 5]], units: [], relation: 'neutral', pawns: false })
    g.diplomacy.set(1, 2, 'allied', 0); g.diplomacy.set(2, 3, 'allied', 0)
    expect(g.diplomacy.bloc(1).sort()).toEqual([1, 2, 3])
    g.towns[2].owner = 0 // kingdom 2... remove its only town
    g.markDirty(); stepN(g, 30)
    expect(g.diplomacy.bloc(1)).toEqual([1]); expect(g.diplomacy.bloc(3)).toEqual([3]) // 2 was the bridge between them
    const h = makeGame({ rows, towns: [[0, 10, 10], [1, 50, 20], [2, 90, 20]], units: [], relation: 'neutral' })
    h.diplomacy.set(1, 2, 'allied', 0); h.towns[1].owner = 0; h.markDirty(); stepN(h, 30)
    expect(h.diplomacy.get(1, 2)).toBe('neutral') // two-member alliance closes
  })
  it('the eye toggle recolours a bloc in its strongest nation\'s colour', () => {
    const g = makeGame({ rows, towns: [[0, 10, 10], [1, 50, 20], [1, 60, 24], [2, 90, 20]], units: [], relation: 'neutral' })
    g.diplomacy.set(1, 2, 'allied', 0)
    expect(g.displayColor(2)).toBe(g.kingdoms[2].color)
    g.toggleBlocColor(2)
    expect(g.displayColor(2)).toBe(g.kingdoms[1].color); expect(g.displayColor(1)).toBe(g.kingdoms[1].color) // kingdom 1 has more towns
    expect(g.hud().kingdoms[2].merged).toBe(true)
    g.toggleBlocColor(1)
    expect(g.displayColor(2)).toBe(g.kingdoms[2].color)
  })
})

describe('pacing of the AI world', () => {
  it('no AI aggression in the opening minutes, however agitated', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20], [2, 45, 20], [3, 70, 20], [3, 80, 24], [4, 100, 20]], units: [], relation: 'neutral' })
    quiet(g)
    for (let i = 0; i < 25 * (AGIT.earlyPeace - 10); i++) { g.step(1 / 25); for (const id of [1, 2, 3, 4]) { g.agit[id] = 100; g.nextReact[id] = 0 } }
    for (let a = 1; a < 5; a++) for (let b = a + 1; b < 5; b++) expect(g.diplomacy.hostile(a, b)).toBe(false)
    expect(g.spills).toHaveLength(0)
  })
  it('opens with at most two AI conflicts, even with many kingdoms', () => {
    for (const seed of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) {
      const g = Game.fromSeed(seed, 8)
      let n = 0
      for (let a = 1; a < 8; a++) for (let b = a + 1; b < 8; b++) if (g.diplomacy.hostile(a, b)) n++
      expect(n).toBeLessThanOrEqual(AGIT.initialConflicts)
    }
  })
})

describe('relation arrows', () => {
  it('draws red / yellow / green arrows from the clicked nation to its enemies, conflicts and allies, between the nearest towns', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20], [1, 28, 24], [2, 60, 20], [3, 90, 20], [4, 110, 30]], units: [], relation: 'neutral' })
    g.diplomacy.set(1, 2, 'war', 0); g.diplomacy.set(1, 3, 'conflict', 0); g.diplomacy.set(1, 4, 'allied', 0)
    g.toggleFocus(1)
    expect(g.hud().kingdoms[1].focused).toBe(true)
    const arrows = g.relationArrows(1)
    expect(arrows.map(a => [a.other, a.kind]).sort()).toEqual([[2, 'war'], [3, 'conflict'], [4, 'allied']])
    const toWar = arrows.find(a => a.other === 2)!
    expect(toWar.from.x).toBeCloseTo(g.towns[2].x) // kingdom 1's nearer town (28,24) to kingdom 2's town
    expect(toWar.to.x).toBeCloseTo(g.towns[3].x)
    g.diplomacy.set(1, 2, 'total', 0)
    expect(g.relationArrows(1).find(a => a.other === 2)!.kind).toBe('war') // total war is also drawn red
    g.toggleFocus(1)
    expect(g.focusKingdom).toBeNull()
  })
})
