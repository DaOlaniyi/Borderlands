import { Game } from '../game/Game'
import { bestYardSite, placeYard } from '../game/Yards'
import { TILE } from '../game/config'
import { makeWorldFromMask } from '../game/WorldGenerator'
import type { Relation } from '../game/types'
import type { UnitType } from '../game/config'

export const openRows = (w: number, h: number) => Array.from({ length: h }, () => '#'.repeat(w))

export type TestSetup = {
  rows: string[]
  towns: [number, number, number][] // [kingdom, cx, cy]
  units?: ([number, number, number] | [number, number, number, UnitType])[] // [faction, cx, cy, type?]
  pawns?: boolean
  /** Relation between every pair of kingdoms (default: war, so combat/capture tests stay simple). */
  relation?: Relation
  barracks?: number[] // town indices that are barracks
  ai?: boolean // leave AI planning and production enabled
}

export function makeGame(s: TestSetup): Game {
  const world = makeWorldFromMask(s.rows)
  const g = new Game({
    world,
    spawns: s.towns.map(([kingdom, cx, cy], i) => ({ kingdom, cx, cy, barracks: s.barracks?.includes(i) })),
    units: (s.units ?? []).map(([faction, cx, cy, type]) => ({ faction, cx, cy, type })),
    noPawns: !s.pawns,
    plainRelations: true,
  })
  const rel = s.relation ?? 'war'
  for (let a = 0; a < g.kingdoms.length; a++) for (let b = a + 1; b < g.kingdoms.length; b++) g.diplomacy.set(a, b, rel, 0)
  g.diplomacy.events.length = 0
  g.markDirty(); g.recomputeTerritory() // relations (e.g. alliances) affect who owns which tile
  for (const k of g.kingdoms) if (!k.isPlayer) k.temperament = 'neutral' // tests start from a plain nation unless they say otherwise
  if (!s.ai) { g.aiEnabled = false; for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false } }
  return g
}

export const ctrl = (g: Game, cx: number, cy: number) => g.controller[cy * g.world.w + cx]
export const stepN = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.step(1 / 25) }
export const cellCenterPx = (cx: number, cy: number) => ({ x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE })

/** Gives every town of a kingdom its free shipyard (ships may only be laid down along a yard's white line). */
export function withYards(g: Game, faction = 0): Game {
  for (const t of g.towns) if (t.owner === faction && !t.ruined && t.kind !== 'settlement' && !g.yards.some(q => q.faction === faction)) { const s = bestYardSite(g, t); if (s) placeYard(g, faction, s.x, s.y) }
  return g
}
