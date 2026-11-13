import { describe, expect, it } from 'vitest'
import { Game } from '../game/Game'
import { restoreGame, serializeGame } from '../game/SaveLoad'
import { SIM_DT } from '../game/config'

const run = (g: Game, secs: number) => { for (let i = 0; i < Math.round(secs / SIM_DT); i++) g.step(SIM_DT) }
const params = { seed: 'SAVETEST', color: 0 }
const fresh = () => Game.fromSeed(params.seed, 0, undefined, { archipelago: true, playerColor: 0 })

/** The first place two serialized states differ (a path like fields.units[3].hp), or null. */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return `${path}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length && !Array.isArray(a)) { const miss = ka.find(k => !(k in b)) ?? kb.find(k => !(k in a)); return `${path}: keys differ at ${miss}` }
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return `${path}: length ${a.length} vs ${(b as unknown[]).length}`
  for (const k of ka) { const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`); if (d) return d }
  return null
}
const diff = (x: string, y: string) => firstDiff(JSON.parse(x), JSON.parse(y))

describe('save and load', () => {
  it('a restored game is indistinguishable from the original, now and as it keeps running', () => {
    const a = fresh()
    run(a, 240) // the AI trains, chops, builds
    const json = serializeGame(a)
    const b = restoreGame(params, json)
    expect(diff(serializeGame(b), json)).toBeNull()
    run(a, 90); run(b, 90)
    expect(diff(serializeGame(b), serializeGame(a))).toBeNull()
  }, 120000)
})
