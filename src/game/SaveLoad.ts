import { Game } from './Game'
import { ensureStats } from './Stats'

/**
 * Saving a match: the world is regenerated from its seed on load (it never changes apart from the trees), then every field of the Game
 * is laid over it. The state is plain data (arrays, objects, Maps, Sets, typed arrays), so it round-trips through JSON with a small
 * replacer/reviver for the non-JSON types.
 */
export const SAVE_VERSION = 1
export type SaveParams = { seed: string; color: number; kingdoms?: number; playerTowns?: number; lumber?: number }

/** Game fields that are derived (rebuilt on load) or hold functions / generators. */
const SKIP = new Set(['world', 'info', 'unitHash', 'unitMap', 'ux', 'uy', 'rng', 'rngE', 'sounds', 'fx', 'projectiles', 'simMs', 'territoryMs'])

const toB64 = (a: ArrayBufferView) => {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }
const ARRAYS = { U8: Uint8Array, I32: Int32Array, F32: Float32Array, U16: Uint16Array, I16: Int16Array, I8: Int8Array, F64: Float64Array } as const
const tagOf = (v: ArrayBufferView) => (Object.keys(ARRAYS) as (keyof typeof ARRAYS)[]).find(k => v instanceof ARRAYS[k])

function replacer(_k: string, v: unknown): unknown {
  if (v instanceof Map) return { $t: 'Map', v: [...v.entries()] }
  if (v instanceof Set) return { $t: 'Set', v: [...v.values()] }
  if (ArrayBuffer.isView(v)) { const tag = tagOf(v); if (tag) return { $t: tag, v: toB64(v) } }
  if (typeof v === 'number' && !Number.isFinite(v)) return { $t: 'num', v: String(v) }
  return v
}
function reviver(_k: string, v: unknown): unknown {
  if (v && typeof v === 'object' && '$t' in v) {
    const o = v as { $t: string; v: unknown }
    if (o.$t === 'Map') return new Map(o.v as [unknown, unknown][])
    if (o.$t === 'Set') return new Set(o.v as unknown[])
    if (o.$t === 'num') return Number(o.v)
    if (o.$t in ARRAYS) { const u = fromB64(o.v as string), C = ARRAYS[o.$t as keyof typeof ARRAYS]; return new C(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer) }
  }
  return v
}

export function serializeGame(g: Game): string {
  const fields: Record<string, unknown> = {}
  for (const key of Object.keys(g)) { const v = (g as unknown as Record<string, unknown>)[key]; if (!SKIP.has(key) && typeof v !== 'function') fields[key] = v }
  const trees: number[][] = [] // only the trees that differ from a fresh forest
  g.world.trees.forEach((t, i) => { if (t.chopped || t.progress > 0 || t.claimedBy >= 0) trees.push([i, t.chopped ? 1 : 0, t.progress, t.claimedBy, t.regrowAt ?? -1]) })
  return JSON.stringify({ v: SAVE_VERSION, rng: g.rng.state(), rngE: g.rngE.state(), trees, fields }, replacer)
}

export function restoreGame(params: SaveParams, json: string): Game {
  const data = JSON.parse(json, reviver) as { v: number; rng: number; rngE: number; trees: number[][]; fields: Record<string, unknown> }
  if (data.v !== SAVE_VERSION) throw new Error(`This save was made by a different version of the game (v${data.v}).`)
  const g = Game.fromSeed(params.seed, params.kingdoms ?? 0, params.playerTowns, { archipelago: true, playerColor: params.color, startLumber: params.lumber })
  const target = g as unknown as Record<string, unknown>
  for (const [key, val] of Object.entries(data.fields)) {
    if (key === 'diplomacy') Object.assign(g.diplomacy, val)
    else target[key] = val
  }
  for (const [i, chopped, progress, claimedBy, regrowAt] of data.trees) {
    const t = g.world.trees[i]; if (!t) continue
    t.chopped = chopped === 1; t.progress = progress; t.claimedBy = claimedBy; t.regrowAt = regrowAt >= 0 ? regrowAt : undefined
  }
  g.rng.setState(data.rng); g.rngE.setState(data.rngE)
  target.unitMap = new Map(g.units.map(u => [u.id, u]))
  g.sounds = []; g.fx = []; g.projectiles = []
  ensureStats(g.stats)
  for (const b of g.boats) b.open ??= false
  for (const k of g.kingdoms) { k.produce.knight ??= k.isPlayer ? false : true; k.weights.knight ??= k.isPlayer ? 1 : 1.2 } // (saves from before the knight)
  g.refreshHash()
  return g
}
