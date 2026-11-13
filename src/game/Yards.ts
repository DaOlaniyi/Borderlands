import { TILE, YARD } from './config'
import { isSettlement } from './Economy'
import type { Game } from './Game'
import type { Town, Yard } from './types'

const N4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]
const isUpgraded = (t: Town) => t.level >= 2 || t.kind === 'barracks' // (a barracks capital counts as a level 2 town)

/** Open ocean (never a lake) beside land cell (cx, cy)? */
const touchesSea = (g: Game, cx: number, cy: number) => {
  const { w, h } = g.world
  return N4.some(([dx, dy]) => { const x = cx + dx, y = cy + dy; return x >= 0 && y >= 0 && x < w && y < h && !g.world.land[y * w + x] && !!g.info.sea[y * w + x] })
}

/** The nearest of the kingdom's towns within reach of a spot: the town its shipyard stands beside. */
export function yardTownFor(g: Game, faction: number, x: number, y: number): Town | null {
  let best: Town | null = null, bd = YARD.townReach * TILE
  for (const t of g.towns) { if (t.ruined || t.owner !== faction || isSettlement(t)) continue; const d = Math.hypot(t.x - x, t.y - y); if (d <= bd) { bd = d; best = t } }
  return best
}

/** Towns (villages; settlements do not count) a kingdom holds on one landmass. */
export const holdingsOn = (g: Game, faction: number, land: number) => g.towns.reduce((n, t) => n + (!t.ruined && !isSettlement(t) && t.owner === faction && t.land === land ? 1 : 0), 0)
/** Shipyards a kingdom may keep on one landmass: one for any town there, plus one more for every four towns (8 towns = 2). */
export const yardQuota = (g: Game, faction: number, land: number) => { const n = holdingsOn(g, faction, land); return n === 0 ? 0 : Math.max(1, Math.floor(n / YARD.holdingsPerYard)) }
export const yardLand = (g: Game, q: { cx: number; cy: number }) => g.info.landmass[q.cy * g.world.w + q.cx]
export const yardsOn = (g: Game, faction: number, land: number) => g.yards.filter(q => q.faction === faction && yardLand(g, q) === land).length

/** Why a shipyard cannot go here (null when it can): free, on your own coast, one per town. */
export function yardError(g: Game, faction: number, x: number, y: number, forTown?: Town): string | null {
  const { w } = g.world, i = g.cellAt(x, y)
  if (i < 0 || !g.world.land[i]) return 'A shipyard must be built on land, beside the sea'
  const cx = i % w, cy = (i / w) | 0
  if (g.controller[i] !== faction + 1 || !g.supplied[i] || g.buffer[i]) return 'A shipyard must be inside your own territory'
  if (!touchesSea(g, cx, cy)) return 'A shipyard must touch the open sea (not a lake)'
  const land = g.info.landmass[i]
  if (yardsOn(g, faction, land) >= yardQuota(g, faction, land)) return yardQuota(g, faction, land) === 0 ? 'You hold no town on this landmass' : `This landmass already has its shipyard${yardQuota(g, faction, land) > 1 ? 's' : ''} (one per ${YARD.holdingsPerYard} towns)`
  const town = forTown ?? yardTownFor(g, faction, x, y)
  if (!town) return `The shipyard must stand within ${YARD.townReach} tiles of one of your towns`
  if (g.yards.some(q => Math.hypot(q.x - x, q.y - y) < YARD.anchorGap * TILE)) return 'Too close to another shipyard'
  if (g.towers.some(t => Math.hypot(t.x - x, t.y - y) < 1.5 * TILE) || g.towns.some(t => !t.ruined && Math.hypot(t.x - x, t.y - y) < 2 * TILE)) return 'Too close to another structure'
  return null
}

export function placeYard(g: Game, faction: number, x: number, y: number): Yard | null {
  if (yardError(g, faction, x, y)) return null
  const i = g.cellAt(x, y), cx = i % g.world.w, cy = (i / g.world.w) | 0
  const town = yardTownFor(g, faction, x, y)!
  const yard: Yard = { id: g.allocId(), faction, town: town.id, cx, cy, x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE, flash: 1 }
  g.yards.push(yard)
  g.sounds.push({ name: 'build', x: yard.x, y: yard.y })
  if (faction === 0) g.say('Shipyard built: ships may be laid down along the white line')
  return yard
}

/** The shipyard of `faction` whose white line (zoneTiles either side) covers a point in the water, if any. */
export function yardCovering(g: Game, faction: number, x: number, y: number, allies = false): Yard | null {
  const reach = (YARD.zoneTiles + 1.5) * TILE
  let best: Yard | null = null, bd = Infinity
  for (const q of g.yards) { if (q.faction !== faction && !(allies && g.diplomacy.allied(q.faction, faction))) continue; const d = Math.hypot(q.x - x, q.y - y); if (d <= reach && d < bd) { bd = d; best = q } }
  return best
}

/** Land cells of a yard's stretch of coast that border open sea (the cells whose water edges are drawn as the white line). */
export function yardShoreCells(g: Game, q: Yard): number[] {
  const { w, h } = g.world, R = YARD.zoneTiles, out: number[] = []
  for (let cy = Math.max(0, q.cy - R); cy <= Math.min(h - 1, q.cy + R); cy++) for (let cx = Math.max(0, q.cx - R); cx <= Math.min(w - 1, q.cx + R); cx++) {
    const i = cy * w + cx
    if (!g.world.land[i] || (cx - q.cx) ** 2 + (cy - q.cy) ** 2 > R * R || !touchesSea(g, cx, cy)) continue
    out.push(i)
  }
  return out
}

/**
 * How many ships a kingdom's towns support. Points: 1 per town, +2 per upgraded town (level 2 or barracks), +1 per level 3 settlement; a gunboat
 * uses 1, a Zumwalt 2, and Zumwalts are further capped at one per upgraded town and five per shipyard. Infantry and cargo boats are free.
 */
export function navalBudget(g: Game, faction: number) {
  let points = 0, upgraded = 0
  for (const t of g.towns) {
    if (t.ruined || t.owner !== faction) continue
    if (isSettlement(t)) { if (t.level >= 3) points += YARD.settlementPoints; continue }
    points += YARD.townPoints
    if (isUpgraded(t)) { points += YARD.upgradePoints; upgraded++ }
  }
  const yards = g.yards.filter(q => q.faction === faction).length
  const zumCap = Math.min(upgraded, yards * YARD.zumwaltsPerYard)
  let gun = 0, zum = 0
  for (const b of g.boats) if (b.faction === faction && b.hp > 0) { if (b.kind === 'gunship') gun++; else if (b.kind === 'zumwalt') zum++ }
  for (const s of g.towers) if (s.faction === faction && !s.built) { if (s.kind === 'gunship') gun++; else if (s.kind === 'zumwalt') zum++ }
  const used = gun * YARD.gunshipPoints + zum * YARD.zumwaltPoints
  return { points, used, gun, zum, zumCap, yards, canGunship: used + YARD.gunshipPoints <= points, canZumwalt: zum < zumCap && used + YARD.zumwaltPoints <= points }
}

/** A kingdom has a shipyard on each landmass it holds (more on a big one, see yardQuota). Each stands beside a town: when that town is captured or destroyed, or its ground is taken, the yard is destroyed (never captured) and its owner may build a new one for free. */
export function pruneYards(g: Game) {
  const before = g.yards.length
  g.yards = g.yards.filter(q => {
    const host = g.towns[q.town]
    return !!host && !host.ruined && host.owner === q.faction && g.controller[q.cy * g.world.w + q.cx] === q.faction + 1
  })
  const kept = new Map<number, number>() // losing villages lowers the quota: the newest yards on an over-served landmass go first
  g.yards = g.yards.filter(q => {
    const key = q.faction * 4096 + yardLand(g, q), n = (kept.get(key) ?? 0) + 1
    if (n > yardQuota(g, q.faction, yardLand(g, q))) return false
    kept.set(key, n); return true
  })
  if (g.yards.length !== before) g.markDirty()
}

/** The best coast cell for a new yard of this town: the shore nearest the town inside its own supplied territory (null when it has no coast). */
export function bestYardSite(g: Game, t: Town): { x: number; y: number } | null {
  const { w, h } = g.world, R = YARD.townReach
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let cy = Math.max(1, t.cy - R); cy <= Math.min(h - 2, t.cy + R); cy++) for (let cx = Math.max(1, t.cx - R); cx <= Math.min(w - 2, t.cx + R); cx++) {
    const x = (cx + 0.5) * TILE, y = (cy + 0.5) * TILE, d = Math.hypot(x - t.x, y - t.y)
    if (d >= bd || !g.world.land[cy * w + cx] || !touchesSea(g, cx, cy) || yardError(g, t.owner, x, y, t)) continue
    bd = d; best = { x, y }
  }
  return best
}

/** A ship is at a shipyard when it is moored on the stretch of coast (the white line) of one of its own kingdom's yards: the only place it can be repaired. */
export const atShipyard = (g: Game, b: { x: number; y: number; faction: number; docked: boolean }) => b.docked && !!yardCovering(g, b.faction, b.x, b.y, true) // (an ally's shipyard mends a ship too)

/** Open water beside the shore of the nearest of a kingdom's yards to `from` (where a ship goes to be mended; sailing there moors it), or null. */
export function yardBerth(g: Game, faction: number, from: { x: number; y: number }): { x: number; y: number } | null {
  const { w, h } = g.world
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (const q of g.yards) {
    if (q.faction !== faction) continue
    for (const i of yardShoreCells(g, q)) {
      const cx = i % w, cy = (i / w) | 0
      for (const [dx, dy] of N4) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= w || y >= h || g.world.land[y * w + x] || !g.info.sea[y * w + x]) continue
        const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE, d = Math.hypot(px - from.x, py - from.y)
        if (d < bd) { bd = d; best = { x: px, y: py } }
      }
    }
  }
  return best
}
