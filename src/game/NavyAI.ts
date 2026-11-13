import { aiNote } from './Stats'
import { navalBudget, yardBerth } from './Yards'
import { evading, hostileShoreNear, isWaterCell, mooringNear, orderSail, setStrikeOn, towerShadow } from './BoatSystem'
import { GUNSHIP, TILE, ZUMWALT } from './config'
import type { Game } from './Game'
import type { Boat, Town } from './types'

const tiles = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) / TILE
const isArmedBoat = (b: Boat) => b.kind === 'zumwalt' || b.kind === 'gunship'

/** How far from a target a ship stands to shoot (tiles): close enough to hit hard, outside a tower's 12-tile reach is impossible for a Zumwalt, so it simply tanks it. */
const STAND = { zumwaltShip: 13, zumwaltBuilding: 9, gunship: 8 }

/** How far (tiles) its escorts may lag before a Zumwalt waits for them (gunships are a little slower, so they trail it). */
const ESCORT_TILES = 22

/** Hostile warships close to one of the kingdom's towns or settlements. */
export function navalThreats(g: Game, k: number, home: Town[]): Boat[] {
  return g.boats.filter(b => b.hp > 0 && isArmedBoat(b) && g.hostile(k, b.faction) && home.some(t => tiles(t, b) < 30))
}

/**
 * Enemy sea power near a landing target: warships within 40 tiles, and built towers within 15 tiles (the defences a naval assault has to strip
 * before the infantry goes in). The invasion launches when both are gone.
 */
export function navalPicture(g: Game, k: number, target: Town) {
  const ships = g.boats.filter(b => b.hp > 0 && g.hostile(k, b.faction) && isArmedBoat(b) && tiles(b, target) < 40)
  const others = g.boats.filter(b => b.hp > 0 && g.hostile(k, b.faction) && !isArmedBoat(b) && tiles(b, target) < 28)
  const towers = g.towers.filter(t => t.built && t.kind === 'tower' && g.hostile(k, t.faction) && tiles(t, target) < 15)
  const sites = g.towers.filter(t => !t.built && g.hostile(k, t.faction) && (t.kind === 'boat' || t.kind === 'zumwalt' || t.kind === 'cargo' || t.kind === 'gunship' || t.kind === 'barge') && tiles(t, target) < 28)
  return { ships, others, towers, sites }
}

/** Open sea (not a lake, not beside a coast where a ship would moor) at a given world point. */
const oceanAt = (g: Game, x: number, y: number) => { const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE); return isWaterCell(g, cx, cy) && !!g.info.sea[cy * g.world.w + cx] && !mooringNear(g, x, y, 2.5) }

function stationNear(g: Game, z: Boat, target: Town, mates: Boat[]): { x: number; y: number } | null {
  const crowded = (x: number, y: number) => mates.some(m => m !== z && (Math.hypot(m.x - x, m.y - y) < 4 * TILE || (m.route.length > 1 && Math.hypot(m.route[m.route.length - 2] - x, m.route[m.route.length - 1] - y) < 4 * TILE)))
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2
    for (const r of [14, 17, 20]) { // (a Zumwalt keeps clear of the enemy shore: it shells from afar)
      const x = target.x + Math.cos(ang) * r * TILE, y = target.y + Math.sin(ang) * r * TILE
      if (!oceanAt(g, x, y) || crowded(x, y) || hostileShoreNear(g, z.faction, x, y) || towerShadow(g, z.faction, x, y)) continue // (never park inside a garrisoned tower's reach)
      const d = Math.hypot(x - z.x, y - z.y)
      if (d < bd) { bd = d; best = { x, y } }
    }
  }
  if (!best) { // an inland target: the open-water point nearest to it that is free
    const cx = Math.floor(target.x / TILE), cy = Math.floor(target.y / TILE)
    let bt = Infinity
    for (let yy = cy - 24; yy <= cy + 24; yy++) for (let xx = cx - 24; xx <= cx + 24; xx++) {
      const x = (xx + 0.5) * TILE, y = (yy + 0.5) * TILE
      if (!oceanAt(g, x, y) || crowded(x, y) || hostileShoreNear(g, z.faction, x, y)) continue
      const dt = Math.hypot(x - target.x, y - target.y)
      if (dt < bt) { bt = dt; best = { x, y } }
    }
  }
  return best
}

/**
 * Where infantry boats wait while the warships do their work: open water about 16 tiles off the target, outside tower reach, on the side
 * nearest `from` (and, when a Zumwalt is on the job, near it so the fleet stays together).
 */
export function stagingPoint(g: Game, k: number, target: Town, from: { x: number; y: number }): { x: number; y: number } | null {
  const lead = g.boats.find(b => b.faction === k && b.kind === 'zumwalt' && b.hp > 0 && tiles(b, target) < 45)
  const ref = lead ?? from
  let best: { x: number; y: number } | null = null, bd = Infinity
  for (let a = 0; a < 32; a++) {
    const ang = (a / 32) * Math.PI * 2
    for (const r of [16, 18, 20]) {
      const x = target.x + Math.cos(ang) * r * TILE, y = target.y + Math.sin(ang) * r * TILE
      if (!oceanAt(g, x, y) || towerShadow(g, k, x, y)) continue
      const d = Math.hypot(x - ref.x, y - ref.y)
      if (d < bd) { bd = d; best = { x, y } }
    }
  }
  return best
}

/** Flank slots around a Zumwalt: port, starboard and astern, relative to where it is heading. */
function flankSlot(z: Boat, index: number, heading: { x: number; y: number }): { x: number; y: number } {
  const hl = Math.hypot(heading.x, heading.y) || 1, hx = heading.x / hl, hy = heading.y / hl, px = -hy, py = hx
  const slot = index % 3
  if (slot === 0) return { x: z.x + px * 3.3 * TILE, y: z.y + py * 3.3 * TILE }
  if (slot === 1) return { x: z.x - px * 3.3 * TILE, y: z.y - py * 3.3 * TILE }
  return { x: z.x - hx * 4 * TILE, y: z.y - hy * 4 * TILE }
}
const headingOf = (z: Boat, towards: { x: number; y: number } | null) => {
  if (z.route.length >= 2 && z.routeIdx < z.route.length / 2) return { x: z.route[z.routeIdx * 2] - z.x, y: z.route[z.routeIdx * 2 + 1] - z.y }
  if (Math.hypot(z.vx, z.vy) > 4) return { x: z.vx, y: z.vy }
  return towards ? { x: towards.x - z.x, y: towards.y - z.y } : { x: 1, y: 0 }
}

/**
 * The AI's armed ships. In order of importance:
 *  1. DEFENCE: enemy warships near our towns are engaged by every ship we have.
 *  2. CAMPAIGN (against `target`): win the sea first (enemy warships, then other enemy ships and yards), then strip the towers, then keep
 *     killing troops and new buildings while the infantry lands. Zumwalts engage chosen targets (sailing into range, firing on the move).
 *  3. Gunships ride at the flanks of the Zumwalts (2-3 each), shielding them; spare ones escort cargo boats, hunt enemy cargo, and patrol.
 * A Zumwalt does not leave on an assault without at least two gunships alongside, and waits for slower escorts to catch up.
 */
export function manageNavalForces(g: Game, k: number, target: Town | null, home: Town[]) {
  const zums = g.boats.filter(b => b.faction === k && b.kind === 'zumwalt' && b.hp > 0)
  const guns = g.boats.filter(b => b.faction === k && b.kind === 'gunship' && b.hp > 0)
  const threats = navalThreats(g, k, home) // (known even to a nation with no ships: it will build some)
  if (threats.length) g.navalThreat.add(k); else g.navalThreat.delete(k)
  if (!zums.length && !guns.length) return
  const M = g.aiMemo.ship
  const lead = zums[0] ?? guns[0]

  for (const b of [...zums, ...guns]) b.noDock = !(b.kind === 'zumwalt' && M.get(b.id)?.phase === 'return') // AI warships stay afloat (no accidental mooring), except a Zumwalt going to be mended
  // ---- a Zumwalt that is burning (badly hurt) with no mission on goes to a shipyard berth to be mended, and goes back to station once whole ----
  for (const z of zums) {
    let s = M.get(z.id)
    if (!s) { s = { phase: 'station', since: g.time, home: { x: z.x, y: z.y }, town: -1, avoid: [] }; M.set(z.id, s) }
    const hurt = z.hp < z.maxHp * ZUMWALT.fireBelow * 2
    if (s.phase === 'return') {
      if (z.hp >= z.maxHp - 1) { s.phase = 'station'; s.since = g.time; z.noDock = true }
      else if (z.strike && z.strike.kind !== 'ground' && z.hp >= z.maxHp * 0.5) { s.phase = 'station'; z.noDock = true } // (mended enough for a mission)
      else if (!z.docked && z.route.length === 0 && !z.docking && g.time - s.since > 3) { const berth = yardBerth(g, k, z); if (berth && orderSail(g, z, [berth.x, berth.y])) s.since = g.time }
    } else if (hurt && !threats.length && !z.strike && !evading(g, z)) {
      const berth = yardBerth(g, k, z)
      if (berth) { s.phase = 'return'; s.since = g.time; z.noDock = false; orderSail(g, z, [berth.x, berth.y]) }
    }
  }
  const mending = (z: Boat) => M.get(z.id)?.phase === 'return'
  // cover: two gunships within reach; a nation that cannot get gunships (naval point budget used up, or no lumber) lets its Zumwalts cover each other in groups, rather than sit idle for ever
  const cantEscort = guns.length < 2 && zums.length >= 2 && (!navalBudget(g, k).canGunship || g.kingdoms[k].lumber < GUNSHIP.cost)
  const cover = (z: Boat) => guns.filter(q => tiles(q, z) < ESCORT_TILES).length + (cantEscort ? 2 * zums.filter(o => o !== z && !mending(o) && tiles(o, z) < ESCORT_TILES).length : 0)
  const escortedZ = (z: Boat) => !mending(z) && cover(z) >= 2
  // ---- 1. defence ----
  let engaged: Boat | null = null
  if (threats.length) {
    // answer whoever is shooting at our ships first (an enemy within reach of any of them), then the nearest threat to the fleet
    const closeToOurs = (e: Boat) => [...zums, ...guns].reduce((m, s) => Math.min(m, tiles(s, e)), Infinity)
    engaged = threats.slice().sort((a, b) => (closeToOurs(a) < 14 ? 0 : 1) - (closeToOurs(b) < 14 ? 0 : 1) || (b.kind === 'zumwalt' ? 1 : 0) - (a.kind === 'zumwalt' ? 1 : 0) || tiles(a, lead) - tiles(b, lead))[0]
    for (const b of [...zums, ...guns]) { // each ship takes the attacker nearest to IT when one is on top of it
      const mine = threats.filter(e => tiles(e, b) < 12).sort((p, q) => tiles(p, b) - tiles(q, b))[0] ?? engaged
      if (!b.strike || b.strike.kind !== 'boat' || !g.boatById(b.strike.id) || (mine.id !== b.strike.id && tiles(mine, b) < 8 && tiles(b, { x: b.strike.x, y: b.strike.y }) > 12)) setStrikeOn(b, 'boat', mine.id, mine.x, mine.y)
    }
  }

  // ---- 1b. bodyguard: a Zumwalt under gunship fire backs away (BoatSystem.protectZumwalt) while the gunships go forward and settle the attackers ----
  const harassed = zums.map(z => ({ z, att: g.boats.filter(e => e.hp > 0 && e.kind === 'gunship' && g.hostile(k, e.faction) && tiles(e, z) < GUNSHIP.rangeTiles + 4) })).filter(h => h.att.length)
  for (const gb of guns) {
    const cover = harassed.filter(h => tiles(h.z, gb) < 32).sort((p, q) => tiles(p.z, gb) - tiles(q.z, gb))[0]
    if (!cover) continue
    const a = cover.att.slice().sort((p, q) => tiles(p, cover.z) - tiles(q, cover.z) || tiles(p, gb) - tiles(q, gb))[0] // the attacker closest to the Zumwalt first
    if (!gb.strike || gb.strike.kind !== 'boat' || gb.strike.id !== a.id) setStrikeOn(gb, 'boat', a.id, a.x, a.y)
    const s0 = M.get(gb.id); if (s0) s0.since = g.time
    engaged ??= a // (the fleet is in a fight: no station moves or flank formation while it lasts)
  }

  // ---- 2. campaign ----
  let squadronGoal: { x: number; y: number } | null = null
  if (!engaged) for (const z of zums) if (!escortedZ(z) && z.strike && z.strike.kind !== 'ground') { z.strike = null; z.target = null } // (no sorties alone: whatever it was after, it lets go until the escorts are with it)
  if (!engaged && target && !target.ruined) {
    const pic = navalPicture(g, k, target)
    const zumsGo = zums.filter(escortedZ) // (only the escorted ones are given the mission)
    const nearestTo = <T extends { x: number; y: number }>(list: T[]) => list.slice().sort((a, b) => tiles(a, lead) - tiles(b, lead))[0]
    if (pic.ships.length) { // naval dominance: sink the enemy navy first, everything we have on it
      const e = nearestTo(pic.ships)
      for (const b of [...zumsGo, ...guns]) if (!b.strike || b.strike.kind !== 'boat' || !g.boatById(b.strike.id)) setStrikeOn(b, 'boat', e.id, e.x, e.y)
    } else if (pic.others.length || pic.sites.length) { // then every other ship and yard
      for (const b of zumsGo) { if (b.strike && b.strike.kind !== 'ground' && (b.strike.kind === 'boat' ? g.boatById(b.strike.id) : g.towerById(b.strike.id))) continue; if (pic.others.length) { const e = nearestTo(pic.others); setStrikeOn(b, 'boat', e.id, e.x, e.y) } else { const e = nearestTo(pic.sites); setStrikeOn(b, 'tower', e.id, e.x, e.y) } }
      for (const b of guns) if (!b.strike && pic.others.length) { const e = nearestTo(pic.others); setStrikeOn(b, 'boat', e.id, e.x, e.y) }
    } else if (pic.towers.length) { // then the defences, each Zumwalt on a tower
      for (const [i, b] of zumsGo.entries()) { if (b.strike && b.strike.kind === 'tower' && g.towerById(b.strike.id)) continue; const e = pic.towers.slice().sort((p, q) => tiles(p, b) - tiles(q, b))[i % pic.towers.length]; if (e) setStrikeOn(b, 'tower', e.id, e.x, e.y) }
    } else { // the sea and the walls are ours: keep killing what the enemy raises (troops first, then buildings)
      for (const b of zumsGo) { b.focus = 'troops'; if (b.strike && b.strike.kind === 'ground') b.strike = null }
    }
    for (const b of zums) b.focus = pic.ships.length || pic.others.length ? 'ships' : pic.towers.length ? 'buildings' : 'troops'
    squadronGoal = { x: target.x, y: target.y }
  }

  // ---- Zumwalt movement: go to a station off the target, but only WITH an escort (at least two gunships alongside); alone, it waits at its berth ----
  for (const z of zums) {
    let s = M.get(z.id)
    if (!s) { s = { phase: 'station', since: g.time, home: { x: z.x, y: z.y }, town: -1, avoid: [] }; M.set(z.id, s) }
    if (mending(z)) continue // (on its way to, or lying at, the yard)
    if (evading(g, z)) continue // backing away from gunships: the escorts are dealing with them
    if (z.strike && z.strike.kind !== 'ground') continue // engaging a chosen target: the approach logic sails it
    if (!squadronGoal || engaged) continue
    const guards = cover(z)
    if (z.route.length > 0 && z.routeIdx < z.route.length / 2) { // under way: it waits (route dropped, no turning back) while fewer than two escorts are within reach, and sets off again when they catch up
      if (guards < 2) { z.route = []; z.routeIdx = 0; s.since = g.time - 3 }
      continue
    }
    if (g.time - s.since < 4) continue
    if (guards < 2) { // no sortie without an escort: wait for the gunships to be built / to arrive (it never goes out alone)
      if (s.dockSince === undefined || s.dockSince <= 0) s.dockSince = g.time
      aiNote(g, k, 'escort', 'wait', `Zumwalt waiting for escorts: ${guns.length} gunship(s), needs 2${guns.length < 2 ? ' — ' + (navalBudget(g, k).canGunship ? 'building more' : 'naval point budget is full') : ''}`)
      if (guns.length < 2 && !cantEscort && home.length && !z.docked && z.route.length === 0 && home.every(t => tiles(t, z) > 26)) orderSail(g, z, [s.home.x, s.home.y]) // out in open water with no gunships at all: back to its berth
      continue
    }
    const dT = tiles(z, target!)
    if (dT >= 11 && dT <= 24 && !hostileShoreNear(g, z.faction, z.x, z.y, 11) && !towerShadow(g, z.faction, z.x, z.y)) continue // already on station: it stays (re-picking the nearest free spot every few seconds made it shuffle about)
    const st = stationNear(g, z, target!, zums)
    if (!st || tiles(st, z) < 1.5 && !z.docked) continue
    s.dockSince = -1
    aiNote(g, k, 'escort', 'ok', 'Zumwalts sailing with cover')
    if (orderSail(g, z, [st.x, st.y])) s.since = g.time
  }

  // ---- 3. gunships: flank escorts first (2-3 per Zumwalt), then cargo escorts, hunting and patrol ----
  const escortCount = new Map<number, number>()
  const sorted = guns.slice().sort((a, b) => a.id - b.id)
  // ---- 3a. waves against enemy Zumwalts: the gunships beyond the Zumwalts' escorts (3 each) gather, and go in together (never one boat alone) ----
  const waveIds = new Set<number>()
  {
    const spare = zums.length ? sorted.slice(zums.length * 3) : sorted
    let wave = g.navalWave.get(k)
    if (wave && (!g.boatById(wave.target) || g.time - wave.since > 150)) { g.navalWave.delete(k); wave = undefined }
    if (!wave && spare.length >= 3) {
      const prey = g.boats.filter(e => e.hp > 0 && e.kind === 'zumwalt' && g.hostile(k, e.faction) && (home.some(t => tiles(t, e) < 50) || spare.some(gb => tiles(gb, e) < 40))).sort((p, q) => tiles(p, spare[0]) - tiles(q, spare[0]))[0]
      if (prey) { wave = { target: prey.id, since: g.time, launched: false, ids: spare.slice(0, 6).map(gb => gb.id) }; g.navalWave.set(k, wave) }
    }
    if (wave) {
      const members = wave.ids.map(id => g.boatById(id)).filter((b): b is Boat => !!b && b.hp > 0), prey = g.boatById(wave.target)!
      if (members.length < 2 || (wave.launched && members.length < 2)) g.navalWave.delete(k)
      else {
        for (const m of members) waveIds.add(m.id)
        const cx = members.reduce((n, m) => n + m.x, 0) / members.length, cy = members.reduce((n, m) => n + m.y, 0) / members.length
        const spread = members.reduce((n, m) => Math.max(n, tiles(m, { x: cx, y: cy })), 0)
        if (!wave.launched && (spread < 10 || g.time - wave.since > 25)) wave.launched = true
        if (wave.launched) { for (const m of members) if (!m.strike || m.strike.kind !== 'boat' || m.strike.id !== prey.id) setStrikeOn(m, 'boat', prey.id, prey.x, prey.y) }
        else for (const m of members) { m.strike = null; if (tiles(m, { x: cx, y: cy }) > 5 && g.tickCount % 50 === m.id % 50 && isWaterCell(g, Math.floor(cx / TILE), Math.floor(cy / TILE))) orderSail(g, m, [cx, cy]) } // (gathering: nobody goes in alone)
      }
    }
  }
  for (const b of sorted) {
    let s = M.get(b.id)
    if (!s) { s = { phase: 'station', since: g.time, home: { x: b.x, y: b.y }, town: -1, avoid: [] }; M.set(b.id, s) }
    b.volleyCd -= 0 // (volleyCd doubles as this ship's formation timer)
    if (waveIds.has(b.id)) continue // (in a wave against an enemy Zumwalt)
    const hasStrike = !!b.strike && (b.strike.kind === 'boat' ? !!g.boatById(b.strike.id) : true)
    if (hasStrike && b.strike!.kind === 'boat') continue // in the fight
    if (!hasStrike) b.strike = null
    if (g.time - s.since < 2) continue
    const kept = s.escortOf !== undefined ? zums.find(q => q.id === s.escortOf && (escortCount.get(q.id) ?? 0) < 3) : undefined // (an escort stays with its Zumwalt: no swapping about between the two)
    const z = kept ?? zums.slice().sort((p, q) => (escortCount.get(p.id) ?? 0) - (escortCount.get(q.id) ?? 0) || tiles(p, b) - tiles(q, b))[0]
    if (z) s.escortOf = z.id
    if (z && (escortCount.get(z.id) ?? 0) < 3) {
      const idx = escortCount.get(z.id) ?? 0
      escortCount.set(z.id, idx + 1)
      const slot = flankSlot(z, idx, headingOf(z, squadronGoal))
      if (tiles(slot, b) > 1.4 && isWaterCell(g, Math.floor(slot.x / TILE), Math.floor(slot.y / TILE)) && orderSail(g, b, [slot.x, slot.y])) s.since = g.time
      continue
    }
    // a spare gunship: escort a cargo boat that is under way, else hunt hostile cargo, else patrol off the target
    const convoy = g.boats.filter(c => c.faction === k && c.kind === 'cargo' && !c.docked && (c.route.length > 0 || c.docking)).sort((p, q) => (q.load.gold > 0 ? 1 : 0) - (p.load.gold > 0 ? 1 : 0) || tiles(p, b) - tiles(q, b))[0]
    let goal: { x: number; y: number } | null = null, close = 4
    if (convoy && tiles(convoy, b) < 60) goal = { x: convoy.x, y: convoy.y }
    else {
      const prey = g.boats.filter(c => c.hp > 0 && c.kind === 'cargo' && g.hostile(k, c.faction) && tiles(c, b) < 40).sort((p, q) => tiles(p, b) - tiles(q, b))[0]
      if (prey) { goal = { x: prey.x, y: prey.y }; setStrikeOn(b, 'boat', prey.id, prey.x, prey.y) }
      else if (squadronGoal) { const ang = b.id * 2.4; goal = { x: squadronGoal.x + Math.cos(ang) * 10 * TILE, y: squadronGoal.y + Math.sin(ang) * 10 * TILE }; close = 3 }
    }
    if (goal) { if (tiles(goal, b) > close && isWaterCell(g, Math.floor(goal.x / TILE), Math.floor(goal.y / TILE)) && orderSail(g, b, [goal.x, goal.y])) s.since = g.time }
    else if (!b.docked && b.route.length === 0 && !b.docking && orderSail(g, b, [s.home.x, s.home.y])) s.since = g.time
  }
  for (const id of [...M.keys()]) if (!g.boatById(id)) M.delete(id)
  void ZUMWALT
}
