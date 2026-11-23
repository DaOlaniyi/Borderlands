import type { Game } from './Game'
import type { Boat } from './types'
import { SHIP_NAME, type BoatKind } from './config'
import { boatStats } from './BoatSystem'
import { logEvent } from './Stats'

/**
 * Ship ranks. Gunships and Zumwalts start unranked and climb an army-style ladder by fighting: XP for damage dealt to ships, for the killing blow, and
 * for damage taken in an encounter the ship SURVIVES (it is banked only once the shooting has stopped, so a ship that is blown apart earns nothing
 * for its last fight). Every rank adds health, damage and speed; the gain per rank grows exponentially, so the last few ranks are worth far more than the
 * first ones, and a brigadier general is 1.5x in all three.
 */
export const RANKS = [
  { key: 'none', name: 'Unranked', short: 'No rank' },
  { key: 'e1', name: 'Private', short: 'PVT E-1' },
  { key: 'e2', name: 'Private', short: 'PV2 E-2' },
  { key: 'cpl', name: 'Corporal', short: 'CPL' },
  { key: 'sgt', name: 'Sergeant', short: 'SGT' },
  { key: 'ssg', name: 'Staff Sergeant', short: 'SSG' },
  { key: 'msg', name: 'Master Sergeant', short: 'MSG' },
  { key: 'wo1', name: 'Warrant Officer I', short: 'WO1' },
  { key: '2lt', name: 'Second Lieutenant', short: '2LT' },
  { key: 'maj', name: 'Major', short: 'MAJ' },
  { key: 'col', name: 'Colonel', short: 'COL' },
  { key: 'bg', name: 'Brigadier General', short: 'BG' },
] as const
export const RANK_MAX = RANKS.length - 1

/** Total XP at which each rank is reached (index = rank). Five times the first tuning, so promotions are slow: a Zumwalt-vs-Zumwalt fight is worth roughly 1000+ XP, a Private. */
export const RANK_XP = [0, 500, 1250, 2500, 4500, 7500, 12000, 18500, 27500, 40000, 57500, 80000]

export const RANK_TUNE = {
  topBonus: 0.5, // at the top rank: +50 % health, damage and speed
  growth: 1.25, // each rank's gain is 25 % bigger than the one before (the bonus follows a geometric curve)
  dealt: 1, // XP per point of damage dealt to an armed ship
  dealtUnarmed: 0.6, // ...and to a cargo boat, barge or infantry boat (so sinking helpless ships is not the fast road to the top)
  taken: 0.5, // XP per point of damage taken, banked when the encounter ends with the ship still afloat
  encounterEnd: 15, // seconds without being hit: the encounter is over
  kill: 0.5, // the killing blow: this share of the victim's full hull in XP (more for a higher-ranked victim)
  killRankBonus: 0.1, // +10 % of that per rank the victim held
}

export const canRank = (kind: BoatKind) => kind === 'zumwalt' || kind === 'battleship' || kind === 'gunship'
export const rankOf = (b: Pick<Boat, 'rank'>) => b.rank ?? 0

/** The share by which a rank raises health, damage and speed (0 for no rank, topBonus for the top rank), growing geometrically in between. */
export const rankBonus = (level: number) => {
  const L = Math.max(0, Math.min(RANK_MAX, level)), G = RANK_TUNE.growth
  return RANK_TUNE.topBonus * (Math.pow(G, L) - 1) / (Math.pow(G, RANK_MAX) - 1)
}
export const rankMult = (b: Pick<Boat, 'rank'>) => 1 + rankBonus(rankOf(b))

/** What the panel shows for a ship: the rank, XP towards the next one and the bonuses it grants. */
export function rankInfo(b: Boat) {
  const level = rankOf(b), xp = b.xp ?? 0, next = level < RANK_MAX ? RANK_XP[level + 1] : -1
  const bonus = rankBonus(level), nextBonus = level < RANK_MAX ? rankBonus(level + 1) : bonus
  return {
    level, key: RANKS[level].key, name: RANKS[level].name, short: RANKS[level].short,
    xp: Math.floor(xp), from: RANK_XP[level], next, pct: next < 0 ? 100 : Math.round(((xp - RANK_XP[level]) / (next - RANK_XP[level])) * 100),
    bonus: Math.round(bonus * 100), nextBonus: Math.round(nextBonus * 100), pending: Math.floor(b.pendXp ?? 0),
  }
}

/** Add XP to a ship and promote it as far as that carries it. A promotion raises the hull (keeping the same share of it intact). */
export function awardXp(g: Game, b: Boat, amount: number) {
  if (!canRank(b.kind) || amount <= 0 || b.hp <= 0) return
  b.xp = (b.xp ?? 0) + amount
  let level = rankOf(b)
  if (level >= RANK_MAX) return
  const before = level
  while (level < RANK_MAX && b.xp >= RANK_XP[level + 1]) level++
  if (level === before) return
  const frac = b.hp / b.maxHp
  b.rank = level
  b.maxHp = boatStats(b.kind).hp * (1 + rankBonus(level))
  b.hp = b.maxHp * frac
  const what = `${g.label(b.faction)} ${SHIP_NAME[b.kind]}`
  if (b.faction === 0) g.say(`Your ${SHIP_NAME[b.kind]} was promoted to ${RANKS[level].name}`)
  if (level >= 7 || b.faction === 0) logEvent(g, 'ship', `${what} promoted to ${RANKS[level].name}`, b.faction)
}

/** XP for hitting ship `victim` for `dealt` points of damage. */
export function xpForHit(victim: Boat, dealt: number) {
  return dealt * (canRank(victim.kind) ? RANK_TUNE.dealt : RANK_TUNE.dealtUnarmed)
}
/** XP for the killing blow on `victim`: a share of its whole hull, bigger the higher its rank. */
export function xpForKill(victim: Boat) {
  const armed = canRank(victim.kind)
  return victim.maxHp * RANK_TUNE.kill * (armed ? 1 : 0.5) * (1 + RANK_TUNE.killRankBonus * rankOf(victim))
}

/** Once a minute-ish bookkeeping per ship: damage taken is banked as XP when nothing has hit it for `encounterEnd` seconds. */
export function bankSurvivalXp(g: Game, b: Boat) {
  const p = b.pendXp ?? 0
  if (p <= 0 || !canRank(b.kind)) return
  if (g.time - (b.hitAt ?? 0) < RANK_TUNE.encounterEnd) return
  b.pendXp = 0
  awardXp(g, b, p)
}
