import { AGIT, AI, TILE } from './config'
import type { Game } from './Game'
import { landmassAt } from './WorldInfo'

/**
 * Agitation: each AI kingdom has a 0–100 % nervousness bar fed by foreign wars (slowly), fallen towns (an immediate spike that
 * shrinks with distance) and a lopsided balance of power. Above AGIT.readyOn it puts its border on alert (troops toward the
 * trouble, more archer towers). Above AGIT.reactAbove it has a growing chance to act: prey on a smaller or comparable
 * neighbour, or — when the island is tipping toward one power or there is no prey — propose an alliance against the strongest
 * nation. Allied kingdoms form blocs that fight the nation that caused them to form and dissolve once it is destroyed.
 */

const tilesBetween = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / TILE
const key = (a: number, b: number) => Math.min(a, b) * 32 + Math.max(a, b)

/** Nearest distance in tiles between any towns of two kingdoms (Infinity if one has none). */
export function townDistance(g: Game, a: number, b: number): number {
  let d = Infinity
  for (const t of g.towns) if (t.owner === a) for (const o of g.towns) if (o.owner === b) d = Math.min(d, tilesBetween(t, o))
  return d
}

export type Nation = { members: number[]; towns: number }
/** Alliance blocs of living kingdoms with their combined town counts ("nations"). */
export function nations(g: Game): Nation[] {
  const seen = new Set<number>(), out: Nation[] = []
  for (const k of g.kingdoms) {
    if (!k.alive || seen.has(k.id)) continue
    const members = g.diplomacy.bloc(k.id).filter(m => g.kingdoms[m].alive)
    members.forEach(m => seen.add(m))
    out.push({ members, towns: members.reduce((n, m) => n + g.ownedTowns(m), 0) })
  }
  return out.filter(n => n.towns > 0)
}

export type Balance = { total: number; leader: Nation | null; share: number; dominant: boolean; tipped: boolean }
export function balanceOfPower(g: Game): Balance {
  const ns = nations(g), total = ns.reduce((n, x) => n + x.towns, 0)
  const leader = ns.slice().sort((a, b) => b.towns - a.towns)[0] ?? null
  const share = leader && total ? leader.towns / total : 0
  const enough = ns.length >= 3
  return { total, leader, share, dominant: enough && !!leader && leader.towns > total - leader.towns, tipped: enough && share >= AGIT.tippedShare }
}

/** A town just fell: nearby kingdoms get a big immediate spike, everyone else at least the floor. */
export function townFell(g: Game, x: number, y: number, from: number, by: number) {
  for (const k of g.kingdoms) {
    if (k.isPlayer || !k.alive || k.id === from || k.id === by) continue
    let d = Infinity
    for (const t of g.towns) if (t.owner === k.id) d = Math.min(d, tilesBetween(t, { x, y }))
    const f = Math.max(0, Math.min(1, (d - AGIT.spikeNearTiles) / (AGIT.spikeFarTiles - AGIT.spikeNearTiles)))
    const spike = AGIT.spikeNear + (AGIT.spikeFar - AGIT.spikeNear) * f
    g.agit[k.id] = Math.min(100, g.agit[k.id] + spike)
    g.agitFocus[k.id] = { x, y }
  }
}

/** Foreign wars and conflicts raise agitation slowly; quiet times let it drain. Called every tick. */
export function updateAgitation(g: Game, dt: number) {
  const hostilePairs: { a: number; b: number; w: number }[] = []
  for (let a = 0; a < g.kingdoms.length; a++) for (let b = a + 1; b < g.kingdoms.length; b++) {
    if (!g.kingdoms[a].alive || !g.kingdoms[b].alive) continue
    const r = g.diplomacy.get(a, b)
    if (r === 'conflict' || r === 'war' || r === 'total') hostilePairs.push({ a, b, w: r === 'total' ? AGIT.totalWeight : r === 'war' ? AGIT.warWeight : AGIT.conflictWeight })
  }
  const bal = balanceOfPower(g)
  for (const k of g.kingdoms) {
    if (k.isPlayer || !k.alive) continue
    const id = k.id
    const myHostile = g.kingdoms.some(o => o.id !== id && o.alive && g.hostile(id, o.id))
    let rate = 0, focus = g.agitFocus[id]
    for (const p of hostilePairs) {
      if (p.a === id || p.b === id) continue
      if (g.diplomacy.get(id, p.a) === 'allied' || g.diplomacy.get(id, p.b) === 'allied') continue // allies join those wars instead
      const d = Math.min(townDistance(g, id, p.a), townDistance(g, id, p.b))
      rate += p.w * (d <= AGIT.nearTiles ? AGIT.rateNear : AGIT.rateFar)
      if (d <= AGIT.nearTiles) { const t = g.towns.find(q => q.owner === p.a || q.owner === p.b); if (t) focus = { x: t.x, y: t.y } }
    }
    if (bal.tipped && bal.leader && !bal.leader.members.includes(id)) rate += AGIT.tippedRate
    g.agit[id] = Math.max(0, Math.min(100, g.agit[id] + (rate > 0 ? rate : -AGIT.decay) * dt))
    if (myHostile) g.agit[id] = Math.max(g.agit[id], AGIT.underAttackFloor) // a nation under attack is on edge
    if (bal.dominant && bal.leader && !bal.leader.members.includes(id)) { g.agit[id] = 100; if (bal.leader) { const t = g.towns.find(q => bal.leader!.members.includes(q.owner)); if (t) focus = { x: t.x, y: t.y } } } // red flag for everyone
    g.agitFocus[id] = focus
    g.ready[id] = g.agit[id] >= AGIT.readyOn || (g.ready[id] && g.agit[id] >= AGIT.readyOff)
  }
}

/** Once per second: reactions of agitated kingdoms, alliance upkeep, auto-joining wars. */
export function agitationTick(g: Game) {
  reconcileAlliances(g)
  rallyAgainstThreat(g)
  if (g.time < AGIT.earlyPeace) return // the region does not erupt into war in the opening minutes
  expandOverseas(g)
  const bal = balanceOfPower(g)
  for (const k of g.kingdoms) {
    if (k.isPlayer || !k.alive || g.time < (g.nextReact[k.id] ?? 0)) continue
    const id = k.id
    if (g.agit[id] <= AGIT.reactAbove) continue
    if (g.diplomacy.bloc(id).length > 1) continue // blocs fight their founding war; they do not bully neighbours
    if (g.kingdoms.some(o => o.id !== id && o.alive && g.hostile(id, o.id))) continue // already busy fighting
    const p = AGIT.reactBase + ((g.agit[id] - AGIT.reactAbove) / (100 - AGIT.reactAbove)) * AGIT.reactMax
    if (g.rng.next() >= p) continue
    g.nextReact[id] = g.time + AGIT.reactCooldown
    react(g, id, bal)
  }
}

/**
 * Expansion across the water: a kingdom with no land neighbour left on its own land mass (it has the island to itself, or has beaten
 * everyone on it) eventually turns on a nearby kingdom overseas — preferring one that is not much stronger — and its navy takes over.
 */
function expandOverseas(g: Game) {
  if (g.time < AI.expandAfter) return
  const aiAlive = g.kingdoms.filter(o => !o.isPlayer && o.alive).length
  if (aiWars(g) >= Math.max(1, Math.floor(aiAlive / AGIT.maxWarsDivisor))) return
  for (const k of g.kingdoms) {
    const id = k.id
    if (k.isPlayer || !k.alive || g.time < (g.aiMemo.expandAt[id] ?? AI.expandAfter) || k.aggression < 0.25) continue
    if (g.diplomacy.bloc(id).length > 1 || g.kingdoms.some(o => o.id !== id && o.alive && g.hostile(id, o.id))) continue
    const mine = g.towns.filter(t => t.owner === id && !t.ruined)
    if (!mine.length) continue
    const lands = new Set(mine.map(t => landmassAt(g.world, t.x, t.y)))
    const sharesLand = (o: number) => g.towns.some(t => t.owner === o && !t.ruined && lands.has(landmassAt(g.world, t.x, t.y)))
    const others = g.kingdoms.filter(o => o.id !== id && o.alive && g.ownedTowns(o.id) > 0 && !g.diplomacy.allied(id, o.id))
    if (others.some(o => sharesLand(o.id))) continue // there is still someone to fight on foot
    const prey = others.filter(o => townDistance(g, id, o.id) <= AI.expandTiles && strengthOf(g, o.id) <= Math.ceil(g.ownedTowns(id) * 1.3))
      .sort((a, b) => townDistance(g, id, a.id) - townDistance(g, id, b.id) || strengthOf(g, a.id) - strengthOf(g, b.id))[0]
    g.aiMemo.expandAt[id] = g.time + AI.expandEvery
    if (prey && g.rng.next() < 0.25 + 0.5 * k.aggression) declareSpill(g, id, prey.id, 'war')
  }
}

/**
 * Existential threat: when one nation (a kingdom or an alliance bloc — the player counts) holds more towns than everybody else
 * combined, every other living AI kingdom sets its own quarrels aside, joins one alliance and goes to war with the giant.
 * It is deterministic (no dice, no cooldowns) so a runaway conqueror, human or AI, always meets a united front.
 */
export function rallyAgainstThreat(g: Game) {
  if (g.time < 60) return
  const ns = nations(g)
  if (ns.length < 2) return
  const total = ns.reduce((n, x) => n + x.towns, 0)
  const leader = ns.slice().sort((a, b) => b.towns - a.towns)[0]
  if (!(leader.towns > total - leader.towns)) return
  const rest = g.kingdoms.filter(k => k.alive && !k.isPlayer && !leader.members.includes(k.id) && g.ownedTowns(k.id) > 0).map(k => k.id)
  if (!rest.length) return
  const giant = leader.members.reduce((best, m) => (g.ownedTowns(m) > g.ownedTowns(best) ? m : best), leader.members[0])
  // 1. end the feuds among the rest
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
    if (g.diplomacy.hostile(rest[i], rest[j])) g.diplomacy.set(rest[i], rest[j], 'neutral', g.time, `${g.label(rest[i])} and ${g.label(rest[j])} lay down arms — ${g.label(giant)} is the greater threat`)
  }
  // 2. one alliance against the giant (blocs that clash cannot merge)
  let anchor = rest[0]
  for (const k of rest.slice(1)) {
    if (g.diplomacy.bloc(anchor).includes(k)) continue
    if (!blocsClash(g, anchor, k)) formAlliance(g, anchor, k, giant)
    else anchor = k
  }
  // 3. everyone is at war with the giant's nation
  for (const k of rest) for (const m of leader.members) declareSpill(g, k, m, 'war')
}

function strengthOf(g: Game, k: number) { return g.diplomacy.bloc(k).reduce((n, m) => n + g.ownedTowns(m), 0) }

/** How many AI-versus-AI wars are running, and how many the island tolerates at once (so wars spread gradually). */
function aiWars(g: Game) {
  let n = 0
  for (let a = 1; a < g.kingdoms.length; a++) for (let b = a + 1; b < g.kingdoms.length; b++) { const r = g.diplomacy.get(a, b); if ((r === 'war' || r === 'total') && g.kingdoms[a].alive && g.kingdoms[b].alive) n++ }
  return n
}

function react(g: Game, k: number, bal: Balance) {
  const aiAlive = g.kingdoms.filter(o => !o.isPlayer && o.alive).length
  if (aiWars(g) >= Math.max(1, Math.floor(aiAlive / AGIT.maxWarsDivisor))) return // enough wars already
  const mine = g.ownedTowns(k)
  const others = g.kingdoms.filter(o => o.id !== k && o.alive && g.diplomacy.get(k, o.id) === 'neutral' && g.ownedTowns(o.id) > 0)
  // prey: a smaller or comparable neighbour — never a bigger one (unless it is the power everyone fears)
  const prey = others.filter(o => strengthOf(g, o.id) <= mine && townDistance(g, k, o.id) <= AGIT.preyTiles).sort((a, b) => strengthOf(g, a.id) - strengthOf(g, b.id) || townDistance(g, k, a.id) - townDistance(g, k, b.id))[0]
  const wantsPrey = prey && !bal.tipped && !bal.dominant && g.rng.next() < 0.4 + 0.6 * g.kingdoms[k].aggression
  if (wantsPrey) { declareSpill(g, k, prey.id, 'war'); return }
  // otherwise seek an alliance against the strongest nation
  const target = (bal.leader && !bal.leader.members.includes(k) && (bal.tipped || bal.dominant))
    ? bal.leader.members.reduce((best, m) => (g.ownedTowns(m) > g.ownedTowns(best) ? m : best), bal.leader.members[0])
    : others.concat(g.kingdoms.filter(o => o.id !== k && o.alive && g.hostile(k, o.id))).sort((a, b) => strengthOf(g, b.id) - strengthOf(g, a.id))[0]?.id
  if (target === undefined || strengthOf(g, target) < Math.min(mine, 1)) return
  const partner = g.kingdoms.filter(o => o.id !== k && o.id !== target && o.alive && !o.isPlayer && g.diplomacy.get(k, o.id) === 'neutral' && g.diplomacy.get(o.id, target) !== 'allied' && !blocsClash(g, k, o.id))
    .sort((a, b) => townDistance(g, k, a.id) - townDistance(g, k, b.id))[0]
  if (!partner) return
  if (acceptsAlliance(g, partner.id, k, bal)) formAlliance(g, k, partner.id, target)
}

/** True if anyone in one kingdom's alliance is hostile to anyone in the other's: such blocs cannot merge. */
export function blocsClash(g: Game, a: number, b: number): boolean {
  for (const x of g.diplomacy.bloc(a)) for (const y of g.diplomacy.bloc(b)) if (g.diplomacy.hostile(x, y)) return true
  return false
}

/** Would `receiver` accept an alliance from `proposer`? Agitated, cooperative (not itself looking to prey) or under attack. */
export function acceptsAlliance(g: Game, receiver: number, proposer: number, bal: Balance): boolean {
  if (g.diplomacy.get(receiver, proposer) !== 'neutral') return false
  if (blocsClash(g, receiver, proposer)) return false
  const underAttack = g.kingdoms.some(o => o.id !== receiver && o.alive && g.hostile(receiver, o.id))
  if (underAttack) return true
  if (g.agit[receiver] < AGIT.readyOn) return false
  const mine = g.ownedTowns(receiver)
  const hasPrey = g.kingdoms.some(o => o.id !== receiver && o.alive && g.diplomacy.get(receiver, o.id) === 'neutral' && strengthOf(g, o.id) <= mine && townDistance(g, receiver, o.id) <= AGIT.preyTiles)
  return bal.tipped || bal.dominant || !hasPrey || g.rng.next() < 0.3
}

/** Player-initiated request: unlikely early on, more likely as the receiver gets agitated, certain when it is under attack. */
export function playerAllianceRequest(g: Game, k: number): boolean {
  if (g.diplomacy.get(0, k) !== 'neutral') return false
  const underAttack = g.kingdoms.some(o => o.id !== k && o.alive && g.hostile(k, o.id))
  const chance = underAttack ? 1 : Math.max(0.05, Math.min(0.9, 0.08 + (g.time / 1800) * 0.3 + (g.agit[k] / 100) * 0.55))
  return g.rng.next() < chance
}

export function declareSpill(g: Game, aggressor: number, victim: number, level: 'war' | 'conflict' = 'war') {
  if (g.diplomacy.get(aggressor, victim) === level || g.diplomacy.hostile(aggressor, victim)) return
  g.diplomacy.set(aggressor, victim, level, g.time)
  g.spill(`SPILLOVER : ${g.label(aggressor).toUpperCase()} DECLARES ${level === 'war' ? 'WAR' : 'CONFLICT'} ON ${g.label(victim).toUpperCase()}`)
}

export function formAlliance(g: Game, a: number, b: number, target: number | null) {
  g.diplomacy.set(a, b, 'allied', g.time, `${g.label(a)} and ${g.label(b)} are now allies`)
  if (target !== null) {
    g.purposes.set(key(a, b), target)
    for (const m of [...g.diplomacy.bloc(a), ...g.diplomacy.bloc(b)]) if (m !== target) declareSpill(g, m, target)
  }
}

/** Allies join each other's wars; alliances formed against a nation dissolve once that nation is destroyed. */
export function reconcileAlliances(g: Game) {
  // a nation with no towns and no troops is wiped out: it leaves its alliance, and a two-member alliance closes with it
  for (const k of g.kingdoms) {
    if (g.ownedTowns(k.id) > 0 || g.units.some(u => u.faction === k.id && u.state !== 'dead')) continue
    for (const o of g.diplomacy.alliesOf(k.id)) g.diplomacy.set(k.id, o, 'neutral', g.time, `${g.label(k.id)} has been wiped out and leaves ${g.label(o)}'s alliance`)
  }
  for (let a = 0; a < g.kingdoms.length; a++) for (let b = 0; b < g.kingdoms.length; b++) {
    if (a === b) continue
    const r = g.diplomacy.get(a, b)
    if (r !== 'conflict' && r !== 'war' && r !== 'total') continue
    for (const c of g.diplomacy.alliesOf(a)) {
      if (c === b || !g.kingdoms[c].alive || g.diplomacy.get(c, b) !== 'neutral') continue
      declareSpill(g, c, b, r === 'conflict' ? 'conflict' : 'war')
    }
  }
  for (const [k, target] of [...g.purposes]) {
    const a = Math.floor(k / 32), b = k % 32
    if (g.diplomacy.get(a, b) !== 'allied') { g.purposes.delete(k); continue }
    const t = g.kingdoms[target]
    if (!t.alive || g.ownedTowns(target) === 0 && !g.units.some(u => u.faction === target && u.state !== 'dead')) {
      g.diplomacy.set(a, b, 'neutral', g.time, `${g.label(a)} and ${g.label(b)} part ways — ${g.label(target)} is finished`)
      g.purposes.delete(k)
    }
  }
}
