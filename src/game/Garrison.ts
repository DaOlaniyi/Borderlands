import { AI, SETTLE, TILE } from './config'
import { isSettlement } from './Economy'
import type { Game } from './Game'
import type { Town, Unit } from './types'

const tiles = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / TILE

/** Troops each settlement level keeps posted beside it (a settlement collapses with nobody there; more troops make it harder to take). */
const SETTLEMENT_POSTS = [2, 3, 4]

/** Is this one of the kingdom's towns on a border: another nation's town on the same island within `AI.borderPostTiles`, or an enemy unit close by? */
function onBorder(g: Game, k: number, t: Town, enemies: Unit[]): boolean {
  if (g.towns.some(o => !o.ruined && o.owner >= 0 && o.owner !== k && o.land === t.land && !isSettlement(o) && tiles(o, t) < AI.borderPostTiles)) return true
  return enemies.some(e => tiles(e, t) < AI.borderPostTiles * 0.6)
}

/** How many troops a town should have posted. */
function postsWanted(g: Game, k: number, t: Town, enemies: Unit[], big: boolean): number {
  if (isSettlement(t)) return SETTLEMENT_POSTS[t.level - 1] ?? 2
  if (!big || !onBorder(g, k, t, enemies)) return 0
  const hot = g.towns.some(o => !o.ruined && o.owner >= 0 && o.owner !== k && o.land === t.land && g.hostile(k, o.owner) && tiles(o, t) < AI.borderPostTiles) || enemies.some(e => tiles(e, t) < AI.borderPostTiles * 0.6)
  return hot ? 2 : 1 // 1-2 troops at each border village, so an enemy cannot walk into an empty one
}

/**
 * Posts: a standing guard of 1-2 troops (more at colonies) beside settlements, and, once a nation is big enough (6+ towns), beside its border
 * villages. A posted unit has the 'post' role and `post` = its town: it stays there for good, runs out to meet enemies that come near, and
 * is never drafted into attacks, invasions or colony boats. If the town is lost the post is released.
 */
export function manageGarrisons(g: Game, k: number, mine: Unit[], enemies: Unit[]) {
  const towns = g.towns.filter(t => t.owner === k && !t.ruined)
  const big = towns.filter(t => !isSettlement(t)).length >= AI.borderPostTowns
  const posted = new Map<number, Unit[]>()
  for (const u of mine) {
    if (u.aiRole !== 'post') continue
    const t = (u.post ?? -1) >= 0 ? g.towns[u.post!] : undefined
    if (!t || t.ruined || t.owner !== k) { u.aiRole = ''; u.post = -1; u.hold = false; continue }
    let list = posted.get(t.id); if (!list) posted.set(t.id, list = []); list.push(u)
  }
  // filling barges comes first: while loading barges lack troops, border-village guards are relieved (and no new ones posted), and settlements keep one guard each
  let need = g.bargeNeed.get(k) ?? 0
  if (need > 0) {
    const order = [...posted.entries()].map(([id, list]) => ({ t: g.towns[id], list })).sort((a, b) => (isSettlement(a.t) ? 1 : 0) - (isSettlement(b.t) ? 1 : 0)) // villages before settlements
    for (const { t, list } of order) {
      const keep = isSettlement(t) ? 1 : 0
      while (list.length > keep && need > 0) { const u = list.pop()!; u.aiRole = ''; u.post = -1; u.hold = false; need-- }
    }
  }
  const relieving = (g.bargeNeed.get(k) ?? 0) > 0
  // the army must not be stripped: posts take at most a third of the melee troops (settlements first)
  const melee = mine.filter(u => u.type !== 'archer')
  let budget = Math.floor(melee.length * AI.postShare) - [...posted.values()].reduce((n, l) => n + l.length, 0)
  const free = melee.filter(u => u.aiRole === '' && u.boardBoat < 0 && !u.cutOff && u.hp >= u.maxHp * 0.5 && !g.resting.has(u.id) && u.inTower < 0)
  const needs = towns.map(t => ({ t, want: relieving ? (isSettlement(t) ? 1 : 0) : postsWanted(g, k, t, enemies, big), have: posted.get(t.id)?.length ?? 0 })).filter(n => n.have < n.want)
    .sort((a, b) => (isSettlement(b.t) ? 1 : 0) - (isSettlement(a.t) ? 1 : 0) || (a.have - b.have))
  for (const n of needs) {
    const pool = free.filter(u => u.aiRole === '' && sameLand(g, u, n.t)).sort((a, b) => tiles(a, n.t) - tiles(b, n.t))
    for (const u of pool.slice(0, n.want - n.have)) {
      if (budget <= 0 && !isSettlement(n.t)) break // (a settlement may always take its guard: it collapses without one)
      if (tiles(u, n.t) > 45) break
      u.aiRole = 'post'; u.post = n.t.id; u.hold = false; budget--
      g.aiMemo.respond.delete(u.id); g.aiMemo.dash.delete(u.id)
    }
  }
}
const sameLand = (g: Game, u: Unit, t: Town) => g.info.landmass[g.cellAt(u.x, u.y)] === t.land

/** One posted unit's turn: meet an enemy near its town, otherwise stand beside the town. */
export function runPost(g: Game, u: Unit, enemies: Unit[]) {
  const t = (u.post ?? -1) >= 0 ? g.towns[u.post!] : undefined
  if (!t || t.ruined || t.owner !== u.faction) { u.aiRole = ''; u.post = -1; return }
  const foe = enemies.filter(e => tiles(e, t) < 9).sort((a, b) => tiles(a, u) - tiles(b, u))[0]
  if (foe) { if (u.goalX < 0 || Math.hypot(u.goalX - foe.x, u.goalY - foe.y) > TILE * 2) g.orderMoveTo(u, foe.x, foe.y); return }
  const ship = g.boats.filter(b => b.hp > 0 && (b.docked || b.docking) && g.hostile(u.faction, b.faction) && tiles(b, t) < 10).sort((a, b) => tiles(a, u) - tiles(b, u))[0] // (a hostile ship moored beside the town is dealt with too)
  if (ship) { // (walk to the shore cell it is moored against: a point on the water cannot be reached)
    const w = g.world.w, sx = ship.dockCell >= 0 ? (ship.dockCell % w + 0.5) * TILE : ship.x, sy = ship.dockCell >= 0 ? (Math.floor(ship.dockCell / w) + 0.5) * TILE : ship.y
    if (u.goalX < 0 || Math.hypot(u.goalX - sx, u.goalY - sy) > TILE * 2) g.orderMoveTo(u, sx, sy); return
  }
  const gx = t.x + ((u.id % 5) - 2) * 26, gy = t.y + 54 + (u.id % 3) * 10
  if (tiles(u, t) > (isSettlement(t) ? SETTLE.troopTiles - 2 : 4) && (u.goalX < 0 || Math.hypot(u.goalX - gx, u.goalY - gy) > TILE)) g.orderMoveTo(u, gx, gy)
}
