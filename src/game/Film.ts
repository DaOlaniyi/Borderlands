import { SIM_DT } from './config'
import type { Game } from './Game'

/**
 * The film: a literal replay. While the player plays, the game keeps (1) a full snapshot of its state every `KEY_EVERY` seconds ("keyframes", the same data a save
 * holds) and (2) a log of every command the player gave (the method called on the game, with its arguments, and the tick it was given on). To watch it back, a second
 * game is restored from a keyframe and the REAL simulation is run forward with the logged commands applied at the same ticks: the AI, the combat and the economy
 * are deterministic, so the replay unfolds exactly as it did, drawn by the real renderer (units, art, territory, fog).
 */
export const KEY_EVERY = 30 // game seconds between keyframes
export type FilmInput = { tick: number; m: string; a: unknown[] }
export type FilmKey = { t: number; tick: number; data: string | Uint8Array }
export type FilmParams = { seed: string; color: number; kingdoms?: number; playerTowns?: number; lumber?: number; dynamic?: boolean; playAs?: number }
export type Film = { v: 1; params: FilmParams; keys: FilmKey[]; inputs: FilmInput[]; endT?: number }

const SKIP_CALLS = /^(pick|selected|inspected|get|is|can|has|hud|advance|step|title|label|pop|cap|ownedTowns|ownedSettlements|structureError|outpostError|priceOf|nearestTown|pawnTargetAt|relationArrows|warnings|conflictTabs|boatHud|townHud|structureHud|say|unitById|boatById|towerById|pawnById|cellAt|refreshHash|recompute|markDirty|allocId|nextSeq|spawn|constructor|toJSON|updateFog|ownedStock|stockOf)/
const LOGGED_SETS = new Set(['selection', 'placing', 'strikeMode', 'routePick'])
const MAX_INPUTS = 60000

const isRef = (a: unknown): a is { id: number } => !!a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'number' && ('hp' in (a as object) || 'owner' in (a as object) || 'faction' in (a as object))
const toArg = (a: unknown): unknown => {
  if (isRef(a)) return { $ref: a.id, town: 'owner' in a && 'cx' in a }
  if (Array.isArray(a)) return a.map(toArg)
  if (a && typeof a === 'object') { try { return JSON.parse(JSON.stringify(a)) } catch { return null } }
  return a
}
const fromArg = (g: Game, a: unknown): unknown => {
  if (a && typeof a === 'object' && '$ref' in (a as object)) {
    const r = a as { $ref: number; town: boolean }
    return r.town ? g.towns[r.$ref] : (g.unitById(r.$ref) ?? g.boatById(r.$ref) ?? g.towerById(r.$ref) ?? g.pawnById(r.$ref) ?? null)
  }
  if (Array.isArray(a)) return a.map(x => fromArg(g, x))
  return a
}

/**
 * A view of the game for the player's interface: every command it issues is logged (when `film` is recording) and then passed through. The renderer and the
 * simulation use the plain game, so nothing pays for the proxy except the occasional click.
 */
export function recordInputs(game: Game): Game {
  return new Proxy(game, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target)
      if (typeof v !== 'function' || typeof prop !== 'string' || SKIP_CALLS.test(prop)) return typeof v === 'function' ? v.bind(target) : v
      return (...args: unknown[]) => {
        const rec = target.rec
        if (rec.film && rec.film.inputs.length < MAX_INPUTS) rec.film.inputs.push({ tick: target.tickCount, m: prop, a: args.map(toArg) })
        return (v as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
    set(target, prop, value) {
      if (typeof prop === 'string' && LOGGED_SETS.has(prop)) { const rec = target.rec; if (rec.film && rec.film.inputs.length < MAX_INPUTS) rec.film.inputs.push({ tick: target.tickCount, m: '$set:' + prop, a: [toArg(value)] }) }
      ;(target as unknown as Record<string, unknown>)[prop as string] = value
      return true
    },
  })
}

/** Apply one logged command to the replay game. */
export function applyInput(g: Game, inp: FilmInput) {
  try {
    if (inp.m.startsWith('$set:')) { (g as unknown as Record<string, unknown>)[inp.m.slice(5)] = fromArg(g, inp.a[0]); return }
    const fn = (g as unknown as Record<string, unknown>)[inp.m]
    if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown).apply(g, inp.a.map(a => fromArg(g, a)))
  } catch { /* a command that no longer applies (its target is gone) is simply skipped */ }
}

/** Run the replay game `steps` ticks, giving each logged command on its tick. `cursor.i` is the next command to give. */
export function stepFilm(g: Game, film: Film, cursor: { i: number }, steps: number) {
  for (let n = 0; n < steps; n++) {
    while (cursor.i < film.inputs.length && film.inputs[cursor.i].tick <= g.tickCount) applyInput(g, film.inputs[cursor.i++])
    g.step(SIM_DT)
  }
}
/** Index of the first command not yet given at `tick`. */
export const inputCursor = (film: Film, tick: number) => { let lo = 0, hi = film.inputs.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (film.inputs[mid].tick < tick) lo = mid + 1; else hi = mid } return lo }
/** The keyframe a seek to `t` starts from: the last one at or before it. */
export const keyBefore = (film: Film, t: number): FilmKey | null => { let best: FilmKey | null = null; for (const k of film.keys) if (k.t <= t + 0.001) best = k; return best ?? film.keys[0] ?? null }

// ---------------------------------------------------------------- compression and packing (keyframes are gzip-compressed as they are taken)
export async function gz(text: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(text)
  if (typeof CompressionStream === 'undefined') return raw
  return new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}
export async function gunz(bytes: Uint8Array): Promise<string> {
  const packed = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  if (!packed || typeof DecompressionStream === 'undefined') return new TextDecoder().decode(bytes)
  return new TextDecoder().decode(new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()))
}
/** The text of a keyframe (compressed or not). */
export const keyText = async (k: FilmKey): Promise<string> => (typeof k.data === 'string' ? k.data : gunz(k.data))

/** The film as one binary blob: [4 bytes header length][header JSON][the keyframes' bytes, one after another]. */
export async function packFilm(film: Film): Promise<Uint8Array> {
  const blobs: Uint8Array[] = []
  for (const k of film.keys) blobs.push(typeof k.data === 'string' ? await gz(k.data) : k.data)
  const header = new TextEncoder().encode(JSON.stringify({ v: film.v, params: film.params, endT: film.endT, inputs: film.inputs, keys: film.keys.map((k, i) => ({ t: k.t, tick: k.tick, len: blobs[i].length })) }))
  const out = new Uint8Array(4 + header.length + blobs.reduce((n, b) => n + b.length, 0))
  new DataView(out.buffer).setUint32(0, header.length)
  out.set(header, 4)
  let at = 4 + header.length
  for (const b of blobs) { out.set(b, at); at += b.length }
  return out
}
export function unpackFilm(bytes: Uint8Array): Film {
  const hl = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0)
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + hl))) as { v: 1; params: FilmParams; endT?: number; inputs: FilmInput[]; keys: { t: number; tick: number; len: number }[] }
  let at = 4 + hl
  const keys: FilmKey[] = h.keys.map(k => { const data = bytes.slice(at, at + k.len); at += k.len; return { t: k.t, tick: k.tick, data } })
  return { v: h.v, params: h.params, keys, inputs: h.inputs, endT: h.endT }
}
