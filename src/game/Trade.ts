import { CARGO, TILE, type Stock } from './config'
import { emptyStock, isWaterCell, orderSail, seaWalkable, stockTotal } from './BoatSystem'
import type { Game } from './Game'
import { isSettlement } from './Economy'
import { pathBetween } from './Routes'
import type { Boat, Town } from './types'

const N4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]

/** Open-sea water beside the town's own coast (the mooring cell where cargo boats serving it tie up); null when the town cannot be reached by sea. */
export function portFor(g: Game, t: Town): { x: number; y: number } | null {
  const { w, h } = g.world, R = 18
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let cy = Math.max(0, t.cy - R); cy <= Math.min(h - 1, t.cy + R); cy++) for (let cx = Math.max(0, t.cx - R); cx <= Math.min(w - 1, t.cx + R); cx++) {
    if (!isWaterCell(g, cx, cy) || !g.info.sea[cy * w + cx]) continue
    for (const [dx, dy] of N4) {
      const lx = cx + dx, ly = cy + dy
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue
      const li = ly * w + lx
      if (!g.world.land[li] || g.info.landmass[li] !== t.land || g.controller[li] !== t.owner + 1) continue
      const px = (cx + 0.5) * TILE, py = (cy + 0.5) * TILE, d = Math.hypot(px - t.x, py - t.y)
      if (d < bd) { bd = d; best = { x: px, y: py } }
      break
    }
  }
  return best
}

/** Standing order: load `plan` at town A, sail to town B, unload, return. Draws a dashed route line. Returns an error or null. */
export function setTradeRoute(g: Game, b: Boat, a: number, bTown: number, plan: Stock, back?: Stock): string | null {
  if (b.kind !== 'cargo') return 'Only cargo boats trade'
  const ta = g.towns[a], tb = g.towns[bTown]
  if (!ta || !tb || ta.ruined || tb.ruined || ta.owner !== b.faction || tb.owner !== b.faction) return 'Both ports must be yours'
  if (a === bTown) return 'Pick two different ports'
  if (ta.land === tb.land) return 'Both ports are on the same landmass'
  const pa = portFor(g, ta), pb = portFor(g, tb)
  if (!pa || !pb) return 'A port needs open water beside your own coast'
  const path = pathBetween(seaWalkable(g), pa.x, pa.y, pb.x, pb.y)
  if (!path) return 'No sea route between those ports'
  b.trade = { a, b: bTown, leg: 'toA', plan: { ...plan }, path, wait: 0, back: back ? { ...back } : undefined }
  b.want = emptyStock()
  b.loading = 0
  return null
}
export function clearTradeRoute(b: Boat) { b.trade = null; b.want = emptyStock(); b.unload = emptyStock() }

const atPort = (b: Boat, p: { x: number; y: number }) => b.docked && Math.hypot(b.x - p.x, b.y - p.y) < 3 * TILE
const idle = (b: Boat) => !b.docked && !b.docking && b.route.length === 0

export function updateTrade(g: Game, dt: number) {
  for (const b of g.boats) {
    const tr = b.trade
    if (!tr) continue
    const ta = g.towns[tr.a], tb = g.towns[tr.b]
    if (b.kind !== 'cargo' || !ta || !tb || ta.ruined || tb.ruined || ta.owner !== b.faction || tb.owner !== b.faction) { b.trade = null; b.want = emptyStock(); continue }
    const pa = portFor(g, ta), pb = portFor(g, tb)
    if (!pa || !pb) continue
    b.loading -= dt
    const sail = (p: { x: number; y: number }) => { if ((idle(b) || b.docked) && b.loading <= 0) { b.loading = 3; orderSail(g, b, [p.x, p.y]) } }
    switch (tr.leg) {
      case 'toA':
        if (atPort(b, pa)) {
          if (stockTotal(b.load) > 0.01 && tr.back) { tr.leg = 'unloadA'; tr.wait = 0; b.unload = { ...b.load }; b.want = emptyStock() } // what came back (gold) goes ashore at home first
          else { tr.leg = 'loadA'; tr.wait = 0; b.want = { ...tr.plan } }
        } else sail(pa)
        break
      case 'loadA': {
        tr.wait += dt
        const full = (['lumber', 'gold', 'meat'] as const).every(k => b.load[k] >= tr.plan[k] - 0.01)
        if (full || (tr.wait > 90 && stockTotal(b.load) > 0)) { tr.leg = 'toB'; b.want = emptyStock(); tr.wait = 0 }
        else if (tr.wait > 150) tr.wait = 0 // nothing to carry yet: keep waiting at the quay
        break
      }
      case 'toB':
        if (atPort(b, pb)) { tr.leg = 'unloadB'; tr.wait = 0; b.want = emptyStock(); b.unload = { ...b.load } } else sail(pb) // the whole hold goes ashore here
        break
      case 'unloadB':
        tr.wait += dt
        if (stockTotal(b.load) < 0.01 || tr.wait > 90) {
          b.unload = emptyStock(); tr.wait = 0
          const gold = (tb.store?.gold ?? 0) - (tb.level < 3 ? 5 : 0) // (a settlement keeps the 5 gold its last upgrade needs)
          if (tr.back && gold >= 1) { tr.leg = 'loadB'; b.want = { lumber: 0, meat: 0, gold: Math.min(tr.back.gold, Math.floor(gold)) } } // bring the settlement's gold home
          else tr.leg = 'toA'
        }
        break
      case 'loadB':
        tr.wait += dt
        if (b.load.gold >= b.want.gold - 0.01 || tr.wait > 100 || (tb.store?.gold ?? 0) - (tb.level < 3 ? 5 : 0) < 1) { tr.leg = 'toA'; tr.wait = 0; b.want = emptyStock() }
        break
      case 'unloadA':
        tr.wait += dt
        if (stockTotal(b.load) < 0.01 || tr.wait > 150) { tr.leg = 'loadA'; tr.wait = 0; b.unload = emptyStock(); b.want = { ...tr.plan } }
        break
    }
  }
}

/** Percentage of the requested cargo that is aboard (the badge over a loading cargo boat), or -1 when nothing was asked for. */
export function loadPercent(b: Boat): number {
  const want = (['lumber', 'gold', 'meat'] as const).reduce((n, k) => n + b.want[k], 0)
  if (want <= 0) return -1
  let have = 0
  for (const k of ['lumber', 'gold', 'meat'] as const) have += Math.min(b.load[k], b.want[k])
  return Math.round(Math.min(1, have / want) * 100)
}

/** Ask for cargo to be loaded (plus) or put ashore (minus): pawns of the region walk it between the town stockpile and the moored boat. */
export function setWant(b: Boat, kind: keyof Stock, amount: number) { b.want[kind] = Math.max(0, Math.min(CARGO.cap[kind], amount)) }
/** The Unload button: ask pawns to put exactly `amount` of a resource ashore (never more than the hold has), and stop reloading it. */
export function queueUnload(b: Boat, kind: keyof Stock, amount: number) {
  const room = Math.max(0, b.load[kind] - b.unload[kind])
  b.unload[kind] += Math.min(amount, room)
  b.want[kind] = Math.min(b.want[kind], Math.max(0, b.load[kind] - b.unload[kind]))
}
export const isPort = (t: Town) => !t.ruined && (isSettlement(t) || t.kind === 'town' || t.kind === 'barracks')
