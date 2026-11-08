import { describe, expect, it } from 'vitest'
import { GAME_CONFIG, Simulation } from './sim'

describe('Borderlands first playable', () => {
  it('scales player towns while keeping exactly three player squads and three AI towns', () => {
    for (const count of [1, 2, 4]) {
      const sim = new Simulation(count)
      expect(sim.towns.filter(t => t.faction === 1)).toHaveLength(count)
      expect(sim.towns.filter(t => t.faction > 1)).toHaveLength(3)
      expect(sim.squads.filter(s => s.faction === 1)).toHaveLength(3)
    }
  })

  it('paths around impassable terrain and only crosses the river at a bridge', () => {
    const sim = new Simulation(1)
    const path = sim.findPath(15, 25, 54, 25)
    expect(path.length).toBeGreaterThan(39)
    for (const i of path) expect(sim.isPassable(i % sim.w, Math.floor(i / sim.w))).toBe(true)
    const riverSteps = path.filter(i => sim.terrain[i] === 4)
    expect(riverSteps.length).toBeGreaterThan(0)
    expect(riverSteps.every(i => [24, 40].includes(Math.floor(i / sim.w)))).toBe(true)
  })

  it('paints and then releases neutral and enemy land', () => {
    const sim = new Simulation(1)
    const squad = sim.squads.find(s => s.faction === 1)!
    const enemyTown = sim.towns.find(t => t.faction === 2)!
    squad.x = enemyTown.x - 4.5; squad.y = enemyTown.y + .5
    sim.recomputeControl()
    const testX = enemyTown.x - 4, testY = enemyTown.y
    const i = testY * sim.w + testX
    expect(sim.claimFaction[i]).toBe(2)
    expect(sim.controller[i]).toBe(1)
    expect(sim.occupation[i]).toBe(1)
    squad.x = 14.5; squad.y = 25.5
    sim.recomputeControl()
    expect(sim.controller[i]).toBe(2)
    expect(sim.occupation[i]).toBe(0)
  })

  it('captures an unopposed town, flips its claim, and keeps it after withdrawal', () => {
    const sim = new Simulation(1)
    const squad = sim.squads.find(s => s.faction === 1)!
    const town = sim.towns.find(t => t.faction === 2)!
    squad.x = town.x + .5; squad.y = town.y + .5
    for (let elapsed = 0; elapsed < GAME_CONFIG.captureDuration + .2; elapsed += .05) sim.update(.05)
    expect(town.faction).toBe(1)
    expect(sim.claimFaction[town.y * sim.w + town.x]).toBe(1)
    squad.x = 14.5; squad.y = 25.5; sim.recomputeControl()
    expect(sim.controller[town.y * sim.w + town.x]).toBe(1)
  })

  it('collides friendly squads without damage and damages opposing squads', () => {
    const sim = new Simulation(1)
    const [a,b] = sim.squads.filter(s => s.faction === 1)
    a.x = b.x = 20; a.y = b.y = 20; sim.update(.1)
    expect(a.hp).toBe(100); expect(b.hp).toBe(100)
    const enemy = sim.squads.find(s => s.faction === 2)!
    enemy.x = a.x; enemy.y = a.y; sim.update(.1)
    expect(a.hp).toBeLessThan(100); expect(enemy.hp).toBeLessThan(100)
  })

  it('builds a cursor-drawn multi-segment route and follows it with steering', () => {
    const sim = new Simulation(1)
    const squad = sim.selectAt(15, 25)!
    expect(sim.beginDrawRoute(20, 25)).toBe(true)
    sim.extendDrawRoute(20, 29)
    expect(sim.commitDrawRoute(25, 29)).toBe(true)
    expect(squad.routeDraft).toBe(false)
    expect(squad.path.length).toBeGreaterThan(12)
    const start = [squad.x, squad.y]
    sim.update(.1)
    expect([squad.x, squad.y]).not.toEqual(start)
    expect(Math.abs(squad.vx) + Math.abs(squad.vy)).toBeGreaterThan(0)
  })

  it('applies cut-off attrition and enlarges the shared bubble of joined cut-off squads', () => {
    const sim = new Simulation(1)
    const [a,b] = sim.squads.filter(s => s.faction === 1)
    a.x=49; a.y=30; b.x=51; b.y=30; a.cutOff=b.cutOff=true
    const hp=a.hp; sim.recomputeControl()
    expect(a.merged).toBeGreaterThan(1)
    expect(b.merged).toBeGreaterThan(1)
    expect(sim.bubbles.filter(v=>v.squadId===a.id||v.squadId===b.id).every(v=>v.joined)).toBe(true)
    a.cutOff=true; sim.update(1)
    expect(a.hp).toBeLessThan(hp)
  })
})
