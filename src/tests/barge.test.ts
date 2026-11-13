import { describe, expect, it } from 'vitest'
import { BARGE, BOAT, TILE } from '../game/config'
import { damageBoat, dockTimeOf, orderSail, spawnBoat } from '../game/BoatSystem'
import { placeYard } from '../game/Yards'
import type { Game } from '../game/Game'
import { makeGame, stepN } from './helpers'

// west island x 0..29 (kingdom 0), 40 tiles of sea, east island x 70..99 (kingdom 1)
const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(40) + '#'.repeat(30))
const px = (c: number) => (c + 0.5) * TILE
const beach = (g: Game) => g.world.w * 20 + 29 // the land cell the ships moor against
const mk = (units: [number, number, number][] = []) => makeGame({ rows, towns: [[0, 20, 20], [1, 80, 20]], units, relation: 'war' })

describe('barge', () => {
  it('costs 100 lumber, carries 12, and is built like any ship along a shipyard coast', () => {
    expect(BARGE.cost).toBe(100); expect(BARGE.cap).toBe(12)
    const g = mk(); placeYard(g, 0, px(29), px(20)); g.kingdoms[0].lumber = 150
    const t = g.placeBoat(0, 'barge', px(31), px(20))!
    expect(t).toBeTruthy(); expect(g.kingdoms[0].lumber).toBe(50)
    const b = spawnBoat(g, 0, 'barge', px(40), px(30))
    expect(b.cap).toBe(12); expect(b.maxHp).toBe(BARGE.hp); expect(dockTimeOf(b)).toBe(6)
  })

  it('takes 30 % damage from land units but full damage from ships', () => {
    const g = mk(), b = spawnBoat(g, 0, 'barge', px(40), px(30))
    damageBoat(g, b, 100, 1)                         // a land unit
    expect(b.maxHp - b.hp).toBeCloseTo(30, 5)
    damageBoat(g, b, 100, 1, true)                   // a ship's gun
    expect(b.maxHp - b.hp).toBeCloseTo(130, 5)
    const inf = spawnBoat(g, 0, 'boat', px(45), px(30)); damageBoat(g, inf, 100, 1)
    expect(inf.maxHp - inf.hp).toBeCloseTo(100, 5)   // an infantry boat has no such armour
  })

  it('moors in 6 s under fire with enemies on the beach, and throws them back when its gate drops; an infantry boat is kept off', () => {
    const units: [number, number, number][] = [[1, 28, 20], [1, 27, 21], [1, 28, 19], [1, 26, 20]]
    const g = mk(units)
    const raider = spawnBoat(g, 1, 'gunship', px(40), px(24)); raider.noDock = true
    const b = spawnBoat(g, 0, 'barge', px(36), px(20))
    raider.strike = { kind: 'boat', id: b.id, x: b.x, y: b.y }
    orderSail(g, b, [px(30), px(20)])
    let at = -1
    for (let i = 0; i < 25 * 40 && at < 0; i++) { g.step(1 / 25); if (b.docked) at = i }
    expect(at).toBeGreaterThan(0)                    // it moored in the end, with a gunship firing at it and troops on the beach
    expect(b.hp).toBeLessThan(b.maxHp)               // (and it was being hit)
    expect(b.dir).toBe('left')                       // the ramp (bow) points at the beach, which lies to the west
    stepN(g, 25)
    g.selection = { kind: 'boats', ids: [b.id] }; g.toggleRamp()   // the gate drops: only now are the defenders thrown back
    stepN(g, 25)
    const gx = (beach(g) % g.world.w + 0.5) * TILE, gy = (Math.floor(beach(g) / g.world.w) + 0.5) * TILE
    for (const u of g.units.filter(q => q.faction === 1 && q.state !== 'dead')) expect(Math.hypot(u.x - gx, u.y - gy)).toBeGreaterThan(5 * TILE)
    // the same landing with an infantry boat: held off by the troops on the beach
    const g2 = mk(units), inf = spawnBoat(g2, 0, 'boat', px(36), px(20))
    orderSail(g2, inf, [px(30), px(20)])
    stepN(g2, 25 * 40)
    expect(inf.docked).toBe(false)
  })

  it('opens its ramp for a player with F (everyone aboard walks off), closes it again, and boards troops only while open', () => {
    const g = mk(); g.kingdoms[0].isPlayer = true
    const b = spawnBoat(g, 0, 'barge', px(36), px(20))
    orderSail(g, b, [px(30), px(20)])
    stepN(g, 25 * 30)
    expect(b.docked).toBe(true); expect(b.open).toBe(false)           // a player's barge docks with the ramp up
    const u = g.spawnUnit(0, px(25), px(20), 'warrior')
    b.cargo.push(u.id); u.inTower = 1e6 + b.id                         // (BOAT_FLAG + id: aboard)
    g.selection = { kind: 'boats', ids: [b.id] }
    g.toggleRamp()
    expect(b.open).toBe(true); expect(b.cargo.length).toBe(0); expect(u.inTower).toBe(-1) // F: the ramp comes down and the troops walk off
    g.toggleRamp()
    expect(b.open).toBe(false)                                         // F again: raised
    const w = g.spawnUnit(0, px(28), px(20), 'warrior'); w.boardBoat = b.id
    stepN(g, 25 * 5)
    expect(b.cargo).not.toContain(w.id)                                // a closed barge takes nobody
    g.toggleRamp()
    g.orderMoveTo(w, b.x, b.y); w.boardBoat = b.id
    stepN(g, 25 * 8)
    expect(b.cargo).toContain(w.id)                                    // with the ramp down they climb aboard
  })

  it('an AI barge drops its ramp the moment it moors, and raises it when it sails off', () => {
    const g = mk(); const b = spawnBoat(g, 1, 'barge', px(36), px(20)); b.noDock = false
    orderSail(g, b, [px(30), px(20)])
    stepN(g, 25 * 30)
    expect(b.docked && b.open).toBe(true)
    orderSail(g, b, [px(45), px(30)])
    expect(b.open).toBe(false)
    void BOAT
  })
})
