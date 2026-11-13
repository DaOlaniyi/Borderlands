import { describe, expect, it } from 'vitest'
import { AGIT, TERRITORY, TILE, UNIT } from '../game/config'
import { balanceOfPower } from '../game/AgitationSystem'
import { InputController } from '../game/InputController'
import type { Camera } from '../game/Camera'
import { makeGame, openRows, stepN } from './helpers'

const rows = openRows(130, 40)
const noAttrition = <T,>(fn: () => T): T => { const a = TERRITORY.attritionPct; TERRITORY.attritionPct = 0; try { return fn() } finally { TERRITORY.attritionPct = a } }
const quiet = (g: ReturnType<typeof makeGame>) => { for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false } }
// kingdom 0 = player; 1 and 2 will fight; 3 is near them; 4 is far away
const world = () => makeGame({ rows, towns: [[0, 5, 5], [1, 10, 20], [2, 30, 20], [3, 45, 20], [4, 120, 35]], units: [], relation: 'neutral' })

describe('agitation', () => {
  it('rises slowly from a foreign war: ≈25 % after 5 minutes nearby, ≈15 % far away; the player has none', () => {
    const g = world(); g.diplomacy.set(1, 2, 'war', 0)
    stepN(g, 25 * 300)
    expect(g.agit[3]).toBeGreaterThan(21); expect(g.agit[3]).toBeLessThan(29)
    expect(g.agit[4]).toBeGreaterThan(12); expect(g.agit[4]).toBeLessThan(18)
    expect(g.hud().kingdoms[0].agitation).toBeNull(); expect(g.hud().kingdoms[3].agitation).toBeGreaterThan(20)
  })
  it('a fallen town spikes nearby nations by ~25 % at once, everyone else by at least 10 %', () => {
    const g = world(); g.diplomacy.set(1, 2, 'war', 0)
    g.captureTown(g.towns[2], 1) // kingdom 2's town (15 tiles from kingdom 3, ~90 from kingdom 4)
    expect(g.agit[3]).toBeGreaterThan(22); expect(g.agit[3]).toBeLessThanOrEqual(25)
    expect(g.agit[4]).toBeGreaterThanOrEqual(10); expect(g.agit[4]).toBeLessThan(11)
    expect(g.agit[1]).toBeLessThan(AGIT.underAttackFloor + 1) // the combatants themselves are not "spooked"
    expect(g.agitFocus[3]).not.toBeNull()
  })
  it('goes on alert above 35 % and stands down below 30 %', () => {
    const g = world(); quiet(g)
    g.agit[3] = 36; stepN(g, 10); expect(g.ready[3]).toBe(true)
    g.agit[3] = 32; stepN(g, 10); expect(g.ready[3]).toBe(true) // hysteresis
    g.agit[3] = 20; stepN(g, 10); expect(g.ready[3]).toBe(false)
  })
  it('raises the AI tower cap from 3 to 5 while on alert', () => {
    const run = (alert: boolean) => {
      const g = makeGame({ rows, towns: [[0, 5, 5], [1, 40, 20], [2, 60, 20]], units: [], relation: 'neutral', ai: true })
      for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
      for (let i = 0; i < 25 * 600; i++) { g.step(1 / 25); g.kingdoms[1].lumber = 2000; if (alert) g.agit[1] = 45 }
      return g.towers.filter(t => t.faction === 1 && t.kind === 'tower').length
    }
    const calm = run(false), nervous = run(true)
    expect(calm).toBeLessThanOrEqual(AGIT.normalTowers); expect(nervous).toBeLessThanOrEqual(AGIT.readyTowers)
    expect(nervous).toBeGreaterThanOrEqual(calm)
  })
})

describe('balance of power', () => {
  it('flags a nation with more towns than all others combined, and pushes everyone to 100 % agitation', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20], [1, 30, 20], [1, 40, 20], [1, 50, 20], [2, 80, 20], [3, 110, 20]], units: [], relation: 'neutral' })
    const b = balanceOfPower(g)
    expect(b.dominant).toBe(true); expect(b.leader!.members).toEqual([1])
    stepN(g, 10)
    expect(g.agit[2]).toBe(100); expect(g.agit[3]).toBe(100)
  })
  it('counts an allied bloc as one nation, and 40 %+ of all towns counts as tipped', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20], [1, 30, 20], [2, 80, 20], [3, 110, 20], [3, 120, 22]], units: [], relation: 'neutral' })
    expect(balanceOfPower(g).tipped).toBe(false) // 2 of 6 towns
    g.diplomacy.set(1, 2, 'allied', 0)
    const b = balanceOfPower(g)
    expect(b.tipped).toBe(true); expect(b.leader!.members.sort()).toEqual([1, 2]); expect(b.dominant).toBe(false)
  })
})

describe('reactions, alliances and blocs', () => {
  it('an agitated nation with a smaller neighbour (and no tipping) attacks it, announcing a spillover', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 10, 20], [2, 30, 20], [2, 40, 24], [3, 60, 20], [3, 70, 24], [4, 110, 20], [4, 120, 24]], units: [], relation: 'neutral' })
    quiet(g)
    g.kingdoms[2].aggression = 1; g.kingdoms[2].temperament = 'imperialist'; g.nextReact[2] = 0
    for (let i = 0; i < 4; i++) g.spawnUnit(2, 30 * 64 + i * 40, 21 * 64) // (an imperialist needs some troops, not lots or towers)
    for (let i = 0; i < 25 * 900 && !g.diplomacy.hostile(2, 1) && !g.diplomacy.hostile(2, 3); i++) { g.step(1 / 25); g.agit[2] = 100; g.agit[1] = 0; g.agit[3] = 0 }
    const prey = [1, 3].find(o => g.diplomacy.hostile(2, o))
    expect(prey).toBeDefined()
    expect(g.diplomacy.get(2, prey!)).toBe('war')
    expect(g.spills.some(s => /SPILLOVER : .* DECLARES WAR ON/.test(s.text))).toBe(true)
    expect(g.hud().spills.length).toBeGreaterThan(0)
  })
  it('never preys on a bigger nation; with the island tipping it proposes an alliance against the leader instead', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20], [1, 30, 24], [1, 40, 20], [2, 70, 20], [2, 80, 24], [3, 100, 20]], units: [], relation: 'neutral' })
    quiet(g)
    g.agit[2] = 100; g.agit[3] = 100; g.nextReact[2] = 0; g.nextReact[3] = 0
    for (let i = 0; i < 25 * 900 && g.diplomacy.get(2, 3) !== 'allied'; i++) { g.step(1 / 25); g.agit[2] = 100; g.agit[3] = 100 }
    expect(g.diplomacy.get(2, 3)).toBe('allied')
    expect(g.diplomacy.get(2, 1)).toBe('war'); expect(g.diplomacy.get(3, 1)).toBe('war') // the bloc declares war on the leader at once
    // once the leader is destroyed the bloc breaks apart
    for (const t of g.towns.filter(q => q.owner === 1)) t.owner = 2
    g.kingdoms[1].alive = false
    stepN(g, 30)
    expect(g.diplomacy.get(2, 3)).not.toBe('allied') // the bloc is gone (kingdom 2 now holds most towns, so 3 turns on it as the new existential threat)
  })
  it('allies join each other\'s wars, and the player can break an alliance', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20], [2, 50, 20], [3, 90, 20]], units: [], relation: 'neutral' })
    g.diplomacy.set(1, 2, 'allied', 0); g.diplomacy.set(2, 3, 'war', 0)
    stepN(g, 50)
    expect(g.diplomacy.get(1, 3)).toBe('war')
    g.diplomacy.set(0, 2, 'allied', 0)
    expect(g.hud().kingdoms[0].allies).toContain(2)
    g.breakAlliance(2)
    expect(g.diplomacy.get(0, 2)).toBe('neutral')
  })
  it('a nation under attack accepts alliance proposals; early in the game others rarely do', () => {
    let accepted = 0
    for (let i = 0; i < 100; i++) { const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20]], units: [], relation: 'neutral' }); g.rng = { ...g.rng, next: (() => { let x = i * 0.0131 + 0.001; return () => ((x += 0.6180339) % 1) })() }; if (g.proposeAlliance(1)) accepted++ }
    expect(accepted).toBeLessThan(25)
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 20, 20], [2, 60, 20]], units: [], relation: 'neutral' })
    g.diplomacy.set(1, 2, 'war', 0)
    expect(g.proposeAlliance(1)).toBe(true)
  })
  it('allied troops can stand in an ally\'s land without deforming it or suffering cut-off damage', () => {
    noAttrition(() => {})
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units: [[1, 22, 20]], relation: 'allied' })
    const u = g.units[0]
    expect(g.controller[20 * g.world.w + 22]).toBe(1) // still the ally's tile
    stepN(g, 25 * 20)
    expect(u.cutOff).toBe(false); expect(u.hp).toBe(u.maxHp)
    expect(g.controller[20 * g.world.w + 22]).toBe(1)
    expect(g.diplomacy.get(0, 1)).toBe('allied') // no border violation either
  })
})

describe('AI unit behaviour', () => {
  it('free archer: an AI tower comes with an archer that fills it without counting toward the cap', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 40, 20]], units: [], relation: 'neutral', pawns: true })
    g.aiEnabled = false; quiet(g)
    g.kingdoms[1].lumber = 100
    const t = g.placeTower(1, 46.5 * TILE, 20.5 * TILE)!
    for (let i = 0; i < 25 * 90 && !t.built; i++) g.step(1 / 25)
    expect(t.built).toBe(true)
    const a = g.units.find(u => u.faction === 1 && u.type === 'archer')!
    expect(a).toBeDefined(); expect(a.free).toBe(true); expect(g.pop(1)).toBe(0)
    for (let i = 0; i < 25 * 40 && t.archer < 0; i++) g.step(1 / 25)
    expect(t.archer).toBe(a.id); expect(a.free).toBe(false); expect(g.pop(1)).toBe(0) // garrisoned archers never count
  })
  it('AI favours warriors and lancers when producing troops', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 40, 20], [1, 50, 22], [1, 60, 20]], units: [], relation: 'neutral', ai: true })
    const k = g.kingdoms[1]; k.power = 1e6; k.produce = { warrior: true, archer: true, lancer: true, knight: true }
    const counts = { warrior: 0, archer: 0, lancer: 0, knight: 0 }
    for (let i = 0; i < 300; i++) { const u = g.tryProduce(k); if (u) { counts[u.type]++; g.killUnit(u); g.step(1 / 25) } }
    expect(counts.warrior + counts.lancer).toBeGreaterThan(counts.archer * 2)
    expect(counts.archer).toBeGreaterThan(0)
  })
  it('makes a last stand: a badly hurt unit overwhelmed near its town blocks in front of it and stands down when the enemy withdraws', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 90, 20], [1, 20, 20]], units: [[1, 22, 20], [0, 26, 20], [0, 26, 21], [0, 27, 20]], relation: 'war', ai: true })
      quiet(g)
      const hero = g.units[0]; hero.hp = hero.maxHp * 0.12
      for (const e of g.units.slice(1)) e.mode = 'block' // keep the attackers parked where they are
      g.time = 100; stepN(g, 25 * 8)
      expect(hero.aiRole).toBe('laststand'); expect(hero.mode).toBe('block')
      for (const e of g.units.slice(1)) { e.x += 20 * TILE; e.cell = g.cellAt(e.x, e.y) } // the enemy withdraws
      stepN(g, 25 * 8)
      expect(hero.aiRole).toBe('')
    })
  })
})

describe('user control', () => {
  const setup = () => {
    const g = makeGame({ rows, towns: [[0, 5, 20], [1, 120, 5]], units: [[0, 8, 20], [0, 9, 22], [0, 20, 20]] })
    const cam: Camera = { x: 0, y: 1000, zoom: 1 }
    const input = new InputController(g, cam, () => ({ w: 1400, h: 800 }))
    const s = (u: { x: number; y: number }) => ({ x: (u.x - cam.x) * cam.zoom, y: (u.y - 14 - cam.y) * cam.zoom })
    return { g, cam, input, s }
  }
  it('S stops the selected units and cancels an order that is still being drawn', () => {
    const { g, input, s } = setup()
    const u = g.units[0], p = s(u)
    input.down(p.x, p.y); input.move(p.x + 30, p.y); input.move(p.x + 120, p.y)
    expect(input.draft).not.toBeNull()
    input.stop()
    expect(input.draft).toBeNull()
    input.up(p.x + 200, p.y) // releasing the button must not issue the cancelled route
    expect(u.route.length).toBe(0)
    g.applyRoute(u, [u.x + 400, u.y]); g.selection = { kind: 'units', ids: [u.id] }
    stepN(g, 10); input.stop()
    expect(u.route.length).toBe(0); expect(u.state).toBe('idle')
  })
  it('a user route outranks instincts: a routed unit is not pulled into chasing or fleeing', () => {
    noAttrition(() => {
      const g = makeGame({ rows, towns: [[0, 5, 20], [1, 120, 5]], units: [[0, 30, 20], [1, 33, 20, 'lancer']] })
      const [a, l] = g.units
      g.applyRoute(a, [a.x - 600, a.y]); a.disengageT = 0
      l.mode = 'block'
      stepN(g, 25 * 6)
      expect(a.chase).toBe(-1)
      expect(a.x).toBeLessThan(30.5 * TILE) // kept walking away along its route
    })
  })
  it('C brush mode paints a selection over several units, and a route then moves them all', () => {
    const { g, input, s } = setup()
    expect(input.toggleBrush()).toBe(true)
    const [a, b, c] = g.units
    const pa = s(a)
    input.down(pa.x, pa.y); input.move(pa.x + 1, pa.y); input.move(s(b).x, s(b).y); input.up(s(b).x, s(b).y)
    expect(g.selection).toEqual({ kind: 'units', ids: [a.id, b.id] })
    expect(g.selection?.kind === 'units' && g.selection.ids.includes(c.id)).toBe(false)
    expect(input.toggleBrush()).toBe(false)
    input.down(pa.x, pa.y); input.move(pa.x + 40, pa.y); input.move(pa.x + 300, pa.y); input.up(pa.x + 400, pa.y)
    expect(a.route.length).toBeGreaterThan(0); expect(b.route.length).toBeGreaterThan(0); expect(c.route.length).toBe(0)
  })
  it('range rings and archer stats stay sane', () => { expect(UNIT.archer.range).toBe(6 * TILE) })
})
