import { describe, expect, it } from 'vitest'
import { TILE } from '../game/config'
import { spawnBoat } from '../game/BoatSystem'
import { makeGame, stepN } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
const sea = Array.from({ length: 50 }, (_, y) => (y < 2 || y >= 48 ? '.'.repeat(120) : '#'.repeat(40) + '.'.repeat(30) + '#'.repeat(50)))

function setup() {
  const g = makeGame({ rows: sea, towns: [[0, 30, 25], [1, 100, 25]], units: [], pawns: true })
  const town = g.towns[0]
  g.kingdoms[0].lumber = 500
  const boat = spawnBoat(g, 0, 'cargo', px(41), px(25))
  stepN(g, 25)
  return { g, town, boat }
}

describe('pawns and cargo boats', () => {
  it('a boat order is served by the pawns on their own, before other jobs', () => {
    const { g, boat } = setup()
    expect(boat.docked).toBe(true)
    boat.want.lumber = 40
    stepN(g, 25 * 60)
    expect(boat.load.lumber).toBeGreaterThanOrEqual(39)
  })

  it('a selected pawn sent to a cargo boat serves it at once, dropping its task', () => {
    const { g, boat } = setup()
    const p = g.pawns.find(q => q.faction === 0)!
    boat.want.lumber = 20
    for (const q of g.pawns) if (q !== p) { q.haulBoat = -1 }
    g.selection = { kind: 'pawn', id: p.id }
    expect(g.pawnTargetAt(boat.x, boat.y)).toEqual({ kind: 'boat', id: boat.id })
    p.state = 'chopping'                                     // busy: the player's order drops it at once
    expect(g.orderPawnTarget(p, { kind: 'boat', id: boat.id })).toBe(true)
    expect(p.state).toBe('wander')
    expect(p.haulBoat).toBe(boat.id)
    stepN(g, 25 * 40)
    expect(boat.load.lumber).toBeGreaterThan(0)
  })

  it('a walking pawn drops its trip at once for a picked boat; an undocked boat is refused', () => {
    const { g, boat } = setup()
    const p = g.pawns.find(q => q.faction === 0)!
    p.state = 'travel-to-tree'
    expect(g.orderPawnTarget(p, { kind: 'boat', id: boat.id })).toBe(true)
    expect(p.state).toBe('wander')
    boat.docked = false
    expect(g.orderPawnTarget(p, { kind: 'boat', id: boat.id })).toBe(false)
  })

  it('a picked gold stone is taken over from a pawn that was only walking to it, and refused when someone is mining it', () => {
    const g = makeGame({ rows: sea, towns: [[0, 25, 25], [1, 100, 25]], units: [], pawns: true })
    g.goldDeps.length = 0
    g.goldDeps.push({ id: 0, stone: 5, x: px(30), y: px(25), cell: g.cellAt(px(30), px(25)), amount: 24, progress: 0, claimedBy: -1, jackpot: false, taken: false, cycleT: 150 })
    stepN(g, 100)
    const walker = g.pawns.find(q => q.job === -2)!
    expect(walker).toBeTruthy()                                  // the auto-harvesting pawn has claimed it
    const mine = g.pawns.find(q => q !== walker && q.faction === 0)!
    expect(g.orderPawnTarget(mine, { kind: 'gold', id: 0 })).toBe(true)
    stepN(g, 25 * 20)
    expect(mine.state === 'mining' || mine.state === 'travel-to-gold').toBe(true)
    expect(g.goldDeps[0].claimedBy).toBe(mine.id)
    const other = g.pawns.find(q => q !== mine && q.faction === 0)!
    if (mine.state === 'mining') expect(g.orderPawnTarget(other, { kind: 'gold', id: 0 })).toBe(false)
  })

  it('a claim whose pawn is gone is cleared', () => {
    const g = makeGame({ rows: sea, towns: [[0, 25, 25], [1, 100, 25]], units: [], pawns: true })
    g.goldDeps.length = 0
    g.goldDeps.push({ id: 0, stone: 5, x: px(30), y: px(25), cell: g.cellAt(px(30), px(25)), amount: 24, progress: 0, claimedBy: 9999, jackpot: false, taken: false, cycleT: 150 })
    stepN(g, 60)
    expect(g.goldDeps[0].claimedBy).not.toBe(9999)
  })

  it('pawns of a village load gold onto a cargo boat moored beyond the village territory', async () => {
    const { TILE: T } = await import('../game/config')
    const { placeSettlement } = await import('../game/Economy')
    const { orderSail, undock } = await import('../game/BoatSystem')
    const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(20) + '.'.repeat(10) + '#'.repeat(30))
    const q = (c: number) => (c + 0.5) * T
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 85, 20]], units: [], pawns: true })
    g.kingdoms[0].lumber = 400
    const c0 = spawnBoat(g, 0, 'cargo', q(31), q(10)); undock(g, c0); c0.x = c0.px = q(39); c0.y = c0.py = q(20)
    orderSail(g, c0, [q(39), q(20)]); stepN(g, 25 * 8)
    g.spawnUnit(0, q(41), q(20)); stepN(g, 3)
    const s = placeSettlement(g, 0, q(45), q(20))!
    s.store!.gold = 8
    const b = spawnBoat(g, 0, 'cargo', q(60), q(20)); undock(g, b); b.x = b.px = q(60); b.y = b.py = q(20)
    orderSail(g, b, [q(59), q(20)]); stepN(g, 25 * 10)
    expect(b.docked).toBe(true)
    b.want.gold = 4
    stepN(g, 25 * 120)
    expect(b.load.gold).toBeGreaterThanOrEqual(4)
  }, 60000)
})
