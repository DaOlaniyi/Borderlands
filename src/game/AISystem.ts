import { AGIT, AI, BOAT, DOCK, LOT, TILE, TOWER, ZUMWALT } from './config'
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
 *  - Freshly spawned or wounded units rest at a town until they reach AI.readyHp health.
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
  const enemyTowns = g.towns.filter(t => warFoes.includes(t.owner) && !t.ruined) // only war opens an invasion
  const landOf = (p: { x: number; y: number }) => landmassAt(g.world, p.x, p.y)
  const myLands = new Set<number>([...myTowns.map(landOf), ...mine.map(u => landOf(u))])
  const landEnemy = enemyTowns.filter(t => myLands.has(landOf(t))) // reachable on foot from somewhere we stand
  const seaEnemy = enemyTowns.filter(t => !myLands.has(landOf(t))) // across the water: needs the navy
  const hostileTowns = g.towns.filter(t => foes.includes(t.owner))
  const enemies = g.units.filter(u => foes.includes(u.faction) && u.state !== 'dead' && u.inTower < 0)

  manageStructures(g, k, myTowns.length > 0)
  manageFleet(g, k, myTowns.length)
  manageNavy(g, k, warFoes, enemyTowns, seaEnemy, mine)
  if (!mine.length) return
  watchdog(g, mine)

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
    const a = mine.filter(u => u.type === 'archer' && u.count === 1 && hpFrac(u) >= AI.readyHp && !(u.routeIdx < u.route.length / 2)).sort((p, q) => tiles(t, p) - tiles(t, q))[0]
    if (a) g.orderMoveTo(a, t.x, t.y + 36)
  }

  // ---- roles ----
  const worst = warFoes.reduce((r, f) => (g.diplomacy.get(k, f) === 'total' ? 3 : Math.max(r, 2)), 0)
  const share = worst >= 3 ? AI.totalShare : AI.warShare
  const melee = mine.filter(u => u.type !== 'archer').sort((a, b) => hpFrac(b) - hpFrac(a))
  const ready = melee.filter(u => hpFrac(u) >= AI.readyHp)
  // priorities: 1) defend ourselves, 2) spare troops defend threatened allies, 3) the rest pursue our own objectives
  const underThreat = enemies.some(e => myTowns.some(t => tiles(t, e) < 8))
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
  const attackN = landEnemy.length > 0 && g.time > 20 && !underThreat ? Math.min(onFront.length, Math.max(1, Math.round(melee.length * share))) : 0
  const attackers = new Set(onFront.slice(0, attackN).map(u => u.id))
  for (const u of mine) if ((u.aiRole === 'bridge' || u.aiRole === 'dash') && !landEnemy.length) release(g, u)
  if (attackers.size < 2) for (const u of mine) if (u.aiRole === 'bridge') release(g, u)

  // conflict response: retrieve seized land and retaliate for attacked units, but do not invade
  const recent = (g.aiMemo.grievance[k] ?? []).filter(e => g.time - e.t < AI.grievanceWindow && conflictFoes.includes(e.foe))
  if (recent.length) {
    const e = recent[recent.length - 1]
    const pool = ready.filter(u => u.aiRole === '' || u.aiRole === 'respond').sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))
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
    for (const u of melee) {
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
      if (hpFrac(u) < 0.5 || near >= 3) { u.aiRole = 'retreat'; g.aiMemo.dash.delete(u.id); const t = nearestSuppliedCell(g, u, k); if (t) g.orderMoveTo(u, t.x, t.y); return }
      if (far(u, town.x, town.y)) g.orderMoveTo(u, town.x, town.y + 20)
      return
    }
    if (u.aiRole === 'respond') {
      if (g.time > (g.aiMemo.respond.get(u.id) ?? 0) || hpFrac(u) < AI.retreatHp || u.cutOff && g.time - u.cutSince > AI.cutOffPatience) { g.aiMemo.respond.delete(u.id); u.aiRole = ''; u.goalX = -1 } else return
    }
    if (u.aiRole === 'garrison') { if (!g.towns.some(t => t.owner === k && tiles(t, u) < 3) || !foes.length) release(g, u); else return }
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

    // ---- rest: new and wounded units heal near a town before taking part ----
    if (hpFrac(u) < AI.readyHp && !u.cutOff) {
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
        if (u.type !== 'archer' && canBlock(g, u) && tiles(guardTown, u) < 3.5 && tiles(guardTown, threat) < 6.5) { aiBlock(g, u); return }
        if (u.mode === 'block') g.setBlock(u, false)
        if (!canBlock(g, u) && hpFrac(u) >= AI.readyHp && tiles(guardTown, threat) < 7.5) { if (far(u, threat.x, threat.y)) g.orderMoveTo(u, threat.x, threat.y); return } // it will not sit and wait: drive the lingering threat off
        const gx = guardTown.x + (threat.x - guardTown.x) * 0.4, gy = guardTown.y + (threat.y - guardTown.y) * 0.4
        if (far(u, gx, gy)) g.orderMoveTo(u, gx, gy)
        return
      }
      if (u.mode === 'block') g.setBlock(u, false)
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

  // one lot per town
  if (kingdom.lumber >= LOT.cost) {
    for (const t of g.towns) {
      if (t.owner !== k || g.towers.some(s => s.kind === 'lot' && s.town === t.id)) continue
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
/** Lots and border towers come first; the navy is built only once every town has its lot and the tower quota is met (or there is no room left for them). */
export function structuresDone(g: Game, k: number): boolean {
  if ((g.aiMemo.noSpot[k] ?? 0) >= 4) return true
  const lotsMissing = g.towns.some(t => t.owner === k && !t.ruined && !g.towers.some(s => s.kind === 'lot' && s.town === t.id))
  const towers = g.towers.filter(t => t.faction === k && t.kind === 'tower').length
  return !lotsMissing && towers >= (g.ready[k] ? AGIT.readyTowers : AGIT.normalTowers)
}

/** A shore cell of the player's own supplied land that borders open ocean (not a lake), where a ship can be laid down. */
function placeShip(g: Game, k: number, kind: 'boat' | 'zumwalt'): boolean {
  const { w, h } = g.world
  const spots: [number, number][] = []
  for (let cy = 1; cy < h - 1; cy++) for (let cx = 1; cx < w - 1; cx++) {
    const i = cy * w + cx
    if (g.controller[i] !== k + 1 || !g.world.land[i] || !g.supplied[i]) continue
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const wi = (cy + dy) * w + cx + dx; if (!g.world.land[wi] && g.info.sea[wi]) spots.push([cx + dx, cy + dy]) } // open ocean only: never a landlocked lake
  }
  for (let tries = 0; tries < 60 && spots.length; tries++) {
    const [wx, wy] = spots.splice(g.rng.int(0, spots.length - 1), 1)[0]
    const x = (wx + 0.5) * TILE, y = (wy + 0.5) * TILE
    if (g.structureError(kind, k, x, y)) continue
    return !!g.placeBoat(k, kind, x, y)
  }
  return false
}

/**
 * Large nations (AI.fleetMinTowns+) keep a fleet of Zumwalts — one per AI.fleetPerTowns towns, at most AI.maxFleet — once their lots and
 * towers are done. A Zumwalt costs more than a 'med' stockpile allows, so a nation saving for one switches its pawns to unlimited
 * harvesting until it can pay (and goes back afterwards).
 */
function manageFleet(g: Game, k: number, towns: number) {
  const kingdom = g.kingdoms[k], saved = g.aiMemo.harvestSaved
  const want = towns >= AI.fleetMinTowns ? Math.min(AI.maxFleet, Math.floor(towns / AI.fleetPerTowns)) : 0
  const have = g.boats.filter(b => b.faction === k && b.kind === 'zumwalt').length + g.towers.filter(t => t.faction === k && t.kind === 'zumwalt').length
  const wants = want > have && g.time > AI.navyAfter && structuresDone(g, k) && !g.towers.some(t => t.faction === k && t.kind === 'zumwalt')
  const need = ZUMWALT.cost + AI.zumReserve
  if (wants && kingdom.lumber < need) {
    if (!saved.has(k)) saved.set(k, kingdom.harvest)
    kingdom.harvest = 'unlimited'
    return
  }
  if (saved.has(k)) { kingdom.harvest = saved.get(k)!; saved.delete(k) }
  if (wants && kingdom.lumber >= need) placeShip(g, k, 'zumwalt')
}

/** The ocean-side water cell beside `town`'s land mass that is nearest to it and not watched over by enemy troops (null if there is none). */
function landingSpotFor(g: Game, town: Town, k: number, avoid: number[]): { x: number; y: number; cell: number } | null {
  const { w, h } = g.world
  const L = landmassAt(g.world, town.x, town.y), cx = Math.floor(town.x / TILE), cy = Math.floor(town.y / TILE)
  let best: { x: number; y: number; cell: number } | null = null, bs = Infinity
  for (let yy = Math.max(0, cy - 30); yy <= Math.min(h - 1, cy + 30); yy++) for (let xx = Math.max(0, cx - 30); xx <= Math.min(w - 1, cx + 30); xx++) {
    const i = yy * w + xx
    if (g.world.land[i] || !g.info.sea[i] || avoid.includes(i)) continue
    let land = -1
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const lx = xx + dx, ly = yy + dy; if (lx >= 0 && ly >= 0 && lx < w && ly < h && g.world.land[ly * w + lx] && g.info.landmass[ly * w + lx] === L) { land = ly * w + lx; break } }
    if (land < 0) continue
    const px = (xx + 0.5) * TILE, py = (yy + 0.5) * TILE, lx = ((land % w) + 0.5) * TILE, ly = (Math.floor(land / w) + 0.5) * TILE
    let guards = 0
    for (const u of g.units) if (u.state !== 'dead' && u.inTower < 0 && !g.diplomacy.allied(k, u.faction) && Math.hypot(u.x - lx, u.y - ly) < (DOCK.guardTiles + 3) * TILE) guards++
    let towers = 0
    for (const t of g.towers) if (t.built && t.kind === 'tower' && g.hostile(k, t.faction) && Math.hypot(t.x - px, t.y - py) < 13 * TILE) towers++ // a tower's arrows reach 12 tiles out to sea
    const sc = Math.hypot(px - town.x, py - town.y) / TILE + guards * 8 + towers * 20
    if (sc < bs) { bs = sc; best = { x: px, y: py, cell: i } }
  }
  return best
}

/**
 * AI navy. Infantry boats ferry troops to enemy towns on other land masses (and, for a kingdom with no towns left, to wherever it can
 * retake one): they load idle healthy troops at home, land beside the target, and sail back for more. Zumwalts take stations off the
 * nearest enemy town (spread out, in open ocean) and shell whatever comes within their 15 tiles.
 */
function manageNavy(g: Game, k: number, warFoes: number[], enemyTowns: Town[], seaEnemy: Town[], mine: Unit[]) {
  const kingdom = g.kingdoms[k]
  const myBoats = g.boats.filter(b => b.faction === k)
  const homeless = !g.towns.some(t => t.owner === k && !t.ruined)
  // townless kingdoms look for any town not held by an ally; the rest only cross the sea to a town of a nation they are at war with
  const overseas = homeless ? g.towns.filter(t => !t.ruined && !g.diplomacy.allied(k, t.owner) && !mine.some(u => landmassAt(g.world, u.x, u.y) === landmassAt(g.world, t.x, t.y))) : seaEnemy
  // ---- build infantry boats ----
  if (overseas.length && g.time > AI.navyAfter * (homeless ? 0 : 1) && g.time - (g.aiMemo.navyAt[k] ?? -999) > AI.navyEvery && kingdom.aggression > 0.2) {
    g.aiMemo.navyAt[k] = g.time
    const sites = g.towers.filter(t => t.faction === k && t.kind === 'boat')
    const boats = myBoats.filter(b => b.kind === 'boat').length + sites.length
    if (boats < AI.maxBoats && !sites.length && kingdom.lumber >= BOAT.cost + AI.navyReserve && !homeless) placeShip(g, k, 'boat')
  }
  // ---- operate ----
  const M = g.aiMemo.ship
  const zums = myBoats.filter(b => b.kind === 'zumwalt')
  for (const b of myBoats) {
    let s = M.get(b.id)
    if (!s) { s = { phase: b.kind === 'zumwalt' ? 'station' : 'load', since: g.time, home: { x: b.x, y: b.y }, town: -1, avoid: [] }; M.set(b.id, s) }
    if (b.kind === 'zumwalt') {
      if (!enemyTowns.length || (b.route.length > 0 && b.routeIdx < b.route.length / 2)) continue // peace: the fleet rides at anchor
      const nearest = enemyTowns.reduce((a, t) => (Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(t.x - b.x, t.y - b.y) ? a : t))
      const mates = zums.filter(z => z !== b)
      const crowded = (x: number, y: number) => mates.some(z => Math.hypot(z.x - x, z.y - y) < 4 * TILE || (z.route.length > 1 && Math.hypot(z.route[z.route.length - 2] - x, z.route[z.route.length - 1] - y) < 4 * TILE))
      const ocean = (x: number, y: number) => { const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE); return isWaterCell(g, cx, cy) && !!g.info.sea[cy * g.world.w + cx] && !mooringNear(g, x, y, 2.5) }
      let best: { x: number; y: number } | null = null, bd = Infinity
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2
        for (const r of [7, 9]) {
          const x = nearest.x + Math.cos(ang) * r * TILE, y = nearest.y + Math.sin(ang) * r * TILE
          if (!ocean(x, y) || crowded(x, y)) continue
          const d = Math.hypot(x - b.x, y - b.y)
          if (d < bd) { bd = d; best = { x, y } }
        }
      }
      if (!best) { // inland target: the open-water point nearest to it that is not already taken
        const cx = Math.floor(nearest.x / TILE), cy = Math.floor(nearest.y / TILE)
        let bt = Infinity
        for (let yy = cy - 24; yy <= cy + 24; yy++) for (let xx = cx - 24; xx <= cx + 24; xx++) {
          const x = (xx + 0.5) * TILE, y = (yy + 0.5) * TILE
          if (!ocean(x, y) || crowded(x, y)) continue
          const dt = Math.hypot(x - nearest.x, y - nearest.y)
          if (dt < bt) { bt = dt; best = { x, y }; bd = Math.hypot(x - b.x, y - b.y) }
        }
      }
      if (best && (bd > TILE * 1.5 || b.docked) && g.time - s.since > 4) { if (orderSail(g, b, [best.x, best.y])) s.since = g.time }
      continue
    }
    // ---- infantry boat ----
    if (!overseas.length) { // nothing to cross for: wait at home
      if (s.phase !== 'load' && !b.docked && b.route.length === 0 && !b.docking) { orderSail(g, b, [s.home.x, s.home.y]); s.phase = 'return' }
      continue
    }
    const nearest = overseas.reduce((a, t) => (Math.hypot(a.x - b.x, a.y - b.y) < Math.hypot(t.x - b.x, t.y - b.y) ? a : t))
    if (s.phase === 'load') {
      if (!b.docked) continue
      const boatLand = b.dockCell >= 0 ? g.info.landmass[b.dockCell] : -1 // (the ship itself floats on water: compare with the land it is moored to)
      const pool = mine.filter(u => u.type !== 'archer' && (u.aiRole === '' || homeless) && !u.cutOff && (homeless || u.hp >= u.maxHp * 0.7) && u.boardBoat < 0 && Math.hypot(u.x - b.x, u.y - b.y) < 12 * TILE && landmassAt(g.world, u.x, u.y) === boatLand)
      const room = b.cap - cargoCount(g, b) - mine.filter(u => u.boardBoat === b.id).length
      for (const u of pool.slice(0, Math.max(0, Math.min(room, 4)))) {
        if (b.dockCell >= 0 && g.orderMoveTo(u, (b.dockCell % g.world.w + 0.5) * TILE, (Math.floor(b.dockCell / g.world.w) + 0.5) * TILE)) { u.boardBoat = b.id; u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + 30) }
      }
      const aboard = cargoCount(g, b)
      if (aboard >= AI.boatRaidMin || (aboard > 0 && g.time - s.since > AI.loadSeconds)) {
        s.avoid = []
        const spot = landingSpotFor(g, nearest, k, s.avoid)
        if (spot && orderSail(g, b, [spot.x, spot.y])) { s.phase = 'sail'; s.since = g.time; s.town = nearest.id; s.home = { x: b.x, y: b.y }; s.dockSince = -1 }
      } else if (aboard === 0 && g.time - s.since > 120) s.since = g.time
    } else if (s.phase === 'sail') {
      if (b.docked && b.route.length === 0) { unload(g, b); s.phase = 'return'; s.since = g.time; orderSail(g, b, [s.home.x, s.home.y]) }
      else if (b.docking && b.dockBlocked) { // defenders hold the beach: after a while try another landing
        s.dockSince = s.dockSince && s.dockSince > 0 ? s.dockSince : g.time
        if (g.time - s.dockSince > 15) {
          const cell = g.cellAt(b.x, b.y); if (cell >= 0) s.avoid.push(cell)
          const spot = landingSpotFor(g, nearest, k, s.avoid)
          s.dockSince = -1
          if (spot && s.avoid.length < 6) orderSail(g, b, [spot.x, spot.y]); else { s.phase = 'return'; orderSail(g, b, [s.home.x, s.home.y]) }
        }
      } else if (g.time - s.since > 150) { s.phase = 'return'; orderSail(g, b, [s.home.x, s.home.y]) }
    } else if (s.phase === 'return') {
      if (b.docked) { s.phase = 'load'; s.since = g.time }
      else if ((b.route.length === 0 && !b.docking) || g.time - s.since > 150) { orderSail(g, b, [s.home.x, s.home.y]); s.since = g.time }
    }
  }
  for (const id of [...M.keys()]) if (!g.boatById(id)) M.delete(id)
  void warFoes
}
