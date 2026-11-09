import { describe, expect, it } from 'vitest'
import { PAWN, TILE } from '../game/config'
import { Game } from '../game/Game'
import { treeSpec } from '../game/PawnSystem'
import type { Tree } from '../game/types'
import { generateWorld, makeWorldFromMask } from '../game/WorldGenerator'
import { makeGame, openRows, stepN } from './helpers'

const tree = (id: number, kind: 0 | 1 | 2 | 3, cx: number, cy: number): Tree => ({ id, kind, x: (cx + 0.5) * TILE, y: (cy + 0.7) * TILE, cell: cy * 40 + cx, phase: 0, chopped: false, progress: 0, claimedBy: -1 })

const withTrees = (trees: Tree[], towns: [number, number, number][] = [[0, 8, 8]]) => {
  const world = makeWorldFromMask(openRows(40, 20))
  world.trees = trees
  const g = new Game({ world, spawns: towns.map(([kingdom, cx, cy]) => ({ kingdom, cx, cy })), units: [], plainRelations: true })
  for (const k of g.kingdoms) k.lumber = 0
  for (const a of g.kingdoms) for (const b of g.kingdoms) if (a.id < b.id) g.diplomacy.set(a.id, b.id, 'war', 0)
  return g
}

describe('towns', () => {
  it('only battle units capture towns, immediately and once, and the pawn follows', () => {
    const g = makeGame({ rows: openRows(40, 20), towns: [[0, 8, 8], [1, 30, 8]], pawns: true })
    const town = g.towns[0], pawn = g.pawns.find(p => p.id === town.pawnIds[0])!
    expect(g.pawns.filter(p => p.faction === 0).length).toBe(2 * g.ownedTowns(0))
    // an enemy pawn standing on the town does nothing
    const enemyPawn = g.pawns.find(p => p.faction === 1)!
    enemyPawn.x = town.x; enemyPawn.y = town.y
    stepN(g, 3)
    expect(town.owner).toBe(0)
    // an enemy warrior touching the capture bounds captures on the very first step
    const v0 = g.territoryVersion
    g.spawnWarrior(1, town.x + 30, town.y)
    stepN(g, 1)
    expect(town.owner).toBe(1)
    expect(g.territoryVersion).toBeGreaterThan(v0)
    expect(pawn.faction).toBe(1)
    stepN(g, 1) // the unit is still in contact, but nothing is captured again
    expect(town.owner).toBe(1)
    expect(g.pawns.filter(p => p.faction === 1).length).toBe(2 * g.ownedTowns(1))
    expect(g.pawns.filter(p => p.faction === 0).length).toBe(2 * g.ownedTowns(0))
    expect(town.pawnIds.every(id => g.pawnById(id)!.faction === 1)).toBe(true)
    expect(g.ownedTowns(0)).toBe(0); expect(g.kingdoms[0].alive).toBe(false); expect(g.status).toBe('defeat')
  })
})

describe('pawns and lumber', () => {
  it('uses configured cutting times and yields', () => {
    const mk = (k: 0 | 1 | 2 | 3) => treeSpec(tree(0, k, 1, 1))
    expect(mk(0)).toEqual({ time: 150, yield: 20 }); expect(mk(1)).toEqual({ time: 150, yield: 20 })
    expect(mk(2)).toEqual({ time: 60, yield: 10 }); expect(mk(3)).toEqual({ time: 60, yield: 10 })
    expect(PAWN.conifer.time).toBe(150)
  })

  for (const [kind, time, lumber] of [[0, 150, 20], [2, 60, 10]] as const) {
    it(`tree kind ${kind} takes ${time}s, yields ${lumber}, pays out only on delivery and leaves a stump`, () => {
      const g = withTrees([tree(0, kind, 12, 8)])
      expect(g.pawns).toHaveLength(2) // two pawns per town
      let choppedAt = -1, depositAt = -1, lumberAtChop = -1
      for (let i = 0; i < 25 * 400 && depositAt < 0; i++) {
        g.step(1 / 25)
        if (choppedAt < 0 && g.world.trees[0].chopped) { choppedAt = g.time; lumberAtChop = g.kingdoms[0].lumber }
        if (g.kingdoms[0].lumber > 0) depositAt = g.time
        for (const pawn of g.pawns) expect(g.controller[pawn.cell]).toBe(1) // never leaves friendly territory
      }
      expect(choppedAt).toBeGreaterThanOrEqual(time)
      expect(lumberAtChop).toBe(0) // carried, not yet banked
      expect(depositAt).toBeGreaterThan(choppedAt)
      expect(g.kingdoms[0].lumber).toBe(lumber)
      expect(g.world.trees[0].chopped).toBe(true) // permanent stump
      stepN(g, 25 * 30)
      expect(g.world.trees[0].chopped).toBe(true); expect(g.kingdoms[0].lumber).toBe(lumber)
    })
  }

  it('pawns stay inside friendly territory while wandering and seeking trees', () => {
    const { world, spawns } = generateWorld('PAWN-WALK', 3)
    const g = new Game({ world, spawns, units: [] })
    for (let i = 0; i < 25 * 90; i++) {
      g.step(1 / 25)
      for (const p of g.pawns) expect(g.controller[g.cellAt(p.x, p.y)]).toBe(p.faction + 1)
    }
  })

  it('a returning pawn replans when its destination town changes owner', () => {
    const g = withTrees([], [[0, 8, 10], [0, 31, 10], [1, 20, 17]])
    const home = g.towns[1], far = g.towns[0]
    const p = g.pawns.find(q => q.id === home.pawnIds[0])!
    p.x = home.x - 40; p.y = home.y; p.cell = g.cellAt(p.x, p.y)
    p.carry = 10; p.state = 'return-to-town'; p.destTown = far.id; p.route = []
    g.captureTown(far, 1)
    stepN(g, 2)
    expect(p.destTown).toBe(home.id)
    stepN(g, 200)
    expect(g.kingdoms[0].lumber).toBe(10)
  })

  it('an order given while carrying delivers the load before harvesting the new tree', () => {
    const g = withTrees([tree(0, 2, 11, 8), tree(1, 3, 14, 9)])
    const p = g.pawns[0]
    p.carry = 10; p.state = 'return-to-town'; p.destTown = 0
    expect(g.orderPawn(p, 1)).toBe(true)
    expect(p.pendingTree).toBe(1)
    stepN(g, 25 * 60)
    expect(g.kingdoms[0].lumber).toBe(10)
    expect(p.tree === 1 || g.world.trees[1].claimedBy === p.id || (p.state as string) === 'chopping').toBe(true)
  })
})
