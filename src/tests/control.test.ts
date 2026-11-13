import { describe, expect, it } from 'vitest'
import { TILE, UNIT } from '../game/config'
import { spawnBoat } from '../game/BoatSystem'
import type { Game } from '../game/Game'
import { makeGame, stepN } from './helpers'

const rows = Array.from({ length: 40 }, () => '#'.repeat(80))
const px = (c: number) => (c + 0.5) * TILE
/** A built, garrisoned archer tower of `faction` at tile (cx, cy). */
function tower(g: Game, faction: number, cx: number, cy: number) {
  const t = { id: g.allocId(), kind: 'tower' as const, town: 0, faction, cx, cy, x: px(cx), y: px(cy), hp: 2000, maxHp: 2000, progress: 0, built: true, builder: -1, archer: -1 }
  g.towers.push(t)
  const a = g.spawnUnit(faction, t.x, t.y, 'archer'); t.archer = a.id; a.inTower = t.id; a.state = 'idle'
  return t
}

describe('the player decides', () => {
  // tower 7 tiles from the warrior: well inside the garrison's reach, well outside the warrior's
  const setup = (unitFaction: number, towerFaction: number) => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 70, 35]], units: [[unitFaction, 33, 20, 'warrior']], relation: 'war' })
    tower(g, towerFaction, 40, 20)
    const w = g.units.find(u => u.faction === unitFaction && u.type === 'warrior')!
    w.hp = w.maxHp
    return { g, w, x0: w.x, y0: w.y }
  }

  it('an idle unit of the player that is shot by a tower stays where it was put (it does not charge the tower or run away)', () => {
    const { g, w, x0, y0 } = setup(0, 1)
    stepN(g, 25 * 12)
    expect(w.hp).toBeLessThan(w.maxHp)                                  // (it really is being shot)
    expect(Math.hypot(w.x - x0, w.y - y0)).toBeLessThan(TILE * 0.5)
    expect(w.route.length).toBe(0)
  })

  it('...while an AI unit in the same spot still reacts (walks at the tower, or runs when badly hurt)', () => {
    const { g, w, x0, y0 } = setup(1, 0)
    stepN(g, 25 * 12)
    expect(Math.hypot(w.x - x0, w.y - y0)).toBeGreaterThan(TILE * 1.5)
  })

  it('a player unit shot by an archer does not give chase', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 70, 35]], units: [[0, 33, 20, 'warrior'], [1, 42, 20, 'archer']], relation: 'war' })
    const w = g.units.find(u => u.faction === 0)!, x0 = w.x
    stepN(g, 25 * 6)
    expect(w.chase).toBe(-1)
    expect(Math.abs(w.x - x0)).toBeLessThan(TILE * 0.5)
  })

  it('a player unit shelled by a ship does not pull back or turn into an ambusher', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 70, 35]], units: [[0, 33, 20, 'warrior']], relation: 'war' })
    const w = g.units[0], boat = spawnBoat(g, 1, 'zumwalt', px(55), px(20))
    const x0 = w.x
    g.shelled(w, boat.id, boat.x, boat.y)
    expect(w.evadeBoat).toBe(-1); expect(w.route.length).toBe(0)
    stepN(g, 25)
    expect(w.x).toBe(x0)
  })

  it('a player unit that is shoved by a lancer does not drop its orders to chase it', () => {
    const g = makeGame({ rows, towns: [[0, 5, 5], [1, 70, 35]], units: [[0, 33, 20, 'warrior'], [1, 34, 20, 'lancer']], relation: 'war' })
    const w = g.units.find(u => u.faction === 0)!
    g.orderMoveTo(w, px(10), px(20))
    stepN(g, 25 * 3)
    expect(w.x).toBeLessThan(px(33))                                    // it keeps walking home
    expect(w.refocusT).toBeLessThanOrEqual(0)
    void UNIT
  })
})
