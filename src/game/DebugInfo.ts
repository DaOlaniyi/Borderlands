import { AI, BARGE, BOAT, CARGO, GUNSHIP, HARVEST, UNIT_TYPES, ZUMWALT, type BoatKind, type HarvestMode, type Temperament, type UnitType } from './config'
import type { Game } from './Game'
import { isSettlement } from './Economy'
import { BOAT_KINDS, totalStock, type Note, type Res3 } from './Stats'
import { navalBudget, yardQuota, yardsOn } from './Yards'
import type { Relation } from './types'

/** Live numbers for the review page, computed on demand from the running game (nothing here is stored). */
export type Diagnosis = { status: 'building' | 'idle' | 'blocked' | 'n/a'; reasons: { tone: Note['tone']; text: string }[] }
export type RegionStock = { label: string; kind: 'home' | 'island' | 'settlement'; lumber: number; gold: number; meat: number }
export type KDebug = {
  id: number; name: string; title: string; level: number; color: number; emblem: number; isPlayer: boolean; alive: boolean
  temperament: Temperament; aggression: number; agitation: number; ready: boolean; harvest: HarvestMode; harvestCap: number
  home: Record<Res3, number>; total: Record<Res3, number>; regions: RegionStock[]
  power: number; pop: number; cap: number
  towns: number; settlements: number; tiles: number
  units: Record<UnitType, number>; garrisoned: number; cutOff: number; resting: number
  pawns: { total: number; byState: Record<string, number> }
  trees: { standing: number; stumps: number }
  income: { lumberPerMin: number }
  ships: Record<BoatKind, { afloat: number; building: number; moored: number }>
  navy: { points: number; used: number; gun: number; zum: number; zumCap: number }
  yards: { land: number; label: string; have: number; quota: number; holdings: number }[]
  notes: Record<string, Note>
  diagnosis: Diagnosis
  ai: { warGoal: string | null; expedition: string | null; colony: string | null; navalThreat: boolean; shipPhases: Record<string, number> }
  relations: { other: number; relation: Relation }[]
}
export type DebugSnapshot = { time: number; kingdoms: KDebug[]; forest: { standing: number; stumps: number; felled: number; regrown: number }; speed: number }

const cost = { boat: BOAT.cost, barge: BARGE.cost, cargo: CARGO.cost, gunship: GUNSHIP.cost, zumwalt: ZUMWALT.cost }

/** Why is this nation (not) building ships? Combines hard facts (yards, lumber, trees, caps) with what the AI itself said last. */
export function diagnoseNavy(g: Game, k: number, d: { trees: { standing: number; stumps: number }; income: { lumberPerMin: number }; navy: KDebug['navy']; yardCount: number; towns: number }): Diagnosis {
  const kingdom = g.kingdoms[k]
  if (kingdom.isPlayer) return { status: 'n/a', reasons: [] }
  if (!kingdom.alive || d.towns === 0) return { status: 'n/a', reasons: [{ tone: 'wait', text: 'No towns: cannot build ships' }] }
  const reasons: Diagnosis['reasons'] = []
  const lumber = kingdom.lumber, building = g.towers.some(t => t.faction === k && !t.built && (t.kind === 'boat' || t.kind === 'barge' || t.kind === 'cargo' || t.kind === 'gunship' || t.kind === 'zumwalt'))
  if (!d.yardCount) reasons.push({ tone: g.time < 30 ? 'wait' : 'block', text: g.time < 30 ? 'Shipyard not built yet' : 'No shipyard: ships cannot be laid down' })
  const cheapest = Math.min(cost.cargo, cost.boat, cost.gunship)
  if (d.trees.standing === 0) reasons.push({ tone: 'block', text: d.trees.stumps ? `No standing trees in its territory (${d.trees.stumps} stumps will regrow): lumber income has stalled` : 'No trees left in its territory: lumber income has stalled' })
  else if (d.income.lumberPerMin < 1 && lumber < cost.zumwalt) reasons.push({ tone: g.time < 150 ? 'wait' : 'block', text: `Lumber income is ${d.income.lumberPerMin.toFixed(1)}/min with ${d.trees.standing} trees standing (pawns idle or out of reach?)` })
  const h = HARVEST[kingdom.harvest]
  if (lumber > h.cap && lumber < cost.zumwalt + AI.zumReserve && kingdom.harvest !== 'unlimited') reasons.push({ tone: 'block', text: `Harvest mode ${h.label} stops chopping above ${h.cap} lumber, below the ${cost.zumwalt + AI.zumReserve} a Zumwalt needs` })
  if (lumber < cheapest) reasons.push({ tone: 'wait', text: `Lumber ${Math.floor(lumber)} is below the cheapest ship (${cheapest}): saving up` })
  if (d.navy.used >= d.navy.points && d.navy.points > 0) reasons.push({ tone: 'wait', text: `Naval points full (${d.navy.used}/${d.navy.points}): no more gunships or Zumwalts` })
  if (d.navy.zum >= d.navy.zumCap && d.navy.zumCap >= 0) reasons.push({ tone: 'wait', text: `Zumwalt cap reached (${d.navy.zum}/${d.navy.zumCap})` })
  for (const kind of BOAT_KINDS) {
    const p = g.stats.k[k].placement[kind]
    if (p.fails > 0 && g.time - p.lastFailAt < 240) reasons.push({ tone: 'block', text: `Could not find a free spot for a ${kind} ${Math.round(g.time - p.lastFailAt)}s ago (${p.fails}/${p.tries} attempts failed)` })
  }
  for (const [key, n] of Object.entries(g.stats.notes[k])) if (n.tone === 'block' && !reasons.some(r => r.text === n.text)) reasons.push({ tone: n.text.startsWith('Saving') ? 'wait' : 'block', text: `AI (${key}): ${n.text}` })
  const status = building ? 'building' : reasons.some(r => r.tone === 'block') ? 'blocked' : 'idle'
  if (!reasons.length) reasons.push({ tone: 'ok', text: building ? 'A ship is under construction' : 'Nothing wanted right now' })
  return { status, reasons }
}

export function debugSnapshot(g: Game): DebugSnapshot {
  const n = g.kingdoms.length, landName = (L: number) => `Landmass ${L + 1} (${g.info.sizes[L] ?? '?'} tiles)`
  const standing = new Array(n).fill(0), stumps = new Array(n).fill(0)
  let allStanding = 0
  for (const t of g.world.trees) {
    if (!t.chopped) allStanding++
    const c = g.controller[t.cell] - 1
    if (c >= 0) { if (t.chopped) stumps[c]++; else standing[c]++ }
  }
  const S = g.stats.series, last = S.t.length - 1
  const perMin = (k: number) => { // lumber gathered over roughly the last minute of samples
    const a = S.v.gathered[k]; if (last < 1) return 0
    let i = last - 1; while (i > 0 && S.t[last] - S.t[i] < 60) i--
    const dt = S.t[last] - S.t[i]
    return dt > 0 ? ((a[last] - a[i]) / dt) * 60 : 0
  }
  const units = g.kingdoms.map(() => ({ warrior: 0, archer: 0, lancer: 0, knight: 0 } as Record<UnitType, number>)), garrisoned = new Array(n).fill(0), cutOff = new Array(n).fill(0), resting = new Array(n).fill(0)
  for (const u of g.units) { if (u.state === 'dead') continue; units[u.faction][u.type] += u.count; if (u.inTower >= 0 && u.inTower < 1e6) garrisoned[u.faction] += u.count; if (u.cutOff) cutOff[u.faction] += u.count; if (g.resting.has(u.id)) resting[u.faction] += u.count }
  const pawns = g.kingdoms.map(() => ({ total: 0, byState: {} as Record<string, number> }))
  for (const p of g.pawns) { const e = pawns[p.faction]; e.total++; e.byState[p.state] = (e.byState[p.state] ?? 0) + 1 }
  const kingdoms: KDebug[] = g.kingdoms.map(k => {
    const id = k.id, tot = totalStock(g, id), bud = navalBudget(g, id)
    const regions: RegionStock[] = [{ label: `Home (${landName(k.homeLand)})`, kind: 'home', lumber: k.lumber, gold: k.gold, meat: k.meat }]
    for (const [key, s] of g.regionStocks) if (Math.floor(key / 4096) === id) regions.push({ label: landName(key % 4096), kind: 'island', lumber: s.lumber, gold: s.gold, meat: s.meat })
    for (const t of g.towns) if (!t.ruined && t.owner === id && t.store) regions.push({ label: `Settlement lvl ${t.level} (${landName(t.land)})`, kind: 'settlement', lumber: t.store.lumber, gold: t.store.gold, meat: t.store.meat })
    const ships = Object.fromEntries(BOAT_KINDS.map(b => [b, { afloat: 0, building: 0, moored: 0 }])) as KDebug['ships']
    for (const b of g.boats) if (b.faction === id) { ships[b.kind].afloat++; if (b.docked) ships[b.kind].moored++ }
    for (const t of g.towers) if (t.faction === id && !t.built && t.kind in ships) ships[t.kind as BoatKind].building++
    const lands = [...new Set(g.towns.filter(t => !t.ruined && t.owner === id).map(t => t.land))].sort((a, b) => a - b)
    const yards = lands.map(L => ({ land: L, label: landName(L), have: yardsOn(g, id, L), quota: yardQuota(g, id, L), holdings: g.towns.filter(t => !t.ruined && t.owner === id && t.land === L).length }))
    const goal = g.warGoals.get(id), ex = g.expeditions.get(id), col = g.colonies.get(id)
    const phases: Record<string, number> = {}
    for (const [bid, s] of g.aiMemo.ship) { const b = g.boatById(bid); if (b && b.faction === id) phases[`${b.kind}:${s.phase}`] = (phases[`${b.kind}:${s.phase}`] ?? 0) + 1 }
    const towns = g.ownedTowns(id), settlements = g.ownedSettlements(id)
    const base = { trees: { standing: standing[id], stumps: stumps[id] }, income: { lumberPerMin: perMin(id) }, navy: { points: bud.points, used: bud.used, gun: bud.gun, zum: bud.zum, zumCap: bud.zumCap } }
    const t = g.title(id)
    return {
      id, name: k.name, title: t.title, level: t.level, color: k.color, emblem: k.emblem, isPlayer: k.isPlayer, alive: k.alive, temperament: k.temperament, aggression: k.aggression, agitation: k.isPlayer ? 0 : g.agit[id] ?? 0, ready: !!g.ready[id], harvest: k.harvest, harvestCap: HARVEST[k.harvest].cap,
      home: { lumber: k.lumber, gold: k.gold, meat: k.meat }, total: tot, regions, power: k.power, pop: g.pop(id), cap: g.cap(id), towns, settlements, tiles: g.tileCounts[id] ?? 0,
      units: units[id], garrisoned: garrisoned[id], cutOff: cutOff[id], resting: resting[id], pawns: pawns[id], ...base, ships, yards, notes: g.stats.notes[id],
      diagnosis: diagnoseNavy(g, id, { ...base, yardCount: g.yards.filter(q => q.faction === id).length, towns }),
      ai: {
        warGoal: goal && g.towns[goal.target] ? `Target: ${g.towns[goal.target].ruined ? 'ruin' : g.kingdoms[g.towns[goal.target].owner]?.name ?? 'nobody'}'s ${isSettlement(g.towns[goal.target]) ? 'settlement' : 'town'}${goal.allIn ? ' · ALL IN' : ''}${goal.launched ? ' · assault launched' : ''} · ${Math.round(g.time - goal.since)}s` : null,
        expedition: ex && g.towns[ex.target] ? `Sea invasion of ${g.kingdoms[g.towns[ex.target].owner]?.name ?? 'a ruin'} · force ${ex.force}${ex.launched ? ' · launched' : ' · gathering'} · ${Math.round(g.time - ex.since)}s` : null,
        colony: col ? `${col.kind === 'found' ? 'Founding' : 'Reinforcing'} a settlement · phase ${col.phase} · ${Math.round(g.time - col.since)}s` : null,
        navalThreat: g.navalThreat.has(id), shipPhases: phases,
      },
      relations: g.kingdoms.filter(o => o.id !== id).map(o => ({ other: o.id, relation: g.diplomacy.get(id, o.id) })).filter(r => r.relation !== 'neutral'),
    }
  })
  return { time: g.time, kingdoms, forest: { standing: allStanding, stumps: g.stumps.length, felled: g.stats.felled, regrown: g.stats.regrown }, speed: g.speed }
}
export { UNIT_TYPES }
