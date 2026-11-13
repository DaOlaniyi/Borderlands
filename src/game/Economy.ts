import { CARGO, MEAT, POP, SETTLE, TERRITORY, TILE, TOWN_LEVEL, type Stock } from './config'
import type { Game } from './Game'
import { emptyStock } from './BoatSystem'
import { landmassAt } from './WorldInfo'
import { logEvent, spend } from './Stats'
import type { GoldDeposit, Sheep, Town } from './types'

export type Res = keyof Stock
export const RESOURCES: Res[] = ['lumber', 'gold', 'meat']

// ---------------------------------------------------------------- town / settlement stats
export const isSettlement = (t: Town) => t.kind === 'settlement'
export const townRadius = (t: Town) => t.kind === 'settlement' ? SETTLE.radius[t.level - 1] : (t.kind === 'barracks' ? TERRITORY.barracksRadius : TERRITORY.townRadius) + (t.level >= 2 ? TOWN_LEVEL.radiusBonus : 0)
export const townWeight = (t: Town) => t.kind === 'settlement' ? SETTLE.weight[t.level - 1] : (t.kind === 'barracks' ? TERRITORY.barracksWeight : TERRITORY.townWeight) * (t.level >= 2 ? TOWN_LEVEL.weightBonus : 1) // (an upgraded town pulls harder on the border)
export const townCap = (t: Town) => t.kind === 'settlement' ? SETTLE.cap[t.level - 1] : (t.kind === 'barracks' ? POP.perBarracks : POP.perTown) + (t.level >= 2 ? TOWN_LEVEL.cap[1] - TOWN_LEVEL.cap[0] : 0)
export const townPawns = (t: Town) => t.kind === 'settlement' ? SETTLE.pawns[t.level - 1] : 0

// ---------------------------------------------------------------- regions (one stockpile per landmass a kingdom holds)
/**
 * Every landmass a kingdom holds is its own region with its own stockpile, so boats must carry anything between islands. The kingdom
 * object itself is the stockpile of its home landmass; other landmasses with towns get a lazily created pool; a landmass where it has only
 * settlements uses the nearest settlement's own store.
 */
export function regionTownAt(g: Game, faction: number, x: number, y: number): Town | null {
  const land = landmassAt(g.world, x, y)
  if (land < 0) return null
  let best: Town | null = null, bd = Infinity
  for (const t of g.towns) {
    if (t.ruined || t.owner !== faction || t.land !== land) continue
    if (!isSettlement(t)) return null // a real town on this landmass: the land's town pool
    const d = Math.hypot(t.x - x, t.y - y)
    if (d < bd) { bd = d; best = t }
  }
  return best
}
/** The stockpile of a kingdom's towns on one landmass (the kingdom itself for its home landmass). */
export function landStock(g: Game, faction: number, land: number): Stock {
  const k = g.kingdoms[faction]
  if (land < 0 || land === k.homeLand) return k
  const key = faction * 4096 + land
  let s = g.regionStocks.get(key)
  if (!s) { s = emptyStock(); g.regionStocks.set(key, s) }
  return s
}
export const stockAt = (g: Game, faction: number, x: number, y: number): Stock => regionTownAt(g, faction, x, y)?.store ?? landStock(g, faction, landmassAt(g.world, x, y))
export const stockOfTown = (g: Game, t: Town): Stock => t.store ?? landStock(g, t.owner, t.land)
/** Largest meat stock a region may keep: 5 per town on that landmass (20 for a settlement's own larder). */
export function meatCap(g: Game, t: Town): number {
  if (t.store) return MEAT.store
  return MEAT.perTown * Math.max(1, g.towns.filter(q => !q.ruined && q.owner === t.owner && q.land === t.land && !isSettlement(q)).length)
}
/** The stockpile the HUD shows: the region (landmass) the player last clicked, otherwise home. */
export function viewStock(g: Game): { stock: Stock; settlement: Town | null; land: number } {
  const land = g.regionView
  const mineOn = land >= 0 ? g.towns.filter(t => !t.ruined && t.owner === 0 && t.land === land) : []
  if (mineOn.length) {
    const real = mineOn.find(t => !isSettlement(t))
    if (real) return { stock: landStock(g, 0, land), settlement: null, land }
    const st = mineOn.find(t => t.store)!
    return { stock: st.store!, settlement: st, land }
  }
  return { stock: g.kingdoms[0], settlement: null, land: g.kingdoms[0].homeLand }
}
export function focusRegion(g: Game, x: number, y: number) {
  const land = landmassAt(g.world, x, y)
  if (land >= 0 && g.towns.some(t => !t.ruined && t.owner === 0 && t.land === land)) g.regionView = land
}

/** Resources a pawn or boat adds to a town's stockpile (lumber also counts toward the town's own stock, which goes with it when captured). */
export function deposit(g: Game, t: Town, kind: Res, amount: number) {
  const s = stockOfTown(g, t)
  if (kind === 'meat') s.meat = Math.min(meatCap(g, t), s.meat + amount)
  else s[kind] += amount
  if (kind === 'lumber' && !t.store) t.stock += amount
}

// ---------------------------------------------------------------- sheep and meat
export function spawnSheep(g: Game, t: Town, ripe = false): Sheep {
  const a = g.rngE.next() * Math.PI * 2, d = 90 + g.rngE.next() * 90
  let x = t.x + Math.cos(a) * d, y = t.y + 30 + Math.sin(a) * d * 0.6
  if (!g.isLandAt(x, y)) { x = t.x + 70; y = t.y + 70 }
  const s: Sheep = { id: g.allocId(), town: t.id, x, y, hx: x, hy: y, ripe, hits: 0, claimedBy: -1, phase: g.rngE.next() * 4, moveT: g.rngE.next() * 5, tx: x, ty: y, facing: 1 }
  g.sheep.push(s)
  return s
}

/** A pawn finishes a sheep: it dies, the pawn carries MEAT.yield home, and the town's next sheep grows over MEAT.period. */
export function slaughter(g: Game, s: Sheep) {
  const t = g.towns[s.town]
  g.sheep = g.sheep.filter(q => q !== s)
  if (t) t.meatT = MEAT.period
}

function updateSheep(g: Game, dt: number) {
  for (const t of g.towns) {
    if (t.ruined || isSettlement(t)) continue
    const have = g.sheep.some(s => s.town === t.id)
    if (!have) { t.meatT -= dt; if (t.meatT <= MEAT.period - 10) spawnSheep(g, t, false) } // a lamb shows up a few seconds later
    else if (t.meatT > 0) t.meatT -= dt
    if (t.meatT <= 0) for (const s of g.sheep) if (s.town === t.id) s.ripe = true
  }
  for (const s of g.sheep) { // grazing: short wanders around the home spot (purely visual)
    s.moveT -= dt
    if (s.claimedBy >= 0) continue
    if (s.moveT <= 0) {
      const a = g.rngE.next() * Math.PI * 2, d = g.rngE.next() * 60
      const x = s.hx + Math.cos(a) * d, y = s.hy + Math.sin(a) * d * 0.6
      if (g.isLandAt(x, y)) { s.tx = x; s.ty = y }
      s.moveT = 3 + g.rngE.next() * 6
    }
    const dx = s.tx - s.x, dy = s.ty - s.y, dd = Math.hypot(dx, dy)
    if (dd > 2) { const sp = Math.min(dd, 14 * dt); s.x += dx / dd * sp; s.y += dy / dd * sp; s.facing = dx < 0 ? -1 : 1 }
  }
}

// ---------------------------------------------------------------- settlements
/**
 * Why a settlement cannot be planted here (null = fine). It can go ANYWHERE on a landmass the kingdom has landed on, as long as the ground
 * is unowned (or already ours), it is clear of gold stones and other towns, and the kingdom has a troop ashore, a cargo boat moored
 * against that island and the lumber. The first kingdom to arrive gets the best spot; later ones take what is left.
 */
export function settlementError(g: Game, faction: number, x: number, y: number): string | null {
  const i = g.cellAt(x, y)
  if (i < 0 || !g.world.land[i]) return 'Settlements must be built on land'
  const land = landmassAt(g.world, x, y)
  if (g.towns.some(t => !t.ruined && t.owner === faction && t.land === land && !isSettlement(t))) return 'Settlements go on landmasses where you have no town yet'
  const owner = g.controller[i]
  if (owner && owner !== faction + 1) return 'That ground belongs to someone else'
  if (g.goldDeps.some(d => !d.taken && Math.hypot(d.x - x, d.y - y) < 1.5 * TILE)) return 'Not on top of a gold deposit'
  if (g.towns.some(t => !t.ruined && Math.hypot(t.x - x, t.y - y) < SETTLE.minTownGapTiles * TILE)) return 'Too close to another town or settlement'
  if (!g.units.some(u => u.faction === faction && u.state !== 'dead' && u.inTower < 0 && landmassAt(g.world, u.x, u.y) === land)) return 'Land at least one troop on this island first'
  if (!g.boats.some(b => b.faction === faction && b.kind === 'cargo' && b.docked && b.dockCell >= 0 && g.info.landmass[b.dockCell] === land)) return 'A cargo boat must be moored against this island'
  if (g.kingdoms[faction].lumber < SETTLE.cost) return `Needs ${SETTLE.cost} lumber`
  return null
}

/** Is this tile on the outer edge of its island (water within two tiles)? AI settlers avoid those. */
export function isOuterTile(g: Game, cx: number, cy: number): boolean {
  const { w, h } = g.world
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= w || y >= h || !g.world.land[y * w + x]) return true }
  return false
}

/** Is there water within `r` tiles? (A settlement's territory must reach the coast for its cargo port to work.) */
export function waterWithin(g: Game, cx: number, cy: number, r: number): boolean {
  const { w, h } = g.world
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < w && y < h && !g.world.land[y * w + x] && dx * dx + dy * dy <= r * r) return true }
  return false
}

/**
 * Where an AI plants its settlement: well inland (never on the outer tiles), never on a gold stone, on neutral ground, as close as it can
 * get to the island's richest gold (gold within the settlement's reach counts, nearer counts more).
 */
export function bestSettlementSite(g: Game, faction: number, land: number, from: { x: number; y: number }): { x: number; y: number } | null {
  const { w, h } = g.world
  const deps = g.goldDeps.filter(d => !d.taken && g.info.landmass[d.cell] === land)
  let best: { x: number; y: number } | null = null, bs = -Infinity
  for (let cy = 2; cy < h - 2; cy++) for (let cx = 2; cx < w - 2; cx++) {
    const i = cy * w + cx
    if (g.info.landmass[i] !== land || isOuterTile(g, cx, cy) || !waterWithin(g, cx, cy, SETTLE.radius[0] - 1)) continue // inland, but with the coast inside its territory (a cargo port needs it)
    const x = (cx + 0.5) * TILE, y = (cy + 0.5) * TILE
    if (settlementErrorSite(g, faction, x, y) !== null) continue
    let score = -Math.hypot(x - from.x, y - from.y) / TILE * 0.05 // a mild pull toward where we landed
    for (const d of deps) { const dist = Math.hypot(d.x - x, d.y - y) / TILE; if (dist < 9) score += d.amount / (1 + dist) }
    if (score > bs) { bs = score; best = { x, y } }
  }
  return best
}
/** The site-only part of the placement rules (no troop / boat / lumber checks), for choosing a spot before everything has arrived. */
function settlementErrorSite(g: Game, faction: number, x: number, y: number): string | null {
  const i = g.cellAt(x, y)
  if (i < 0 || !g.world.land[i]) return 'land'
  const owner = g.controller[i]
  if (owner && owner !== faction + 1) return 'owned'
  if (g.goldDeps.some(d => !d.taken && Math.hypot(d.x - x, d.y - y) < 1.5 * TILE)) return 'gold'
  if (g.towns.some(t => !t.ruined && Math.hypot(t.x - x, t.y - y) < SETTLE.minTownGapTiles * TILE)) return 'gap'
  return null
}

export function placeSettlement(g: Game, faction: number, x: number, y: number): Town | null {
  if (settlementError(g, faction, x, y)) return null
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE)
  const boat = g.boats.filter(b => b.faction === faction && b.kind === 'cargo' && b.docked).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]
  g.spendLumber(faction, SETTLE.cost)
  spend(g, faction, 'settlement', SETTLE.cost); g.stats.k[faction].settlementsFounded++; logEvent(g, 'town', `${g.label(faction)} founded a settlement`, faction)
  const store: Stock = emptyStock()
  store.meat = MEAT.startStock
  if (boat) { for (const k of RESOURCES) { store[k] += boat.load[k]; boat.load[k] = 0; boat.want[k] = 0 } store.meat = Math.min(MEAT.store, store.meat) } // the cargo boat empties its hold into the new settlement
  for (const c of [...g.crates]) { // cargo left behind by a destroyed settlement nearby becomes the new settlement's
    if (Math.hypot(c.x - x, c.y - y) > 7 * TILE) continue
    for (const k of RESOURCES) store[k] += c.load[k]
    store.meat = Math.min(MEAT.store, store.meat)
    g.crates = g.crates.filter(q => q !== c)
  }
  const hp = SETTLE.hp // (level 1)
  const t: Town = { id: g.towns.length, cx, cy, x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE, owner: faction, kind: 'settlement', level: 1, store, meatT: 0, upkeepT: 0, land: landmassAt(g.world, x, y), crate: null, abandoned: false, hitAt: -99, pawnIds: [], flash: 1, hp, maxHp: hp, stock: 0, produce: true, raze: false, ruined: false }
  g.towns.push(t)
  for (let n = 0; n < townPawns(t); n++) g.spawnPawn(t)
  g.revealLand(t.land) // the whole island is known from now on
  // the garrison walks to the new settlement (it collapses without a troop beside it)
  for (const u of g.units.filter(q => q.faction === faction && q.state !== 'dead' && q.inTower < 0 && landmassAt(g.world, q.x, q.y) === t.land).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y)).slice(0, 3)) g.orderMoveTo(u, t.x + (g.rngE.next() - 0.5) * 90, t.y + 50)
  g.say(`${g.label(faction)} planted a settlement`)
  g.sounds.push({ name: 'build', x: t.x, y: t.y })
  g.markDirty(); g.recomputeTerritory()
  return t
}

/** Settlement level 2: 200 lumber, level 3: 450 lumber and 5 gold, all out of its own store. Town level 2: 5 gold from the town pool. Returns an error string or null. */
export function upgradeError(g: Game, faction: number, id: number): string | null {
  const t = g.towns[id]
  if (!t || t.ruined || t.owner !== faction) return 'Not yours'
  if (t.level >= (isSettlement(t) ? SETTLE.maxLevel : TOWN_LEVEL.maxLevel)) return 'Already at the highest level'
  if (isSettlement(t)) {
    const lum = SETTLE.upgradeCost[t.level - 1], gold = SETTLE.upgradeGold[t.level - 1]
    if (t.store!.lumber < lum) return `Needs ${lum} lumber in the settlement's store (ship it by cargo boat)`
    if (t.store!.gold < gold) return `Needs ${gold} gold in the settlement's store`
    return null
  }
  return stockOfTown(g, t).gold >= TOWN_LEVEL.upgradeGold ? null : `Needs ${TOWN_LEVEL.upgradeGold} gold`
}
export function upgradeLabel(t: Town): string {
  if (isSettlement(t)) { const l = SETTLE.upgradeCost[t.level - 1], gd = SETTLE.upgradeGold[t.level - 1]; return `Upgrade to level ${t.level + 1} (${l} lumber${gd ? ` + ${gd} gold` : ''})` }
  return `Upgrade (${TOWN_LEVEL.upgradeGold} gold)`
}
export function upgradeTown(g: Game, faction: number, id: number): boolean {
  if (upgradeError(g, faction, id)) return false
  const t = g.towns[id]
  if (isSettlement(t)) { spend(g, faction, 'upgrade', SETTLE.upgradeCost[t.level - 1]); g.stats.k[faction].spentGold += SETTLE.upgradeGold[t.level - 1]; t.store!.lumber -= SETTLE.upgradeCost[t.level - 1]; t.store!.gold -= SETTLE.upgradeGold[t.level - 1] }
  else { g.stats.k[faction].spentGold += TOWN_LEVEL.upgradeGold; stockOfTown(g, t).gold -= TOWN_LEVEL.upgradeGold }
  t.level = (t.level + 1) as Town['level']
  if (isSettlement(t)) { t.maxHp = SETTLE.hp * t.level; t.hp = Math.min(t.maxHp, t.hp + SETTLE.hp) }
  else { t.maxHp = Math.round(t.maxHp * TOWN_LEVEL.hpBonus); t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.3) }
  if (isSettlement(t)) { t.crate = { x: t.x + SETTLE.crateOffset[Math.min(2, t.level - 1)], y: t.y + 36 }; while (t.pawnIds.length < townPawns(t)) g.spawnPawn(t) }
  g.say(`${g.label(faction)}: ${isSettlement(t) ? 'settlement' : 'town'} upgraded to level ${t.level}`)
  g.sounds.push({ name: 'build', x: t.x, y: t.y })
  g.markDirty(); g.recomputeTerritory()
  return true
}
/** Level 3 buildings (none exist yet) require every town the kingdom owns to be level 2. */
export const allTownsLevel2 = (g: Game, faction: number) => g.towns.filter(t => !t.ruined && t.owner === faction && !isSettlement(t)).every(t => t.level >= 2)

/** A settlement eats MEAT.eat meat per MEAT.eatPeriod and needs a friendly troop within SETTLE.troopTiles. Without either it decays and dissolves after 2 minutes. */
function updateSettlements(g: Game, dt: number) {
  for (const t of [...g.towns]) {
    if (t.ruined || !isSettlement(t) || t.owner < 0) continue
    const s = t.store!
    s.meat = Math.max(0, s.meat - MEAT.eat / MEAT.eatPeriod * dt)
    const troops = g.units.some(u => u.faction === t.owner && u.state !== 'dead' && u.inTower < 0 && Math.hypot(u.x - t.x, u.y - t.y) <= SETTLE.troopTiles * TILE)
    const fed = s.meat > 0.001
    if (troops && fed) t.meatT = Math.max(0, t.meatT - dt * 2)
    else {
      t.meatT += dt
      if (t.meatT >= SETTLE.decaySeconds) dissolveSettlement(g, t, fed ? 'abandoned: no troops' : 'starved: no meat')
    }
  }
}

export function dissolveSettlement(g: Game, t: Town, why: string) {
  if (t.ruined) return
  g.say(`${t.owner === 0 ? 'Your' : g.label(t.owner) + "'s"} settlement collapsed (${why})`)
  if (t.owner > 0 && !g.kingdoms[t.owner].isPlayer) g.lostColonies.push({ owner: t.owner, land: t.land, x: t.x, y: t.y, at: g.time }) // the AI will re-establish it
  g.removeTown(t)
}

// ---------------------------------------------------------------- floating cargo, per-tick entry
function updateFloaters(g: Game, dt: number) {
  for (const f of g.floaters) f.t += dt
  if (g.floaters.length && g.floaters.some(f => f.t > CARGO.floatSeconds)) g.floaters = g.floaters.filter(f => f.t <= CARGO.floatSeconds)
}

export function updateEconomy(g: Game, dt: number) {
  updateSheep(g, dt)
  updateSettlements(g, dt)
  repairSettlements(g, dt)
  updateFloaters(g, dt)
}

// ---------------------------------------------------------------- gold
/** Gold paid by a deposit: stones 1 and 2 give 1 (2 one time in four); bigger stones pay their full amount. */
export function goldYield(g: Game, d: GoldDeposit): number {
  void g; void d
  return 1 // every piece is 1 gold
}

// ---------------------------------------------------------------- abandoning, claiming, repairing, razing
/** The player gives a settlement up: nobody owns it any more, and the first unit of any kingdom to walk up to it claims it (stock and all). */
export function abandonSettlement(g: Game, faction: number, id: number): boolean {
  const t = g.towns[id]
  if (!t || t.ruined || t.owner !== faction || !isSettlement(t)) return false
  for (const pid of t.pawnIds) g.removePawn(pid)
  t.pawnIds = []
  t.owner = -1; t.abandoned = true; t.raze = false; t.flash = 0.8
  if (g.regionView === t.land) g.regionView = -1
  g.say('You abandoned a settlement')
  g.markDirty(); g.recomputeTerritory()
  return true
}
/** A unit walks up to an abandoned settlement: it joins that kingdom with its level and stockpile, and the pawns return. */
export function claimSettlement(g: Game, t: Town, faction: number) {
  if (!t.abandoned) return
  t.owner = faction; t.abandoned = false; t.flash = 1.2; t.hp = Math.max(t.hp, t.maxHp * 0.5)
  while (t.pawnIds.length < townPawns(t)) g.spawnPawn(t)
  g.say(`${g.label(faction)} claimed an abandoned settlement`)
  g.markDirty(); g.recomputeTerritory()
}
/** What a destroyed level 2+ settlement leaves behind: its crates, with their contents, for whoever founds a settlement beside them. */
export function leaveCrates(g: Game, t: Town) {
  if (!t.store || t.level < 2) return
  const load = { ...t.store }
  if (load.lumber + load.gold + load.meat < 0.5) return
  g.crates.push({ id: g.allocId(), x: t.x + SETTLE.crateOffset[1], y: t.y + 36, load })
}
/** Pawns of the settlement's region run to mend it while ships shell it: up to 5 pawns, 40 hp/s each. */
function repairSettlements(g: Game, dt: number) {
  for (const t of g.towns) {
    if (t.ruined || !isSettlement(t) || t.owner < 0 || g.time - t.hitAt > SETTLE.repairWindow || t.hp >= t.maxHp) continue
    let workers = 0
    for (const p of g.pawns) if (p.faction === t.owner && p.state === 'repair' && Math.hypot(p.x - t.x, p.y - t.y) < 4 * TILE && workers < SETTLE.repairPawns) workers++
    t.hp = Math.min(t.maxHp, t.hp + workers * SETTLE.repairPerPawn * dt)
  }
}
