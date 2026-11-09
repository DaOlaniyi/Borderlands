import { AGIT, AI, BOAT, BOAT_FLAG, CARE, DOCK, LOT, MAX_FRAME_DT, RESCUE, ZUMWALT, ZUM_FOCUS, type BoatKind, type ZumFocus, POP, REL, SHOT_REACT, SIM_DT, START, TERRITORY, TILE, TOWER, TOWN, UNIT, UNIT_BODY, UNIT_TYPES, type HarvestMode, type UnitType } from './config'
import { agitationTick, formAlliance, playerAllianceRequest, townFell, updateAgitation } from './AgitationSystem'
import { updateAI } from './AISystem'
import { cargoCount, mooringNear, orderSail, spawnBoat, unload, updateBoats, type Shell } from './BoatSystem'
import { updateCombat } from './CombatSystem'
import { Diplomacy } from './Diplomacy'
import { cellCenter, isLandAt, worldToCell } from './Grid'
import { moveUnits, movePawns } from './MovementSystem'
import { KINGDOM_NAMES, kingdomTier, pickUnitName } from './names'
import { orderPawnToTree, releaseTree, releaseSite, switchPawnAllegiance, updatePawns } from './PawnSystem'
import { makeRng, type Rng } from './rng'
import { buildRoute, pathBetween, type Walkable } from './Routes'
import { SpatialHash } from './SpatialHash'
import { computeController, computeSupply, influenceAt, stack, type Source } from './TerritorySystem'
import { generateArchipelago, generateWorld } from './WorldGenerator'
import { assignColors } from './Palette'
import { assignEmblems } from './Emblems'
import { landmassAt, worldInfo, type WorldInfo } from './WorldInfo'
import type { Boat, Kingdom, Pawn, Relation, Selection, Tower, Town, TownSpawn, Unit, World } from './types'

export type GameOptions = {
  world: World
  spawns: TownSpawn[]
  /** Override starting units (tests). Cells are logical tile coordinates. */
  units?: { faction: number; cx: number; cy: number; type?: UnitType }[]
  noPawns?: boolean
  rngSeed?: number
  /** Skip random AI↔AI relations (tests). */
  plainRelations?: boolean
  /** Palette colour index of each kingdom (default: the player is Blue, the AI take the rest in palette order). */
  colors?: number[]
  /** The player's starting lumber (default POP.startLumber); handy for testing buildings. */
  startLumber?: number
}

export type HudUnit = { id: number; name: string; type: UnitType; hp: number; maxHp: number; count: number; members: string[]; mode: string; state: string; cutOff: boolean; overcap: boolean; inTower: boolean; healing: boolean }
export type HudSnapshot = {
  seed: number
  status: 'playing' | 'defeat'
  lumber: number
  power: number
  towns: number
  pop: number
  cap: number
  kingdomName: string
  title: string
  level: number
  produce: Record<UnitType, boolean>
  kingdoms: { id: number; name: string; title: string; level: number; color: number; emblem: number; towns: number; tiles: number; units: number; lumber: number; power: number; agitation: number | null; ready: boolean; allies: number[]; allyBlocked: string | null; merged: boolean; focused: boolean; alive: boolean; isPlayer: boolean; relation: Relation }[]
  units: HudUnit[]
  join: { enabled: boolean; label: string; reason: string | null } | null
  hasSquad: boolean
  allBlocking: boolean
  pawn: { state: string; carry: number; progress: number } | null
  town: { id: number; mine: boolean; hostile: boolean; owner: string; hp: number; maxHp: number; produce: boolean; raze: boolean; kind: string } | null
  structure: { id: number; kind: string; built: boolean; progress: number; refund: number } | null
  placing: false | StructureKind
  boat: { id: number; kind: BoatKind; hp: number; maxHp: number; cargo: number; cap: number; docked: boolean; docking: number; blocked: boolean; focus: ZumFocus; count: number; zumwalts: number; names: string[] } | null
  events: string[]
  spills: string[]
  warnings: { name: string; secs: number; immediate: boolean }[]
  harvest: HarvestMode
  canBlock: boolean
  canRange: boolean
  showRange: boolean
  conflicts: ConflictTab[]
  time: number
  speed: number
}

export type ConflictTab =
  | { kind: 'player'; id: number; name: string; relation: 'conflict' | 'war' | 'total'; losses: number; kills: number }
  | { kind: 'ai'; a: number; b: number; aName: string; bName: string; relation: 'conflict' | 'war' | 'total'; aLost: number; bLost: number }

export type StructureKind = 'tower' | 'lot' | BoatKind
export type Projectile = { x0: number; y0: number; x1: number; y1: number; t: number; dur: number }
/** Short-lived visual effects and sounds (renderer/audio read them; the sim never depends on them). */
export type Fx = { kind: 'capture' | 'hit' | 'boom' | 'splash'; x: number; y: number; t: number }

export class Game {
  world: World
  kingdoms: Kingdom[] = []
  diplomacy: Diplomacy
  towns: Town[] = []
  units: Unit[] = []
  pawns: Pawn[] = []
  towers: Tower[] = []
  projectiles: Projectile[] = []
  fx: Fx[] = []
  boats: Boat[] = []
  shells: Shell[] = []
  /** Screen shake strength (0..), decays every tick; the renderer applies it. */
  shake = 0
  /** One-shot sound requests drained by the audio layer. */
  sounds: { name: 'hit' | 'arrow' | 'capture' | 'boom' | 'cannon' | 'build'; x: number; y: number }[] = []
  /** Geography (landmass ids, ocean mask), derived from the world once. */
  info: WorldInfo
  controller: Uint8Array
  supplied: Uint8Array
  /** Connected cut-off pockets: label per tile (0 = not cut off), recomputed with territory. */
  pocket: Int32Array
  private prevController: Uint8Array
  territoryVersion = 0
  recomputeCount = 0
  territoryMs = 0
  /** Territory size per kingdom, refreshed only when territory is recomputed (one pass over the grid). */
  tileCounts: number[] = []
  simMs = 0
  time = 0
  tickCount = 0
  accumulator = 0
  speed = 1
  selection: Selection = null
  placing: false | StructureKind = false
  showRange = false
  aiEnabled = true
  status: 'playing' | 'defeat' = 'playing'
  rng: Rng
  unitHash: SpatialHash
  ux: number[] = []
  uy: number[] = []
  chopped: number[] = []
  deaths: { x: number; y: number; faction: number; type: UnitType; t: number }[] = []
  log: { t: number; text: string }[] = []
  aiTimers: number[] = []
  /** Agitation 0–100 per kingdom (AI only), where it is looking, whether the border is on alert, and reaction cooldowns. */
  agit: number[] = []
  agitFocus: ({ x: number; y: number } | null)[] = []
  ready: boolean[] = []
  nextReact: number[] = []
  /** Alliances formed against a nation (pair key → target kingdom); they dissolve when it is destroyed. */
  purposes = new Map<number, number>()
  spills: { t: number; text: string }[] = []
  /** Per-kingdom AI memory (last provocation / last tower attempt, in sim seconds). */
  aiMemo: { tower: number[]; lot: number[]; target: number[]; targetAt: number[]; dash: Map<number, number>; baseProduce: Kingdom['produce'][]; grievance: { x: number; y: number; t: number; foe: number; kind: 'land' | 'attack' }[][]; respond: Map<number, number>; lastStand: Map<number, number>; blockSince: Map<number, number>; noBlock: Map<number, number>; holdSince: Map<number, number>; ship: Map<number, { phase: 'load' | 'sail' | 'return' | 'station'; since: number; home: { x: number; y: number }; town: number; avoid: number[]; dockSince?: number }>; navyAt: number[]; noSpot: number[]; harvestSaved: Map<number, HarvestMode>; expandAt: number[] } = { tower: [], lot: [], target: [], targetAt: [], dash: new Map(), baseProduce: [], grievance: [], respond: new Map(), lastStand: new Map(), blockSince: new Map(), noBlock: new Map(), holdSince: new Map(), ship: new Map(), navyAt: [], noSpot: [], harvestSaved: new Map(), expandAt: [] }
  /** Border violations in progress, keyed by violator*8+victim. */
  private viol = new Map<number, { since: number; seen: number; immediate: boolean }>()
  private dirty = true
  private started = false
  private nextId = 1
  private seq = 0
  private unitMap = new Map<number, Unit>()
  private usedNames = new Set<string>()
  private diploClock = 0
  private lastDiploVersion = -1
  /** Kingdoms whose bloc shows its territory in the colour of the bloc's strongest member (the eye button). */
  mergeColors = new Set<number>()
  /** Nation highlighted in the kingdom list: the map draws its relations as arrows (red war, yellow conflict, green alliance). */
  focusKingdom: number | null = null

  constructor(opts: GameOptions) {
    this.world = opts.world
    const { w, h } = this.world
    this.info = worldInfo(this.world)
    this.rng = makeRng((opts.rngSeed ?? this.world.seed) ^ 0x9e3779b9)
    this.controller = new Uint8Array(w * h)
    this.supplied = new Uint8Array(w * h)
    this.pocket = new Int32Array(w * h)
    this.prevController = new Uint8Array(w * h)
    this.unitHash = new SpatialHash(w * TILE, h * TILE, 128)
    const count = Math.max(...opts.spawns.map(s => s.kingdom)) + 1
    const colors = opts.colors ?? assignColors(count, 0)
    const emblems = assignEmblems(count, () => this.rng.next())
    const names = [...KINGDOM_NAMES]
    for (let k = 0; k < count; k++) {
      const i = this.rng.int(0, names.length - 1)
      const name = names.splice(i, 1)[0]
      const ai = k !== 0
      this.kingdoms.push({
        id: k, color: colors[k], emblem: emblems[k], name, isPlayer: !ai, lumber: ai ? POP.startLumber : opts.startLumber ?? POP.startLumber, power: POP.startPower, alive: true,
        produce: ai ? { warrior: true, archer: true, lancer: true } : { warrior: false, archer: false, lancer: false },
        weights: ai ? { warrior: 4, lancer: 3, archer: 2 } : { warrior: 1, lancer: 1, archer: 1 }, // the AI favours warriors and lancers
        prodTimer: POP.spawnInterval * (0.5 + this.rng.next()), aggression: ai ? this.rng.next() : 0, harvest: 'med',
      })
    }
    this.diplomacy = new Diplomacy(count)
    if (!opts.plainRelations) { // a couple of AI pairs may start in conflict at most; alliances have to be earned during play
      let started = 0
      for (let a = 1; a < count; a++) for (let b = a + 1; b < count; b++) {
        if (started < AGIT.initialConflicts && this.rng.next() < AGIT.initialConflictChance) { this.diplomacy.set(a, b, 'conflict', 0); started++ }
      }
    }
    this.diplomacy.events.length = 0
    this.aiTimers = this.kingdoms.map(() => this.rng.next() * 1.4)
    this.agit = this.kingdoms.map(() => 0); this.agitFocus = this.kingdoms.map(() => null); this.ready = this.kingdoms.map(() => false); this.nextReact = this.kingdoms.map(() => 60)
    opts.spawns.forEach((s, i) => {
      const c = cellCenter(this.world, s.cy * w + s.cx)
      const hp = UNIT.warrior.hp * TOWER.hpMult * TOWN.hpMult
      this.towns.push({ id: i, cx: s.cx, cy: s.cy, x: c.x, y: c.y, owner: s.kingdom, kind: s.barracks ? 'barracks' : 'town', pawnIds: [], flash: 0, hp, maxHp: hp, stock: 0, produce: true, raze: false, ruined: false })
    })
    this.recomputeTerritory()
    if (!opts.noPawns) for (const t of this.towns) for (let n = 0; n < START.pawnsPerTown; n++) this.spawnPawn(t)
    if (opts.units) for (const u of opts.units) this.spawnUnit(u.faction, (u.cx + 0.5) * TILE, (u.cy + 0.5) * TILE, u.type ?? 'warrior')
    else this.spawnStartingUnits()
    this.recomputeTerritory()
    this.lastDiploVersion = this.diplomacy.version
    this.started = true
  }

  /** `archipelago` builds the real 200×200 world of islands (kingdomCount defaults to 10–15 from the seed); otherwise one island (tests, experiments). */
  static fromSeed(seed: string | number, kingdomCount: number, playerTowns?: number, opts: { archipelago?: boolean; playerColor?: number; startLumber?: number } = {}) {
    const { world, spawns } = opts.archipelago ? generateArchipelago(seed, kingdomCount || undefined, playerTowns) : generateWorld(seed, kingdomCount, playerTowns)
    const count = Math.max(...spawns.map(s => s.kingdom)) + 1
    return new Game({ world, spawns, colors: assignColors(count, opts.playerColor ?? 0), startLumber: opts.startLumber })
  }

  // ---------- helpers ----------
  allocId() { return this.nextId++ }
  nextSeq() { return ++this.seq }
  /** Units (squad members counted) aboard a ship. */
  unitCargo(b: Boat) { return cargoCount(this, b) }
  boatById(id: number) { return this.boats.find(b => b.id === id) ?? null }
  selectedBoats(): Boat[] { return this.selection?.kind === 'boats' ? this.selection.ids.map(i => this.boatById(i)).filter((b): b is Boat => !!b) : [] }
  isLandAt = (x: number, y: number) => isLandAt(this.world, x, y)
  cellAt = (x: number, y: number) => worldToCell(this.world, x, y)
  unitById = (id: number) => this.unitMap.get(id) ?? null
  hostile = (a: number, b: number) => this.diplomacy.hostile(a, b)
  label = (k: number) => this.kingdoms[k].name
  pawnById(id: number) { return this.pawns.find(p => p.id === id) ?? null }
  towerById(id: number) { return this.towers.find(t => t.id === id) ?? null }
  ownedTowns(k: number) { return this.towns.filter(t => t.owner === k).length }
  title(k: number) { return kingdomTier(this.ownedTowns(k)) }
  pop(k: number) { let n = 0; for (const u of this.units) if (u.faction === k && u.state !== 'dead' && u.inTower < 0 && !u.free) n += u.count; return n }
  /** Ships a kingdom owns (finished ones, docked or at sea). */
  shipsOf(k: number) { let n = 0; for (const b of this.boats) if (b.faction === k) n++; return n }
  cap(k: number) {
    if (!this.towns.some(t => t.owner === k)) return Math.min(RESCUE.max, RESCUE.perShip * this.shipsOf(k)) // a kingdom with no towns left may keep a few troops per ship (2 each, up to 5)
    let n = 0; for (const t of this.towns) if (t.owner === k) n += (t.kind === 'barracks' ? POP.perBarracks : POP.perTown) + (this.towers.some(s => s.kind === 'lot' && s.built && s.town === t.id) ? 1 : 0); return n }
  say(text: string) { this.log.push({ t: this.time, text }); if (this.log.length > 24) this.log.shift() }
  selectedUnits(): Unit[] { return this.selection?.kind === 'units' ? this.selection.ids.map(i => this.unitById(i)).filter((u): u is Unit => !!u && u.state !== 'dead') : [] }

  landWalkable(avoidForeign?: number): Walkable {
    const { w, h, land } = this.world
    if (avoidForeign === undefined) return { w, h, at: (x, y) => isLandAt(this.world, x, y), cell: i => land[i] === 1 }
    const ok = (i: number) => { if (land[i] !== 1) return false; const c = this.controller[i]; return c === 0 || c === avoidForeign + 1 || this.diplomacy.allied(avoidForeign, c - 1) }
    return { w, h, at: (x, y) => { const i = worldToCell(this.world, x, y); return i >= 0 && ok(i) }, cell: ok }
  }
  canPawnStand(p: Pawn, x: number, y: number) {
    const i = this.cellAt(x, y)
    if (i < 0 || !this.world.land[i]) return false
    return this.controller[i] === p.faction + 1 || (p.state === 'retreat' && this.controller[i] === 0)
  }

  // ---------- spawning ----------
  spawnUnit(faction: number, x: number, y: number, type: UnitType = 'warrior'): Unit {
    const st = UNIT[type], name = pickUnitName(() => this.rng.next(), this.usedNames)
    this.usedNames.add(name)
    const u: Unit = {
      id: this.nextId++, type, name, faction, count: 1, memberNames: [name], x, y, px: x, py: y, vx: 0, vy: 0, hp: st.hp, maxHp: st.hp, cell: this.cellAt(x, y),
      facing: 1, aimX: 1, aimY: 0, mode: 'fight', state: 'idle', route: [], routeIdx: 0, draft: [], attackT: 0, attackHit: false, attackVariant: 0, cooldownT: 0,
      target: -1, targetKind: 'unit', disengageT: 0, cutOff: false, overcap: false, animT: this.rng.next() * 3, lastOrderT: -99, goalX: -1, goalY: -1,
      stuck: 0, chkX: x, chkY: y, noGarrisonT: 0, free: false, growing: false, cutSince: 0, chase: -1, refocusT: 0, kbT: -1, kbSx: 0, kbSy: 0, kbEx: 0, kbEy: 0, hold: false, aiRole: '', phase: (this.nextId * 0.37) % 3, inTower: -1, seq: ++this.seq, boardBoat: -1, evadeBoat: -1, evadeT: 0,
    }
    this.units.push(u); this.unitMap.set(u.id, u)
    this.ux.push(x); this.uy.push(y)
    this.dirty = true
    return u
  }
  /** Backwards-compatible helper used widely in tests. */
  spawnWarrior(faction: number, x: number, y: number) { return this.spawnUnit(faction, x, y, 'warrior') }

  spawnPawn(t: Town) {
    const a = this.rng.next() * Math.PI * 2
    const x = t.x + Math.cos(a) * 56, y = t.y + 40 + Math.sin(a) * 22
    const p: Pawn = { id: this.nextId++, town: t.id, faction: t.owner, x, y, px: x, py: y, vx: 0, vy: 0, cell: this.cellAt(x, y), facing: 1, state: 'wander', route: [], routeIdx: 0, tree: -1, pendingTree: -1, carry: 0, planT: 0.3 + this.rng.next(), animT: this.rng.next() * 3, manual: false, destTown: -1, site: -1, stuck: 0, chkX: x, chkY: y }
    this.pawns.push(p); t.pawnIds.push(p.id)
    return p
  }

  /** Finds an open land point within `r` tiles of a town for newly produced units. */
  private openSpot(t: Town, tries = 24): { x: number; y: number } | null {
    for (let i = 0; i < tries; i++) {
      const a = this.rng.next() * Math.PI * 2, d = 90 + this.rng.next() * 70
      const x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d
      if (this.isLandAt(x, y) && !this.units.some(u => u.state !== 'dead' && Math.hypot(u.x - x, u.y - y) < 40)) return { x, y }
    }
    return null
  }

  private spawnStartingUnits() {
    for (const k of this.kingdoms) {
      const towns = this.towns.filter(t => t.owner === k.id)
      for (const t of towns) {
        const n = START.unitsPerTown // two per town; the third is produced
        for (let i = 0; i < n; i++) {
          const spot = this.openSpot(t)
          if (spot) this.spawnUnit(k.id, spot.x, spot.y, 'warrior') // identical opening army for every kingdom
        }
      }
    }
  }

  // ---------- territory ----------
  markDirty() { this.dirty = true }
  get isDirty() { return this.dirty }

  recomputeTerritory() {
    const t0 = performance.now()
    const { w } = this.world
    this.prevController.set(this.controller)
    const sources: Source[] = []
    for (const t of this.towns) if (!t.ruined) sources.push({ faction: t.owner, cx: t.cx, cy: t.cy, kind: 'town', radius: t.kind === 'barracks' ? TERRITORY.barracksRadius : TERRITORY.townRadius, weight: t.kind === 'barracks' ? TERRITORY.barracksWeight : TERRITORY.townWeight })
    for (const b of this.boats) if (b.docked && b.dockCell >= 0) sources.push({ faction: b.faction, cx: b.dockCell % w, cy: (b.dockCell / w) | 0, kind: 'town', radius: DOCK.radius, weight: DOCK.weight }) // a docked ship is a mini town
    for (const u of this.units) if (u.state !== 'dead' && u.inTower < 0) sources.push({ faction: u.faction, cx: u.cell % w, cy: (u.cell / w) | 0, kind: 'unit', count: u.count })
    const townCells = this.towns.filter(t => !t.ruined).map(t => ({ cell: t.cy * w + t.cx, faction: t.owner }))
    for (const b of this.boats) if (b.docked && b.dockCell >= 0) townCells.push({ cell: b.dockCell, faction: b.faction })
    computeController(this.world, sources, this.controller, townCells, (a, b) => this.diplomacy.allied(a, b))
    computeSupply(this.controller, w, this.world.h, townCells, this.supplied, this.kingdoms.map(k => Math.min(...this.diplomacy.bloc(k.id)))) // allied land is a supply bridge
    this.tileCounts = new Array(this.kingdoms.length).fill(0)
    for (let i = 0; i < this.controller.length; i++) { const c = this.controller[i]; if (c) this.tileCounts[c - 1]++ }
    this.labelPockets()
    this.dirty = false
    this.lastDiploVersion = this.diplomacy.version
    this.territoryVersion++
    this.recomputeCount++
    this.territoryMs = performance.now() - t0
    if (this.started) this.detectSeizures()
  }

  /** Label every 4-connected region of one faction's unsupplied (cut-off) tiles; units in the same pocket share the attrition penalty. */
  private labelPockets() {
    const { w, h } = this.world, pk = this.pocket, ctl = this.controller
    pk.fill(0)
    let id = 0
    const stack: number[] = []
    for (let s0 = 0; s0 < w * h; s0++) {
      if (pk[s0] || !ctl[s0] || this.supplied[s0]) continue
      id++; pk[s0] = id; stack.push(s0)
      const f = ctl[s0]
      while (stack.length) {
        const i = stack.pop()!, x = i % w, y = (i / w) | 0
        if (x > 0) { const j = i - 1; if (!pk[j] && ctl[j] === f && !this.supplied[j]) { pk[j] = id; stack.push(j) } }
        if (x < w - 1) { const j = i + 1; if (!pk[j] && ctl[j] === f && !this.supplied[j]) { pk[j] = id; stack.push(j) } }
        if (y > 0) { const j = i - w; if (!pk[j] && ctl[j] === f && !this.supplied[j]) { pk[j] = id; stack.push(j) } }
        if (y < h - 1) { const j = i + w; if (!pk[j] && ctl[j] === f && !this.supplied[j]) { pk[j] = id; stack.push(j) } }
      }
    }
  }

  /**
   * Tiles taken from a kingdom you are already hostile to become a grievance the victim's AI answers by sending troops to
   * retrieve the land (peaceful neighbours go through the warning/countdown in `checkViolations` instead).
   */
  private detectSeizures() {
    const { w, h } = this.world
    for (const u of this.units) {
      if (u.state === 'dead' || u.inTower >= 0) continue
      const cx = u.cell % w, cy = (u.cell / w) | 0
      let victim = -1
      for (let y = Math.max(0, cy - 2); y <= Math.min(h - 1, cy + 2) && victim < 0; y++) for (let x = Math.max(0, cx - 2); x <= Math.min(w - 1, cx + 2); x++) {
        const i = y * w + x, before = this.prevController[i], now = this.controller[i]
        if (before && before !== now && now === u.faction + 1 && this.hostile(u.faction, before - 1)) { victim = before - 1; break }
      }
      if (victim >= 0) { this.diplomacy.fighting(u.faction, victim, this.time); this.addGrievance(victim, u.faction, u.x, u.y, 'land') }
    }
  }
  addGrievance(victim: number, foe: number, x: number, y: number, kind: 'land' | 'attack') {
    const list = (this.aiMemo.grievance[victim] ??= [])
    list.push({ x, y, t: this.time, foe, kind })
    if (list.length > 10) list.shift()
  }

  /** Which kingdom's town-held land a point lies in, ignoring units (so a trespasser cannot hide by out-influencing the border). */
  baseOwnerAt(x: number, y: number): number {
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE)
    const best: number[] = [], sum: number[] = []
    for (const t of this.towns) {
      if (t.ruined) continue
      const v = influenceAt('town', cx - t.cx, cy - t.cy, t.kind === 'barracks' ? TERRITORY.barracksRadius : TERRITORY.townRadius, t.kind === 'barracks' ? TERRITORY.barracksWeight : TERRITORY.townWeight)
      if (v <= 0) continue
      sum[t.owner] = (sum[t.owner] ?? 0) + v
      if (v > (best[t.owner] ?? 0)) best[t.owner] = v
    }
    let win = -1, top = 0
    for (let f = 0; f < best.length; f++) if (best[f]) { const v = stack(best[f], sum[f]); if (v > top) { top = v; win = f } }
    return win
  }

  /**
   * A unit standing in a peaceful (neutral) kingdom's land starts a countdown; beyond REL.immediateTiles of any of its towns the
   * violator gets REL.warnSeconds to leave, within that distance the conflict starts at once. Leaving resets the timer.
   */
  private checkViolations() {
    const T = this.time
    for (const u of this.units) {
      if (u.state === 'dead' || u.inTower >= 0) continue
      const victim = this.baseOwnerAt(u.x, u.y)
      if (victim < 0 || victim === u.faction || this.diplomacy.get(u.faction, victim) !== 'neutral') continue
      const near = this.towns.some(t => t.owner === victim && Math.hypot(t.x - u.x, t.y - u.y) <= REL.immediateTiles * TILE)
      const key = u.faction * 32 + victim
      const e = this.viol.get(key) ?? { since: T, seen: T, immediate: false }
      e.seen = T; e.immediate = e.immediate || near
      this.viol.set(key, e)
      if (e.immediate || T - e.since >= REL.warnSeconds) {
        this.diplomacy.violation(u.faction, victim, T, this.label, near ? 'trespassed beside a town in' : 'trespassed on')
        this.viol.delete(key)
      }
    }
    for (const [key, e] of this.viol) if (T - e.seen > 0.6 || this.diplomacy.get(Math.floor(key / 32), key % 32) !== 'neutral') this.viol.delete(key)
  }

  // ---------- main loop ----------
  /** Advance by real elapsed seconds using a fixed-step accumulator. Returns interpolation alpha. */
  advance(frameDt: number): number {
    this.accumulator += Math.min(MAX_FRAME_DT, frameDt) * this.speed
    let steps = 0
    const t0 = performance.now()
    while (this.accumulator >= SIM_DT && steps < 12) { this.step(SIM_DT); this.accumulator -= SIM_DT; steps++ }
    if (steps) this.simMs = (performance.now() - t0) / steps
    return this.accumulator / SIM_DT
  }

  step(dt: number) {
    this.time += dt; this.tickCount++
    if (this.diplomacy.version !== this.lastDiploVersion) { this.lastDiploVersion = this.diplomacy.version; this.dirty = true } // alliances change ownership and supply
    this.chopped.length = 0
    for (const t of this.towns) if (t.flash > 0) t.flash -= dt
    for (const d of this.deaths) d.t += dt
    if (this.deaths.length && this.deaths[0].t > 1) this.deaths = this.deaths.filter(d => d.t <= 1)
    for (const p of this.projectiles) p.t += dt
    for (const f of this.fx) f.t += dt
    if (this.fx.length && this.fx[0].t > 1.2) this.fx = this.fx.filter(f => f.t <= 1.2)
    this.shake = Math.max(0, this.shake - dt * 2.2)
    if (this.sounds.length > 40) this.sounds.splice(0, this.sounds.length - 40)
    if (this.projectiles.length && this.projectiles[0].t > this.projectiles[0].dur) this.projectiles = this.projectiles.filter(p => p.t <= p.dur)

    this.economy(dt)
    this.syncHash()
    this.garrison()
    updateCombat(this, dt)
    moveUnits(this, dt)
    updateBoats(this, dt)
    for (const u of this.units) {
      if (u.state === 'dead' || u.inTower >= 0) continue
      const c = this.cellAt(u.x, u.y)
      if (c >= 0 && c !== u.cell) { u.cell = c; this.dirty = true } // a territory source moves only when entering a new tile
      u.animT += dt
    }
    for (const u of this.units) if (u.noGarrisonT > 0) u.noGarrisonT -= dt
    if (this.tickCount % 5 === 0) this.checkViolations()
    this.checkCaptures()
    if (this.dirty) this.recomputeTerritory()
    this.careForUnits(dt)
    movePawns(this, dt)
    updatePawns(this, dt)
    if (this.tickCount % 5 === 0) updateAgitation(this, dt * 5)
    updateAI(this, dt)
    this.diploClock += dt
    if (this.diploClock >= 1) {
      this.diploClock -= 1
      agitationTick(this)
      this.diplomacy.update(this.time, () => this.rng.next(), k => !this.kingdoms[k].isPlayer, this.label, k => this.cap(k))
    }
    for (const e of this.diplomacy.events) this.say(e.text)
    this.diplomacy.events.length = 0
    this.cleanup()
    if (this.dirty) this.recomputeTerritory()
  }

  private syncHash() {
    const n = this.units.length
    for (let i = 0; i < n; i++) { this.ux[i] = this.units[i].x; this.uy[i] = this.units[i].y }
    this.ux.length = this.uy.length = n
    this.unitHash.rebuild(this.ux, this.uy, n, i => this.units[i].state !== 'dead' && this.units[i].inTower < 0)
  }
  /** Re-index after movement so collision/contact queries see current positions. */
  refreshHash() { this.syncHash() }

  // ---------- economy & population ----------
  private economy(dt: number) {
    for (const k of this.kingdoms) {
      const towns = this.ownedTowns(k.id)
      if (!towns) continue
      k.power += Math.max(0, this.cap(k.id) - this.pop(k.id)) * dt // income = free troop capacity per second
      k.prodTimer -= dt
      if (k.prodTimer <= 0) { k.prodTimer = POP.spawnInterval; this.tryProduce(k) }
    }
  }

  /** Every 10 s a kingdom spawns one of its toggled unit types if there is room and enough Power. */
  tryProduce(k: Kingdom): Unit | null {
    const types = UNIT_TYPES.filter(t => k.produce[t])
    if (!types.length) return null
    let roll = this.rng.next() * types.reduce((n, t) => n + (k.weights[t] ?? 1), 0), type = types[0]
    for (const t of types) { roll -= k.weights[t] ?? 1; if (roll <= 0) { type = t; break } }
    if (this.pop(k.id) + 1 > this.cap(k.id) || k.power < UNIT[type].cost) return null
    const towns = this.towns.filter(t => t.owner === k.id && t.produce)
    if (!towns.length) return null
    const town = towns[this.rng.int(0, towns.length - 1)]
    const spot = this.openSpot(town)
    if (!spot) return null
    k.power -= UNIT[type].cost
    const u = this.spawnUnit(k.id, spot.x, spot.y, type)
    u.hp = 1 // freshly produced units start near death and recover through normal (town-boosted) regeneration
    return u
  }

  /** A unit standing in an ally's land is sheltered: it takes no over-capacity damage (how a town-less player keeps an army alive). */
  sheltered(u: Unit): boolean {
    const owner = this.baseOwnerAt(u.x, u.y)
    return owner >= 0 && owner !== u.faction && this.diplomacy.allied(u.faction, owner)
  }

  private careForUnits(dt: number) {
    const near: number[] = []
    const restPx = CARE.restDistTiles * TILE, townPx = CARE.townRadiusTiles * TILE
    const pockets = new Map<number, number>()
    for (const u of this.units) {
      if (u.state === 'dead' || u.inTower >= 0 || u.cell < 0 || this.controller[u.cell] !== u.faction + 1 || this.supplied[u.cell]) continue
      pockets.set(this.pocket[u.cell], (pockets.get(this.pocket[u.cell]) ?? 0) + u.count)
    }
    for (const u of this.units) {
      if (u.state === 'dead' || u.inTower >= 0) { u.cutOff = false; continue }
      const i = u.cell
      const wasCut = u.cutOff
      u.cutOff = i >= 0 && this.controller[i] === u.faction + 1 && !this.supplied[i]
      if (u.cutOff && !wasCut) u.cutSince = this.time
      if (u.cutOff) {
        // a grace period lets units push deep before attrition starts; every additional unit in the same pocket multiplies the damage by 1.25
        if (this.time - u.cutSince >= TERRITORY.cutGrace) {
          const n = pockets.get(this.pocket[i]) ?? u.count
          const mult = Math.min(TERRITORY.pocketMaxMult, Math.pow(TERRITORY.pocketGrowth, Math.max(0, n - 1)))
          this.hurt(u, u.maxHp * TERRITORY.attritionPct * mult * dt, -1)
        }
        continue
      }
      if (u.hp >= u.maxHp) continue
      // regeneration: only while no hostile unit is within 5 tiles
      if (u.free && this.time - u.lastOrderT > 120) u.free = false
      this.unitHash.query(u.x, u.y, restPx, near)
      let enemyNear = false
      for (let k = 0; k < near.length && !enemyNear && u.aiRole !== 'laststand'; k++) { const o = this.units[near[k]]; if (o && o.state !== 'dead' && this.hostile(u.faction, o.faction) && Math.hypot(o.x - u.x, o.y - u.y) <= restPx) enemyNear = true }
      if (enemyNear) continue
      let rate = CARE.baseRegenPct
      for (const t of this.towns) if (t.owner === u.faction && Math.hypot(t.x - u.x, t.y - u.y) <= townPx) { rate *= CARE.townMult; break }
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * rate * dt)
    }
    // towns mend slowly while no hostile unit is nearby
    const quietPx = TOWN.regenQuietTiles * TILE
    for (const t of this.towns) {
      if (t.ruined || t.hp >= t.maxHp) continue
      this.unitHash.query(t.x, t.y, quietPx, near)
      let enemy = false
      for (let k = 0; k < near.length && !enemy; k++) { const o = this.units[near[k]]; if (o && o.state !== 'dead' && this.hostile(t.owner, o.faction) && Math.hypot(o.x - t.x, o.y - t.y) <= quietPx) enemy = true }
      if (!enemy) t.hp = Math.min(t.maxHp, t.hp + t.maxHp * TOWN.regenPct * dt)
    }
    // units above the population cap suffer until the mismatch is reconciled (most recently added suffer first)
    for (const k of this.kingdoms) {
      const excess = this.pop(k.id) - this.cap(k.id)
      const mine = this.units.filter(u => u.faction === k.id && u.state !== 'dead' && u.inTower < 0 && !u.free)
      for (const u of mine) u.overcap = false
      if (excess <= 0) continue
      mine.sort((a, b) => b.seq - a.seq)
      let left = excess
      for (const u of mine) { if (left <= 0) break; if (this.sheltered(u)) continue; u.overcap = true; left -= u.count; this.hurt(u, u.maxHp * CARE.overcapPct * dt, -1) }
    }
  }

  /** Apply non-combat damage (attrition, over-cap). */
  private hurt(u: Unit, amount: number, killer: number) { u.hp -= amount; if (u.hp <= 0) this.killUnit(u, killer) }

  killUnit(u: Unit, killerFaction = -1) {
    if (u.state === 'dead') return
    u.state = 'dead'; u.hp = 0
    if (u.inTower >= BOAT_FLAG) { const b = this.boatById(u.inTower - BOAT_FLAG); if (b) b.cargo = b.cargo.filter(c => c !== u.id); u.inTower = -1 }
    else if (u.inTower >= 0) { const t = this.towerById(u.inTower); if (t) t.archer = -1; u.inTower = -1 }
    this.deaths.push({ x: u.x, y: u.y, faction: u.faction, type: u.type, t: 0 })
    if (killerFaction >= 0) this.diplomacy.death(killerFaction, u.faction, this.time, u.count)
    this.dirty = true // dead units stop contributing territory immediately
  }

  private cleanup() {
    if (this.units.some(u => u.state === 'dead')) {
      this.units = this.units.filter(u => { if (u.state === 'dead') { this.unitMap.delete(u.id); return false } return true })
      if (this.selection?.kind === 'units') {
        const ids = this.selection.ids.filter(i => this.unitMap.has(i))
        this.selection = ids.length ? { kind: 'units', ids } : null
      }
    }
    for (const k of this.kingdoms) {
      if (!k.alive) continue
      const towns = this.ownedTowns(k.id), units = this.units.some(u => u.faction === k.id)
      if (!towns && !units && !this.pawns.some(p => p.faction === k.id)) k.alive = false
    }
    if (!this.kingdoms[0].alive || (!this.ownedTowns(0) && !this.units.some(u => u.faction === 0))) this.status = 'defeat'
  }

  // ---------- towns ----------
  /** True when a unit owned by the town's owner stands within the protection radius. */
  townDefended(t: Town) {
    const r = CARE.townRadiusTiles * TILE
    return this.units.some(u => u.state !== 'dead' && u.inTower < 0 && u.faction === t.owner && Math.hypot(u.x - t.x, u.y - t.y) <= r)
  }

  /** Immediate capture on contact — but only by a hostile kingdom, and only while no defender is within 2 tiles. */
  private checkCaptures() {
    for (const t of this.towns) {
      if (t.ruined) continue
      let by = -1
      for (const u of this.units) {
        if (u.state === 'dead' || u.inTower >= 0 || u.faction === t.owner || !this.hostile(u.faction, t.owner)) continue
        if (Math.hypot(u.x - t.x, u.y - t.y) <= 54) { by = u.faction; break }
      }
      if (by >= 0 && t.raze && by === 0) continue // the player chose RAZE: contact does not capture, the troops tear it down instead
      if (by >= 0 && !this.townDefended(t)) this.captureTown(t, by)
    }
  }

  captureTown(t: Town, faction: number) {
    if (t.owner === faction) return
    const from = t.owner
    this.moveStock(t, from, faction, true)
    t.owner = faction; t.flash = 1.2; t.raze = false; t.produce = true; t.hp = t.maxHp
    this.shake = Math.max(this.shake, 1); this.fx.push({ kind: 'capture', x: t.x, y: t.y, t: 0 }); this.sounds.push({ name: 'capture', x: t.x, y: t.y })
    for (const id of t.pawnIds) { const p = this.pawnById(id); if (p) switchPawnAllegiance(this, p, faction) }
    for (const st of this.towers) if (st.town === t.id) { // towers and lots belong to their town; a garrison that belonged to the old owner climbs out and falls back
      st.faction = faction; st.builder = -1
      const a = st.archer >= 0 ? this.unitById(st.archer) : null
      if (a && a.faction !== faction) { this.ejectGarrison(a); }
    }
    this.diplomacy.fighting(from, faction, this.time)
    this.say(`${this.label(faction)} captured a town from ${this.label(from)}`)
    if (this.diplomacy.get(from, faction) === 'conflict') this.diplomacy.declareWar(from, faction, this.time, this.label) // taking a town turns a conflict into war
    townFell(this, t.x, t.y, from, faction) // nearby nations get nervous at once
    this.recomputeTerritory()
  }

  /** A garrison whose tower changed hands leaves it and retreats to the nearest friendly supplied ground (it stays if there is none). */
  private ejectGarrison(a: Unit) {
    this.leaveTower(a); a.noGarrisonT = 12; a.state = 'idle'
    let best = -1, bd = Infinity
    const { w, h } = this.world
    for (let i = 0; i < w * h; i++) {
      if (this.controller[i] !== a.faction + 1 || !this.supplied[i]) continue
      const d = Math.hypot((i % w + 0.5) * TILE - a.x, (Math.floor(i / w) + 0.5) * TILE - a.y)
      if (d < bd) { bd = d; best = i }
    }
    if (best >= 0) this.orderMoveTo(a, (best % w + 0.5) * TILE, (Math.floor(best / w) + 0.5) * TILE)
  }

  /** Raze: the town is wiped out — no owner, no territory, its structures and pawns go with it. */
  destroyTown(t: Town, by: number) {
    if (t.ruined) return
    const from = t.owner
    this.moveStock(t, from, by, false) // the razers carry the stored lumber off
    this.say(`${this.label(by)} razed a town of ${this.label(from)}`)
    for (const st of [...this.towers]) if (st.town === t.id) this.destroyTower(st)
    for (const id of t.pawnIds) { const p = this.pawnById(id); if (p) { releaseTree(this, p); releaseSite(this, p); this.pawns = this.pawns.filter(q => q !== p) } }
    t.pawnIds = []
    t.ruined = true; t.owner = -1; t.hp = 0; t.raze = false
    this.shake = Math.max(this.shake, 1.2); this.fx.push({ kind: 'capture', x: t.x, y: t.y, t: 0 }); this.fx.push({ kind: 'boom', x: t.x, y: t.y, t: 0 }); this.sounds.push({ name: 'boom', x: t.x, y: t.y })
    this.diplomacy.fighting(from, by, this.time)
    townFell(this, t.x, t.y, from, by)
    this.recomputeTerritory()
  }

  // ---------- towers & lots ----------
  nearestTown(faction: number, x: number, y: number): Town | null {
    let best: Town | null = null, bd = Infinity
    for (const t of this.towns) { if (t.owner !== faction) continue; const d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t } }
    return best
  }
  /** The nearest land tile of the faction's own supplied territory within reach of a water site (where the builder stands), or null. */
  shoreFor(faction: number, x: number, y: number): { x: number; y: number } | null {
    const { w, h } = this.world, cx = Math.floor(x / TILE), cy = Math.floor(y / TILE), R = Math.ceil(DOCK.siteShoreTiles)
    let best: { x: number; y: number } | null = null, bd = Infinity
    for (let yy = cy - R; yy <= cy + R; yy++) for (let xx = cx - R; xx <= cx + R; xx++) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
      const i = yy * w + xx
      if (!this.world.land[i] || this.controller[i] !== faction + 1 || !this.supplied[i]) continue
      const px = (xx + 0.5) * TILE, py = (yy + 0.5) * TILE, d = Math.hypot(px - x, py - y)
      if (d < bd && d <= (DOCK.siteShoreTiles + 0.6) * TILE) { bd = d; best = { x: px, y: py } }
    }
    return best
  }
  structureError(kind: StructureKind, faction: number, x: number, y: number): string | null {
    if (kind === 'boat' || kind === 'zumwalt') {
      const label = kind === 'boat' ? 'Boats' : 'Zumwalts', cost = kind === 'boat' ? BOAT.cost : ZUMWALT.cost
      const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE)
      if (cx < 0 || cy < 0 || cx >= this.world.w || cy >= this.world.h || this.world.land[cy * this.world.w + cx]) return `${label} must be built in the water`
      if (!this.shoreFor(faction, x, y)) return `${label} must be built beside your own shoreline`
      if (this.towers.some(t => Math.hypot(t.x - x, t.y - y) < 2 * TILE) || this.boats.some(b => Math.hypot(b.x - x, b.y - y) < 2.5 * TILE)) return 'Too close to another ship or structure'
      if (this.kingdoms[faction].lumber < cost) return `Needs ${cost} lumber`
      return null
    }
    const label = kind === 'tower' ? 'Towers' : 'Lots', cost = kind === 'tower' ? TOWER.cost : LOT.cost
    const i = this.cellAt(x, y)
    if (i < 0 || !this.world.land[i]) return `${label} must be built on land`
    if (this.controller[i] !== faction + 1) return `${label} must be inside your territory`
    if (this.towns.some(t => !t.ruined && Math.hypot(t.x - x, t.y - y) < TOWER.minTownGap * TILE)) return 'Too close to a town'
    if (this.towers.some(t => Math.hypot(t.x - x, t.y - y) < 2 * TILE)) return 'Too close to another structure'
    if (kind === 'lot') {
      const home = this.nearestTown(faction, x, y)
      if (!home) return 'No town to attach the lot to'
      if (this.towers.some(t => t.kind === 'lot' && t.town === home.id)) return 'That town already has a lot'
    }
    if (this.kingdoms[faction].lumber < cost) return `Needs ${cost} lumber`
    return null
  }
  towerError(faction: number, x: number, y: number) { return this.structureError('tower', faction, x, y) }
  lotError(faction: number, x: number, y: number) { return this.structureError('lot', faction, x, y) }
  placeStructure(kind: StructureKind, faction: number, x: number, y: number): Tower | null {
    if (this.structureError(kind, faction, x, y)) return null
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE), home = this.nearestTown(faction, x, y)!
    const shore = kind === 'boat' || kind === 'zumwalt' ? this.shoreFor(faction, x, y)! : undefined
    const maxHp = kind === 'tower' ? UNIT.warrior.hp * TOWER.hpMult : kind === 'lot' ? LOT.hp : kind === 'boat' ? BOAT.hp : ZUMWALT.hp
    // under construction the structure has one hit point per unit of wood already placed (none at first)
    const t: Tower = { id: this.nextId++, kind, town: home.id, faction, cx, cy, x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE, hp: 1, maxHp, progress: 0, built: false, builder: -1, archer: -1, shore }
    this.spendLumber(faction, this.priceOf(kind))
    this.towers.push(t)
    return t
  }
  placeTower(faction: number, x: number, y: number) { return this.placeStructure('tower', faction, x, y) }
  placeLot(faction: number, x: number, y: number) { return this.placeStructure('lot', faction, x, y) }
  placeBoat(faction: number, kind: BoatKind, x: number, y: number) { return this.placeStructure(kind, faction, x, y) }
  /** AI towers come with a free archer that runs straight to the tower (it does not count against the troop cap until it is inside). */
  spawnFreeArcher(t: Tower) {
    const home = this.towns[t.town] ?? this.nearestTown(t.faction, t.x, t.y)
    if (!home) return
    const spot = this.openSpot(home) ?? { x: home.x, y: home.y + 60 }
    const u = this.spawnUnit(t.faction, spot.x, spot.y, 'archer')
    u.free = true
    this.orderMoveTo(u, t.x, t.y + 36)
  }
  /** Take lumber from a kingdom; the stock held in its towns shrinks in proportion (so what a captured town hands over stays honest). */
  spendLumber(faction: number, cost: number) {
    const k = this.kingdoms[faction], before = k.lumber
    k.lumber = Math.max(0, before - cost)
    const f = before > 0 ? k.lumber / before : 0
    for (const t of this.towns) if (t.owner === faction) t.stock *= f
  }
  /** Lumber deposited by a pawn: it joins the kingdom's pool and is remembered as that town's stock. */
  depositLumber(t: Town, amount: number) { this.kingdoms[t.owner].lumber += amount; t.stock += amount }
  /** The lumber stored in a town goes with it when it changes hands (or is razed): nothing is destroyed for no reason. */
  private moveStock(t: Town, from: number, to: number, keep: boolean) {
    const amount = Math.min(t.stock, this.kingdoms[from]?.lumber ?? 0)
    if (amount <= 0 || from === to || !this.kingdoms[to]) { if (!keep) t.stock = 0; return }
    this.kingdoms[from].lumber -= amount; this.kingdoms[to].lumber += amount
    if (!keep) t.stock = 0 // (razed: the loot is carried off, the ruin keeps nothing)
    if (to === 0 || from === 0) this.say(to === 0 ? `Captured ${Math.floor(amount)} lumber with the town` : `Lost ${Math.floor(amount)} lumber with the town`)
  }
  priceOf(kind: StructureKind) { return kind === 'tower' ? TOWER.cost : kind === 'lot' ? LOT.cost : kind === 'boat' ? BOAT.cost : ZUMWALT.cost }
  buildTimeOf(t: Tower) { return t.kind === 'tower' ? TOWER.buildTime : t.kind === 'lot' ? LOT.buildTime : t.kind === 'boat' ? BOAT.buildTime : ZUMWALT.buildTime }
  costOf(t: Tower) { return this.priceOf(t.kind) }
  /** Construction progress: hit points equal the wood placed so far, and jump to full strength on completion. */
  advanceBuild(t: Tower, dt: number) {
    t.progress += dt
    if (t.progress >= this.buildTimeOf(t) && (t.kind === 'boat' || t.kind === 'zumwalt')) { // a finished ship leaves the slipway and (beside the coast) moors there
      t.built = true; t.builder = -1
      this.towers = this.towers.filter(q => q !== t)
      const b = spawnBoat(this, t.faction, t.kind, t.x, t.y)
      if (this.selection?.kind === 'structure' && this.selection.id === t.id) this.selection = { kind: 'boats', ids: [b.id] }
      this.say(`A ${t.kind === 'zumwalt' ? 'Zumwalt' : 'boat'} has been completed`)
    }
    else if (t.progress >= this.buildTimeOf(t)) { t.built = true; t.builder = -1; t.hp = t.maxHp; this.say(`A ${t.kind} has been completed`); this.sounds.push({ name: 'build', x: t.x, y: t.y }); if (t.kind === 'tower' && !this.kingdoms[t.faction].isPlayer) this.spawnFreeArcher(t) }
    else t.hp = Math.max(1, this.costOf(t) * (t.progress / this.buildTimeOf(t)))
  }
  destroyTower(t: Tower) {
    const a = t.archer >= 0 ? this.unitById(t.archer) : null
    if (a) { a.inTower = -1; t.archer = -1; this.killUnit(a, -1) }
    this.towers = this.towers.filter(q => q !== t)
    if (this.selection?.kind === 'structure' && this.selection.id === t.id) this.selection = null
    for (const p of this.pawns) if (p.site === t.id) { p.site = -1; p.state = 'wander'; p.route = []; p.planT = 0.3 }
    this.say(`A ${this.label(t.faction)} ${t.kind} was destroyed`)
  }

  /** Idle archers standing near a free friendly tower climb into it. */
  private garrison() {
    if (!this.towers.length) return
    for (const u of this.units) {
      if (u.type !== 'archer' || u.count !== 1 || u.inTower >= 0 || u.state === 'dead' || u.kbT >= 0 || u.noGarrisonT > 0 || u.routeIdx < u.route.length / 2) continue
      for (const t of this.towers) {
        if (t.kind !== 'tower' || !t.built || t.archer >= 0 || t.faction !== u.faction || Math.hypot(t.x - u.x, t.y - u.y) > TOWER.garrisonRange) continue
        t.archer = u.id; u.inTower = t.id; u.free = false; u.x = u.px = t.x; u.y = u.py = t.y; u.vx = u.vy = 0; u.state = 'idle'
        break
      }
    }
  }
  /** Archer climbs out of its tower (it will not climb straight back in for a few seconds). */
  exitTower(u: Unit) { if (u.inTower >= 0) { this.leaveTower(u); u.noGarrisonT = 6; u.state = 'idle' } }
  /** A friendly, finished, empty tower whose sprite covers this world point. */
  towerAt(x: number, y: number, faction: number): Tower | null {
    return this.towers.find(t => t.kind === 'tower' && t.built && t.archer < 0 && t.faction === faction && Math.abs(x - t.x) < 58 && y > t.y - 210 && y < t.y + 56) ?? null
  }
  private leaveTower(u: Unit) {
    const t = this.towerById(u.inTower)
    if (t) t.archer = -1
    u.inTower = -1
    if (t) { u.x = u.px = t.x; u.y = u.py = t.y + 56; u.cell = this.cellAt(u.x, u.y) }
    u.seq = ++this.seq
    this.dirty = true
  }

  /**
   * An idle, not-yet-fighting unit that gets hit by arrows from beyond its own reach reacts: healthy units charge the
   * archer (or tower), badly hurt ones back away out of range.
   */
  notifyShot(t: Unit, shooter: Unit | null, tower: Tower | null) {
    if (t.state !== 'idle' || t.type === 'archer' || t.inTower >= 0 || t.kbT >= 0 || t.mode === 'block' || t.disengageT > 0) return
    if (t.routeIdx < t.route.length / 2) return // already travelling somewhere on purpose
    const sx = shooter ? shooter.x : tower!.x, sy = shooter ? shooter.y : tower!.y
    const d = Math.hypot(sx - t.x, sy - t.y)
    if (d <= UNIT[t.type].range * 1.1) return // within its own reach: normal combat handles it
    if (t.hp > t.maxHp * SHOT_REACT.fleeBelow) {
      if (shooter) { t.chase = shooter.id; t.refocusT = SHOT_REACT.chaseSeconds }
      else this.applyRoute(t, [tower!.x, tower!.y + TOWER.radius * 0.8])
      return
    }
    const dx = (t.x - sx) / (d || 1), dy = (t.y - sy) / (d || 1)
    for (let f = 1; f > 0.2; f -= 0.2) {
      const ax = t.x + dx * SHOT_REACT.fleeTiles * TILE * f, ay = t.y + dy * SHOT_REACT.fleeTiles * TILE * f
      if (this.isLandAt(ax, ay)) { this.applyRoute(t, [ax, ay]); return }
    }
  }

  /**
   * Shells from a ship out at sea land on a unit. If it is idle (not fighting another unit, no order to follow) it does not stand there
   * and take it: it pulls back beyond the ship's reach, and remembers the ship so it can rush back and keep it from landing.
   */
  shelled(u: Unit, boatId: number, fx: number, fy: number) {
    u.evadeBoat = boatId; u.evadeT = this.time + AI.ambushSeconds
    if (u.state === 'dead' || u.inTower >= 0 || u.kbT >= 0 || u.mode === 'block') return
    if (u.state === 'attacking' || u.state === 'cooldown' || u.routeIdx < u.route.length / 2) return // fighting, or already on its way somewhere
    const near: number[] = []
    this.unitHash.query(u.x, u.y, 3 * TILE, near)
    if (near.some(i => { const o = this.units[i]; return o && o.state !== 'dead' && o.inTower < 0 && this.hostile(u.faction, o.faction) && Math.hypot(o.x - u.x, o.y - u.y) <= 3 * TILE })) return // busy with another unit
    const reach = (ZUMWALT.rangeTiles + 1.5) * TILE
    let best: { x: number; y: number } | null = null, bd = -1
    const away = Math.atan2(u.y - fy, u.x - fx)
    for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) for (const dist of [5, 8, 12, 16, 20]) {
      const x = u.x + Math.cos(away + da) * dist * TILE, y = u.y + Math.sin(away + da) * dist * TILE
      if (!this.isLandAt(x, y)) continue
      const d = Math.hypot(x - fx, y - fy) - dist * 0.15 * TILE // prefer far from the ship, with a little regard for the walk
      if (d > bd) { bd = d; best = { x, y } }
      if (d >= reach) break
    }
    if (!best || !this.orderMoveTo(u, best.x, best.y)) return
    if (!this.kingdoms[u.faction].isPlayer) { u.aiRole = 'respond'; this.aiMemo.respond.set(u.id, this.time + 14) } // the AI leaves the retreat alone for a while
  }

  // ---------- orders ----------
  /** Click picking: units first (including archers garrisoned in friendly towers), then pawns. */
  pickUnit(x: number, y: number, r: number): Selection {
    let best: Selection = null, bd = r
    for (const u of this.units) {
      if (u.faction !== 0 || u.state === 'dead' || u.inTower >= 0) continue
      const d = Math.hypot(u.x - x, u.y - y - 14)
      if (d < bd) { bd = d; best = { kind: 'units', ids: [u.id] } }
    }
    if (best) return best
    for (const t of this.towers) {
      if (t.faction !== 0 || t.archer < 0) continue
      if (Math.hypot(t.x - x, t.y - 70 - y) < 50) return { kind: 'units', ids: [t.archer] }
    }
    for (const p of this.pawns) {
      if (p.faction !== 0) continue
      const d = Math.hypot(p.x - x, p.y - y - 10)
      if (d < bd * 0.8) { bd = d; best = { kind: 'pawn', id: p.id } }
    }
    return best
  }
  pickTree(x: number, y: number, r: number): number {
    let best = -1, bd = r
    for (const t of this.world.trees) { if (t.chopped) continue; const d = Math.hypot(t.x - x, t.y - 40 - y); if (d < bd) { bd = d; best = t.id } }
    return best
  }

  /** Player route order: simplify, clip to land, smooth, follow. Leaving block mode is automatic (documented rule). */
  orderRoute(u: Unit, raw: number[]) {
    if (u.inTower >= BOAT_FLAG) return false // aboard a ship: use the Unload button once it is docked
    u.boardBoat = -1
    if (u.inTower >= 0) { this.leaveTower(u); u.noGarrisonT = 4 }
    if (u.type === 'archer' && u.count === 1 && raw.length >= 2) { // ending a drag on a free tower sends the archer to its door
      const t = this.towerAt(raw[raw.length - 2], raw[raw.length - 1], u.faction)
      if (t) { raw = raw.slice(); raw[raw.length - 2] = t.x; raw[raw.length - 1] = t.y + 30; u.noGarrisonT = 0 }
    }
    const route = buildRoute(this.landWalkable(), u.x, u.y, raw)
    if (!route.length) return false
    this.applyRoute(u, route)
    if (raw.length >= 2) { // a route that ends on a docked friendly ship boards it on arrival
      const ex = raw[raw.length - 2], ey = raw[raw.length - 1]
      const ship = this.boats.find(b => b.docked && b.faction === u.faction && Math.hypot(b.x - ex, b.y - ey) < (b.kind === 'zumwalt' ? 2.6 : 1.7) * TILE)
      if (ship) u.boardBoat = ship.id
    }
    return true
  }
  orderRouteMany(us: Unit[], raw: number[]) { let any = false; for (const u of us) any = this.orderRoute(u, raw) || any; return any }
  applyRoute(u: Unit, route: number[]) {
    u.mode = 'fight'; u.route = route; u.routeIdx = 0; u.state = 'moving'; u.stuck = 0
    u.disengageT = UNIT_BODY.disengageGrace; u.attackT = 0; u.target = -1; u.lastOrderT = this.time
  }
  /** Used by the AI: path over land from the unit to a target point (optionally staying out of foreign territory). */
  orderMoveTo(u: Unit, x: number, y: number, avoidForeign = false) {
    if (u.inTower >= 0) return false
    const walk = this.landWalkable(avoidForeign ? u.faction : undefined)
    if (!walk.at(x, y)) return false
    const path = pathBetween(walk, u.x, u.y, x, y)
    if (!path) return false
    this.applyRoute(u, path); u.goalX = x; u.goalY = y
    return true
  }
  setBlock(u: Unit, on: boolean) {
    if (u.inTower >= 0 || u.type === 'archer') return // archers cannot block
    u.mode = on ? 'block' : 'fight'
    if (on) { u.route = []; u.routeIdx = 0; u.vx = u.vy = 0; u.state = 'guarding' } else if (u.state === 'guarding') u.state = 'idle'
  }
  toggleBlock(u: Unit) { this.setBlock(u, u.mode !== 'block') }
  /** Toggle block for the whole selection: if everyone is blocking, release; otherwise everyone blocks. */
  toggleBlockSelection() { const us = this.selectedUnits().filter(u => u.inTower < 0 && u.type !== 'archer'); const on = !us.every(u => u.mode === 'block'); for (const u of us) this.setBlock(u, on) }
  orderPawn(p: Pawn, treeId: number) { return orderPawnToTree(this, p, treeId) }

  // ---------- squads ----------
  joinReason(ids: number[]): string | null {
    const us = ids.map(i => this.unitById(i)).filter((u): u is Unit => !!u && u.state !== 'dead')
    if (us.length < 2) return 'Select at least two units'
    if (us.some(u => u.faction !== us[0].faction || u.type !== us[0].type)) return 'Units must be the same type'
    if (us.some(u => u.inTower >= 0)) return 'Units in towers cannot join'
    if (us.some(u => u.hp < u.maxHp - 1e-6)) return 'All units must be at full strength'
    if (us.reduce((n, u) => n + u.count, 0) > UNIT_BODY.maxSquad) return `A squad holds at most ${UNIT_BODY.maxSquad} units`
    return null
  }
  joinLabel(ids: number[]) { return ids.some(i => (this.unitById(i)?.count ?? 1) > 1) ? 'Merge' : 'Create Squad' }
  joinUnits(ids: number[]): Unit | null {
    if (this.joinReason(ids)) return null
    const us = ids.map(i => this.unitById(i)!)
    const lead = us[0], total = us.reduce((n, u) => n + u.count, 0)
    lead.memberNames = us.flatMap(u => u.memberNames)
    lead.count = total; lead.maxHp = UNIT[lead.type].hp * total; lead.hp = lead.maxHp
    lead.route = []; lead.routeIdx = 0; lead.mode = 'fight'
    for (const u of us.slice(1)) { u.state = 'dead'; u.hp = 0 } // absorbed (no death effect or diplomacy)
    this.dirty = true
    this.selection = { kind: 'units', ids: [lead.id] }
    return lead
  }
  breakSquad(id: number): Unit[] {
    const lead = this.unitById(id)
    if (!lead || lead.count < 2) return lead ? [lead] : []
    const n = lead.count, per = lead.hp / n, base = UNIT[lead.type].hp, names = lead.memberNames
    lead.count = 1; lead.maxHp = base; lead.hp = per; lead.name = names[0]; lead.memberNames = [names[0]]
    const out = [lead]
    for (let i = 1; i < n; i++) {
      const a = (i / n) * Math.PI * 2, x = lead.x + Math.cos(a) * 36, y = lead.y + Math.sin(a) * 36
      const u = this.spawnUnit(lead.faction, this.isLandAt(x, y) ? x : lead.x, this.isLandAt(x, y) ? y : lead.y, lead.type)
      this.usedNames.delete(u.name)
      u.name = names[i]; u.memberNames = [names[i]]; u.hp = per; u.maxHp = base
      out.push(u)
    }
    this.selection = { kind: 'units', ids: out.map(u => u.id) }
    return out
  }
  breakSelection() { const sq = this.selectedUnits().filter(u => u.count > 1); const all: number[] = this.selectedUnits().filter(u => u.count === 1).map(u => u.id); for (const u of sq) all.push(...this.breakSquad(u.id).map(x => x.id)); if (all.length) this.selection = { kind: 'units', ids: all } }

  // ---------- diplomacy / settings ----------
  /** Why the player cannot ally with kingdom k's alliance right now (null = fine): nobody in it may be at war with the player. */
  allyBlockedReason(k: number): string | null {
    for (const m of this.diplomacy.bloc(k)) if (m !== 0 && this.kingdoms[m].alive && this.diplomacy.hostile(0, m)) return `${this.label(k)}'s alliance includes ${this.label(m)}, which you are fighting`
    return null
  }
  /** Player asks kingdom k for an alliance: unlikely early on, likelier when it is agitated, certain when it is under attack. */
  proposeAlliance(k: number) {
    const blocked = this.allyBlockedReason(k)
    if (blocked) { this.say(blocked); return false }
    const ok = playerAllianceRequest(this, k)
    if (ok) formAlliance(this, 0, k, null)
    else this.say(`${this.label(k)} refused the alliance`)
    return ok
  }
  breakAlliance(k: number) {
    if (this.diplomacy.get(0, k) !== 'allied') return
    this.diplomacy.set(0, k, 'neutral', this.time, `You broke the alliance with ${this.label(k)}`)
    this.purposes.delete(Math.min(0, k) * 32 + Math.max(0, k))
  }
  /** Colour index shown for kingdom k's territory: its own, or its bloc's strongest member's when the eye toggle is on. */
  displayColor(k: number): number {
    if (!this.mergeColors.has(k)) return this.kingdoms[k].color
    const bloc = this.diplomacy.bloc(k).filter(m => this.kingdoms[m].alive)
    if (bloc.length < 2) return this.kingdoms[k].color
    const best = bloc.reduce((a, b) => (this.ownedTowns(b) > this.ownedTowns(a) || (this.ownedTowns(b) === this.ownedTowns(a) && (this.tileCounts[b] ?? 0) > (this.tileCounts[a] ?? 0)) ? b : a), bloc[0])
    return this.kingdoms[best].color
  }
  /** Arrows from kingdom k to every nation it is allied with, in conflict with, or at war with (ends are the closest pair of towns). */
  relationArrows(k: number): { from: { x: number; y: number }; to: { x: number; y: number }; kind: 'war' | 'conflict' | 'allied'; other: number }[] {
    const out: { from: { x: number; y: number }; to: { x: number; y: number }; kind: 'war' | 'conflict' | 'allied'; other: number }[] = []
    const mine = this.towns.filter(t => t.owner === k)
    if (!this.kingdoms[k]?.alive || !mine.length) return out
    for (const o of this.kingdoms) {
      if (o.id === k || !o.alive) continue
      const r = this.diplomacy.get(k, o.id)
      const kind = r === 'war' || r === 'total' ? 'war' : r === 'conflict' ? 'conflict' : r === 'allied' ? 'allied' : null
      const theirs = this.towns.filter(t => t.owner === o.id)
      if (!kind || !theirs.length) continue
      let best: [Town, Town] | null = null, bd = Infinity
      for (const a of mine) for (const b of theirs) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < bd) { bd = d; best = [a, b] } }
      if (best) out.push({ from: { x: best[0].x, y: best[0].y }, to: { x: best[1].x, y: best[1].y }, kind, other: o.id })
    }
    return out
  }
  toggleFocus(k: number) { this.focusKingdom = this.focusKingdom === k ? null : k }
  toggleBlocColor(k: number) {
    const bloc = this.diplomacy.bloc(k), all = bloc.every(m => this.mergeColors.has(m))
    for (const m of bloc) all ? this.mergeColors.delete(m) : this.mergeColors.add(m)
  }
  spill(text: string) { this.spills.push({ t: this.time, text }); if (this.spills.length > 12) this.spills.shift() }
  /** Stop everything the selected units were ordered to do (the S key). */
  stopSelected() { for (const b of this.selectedBoats()) { b.route = []; b.routeIdx = 0; b.docking = false } for (const u of this.selectedUnits()) { if (u.inTower >= 0) continue; u.route = []; u.routeIdx = 0; u.chase = -1; u.vx = u.vy = 0; if (u.state === 'moving') u.state = 'idle' } }
  renameKingdom(k: number, name: string) { const n = name.trim().slice(0, 24); if (n) this.kingdoms[k].name = n }
  setProduce(k: number, type: UnitType, on: boolean) { this.kingdoms[k].produce[type] = on }
  setHarvest(k: number, mode: HarvestMode) { this.kingdoms[k].harvest = mode }

  /** Tabs for every conflict/war involving the player, and for AI conflicts that have actually turned bloody. */
  conflictTabs(): ConflictTab[] {
    const out: ConflictTab[] = []
    const D = this.diplomacy
    for (const k of this.kingdoms) {
      if (k.id === 0 || !k.alive) continue
      const r = D.get(0, k.id)
      if (r === 'conflict' || r === 'war' || r === 'total') out.push({ kind: 'player', id: k.id, name: k.name, relation: r, losses: D.casualties(0, k.id), kills: D.casualties(k.id, 0) })
    }
    const ai: ConflictTab[] = []
    for (let a = 1; a < this.kingdoms.length; a++) for (let b = a + 1; b < this.kingdoms.length; b++) {
      if (!this.kingdoms[a].alive || !this.kingdoms[b].alive) continue
      const r = D.get(a, b), aLost = D.casualties(a, b), bLost = D.casualties(b, a)
      if (r === 'conflict' || r === 'war' || r === 'total') ai.push({ kind: 'ai', a, b, aName: this.kingdoms[a].name, bName: this.kingdoms[b].name, relation: r, aLost, bLost })
    }
    // a conflict tab appears the moment two AI kingdoms fall out and turns into a war tab as it escalates (the 4 hottest are shown)
    const heat = (t: ConflictTab) => (t.kind === 'ai' ? (t.relation === 'total' ? 2000 : t.relation === 'war' ? 1000 : 0) + t.aLost + t.bLost : 0)
    out.push(...ai.sort((p, q) => heat(q) - heat(p)).slice(0, 4))
    return out
  }

  /** The player's troops currently violating a neutral AI's border, with the time left before a conflict starts. */
  warnings() {
    const out: { name: string; secs: number; immediate: boolean }[] = []
    for (const [key, e] of this.viol) if (Math.floor(key / 32) === 0) out.push({ name: this.kingdoms[key % 32].name, secs: Math.max(0, Math.ceil(REL.warnSeconds - (this.time - e.since))), immediate: e.immediate })
    return out
  }

  // ---------- ships ----------
  pickBoat(x: number, y: number, faction = 0): Boat | null {
    let best: Boat | null = null, bd = Infinity
    for (const b of this.boats) {
      if (b.faction !== faction) continue
      const L = (b.kind === 'zumwalt' ? ZUMWALT.length : BOAT.length) / 2 + 12, W = (b.kind === 'zumwalt' ? 40 : 50)
      const vertical = b.dir === 'up' || b.dir === 'down'
      const dx = Math.abs(x - b.x), dy = Math.abs(y - b.y)
      if ((vertical ? dx < W && dy < L : dx < L && dy < W)) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = b } }
    }
    return best
  }
  orderBoats(bs: Boat[], raw: number[]) { let any = false; for (const b of bs) any = orderSail(this, b, raw) || any; return any }
  unloadSelected() { for (const b of this.selectedBoats()) unload(this, b) }
  setZumwaltFocus(f: ZumFocus) { if (ZUM_FOCUS.includes(f)) for (const b of this.selectedBoats()) if (b.kind === 'zumwalt') b.focus = f }
  private boatHud(): HudSnapshot['boat'] {
    const bs = this.selectedBoats()
    if (!bs.length) return null
    const b = bs[0]
    return { id: b.id, kind: b.kind, hp: Math.round(b.hp), maxHp: b.maxHp, cargo: cargoCount(this, b), cap: b.cap, docked: b.docked, docking: b.docking && !b.docked ? Math.min(1, b.dockT / DOCK.time) : -1, blocked: b.dockBlocked, focus: b.focus, count: bs.length, zumwalts: bs.filter(q => q.kind === 'zumwalt').length, names: b.cargo.map(id => this.unitById(id)?.name ?? '') }
  }

  // ---------- selection helpers: towns & structures ----------
  /** Injured units standing near one of their own towns mend 2.5× faster (the HUD shows a green plus). */
  healingAtTown(u: Unit): boolean {
    if (u.hp >= u.maxHp - 0.5 || u.state === 'dead' || u.inTower >= 0) return false
    const r = CARE.townRadiusTiles * TILE
    return this.towns.some(t => !t.ruined && t.owner === u.faction && Math.hypot(t.x - u.x, t.y - u.y) <= r)
  }
  pickTown(x: number, y: number): Town | null {
    let best: Town | null = null, bd = 90
    for (const t of this.towns) { if (t.ruined) continue; const d = Math.hypot(t.x - x, t.y - 20 - y); if (d < bd) { bd = d; best = t } }
    return best
  }
  pickStructure(x: number, y: number, faction = 0): Tower | null {
    let best: Tower | null = null, bd = 70
    for (const t of this.towers) { if (t.faction !== faction || t.built) continue; const d = Math.hypot(t.x - x, t.y - 20 - y); if (d < bd) { bd = d; best = t } }
    return best
  }
  toggleTownProduce(id: number) { const t = this.towns[id]; if (t && !t.ruined && t.owner === 0) t.produce = !t.produce }
  toggleTownRaze(id: number) { const t = this.towns[id]; if (t && !t.ruined && t.owner !== 0) t.raze = !t.raze }
  /** Cancel an unfinished building: the wood not yet spent is refunded and the builder is freed. */
  cancelStructure(t: Tower): boolean {
    if (t.built) return false
    const cost = this.costOf(t), refund = Math.floor(cost * (1 - Math.min(1, t.progress / this.buildTimeOf(t))))
    this.kingdoms[t.faction].lumber += refund
    this.towers = this.towers.filter(q => q !== t)
    for (const p of this.pawns) if (p.site === t.id) { p.site = -1; p.state = 'wander'; p.route = []; p.planT = 0.3 }
    if (this.selection?.kind === 'structure' && this.selection.id === t.id) this.selection = null
    this.say(`Construction cancelled (${refund} lumber refunded)`)
    return true
  }
  private townHud(): HudSnapshot['town'] {
    if (this.selection?.kind !== 'town') return null
    const t = this.towns[this.selection.id]
    if (!t || t.ruined) return null
    return { id: t.id, mine: t.owner === 0, hostile: t.owner !== 0 && this.hostile(0, t.owner), owner: this.label(t.owner), hp: Math.round(t.hp), maxHp: t.maxHp, produce: t.produce, raze: t.raze, kind: t.kind }
  }
  private structureHud(): HudSnapshot['structure'] {
    if (this.selection?.kind !== 'structure') return null
    const t = this.towerById(this.selection.id)
    if (!t) return null
    return { id: t.id, kind: t.kind, built: t.built, progress: t.progress / this.buildTimeOf(t), refund: Math.floor(this.costOf(t) * (1 - Math.min(1, t.progress / this.buildTimeOf(t)))) }
  }

  hud(): HudSnapshot {
    const me = this.kingdoms[0], tier = this.title(0)
    const sel = this.selectedUnits()
    const ids = sel.map(u => u.id)
    let pawn: HudSnapshot['pawn'] = null
    if (this.selection?.kind === 'pawn') {
      const p = this.pawnById(this.selection.id)
      if (p) { const t = p.tree >= 0 ? this.world.trees[p.tree] : null; pawn = { state: p.state, carry: p.carry, progress: t ? Math.min(1, t.progress / (t.kind <= 1 ? 150 : 60)) : 0 } }
    }
    return {
      seed: this.world.seed, status: this.status, lumber: Math.floor(me.lumber), power: Math.floor(me.power), towns: this.ownedTowns(0), pop: this.pop(0), cap: this.cap(0),
      kingdomName: me.name, title: tier.title, level: tier.level, produce: { ...me.produce }, time: this.time, speed: this.speed, placing: this.placing,
      kingdoms: this.kingdoms.map(k => { const t = this.title(k.id); return { id: k.id, name: k.name, title: t.title, level: t.level, color: k.color, emblem: k.emblem, towns: this.ownedTowns(k.id), tiles: this.tileCounts[k.id] ?? 0, lumber: Math.floor(k.lumber), power: Math.floor(k.power), agitation: k.isPlayer ? null : Math.round(this.agit[k.id]), ready: !!this.ready[k.id] && !k.isPlayer, allies: this.diplomacy.alliesOf(k.id), focused: this.focusKingdom === k.id, allyBlocked: k.isPlayer ? null : this.allyBlockedReason(k.id), merged: this.mergeColors.has(k.id), units: this.units.filter(u => u.faction === k.id && u.state !== 'dead').reduce((n, u) => n + u.count, 0), alive: k.alive, isPlayer: k.isPlayer, relation: this.diplomacy.get(0, k.id) } }),
      units: sel.map(u => ({ id: u.id, name: u.name, type: u.type, hp: Math.round(u.hp), maxHp: u.maxHp, count: u.count, members: u.memberNames, mode: u.mode, state: u.state, cutOff: u.cutOff, overcap: u.overcap, inTower: u.inTower >= 0, healing: this.healingAtTown(u) })),
      join: sel.length >= 2 ? { enabled: this.joinReason(ids) === null, label: this.joinLabel(ids), reason: this.joinReason(ids) } : null,
      hasSquad: sel.some(u => u.count > 1), allBlocking: sel.length > 0 && sel.every(u => u.mode === 'block'),
      pawn, boat: this.boatHud(), town: this.townHud(), structure: this.structureHud(), spills: this.spills.filter(e => this.time - e.t < AGIT.spillSeconds).map(e => e.text), events: this.log.filter(e => this.time - e.t < 12).slice(-4).map(e => e.text), warnings: this.warnings(), harvest: me.harvest, canBlock: sel.some(u => u.type !== 'archer' && u.inTower < 0), canRange: sel.some(u => u.type === 'archer'), showRange: this.showRange, conflicts: this.conflictTabs(),
    }
  }
}

