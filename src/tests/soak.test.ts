import { describe, expect, it } from 'vitest'
import { Game } from '../game/Game'

describe('long-run soak (AI, relations, economy keep working without errors)', () => {
  it('simulates 12 minutes of a 5-kingdom match', () => {
    const g = Game.fromSeed('SOAK', 5)
    const t0 = performance.now()
    for (let i = 0; i < 25 * 60 * 12; i++) g.step(1 / 25)
    const ms = performance.now() - t0
    const rel: string[] = []
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) rel.push(`${a}-${b}:${g.diplomacy.get(a, b)}`)
    console.log(`SOAK ${(ms / 18000).toFixed(3)}ms/step towns ${g.kingdoms.map(k => g.ownedTowns(k.id)).join('/')} units ${g.kingdoms.map(k => g.pop(k.id)).join('/')} ${rel.join(' ')} log: ${g.log.slice(-4).map(l => l.text).join(' | ')}`)
    expect(g.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.hp))).toBe(true)
    expect(g.units.every(u => u.state === 'dead' || u.inTower >= 0 || g.isLandAt(u.x, u.y))).toBe(true)
  }, 60000)
})
