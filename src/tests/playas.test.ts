import { describe, expect, it } from 'vitest'
import { Game } from '../game/Game'

const townsOf = (g: Game, k: number) => g.towns.filter(t => t.owner === k && t.kind !== 'settlement').map(t => `${t.cx},${t.cy}`).sort()
const unitsOf = (g: Game, k: number) => g.units.filter(u => u.faction === k).map(u => `${u.type}@${Math.round(u.x / 64)},${Math.round(u.y / 64)}`).sort()

describe('play as another nation', () => {
  const base = Game.fromSeed('PLAYAS1', 0, 3, { archipelago: true, playerColor: 0 })
  const p = 5
  const as = Game.fromSeed('PLAYAS1', 0, 3, { archipelago: true, playerColor: 0, playAs: p })

  it('the world is the same and the player starts exactly where that nation started, as that nation', () => {
    expect(as.world.land.length === base.world.land.length && as.world.land.every((v, i) => v === base.world.land[i])).toBe(true)
    expect(townsOf(as, 0)).toEqual(townsOf(base, p))              // the player's towns are the nation's original towns
    expect(unitsOf(as, 0).length).toBeGreaterThan(0)
    expect(as.kingdoms[0].isPlayer).toBe(true)
    expect(as.kingdoms[0].name).toBe(base.kingdoms[p].name)        // and its identity goes with it
    expect(as.kingdoms[0].color).toBe(base.kingdoms[p].color)
    expect(as.kingdoms[0].emblem).toBe(base.kingdoms[p].emblem)
  })

  it('the original player\'s start goes to the AI, with the original player\'s identity', () => {
    expect(townsOf(as, p)).toEqual(townsOf(base, 0))
    expect(as.kingdoms[p].isPlayer).toBe(false)
    expect(as.kingdoms[p].name).toBe(base.kingdoms[0].name)
    expect(as.kingdoms[p].color).toBe(base.kingdoms[0].color)
    for (const k of [1, 2, 3, 4, 6, 7]) expect(townsOf(as, k)).toEqual(townsOf(base, k)) // everybody else is where they were
  })

  it('a nation\'s card shows its army by type, and the total matches the population', () => {
    const c = as.kingdomCard(3)!
    expect(c.units).toBe(as.pop(3))
    expect(c.army.warrior + c.army.archer + c.army.lancer + c.army.knight).toBe(c.units)
    expect(c.towns).toBe(as.ownedTowns(3)); expect(c.name).toBe(as.kingdoms[3].name)
    expect(as.kingdomCard(999)).toBeNull()
  })
})
