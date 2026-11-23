import { boostHarvest, placeShip } from './AISystem'
import { aiNote } from './Stats'
import { cargoCount, isWaterCell, orderSail, unload } from './BoatSystem'
import { CARGO, GOLD, GUNSHIP, MEAT, SETTLE, TILE, TOWER, BOAT } from './config'
import { bestSettlementSite, isSettlement, stockAt, waterWithin, placeSettlement, settlementError, upgradeError, upgradeTown } from './Economy'
import type { Game } from './Game'
import { portFor, setTradeRoute } from './Trade'
import { navalBudget, yardBerth } from './Yards'
import { manageEvac } from './Evac'
import type { Boat, Town, Unit } from './types'

/** There is no cap on colonies: a nation keeps founding while its old ones are healthy. How soon it starts and how long it rests between projects depends on its temperament. */
/** Lumber a nation needs in hand before it runs a second colony project beside the first. */
const PARALLEL_LUMBER = 300
const PACE = { pacifist: { start: 60, rest: 90 }, neutral: { start: 40, rest: 45 }, imperialist: { start: 20, rest: 12 } }

const tiles = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / TILE

/**
 * Colonies, trade and piracy for one AI kingdom (called from the planner a few times a second).
 *  - Colony: build a cargo boat and an infantry boat, load troops and meat, sail to an empty island (preferring one with gold), land the
 *    troops, plant a settlement beside them and set the cargo boat on a standing meat run from home. Level 1 settlements are upgraded as
 *    soon as their store holds the lumber.
 *  - Aggressive and imperialist nations keep a gunship or two: they escort their cargo boats and hunt the cargo boats of nations they fight.
 */
export function manageColonies(g: Game, k: number, mine: Unit[]) {
  const kingdom = g.kingdoms[k]
  if (kingdom.isPlayer) return
  manageEvac(g, k, mine)
  upgradeSettlements(g, k)
  manageTrade(g, k)
  managePirates(g, k)
  if (g.aiMemo.fleetFirst.has(k)) return // saving for a Zumwalt (arms race / lost fleet): no new colonies until the fleet is back
  runColony(g, k, mine, 0)
  runColony(g, k, mine, 1)
}

/** A level 2+ settlement raises up to SETTLE.maxTowers archer towers of its own, paid from its own store, a few tiles out from the village (toward the sea first, where landings come). */
function settlementTowers(g: Game, k: number) {
  if (g.tickCount % 50 !== (k * 7) % 50) return
  for (const t of g.towns) {
    if (t.owner !== k || t.ruined || !isSettlement(t) || t.level < 2) continue
    const have = g.towers.filter(q => q.kind === 'tower' && q.town === t.id).length
    if (have >= SETTLE.maxTowers || stockAt(g, k, t.x, t.y).lumber < TOWER.cost) continue
    if (g.towers.some(q => q.kind === 'tower' && q.town === t.id && !q.built)) continue // one at a time
    let best: { x: number; y: number } | null = null, bs = -Infinity
    for (let a = 0; a < 16; a++) for (const r of [TOWER.minTownGap + 0.5, TOWER.minTownGap + 2, TOWER.minTownGap + 3.5]) {
      const x = t.x + Math.cos((a / 16) * Math.PI * 2) * r * TILE, y = t.y + Math.sin((a / 16) * Math.PI * 2) * r * TILE
      if (g.structureError('tower', k, x, y)) continue
      const apart = g.towers.filter(q => q.kind === 'tower' && q.town === t.id).reduce((m, q) => Math.min(m, Math.hypot(q.x - x, q.y - y)), 99 * TILE) // the second tower stands away from the first
      const score = Math.min(apart, 8 * TILE) / TILE - (waterWithin(g, Math.floor(x / TILE), Math.floor(y / TILE), 6) ? 0 : 3)
      if (score > bs) { bs = score; best = { x, y } }
    }
    if (best) g.placeTower(k, best.x, best.y)
    return // (a few towers per tick at most)
  }
}

function upgradeSettlements(g: Game, k: number) {
  settlementTowers(g, k)
  for (const t of g.towns) if (t.owner === k && !t.ruined && isSettlement(t) && t.level < SETTLE.maxLevel && !upgradeError(g, k, t.id)) upgradeTown(g, k, t.id)
  for (const t of g.towns) if (t.owner === k && !t.ruined && !isSettlement(t) && t.level < 2 && !upgradeError(g, k, t.id)) { upgradeTown(g, k, t.id); break } // gold buys level 2 towns: more territory, trees and naval slots
}

const homeTown = (g: Game, k: number): Town | null => g.towns.find(t => t.owner === k && !t.ruined && !isSettlement(t)) ?? null

// ---------------------------------------------------------------- trade: every outpost is fed, supplied and drained of gold
function manageTrade(g: Game, k: number) {
  const kingdom = g.kingdoms[k]
  const settlements = g.towns.filter(t => t.owner === k && !t.ruined && isSettlement(t))
  if (!settlements.length) return
  const colony = g.colonies.get(k)
  const cargo = g.boats.filter(b => b.faction === k && b.kind === 'cargo' && b.id !== colony?.cargo)
  const sites = g.towers.filter(t => t.faction === k && t.kind === 'cargo').length
  const wanted = cargoWanted(settlements.length) // enough boats to feed every colony in turn
  const starving = settlements.some(t => t.store!.meat < 7)
  if (cargo.length + sites < wanted && kingdom.lumber >= CARGO.cost + (starving || !cargo.length ? 5 : 30) && !sites) aiNote(g, k, 'cargo', placeShip(g, k, 'cargo') ? 'ok' : 'block', 'Laying down a cargo boat (or no free spot)')
  else aiNote(g, k, 'cargo', cargo.length + sites >= wanted ? 'ok' : sites ? 'ok' : 'block', cargo.length + sites >= wanted ? `Cargo boats: ${cargo.length}/${wanted}` : sites ? 'A cargo boat is under construction' : `Saving lumber for a cargo boat: ${Math.floor(kingdom.lumber)} / ${CARGO.cost + 30}`)
  if (!homeTown(g, k)) return
  const served = () => new Set(g.boats.filter(q => q.faction === k && q.trade).map(q => q.trade!.b))
  const route = (b: Boat, target: Town) => {
    const home = bestHome(g, k, target)
    if (!home) return
    const needs = target.level < 3 ? SETTLE.upgradeCost[target.level - 1] - target.store!.lumber : 0
    const lumber = needs > 0 && kingdom.lumber >= 150 ? Math.min(100, needs) : 0 // (a higher level means more hit points and a bigger garrison)
    setTradeRoute(g, b, home.id, target.id, { lumber, gold: 0, meat: Math.min(CARGO.cap.meat, MEAT.store) }, { lumber: 0, gold: CARGO.cap.gold, meat: 0 })
  }
  // 1) every idle cargo boat serves the neediest settlement that has no boat on its way (whatever its level: a settlement is fed for as long as it stands)
  for (const b of cargo) {
    if (b.trade) continue
    const target = settlements.filter(t => !served().has(t.id)).sort((a, c) => a.store!.meat - c.store!.meat)[0]
    if (target) route(b, target)
  }
  // 2) a settlement running low with nobody coming: a boat serving a well-stocked one is sent to it instead
  const hungry = settlements.filter(t => t.store!.meat < 7 && !served().has(t.id)).sort((a, c) => a.store!.meat - c.store!.meat)[0]
  if (hungry) {
    const donor = cargo.filter(b => b.trade && (g.towns[b.trade.b]?.store?.meat ?? 0) > 14 && b.load.meat < 1).sort((a, c) => (g.towns[c.trade!.b]?.store?.meat ?? 0) - (g.towns[a.trade!.b]?.store?.meat ?? 0))[0]
    if (donor) route(donor, hungry)
  }
  // 3) a boat waiting at a dry quay (no meat left at its home region) loads where the nation does have meat
  for (const b of cargo) {
    const tr = b.trade
    if (!tr || tr.leg !== 'loadA' || tr.wait < 40 || b.load.meat >= 1) continue
    const ta = g.towns[tr.a], target = g.towns[tr.b]
    if (!ta || !target || stockAt(g, k, ta.x, ta.y).meat >= 1) continue
    const alt = bestHome(g, k, target)
    if (alt && alt.id !== ta.id && stockAt(g, k, alt.x, alt.y).meat >= 8) route(b, target)
  }
}

/** The town a cargo boat loads at for a settlement: the one (on another island) whose stockpile holds the most meat, nearest on a tie. */
function bestHome(g: Game, k: number, target: Town): Town | null {
  let best: Town | null = null, bm = -1, bd = Infinity
  for (const t of g.towns) {
    if (t.owner !== k || t.ruined || isSettlement(t) || t.land === target.land) continue
    const m = Math.min(stockAt(g, k, t.x, t.y).meat, 30), d = Math.hypot(t.x - target.x, t.y - target.y)
    if (m > bm + 1 || (Math.abs(m - bm) <= 1 && d < bd)) { bm = m; bd = d; best = t }
  }
  return best
}

// ---------------------------------------------------------------- escorts and pirates
/**
 * Gunships: small escorts. A nation keeps 3 bonded gunships for every Zumwalt it owns (up to 12) alongside it, more while enemy warships are about,
 * and imperialists keep one for their cargo runs. Their orders (flanks, hunting, patrol) are in NavyAI.ts.
 */
export function gunshipsWanted(g: Game, k: number): number {
  const kingdom = g.kingdoms[k]
  const zums = g.boats.filter(b => b.faction === k && b.kind === 'zumwalt').length + g.towers.filter(t => t.faction === k && t.kind === 'zumwalt').length
  const threat = g.navalThreat.has(k) ? 3 : 0
  // an enemy Zumwalt is only ever hunted by a squadron (never a lone gunship): a nation facing one keeps at least three
  const foeZums = g.boats.filter(b => b.kind === 'zumwalt' && b.hp > 0 && g.hostile(k, b.faction)).length
  const vsZum = foeZums > 0 ? Math.min(9, 3 * Math.min(foeZums, 2)) : 0
  const caps = navalBudget(g, k), bsN = g.boats.filter(b => b.faction === k && b.kind === 'battleship').length + g.towers.filter(t => t.faction === k && t.kind === 'battleship').length
  if (zums > 0 || bsN > 0) return Math.max(threat, vsZum, caps.gunCap) // a nation with big ships fills its whole gunboat allowance (see FLEET_TABLE): escorts, wave hunters, patrols
  const cargo = g.boats.some(b => b.faction === k && b.kind === 'cargo')
  return Math.max(threat, vsZum, kingdom.temperament === 'imperialist' && cargo ? 1 : 0)
}

function managePirates(g: Game, k: number) {
  const kingdom = g.kingdoms[k]
  const ships = g.boats.filter(b => b.faction === k && b.kind === 'gunship')
  const sites = g.towers.filter(s => s.faction === k && s.kind === 'gunship').length
  const gwant = g.aiMemo.fleetFirst.has(k) ? Math.min(gunshipsWanted(g, k), g.boats.filter(b => b.faction === k && b.kind === 'zumwalt' && b.hp > 0).length) : gunshipsWanted(g, k) // (saving for a Zumwalt: one escort each, no more)
  if ((g.time > 90 || g.navalThreat.has(k)) && ships.length + sites < gwant && !sites && kingdom.lumber >= GUNSHIP.cost + 30) aiNote(g, k, 'gunship', placeShip(g, k, 'gunship') ? 'ok' : 'block', 'Laying down a gunship (or no free spot)')
  else if (ships.length + sites >= gwant) aiNote(g, k, 'gunship', 'ok', gwant === 0 ? 'None wanted (no Zumwalts to escort)' : `Gunships: ${ships.length}/${gwant}`)
  else if (g.time <= 90 && !g.navalThreat.has(k)) aiNote(g, k, 'gunship', 'wait', 'Too early (starts at 90s)')
  else aiNote(g, k, 'gunship', sites ? 'ok' : 'block', sites ? 'A gunship is under construction' : `Saving lumber for a gunship: ${Math.floor(kingdom.lumber)} / ${GUNSHIP.cost + 30}`)
}

// ---------------------------------------------------------------- the colony project
/** Empty land masses a kingdom could settle, best first: gold nearby counts a lot, distance from the nearest thing it already holds counts against. */
export function pickLand(g: Game, k: number): number {
  const held = g.towns.filter(t => t.owner === k && !t.ruined)
  const mineLands = new Set(held.map(t => t.land))
  if (!held.length) return -1
  const targeted = new Map<number, number>() // islands other nations are already sailing for
  for (const c of g.colonies.values()) if (c.phase !== 'done' && c.kind === 'found') targeted.set(c.land, (targeted.get(c.land) ?? 0) + 1)
  let best = -1, bs = Infinity
  const goldOn = new Map<number, number>()
  for (const d of g.goldDeps) if (!d.taken) { const L = g.info.landmass[d.cell]; goldOn.set(L, (goldOn.get(L) ?? 0) + d.amount) }
  for (let L = 0; L < g.info.sizes.length; L++) {
    if (g.info.sizes[L] < 24 || mineLands.has(L)) continue
    if (g.towns.some(t => !t.ruined && t.land === L && !isSettlement(t))) continue // a real town lives there
    const rivals = g.towns.filter(t => !t.ruined && t.land === L && isSettlement(t) && t.owner !== k).length // another kingdom's outpost: the island can be shared, but second pick
    const c = g.info.centers[L], d = Math.min(...held.map(t => tiles(c, t)))
    if (d > COLONY_RANGE) continue
    const sc = d - Math.min(60, (goldOn.get(L) ?? 0) * 4) + rivals * 25 + (targeted.get(L) ?? 0) * 60 // the best gold decides; a shared or contested island is a poor choice
    if (sc < bs) { bs = sc; best = L }
  }
  return best
}
const COLONY_RANGE = 140 // tiles from the nearest holding (the archipelago is 200 wide)

/** Open-sea water cell beside the target land mass that is nearest to a point, skipping beaches already found blocked. */
function coastSpot(g: Game, land: number, from: { x: number; y: number }, avoid: number[] = [], apart?: { x: number; y: number }): { x: number; y: number; cell: number } | null {
  const { w, h } = g.world
  let best: { x: number; y: number; cell: number } | null = null, bd = Infinity
  for (let cy = 1; cy < h - 1; cy++) for (let cx = 1; cx < w - 1; cx++) {
    const i = cy * w + cx
    if (g.world.land[i] || !g.info.sea[i] || avoid.includes(i)) continue
    if (![-1, 1, -w, w].some(o => g.world.land[i + o] && g.info.landmass[i + o] === land)) continue
    const x = (cx + 0.5) * TILE, y = (cy + 0.5) * TILE
    if (apart && Math.hypot(x - apart.x, y - apart.y) < 4 * TILE) continue // the second boat takes a different beach (two hulls cannot moor at one spot)
    // beaches near another kingdom's units are poor choices (they would hold the boat off the shore)
    const guarded = g.units.some(u => u.state !== 'dead' && u.inTower < 0 && !g.diplomacy.allied(u.faction, currentK) && Math.hypot(u.x - x, u.y - y) < 4 * TILE)
    const d = Math.hypot(x - from.x, y - from.y) + (guarded ? 40 * TILE : 0)
    if (d < bd) { bd = d; best = { x, y, cell: i } }
  }
  return best
}
/** The beach spot for a boat of kingdom `k` (see coastSpot). */
export function coastSpotFor(g: Game, k: number, land: number, from: { x: number; y: number }, avoid: number[] = []) { currentK = k; return coastSpot(g, land, from, avoid) }
let currentK = 0 // (the kingdom whose colony is being run: set by runColony)

const AI_EXPAND_AFTER = 80
/** A Zumwalt is without its three gunships (built or on the stocks) and the nation could still afford more. */
function squadShort(g: Game, k: number): boolean {
  const zums = g.boats.filter(b => b.faction === k && b.kind === 'zumwalt' && b.hp > 0).length
  if (!zums) return false
  const guns = g.boats.filter(b => b.faction === k && b.kind === 'gunship' && b.hp > 0).length + g.towers.filter(t => t.faction === k && t.kind === 'gunship' && !t.built).length
  return guns < 3 * zums && navalBudget(g, k).canGunship
}
/** Expansion is only efficient while the old colonies are looked after: none starving or unmanned, and enough cargo boats to feed them all. */
export function coloniesHealthy(g: Game, k: number): boolean {
  const mine = g.towns.filter(t => t.owner === k && !t.ruined && isSettlement(t))
  if (mine.some(t => t.meatT > SETTLE.decaySeconds * 0.25 || t.store!.meat < 2)) return false
  // the sheep must be able to feed them: a settlement eats MEAT.eat per MEAT.eatPeriod, a town's sheep give MEAT.yield per MEAT.period
  const towns = g.ownedTowns(k)
  if ((mine.length + 1) * (MEAT.eat / MEAT.eatPeriod) > towns * (MEAT.yield / MEAT.period) * 0.85) return false
  const cargo = g.boats.filter(b => b.faction === k && b.kind === 'cargo').length
  return cargo >= Math.min(cargoWanted(mine.length), Math.ceil(mine.length * 0.4))
}
/** One cargo boat per two settlements (plus one), at most 12: a boat finishes a run and takes the neediest colony next. */
const cargoWanted = (settlements: number) => Math.min(12, Math.ceil(settlements * 0.5) + (settlements ? 1 : 0))
const BOARD_HP = 0.4 // wounded troops may sail: a colony is where they heal
const GARRISON_WANT = [3, 4, 5] // troops each settlement level should keep beside it

/** Archer towers beside a settlement with nobody in them, and how many of our archers are close enough to fill them. */
const emptyTowers = (g: Game, t: Town) => g.towers.filter(q => q.kind === 'tower' && q.town === t.id && q.archer < 0).length
const archersNear = (g: Game, t: Town) => g.units.filter(u => u.faction === t.owner && u.type === 'archer' && u.state !== 'dead' && u.inTower < 0 && Math.hypot(u.x - t.x, u.y - t.y) <= 14 * TILE).length
/** Troops of a kingdom standing beside a settlement. */
const garrisonOf = (g: Game, t: Town) => g.units.filter(u => u.faction === t.owner && u.state !== 'dead' && u.inTower < 0 && Math.hypot(u.x - t.x, u.y - t.y) <= SETTLE.troopTiles * TILE).length

/** One colony project; `slot` 1 is the second, parallel one a rich nation runs (founding only). Projects are stored under k + 100 * slot. */
function runColony(g: Game, k: number, mine: Unit[], slot = 0) {
  currentK = k
  const kingdom = g.kingdoms[k], key = k + 100 * slot
  let c = g.colonies.get(key)
  let prevKind: string | null = null
  if (c && c.phase === 'done') { if (g.time - c.since < PACE[kingdom.temperament].rest) return; prevKind = c.kind; g.colonies.delete(key); c = undefined }
  if (!c) {
    const imperial = kingdom.temperament === 'imperialist'
    if (slot === 1 && (!(g.colonies.get(k) && g.colonies.get(k)!.phase !== 'done') || kingdom.lumber < PARALLEL_LUMBER || g.time < PACE[kingdom.temperament].start)) return // (the second project only runs beside a first one, and only on spare lumber)
    const start = (p: { kind: 'found' | 'reinforce'; land: number; settlement?: number }) => { g.colonies.set(key, { kind: p.kind, phase: 'build', land: p.land, since: g.time, spot: null, cargo: -1, boat: -1, settlement: p.settlement ?? -1 }) }
    // 1) a lost outpost is re-established (whatever the limit), 2) an understaffed outpost gets troops, 3) a new colony
    const lost = slot === 1 ? undefined : g.lostColonies.find(l => l.owner === k && g.time - l.at > 20)
    if (lost && kingdom.lumber >= SETTLE.cost + CARGO.cost + BOAT.cost + 20 && !g.towns.some(t => !t.ruined && t.land === lost.land && !isSettlement(t))) { g.lostColonies = g.lostColonies.filter(l => l !== lost); start({ kind: 'found', land: lost.land }); return }
    if (lost && g.towns.some(t => !t.ruined && t.land === lost.land && (!isSettlement(t) || t.owner === k))) g.lostColonies = g.lostColonies.filter(l => l !== lost) // somebody settled it already
    const weak = g.towns.filter(t => t.owner === k && !t.ruined && isSettlement(t) && (garrisonOf(g, t) < GARRISON_WANT[t.level - 1] - 1 || emptyTowers(g, t) > archersNear(g, t)) && mine.length > 4).sort((a, b) => garrisonOf(g, a) - garrisonOf(g, b))[0]
    const canReinforce = slot === 0 && !!weak && kingdom.lumber >= BOAT.cost + 20
    if (canReinforce && prevKind !== 'reinforce') { start({ kind: 'reinforce', land: weak!.land, settlement: weak!.id }); return } // (a reinforcement run never follows another: founding gets its turn)
    if (g.time < PACE[kingdom.temperament].start || g.ownedTowns(k) < 1) return
    if (!imperial && g.kingdoms.some(o => o.id !== k && o.alive && g.hostile(k, o.id) && g.ownedTowns(k) < 4)) return // busy fighting for its life (imperialists expand regardless)
    if (!coloniesHealthy(g, k)) { aiNote(g, k, 'colony', 'wait', 'Tending the old colonies before founding another'); if (canReinforce) start({ kind: 'reinforce', land: weak!.land, settlement: weak!.id }); return }
    const land = pickLand(g, k)
    if (land < 0) { if (canReinforce) start({ kind: 'reinforce', land: weak!.land, settlement: weak!.id }); return }
    if (squadShort(g, k) && kingdom.lumber < 220) { aiNote(g, k, 'colony', 'wait', 'Finishing the Zumwalt squad (gunships) before founding another colony'); boostHarvest(g, k); return } // (the fleet's escorts come first: a Zumwalt without its squad sits idle)
    if (kingdom.lumber < CARGO.cost + BOAT.cost + 30) { boostHarvest(g, k); return } // save up quickly (the pawns chop flat out); the settlement's 100 lumber is only needed on arrival
    start({ kind: 'found', land })
    return
  }
  const fail = () => { c!.phase = 'done'; c!.since = g.time; c!.boat = -1; c!.cargo = -1 }
  const limit = { build: 700, load: 200, sail: 330, found: 200, done: 1e9 }[c.phase] // (build waits for lumber: a poor nation saves up rather than giving up)
  if (g.time - c.since > limit) return fail() // a stuck project never blocks the nation: it is dropped and the next one (or anything else) goes ahead
  const cargoB = g.boatById(c.cargo), shipB = g.boatById(c.boat)
  const reinforce = c.kind === 'reinforce'
  switch (c.phase) {
    case 'build': {
      const home = homeTown(g, k)
      if (!home) return fail()
      const other = g.colonies.get(k + 100 * (1 - slot)), taken = new Set([other?.boat ?? -1, other?.cargo ?? -1])
      const free = g.boats.filter(b => b.faction === k && b.docked && !taken.has(b.id))
      const cargo = reinforce ? null : free.find(b => b.kind === 'cargo' && !b.trade)
      const usable = (u: Unit) => u.type !== 'archer' && u.aiRole === '' && !u.cutOff && u.hp >= u.maxHp * BOARD_HP && u.boardBoat < 0
      const troopsBy = (b: Boat) => { const L = b.dockCell >= 0 ? g.info.landmass[b.dockCell] : -1; return mine.filter(u => usable(u) && g.info.landmass[g.cellAt(u.x, u.y)] === L && Math.hypot(u.x - b.x, u.y - b.y) < 45 * TILE).length }
      const infantry = free.filter(b => b.kind === 'boat' && b.cargo.length === 0 && g.aiMemo.ship.get(b.id)?.phase !== 'sail').sort((a, b) => troopsBy(b) - troopsBy(a))[0] // the boat with the most troops beside it
      if (!infantry) { // a boat parked afloat by the yard tidier: call it back to a berth
        const idle = g.boats.find(b => b.faction === k && b.kind === 'boat' && !b.docked && !b.docking && b.route.length === 0 && b.cargo.length === 0 && g.aiMemo.ship.get(b.id)?.phase !== 'sail')
        const berth = idle ? yardBerth(g, k, idle) : null
        if (idle && berth) { idle.noDock = false; orderSail(g, idle, [berth.x, berth.y]) }
      }
      const army = mine.filter(u => u.type !== 'archer')
      const near = army.length ? { x: army.reduce((n, u) => n + u.x, 0) / army.length, y: army.reduce((n, u) => n + u.y, 0) / army.length } : undefined
      if (!reinforce && !cargo && !g.towers.some(t => t.faction === k && t.kind === 'cargo') && kingdom.lumber >= CARGO.cost + 20) placeShip(g, k, 'cargo', near)
      const boatCount = g.boats.filter(b => b.faction === k && b.kind === 'boat').length
      if ((!infantry || troopsBy(infantry) < 2) && boatCount < 4 && !g.towers.some(t => t.faction === k && t.kind === 'boat') && kingdom.lumber >= BOAT.cost + 20) placeShip(g, k, 'boat', near) // (no boat has troops beside it: another is laid down where the army is)
      const waitedBuild = g.time - c.since > 60
      if (infantry && (reinforce || cargo) && (troopsBy(infantry) >= 2 || waitedBuild)) {
        c.boat = infantry.id; c.phase = 'load'; c.since = g.time
        if (cargo) { c.cargo = cargo.id; cargo.want = { lumber: kingdom.lumber >= 350 ? 100 : 0, gold: 0, meat: 10 } } // meat for the larder, lumber toward the first upgrade
      }
      break
    }
    case 'load': {
      if (!shipB || (!reinforce && !cargoB)) return fail()
      if (!shipB.docked || (cargoB && !cargoB.docked)) break
      const boatLand = shipB.dockCell >= 0 ? g.info.landmass[shipB.dockCell] : -1
      const aboard = cargoCount(g, shipB) + mine.filter(u => u.boardBoat === shipB.id).length
      const need = reinforce ? Math.max(2, Math.min(6, GARRISON_WANT[(g.towns[c.settlement]?.level ?? 1) - 1] - garrisonOf(g, g.towns[c.settlement]) + Math.max(0, emptyTowers(g, g.towns[c.settlement]) - archersNear(g, g.towns[c.settlement])))) : 3
      if (aboard < need) {
        let archerSlots = reinforce ? Math.max(0, emptyTowers(g, g.towns[c.settlement]) - archersNear(g, g.towns[c.settlement])) : 0 // (a reinforcement also brings archers for the settlement's empty towers)
        const pool = mine.filter(u => (u.type !== 'archer' || (archerSlots-- > 0 && u.count === 1)) && u.aiRole === '' && !u.cutOff && u.hp >= u.maxHp * BOARD_HP && u.boardBoat < 0 && !c.skip?.includes(u.id) && Math.hypot(u.x - shipB.x, u.y - shipB.y) < 45 * TILE && g.info.landmass[g.cellAt(u.x, u.y)] === boatLand)
        if (!pool.length && aboard === 0 && !mine.some(u => u.boardBoat === shipB.id) && g.time - c.since > 25) return fail() // nobody to send: give the boat up and try again (another boat, or the troops have healed)
        for (const u of pool.slice(0, need - aboard)) if (shipB.dockCell >= 0 && g.orderMoveTo(u, (shipB.dockCell % g.world.w + 0.5) * TILE, (Math.floor(shipB.dockCell / g.world.w) + 0.5) * TILE)) { u.boardBoat = shipB.id; u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + 150) }
      }
      // a walker that went idle far from the boat (no path to the mooring) is let go and not asked again; the project tries other troops
      c.walkSince ??= new Map()
      for (const u of mine) if (u.boardBoat === shipB.id) {
        const since = c.walkSince.get(u.id) ?? g.time; c.walkSince.set(u.id, since)
        if (g.time - since > 25 && Math.hypot(u.x - shipB.x, u.y - shipB.y) > 3 * TILE && (u.state === 'idle' || g.time - since > 60)) { u.boardBoat = -1; if (u.aiRole === 'respond') { u.aiRole = ''; g.aiMemo.respond.delete(u.id) } (c.skip ??= []).push(u.id); c.walkSince.delete(u.id) }
      }
      for (const u of mine) if (u.boardBoat === shipB.id && shipB.dockCell >= 0 && g.tickCount % 100 === u.id % 100 && u.state === 'idle') g.orderMoveTo(u, (shipB.dockCell % g.world.w + 0.5) * TILE, (Math.floor(shipB.dockCell / g.world.w) + 0.5) * TILE) // (a walker that got distracted is sent again)
      const fed = reinforce || (cargoB!.load.meat >= Math.min(10, Math.max(5, kingdom.meat)) && (cargoB!.want.lumber <= 0 || cargoB!.load.lumber >= Math.min(cargoB!.want.lumber, kingdom.lumber - 120) - 1)) || g.time - c.since > 70
      if (cargoCount(g, shipB) >= 1 && fed && (aboard >= Math.min(need, 2) || g.time - c.since > 50)) { // (two troops are enough to start; one will do after a wait)
        const target = reinforce ? g.towns[c.settlement] : null
        const spot = coastSpot(g, c.land, shipB, c.avoid)
        if (!spot || (reinforce && (!target || target.ruined))) return fail()
        c.spot = spot
        const spot2 = cargoB ? coastSpot(g, c.land, cargoB, c.avoid, spot) ?? spot : null
        c.spot2 = spot2
        shipB.noDock = false; if (cargoB) cargoB.noDock = false // (a ship told to stay afloat would never moor on the beach)
        const ok = orderSail(g, shipB, [spot.x, spot.y]) && (!cargoB || orderSail(g, cargoB, [spot2!.x, spot2!.y]))
        if (ok) { c.phase = 'sail'; c.since = g.time } else fail()
      }
      break
    }
    case 'sail': {
      if (!shipB || (!reinforce && !cargoB)) return fail()
      if (shipB.docked && shipB.cargo.length) unload(g, shipB)
      // a beach held by someone else's troops keeps our boat off the shore: after 10 s pick another beach
      const blocked = [shipB, cargoB].some(b => b && b.docking && !b.docked && b.dockBlocked)
      if (blocked) {
        c.blockedSince = c.blockedSince ?? g.time
        if (g.time - c.blockedSince > 10 && c.spot) {
          c.avoid = [...(c.avoid ?? []), g.cellAt(c.spot.x, c.spot.y)]
          const alt = coastSpot(g, c.land, shipB, c.avoid)
          c.blockedSince = undefined
          if (alt && (c.avoid.length < 6)) { c.spot = alt; c.spot2 = cargoB ? coastSpot(g, c.land, cargoB, c.avoid, alt) ?? alt : null; if (!shipB.docked) orderSail(g, shipB, [alt.x, alt.y]); if (cargoB && !cargoB.docked && c.spot2) orderSail(g, cargoB, [c.spot2.x, c.spot2.y]) } else return fail()
        }
      } else c.blockedSince = undefined
      const arrived = shipB.docked && (reinforce || (cargoB!.docked && cargoB!.route.length === 0))
      if (arrived) { c.phase = 'found'; c.since = g.time }
      else {
        if (!shipB.docked && !shipB.docking && shipB.route.length === 0 && c.spot) orderSail(g, shipB, [c.spot.x, c.spot.y]) // retry if a route fell through
        if (cargoB && !cargoB.docked && !cargoB.docking && cargoB.route.length === 0 && (c.spot2 ?? c.spot)) { const sp = (c.spot2 ?? c.spot)!; orderSail(g, cargoB, [sp.x, sp.y]) }
      }
      break
    }
    case 'found': {
      const landed = mine.filter(u => u.faction === k && u.state !== 'dead' && u.inTower < 0 && g.info.landmass[g.cellAt(u.x, u.y)] === c.land)
      if (reinforce) { // the troops walk to the outpost and stay
        const t = g.towns[c.settlement]
        if (!t || t.ruined) return fail()
        for (const u of landed) { u.boardBoat = -1; if (u.type === 'archer') continue; u.aiRole = 'post'; u.post = t.id; u.hold = false } // the troops stand guard there for good (Garrison.ts)
        if (landed.length || g.time - c.since > 60) { c.phase = 'done'; c.since = g.time; c.boat = -1 }
        break
      }
      if (!cargoB) return fail()
      if (!landed.length) break
      const site = bestSettlementSite(g, k, c.land, landed[0])
      if (!site) return g.time - c.since > 60 ? fail() : undefined
      if (kingdom.lumber < SETTLE.cost) boostHarvest(g, k) // the troops are ashore: chop flat out for the 100 lumber
      const placed = settlementError(g, k, site.x, site.y) === null ? placeSettlement(g, k, site.x, site.y) : null
      if (placed) {
        c.settlement = placed.id
        for (const u of mine.filter(q => q.state !== 'dead' && q.type !== 'archer' && g.info.landmass[g.cellAt(q.x, q.y)] === c.land).sort((a, b) => tiles(a, placed) - tiles(b, placed)).slice(0, GARRISON_WANT[0] + 1)) { u.aiRole = 'post'; u.post = placed.id; u.hold = false; u.boardBoat = -1 } // the landing party stays as its garrison
        const home = homeTown(g, k)
        if (home && portFor(g, placed)) setTradeRoute(g, cargoB, home.id, placed.id, { lumber: 0, gold: 0, meat: 20 }, { lumber: 0, gold: CARGO.cap.gold, meat: 0 })
        c.phase = 'done'; c.since = g.time; c.boat = -1; c.cargo = -1
        if (shipB && shipB.docked) g.aiMemo.ship.delete(shipB.id)
      } else if (g.time - c.since > 180) fail() // (a little longer: the lumber may still be coming in)
      break
    }
  }
}
