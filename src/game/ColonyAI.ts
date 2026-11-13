import { boostHarvest, placeShip } from './AISystem'
import { aiNote } from './Stats'
import { cargoCount, isWaterCell, orderSail, unload } from './BoatSystem'
import { CARGO, GOLD, GUNSHIP, MEAT, SETTLE, TILE, BOAT } from './config'
import { bestSettlementSite, isSettlement, placeSettlement, settlementError, upgradeError, upgradeTown } from './Economy'
import type { Game } from './Game'
import { portFor, setTradeRoute } from './Trade'
import type { Boat, Town, Unit } from './types'

/** How many overseas settlements a temperament is willing to run (pacifists stay home). */
const SETTLE_LIMIT = { pacifist: 1, neutral: 2, imperialist: 4 } // every nation may found settlements; imperialists make it a first priority
const COLONY_COOLDOWN = 25

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
  upgradeSettlements(g, k)
  manageTrade(g, k)
  managePirates(g, k)
  runColony(g, k, mine)
}

function upgradeSettlements(g: Game, k: number) {
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
  const wanted = Math.min(8, settlements.length) // one cargo boat per settlement: every one of them is fed
  if (cargo.length + sites < wanted && kingdom.lumber >= CARGO.cost + 30 && !sites) aiNote(g, k, 'cargo', placeShip(g, k, 'cargo') ? 'ok' : 'block', 'Laying down a cargo boat (or no free spot)')
  else aiNote(g, k, 'cargo', cargo.length + sites >= wanted ? 'ok' : sites ? 'ok' : 'block', cargo.length + sites >= wanted ? `Cargo boats: ${cargo.length}/${wanted}` : sites ? 'A cargo boat is under construction' : `Saving lumber for a cargo boat: ${Math.floor(kingdom.lumber)} / ${CARGO.cost + 30}`)
  const home = homeTown(g, k)
  if (!home) return
  for (const b of cargo) {
    if (b.trade) continue
    // the neediest settlement with no ship on its way: meat always, lumber while it still has levels to climb, and its gold comes home
    const served = new Set(g.boats.filter(q => q.faction === k && q.trade).map(q => q.trade!.b))
    const target = settlements.filter(t => !served.has(t.id)).sort((a, c) => a.store!.meat - c.store!.meat)[0]
    if (!target) continue
    const needs = target.level < 3 ? SETTLE.upgradeCost[target.level - 1] - target.store!.lumber : 0
    const lumber = needs > 0 && kingdom.lumber >= 150 ? Math.min(100, needs) : 0 // (a higher level means more hit points and a bigger garrison)
    setTradeRoute(g, b, home.id, target.id, { lumber, gold: 0, meat: Math.min(CARGO.cap.meat, MEAT.store) }, { lumber: 0, gold: CARGO.cap.gold, meat: 0 })
  }
}

// ---------------------------------------------------------------- escorts and pirates
/**
 * Gunships: small escorts. A nation keeps 3 for every Zumwalt it owns (at least 2, up to 9) alongside it, more while enemy warships are about,
 * and imperialists keep one for their cargo runs. Their orders (flanks, hunting, patrol) are in NavyAI.ts.
 */
export function gunshipsWanted(g: Game, k: number): number {
  const kingdom = g.kingdoms[k]
  const zums = g.boats.filter(b => b.faction === k && b.kind === 'zumwalt').length + g.towers.filter(t => t.faction === k && t.kind === 'zumwalt').length
  const threat = g.navalThreat.has(k) ? 3 : 0
  // an enemy Zumwalt is only ever hunted by a squadron (never a lone gunship): a nation facing one keeps at least three
  const foeZums = g.boats.filter(b => b.kind === 'zumwalt' && b.hp > 0 && g.hostile(k, b.faction)).length
  const vsZum = foeZums > 0 ? Math.min(9, 3 * Math.min(foeZums, 2)) : 0
  if (zums > 0) return Math.min(9, Math.max(threat, vsZum, kingdom.lumber >= 250 ? 3 * zums : 2 * zums))
  const cargo = g.boats.some(b => b.faction === k && b.kind === 'cargo')
  return Math.max(threat, vsZum, kingdom.temperament === 'imperialist' && cargo ? 1 : 0)
}

function managePirates(g: Game, k: number) {
  const kingdom = g.kingdoms[k]
  const ships = g.boats.filter(b => b.faction === k && b.kind === 'gunship')
  const sites = g.towers.filter(s => s.faction === k && s.kind === 'gunship').length
  const gwant = gunshipsWanted(g, k)
  if ((g.time > 90 || g.navalThreat.has(k)) && ships.length + sites < gwant && !sites && kingdom.lumber >= GUNSHIP.cost + 30) aiNote(g, k, 'gunship', placeShip(g, k, 'gunship') ? 'ok' : 'block', 'Laying down a gunship (or no free spot)')
  else if (ships.length + sites >= gwant) aiNote(g, k, 'gunship', 'ok', gwant === 0 ? 'None wanted (no Zumwalts to escort)' : `Gunships: ${ships.length}/${gwant}`)
  else if (g.time <= 90 && !g.navalThreat.has(k)) aiNote(g, k, 'gunship', 'wait', 'Too early (starts at 90s)')
  else aiNote(g, k, 'gunship', sites ? 'ok' : 'block', sites ? 'A gunship is under construction' : `Saving lumber for a gunship: ${Math.floor(kingdom.lumber)} / ${GUNSHIP.cost + 30}`)
}

// ---------------------------------------------------------------- the colony project
/** Empty land masses a kingdom could settle, best first: gold nearby counts a lot, distance against. */
function pickLand(g: Game, k: number): number {
  const mineLands = new Set(g.towns.filter(t => t.owner === k && !t.ruined).map(t => t.land))
  const from = homeTown(g, k)
  if (!from) return -1
  let best = -1, bs = Infinity
  const goldOn = new Map<number, number>()
  for (const d of g.goldDeps) if (!d.taken) { const L = g.info.landmass[d.cell]; goldOn.set(L, (goldOn.get(L) ?? 0) + d.amount) }
  for (let L = 0; L < g.info.sizes.length; L++) {
    if (g.info.sizes[L] < 24 || mineLands.has(L)) continue
    if (g.towns.some(t => !t.ruined && t.land === L && !isSettlement(t))) continue // a real town lives there
    const rivals = g.towns.filter(t => !t.ruined && t.land === L && isSettlement(t) && t.owner !== k).length // another kingdom's outpost: the island can be shared, but second pick
    const c = g.info.centers[L], d = tiles(c, from)
    if (d > 75) continue
    const sc = d - Math.min(60, (goldOn.get(L) ?? 0) * 4) + rivals * 12 // the best gold decides; a shared island is a second choice
    if (sc < bs) { bs = sc; best = L }
  }
  return best
}

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
let currentK = 0 // (the kingdom whose colony is being run: set by runColony)

const AI_EXPAND_AFTER = 80
const GARRISON_WANT = [3, 4, 5] // troops each settlement level should keep beside it

/** Troops of a kingdom standing beside a settlement. */
const garrisonOf = (g: Game, t: Town) => g.units.filter(u => u.faction === t.owner && u.state !== 'dead' && u.inTower < 0 && Math.hypot(u.x - t.x, u.y - t.y) <= SETTLE.troopTiles * TILE).length

function runColony(g: Game, k: number, mine: Unit[]) {
  currentK = k
  const kingdom = g.kingdoms[k]
  let c = g.colonies.get(k)
  if (c && c.phase === 'done') { if (g.time - c.since < COLONY_COOLDOWN) return; g.colonies.delete(k); c = undefined }
  if (!c) {
    const imperial = kingdom.temperament === 'imperialist'
    const start = (p: { kind: 'found' | 'reinforce'; land: number; settlement?: number }) => { g.colonies.set(k, { kind: p.kind, phase: 'build', land: p.land, since: g.time, spot: null, cargo: -1, boat: -1, settlement: p.settlement ?? -1 }) }
    // 1) a lost outpost is re-established (whatever the limit), 2) an understaffed outpost gets troops, 3) a new colony
    const lost = g.lostColonies.find(l => l.owner === k && g.time - l.at > 20)
    if (lost && kingdom.lumber >= SETTLE.cost + CARGO.cost + BOAT.cost + 20 && !g.towns.some(t => !t.ruined && t.land === lost.land && !isSettlement(t))) { g.lostColonies = g.lostColonies.filter(l => l !== lost); start({ kind: 'found', land: lost.land }); return }
    if (lost && g.towns.some(t => !t.ruined && t.land === lost.land && (!isSettlement(t) || t.owner === k))) g.lostColonies = g.lostColonies.filter(l => l !== lost) // somebody settled it already
    const weak = g.towns.filter(t => t.owner === k && !t.ruined && isSettlement(t) && garrisonOf(g, t) < GARRISON_WANT[t.level - 1] - 1 && mine.length > 4).sort((a, b) => garrisonOf(g, a) - garrisonOf(g, b))[0]
    if (weak && kingdom.lumber >= BOAT.cost + 20) { start({ kind: 'reinforce', land: weak.land, settlement: weak.id }); return }
    const limit = SETTLE_LIMIT[kingdom.temperament]
    if (limit <= 0 || g.ownedSettlements(k) >= limit || g.time < (imperial ? 20 : AI_EXPAND_AFTER)) return
    if (g.ownedTowns(k) < 1) return
    if (!imperial && g.kingdoms.some(o => o.id !== k && o.alive && g.hostile(k, o.id) && g.ownedTowns(k) < 4)) return // busy fighting for its life (imperialists expand regardless)
    const land = pickLand(g, k)
    if (land < 0) return
    if (kingdom.lumber < CARGO.cost + BOAT.cost + 30) { boostHarvest(g, k); return } // save up quickly (the pawns chop flat out); the settlement's 100 lumber is only needed on arrival
    start({ kind: 'found', land })
    return
  }
  const fail = () => { c!.phase = 'done'; c!.since = g.time; c!.boat = -1; c!.cargo = -1 }
  const limit = { build: 200, load: 140, sail: 330, found: 200, done: 1e9 }[c.phase]
  if (g.time - c.since > limit) return fail() // a stuck project never blocks the nation: it is dropped and the next one (or anything else) goes ahead
  const cargoB = g.boatById(c.cargo), shipB = g.boatById(c.boat)
  const reinforce = c.kind === 'reinforce'
  switch (c.phase) {
    case 'build': {
      const home = homeTown(g, k)
      if (!home) return fail()
      const free = g.boats.filter(b => b.faction === k && b.docked)
      const cargo = reinforce ? null : free.find(b => b.kind === 'cargo' && !b.trade)
      const infantry = free.find(b => b.kind === 'boat' && b.cargo.length === 0 && g.aiMemo.ship.get(b.id)?.phase !== 'sail')
      const army = mine.filter(u => u.type !== 'archer')
      const near = army.length ? { x: army.reduce((n, u) => n + u.x, 0) / army.length, y: army.reduce((n, u) => n + u.y, 0) / army.length } : undefined
      if (!reinforce && !cargo && !g.towers.some(t => t.faction === k && t.kind === 'cargo') && kingdom.lumber >= CARGO.cost + 20) placeShip(g, k, 'cargo', near)
      if (!infantry && !g.towers.some(t => t.faction === k && t.kind === 'boat') && !g.boats.some(b => b.faction === k && b.kind === 'boat' && g.aiMemo.ship.get(b.id)?.phase !== 'sail') && kingdom.lumber >= BOAT.cost + 20) placeShip(g, k, 'boat', near)
      if (infantry && (reinforce || cargo)) {
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
      const need = reinforce ? Math.max(2, Math.min(5, GARRISON_WANT[(g.towns[c.settlement]?.level ?? 1) - 1] - garrisonOf(g, g.towns[c.settlement]))) : 3
      if (aboard < need) {
        const pool = mine.filter(u => u.type !== 'archer' && u.aiRole === '' && !u.cutOff && u.hp >= u.maxHp * 0.7 && u.boardBoat < 0 && Math.hypot(u.x - shipB.x, u.y - shipB.y) < 45 * TILE && g.info.landmass[g.cellAt(u.x, u.y)] === boatLand)
        for (const u of pool.slice(0, need - aboard)) if (shipB.dockCell >= 0 && g.orderMoveTo(u, (shipB.dockCell % g.world.w + 0.5) * TILE, (Math.floor(shipB.dockCell / g.world.w) + 0.5) * TILE)) { u.boardBoat = shipB.id; u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + 150) }
      }
      const fed = reinforce || (cargoB!.load.meat >= Math.min(10, Math.max(5, kingdom.meat)) && (cargoB!.want.lumber <= 0 || cargoB!.load.lumber >= Math.min(cargoB!.want.lumber, kingdom.lumber - 120) - 1)) || g.time - c.since > 70
      if (cargoCount(g, shipB) >= 1 && fed) {
        const target = reinforce ? g.towns[c.settlement] : null
        const spot = coastSpot(g, c.land, shipB, c.avoid)
        if (!spot || (reinforce && (!target || target.ruined))) return fail()
        c.spot = spot
        const spot2 = cargoB ? coastSpot(g, c.land, cargoB, c.avoid, spot) ?? spot : null
        c.spot2 = spot2
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
        for (const u of landed) { u.aiRole = 'garrison'; u.hold = true; g.aiMemo.holdSince.set(u.id, g.time + 600); if (Math.hypot(u.x - t.x, u.y - t.y) > 2 * TILE) g.orderMoveTo(u, t.x + (u.id % 5 - 2) * 30, t.y + 50) }
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
        for (const u of mine) if (u.state !== 'dead' && g.info.landmass[g.cellAt(u.x, u.y)] === c.land) { u.aiRole = 'garrison'; u.hold = true; g.aiMemo.holdSince.set(u.id, g.time + 600) } // the garrison stays
        const home = homeTown(g, k)
        if (home && portFor(g, placed)) setTradeRoute(g, cargoB, home.id, placed.id, { lumber: 0, gold: 0, meat: 20 }, { lumber: 0, gold: CARGO.cap.gold, meat: 0 })
        c.phase = 'done'; c.since = g.time; c.boat = -1; c.cargo = -1
        if (shipB && shipB.docked) g.aiMemo.ship.delete(shipB.id)
      } else if (g.time - c.since > 180) fail() // (a little longer: the lumber may still be coming in)
      break
    }
  }
}
