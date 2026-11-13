import { AGIT, AI, BARGE, BOAT, DOCK, UNIT, LOT, OUTPOST, TILE, TOWER, YARD, ZUMWALT, type BoatKind } from './config'
import { isSettlement, regionTownAt } from './Economy'
import { aiNote } from './Stats'
import { atShipyard, bestYardSite, placeYard, yardBerth, yardCovering, yardLand, yardQuota, yardsOn } from './Yards'
import { manageColonies } from './ColonyAI'
import { manageNavalForces, navalPicture, navalThreats, stagingPoint } from './NavyAI'
import { cargoCount, mooringNear, orderSail, unload, isWaterCell } from './BoatSystem'
import type { Game } from './Game'
import { landmassAt } from './WorldInfo'
import type { Boat, Town, Unit } from './types'

const tiles = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / TILE
const far = (u: Unit, x: number, y: number) => (u.goalX < 0 || Math.hypot(u.goalX - x, u.goalY - y) > TILE * 1.5)
const hpFrac = (u: Unit) => u.hp / u.maxHp

/**
 * Low-frequency strategic planner. AI kingdoms obey the same rules as the player; this only issues orders (route / block /
 * structure placement) a few times per second and never runs per-frame pathfinding.
 *  - Invasion (assaults, bridges, dashes) is reserved for WAR and TOTAL WAR. In a mere CONFLICT the AI only answers force with
 *    force: it sends troops to retrieve seized territory and to retaliate against attacked units. Otherwise units stay out of
 *    foreign territory.
 *  - Units pull back to heal only when nearly dead (AI.retreatBelow) — never while pushing at a town with the upper hand — and stay until AI.restUntil.
 *  - At war, 60–80 % of the troops (the healthiest) take part in the offensive; the rest guard or heal.
 *  - Assault groups push toward the enemy town nearest to their kingdom's reach, tolerate being cut off while healthy, and use the
 *    cautious bridge technique (see `tryBridges`). Undefended towns trigger a risky "dash".
 *  - Border towers (max 5, away from active fights) get archers; each town may get one lot.
 *  - A long war elsewhere makes idle neutral kingdoms increasingly provocative, preferring weaker neighbours.
 */
export function updateAI(g: Game, dt: number) {
  if (!g.aiEnabled) return
  for (const k of g.kingdoms) {
    if (k.isPlayer || !k.alive) continue
    tryBridges(g, k.id)
    g.aiTimers[k.id] -= dt
    if (g.aiTimers[k.id] > 0) continue
    g.aiTimers[k.id] = AI.interval * (0.7 + g.rng.next() * 0.6)
    plan(g, k.id)
  }
}

/** AI units may only be stationed on neutral ground or inside friendly/allied land — never in foreign territory. */
function safeGoal(g: Game, k: number, x: number, y: number) {
  const i = g.cellAt(x, y)
  if (i < 0 || !g.world.land[i]) return false
  const c = g.controller[i]
  return c === 0 || c === k + 1 || g.diplomacy.allied(k, c - 1)
}

/**
 * Cautious bridging. An assault unit that falls back from being cut off and touches friendly supplied ground — far enough from
 * home to matter — stays there as a *bridge*. Its own influence extends friendly territory, so the rest of the group can strike a
 * little deeper next time. The cycle repeats (up to AI.maxBridges, always leaving a pusher). Checked every tick so the unit stops
 * the moment it is back on friendly ground.
 */
function tryBridges(g: Game, k: number) {
  for (const u of g.units) {
    if (u.faction !== k || u.state === 'dead' || u.aiRole !== 'retreat' || u.inTower >= 0) continue
    const i = u.cell
    if (i < 0 || u.cutOff || g.controller[i] !== k + 1 || !g.supplied[i]) continue
    const mates = g.units.filter(m => m.faction === k && m.state !== 'dead' && m.inTower < 0 && m.type !== 'archer' && m.aiRole !== 'bridge')
    const bridges = g.units.filter(m => m.faction === k && m.aiRole === 'bridge').length
    const home = g.towns.filter(t => t.owner === k).reduce((d, t) => Math.min(d, tiles(t, u)), Infinity)
    if (mates.length >= 3 && bridges < AI.maxBridges && home >= 6) {
      u.aiRole = 'bridge'; u.hold = true; u.route = []; u.routeIdx = 0; u.vx = u.vy = 0; u.state = 'idle'; u.goalX = u.x; u.goalY = u.y
    } else u.aiRole = ''
  }
}

function release(g: Game, u: Unit) { u.aiRole = ''; u.hold = false; g.aiMemo.dash.delete(u.id); g.aiMemo.holdSince.delete(u.id) }

/** AI blocking, with a cool-down so a unit can never be re-frozen immediately after the watchdog freed it. */
function canBlock(g: Game, u: Unit) { return (g.aiMemo.noBlock.get(u.id) ?? 0) <= g.time }
function aiBlock(g: Game, u: Unit) { if (canBlock(g, u) && u.mode !== 'block') g.setBlock(u, true) }

/**
 * Watchdog: no AI unit may stay frozen forever. A blocking unit is released after AI.maxBlockSeconds (and may not block again for
 * AI.blockCooldown); last-stand / garrison / bridge holds expire too. Anything that still threatens the town is then attacked.
 */
/**
 * Every AI nation destroys foreign ships (allies' excepted) that moor on, or edge toward, its shores: a ship tying up on our ground is an incident
 * at once, and troops on that land mass - the settlement garrison included - run to the beach and tear it down. Left-over cargo boats and
 * infantry boats do not get to sit there. (Their owners can fight for them, or sail them away.)
 */
function defendShores(g: Game, k: number, mine: Unit[]) {
  if (g.tickCount % 12 !== k % 12) return
  const { w } = g.world
  for (const b of g.boats) {
    if (b.hp <= 0 || b.faction === k || g.diplomacy.allied(k, b.faction) || (!b.docked && !b.docking)) continue
    const land = b.docked && b.dockCell >= 0 ? b.dockCell : (mooringNear(g, b.x, b.y, 2)?.land ?? -1)
    if (land < 0 || g.controller[land] !== k + 1) continue // only ships on OUR ground
    if (g.diplomacy.get(k, b.faction) === 'neutral') g.diplomacy.violation(b.faction, k, g.time, g.label, 'moored a ship on')
    if (!g.hostile(k, b.faction)) continue
    const gx = (land % w + 0.5) * TILE, gy = (Math.floor(land / w) + 0.5) * TILE, L = landmassAt(g.world, gx, gy)
    const pool = mine.filter(u => u.state !== 'dead' && !g.resting.has(u.id) && u.aiRole !== 'bridge' && u.aiRole !== 'dash' && u.aiRole !== 'laststand' && u.boardBoat < 0 && landmassAt(g.world, u.x, u.y) === L && tiles(u, { x: gx, y: gy }) < 22)
      .sort((p, q) => tiles(p, { x: gx, y: gy }) / UNIT[p.type].speed - tiles(q, { x: gx, y: gy }) / UNIT[q.type].speed).slice(0, 8) // (the first to arrive: knights answer a landing before anyone)
    for (const u of pool) {
      u.hold = false; u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + 20)
      if (tiles(u, { x: gx, y: gy }) > 1.6 && g.time - u.lastOrderT > 2) g.orderMoveTo(u, gx + Math.cos(u.id) * 20, gy + Math.sin(u.id) * 20)
    }
  }
}

/** Shipyards are free and go up at once: one on every landmass the kingdom holds (more on a big one, see yardQuota), on the coast nearest a town there. */
function manageYards(g: Game, k: number) {
  if (g.tickCount % 25 === 0 && g.time - (g.yardMovedAt.get(k) ?? -999) >= 60) { // a yard under the guns of an enemy fleet is moved (it is free) to the town coast farthest from them
    const foes = g.boats.filter(b => b.hp > 0 && (b.kind === 'zumwalt' || b.kind === 'gunship') && g.hostile(k, b.faction))
    const nearest = (x: number, y: number) => foes.reduce((m, f) => Math.min(m, Math.hypot(f.x - x, f.y - y)), Infinity)
    const yard = foes.length ? g.yards.find(q => q.faction === k && nearest(q.x, q.y) <= 26 * TILE) : undefined
    if (yard) {
      const land = yardLand(g, yard)
      g.yards = g.yards.filter(q => q !== yard) // (lift it so the other coasts can be tried)
      let best: { x: number; y: number } | null = null, bd = nearest(yard.x, yard.y)
      for (const t of g.towns) {
        if (t.owner !== k || t.ruined || t.land !== land) continue
        const s = bestYardSite(g, t)
        if (s && nearest(s.x, s.y) > bd + 8 * TILE) { bd = nearest(s.x, s.y); best = s }
      }
      if (best) { placeYard(g, k, best.x, best.y); g.yardMovedAt.set(k, g.time) } else g.yards.push(yard)
      return
    }
  }
  const lands = new Set(g.towns.filter(t => t.owner === k && !t.ruined).map(t => t.land))
  for (const L of lands) {
    if (yardsOn(g, k, L) >= yardQuota(g, k, L)) continue
    // spread them out: the next yard goes beside the town (with a free coast) that lies farthest from the yards already built, not beside the first town in the list
    const mineYards = g.yards.filter(q => q.faction === k && yardLand(g, q) === L)
    let best: { x: number; y: number } | null = null, bs = -Infinity
    for (const t of g.towns) {
      if (t.owner !== k || t.ruined || t.land !== L || isSettlement(t)) continue
      const site = bestYardSite(g, t)
      if (!site) continue
      const apart = mineYards.reduce((d, q) => Math.min(d, Math.hypot(q.x - site.x, q.y - site.y)), Infinity)
      if (apart > bs) { bs = apart; best = site }
    }
    if (best) { placeYard(g, k, best.x, best.y); return }
  }
  clearYards(g, k)
}

/**
 * Keep the shipyards' coast free to build on: a finished ship that is fully mended leaves the white line. Warships park a few tiles out in open
 * water; a barge waiting for troops moors on a stretch of coast beyond the yard. (Ships still being mended, loaded barges, ships on a task and
 * barges holding a beachhead stay where they are.)
 */
function clearYards(g: Game, k: number) {
  if (g.time - (g.yardTidyAt.get(k) ?? -999) < 4) return
  g.yardTidyAt.set(k, g.time)
  const M = g.aiMemo.ship
  const own = g.yards.filter(q => q.faction === k)
  if (!own.length) return
  const claimed: { x: number; y: number }[] = []
  for (const b of g.boats) {
    if (b.faction !== k || b.hp < b.maxHp - 1 || b.route.length > 0 || b.docking || b.strike) continue
    const yard = yardCovering(g, k, b.x, b.y)
    if (!yard || (b.kind !== 'zumwalt' && b.kind !== 'gunship' && b.kind !== 'barge' && b.kind !== 'boat')) continue
    if (!b.docked && (Math.hypot(b.x - yard.x, b.y - yard.y) > (YARD.zoneTiles + 1) * TILE || !mooringNear(g, b.x, b.y, 3.2))) continue // (afloat and already out of the berths: leave it)
    if (b.docked && g.time - b.dockSince < 4) continue
    const ph = M.get(b.id)?.phase
    if (b.kind === 'barge' && ph !== 'load') continue // (a barge with troops aboard, under way or holding a beachhead is not tidied away)
    if (b.kind === 'barge' && cargoCount(g, b) > 0) continue
    if (b.kind === 'zumwalt' && ph === 'return') continue // (a Zumwalt being mended)
    if (b.kind === 'boat' && b.cargo.length) continue
    const spot = b.kind === 'barge' ? beyondYardMooring(g, k, b, own, claimed) : parkingSpot(g, b, yard, claimed)
    if (!spot) continue
    claimed.push(spot)
    if (b.kind !== 'barge') b.noDock = true
    if (orderSail(g, b, [spot.x, spot.y]) && M.get(b.id)) M.get(b.id)!.since = g.time
    if (claimed.length >= 3) return // (a few ships per pass: nobody jams the channel)
  }
}

/** Open water a few tiles off the coast near a yard (clear of the building berths: at least 3.2 tiles from any shore), away from other ships. */
function parkingSpot(g: Game, b: Boat, yard: { x: number; y: number }, claimed: { x: number; y: number }[]): { x: number; y: number } | null {
  const { w, h } = g.world, cx = Math.floor(yard.x / TILE), cy = Math.floor(yard.y / TILE)
  let best: { x: number; y: number } | null = null, bs = Infinity
  for (let yy = Math.max(1, cy - 14); yy <= Math.min(h - 2, cy + 14); yy++) for (let xx = Math.max(1, cx - 14); xx <= Math.min(w - 2, cx + 14); xx++) {
    const i = yy * w + xx
    if (g.world.land[i] || !g.info.sea[i]) continue
    const x = (xx + 0.5) * TILE, y = (yy + 0.5) * TILE
    if (mooringNear(g, x, y, 3.2)) continue // (too close to a shore: that is where ships are built and moor)
    if (g.boats.some(o => o !== b && Math.hypot(o.x - x, o.y - y) < 4 * TILE) || claimed.some(c => Math.hypot(c.x - x, c.y - y) < 4 * TILE)) continue
    const d = Math.hypot(x - yard.x, y - yard.y) / TILE
    if (d < 5 || d > 16) continue
    const sc = Math.abs(d - 8) + Math.hypot(x - b.x, y - b.y) / TILE * 0.2
    if (sc < bs) { bs = sc; best = { x, y } }
  }
  return best
}

/** A mooring on the barge's landmass outside every own yard's white line (beyond the building coast), nearest to where the barge is. */
function beyondYardMooring(g: Game, k: number, b: Boat, own: { x: number; y: number }[], claimed: { x: number; y: number }[]): { x: number; y: number } | null {
  const { w, h } = g.world, cx = Math.floor(b.x / TILE), cy = Math.floor(b.y / TILE), L = b.dockCell >= 0 ? g.info.landmass[b.dockCell] : -1
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let yy = Math.max(1, cy - 26); yy <= Math.min(h - 2, cy + 26); yy++) for (let xx = Math.max(1, cx - 26); xx <= Math.min(w - 2, cx + 26); xx++) {
    const i = yy * w + xx
    if (g.world.land[i] || !g.info.sea[i]) continue
    const x = (xx + 0.5) * TILE, y = (yy + 0.5) * TILE
    const m = mooringNear(g, x, y, 0.6)
    if (!m || (L >= 0 && g.info.landmass[m.land] !== L)) continue
    if (own.some(q => Math.hypot(q.x - x, q.y - y) < (YARD.zoneTiles + 3) * TILE)) continue
    if (g.boats.some(o => o !== b && Math.hypot(o.x - x, o.y - y) < 4 * TILE) || claimed.some(c => Math.hypot(c.x - x, c.y - y) < 4 * TILE)) continue
    const d = Math.hypot(x - b.x, y - b.y)
    if (d < bd) { bd = d; best = { x, y } }
  }
  return best
}

function watchdog(g: Game, mine: Unit[]) {
  const M = g.aiMemo
  for (const u of mine) {
    if (u.mode === 'block') {
      const since = M.blockSince.get(u.id) ?? g.time
      M.blockSince.set(u.id, since)
      if (g.time - since > AI.maxBlockSeconds) { g.setBlock(u, false); M.blockSince.delete(u.id); M.noBlock.set(u.id, g.time + AI.blockCooldown); if (u.aiRole === 'laststand') { M.lastStand.delete(u.id); release(g, u) } }
    } else M.blockSince.delete(u.id)
    if (u.hold) {
      const since = M.holdSince.get(u.id) ?? g.time
      M.holdSince.set(u.id, since)
      const limit = u.aiRole === 'bridge' ? AI.garrisonSeconds * 3 : u.aiRole === 'laststand' ? AI.maxBlockSeconds : AI.garrisonSeconds
      if (g.time - since > limit) { M.lastStand.delete(u.id); release(g, u); if (u.mode === 'block') g.setBlock(u, false) }
    } else M.holdSince.delete(u.id)
  }
}

function plan(g: Game, k: number) {
  const kingdom = g.kingdoms[k]
  const mine = g.units.filter(u => u.faction === k && u.state !== 'dead' && u.inTower < 0)
  const myTowns = g.towns.filter(t => t.owner === k)
  const foes = g.kingdoms.filter(o => o.id !== k && o.alive && g.hostile(k, o.id)).map(o => o.id)
  const warFoes = foes.filter(f => { const r = g.diplomacy.get(k, f); return r === 'war' || r === 'total' })
  const conflictFoes = foes.filter(f => !warFoes.includes(f))
  const warlike = isWarlike(g, k, warFoes.length > 0) // an imperialist, or a pacifist who is at war: a pacifist does not start wars, but once in one it fights to win
  { const base = g.warAggro, kg = g.kingdoms[k] // (a pacifist at war is as aggressive as an imperialist for the length of it)
    if (kg.temperament === 'pacifist' && warFoes.length > 0) { if (!base.has(k)) base.set(k, kg.aggression); kg.aggression = Math.max(kg.aggression, 0.9) }
    else if (base.has(k)) { kg.aggression = base.get(k)!; base.delete(k) } }
  const mineCount = g.ownedTowns(k)
  // an imperialist never throws itself at a nation bigger than itself — except at its far-off settlements, which are always fair game
  const toobig = (o: number) => kingdom.temperament === 'imperialist' && g.diplomacy.bloc(o).reduce((n, m) => n + g.ownedTowns(m), 0) > mineCount
  const enemyTowns = g.towns.filter(t => warFoes.includes(t.owner) && !t.ruined) // only war opens an invasion
  const landOf = (p: { x: number; y: number }) => landmassAt(g.world, p.x, p.y)
  const myLands = new Set<number>([...myTowns.map(landOf), ...mine.map(u => landOf(u))])
  // A land push is for SHORT advances: a target on our own land mass is only marched on if it is within AI.farLandTiles of ground we hold (towns,
  // outposts, bridge units). Anything farther - or on another island - is a job for the navy: a boat, a shipload of infantry, a landing.
  // A beachhead counts too: troops ashore on a land mass where we hold no town are where the next push starts from, and they extend it with
  // outposts (a trail inland) instead of being stopped by the distance back home.
  const homeLands = new Set(myTowns.filter(t => !t.ruined).map(t => t.land))
  const reachPts: { x: number; y: number }[] = [...myTowns.filter(t => !t.ruined), ...g.outposts.filter(o => o.faction === k), ...mine.filter(u => u.aiRole === 'bridge' || (u.type !== 'archer' && !homeLands.has(landOf(u))))]
  const landDist = (t: Town) => reachPts.reduce((d, p) => Math.min(d, tiles(p, t)), Infinity)
  // by boat if we can (we hold a coast) and the target has a shore to land on; with no sea option a long march is all there is (capped)
  const navalOption = (t: Town) => myTowns.some(m => !m.ruined && coastDistance(g, m) < 12) && coastDistance(g, t) < 16
  const beachLands = new Set(mine.filter(u => u.type !== 'archer' && !homeLands.has(landOf(u))).map(landOf)) // land masses we hold only by a landing party
  const landEnemy = enemyTowns.filter(t => myLands.has(landOf(t)) && (beachLands.has(landOf(t)) || landDist(t) <= (navalOption(t) && !homeLands.has(landOf(t)) ? AI.farLandTiles : AI.farLandTiles * (warlike ? 3 : 2)))) // reachable on foot without a long trek (a beachhead pushes on at any distance, laying outposts)
  const seaEnemy = enemyTowns.filter(t => !landEnemy.includes(t)) // across the water, or too far overland: needs the navy (the size restriction applies only to DECLARING war)
  const hostileTowns = g.towns.filter(t => foes.includes(t.owner))
  const enemies = g.units.filter(u => foes.includes(u.faction) && u.state !== 'dead' && u.inTower < 0)

  manageYards(g, k)
  manageStructures(g, k, myTowns.length > 0)
  manageFleet(g, k, myTowns.filter(t => !isSettlement(t)).length, foes.length > 0 || warFoes.length > 0, g.navalThreat.has(k), warFoes.length > 0)
  manageNavy(g, k, warFoes, enemyTowns, seaEnemy, mine, landEnemy.length > 0)
  manageColonies(g, k, mine)
  if (!mine.length) return
  watchdog(g, mine)
  defendShores(g, k, mine)

  // No towns left: retake the nearest town from whoever holds it (the only way back from the brink).
  if (!myTowns.length) {
    const targets = g.towns.filter(t => !g.diplomacy.allied(k, t.owner))
    for (const u of mine) {
      if (u.mode === 'block') g.setBlock(u, false)
      release(g, u)
      const t = targets.reduce<typeof targets[number] | null>((a, b) => (!a || tiles(b, u) < tiles(a, u) ? b : a), null)
      if (t && far(u, t.x, t.y)) g.orderMoveTo(u, t.x, t.y + 20)
    }
    return
  }

  // Archers fill empty towers.
  for (const t of g.towers) {
    if (t.kind !== 'tower' || t.faction !== k || !t.built || t.archer >= 0) continue
    const a = mine.filter(u => u.type === 'archer' && u.count === 1 && !g.resting.has(u.id) && !(u.routeIdx < u.route.length / 2)).sort((p, q) => tiles(t, p) - tiles(t, q))[0]
    if (a) g.orderMoveTo(a, t.x, t.y + 36)
  }

  // ---- roles ----
  const worst = warFoes.reduce((r, f) => (g.diplomacy.get(k, f) === 'total' ? 3 : Math.max(r, 2)), 0)
  const share = worst >= 3 ? AI.totalShare : AI.warShare
  const melee = mine.filter(u => u.type !== 'archer').sort((a, b) => hpFrac(b) - hpFrac(a))
  // ---- resting (hysteresis): only the nearly dead leave the fight, and they stay until healed; a unit pushing at an enemy town with the upper hand never does ----
  const pushing = (u: Unit) => {
    const town = hostileTowns.find(t => !t.ruined && tiles(t, u) < 8)
    if (!town) return false
    const mineNear = mine.reduce((n, m) => n + (m === u || (!g.resting.has(m.id) && tiles(m, u) < 8) ? unitPower(m) : 0), 0)
    const foeNear = enemies.reduce((n, e) => n + (tiles(e, u) < 8 ? unitPower(e) : 0), 0) + 3 * g.towers.filter(q => q.built && q.kind === 'tower' && g.hostile(k, q.faction) && tiles(q, u) < 8).length
    return mineNear >= foeNear * 1.2
  }
  for (const u of mine) {
    const until = g.resting.get(u.id)
    if (until !== undefined) { if (hpFrac(u) >= until) g.resting.delete(u.id) }
    else if (hpFrac(u) < AI.retreatBelow && !pushing(u)) g.resting.set(u.id, u.hp <= 2 ? AI.freshRestUntil : AI.restUntil) // (a brand-new recruit starts at 1 hp)
  }
  if (g.tickCount % 250 === 0) for (const id of [...g.resting.keys()]) if (!g.unitById(id)) g.resting.delete(id)
  const ready = melee.filter(u => !g.resting.has(u.id))
  // priorities: 1) defend ourselves, 2) spare troops defend threatened allies, 3) the rest pursue our own objectives
  // a raider or two near one of our towns does not call the army home: only a real assault does (the troops left behind, and the garrison, see to the rest)
  const raiders = enemies.filter(e => myTowns.some(t => tiles(t, e) < 8))
  const underThreat = raiders.length >= 3 && raiders.reduce((n, e) => n + unitPower(e), 0) >= 0.35 * mine.reduce((n, u) => n + unitPower(u), 0)
  const allyThreat = g.towns.filter(t => t.owner !== k && g.diplomacy.allied(k, t.owner))
    .map(t => ({ t, foes: g.units.filter(u => u.state !== 'dead' && u.inTower < 0 && g.hostile(t.owner, u.faction) && tiles(u, t) < 8) }))
    .filter(x => x.foes.length > 0).sort((a, b) => b.foes.length - a.foes.length)[0]
  const allyDef = new Set<number>()
  if (!underThreat && allyThreat) {
    const pool = ready.filter(u => u.aiRole === '' || u.aiRole === 'respond')
    const n = pool.length >= 2 ? Math.ceil(pool.length * 0.4) : 0 // only genuinely spare troops go
    for (const u of pool.slice(pool.length - n)) {
      allyDef.add(u.id); u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + AI.respondSeconds)
      const f = allyThreat.foes[0]
      const gx = allyThreat.t.x + (f.x - allyThreat.t.x) * 0.4, gy = allyThreat.t.y + (f.y - allyThreat.t.y) * 0.4
      if (far(u, gx, gy)) g.orderMoveTo(u, gx, gy)
    }
  }
  const onFront = ready.filter(u => !allyDef.has(u.id) && landEnemy.some(t => landOf(t) === landOf(u))) // only troops standing on a land with an enemy town can march on one
  // war goal: one target at a time; strike only with a clear edge (everyone together), or all-in once the war has stalled
  const goal = updateWarGoal(g, k, landEnemy, mine)
  let launch = false
  if (goal && landEnemy.length > 0 && g.time > 20 && (!underThreat || (goal.launched && g.time - (goal.launchedAt ?? 0) < 30))) { // (a launched push is not recalled in its first 30 s)
    const tgt = g.towns[goal.target]
    const defPow = enemies.filter(e => tiles(e, tgt) < 12).reduce((n, e) => n + unitPower(e), 0) + 3 * g.towers.filter(q => q.built && q.faction === tgt.owner && q.kind === 'tower' && tiles(q, tgt) < 12).length
    const myPow = onFront.reduce((n, u) => n + unitPower(u), 0) + 0.4 * mine.filter(u => u.type === 'archer').reduce((n, u) => n + unitPower(u), 0)
    // commitment: a launched assault is carried through (it only turns back when clearly losing: below half the defenders' strength for its first minute, below 3/4 afterwards)
    const stalled = Math.min(1, Math.max(0, (g.time - goal.progressAt) / (AI.warStall * (warlike ? 0.5 : 1)))) // (the longer nothing happens, the smaller the edge the army insists on: stalemates do not last for ever)
    const held = goal.launched ? (g.time - (goal.launchedAt ?? g.time) < 60 ? 0.5 : 0.75) : (warlike ? 1 : AI.edge) - 0.55 * stalled // (a warlike nation settles for an even fight)
    launch = goal.allIn || defPow <= 1.5 || myPow >= defPow * (tgt.kind === 'settlement' ? Math.min(0.8, held) : held)
    if (launch && !goal.launched) goal.launchedAt = g.time
    goal.launched = launch
  } else if (goal) goal.launched = false
  const attackN = launch ? Math.max(1, Math.min(onFront.length, Math.round(melee.length * 0.95)) - (raiders.length ? Math.min(2, Math.floor(onFront.length / 4)) : 0)) : 0 // (a couple stay home while raiders are about)
  const attackers = new Set(onFront.slice(0, attackN).map(u => u.id))
  claimAbandoned(g, k, ready, attackers, landOf)
  if (landEnemy.length > 0) layOutposts(g, k, mine)
  for (const u of mine) if ((u.aiRole === 'bridge' || u.aiRole === 'dash') && !landEnemy.length) release(g, u)
  if (attackers.size < 2) for (const u of mine) if (u.aiRole === 'bridge') release(g, u)

  // conflict response: retrieve seized land and retaliate for attacked units, but do not invade
  const recent = (g.aiMemo.grievance[k] ?? []).filter(e => g.time - e.t < AI.grievanceWindow && conflictFoes.includes(e.foe))
  if (recent.length) {
    const e = recent[recent.length - 1]
    const pool = ready.filter(u => u.aiRole === '' || u.aiRole === 'respond').sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) / UNIT[a.type].speed - Math.hypot(b.x - e.x, b.y - e.y) / UNIT[b.type].speed) // (by time to arrive: knights first)
    for (const u of pool.slice(0, Math.min(4, Math.max(1, Math.ceil(pool.length * 0.5))))) {
      u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + AI.respondSeconds)
      if (far(u, e.x, e.y)) g.orderMoveTo(u, e.x, e.y)
    }
  }

  // group target: the hostile town nearest to the kingdom's current reach (towns plus bridge units)
  // group target per land mass: the hostile town on that land nearest to the kingdom's reach there (towns, bridge units, allied towns and — after a landing — its troops)
  const reachAll = [...myTowns, ...mine.filter(u => u.aiRole === 'bridge'), ...g.towns.filter(t => t.owner !== k && g.diplomacy.allied(k, t.owner))]
  const targets = new Map<number, Town | null>()
  const targetOn = (L: number): Town | null => {
    if (targets.has(L)) return targets.get(L)!
    const gt = goal ? g.towns[goal.target] : null // the war goal's town is what the launch decision was made about: that is where the army marches
    if (gt && !gt.ruined && landOf(gt) === L && foes.includes(gt.owner)) { targets.set(L, gt); g.aiMemo.target[k] = gt.id; g.aiMemo.targetAt[k] = g.time; return gt }
    let target: Town | null = g.towns[g.aiMemo.target[k]] ?? null
    if (target && (landOf(target) !== L || !foes.includes(target.owner) || target.ruined || g.time - (g.aiMemo.targetAt[k] ?? 0) > 30)) target = null
    if (!target) {
      for (const ally of g.diplomacy.alliesOf(k)) { // allied AIs coordinate: share the leader's target when it is also our enemy
        const at = g.towns[g.aiMemo.target[ally]] ?? null
        if (at && !at.ruined && warFoes.includes(at.owner) && landOf(at) === L) { target = at; break }
      }
    }
    if (!target) {
      let reach = reachAll.filter(r => landOf(r) === L)
      if (!reach.length) reach = mine.filter(u => landOf(u) === L)
      let bs = Infinity
      for (const t of enemyTowns) {
        if (landOf(t) !== L) continue
        const guards = enemies.filter(e => tiles(e, t) < 6).length
        const s = reach.reduce((d, r) => Math.min(d, tiles(r, t)), Infinity) + guards * 1.5
        if (s < bs) { bs = s; target = t }
      }
      g.aiMemo.target[k] = target ? target.id : -1; g.aiMemo.targetAt[k] = g.time
    }
    targets.set(L, target)
    return target
  }

  // risky dashes at undefended towns
  const dashers = mine.filter(u => u.aiRole === 'dash')
  if (landEnemy.length && g.time > 30 && dashers.length < Math.max(1, Math.floor(attackers.size / 3))) {
    const open = landEnemy.filter(t => enemies.filter(e => tiles(e, t) < 6).length <= AI.dashGuard)
    for (const u of [...melee].sort((a, b) => Number(b.type === 'knight') - Number(a.type === 'knight'))) { // (a dash is a knight's job)
      if (!attackers.has(u.id) || u.aiRole !== '' || hpFrac(u) < AI.dashHp) continue
      const t = open.filter(o => tiles(o, u) < 30 && landOf(o) === landOf(u)).sort((a, b) => tiles(a, u) - tiles(b, u))[0]
      if (!t) break
      const inWay = enemies.filter(e => distToSegment(e, u, t) < 3 * TILE).length
      if (inWay > 1) continue
      u.aiRole = 'dash'; g.aiMemo.dash.set(u.id, t.id)
      break
    }
  }

  mine.forEach((u, idx) => {
    const attacker = attackers.has(u.id)
    // ---- dash: accept the supply risk to take an undefended town, hold it, or fall back from resistance ----
    if (u.aiRole === 'dash') {
      const town = g.towns[g.aiMemo.dash.get(u.id) ?? -1]
      if (!town || town.owner === k) {
        g.aiMemo.dash.delete(u.id)
        if (town && town.owner === k) { u.aiRole = 'garrison'; u.hold = true; u.route = []; u.routeIdx = 0; u.goalX = u.x; u.goalY = u.y } else u.aiRole = ''
        return
      }
      const near = enemies.filter(e => tiles(e, u) < 4).length
      if (hpFrac(u) < 0.2 || near >= 3 && hpFrac(u) < 0.5) { u.aiRole = 'retreat'; g.aiMemo.dash.delete(u.id); const t = nearestSuppliedCell(g, u, k); if (t) g.orderMoveTo(u, t.x, t.y); return }
      if (far(u, town.x, town.y)) g.orderMoveTo(u, town.x, town.y + 20)
      return
    }
    if (u.aiRole === 'respond') {
      if (g.time > (g.aiMemo.respond.get(u.id) ?? 0) || g.resting.has(u.id) || u.cutOff && g.time - u.cutSince > AI.cutOffPatience) { g.aiMemo.respond.delete(u.id); u.aiRole = ''; u.goalX = -1 } else return
    }
    if (u.aiRole === 'garrison') { if (!g.towns.some(t => t.owner === k && tiles(t, u) < 3) || !foes.length || enemies.some(e => tiles(e, u) < 10)) release(g, u); else return } // (a garrison stands guard, but the whole of it joins the fight once an enemy comes close)
    if (u.aiRole === 'bridge') { if (u.cutOff || !attacker) release(g, u); else return } // bridges stay put

    // ---- last stand: a badly hurt unit that is being overwhelmed near its town blocks in front of it ----
    const homeTown = myTowns.reduce((a, b) => (tiles(a, u) < tiles(b, u) ? a : b))
    if (u.aiRole === 'laststand') {
      const entry = g.aiMemo.lastStand.get(u.id) ?? 0
      const anyFoe = enemies.some(e => tiles(e, u) < 7)
      if (!anyFoe || hpFrac(u) >= entry + AI.lastStandRecover || hpFrac(u) >= 0.5) { g.aiMemo.lastStand.delete(u.id); u.aiRole = ''; u.hold = false; if (u.mode === 'block') g.setBlock(u, false) } // recovered a little, or the enemy withdrew
      else {
        const foe = enemies.reduce<Unit | null>((a, e) => (!a || tiles(e, homeTown) < tiles(a, homeTown) ? e : a), null)!
        const d = Math.hypot(foe.x - homeTown.x, foe.y - homeTown.y) || 1
        const fx = homeTown.x + ((foe.x - homeTown.x) / d) * 84, fy = homeTown.y + ((foe.y - homeTown.y) / d) * 84
        if (Math.hypot(u.x - fx, u.y - fy) > 44) { if (u.mode === 'block') g.setBlock(u, false); if (far(u, fx, fy)) g.orderMoveTo(u, fx, fy) } else aiBlock(g, u)
        return
      }
    } else if (u.type !== 'archer' && !u.cutOff && hpFrac(u) < AI.lastStandHp && tiles(homeTown, u) < 6 && canBlock(g, u)) {
      const foesNear = enemies.filter(e => tiles(e, u) < 5).length
      const friendsNear = mine.filter(m => m !== u && hpFrac(m) >= AI.lastStandHp && tiles(m, u) < 5).length
      if (foesNear >= 2 && foesNear > friendsNear) { u.aiRole = 'laststand'; u.hold = true; g.aiMemo.lastStand.set(u.id, hpFrac(u)); g.aiMemo.dash.delete(u.id); return }
    }

    // ---- rest: the nearly dead (and brand-new) heal near a town, to 85 % (50 % for recruits), before taking part again ----
    if (g.resting.has(u.id) && !u.cutOff) {
      if (u.mode === 'block') g.setBlock(u, false)
      const home = myTowns.reduce((a, b) => (tiles(a, u) < tiles(b, u) ? a : b))
      if (tiles(home, u) > 1.6) { const a = u.id * 2.1; g.orderMoveTo(u, home.x + Math.cos(a) * 70, home.y + 40 + Math.sin(a) * 40, true) }
      return
    }
    const holding = u.route.length > 0 && u.routeIdx < u.route.length / 2 && g.time - u.lastOrderT < AI.minHold
    if (u.state === 'attacking' || u.state === 'cooldown') return
    if (holding && !u.cutOff) return

    // ---- cut off: attackers press on while healthy; everyone else (or the exhausted) falls back to supply ----
    if (u.cutOff) {
      const exhausted = hpFrac(u) < AI.retreatHp || g.time - u.cutSince > AI.cutOffPatience
      if (!attacker || exhausted) {
        const t = nearestSuppliedCell(g, u, k)
        if (attacker && u.type !== 'archer') u.aiRole = 'retreat'
        if (t && g.orderMoveTo(u, t.x, t.y)) return
      }
    }
    const nearTown = myTowns.reduce((a, b) => (tiles(a, u) < tiles(b, u) ? a : b))
    const threat = enemies.filter(e => myTowns.some(t => tiles(t, e) < 8)).sort((a, b) => tiles(a, nearTown) - tiles(b, nearTown))[0]

    if (!attacker && u.type === 'archer') { // archers hang back behind the melee line and skirt away from anything that closes in
      if (u.routeIdx < u.route.length / 2) return
      // a few archers watch the coast: with an enemy ship near our towns they stand on the shore it is nearest to (they out-range ships by 1.5x)
      const ship = g.boats.filter(b => g.hostile(k, b.faction) && myTowns.some(t => tiles(t, b) < 26)).sort((a, b) => tiles(a, u) - tiles(b, u))[0]
      if (ship && !g.resting.has(u.id)) {
        const shore = shoreToward(g, k, ship)
        if (shore) { if (Math.hypot(u.x - shore.x, u.y - shore.y) > TILE * 1.2 && far(u, shore.x, shore.y)) g.orderMoveTo(u, shore.x, shore.y, true); return }
      }
      const foeClose = enemies.filter(e => tiles(e, u) < 3.2).sort((a, b) => tiles(a, u) - tiles(b, u))[0]
      if (foeClose) {
        const d = Math.hypot(u.x - foeClose.x, u.y - foeClose.y) || 1
        const ax = u.x + ((u.x - foeClose.x) / d) * 4 * TILE, ay = u.y + ((u.y - foeClose.y) / d) * 4 * TILE
        if (g.isLandAt(ax, ay)) g.orderMoveTo(u, ax, ay)
        return
      }
      const front = mine.filter(m => m.type !== 'archer' && m.aiRole !== 'bridge')
      let cx = nearTown.x, cy = nearTown.y
      if (front.length) { cx = front.reduce((n, m) => n + m.x, 0) / front.length; cy = front.reduce((n, m) => n + m.y, 0) / front.length }
      const dd = Math.hypot(nearTown.x - cx, nearTown.y - cy) || 1, back = Math.min(3.5 * TILE, dd)
      let gx = cx + ((nearTown.x - cx) / dd) * back + Math.cos(u.id) * 50, gy = cy + ((nearTown.y - cy) / dd) * back + Math.sin(u.id) * 50
      if (!safeGoal(g, k, gx, gy)) { gx = nearTown.x + Math.cos(u.id) * 120; gy = nearTown.y + Math.sin(u.id) * 120 }
      if (far(u, gx, gy)) g.orderMoveTo(u, gx, gy, true)
      return
    }
    if (!attacker) {
      if (threat) {
        const guardTown = myTowns.reduce((a, b) => (tiles(a, threat) < tiles(b, threat) ? a : b))
        const threatsNear = enemies.filter(e => tiles(guardTown, e) < 7).length, blocking = mine.filter(m => m.mode === 'block').length
        // blocking is for a real assault on the town (3+ attackers), by warriors only (a blocking lancer gets no protection), and never by most of the garrison
        if (u.type === 'warrior' && canBlock(g, u) && threatsNear >= 3 && blocking < Math.ceil(threatsNear / 2) && tiles(guardTown, u) < 3.5 && tiles(guardTown, threat) < 6.5) { aiBlock(g, u); return }
        if (u.mode === 'block') g.setBlock(u, false)
        if (!g.resting.has(u.id) && tiles(guardTown, threat) < 7.5) { if (far(u, threat.x, threat.y)) g.orderMoveTo(u, threat.x, threat.y); return } // it will not sit and wait: drive the lingering threat off
        const gx = guardTown.x + (threat.x - guardTown.x) * 0.4, gy = guardTown.y + (threat.y - guardTown.y) * 0.4
        if (far(u, gx, gy)) g.orderMoveTo(u, gx, gy)
        return
      }
      if (u.mode === 'block') g.setBlock(u, false)
      if (warlike && u.type !== 'archer' && !g.resting.has(u.id) && hpFrac(u) >= 0.6) { // seek and destroy: a warlike army goes after the enemy's field army when it clearly has the better of it
        const prey = enemies.filter(e => landOf(e) === landOf(u) && tiles(e, u) < 42 && !myTowns.some(t => tiles(t, e) < 3)).sort((a, b) => tiles(a, u) - tiles(b, u))[0]
        if (prey) {
          const foePow = enemies.reduce((n, e) => n + (tiles(e, prey) < 8 ? unitPower(e) : 0), 0) + 3 * g.towers.filter(q => q.built && q.kind === 'tower' && g.hostile(k, q.faction) && tiles(q, prey) < 8).length
          const myPow = ready.reduce((n, m) => n + (m.aiRole === '' && tiles(m, u) < 12 ? unitPower(m) : 0), 0)
          if (myPow >= foePow * 1.1) { if (far(u, prey.x, prey.y)) g.orderMoveTo(u, prey.x, prey.y); return }
        }
      }
      const foe = hostileTowns.length ? hostileTowns.reduce((a, b) => (tiles(a, nearTown) < tiles(b, nearTown) ? a : b)) : null
      const a = idx * 1.7 + u.id
      let gx = nearTown.x + Math.cos(a) * 190, gy = nearTown.y + Math.sin(a) * 190
      const alert = g.ready[k] ? g.agitFocus[k] : null // on alert: mass at the border facing the trouble
      if (alert) { const d = Math.max(0.1, tiles(alert, nearTown)), f = Math.min(1, 6.5 / d); gx = nearTown.x + (alert.x - nearTown.x) * f + Math.cos(a) * 80; gy = nearTown.y + (alert.y - nearTown.y) * f + Math.sin(a) * 80 }
      else if (foe) { const d = Math.max(0.1, tiles(foe, nearTown)), f = Math.min(1, 6.5 / d); gx = nearTown.x + (foe.x - nearTown.x) * f + Math.cos(a) * 80; gy = nearTown.y + (foe.y - nearTown.y) * f + Math.sin(a) * 80 }
      if (!safeGoal(g, k, gx, gy)) { gx = nearTown.x + Math.cos(a) * 150; gy = nearTown.y + Math.sin(a) * 150 }
      if (far(u, gx, gy)) g.orderMoveTo(u, gx, gy, true)
      return
    }
    // ---- attacker: press toward the group target ----
    if (u.mode === 'block') g.setBlock(u, false)
    if (u.aiRole === 'retreat' && !u.cutOff) u.aiRole = ''
    const target = targetOn(landOf(u))
    if (target && far(u, target.x, target.y) && !g.orderMoveTo(u, target.x + Math.cos(u.id) * 30, target.y + 24)) {
      // the group target cannot be reached over land: try the next-nearest enemy town on this land instead of standing idle
      const alts = landEnemy.filter(t => t !== target && landOf(t) === landOf(u)).sort((a, b) => tiles(a, u) - tiles(b, u)).slice(0, 3)
      for (const t of alts) if (g.orderMoveTo(u, t.x + Math.cos(u.id) * 30, t.y + 24)) break
    }
  })
}

/** The own, supplied land tile nearest to a ship within 9 tiles of it (about an archer's reach against ships), or null. */
function shoreToward(g: Game, k: number, b: Boat): { x: number; y: number } | null {
  const { w, h } = g.world, cx = Math.floor(b.x / TILE), cy = Math.floor(b.y / TILE)
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let yy = Math.max(0, cy - 9); yy <= Math.min(h - 1, cy + 9); yy++) for (let xx = Math.max(0, cx - 9); xx <= Math.min(w - 1, cx + 9); xx++) {
    const i = yy * w + xx
    if (!g.world.land[i] || g.controller[i] !== k + 1 || !g.supplied[i]) continue
    const d = Math.hypot(xx - cx, yy - cy)
    if (d < bd) { bd = d; best = { x: (xx + 0.5) * TILE, y: (yy + 0.5) * TILE } }
  }
  return best
}

/**
 * An army advancing into new land leaves a trail of outposts (100 power each, 1 hp): the unit nearest the enemy that is about to step off
 * supplied ground, or already has, plants one so the column keeps its supply instead of being cut off and bled by attrition.
 */
function layOutposts(g: Game, k: number, mine: Unit[]) {
  const kingdom = g.kingdoms[k]
  if (g.time - (g.outpostAt.get(k) ?? -99) < OUTPOST.aiEvery) return
  if (kingdom.power < OUTPOST.cost + OUTPOST.aiReserve || g.outposts.filter(o => o.faction === k).length >= OUTPOST.max) return
  const { w, h } = g.world
  const home = g.towns.filter(t => t.owner === k && !t.ruined)
  if (!home.length) return
  let best: Unit | null = null, bd = -1
  for (const u of mine) {
    if (u.type === 'archer' || u.inTower >= 0 || u.hold || u.aiRole === 'garrison' || u.aiRole === 'retreat' || u.cell < 0 || u.state === 'dead') continue
    if (g.outposts.some(o => o.faction === k && Math.hypot(o.x - u.x, o.y - u.y) < 5 * TILE)) continue // this stretch is already covered
    const cx = u.cell % w, cy = (u.cell / w) | 0
    let edge = u.cutOff // already beyond supply, or: some land within 3 tiles ahead is not our supplied ground
    for (let dy = -3; dy <= 3 && !edge; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const i = y * w + x
      if (g.world.land[i] && !(g.controller[i] === k + 1 && g.supplied[i])) { edge = true; break }
    }
    if (!edge) continue
    const d = home.reduce((m, t) => Math.min(m, tiles(t, u)), Infinity)
    if (d > bd) { bd = d; best = u }
  }
  if (!best || bd < 5) return // not yet far from home: nothing to extend
  const toward = best.goalX >= 0 ? { x: best.goalX - best.x, y: best.goalY - best.y } : { x: 0, y: 0 }
  const tl = Math.hypot(toward.x, toward.y) || 1
  for (const off of [2, 0, -1]) { // a little ahead of the unit first, then on it, then behind
    const x = best.x + (toward.x / tl) * off * TILE, y = best.y + (toward.y / tl) * off * TILE
    if (g.outpostError(k, x, y) === null) { g.placeOutpost(k, x, y); g.outpostAt.set(k, g.time); return }
  }
}

/** Fighting value of a unit: warriors 1, knights 0.85, lancers 0.8, archers 0.6, scaled by squad size and health. */
export const unitPower = (u: Unit) => (u.type === 'warrior' ? 1 : u.type === 'knight' ? 0.85 : u.type === 'lancer' ? 0.8 : 0.6) * u.count * Math.max(0.3, u.hp / u.maxHp)
const totalPower = (g: Game, k: number) => g.diplomacy.bloc(k).reduce((n, m) => n + g.units.filter(u => u.faction === m && u.state !== 'dead').reduce((a, u) => a + unitPower(u), 0), 0)

/**
 * Each AI at war on land keeps one war goal: a target town. Progress (enemy losses, damage to the target, its capture) restarts a 4 minute
 * clock. A stalled war goes all-in if the nation is the stronger, ends in a ceasefire if it is clearly weaker (AI versus AI), and otherwise
 * switches to another town.
 */
/** Imperialists always; a pacifist only while it is at war (then it plays to win). */
export const isWarlike = (g: Game, k: number, atWar: boolean) => g.kingdoms[k].temperament === 'imperialist' || (atWar && g.kingdoms[k].temperament === 'pacifist')

export function updateWarGoal(g: Game, k: number, landEnemy: Town[], mine: Unit[]) {
  const M = g.warGoals
  if (!landEnemy.length) { M.delete(k); return null }
  let goal = M.get(k)
  const reach = [...g.towns.filter(t => t.owner === k && !t.ruined), ...mine.filter(u => u.aiRole === 'bridge')]
  const pick = (skip: number) => {
    let best: Town | null = null, bs = Infinity
    for (const t of landEnemy) {
      if (t.id === skip) continue
      const guards = g.units.filter(e => e.faction === t.owner && e.state !== 'dead' && e.inTower < 0 && tiles(e, t) < 6).length
      const s = reach.reduce((d, r) => Math.min(d, tiles(r, t)), Infinity) + guards * 1.5
      if (s < bs) { bs = s; best = t }
    }
    return best
  }
  const markOf = (t: Town) => g.diplomacy.casualties(t.owner, k) + (1 - t.hp / t.maxHp) * 10
  if (!goal || !landEnemy.some(t => t.id === goal!.target)) {
    const t = pick(-1)
    if (!t) { M.delete(k); return null }
    goal = { target: t.id, since: g.time, progressAt: g.time, mark: markOf(t), allIn: false, launched: false }
    M.set(k, goal)
  }
  const tgt = g.towns[goal.target]
  const mk = markOf(tgt)
  if (mk > goal.mark + 0.5) { goal.mark = mk; goal.progressAt = g.time }
  if (g.time - goal.progressAt > AI.warStall * (isWarlike(g, k, true) ? 0.5 : 1)) {
    const mineP = totalPower(g, k), foeP = Math.max(1, totalPower(g, tgt.owner)), ratio = mineP / foeP
    if (ratio >= 0.85) { goal.allIn = true; goal.progressAt = g.time - AI.warStall * 0.5 } // the stronger side stops waiting and commits everything
    else if (ratio < 0.7 && !g.kingdoms[tgt.owner].isPlayer && g.diplomacy.get(k, tgt.owner) !== 'total') { // clearly losing a stalled war: ask for a ceasefire
      g.diplomacy.set(k, tgt.owner, 'neutral', g.time, `${g.label(k)} and ${g.label(tgt.owner)} agree to a ceasefire`)
      M.delete(k); return null
    } else { const t = pick(goal.target); if (t) { goal.target = t.id; goal.mark = markOf(t) } goal.progressAt = g.time; goal.allIn = false; goal.launched = false }
  }
  g.aiMemo.target[k] = goal.target; g.aiMemo.targetAt[k] = g.time // targetOn() follows the goal
  return goal
}

/** Any nation (pacifists too) sends a couple of idle troops to claim an abandoned settlement on land it can walk to. */
function claimAbandoned(g: Game, k: number, ready: Unit[], attackers: Set<number>, landOf: (p: { x: number; y: number }) => number) {
  const t = g.towns.find(q => q.abandoned && !q.ruined && ready.some(u => landOf(u) === q.land && tiles(u, q) < 45))
  if (!t) return
  const pool = ready.filter(u => u.aiRole === '' && !attackers.has(u.id) && landOf(u) === t.land).sort((a, b) => tiles(a, t) - tiles(b, t)).slice(0, 2)
  for (const u of pool) if (far(u, t.x, t.y)) g.orderMoveTo(u, t.x + 30, t.y + 30)
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Lots (one per town) and border towers (max 5): never on an active fight, never right on the front line. */
function manageStructures(g: Game, k: number, hasTowns: boolean) {
  const kingdom = g.kingdoms[k]
  const ready = g.ready[k]
  if (!hasTowns || g.time - (g.aiMemo.tower[k] ?? -999) < (ready ? AI.towerEvery / 2 : AI.towerEvery)) return
  g.aiMemo.tower[k] = g.time
  const { w, h } = g.world

  // one lot per town (but not while we are saving for a boat or a colony: those come first)
  if (kingdom.lumber >= LOT.cost && !g.aiMemo.harvestSaved.has(k)) {
    for (const t of g.towns) {
      if (t.owner !== k || isSettlement(t) || t.ruined || g.towers.some(s => s.kind === 'lot' && s.town === t.id)) continue
      for (let tries = 0; tries < 30; tries++) {
        const a = g.rng.next() * Math.PI * 2, d = (3.2 + g.rng.next() * 2) * TILE
        const x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d
        if (!g.structureError('lot', k, x, y)) { g.placeLot(k, x, y); g.aiMemo.noSpot[k] = 0; return }
      }
      g.aiMemo.noSpot[k] = (g.aiMemo.noSpot[k] ?? 0) + 1 // no room for this town's lot just now
      break
    }
  }

  const mineT = g.towers.filter(t => t.faction === k && t.kind === 'tower')
  if (mineT.length >= (ready ? AGIT.readyTowers : AGIT.normalTowers) || kingdom.lumber < TOWER.cost) return
  const R = AI.towerBorderTiles
  const foreign = (c: number) => c !== 0 && c !== k + 1 && !g.diplomacy.allied(k, c - 1)
  const picks: number[] = []
  for (let tries = 0; tries < 500 && picks.length < 8; tries++) {
    const i = g.rng.int(0, w * h - 1)
    if (g.controller[i] !== k + 1 || !g.world.land[i]) continue
    const cx = i % w, cy = (i / w) | 0
    let nearest = Infinity
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < w && y < h && foreign(g.controller[y * w + x])) nearest = Math.min(nearest, Math.max(Math.abs(dx), Math.abs(dy))) }
    if (nearest > R || nearest < 3) continue // a bit behind the border, facing a neighbour — not on the exact frontline
    const x = (cx + 0.5) * TILE, y = (cy + 0.5) * TILE
    if (g.structureError('tower', k, x, y)) continue
    if (mineT.some(t => tiles(t, { x, y }) < AI.towerSpacingTiles)) continue
    // skip active war zones: fighting anywhere close, or hostile troops nearby
    const hot = g.units.some(u => u.state !== 'dead' && u.inTower < 0 && Math.hypot(u.x - x, u.y - y) < AI.quietWarzone * TILE && ((u.state === 'attacking' || u.state === 'cooldown') || g.hostile(k, u.faction)))
    if (hot) continue
    picks.push(i)
  }
  if (!picks.length) { g.aiMemo.noSpot[k] = (g.aiMemo.noSpot[k] ?? 0) + 1; return }
  g.aiMemo.noSpot[k] = 0
  const focus = g.agitFocus[k]
  if (ready && focus) picks.sort((p, q) => Math.hypot(((p % w) + 0.5) * TILE - focus.x, (Math.floor(p / w) + 0.5) * TILE - focus.y) - Math.hypot(((q % w) + 0.5) * TILE - focus.x, (Math.floor(q / w) + 0.5) * TILE - focus.y))
  const i = picks[0]
  g.placeTower(k, ((i % w) + 0.5) * TILE, (Math.floor(i / w) + 0.5) * TILE)
}

function nearestSuppliedCell(g: Game, u: Unit, k: number) {
  const { w, h } = g.world
  let best = -1, bd = Infinity
  for (let i = 0; i < w * h; i++) {
    if (g.controller[i] !== k + 1 || !g.supplied[i]) continue
    const d = Math.hypot((i % w + 0.5) * TILE - u.x, (Math.floor(i / w) + 0.5) * TILE - u.y)
    if (d < bd) { bd = d; best = i }
  }
  return best < 0 ? null : { x: (best % w + 0.5) * TILE, y: (Math.floor(best / w) + 0.5) * TILE }
}

// ---------------------------------------------------------------------------------------------------------------- navy
/** Saving for a boat or a colony: switch the pawns to unlimited harvesting until the money is there (manageFleet restores the setting afterwards). */
export function boostHarvest(g: Game, k: number) {
  const kingdom = g.kingdoms[k], saved = g.aiMemo.harvestSaved
  if (!saved.has(k)) saved.set(k, kingdom.harvest)
  kingdom.harvest = 'unlimited'
}

/** Lots and border towers come first; the navy is built only once every town has its lot and the tower quota is met (or there is no room left for them). */
export function structuresDone(g: Game, k: number): boolean {
  if ((g.aiMemo.noSpot[k] ?? 0) >= 4) return true
  const lotsMissing = g.towns.some(t => t.owner === k && !t.ruined && !isSettlement(t) && !g.towers.some(s => s.kind === 'lot' && s.town === t.id))
  const towers = g.towers.filter(t => t.faction === k && t.kind === 'tower').length
  return !lotsMissing && towers >= (g.ready[k] ? AGIT.readyTowers : AGIT.normalTowers)
}

/** A shore cell of the player's own supplied land that borders open ocean (not a lake), where a ship can be laid down. */
export function placeShip(g: Game, k: number, kind: BoatKind, near?: { x: number; y: number }): boolean {
  const { w, h } = g.world, tally = g.stats.k[k].placement[kind]
  tally.tries++
  const errs = new Map<string, number>() // why spots were refused: the War Room shows the commonest reason
  const fail = (why?: string) => {
    tally.fails++; tally.lastFailAt = g.time
    const top = [...errs.entries()].sort((a, b) => b[1] - a[1])[0]
    aiNote(g, k, `spot:${kind}`, 'block', why ?? (top ? `No free spot for a ${kind}: ${top[1]} of ${top[1] + (errs.size > 1 ? [...errs.values()].reduce((n, v) => n + v, 0) - top[1] : 0)} tried were refused (${top[0]})` : `No free spot for a ${kind}`))
    return false
  }
  const spots: [number, number][] = []
  for (let cy = 1; cy < h - 1; cy++) for (let cx = 1; cx < w - 1; cx++) {
    const i = cy * w + cx
    if (g.controller[i] !== k + 1 || !g.world.land[i] || !g.supplied[i]) continue
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const wi = (cy + dy) * w + cx + dx; if (!g.world.land[wi] && g.info.sea[wi]) spots.push([cx + dx, cy + dy]) } // open ocean only: never a landlocked lake
  }
  const inZone = (s: [number, number]) => { const x = (s[0] + 0.5) * TILE, y = (s[1] + 0.5) * TILE; return !!yardCovering(g, k, x, y) || !!regionTownAt(g, k, x, y) } // ships are laid down along a yard's white line (or beside a level 3 settlement)
  const coastSpots = spots.length
  { const ok = spots.filter(inZone); spots.splice(0, spots.length, ...ok) }
  if (!spots.length) return fail(coastSpots === 0 ? 'Landlocked: no sea coast inside its territory, so no ship can ever be built' : 'No open coast inside its shipyard\'s white line (no yard yet, or the yard is not on open sea)')
  // a yard within an enemy warship's reach would be shelled while it is a 1 hp construction site: prefer coasts out of range (or the farthest one)
  const foes = g.boats.filter(b => b.hp > 0 && (b.kind === 'zumwalt' || b.kind === 'gunship') && g.hostile(k, b.faction))
  if (foes.length && spots.length) {
    const reach = (kind === 'gunship' ? 13 : 26) * TILE
    const far = (s: [number, number]) => foes.reduce((m, f) => Math.min(m, Math.hypot((s[0] + 0.5) * TILE - f.x, (s[1] + 0.5) * TILE - f.y)), Infinity)
    const safe = spots.filter(s => far(s) >= reach)
    if (safe.length) spots.splice(0, spots.length, ...safe)
    else { spots.sort((p, q) => far(q) - far(p)); spots.splice(Math.max(3, Math.floor(spots.length / 5))) } // none is safe: the farthest fifth
  }
  if (near && spots.length > 8) { // a boat that will carry troops is laid down on the coast nearest them (not on some far corner of the realm)
    spots.sort((p, q) => Math.hypot((p[0] + 0.5) * TILE - near.x, (p[1] + 0.5) * TILE - near.y) - Math.hypot((q[0] + 0.5) * TILE - near.x, (q[1] + 0.5) * TILE - near.y))
    spots.splice(Math.max(8, Math.floor(spots.length / 6)))
  }
  for (let tries = 0; tries < 60 && spots.length; tries++) {
    const [wx, wy] = spots.splice(g.rng.int(0, spots.length - 1), 1)[0]
    const x = (wx + 0.5) * TILE, y = (wy + 0.5) * TILE
    const why = g.structureError(kind, k, x, y)
    if (why) { errs.set(why, (errs.get(why) ?? 0) + 1); continue }
    const placed = !!g.placeBoat(k, kind, x, y)
    if (placed) aiNote(g, k, `spot:${kind}`, 'ok', `Laid down a ${kind}`)
    return placed || fail()
  }
  return fail()
}

/**
 * Large nations (AI.fleetMinTowns+) keep a fleet of Zumwalts — one per AI.fleetPerTowns towns, at most AI.maxFleet — once their lots and
 * towers are done. A Zumwalt costs more than a 'med' stockpile allows, so a nation saving for one switches its pawns to unlimited
 * harvesting until it can pay (and goes back afterwards).
 */
function manageFleet(g: Game, k: number, towns: number, atWar = false, underNavalAttack = false, diploWar = false) {
  const kingdom = g.kingdoms[k], saved = g.aiMemo.harvestSaved
  const imperial = kingdom.temperament === 'imperialist' || (diploWar && kingdom.temperament === 'pacifist')
  const lands = new Set(g.towns.filter(t => t.owner === k && !t.ruined && !isSettlement(t)).map(t => t.land))
  const island = [...lands].every(L => !g.towns.some(t => !t.ruined && !isSettlement(t) && t.owner !== k && t.land === L)) // nobody else shares our land mass
  let want = towns >= AI.fleetMinTowns ? Math.min(AI.maxFleet, Math.floor(towns / AI.fleetPerTowns)) : 0
  if (towns >= AI.fleetMinTowns || (island && towns >= 3)) want = Math.max(want, 1) // big nations and island nations keep a Zumwalt for protection
  if (atWar && towns >= 3) want = Math.max(want, kingdom.lumber >= 350 || towns >= 5 ? 3 : 2) // a well-resourced nation at war fields 2–3
  const lostZums = g.stats.k[k].ships.zumwalt.lost > 0
  if (diploWar && lostZums && towns >= 2) want = Math.max(want, 2) // at war and a Zumwalt has gone down: replace it (allies fighting somebody else included)
  if (imperial) want = Math.min(6, 2 + Math.floor(towns / 3) + (atWar ? 1 : 0)) // for an imperialist Zumwalts are a top objective
  if (underNavalAttack && towns >= 1) want = Math.max(want, 2) // attacked from the sea: answer with warships of our own
  const have = g.boats.filter(b => b.faction === k && b.kind === 'zumwalt').length + g.towers.filter(t => t.faction === k && t.kind === 'zumwalt').length
  const wants = want > have && (underNavalAttack || g.time > (imperial ? 60 : AI.navyAfter)) && (underNavalAttack || imperial || (diploWar && lostZums) || structuresDone(g, k)) && !g.towers.some(t => t.faction === k && t.kind === 'zumwalt')
  const need = ZUMWALT.cost + AI.zumReserve
  if (!wants) {
    if (want <= have) aiNote(g, k, 'zumwalt', 'ok', want === 0 ? 'None wanted (too few towns)' : `Fleet complete: ${have}/${want} Zumwalts`)
    else if (g.towers.some(t => t.faction === k && t.kind === 'zumwalt')) aiNote(g, k, 'zumwalt', 'ok', 'A Zumwalt is under construction')
    else if (!underNavalAttack && g.time <= (imperial ? 60 : AI.navyAfter)) aiNote(g, k, 'zumwalt', 'wait', `Too early (starts at ${imperial ? 60 : AI.navyAfter}s)`)
    else aiNote(g, k, 'zumwalt', 'wait', `Lots and border towers first (${have}/${want} Zumwalts wanted)`)
  } else if (kingdom.lumber < need) aiNote(g, k, 'zumwalt', 'block', `Saving lumber: ${Math.floor(kingdom.lumber)} / ${need}`)
  if (wants && kingdom.lumber < need) {
    if (!saved.has(k)) saved.set(k, kingdom.harvest)
    kingdom.harvest = 'unlimited'
    return
  }
  if (saved.has(k)) { kingdom.harvest = imperial ? 'unlimited' : saved.get(k)!; saved.delete(k) }
  if (wants && kingdom.lumber >= need) aiNote(g, k, 'zumwalt', placeShip(g, k, 'zumwalt') ? 'ok' : 'block', g.towers.some(t => t.faction === k && t.kind === 'zumwalt') ? 'Laid down a Zumwalt' : 'No free spot along any shipyard coast')
}

/** The ocean-side water cell beside `town`'s land mass that is nearest to it and not watched over by enemy troops (null if there is none). */
/** Pick a landing beach the boat can actually sail to (a beach cut off by land is skipped) and set sail for it. */
function sailToLanding(g: Game, b: Boat, town: Town, k: number, avoid: number[], apart: { x: number; y: number }[]): { x: number; y: number } | null {
  const tried = [...avoid]
  for (let attempt = 0; attempt < 6; attempt++) {
    const spot = landingSpotFor(g, town, k, tried, apart)
    if (!spot) return null
    if (orderSail(g, b, [spot.x, spot.y])) return { x: spot.x, y: spot.y }
    tried.push(spot.cell)
  }
  return null
}

export function landingSpotFor(g: Game, town: Town, k: number, avoid: number[], apart: { x: number; y: number }[] = []): { x: number; y: number; cell: number } | null {
  const { w, h } = g.world
  const L = landmassAt(g.world, town.x, town.y), cx = Math.floor(town.x / TILE), cy = Math.floor(town.y / TILE)
  let best: { x: number; y: number; cell: number } | null = null, bs = Infinity
  for (let yy = Math.max(0, cy - 30); yy <= Math.min(h - 1, cy + 30); yy++) for (let xx = Math.max(0, cx - 30); xx <= Math.min(w - 1, cx + 30); xx++) {
    const i = yy * w + xx
    if (g.world.land[i] || !g.info.sea[i] || avoid.includes(i)) continue
    if (apart.some(a => Math.hypot(a.x - (xx + 0.5) * TILE, a.y - (yy + 0.5) * TILE) < 4 * TILE)) continue // boats of one wave land at different beaches
    let land = -1
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const lx = xx + dx, ly = yy + dy; if (lx >= 0 && ly >= 0 && lx < w && ly < h && g.world.land[ly * w + lx] && g.info.landmass[ly * w + lx] === L) { land = ly * w + lx; break } }
    if (land < 0) continue
    const px = (xx + 0.5) * TILE, py = (yy + 0.5) * TILE, lx = ((land % w) + 0.5) * TILE, ly = (Math.floor(land / w) + 0.5) * TILE
    let guards = 0
    for (const u of g.units) if (u.state !== 'dead' && u.inTower < 0 && !g.diplomacy.allied(k, u.faction) && Math.hypot(u.x - lx, u.y - ly) < (DOCK.guardTiles + 3) * TILE) guards++
    let towers = 0
    for (const t of g.towers) if (t.built && t.kind === 'tower' && g.hostile(k, t.faction) && Math.hypot(t.x - px, t.y - py) < 13 * TILE) towers++ // a tower's arrows reach 12 tiles out to sea
    const sc = Math.hypot(px - town.x, py - town.y) / TILE + guards * 8 + towers * 20 + (apart.length ? 0 : 0)
    if (sc < bs) { bs = sc; best = { x: px, y: py, cell: i } }
  }
  return best
}

const coastCache = new WeakMap<object, Map<number, number>>()
/** Distance in tiles from a town to the nearest open-sea shore on its own land mass (towns by the water are the easiest to hit). */
export function coastDistance(g: Game, t: Town): number {
  let m = coastCache.get(g); if (!m) { m = new Map(); coastCache.set(g, m) }
  const hit = m.get(t.id); if (hit !== undefined) return hit
  const { w, h } = g.world, R = 16
  let best = R
  for (let cy = Math.max(1, t.cy - R); cy <= Math.min(h - 2, t.cy + R); cy++) for (let cx = Math.max(1, t.cx - R); cx <= Math.min(w - 2, t.cx + R); cx++) {
    const i = cy * w + cx
    if (!g.world.land[i] || g.info.landmass[i] !== t.land) continue
    if (!(g.info.sea[i - 1] || g.info.sea[i + 1] || g.info.sea[i - w] || g.info.sea[i + w])) continue
    best = Math.min(best, Math.hypot(cx - t.cx, cy - t.cy))
  }
  m.set(t.id, best)
  return best
}

/** The overseas town to attack: the one nearest the coast (easy to land beside), then the weakly held and the near. */
function pickInvasionTarget(g: Game, k: number, towns: Town[]): Town | null {
  let best: Town | null = null, bs = Infinity
  for (const t of towns) {
    if (coastDistance(g, t) >= 16) continue // no shore within reach of the town: nowhere to land
    let guards = 0
    for (const u of g.units) if (u.state !== 'dead' && u.inTower < 0 && u.faction === t.owner && Math.hypot(u.x - t.x, u.y - t.y) < 12 * TILE) guards += u.count
    const towers = g.towers.filter(q => q.built && q.faction === t.owner && Math.hypot(q.x - t.x, q.y - t.y) < 12 * TILE).length
    const sc = coastDistance(g, t) * 3 + guards * 1.5 + towers * 4 + tiles(t, g.towns.find(q => q.owner === k && !isSettlement(q)) ?? t) * 0.08
    if (sc < bs) { bs = sc; best = t }
  }
  return best
}

/**
 * AI navy. Infantry boats ferry troops to enemy towns on other land masses (and, for a kingdom with no towns left, to wherever it can
 * retake one): they load idle healthy troops at home, land beside the target, and sail back for more. Zumwalts take stations off the
 * nearest enemy town (spread out, in open ocean) and shell whatever comes within their 15 tiles.
 */
function manageNavy(g: Game, k: number, warFoes: number[], enemyTowns: Town[], seaEnemy: Town[], mine: Unit[], landWar = false) {
  const kingdom = g.kingdoms[k]
  const myBoats = g.boats.filter(b => b.faction === k)
  const homeless = !g.towns.some(t => t.owner === k && !t.ruined)
  // townless kingdoms look for any town not held by an ally; the rest only cross the sea to a town of a nation they are at war with
  const overseas = homeless ? g.towns.filter(t => !t.ruined && !g.diplomacy.allied(k, t.owner) && !mine.some(u => landmassAt(g.world, u.x, u.y) === landmassAt(g.world, t.x, t.y))) : seaEnemy
  // ---- plan the expedition: the enemy town nearest the coast, and enough boats to out-number everyone who can meet us there ----
  const mobile = mine.filter(u => u.type !== 'archer' && !u.cutOff)
  const troops = mobile.reduce((n, u) => n + u.count, 0)
  const navalTroops = landWar ? Math.floor(troops * AI.navyShareAtLandWar) : troops // (a land war against a neighbour comes first: only a slice of the army may be shipped off)
  let ex = g.expeditions.get(k)
  if (!overseas.length || (ex && (!g.towns[ex.target] || g.towns[ex.target].ruined || !overseas.includes(g.towns[ex.target])))) { g.expeditions.delete(k); ex = undefined }
  if (!ex && overseas.length) {
    const target = pickInvasionTarget(g, k, overseas)
    if (target) {
      // everybody who stands on the target's land mass can come to its defence: a 30-unit nation needs 30 × 1.5 troops = 5 boats (the AI builds up first)
      const defenders = g.units.filter(u => u.state !== 'dead' && u.inTower < 0 && g.hostile(k, u.faction) && landmassAt(g.world, u.x, u.y) === target.land).reduce((n, u) => n + u.count, 0)
        + 2 * g.towers.filter(q => q.built && q.kind === 'tower' && q.faction === target.owner && landmassAt(g.world, q.x, q.y) === target.land).length
      const beachhead = g.units.some(u => u.faction === k && u.state !== 'dead' && landmassAt(g.world, u.x, u.y) === target.land) // our people are already ashore: reinforcements need no big margin
      const preferred = Math.max(AI.minForce, Math.ceil(defenders * 2)) // aim for twice the defenders...
      const required = beachhead ? AI.minForce : Math.max(AI.minForce, Math.ceil(defenders * 1.2)) // ...but go with 1.2x once the navy has softened them
      const hasZum = myBoats.some(b => b.kind === 'zumwalt') || g.towers.some(q => q.faction === k && q.kind === 'zumwalt')
      const pic0 = navalPicture(g, k, target)
      const needsZum = defenders > 8 || pic0.ships.length > 0 || pic0.towers.length > 0 // a lightly held, undefended coast can be rushed by one or two infantry boats; anything more needs the warships first
      // with warships on the job the defence is whittled down before the infantry lands, so the force is judged at the beach, not now
      if (homeless || (navalTroops * 0.95 >= (hasZum ? AI.minForce : required) && (hasZum || !needsZum))) {
        const frac = Math.min(AI.commitMax, Math.max(AI.commitMin, preferred / Math.max(1, troops)))
        // a wave is 1-3 FULL infantry boats: as many as the nation's troops can fill (at least what the target's defence calls for), never more than it can load
        const free = Math.floor(navalTroops * 0.95), need = Math.max(Math.ceil(preferred / BARGE.cap), Math.ceil((hasZum ? AI.minForce : required) / BARGE.cap), Math.floor(free / BARGE.cap), 1)
        const waveBoats = Math.min(AI.maxBoats, Math.max(1, Math.floor(free / BARGE.cap)), need) // (whole barges: each is filled to the brim)
        ex = { target: target.id, frac, force: homeless ? Math.min(AI.maxBoats * BARGE.cap, Math.max(1, Math.round(troops * frac))) : Math.max(1, Math.min(waveBoats * BARGE.cap, free)), since: g.time, launched: false }
        g.expeditions.set(k, ex)
      }
    }
  }
  if (ex && !ex.launched && !homeless) { // the army grows while the barges are built and loaded: the wave grows with it (never shrinks), so every barge sails full
    const freeNow = Math.floor(navalTroops * 0.95), boatsNow = Math.min(AI.maxBoats, Math.max(1, Math.floor(freeNow / BARGE.cap)))
    ex.force = Math.max(ex.force, Math.min(boatsNow * BARGE.cap, freeNow))
  }
  if (ex && g.time > AI.navyAfter * (homeless ? 0 : 1) && g.time - (g.aiMemo.navyAt[k] ?? -999) > AI.navyEvery && kingdom.aggression > 0.2) {
    g.aiMemo.navyAt[k] = g.time
    const sites = g.towers.filter(t => t.faction === k && t.kind === 'barge')
    const boats = myBoats.filter(b => b.kind === 'barge' && g.aiMemo.ship.get(b.id)?.phase !== 'hold').length + sites.length // (a barge holding a beachhead is not available for the next wave)
    const wanted = Math.min(AI.maxBoats, Math.ceil(ex.force / BARGE.cap))
    if (boats < wanted && !sites.length && !homeless) {
      if (kingdom.lumber >= BARGE.cost + AI.navyReserve) aiNote(g, k, 'barge', placeShip(g, k, 'barge', mobile.length ? { x: mobile.reduce((n, u) => n + u.x, 0) / mobile.length, y: mobile.reduce((n, u) => n + u.y, 0) / mobile.length } : undefined) ? 'ok' : 'block', 'Laying down a barge (or no free spot)')
      else { boostHarvest(g, k); aiNote(g, k, 'barge', 'block', `Saving lumber: ${Math.floor(kingdom.lumber)} / ${BARGE.cost + AI.navyReserve}`) }
    } else aiNote(g, k, 'barge', 'ok', homeless ? 'No towns' : sites.length ? 'A barge is under construction' : `Barges ready: ${boats}/${wanted}`)
  } else if (!ex) aiNote(g, k, 'barge', 'wait', 'No overseas invasion planned')
  else aiNote(g, k, 'barge', 'wait', kingdom.aggression <= 0.2 ? 'Too peaceful to invade' : 'Invasion cooldown / too early')
  // ---- warships: naval dominance first, then the defences, then the beach (see NavyAI.ts) ----
  const homeTowns = g.towns.filter(t => t.owner === k && !t.ruined)
  const leadShip = myBoats.find(q => q.kind === 'zumwalt') ?? myBoats.find(q => q.kind === 'gunship')
  let campaign: Town | null = ex ? g.towns[ex.target] ?? null : null
  if (!campaign && leadShip && enemyTowns.length) { // the fleet keeps one objective for a while (re-picking the nearest every tick made it sail back and forth between two)
    const keep = g.campaignMemo.get(k), held = keep ? enemyTowns.find(t => t.id === keep.town) : undefined
    if (held && g.time - keep!.since < 180) campaign = held
    else { campaign = enemyTowns.slice().sort((p, q) => tiles(p, leadShip) - tiles(q, leadShip))[0]; g.campaignMemo.set(k, { town: campaign.id, since: g.time }) }
  }
  manageNavalForces(g, k, campaign, homeTowns)
  // ---- operate ----
  const M = g.aiMemo.ship
  // the infantry goes in only when the navy has done its work: enemy warships sunk and the towers by the landing stripped (or long overdue)
  const picNow = campaign ? navalPicture(g, k, campaign) : null
  const waitedAll = ex ? g.time - ex.since : 0
  const fleetUp = !myBoats.some(q => q.kind === 'zumwalt') || myBoats.some(q => q.kind === 'zumwalt' && campaign && tiles(q, campaign) < 32)
  const navyReady = homeless || waitedAll > 90 || // (barges moor under fire and shove the defenders back: the fleet does not wait four minutes for the warships any more)
     ((!picNow || (picNow.ships.length === 0 && picNow.towers.length === 0)) && fleetUp)
  for (const b of myBoats) {
    let s = M.get(b.id)
    if (!s) { s = { phase: b.kind === 'zumwalt' ? 'station' : 'load', since: g.time, home: { x: b.x, y: b.y }, town: -1, avoid: [] }; M.set(b.id, s) }
    if (b.kind === 'zumwalt' || b.kind === 'gunship') continue // (warships are run by the naval campaign code in NavyAI.ts)
    // ---- the invasion fleet: BARGES carry the troops across the sea to a beach (infantry boats only ferry troops between a nation's own lands, see ColonyAI; cargo boats and gunships have their own handlers) ----
    if (b.kind !== 'barge') continue
    if (s.phase === 'hold') { // moored at the beachhead: it keeps the ground friendly (supply) while the landed troops press inland
      const landNow = b.dockCell >= 0 ? g.info.landmass[b.dockCell] : -1
      const foeTowns = g.towns.filter(t => !t.ruined && t.owner >= 0 && g.hostile(k, t.owner) && t.land === landNow)
      const goal = (ex && g.towns[ex.target] && g.towns[ex.target].land === landNow ? g.towns[ex.target] : null) ?? foeTowns.sort((p, q) => tiles(p, b) - tiles(q, b))[0] ?? null
      if (g.tickCount % 25 === b.id % 25 && b.docked) {
        const here = mine.filter(u => u.aiRole === '' && u.boardBoat < 0 && u.state === 'idle' && !u.cutOff && landmassAt(g.world, u.x, u.y) === landNow && tiles(u, b) < 16)
        for (const u of here) {
          const e = g.units.filter(q => q.state !== 'dead' && q.inTower < 0 && g.hostile(k, q.faction) && landmassAt(g.world, q.x, q.y) === landNow && tiles(q, u) < 22).sort((p, q) => tiles(p, u) - tiles(q, u))[0]
          if (e) g.orderMoveTo(u, e.x, e.y); else if (goal) g.orderMoveTo(u, goal.x, goal.y + 30)
        }
      }
      const safe = !g.units.some(q => q.state !== 'dead' && q.inTower < 0 && g.hostile(k, q.faction) && tiles(q, b) < 14)
      const won = !!goal ? false : foeTowns.length === 0
      if (!b.docked || b.hp < b.maxHp * 0.35 || g.time - s.since > 420 || (won && safe && g.time - s.since > 30)) { s.phase = 'return'; s.since = g.time; b.noDock = false; if (b.docked || b.route.length === 0) orderSail(g, b, [s.home.x, s.home.y]) }
      continue
    }
    if (!ex) { // nothing to cross for: wait at home
      b.noDock = false
      if (b.docked && b.cargo.length && s.phase !== 'load') unload(g, b) // troops still aboard at the quay go ashore (they must not be stranded on a boat nobody sails)
      if (s.phase !== 'load' && !b.docked && b.route.length === 0 && !b.docking) { orderSail(g, b, [s.home.x, s.home.y]); s.phase = 'return' }
      continue
    }
    const nearest = g.towns[ex.target]
    if (s.phase === 'load') {
      if (!b.docked) continue
      if (b.hp < b.maxHp * 0.6) { // a battered boat is mended at a shipyard (and nowhere else) before it takes troops: it sails there if it is moored elsewhere
        if (!atShipyard(g, b) && b.route.length === 0 && !b.docking) { const berth = yardBerth(g, k, b); if (berth) { b.noDock = false; orderSail(g, b, [berth.x, berth.y]) } }
        continue
      }
      const boatLand = b.dockCell >= 0 ? g.info.landmass[b.dockCell] : -1 // (the ship itself floats on water: compare with the land it is moored to)
      const pool = mine.filter(u => u.type !== 'archer' && (u.aiRole === '' || homeless) && !u.cutOff && (homeless || u.hp >= u.maxHp * 0.7) && u.boardBoat < 0 && Math.hypot(u.x - b.x, u.y - b.y) < 45 * TILE && landmassAt(g.world, u.x, u.y) === boatLand).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y)) // (the nearest walk to the boat; it may have been built far from the barracks)
      const aboard = cargoCount(g, b)
      const heading = mine.filter(u => u.boardBoat === b.id)
      let room = b.cap - aboard - heading.reduce((n, u) => n + u.count, 0)
      const candidates = pool.filter(u => u.boardBoat < 0)
      for (const u of candidates) { // squads of 1-5: take whoever fits the space left, nearest first, so the hold is filled to the last seat
        if (room <= 0) break
        if (u.count > room) continue
        if (b.dockCell >= 0 && g.orderMoveTo(u, (b.dockCell % g.world.w + 0.5) * TILE, (Math.floor(b.dockCell / g.world.w) + 0.5) * TILE)) { u.boardBoat = b.id; u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + 150); room -= u.count } // (kept on the job until they are aboard: no wandering off halfway)
      }
      // a barge is FULL when nobody more can fit; it is only sent short when nobody is left to send (a small nation), after a patient wait
      const walking = mine.some(u => u.boardBoat === b.id)
      const nobodyLeft = !walking && !candidates.some(u => u.boardBoat < 0 && u.count <= b.cap - aboard)
      const isFull = aboard >= b.cap
      if (nobodyLeft && !walking && aboard > 0) s.starveSince = s.starveSince && s.starveSince > 0 ? s.starveSince : g.time; else s.starveSince = -1
      const starved = (s.starveSince ?? -1) > 0 && g.time - (s.starveSince ?? 0) > 60
      const ready = (q: typeof b) => { const m = M.get(q.id); return cargoCount(g, q) >= q.cap || (!!m && (m.starveSince ?? -1) > 0 && g.time - (m.starveSince ?? 0) > 60 && cargoCount(g, q) > 0) }
      const loading = myBoats.filter(q => q.kind === 'barge' && M.get(q.id)?.phase === 'load')
      const aboardAll = loading.reduce((n, q) => n + cargoCount(g, q), 0)
      const waited = g.time - ex.since
      const boatsNeeded = Math.max(1, Math.ceil(ex.force / BARGE.cap)), fleetHere = loading.length >= boatsNeeded // (the whole fleet sails together: wait for the last boat to be built and loaded)
      const everyoneReady = loading.every(ready)
      const loaded = (isFull || starved) && ((fleetHere && everyoneReady) || waited > 240) || (waited > 420 && aboardAll >= 1)
      if (loaded && cargoCount(g, b) > 0) {
        s.avoid = []
        const home = { x: b.x, y: b.y }
        if (navyReady) { // nothing left to soften: straight to the beach
          const apart = myBoats.filter(q => q !== b && M.get(q.id)?.phase === 'sail' && M.get(q.id)?.spot).map(q => M.get(q.id)!.spot!)
          const spot = sailToLanding(g, b, nearest, k, s.avoid, apart)
          if (spot) { s.phase = 'sail'; s.since = g.time; s.town = nearest.id; s.home = home; s.dockSince = -1; s.lastHp = b.hp; s.hits = 0; s.spot = spot; ex.launched = true }
        } else { // the warships are still at work: sail WITH the fleet to a staging point outside tower reach and wait there
          const st = stagingPoint(g, k, nearest, b)
          b.noDock = true
          if (st && orderSail(g, b, [st.x, st.y])) { s.phase = 'stage'; s.since = g.time; s.town = nearest.id; s.home = home; s.dockSince = -1; s.lastHp = b.hp; s.hits = 0; s.spot = st; ex.launched = true }
          else b.noDock = false
        }
      } else if (cargoCount(g, b) === 0 && g.time - s.since > 150) s.since = g.time
    } else if (s.phase === 'stage') { // waiting offshore with the fleet until the sea and the walls are cleared
      b.noDock = true
      const stagedAll = myBoats.filter(q => q.kind === 'barge' && M.get(q.id)?.phase === 'stage').reduce((n, q) => n + cargoCount(g, q), 0)
      const defendersNow = g.units.filter(u => u.state !== 'dead' && u.inTower < 0 && g.hostile(k, u.faction) && landmassAt(g.world, u.x, u.y) === nearest.land).reduce((n, u) => n + u.count, 0)
      const hurtNow = b.hp < (s.lastHp ?? b.hp) - 1; s.lastHp = b.hp
      if (b.hp < b.maxHp * 0.4 || (hurtNow && !picNow?.ships.length && g.time - s.since > 20 && b.hp < b.maxHp * 0.7)) { b.noDock = false; s.phase = 'return'; orderSail(g, b, [s.home.x, s.home.y]); s.since = g.time }
      else if (!b.docked && b.route.length === 0 && s.spot && tiles(b, s.spot) > 4) orderSail(g, b, [s.spot.x, s.spot.y]) // (re-plan if the route fell through)
      else if (navyReady && (stagedAll >= Math.max(AI.minForce > 0 ? 2 : 1, Math.ceil(defendersNow * 1.2)) || g.time - s.since > 150)) { // the beach is ours to take: in, together
        b.noDock = false; s.avoid = []
        const apart = myBoats.filter(q => q !== b && M.get(q.id)?.phase === 'sail' && M.get(q.id)?.spot).map(q => M.get(q.id)!.spot!)
        const spot = sailToLanding(g, b, nearest, k, s.avoid, apart)
        if (spot) { s.phase = 'sail'; s.since = g.time; s.dockSince = -1; s.hits = 0; s.spot = spot } else { s.phase = 'return'; orderSail(g, b, [s.home.x, s.home.y]) }
      }
    } else if (s.phase === 'sail') {
      const hurt = b.hp < (s.lastHp ?? b.hp) - 1
      s.lastHp = b.hp
      const others = myBoats.filter(q => q !== b && M.get(q.id)?.phase === 'sail' && M.get(q.id)?.spot).map(q => M.get(q.id)!.spot!)
      const redirect = () => { // the beach is denied: back off before the hull is lost and look for another landing
        const cell = g.cellAt(b.x, b.y); if (cell >= 0) s.avoid.push(cell)
        if (s.spot) { const sc = g.cellAt(s.spot.x, s.spot.y); if (sc >= 0) s.avoid.push(sc) }
        s.dockSince = -1; s.hits = 0
        const spot = s.avoid.length < 8 ? sailToLanding(g, b, nearest, k, s.avoid, others) : null
        if (spot) s.spot = spot
        else { s.phase = 'return'; orderSail(g, b, [s.home.x, s.home.y]) }
      }
      if (b.docked && b.route.length === 0) { unload(g, b); s.phase = 'hold'; s.since = g.time; b.noDock = true } // (the barge stays moored: its beachhead keeps supplying the landed troops)
      else if (b.hp < b.maxHp * (b.kind === 'barge' ? 0.2 : 0.4) && !b.docked) { s.phase = 'return'; orderSail(g, b, [s.home.x, s.home.y]) } // too hurt: retreat before it sinks (a barge presses on much longer)
      else if (b.docking && b.dockBlocked) { // defenders hold the beach: give it a few seconds, then try elsewhere
        s.dockSince = s.dockSince && s.dockSince > 0 ? s.dockSince : g.time
        if (g.time - s.dockSince > 6) redirect()
      } else if (b.kind !== 'barge' && hurt && !b.docked) { s.hits = (s.hits ?? 0) + 1; if (s.hits >= 3) redirect() } // under fire on the approach (a barge does not care: it moors under fire)
      else if (g.time - s.since > 150) { s.phase = 'return'; orderSail(g, b, [s.home.x, s.home.y]) }
    } else if (s.phase === 'return') {
      b.noDock = false
      if (b.docked) { s.phase = 'load'; s.since = g.time }
      else if ((b.route.length === 0 && !b.docking) || g.time - s.since > 150) { orderSail(g, b, [s.home.x, s.home.y]); s.since = g.time }
    }
  }
  // a wave is over once nobody is still sailing out: plan the next one afresh (new target, new share of the forces)
  if (ex?.launched && !myBoats.some(q => q.kind === 'barge' && (M.get(q.id)?.phase === 'sail' || M.get(q.id)?.phase === 'stage'))) g.expeditions.delete(k)
  for (const id of [...M.keys()]) if (!g.boatById(id)) M.delete(id)
  void warFoes
}
