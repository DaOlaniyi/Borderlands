import { REL } from './config'
import type { Relation } from './types'

export type DiplomacyEvent = { text: string; a: number; b: number }

/**
 * Symmetric relations between kingdoms: allied < neutral < conflict < war < total war.
 * Neutral and allied kingdoms never fight and cannot capture each other's towns.
 * Conflict, war and total war are hostile. War is permanent (total war adds that reconciliation is impossible); conflict cools back to neutral when nothing happens.
 */
export class Diplomacy {
  private rel: Relation[][]
  private since: number[][]
  private lastIncident: number[][]
  private kills: number[][]
  /** lost[victim][killer]: units of `victim` killed by `killer` during the current conflict/war. */
  private lost: number[][]
  events: DiplomacyEvent[] = []
  /** Bumped on every relation change, so territory/supply (which depend on alliances) can be recomputed. */
  version = 0

  constructor(public count: number) {
    const mk = <T,>(v: T) => Array.from({ length: count }, () => Array<T>(count).fill(v))
    this.rel = mk<Relation>('neutral'); this.since = mk(0); this.lastIncident = mk(-999); this.kills = mk(0); this.lost = mk(0)
  }

  /** Kingdoms directly allied with `k`. */
  alliesOf(k: number): number[] { const out: number[] = []; for (let o = 0; o < this.count; o++) if (o !== k && this.rel[k][o] === 'allied') out.push(o); return out }
  /** The alliance bloc containing `k` (connected allies), `k` first. */
  bloc(k: number): number[] {
    const seen = new Set<number>([k]), queue = [k]
    for (let i = 0; i < queue.length; i++) for (const o of this.alliesOf(queue[i])) if (!seen.has(o)) { seen.add(o); queue.push(o) }
    return queue
  }

  get(a: number, b: number): Relation { return a === b ? 'allied' : this.rel[a][b] }
  hostile(a: number, b: number) { if (a === b) return false; const r = this.rel[a][b]; return r === 'conflict' || r === 'war' || r === 'total' }
  allied(a: number, b: number) { return a === b || this.rel[a][b] === 'allied' }
  incidents(a: number, b: number) { return this.kills[a][b] }
  casualties(victim: number, killer: number) { return this.lost[victim][killer] }

  set(a: number, b: number, r: Relation, time: number, text?: string) {
    if (a === b || this.rel[a][b] === r) return
    const prev = this.rel[a][b]
    this.rel[a][b] = this.rel[b][a] = r
    this.version++
    this.since[a][b] = this.since[b][a] = time
    if (r === 'conflict' || r === 'war') this.lastIncident[a][b] = this.lastIncident[b][a] = time
    if (r === 'neutral' || r === 'allied' || prev === 'neutral' || prev === 'allied') { this.lost[a][b] = this.lost[b][a] = 0 } // each conflict starts a fresh tally
    if (text) this.events.push({ text, a, b })
  }

  /** Border violation by a peaceful neighbour that was not corrected in time (or happened right beside a town). */
  violation(attacker: number, victim: number, time: number, label: (k: number) => string, why: string) {
    this.lastIncident[attacker][victim] = this.lastIncident[victim][attacker] = time
    if (this.get(attacker, victim) === 'neutral') this.set(attacker, victim, 'conflict', time, `${label(attacker)} ${why} ${label(victim)}'s border — relations: In Conflict`)
  }

  /** Seconds the longest-running war or total war between any two kingdoms has lasted (0 if none). */
  warAge(time: number): number {
    let age = 0
    for (let a = 0; a < this.count; a++) for (let b = a + 1; b < this.count; b++) { const r = this.rel[a][b]; if (r === 'war' || r === 'total') age = Math.max(age, time - this.since[a][b]) }
    return age
  }

  /** Seconds since kingdom `k` was last involved in any incident with another kingdom. */
  quietFor(k: number, time: number): number {
    let last = -999
    for (let o = 0; o < this.count; o++) if (o !== k) last = Math.max(last, this.lastIncident[k][o])
    return time - last
  }

  fighting(a: number, b: number, time: number) { this.lastIncident[a][b] = this.lastIncident[b][a] = time }

  death(killer: number, victim: number, time: number, n = 1) {
    if (killer === victim) return
    this.kills[killer][victim] += n; this.kills[victim][killer] += n
    this.lost[victim][killer] += n
    this.fighting(killer, victim, time)
  }

  declareWar(a: number, b: number, time: number, label: (k: number) => string) {
    this.set(a, b, 'war', time, `${label(a)} has declared WAR on ${label(b)}`)
  }

  /** Proposal accepted only between kingdoms with a clean history. */
  proposeAlliance(a: number, b: number, time: number, label: (k: number) => string): boolean {
    if (this.get(a, b) !== 'neutral' || this.kills[a][b] > 0 || time - this.lastIncident[a][b] < 120) return false
    this.set(a, b, 'allied', time, `${label(a)} and ${label(b)} are now allies`)
    return true
  }

  /** Once per second: cool off quiet conflicts and let AI kingdoms escalate long or bloody ones into war. */
  update(time: number, rand: () => number, isAi: (k: number) => boolean, label: (k: number) => string, capOf: (k: number) => number = () => Infinity) {
    for (let a = 0; a < this.count; a++) for (let b = a + 1; b < this.count; b++) {
      const r = this.rel[a][b]
      if (r === 'war') { // an AI that has lost twice its troop capacity in this war goes to total war
        for (const [x, y] of [[a, b], [b, a]]) if (isAi(x) && this.lost[x][y] >= REL.totalWarCapacityMult * Math.max(1, capOf(x))) { this.set(a, b, 'total', time, `${label(x)} has declared TOTAL WAR on ${label(y)}`); break }
        continue
      }
      if (r === 'conflict') {
        const quiet = time - this.lastIncident[a][b]
        if (quiet > REL.coolAfter) { this.set(a, b, 'neutral', time, `${label(a)} and ${label(b)} have calmed down — relations: Neutral`); continue }
        const both = isAi(a) && isAi(b) // AI-versus-AI feuds escalate far more slowly than ones involving the player
        const bloody = this.kills[a][b] >= (both ? REL.aiWarKills : REL.warKills), long = time - this.since[a][b] >= (both ? REL.aiWarAfter : REL.warAfter)
        if ((bloody || long) && rand() < (both ? REL.aiDeclareChance : REL.declareChance)) {
          const aggressor = isAi(a) && isAi(b) ? (rand() < 0.5 ? a : b) : isAi(a) ? a : isAi(b) ? b : -1
          if (aggressor >= 0) this.declareWar(aggressor, aggressor === a ? b : a, time, label)
        }
      }
    }
  }
}
