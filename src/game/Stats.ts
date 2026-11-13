import { UNIT_TYPES, type BoatKind, type UnitType } from './config'
import type { Game } from './Game'

/** Match analytics: counters and time series for the review page. Plain data only (it is saved with the game). */
export const BOAT_KINDS: BoatKind[] = ['boat', 'barge', 'cargo', 'gunship', 'zumwalt']
export type Res3 = 'lumber' | 'gold' | 'meat'
export type SpendCat = 'tower' | 'lot' | Exclude<BoatKind, 'barge'> | 'settlement' | 'upgrade' // (barges are booked with the infantry boats)
export const SPEND_CATS: SpendCat[] = ['tower', 'lot', 'boat', 'cargo', 'gunship', 'zumwalt', 'settlement', 'upgrade']

export type ShipStats = { started: number; built: number; lost: number; sunk: number; siteLost: number }
export type NavalTries = { tries: number; fails: number; lastFailAt: number }
export type KStats = {
  trained: Record<UnitType, number>
  killed: Record<UnitType, number> // enemy units this nation killed, by the victim's type
  lost: Record<UnitType, number> // own units lost, from any cause
  lostToEnemy: number
  lostToOther: number // attrition (cut off, over the cap), tower collapse, ships lost with the crew
  ships: Record<BoatKind, ShipStats>
  placement: Record<BoatKind, NavalTries>
  gathered: Record<Res3, number>
  spentLumber: Record<SpendCat, number>
  spentGold: number
  lumberTaken: number // arrived with captured towns
  lumberLost: number // left with towns that fell
  towersBuilt: number
  towersLost: number
  lotsBuilt: number
  townsCaptured: number
  townsLost: number
  townsRazed: number // towns/settlements this nation destroyed
  settlementsFounded: number
  settlementsLost: number
  diedAt: number | null
}
export type Note = { text: string; tone: 'ok' | 'wait' | 'block'; t: number }
export type StatEvent = { t: number; kind: 'ship' | 'town' | 'war' | 'build' | 'elim' | 'diplo'; text: string; k: number }
export const SERIES_KEYS = ['lumber', 'gold', 'meat', 'power', 'towns', 'units', 'ships', 'tiles', 'gathered'] as const
export type SeriesKey = (typeof SERIES_KEYS)[number]
export type GameStats = {
  k: KStats[]
  kills: number[][] // kills[killer][victim] in units (squad members counted)
  notes: Record<string, Note>[] // per kingdom: the AI's latest reasoning about a decision (key = decision)
  events: StatEvent[]
  felled: number // trees chopped down
  regrown: number // trees that grew back
  series: { t: number[]; step: number; next: number; v: Record<SeriesKey, number[][]> }
}

const rec = <K extends string, V>(keys: readonly K[], f: () => V) => Object.fromEntries(keys.map(k => [k, f()])) as Record<K, V>
const newK = (): KStats => ({
  trained: rec(UNIT_TYPES, () => 0), killed: rec(UNIT_TYPES, () => 0), lost: rec(UNIT_TYPES, () => 0), lostToEnemy: 0, lostToOther: 0,
  ships: rec(BOAT_KINDS, () => ({ started: 0, built: 0, lost: 0, sunk: 0, siteLost: 0 })),
  placement: rec(BOAT_KINDS, () => ({ tries: 0, fails: 0, lastFailAt: -1 })),
  gathered: { lumber: 0, gold: 0, meat: 0 }, spentLumber: rec(SPEND_CATS, () => 0), spentGold: 0, lumberTaken: 0, lumberLost: 0,
  towersBuilt: 0, towersLost: 0, lotsBuilt: 0, townsCaptured: 0, townsLost: 0, townsRazed: 0, settlementsFounded: 0, settlementsLost: 0, diedAt: null,
})

/** A saved game from before a ship type existed has no counters for it: add them (and the other new fields) so the review page never meets a hole. */
export function ensureStats(s: GameStats) {
  for (const k of s.k) for (const kind of BOAT_KINDS) { k.ships[kind] ??= { started: 0, built: 0, lost: 0, sunk: 0, siteLost: 0 }; k.placement[kind] ??= { tries: 0, fails: 0, lastFailAt: -1 } }
  for (const k of s.k) for (const t of UNIT_TYPES) { k.trained[t] ??= 0; k.killed[t] ??= 0; k.lost[t] ??= 0 }
  s.felled ??= 0; s.regrown ??= 0
}

export function newStats(n: number): GameStats {
  return {
    k: Array.from({ length: n }, newK), kills: Array.from({ length: n }, () => new Array(n).fill(0)), notes: Array.from({ length: n }, () => ({})), events: [], felled: 0, regrown: 0,
    series: { t: [], step: 10, next: 0, v: rec(SERIES_KEYS, () => Array.from({ length: n }, () => [] as number[])) },
  }
}

const EVENT_CAP = 700
export function logEvent(g: Game, kind: StatEvent['kind'], text: string, k = -1) {
  const ev = g.stats.events
  ev.push({ t: g.time, kind, text, k })
  if (ev.length > EVENT_CAP) ev.splice(0, ev.length - EVENT_CAP)
}

/** The AI records why it did (or did not) do something; the review page shows the latest note per decision. */
export function aiNote(g: Game, k: number, key: string, tone: Note['tone'], text: string) {
  const cur = g.stats.notes[k][key]
  if (cur && cur.text === text && cur.tone === tone) return // (same reasoning: keep the time it began)
  g.stats.notes[k][key] = { text, tone, t: g.time }
}

export const noteKills = (g: Game, killer: number, victim: number, type: UnitType, n: number) => {
  const s = g.stats
  s.k[victim].lost[type] += n
  if (killer >= 0 && killer !== victim) { s.k[killer].killed[type] += n; s.k[victim].lostToEnemy += n; s.kills[killer][victim] += n }
  else s.k[victim].lostToOther += n
}

export function spend(g: Game, faction: number, cat: SpendCat, amount: number) { if (g.stats.k[faction]) g.stats.k[faction].spentLumber[cat] += amount }

/** Every stockpile a kingdom holds (home, other islands, settlements' own stores). */
export function totalStock(g: Game, k: number): Record<Res3, number> {
  const out = { lumber: g.kingdoms[k].lumber, gold: g.kingdoms[k].gold, meat: g.kingdoms[k].meat }
  for (const [key, s] of g.regionStocks) if (Math.floor(key / 4096) === k) { out.lumber += s.lumber; out.gold += s.gold; out.meat += s.meat }
  for (const t of g.towns) if (!t.ruined && t.owner === k && t.store) { out.lumber += t.store.lumber; out.gold += t.store.gold; out.meat += t.store.meat }
  return out
}

/** Called each tick: samples every kingdom's numbers for the charts (the interval doubles, and old samples thin out, as a match grows long). */
export function sampleStats(g: Game) {
  const S = g.stats.series
  if (g.time < S.next) return
  S.next = g.time + S.step
  S.t.push(Math.round(g.time))
  const units = new Array(g.kingdoms.length).fill(0), ships = new Array(g.kingdoms.length).fill(0)
  for (const u of g.units) if (u.state !== 'dead') units[u.faction] += u.count
  for (const b of g.boats) ships[b.faction]++
  for (const k of g.kingdoms) {
    const tot = totalStock(g, k.id), id = k.id
    S.v.lumber[id].push(Math.round(tot.lumber)); S.v.gold[id].push(Math.round(tot.gold)); S.v.meat[id].push(Math.round(tot.meat)); S.v.power[id].push(Math.round(k.power))
    S.v.towns[id].push(g.ownedTowns(id)); S.v.units[id].push(units[id]); S.v.ships[id].push(ships[id]); S.v.tiles[id].push(g.tileCounts[id] ?? 0); S.v.gathered[id].push(Math.round(g.stats.k[id].gathered.lumber))
  }
  if (S.t.length > 420) { // thin: keep every second sample and sample half as often from now on
    S.t = S.t.filter((_, i) => i % 2 === 0)
    for (const key of SERIES_KEYS) S.v[key] = S.v[key].map(a => a.filter((_, i) => i % 2 === 0))
    S.step *= 2
  }
}
