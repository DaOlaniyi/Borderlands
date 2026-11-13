import { describe, expect, it } from 'vitest'
import { makeGame, stepN } from './helpers'

const land = Array.from({ length: 60 }, () => '#'.repeat(120))

describe('rallying against a giant', () => {
  it('announces "lay down arms" once and keeps the truce even when allies are at war with each other', () => {
    const towns: [number, number, number][] = []
    for (let i = 0; i < 9; i++) towns.push([0, 10 + i * 4, 5])
    towns.push([1, 20, 40], [2, 60, 40], [3, 100, 40])
    const g = makeGame({ rows: land, towns, units: [], relation: 'neutral' })
    g.time = 100
    g.diplomacy.set(1, 3, 'allied', 0)      // Valmere (1) allied with Cardhaven (3), who is at war with Frostmere (2)
    g.diplomacy.set(3, 2, 'war', 0)
    g.diplomacy.set(1, 2, 'war', 0)
    g.diplomacy.events.length = 0
    const count = () => g.log.filter(e => /lay down arms/.test(e.text)).length
    stepN(g, 25 * 10)
    const first = count()
    expect(first).toBeLessThanOrEqual(3)                   // at most once per pair of nations
    stepN(g, 25 * 60)
    expect(count()).toBe(first)                            // ...and never again
    expect(g.diplomacy.hostile(1, 2)).toBe(false)
  })
})

describe('truces', () => {
  it('a truce stops border incidents and joined wars from reopening a feud, then expires', () => {
    const g = makeGame({ rows: land, towns: [[0, 10, 5], [1, 20, 40], [2, 60, 40]], units: [], relation: 'neutral' })
    g.diplomacy.setTruce(1, 2, 50)
    g.diplomacy.set(1, 2, 'conflict', 10)
    g.diplomacy.set(1, 2, 'war', 10)
    expect(g.diplomacy.get(1, 2)).toBe('neutral')
    g.diplomacy.set(1, 2, 'war', 60)
    expect(g.diplomacy.get(1, 2)).toBe('war')
  })
})
