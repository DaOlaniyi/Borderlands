import { describe, expect, it } from 'vitest'
import { Game } from '../game/Game'
import { serializeGame, restoreGame } from '../game/SaveLoad'

/** Wipes out the player (kingdom 0): every town, unit and pawn. */
function defeat(g: Game) {
  for (const u of g.units.filter(q => q.faction === 0)) { u.hp = 0; g.killUnit(u, 1) }
  g.pawns = g.pawns.filter(p => p.faction !== 0)
  for (const t of g.towns.filter(q => q.owner === 0)) t.owner = 1
  g.markDirty(); g.recomputeTerritory()
  for (let i = 0; i < 5; i++) g.step(1 / 25)
}

describe('spectating after defeat', () => {
  it('a defeated player can keep watching: the map is revealed and the AI nations play on', () => {
    const g = Game.fromSeed('SPEC1', 0, 3, { archipelago: true, playerColor: 0 })
    expect(g.fog.some(v => v !== 0)).toBe(true) // (there is fog while playing)
    g.startSpectating(); expect(g.spectating).toBe(false) // (not before the defeat)
    defeat(g)
    expect(g.status).toBe('defeat')
    g.startSpectating()
    expect(g.spectating).toBe(true)
    expect(g.fog.every(v => v === 0)).toBe(true)
    const before = g.units.filter(u => u.faction !== 0).map(u => `${Math.round(u.x)},${Math.round(u.y)}`).join('|')
    for (let i = 0; i < 25 * 60; i++) g.step(1 / 25)
    expect(g.status).toBe('defeat') // (still defeated: it is a view, not a second life)
    expect(g.fog.every(v => v === 0)).toBe(true)
    expect(g.units.filter(u => u.faction !== 0).map(u => `${Math.round(u.x)},${Math.round(u.y)}`).join('|')).not.toBe(before) // the AI keeps moving
    expect(g.units.every(u => Number.isFinite(u.x))).toBe(true)
  }, 120000)

  it('a spectator who saves and loads is still spectating, with no fog', () => {
    const g = Game.fromSeed('SPEC2', 0, 3, { archipelago: true, playerColor: 0 })
    defeat(g); g.startSpectating()
    const h = restoreGame({ seed: 'SPEC2', color: 0, playerTowns: 3 }, serializeGame(g))
    expect(h.spectating).toBe(true); expect(h.status).toBe('defeat'); expect(h.fog.every(v => v === 0)).toBe(true)
  }, 120000)
})
