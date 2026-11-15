import { TILE } from './config'
import { coastSpotFor } from './ColonyAI'
import { isSettlement } from './Economy'
import { orderSail, unload } from './BoatSystem'
import { yardBerth } from './Yards'
import type { Game } from './Game'
import type { Unit } from './types'

/** Troops a nation leaves on a settlement by level: more than this stand idle on a far island, so a boat fetches them home. */
export const SETTLEMENT_TROOPS = [3, 4, 5]
const SURPLUS_WAIT = 45 // seconds the extra troops stand on the island before a boat is sent (the fight there is over)
const MAX_MISSIONS = 3 // boats fetching troops at once, per kingdom

export type Evac = { boat: number; land: number; phase: 'go' | 'load' | 'back'; since: number; spot: { x: number; y: number } | null; avoid: number[] }

const tiles = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / TILE
export const evacKey = (k: number, land: number) => k * 1000 + land
/** Is this boat busy fetching troops home? */
export const isEvacBoat = (g: Game, id: number) => { for (const e of g.evacs.values()) if (e.boat === id) return true; return false }

/**
 * Evacuation: an organising task the AI checks every couple of seconds. Wherever a nation's troops on an island with none of its own towns outnumber
 * what its settlements there are allowed (3 / 4 / 5 by level), and no enemy town is left on the island, a barge or infantry boat fetches the extra
 * troops home (one mission per island, several at once). Back home they join whatever the barges are asking for.
 */
export function manageEvac(g: Game, k: number, mine: Unit[]) {
  const kingdom = g.kingdoms[k]
  if (kingdom.isPlayer) return
  for (const [key, ev] of [...g.evacs]) if (Math.floor(key / 1000) === k) runEvac(g, k, key, ev, mine)
  if (g.tickCount % 50 !== (k * 3) % 50) return
  let active = 0; for (const key of g.evacs.keys()) if (Math.floor(key / 1000) === k) active++
  if (active >= MAX_MISSIONS) return
  const lands = new Set<number>()
  for (const u of mine) if (u.type !== 'archer' && u.boardBoat < 0 && u.inTower < 0) lands.add(g.info.landmass[g.cellAt(u.x, u.y)])
  for (const L of lands) {
    if (L < 0 || g.evacs.has(evacKey(k, L))) continue
    const key = `${k}:${L}`
    const here = g.towns.filter(t => !t.ruined && t.land === L)
    if (here.some(t => t.owner === k && !isSettlement(t))) { g.evacSeen.delete(key); continue } // a real town of ours: this is home ground
    if (here.some(t => t.owner >= 0 && g.hostile(k, t.owner))) { g.evacSeen.delete(key); continue } // the campaign goes on
    const troops = mine.filter(u => u.type !== 'archer' && u.inTower < 0 && u.boardBoat < 0 && g.info.landmass[g.cellAt(u.x, u.y)] === L)
    const allowed = here.filter(t => t.owner === k && isSettlement(t)).reduce((n, t) => n + (SETTLEMENT_TROOPS[t.level - 1] ?? 3), 0)
    const surplus = troops.length - allowed
    if (surplus < 2) { g.evacSeen.delete(key); continue }
    const since = g.evacSeen.get(key) ?? g.time; g.evacSeen.set(key, since)
    if (g.time - since < SURPLUS_WAIT) continue
    const c = g.colonies.get(k), c2 = g.colonies.get(k + 100)
    const busy = new Set([c?.boat ?? -1, c?.cargo ?? -1, c2?.boat ?? -1, c2?.cargo ?? -1])
    const center = { x: troops.reduce((n, u) => n + u.x, 0) / troops.length, y: troops.reduce((n, u) => n + u.y, 0) / troops.length }
    const boat = g.boats.filter(b => b.faction === k && (b.kind === 'barge' || b.kind === 'boat') && b.hp > b.maxHp * 0.5 && b.cargo.length === 0 && !busy.has(b.id) && !isEvacBoat(g, b.id)
      && !['sail', 'stage', 'pickup', 'hold'].includes(g.aiMemo.ship.get(b.id)?.phase ?? 'load'))
      .sort((p, q) => (q.kind === 'barge' ? 1 : 0) - (p.kind === 'barge' ? 1 : 0) || tiles(p, center) - tiles(q, center))[0]
    if (!boat) continue
    g.evacs.set(evacKey(k, L), { boat: boat.id, land: L, phase: 'go', since: g.time, spot: null, avoid: [] })
    boat.noDock = false
    g.evacSeen.delete(key)
    return
  }
}

function runEvac(g: Game, k: number, key: number, ev: Evac, mine: Unit[]) {
  const b = g.boatById(ev.boat)
  const end = () => { g.evacs.delete(key); const bb = g.boatById(ev.boat); if (bb) bb.open = false }
  if (!b || b.hp <= 0 || g.time - ev.since > 420) return end()
  const onLand = mine.filter(u => u.type !== 'archer' && u.inTower < 0 && g.info.landmass[g.cellAt(u.x, u.y)] === ev.land)
  const posted = (u: Unit) => u.aiRole === 'post'
  const spare = () => onLand.filter(u => !posted(u) && u.boardBoat < 0)
  switch (ev.phase) {
    case 'go': {
      if (!spare().length) return end() // nobody left to fetch
      b.noDock = false
      if (!ev.spot) {
        const troops = spare()
        const c = { x: troops.reduce((n, u) => n + u.x, 0) / troops.length, y: troops.reduce((n, u) => n + u.y, 0) / troops.length }
        ev.spot = coastSpotFor(g, k, ev.land, c, ev.avoid)
        if (!ev.spot) return end()
        if (b.docked && b.cargo.length === 0) b.open = false
        if (!orderSail(g, b, [ev.spot.x, ev.spot.y])) return end()
        ev.since = Math.min(ev.since, g.time - 1)
      }
      const here = b.dockCell >= 0 ? g.info.landmass[b.dockCell] : -1
      if (b.docked && here === ev.land) { ev.phase = 'load'; ev.since = g.time; if (b.kind === 'barge') b.open = true; break }
      if (b.dockBlocked && b.docking && g.time - ev.since > 15 && ev.spot) { ev.avoid.push(g.cellAt(ev.spot.x, ev.spot.y)); ev.spot = null }
      else if (!b.docked && !b.docking && b.route.length === 0 && ev.spot) orderSail(g, b, [ev.spot.x, ev.spot.y])
      break
    }
    case 'load': {
      if (b.kind === 'barge' && !b.open) b.open = true
      const aboard = b.cargo.length
      const walking = mine.filter(u => u.boardBoat === b.id)
      const room = b.cap - (aboard + walking.length)
      for (const u of spare().sort((p, q) => tiles(p, b) - tiles(q, b)).slice(0, Math.max(0, room))) if (b.dockCell >= 0 && g.orderMoveTo(u, (b.dockCell % g.world.w + 0.5) * TILE, (Math.floor(b.dockCell / g.world.w) + 0.5) * TILE)) { u.boardBoat = b.id; u.aiRole = 'respond'; g.aiMemo.respond.set(u.id, g.time + 120) }
      const still = spare().length > 0 && room > 0
      if ((aboard > 0 && walking.length === 0 && !still) || (aboard > 0 && g.time - ev.since > 60) || (aboard === 0 && g.time - ev.since > 90)) {
        if (aboard === 0) return end()
        const berth = yardBerth(g, k, b)
        if (b.kind === 'barge') b.open = false
        b.noDock = false
        ev.phase = 'back'; ev.since = g.time
        if (!berth || !orderSail(g, b, [berth.x, berth.y])) { const home = g.towns.find(t => t.owner === k && !t.ruined && !isSettlement(t)); if (!home || !orderSail(g, b, [home.x, home.y])) return end() }
      }
      break
    }
    case 'back': {
      if (b.docked) { unload(g, b); return end() }
      if (!b.docking && b.route.length === 0 && g.time - ev.since > 4) { const berth = yardBerth(g, k, b); if (berth) orderSail(g, b, [berth.x, berth.y]); else return end() }
      break
    }
  }
}
