import { PAWN, SHOT_REACT, TILE, UNIT, UNIT_BODY } from './config'
import type { Game } from './Game'

type Mover = { x: number; y: number; vx: number; vy: number; route: number[]; routeIdx: number; facing: 1 | -1; stuck: number; chkX: number; chkY: number }

/**
 * Look-ahead path follower with acceleration-limited steering. Positions/velocities are continuous world values —
 * units glide along the drawn curve and never hop between tile centres. Waypoints count as reached inside a tolerance
 * radius (so units never fight to hit a point exactly), and a stall detector skips a waypoint a unit cannot reach
 * (e.g. when sliding around a blocker). Returns true while the unit is still following a route.
 */
export function followRoute(m: Mover, dt: number, speed: number, accel: number, lookAhead: number, arrive: number, canStand: (x: number, y: number) => boolean, wpTol = UNIT_BODY.waypointTol, endTol = UNIT_BODY.endTol): boolean {
  const n = m.route.length / 2
  let moving = false
  if (m.routeIdx < n) {
    while (m.routeIdx < n - 1 && Math.hypot(m.route[m.routeIdx * 2] - m.x, m.route[m.routeIdx * 2 + 1] - m.y) < wpTol) m.routeIdx++
    // also skip waypoints we have already run past (next point is nearer than this one and we are in tolerance of the segment)
    while (m.routeIdx < n - 1) {
      const ax = m.route[m.routeIdx * 2], ay = m.route[m.routeIdx * 2 + 1], bx = m.route[m.routeIdx * 2 + 2], by = m.route[m.routeIdx * 2 + 3]
      if (Math.hypot(bx - m.x, by - m.y) < Math.hypot(bx - ax, by - ay) * 0.5 && Math.hypot(ax - m.x, ay - m.y) < wpTol * 2.2) m.routeIdx++
      else break
    }
    const last = n - 1
    if (m.routeIdx >= last && Math.hypot(m.route[last * 2] - m.x, m.route[last * 2 + 1] - m.y) < endTol) m.routeIdx = n
  }
  let dvx = 0, dvy = 0
  if (m.routeIdx < n) {
    moving = true
    let tx = m.route[(n - 1) * 2], ty = m.route[(n - 1) * 2 + 1]
    let px = m.x, py = m.y, remaining = lookAhead
    for (let i = m.routeIdx; i < n; i++) {
      const qx = m.route[i * 2], qy = m.route[i * 2 + 1], d = Math.hypot(qx - px, qy - py)
      if (d >= remaining && d > 0) { const t = remaining / d; tx = px + (qx - px) * t; ty = py + (qy - py) * t; break }
      remaining -= d; px = qx; py = qy
    }
    let left = Math.hypot(m.route[m.routeIdx * 2] - m.x, m.route[m.routeIdx * 2 + 1] - m.y)
    for (let i = m.routeIdx + 1; i < n; i++) left += Math.hypot(m.route[i * 2] - m.route[i * 2 - 2], m.route[i * 2 + 1] - m.route[i * 2 - 1])
    const want = speed * Math.max(0.35, Math.min(1, (left - endTol) / arrive))
    const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy) || 1
    dvx = (dx / d) * want; dvy = (dy / d) * want
  }
  let ax = dvx - m.vx, ay = dvy - m.vy
  const al = Math.hypot(ax, ay), maxA = accel * dt
  if (al > maxA) { ax = (ax / al) * maxA; ay = (ay / al) * maxA }
  m.vx += ax; m.vy += ay
  if (!moving && Math.hypot(m.vx, m.vy) < 3) { m.vx = 0; m.vy = 0 }
  if (m.vx === 0 && m.vy === 0) return moving
  const nx = m.x + m.vx * dt, ny = m.y + m.vy * dt
  if (canStand(nx, ny)) { m.x = nx; m.y = ny }
  else if (canStand(nx, m.y)) { m.x = nx; m.vy = 0 }
  else if (canStand(m.x, ny)) { m.y = ny; m.vx = 0 }
  else { m.vx = 0; m.vy = 0 }
  if (Math.abs(m.vx) > 4) m.facing = m.vx < 0 ? -1 : 1
  if (moving) {
    // stall detector (net displacement per second, so being shoved back by a blocker counts as no progress):
    // skip the waypoint, or finish when we are already close to the end of the route
    if (m.stuck === 0) { m.chkX = m.x; m.chkY = m.y }
    m.stuck += dt
    if (m.stuck >= 1) {
      const moved = Math.hypot(m.x - m.chkX, m.y - m.chkY)
      m.stuck = 0
      if (moved < speed * 0.3) {
        const last = n - 1
        if (Math.hypot(m.route[last * 2] - m.x, m.route[last * 2 + 1] - m.y) < endTol * 6) { m.routeIdx = n; moving = false } // close enough
        else if (m.routeIdx < last) m.routeIdx++ // skip an unreachable waypoint, but never abandon the destination
      }
    }
  } else m.stuck = 0
  return moving
}

const near: number[] = []
export const sepOf = (u: { count: number; mode: string }) => (u.mode === 'block' ? UNIT_BODY.blockSeparation : UNIT_BODY.separation) + (u.count > 1 ? 6 : 0)

export function moveUnits(g: Game, dt: number) {
  const land = (x: number, y: number) => g.isLandAt(x, y)
  for (const u of g.units) {
    if (u.state === 'dead') continue
    u.px = u.x; u.py = u.y
    if (u.inTower >= 0) continue
    if (u.kbT >= 0) { // lancer shove: a short, sharp ease-out glide (positions interpolate, so it never looks like a teleport)
      u.kbT += dt
      const f = Math.min(1, u.kbT / UNIT_BODY.knockbackTime), e = 1 - (1 - f) * (1 - f) * (1 - f)
      u.x = u.kbSx + (u.kbEx - u.kbSx) * e; u.y = u.kbSy + (u.kbEy - u.kbSy) * e
      u.vx = u.vy = 0
      if (f >= 1) u.kbT = -1
      continue
    }
    if (u.mode === 'block') { u.vx = 0; u.vy = 0; continue }
    const busy = u.state === 'attacking' || u.state === 'cooldown' || u.state === 'engaging'
    if (busy) { u.vx *= 0.5; u.vy *= 0.5; if (Math.hypot(u.vx, u.vy) < 3) { u.vx = 0; u.vy = 0 } continue }
    const st = UNIT[u.type]
    const foe = u.chase >= 0 ? g.unitById(u.chase) : null
    let moving: boolean
    if (foe && foe.state !== 'dead' && foe.inTower < 0 && Math.hypot(foe.x - u.x, foe.y - u.y) < (u.refocusT > 0 ? SHOT_REACT.chaseTiles : UNIT_BODY.aggroTiles * 1.8) * TILE) {
      // pursue the hostile that was just fought; the assigned route is kept and resumed afterwards
      const r = u.route, ri = u.routeIdx
      u.route = [foe.x, foe.y]; u.routeIdx = 0
      moving = followRoute(u, dt, st.speed, st.accel, UNIT_BODY.lookAhead, UNIT_BODY.arrive, land)
      u.route = r; u.routeIdx = ri
    } else {
      u.chase = -1
      moving = followRoute(u, dt, st.speed, st.accel, UNIT_BODY.lookAhead, UNIT_BODY.arrive, land)
    }
    u.state = moving || u.chase >= 0 ? 'moving' : 'idle'
  }
  resolveCollisions(g)
}

/** Separation between units and the hard "no pass" zone around hostile blockers (blockers occupy twice the space). */
function resolveCollisions(g: Game) {
  g.refreshHash()
  const us = g.units
  for (let i = 0; i < us.length; i++) {
    const a = us[i]
    if (a.state === 'dead' || a.inTower >= 0 || a.mode === 'block') continue // blockers hold their ground
    g.unitHash.query(a.x, a.y, UNIT_BODY.blockSeparation + 8, near)
    for (let k = 0; k < near.length; k++) {
      const b = us[near[k]]
      if (b === a || b.state === 'dead' || b.inTower >= 0) continue
      let dx = a.x - b.x, dy = a.y - b.y
      let d = Math.hypot(dx, dy)
      if (d < 0.001) { dx = (a.id % 2 ? 1 : -1) * 0.5; dy = 0.3; d = Math.hypot(dx, dy) }
      const bBlocks = b.mode === 'block'
      const hostile = g.hostile(a.faction, b.faction)
      if (!hostile && bBlocks) continue // friendly and neutral units pass through a blocker
      const blockedBy = hostile && bBlocks
      const minD = blockedBy ? sepOf(b) : (sepOf(a) + sepOf({ count: b.count, mode: 'fight' })) / 2
      if (d >= minD) continue
      const push = minD - d
      const share = blockedBy || bBlocks ? 1 : 0.5
      const nx = a.x + (dx / d) * push * share, ny = a.y + (dy / d) * push * share
      if (g.isLandAt(nx, ny)) { a.x = nx; a.y = ny }
      if (blockedBy && a.route.length) a.state = 'blocked'
    }
  }
}

export function movePawns(g: Game, dt: number) {
  for (const p of g.pawns) {
    p.px = p.x; p.py = p.y
    const stand = (x: number, y: number) => g.canPawnStand(p, x, y)
    const moving = followRoute(p, dt, PAWN.speed, PAWN.accel, 36, 24, stand)
    if (!moving && p.state !== 'chopping' && p.state !== 'building' && p.state !== 'hitting' && p.state !== 'mining') p.route = p.route.length && p.routeIdx >= p.route.length / 2 ? [] : p.route
  }
}
