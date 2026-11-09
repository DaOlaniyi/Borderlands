import { BOAT_FLAG, DAMAGE, TILE, TOWER, TOWN, UNIT, UNIT_BODY } from './config'
import type { Game } from './Game'
import { damageBoat } from './BoatSystem'
import type { Boat, Tower, Town, Unit } from './types'

/** A wounded unit hits softer: damage × max(0.2, health fraction). */
export const healthFactor = (u: { hp: number; maxHp: number }) => Math.max(DAMAGE.minHealthFactor, Math.min(1, u.hp / u.maxHp))

const near: number[] = []

/** Damage dealt to a unit. Blocking cuts it by 90%. Killing it may shift diplomacy (via killUnit). */
export function damageUnit(g: Game, target: Unit, amount: number, attackerFaction = -1, from?: { x: number; y: number }) {
  if (target.state === 'dead') return
  if (attackerFaction >= 0 && from && g.hostile(attackerFaction, target.faction)) g.addGrievance(target.faction, attackerFaction, from.x, from.y, 'attack')
  target.hp -= target.mode === 'block' ? amount * (1 - UNIT_BODY.blockReduction) : amount
  g.fx.push({ kind: 'hit', x: target.x, y: target.y - 30, t: 0 }); g.sounds.push({ name: 'hit', x: target.x, y: target.y })
  if (attackerFaction >= 0) g.diplomacy.fighting(attackerFaction, target.faction, g.time)
  if (target.hp <= 0) g.killUnit(target, attackerFaction)
}
/** Kept for the original call sites/tests. */
export const damageWarrior = damageUnit

export function damageTown(g: Game, t: Town, amount: number, attackerFaction: number) {
  if (t.ruined) return
  t.hp -= amount
  g.diplomacy.fighting(attackerFaction, t.owner, g.time)
  if (t.hp <= 0) g.destroyTown(t, attackerFaction)
}

export function damageTower(g: Game, t: Tower, amount: number, attackerFaction: number) {
  t.hp -= amount
  g.diplomacy.fighting(attackerFaction, t.faction, g.time)
  if (t.hp <= 0) g.destroyTower(t)
}

/** Start a smooth shove: the target glides away from `from` by up to `dist` px (stopping at water) and then re-focuses. */
function knockback(g: Game, target: Unit, fx: number, fy: number, dist: number) {
  if (target.inTower >= 0) return
  const dx = target.x - fx, dy = target.y - fy, d = Math.hypot(dx, dy) || 1
  for (let f = 1; f > 0; f -= 0.25) {
    const nx = target.x + (dx / d) * dist * f, ny = target.y + (dy / d) * dist * f
    if (g.isLandAt(nx, ny)) {
      target.kbSx = target.x; target.kbSy = target.y; target.kbEx = nx; target.kbEy = ny; target.kbT = 0
      target.state = 'idle'; target.attackT = 0; target.refocusT = UNIT_BODY.refocusTime
      return
    }
  }
}

/**
 * Automatic combat with a deterministic fixed-step state machine:
 * idle/moving → engaging → attacking → cooldown (→ engaging …). Blocking units only guard.
 * A unit with a route keeps it while it fights: it only stops for hostiles in its way (ahead of it) and resumes the route
 * when they die or move off. Idle melee units, and units just shoved back, chase a hostile within a few tiles.
 * Archers shoot only while standing; archers garrisoned in towers shoot at twice the range and damage.
 */
export function updateCombat(g: Game, dt: number) {
  const us = g.units
  const aggroPx = UNIT_BODY.aggroTiles * TILE
  for (const u of us) {
    if (u.state === 'dead') continue
    if (u.inTower >= BOAT_FLAG) { u.state = 'idle'; u.attackT = 0; continue } // troops aboard a ship do not fight until they land
    const st = UNIT[u.type], garrison = u.inTower >= 0
    if (u.disengageT > 0) u.disengageT -= dt
    if (u.refocusT > 0) u.refocusT -= dt
    if (u.kbT >= 0) continue // being shoved
    if (u.mode === 'block' && !garrison) { u.state = 'guarding'; u.attackT = 0; continue }
    if (u.state === 'guarding') u.state = 'idle'
    const rangeMult = garrison ? TOWER.rangeMult : 1
    const dmg = st.damage * u.count // garrisoned archers get a distance-based multiplier when the arrow lands

    if (u.state === 'attacking') {
      u.attackT += dt
      if (!u.attackHit && u.attackT >= st.attackDuration * st.activeAt) {
        u.attackHit = true
        resolveHit(g, u, dmg, st.range * rangeMult * 1.25)
      }
      if (u.attackT >= st.attackDuration) { u.state = 'cooldown'; u.cooldownT = st.cooldown; u.attackVariant = u.attackVariant === 0 ? 1 : 0 }
      continue
    }
    if (u.state === 'cooldown') {
      u.cooldownT -= dt
      if (u.cooldownT > 0) continue
      u.state = 'idle'
    }
    if (u.disengageT > 0) continue
    const routed = !garrison && u.routeIdx < u.route.length / 2
    if (u.type === 'archer' && !garrison && routed) continue // archers move, then shoot
    let hx = 0, hy = 0
    if (routed) { hx = u.route[u.routeIdx * 2] - u.x; hy = u.route[u.routeIdx * 2 + 1] - u.y; const hl = Math.hypot(hx, hy) || 1; hx /= hl; hy /= hl }

    // pick the nearest hostile unit or tower in range (for a moving unit: only those in its way)
    const range = st.range * rangeMult
    let best: Unit | null = null, bestTower: Tower | null = null, bestTown: Town | null = null, bestBoat: Boat | null = null, bestD = range
    g.unitHash.query(u.x, u.y, range, near)
    for (let k = 0; k < near.length; k++) {
      const o = us[near[k]]
      if (o.state === 'dead' || o.inTower >= 0 || !g.hostile(u.faction, o.faction)) continue
      const d = Math.hypot(o.x - u.x, o.y - u.y)
      if (d >= bestD) continue
      if (routed && d > UNIT_BODY.separation * 1.3 && ((o.x - u.x) * hx + (o.y - u.y) * hy) / (d || 1) < 0.15) continue
      bestD = d; best = o; bestTower = null; bestTown = null; bestBoat = null
    }
    for (const t of g.towers) {
      if (t.id === u.inTower || !g.hostile(u.faction, t.faction)) continue
      const d = Math.hypot(t.x - u.x, t.y - u.y) - TOWER.radius
      if (d >= bestD) continue
      if (routed && ((t.x - u.x) * hx + (t.y - u.y) * hy) / (Math.hypot(t.x - u.x, t.y - u.y) || 1) < 0.15) continue
      bestD = d; bestTower = t; best = null; bestTown = null; bestBoat = null
    }
    for (const b of g.boats) { // enemy ships are fair game for anyone in reach: melee troops strike hulls close to the shore, archers and tower garrisons shoot them at sea
      if (!g.hostile(u.faction, b.faction)) continue
      const d = Math.hypot(b.x - u.x, b.y - u.y) - (b.kind === 'zumwalt' ? 80 : 46)
      if (d >= bestD) continue
      if (routed && ((b.x - u.x) * hx + (b.y - u.y) * hy) / (Math.hypot(b.x - u.x, b.y - u.y) || 1) < 0.15) continue
      bestD = d; bestBoat = b; best = null; bestTower = null; bestTown = null
    }
    if (!best && !bestTower && u.faction === 0 && !garrison) { // RAZE objective: with no unit or tower to fight, tear the town down
      for (const t of g.towns) {
        if (t.ruined || !t.raze || !g.hostile(u.faction, t.owner)) continue
        const d = Math.hypot(t.x - u.x, t.y - u.y) - TOWN.captureRadius * 0.7
        if (d >= bestD) continue
        if (routed && ((t.x - u.x) * hx + (t.y - u.y) * hy) / (Math.hypot(t.x - u.x, t.y - u.y) || 1) < 0.15) continue
        bestD = d; bestTown = t
      }
    }
    if (!best && !bestTower && !bestTown && !bestBoat) {
      if (u.chase >= 0 && u.refocusT > 0 && !routed) { const f = g.unitById(u.chase); if (f && f.state !== 'dead' && f.inTower < 0) continue } // keep pursuing the archer that shot us
      u.chase = -1
      if ((u.type === 'warrior' || u.type === 'lancer') && !garrison && !u.hold && !routed) { // a user's order always outranks instinct
        let foe: Unit | null = null, fd = aggroPx
        g.unitHash.query(u.x, u.y, aggroPx, near)
        for (let k = 0; k < near.length; k++) {
          const o = us[near[k]]
          if (o.state === 'dead' || o.inTower >= 0 || !g.hostile(u.faction, o.faction)) continue
          const d = Math.hypot(o.x - u.x, o.y - u.y)
          if (d < fd) { fd = d; foe = o }
        }
        if (foe) u.chase = foe.id
      }
      continue
    }
    u.chase = -1
    const tgt = best ?? bestTower ?? bestBoat ?? bestTown!
    const tx = tgt.x, ty = tgt.y
    u.target = tgt.id; u.targetKind = best ? 'unit' : bestTower ? 'tower' : bestBoat ? 'boat' : 'town'
    u.aimX = tx - u.x; u.aimY = ty - u.y
    u.facing = tx < u.x ? -1 : 1
    u.state = 'attacking'; u.attackT = 0; u.attackHit = false // the route (if any) is kept and resumed afterwards
  }
}

/** Garrisoned archers hit 2× as hard within one tile of their tower, falling off linearly to 1× at maximum range. */
export function towerDamageMult(dist: number, range = UNIT.archer.range * TOWER.rangeMult): number {
  const close = TOWER.closeTiles * TILE
  if (dist <= close) return TOWER.damageMult
  const f = Math.max(0, 1 - (dist - close) / Math.max(1, range - close))
  return 1 + (TOWER.damageMult - 1) * f
}

function resolveHit(g: Game, u: Unit, dmg: number, reach: number) {
  const st = UNIT[u.type]
  dmg *= healthFactor(u)
  if (u.targetKind === 'boat') {
    const b = g.boatById(u.target)
    if (!b || b.hp <= 0 || Math.hypot(b.x - u.x, b.y - u.y) - (b.kind === 'zumwalt' ? 80 : 46) > reach) return
    if (u.type === 'archer') g.projectiles.push({ x0: u.x, y0: u.y - 40, x1: b.x, y1: b.y - 10, t: 0, dur: 0.3 })
    damageBoat(g, b, dmg, u.faction)
    return
  }
  if (u.targetKind === 'town') {
    const t = g.towns[u.target]
    if (!t || t.ruined || Math.hypot(t.x - u.x, t.y - u.y) - TOWN.captureRadius * 0.7 > reach) return
    if (u.type === 'archer') g.projectiles.push({ x0: u.x, y0: u.y - 40, x1: t.x, y1: t.y - 30, t: 0, dur: 0.3 })
    g.fx.push({ kind: 'hit', x: t.x + (u.x - t.x) * 0.3, y: t.y - 20, t: 0 })
    damageTown(g, t, dmg, u.faction)
    return
  }
  if (u.targetKind === 'tower') {
    const t = g.towerById(u.target)
    if (!t || Math.hypot(t.x - u.x, t.y - u.y) - TOWER.radius > reach) return
    if (u.type === 'archer') g.projectiles.push({ x0: u.x, y0: u.y - 40, x1: t.x, y1: t.y - 50, t: 0, dur: 0.3 })
    g.fx.push({ kind: 'hit', x: t.x, y: t.y - 30, t: 0 })
    damageTower(g, t, dmg, u.faction)
    return
  }
  const t = g.unitById(u.target)
  if (!t || (t.state as string) === 'dead' || Math.hypot(t.x - u.x, t.y - u.y) > reach) return
  const dist = Math.hypot(t.x - u.x, t.y - u.y)
  if (u.type === 'archer') { g.projectiles.push({ x0: u.x, y0: u.y - 40, x1: t.x, y1: t.y - 30, t: 0, dur: Math.min(0.5, 0.12 + dist / 1200) }); g.sounds.push({ name: 'arrow', x: u.x, y: u.y }) }
  if (u.inTower >= 0) dmg *= towerDamageMult(dist)
  damageUnit(g, t, dmg, u.faction, u)
  if (u.type === 'archer' && (t.state as string) !== 'dead') { const home = u.inTower >= 0 ? g.towerById(u.inTower) : null; g.notifyShot(t, home ? null : u, home) }
  if (st.knockback && (t.state as string) !== 'dead') knockback(g, t, u.x, u.y, st.knockback)
}

export { TILE }
