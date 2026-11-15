import { UNIT_TYPES, type BoatKind } from './config'
import type { Game } from './Game'
import { gz, KEY_EVERY, type Film, type FilmParams } from './Film'
import { captureReel, newReel, REEL_EVERY, type Reel } from './Reel'
import { BOAT_KINDS } from './Stats'

/**
 * The game's recording: every `INTERVAL` seconds a compact frame is kept (towns with owners, every unit and ship as a few small numbers,
 * the territory map at a quarter of its resolution, and the events and letters since the last frame). The replay page scrubs through
 * the frames. A frame costs a few kilobytes, so an hour of play is a few megabytes before compression.
 */
export const REC_INTERVAL = 10
const TERR = 4 // territory is sampled every 4th cell
const MAX_FRAMES = 2400 // 6 hours; past that the older half is thinned to every other frame
const SHIPS = BOAT_KINDS as readonly BoatKind[]

export type RecEvent = { t: number; kind: string; text: string; k: number }
export type RecFrame = {
  t: number
  terr: Uint8Array // (w/4)*(h/4) controller+1... 0 = nobody, else kingdom+1
  towns: Int16Array // x4: cx, cy, owner+1 (0 = nobody), kind*4+level-1
  units: Int16Array // x3: x/16, y/16, faction*8+typeIndex
  boats: Int16Array // x3: x/16, y/16, faction*8+kindIndex
  events: RecEvent[]
}
export type RecKingdom = { name: string; color: number; isPlayer: boolean; temperament: string }
export type RecData = { v: 1; interval: number; w: number; h: number; land: Uint8Array; kingdoms: RecKingdom[]; frames: RecFrame[] }

export class Recorder {
  data: RecData
  private lastEventT = -1
  private lastLetter = 0
  next = 0
  /** Set while the player is playing (not in tests or replays): keyframes and the command log of the literal replay (see Film.ts). */
  film: Film | null = null
  disabled = false
  /** The position-recording film (see Reel.ts): a frame every second while the player plays. */
  reel: Reel | null = null
  private nextReel = 0
  private nextKey = 0
  /** Writes the game as a save would (set by the interface; the game folder cannot import the save code). */
  keyMaker: ((g: Game) => string) | null = null
  constructor(data: RecData) { this.data = data; this.next = (data.frames[data.frames.length - 1]?.t ?? -REC_INTERVAL) + REC_INTERVAL; this.lastEventT = data.frames[data.frames.length - 1]?.t ?? -1 }

  static fresh(g: Game): Recorder {
    const { w, h } = g.world
    const land = new Uint8Array(Math.ceil((w * h) / 8))
    for (let i = 0; i < w * h; i++) if (g.world.land[i]) land[i >> 3] |= 1 << (i & 7)
    return new Recorder({ v: 1, interval: REC_INTERVAL, w, h, land, kingdoms: [], frames: [] })
  }

  /** Take a frame if one is due. */
  tick(g: Game) { if (this.disabled) return; if (g.time >= this.next) { this.capture(g); this.next = g.time + REC_INTERVAL } }

  /** Start recording the literal replay (the interface calls this when a match begins or is loaded). */
  startFilm(params: FilmParams, keyMaker: (g: Game) => string, existing?: Film | null) {
    this.film = existing ?? { v: 1, params, keys: [], inputs: [] }
    this.keyMaker = keyMaker
    this.nextKey = (this.film.keys[this.film.keys.length - 1]?.t ?? -KEY_EVERY) + KEY_EVERY
  }
  startReel(g: Game, params: FilmParams, existing?: Reel | null) {
    this.reel = existing ?? newReel(g, params)
    this.nextReel = (this.reel.frames[this.reel.frames.length - 1]?.t ?? -REEL_EVERY) + REEL_EVERY
  }
  /** Take a reel frame if one is due. Call between simulation steps. */
  reelTick(g: Game) {
    if (!this.reel || g.time < this.nextReel) return
    this.nextReel = g.time + REEL_EVERY
    captureReel(g, this.reel)
  }
  /** Take a keyframe if one is due. Call between simulation steps, never inside one (the state must be what a save would hold). */
  keyTick(g: Game) {
    if (!this.film || !this.keyMaker || g.time < this.nextKey) return
    this.nextKey = g.time + KEY_EVERY
    const key = { t: g.time, tick: g.tickCount, data: this.keyMaker(g) as string | Uint8Array }
    this.film.keys.push(key)
    void gz(key.data as string).then(b => { key.data = b }) // (kept compressed once the compression is done: an hour is a few tens of megabytes)
  }

  capture(g: Game) {
    const d = this.data, { w, h } = g.world, tw = Math.ceil(w / TERR), th = Math.ceil(h / TERR)
    const terr = new Uint8Array(tw * th)
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const cx = Math.min(w - 1, x * TERR + 2), cy = Math.min(h - 1, y * TERR + 2); terr[y * tw + x] = g.controller[cy * w + cx] }
    const towns: number[] = []
    for (const t of g.towns) if (!t.ruined) towns.push(t.cx, t.cy, t.owner + 1, (t.kind === 'barracks' ? 1 : t.kind === 'settlement' ? 2 : 0) * 4 + t.level - 1)
    const units: number[] = []
    for (const u of g.units) if (u.state !== 'dead' && u.inTower < 0) units.push(Math.round(u.x / 16), Math.round(u.y / 16), u.faction * 8 + Math.max(0, UNIT_TYPES.indexOf(u.type)))
    const boats: number[] = []
    for (const b of g.boats) if (b.hp > 0) boats.push(Math.round(b.x / 16), Math.round(b.y / 16), b.faction * 8 + Math.max(0, SHIPS.indexOf(b.kind)))
    const events: RecEvent[] = g.stats.events.filter(e => e.t > this.lastEventT).map(e => ({ t: Math.round(e.t), kind: e.kind, text: e.text, k: e.k }))
    for (const l of g.letters) if (l.id > this.lastLetter) events.push({ t: Math.round(l.t), kind: 'letter', text: `${g.kingdoms[l.from].name} to ${g.kingdoms[l.to].name}: “${l.text}”`, k: l.from })
    this.lastLetter = g.letterId - 1; this.lastEventT = g.time
    d.frames.push({ t: Math.round(g.time), terr, towns: Int16Array.from(towns), units: Int16Array.from(units), boats: Int16Array.from(boats), events })
    d.kingdoms = g.kingdoms.map(k => ({ name: k.name, color: k.color, isPlayer: k.isPlayer, temperament: k.temperament }))
    if (d.frames.length > MAX_FRAMES) { // thin the older half to every other frame, folding the dropped frames' events into the one before
      const half = Math.floor(d.frames.length / 2), kept: RecFrame[] = []
      d.frames.forEach((f, i) => { if (i >= half || i % 2 === 0) kept.push(f); else kept[kept.length - 1].events.push(...f.events) })
      d.frames = kept
    }
  }
}

/** Frame events survive thinning by being folded into the next kept frame. */
export function frameAt(d: RecData, i: number): RecFrame { return d.frames[Math.max(0, Math.min(d.frames.length - 1, i))] }
export const isLand = (d: RecData, i: number) => (d.land[i >> 3] & (1 << (i & 7))) !== 0
export const recTerrScale = TERR
