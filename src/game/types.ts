import type { Stock, Temperament, BoatKind, HarvestMode, UnitType, ZumFocus } from './config'

export type TreeKind = 0 | 1 | 2 | 3 // Tree1..Tree4; 0 and 1 are conifers

export type Tree = {
  id: number
  kind: TreeKind
  x: number // world position of the trunk base
  y: number
  cell: number
  phase: number
  chopped: boolean
  progress: number // seconds of cutting accumulated
  claimedBy: number // pawn id or -1
  regrowAt?: number // sim time a felled tree grows back
}

export type Decor = { id: number; type: 'bush' | 'rock'; variant: number; x: number; y: number; cell: number; phase: number }

export type GoldSpec = { stone: 1 | 2 | 3 | 4 | 5 | 6; x: number; y: number; jackpot: boolean }

export type World = {
  seed: number
  w: number
  h: number
  land: Uint8Array // 1 = land, 0 = water
  trees: Tree[]
  decor: Decor[]
  gold?: GoldSpec[] // gold stones (see placeGold)
  /** Land area inside the (larger) ocean-padded grid. */
  island: { x: number; y: number; w: number; h: number }
}

export type TownSpawn = { kingdom: number; cx: number; cy: number; barracks?: boolean }

export type Town = {
  id: number
  cx: number
  cy: number
  x: number
  y: number
  owner: number // kingdom index
  kind: 'town' | 'barracks' | 'settlement'
  level: 1 | 2 | 3 // town level 1-2 (gold upgrade); settlement level 1-3 (lumber, plus gold for 3)
  store: Stock | null // settlements keep their own stockpile; towns use their kingdom's (the home region)
  meatT: number // town: seconds until its sheep is ripe again. Settlement: seconds it has gone without troops or meat
  upkeepT: number // settlement: seconds until the next meal
  land: number // landmass id the town stands on
  crate: { x: number; y: number } | null // level 2+ settlement: where its storage crates stand
  abandoned: boolean // an abandoned settlement belongs to nobody until a unit of any kingdom walks up and claims it
  hitAt: number // sim time the town was last struck by a ship (pawns repair settlements under fire)
  pawnIds: number[]
  flash: number
  hp: number
  maxHp: number
  stock: number // lumber pawns have deposited here; it changes hands with the town
  produce: boolean // friendly towns can be toggled off so units spawn only where the player wants
  raze: boolean // the player's objective for an enemy town: false = CAPTURE (default), true = RAZE
  ruined: boolean // razed: no owner, no territory, never drawn
}

export type Kingdom = {
  id: number
  color: number
  name: string
  isPlayer: boolean
  lumber: number
  homeLand: number // landmass id whose towns share this kingdom's own stockpile (other landmasses have separate stocks)
  gold: number // home-region stock (settlements hold their own)
  meat: number
  power: number
  alive: boolean
  produce: Record<UnitType, boolean>
  prodTimer: number
  aggression: number // AI only: 0..1
  temperament: Temperament // AI only (the player is 'neutral')
  harvest: HarvestMode
  weights: Record<UnitType, number> // relative odds when several unit types are toggled on
  emblem: number // banner emblem (second identifier besides colour), unique per kingdom
}

export type UnitMode = 'fight' | 'block'
export type UnitState = 'idle' | 'moving' | 'engaging' | 'attacking' | 'cooldown' | 'blocked' | 'guarding' | 'dead'

export type Unit = {
  id: number
  type: UnitType
  name: string
  faction: number
  count: number // 1 = individual, 2..5 = squad
  memberNames: string[]
  x: number
  y: number
  px: number // previous sim position (render interpolation)
  py: number
  vx: number
  vy: number
  hp: number
  maxHp: number
  cell: number
  facing: 1 | -1
  aimX: number // last attack direction (renders lancer/archer attacks)
  aimY: number
  mode: UnitMode
  state: UnitState
  route: number[] // flat x,y pairs
  routeIdx: number // index of the next point (pair index)
  draft: number[]
  attackT: number
  attackHit: boolean
  attackVariant: 0 | 1
  cooldownT: number
  target: number
  targetKind: 'unit' | 'tower' | 'town' | 'boat' | 'outpost'
  disengageT: number
  cutOff: boolean
  overcap: boolean
  animT: number
  lastOrderT: number
  goalX: number // last AI goal (AI throttling only)
  goalY: number
  stuck: number
  chkX: number
  chkY: number
  noGarrisonT: number // seconds during which this archer will not auto-enter a tower (after leaving one)
  free: boolean // a free tower-garrison archer: not counted against the population cap until it is inside its tower
  growing: boolean // (unused: new units now heal through normal regeneration)
  cutSince: number // sim time when the unit last became cut off
  chase: number // hostile unit id being pursued, or -1
  refocusT: number // after a shove: chase a nearby enemy even if a route is pending
  kbT: number // knockback glide progress in seconds (-1 = none)
  kbSx: number
  kbSy: number
  kbEx: number
  kbEy: number
  hold: boolean // AI: stay put (bridge unit)
  aiRole: '' | 'retreat' | 'bridge' | 'dash' | 'garrison' | 'respond' | 'laststand'
  phase: number // per-unit animation phase
  inTower: number // tower id while garrisoned, otherwise -1
  seq: number // spawn / tower-exit order, used to decide who suffers when over the population cap
  boardBoat: number // docked boat this unit is walking to (boards on arrival), or -1
  evadeBoat: number // ship that ambushed this unit (it retreated from it and will rush to block its landing), or -1
  evadeT: number // sim time until which evadeBoat is remembered
}

export type GoldDeposit = { id: number; stone: 1 | 2 | 3 | 4 | 5 | 6; x: number; y: number; cell: number; amount: number; progress: number; claimedBy: number; jackpot: boolean; taken: boolean; cycleT: number }
/** Cargo left behind by a destroyed level 2+ settlement; whoever founds a settlement beside it takes it over. */
export type CratePile = { id: number; x: number; y: number; load: Stock }
export type Sheep = { id: number; town: number; x: number; y: number; hx: number; hy: number; ripe: boolean; hits: number; claimedBy: number; phase: number; moveT: number; tx: number; ty: number; facing: 1 | -1 }
/** Cargo lost at sea floats on the water until any cargo boat or gunship scoops it up. */
export type Floater = { id: number; x: number; y: number; load: Stock; t: number }
/** A standing trade order: the boat loads `want` at port A (a town or settlement), sails to port B, unloads, and goes back. */
export type TradeRoute = { a: number; b: number; leg: 'toA' | 'loadA' | 'toB' | 'unloadB' | 'loadB' | 'unloadA'; plan: Stock; path: number[]; wait: number; back?: Stock }
export type StrikeTarget = { kind: 'ground' | 'boat' | 'tower' | 'town' | 'unit'; id: number; x: number; y: number }

export type Tower = {
  id: number
  kind: 'tower' | 'lot' | 'settlement' | BoatKind // boat / zumwalt: a ship under construction in the water (pawns build it from `shore`)
  shore?: { x: number; y: number } // land point the builder stands on
  town: number // the town this structure belongs to; it changes hands when the town does
  faction: number
  cx: number
  cy: number
  x: number
  y: number
  hp: number
  maxHp: number
  progress: number // seconds of construction done
  built: boolean
  builder: number // pawn id or -1
  archer: number // garrisoned unit id or -1
}

/** A 1 hp supply marker (see OUTPOST in config.ts). */
export type Outpost = { id: number; faction: number; cx: number; cy: number; x: number; y: number; hp: number; placedAt: number }

export type BoatDir = 'up' | 'down' | 'left' | 'right'
export type Boat = {
  id: number
  kind: BoatKind
  faction: number
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  hp: number
  maxHp: number
  route: number[]
  routeIdx: number
  stuck: number
  chkX: number
  chkY: number
  facing: 1 | -1 // (used by the shared path follower)
  dir: BoatDir // sprite orientation (bow direction)
  docked: boolean
  docking: boolean // sailing the last stretch to a mooring spot (or lying beside it, waiting out DOCK.time)
  dockT: number // seconds spent lying beside the coast, trying to moor
  dockBlocked: boolean // an unfriendly unit stands at the mooring spot
  side: 'N' | 'E' | 'S' | 'W' // Zumwalt: which side its cannons point to (follows dir/flip)
  flip: boolean // sprite drawn upside down (cannons to the north)
  turnT: number // Zumwalt: time spent swinging toward its target
  muzzle: number // alternates between the two cannons
  target: { kind: 'boat' | 'tower' | 'town' | 'unit' | 'ground'; id: number; x: number; y: number } | null // Zumwalt / gunship: what it is aiming at
  scanT: number
  dockCell: number // land cell the ship is moored against, or -1
  cargo: number[] // unit ids aboard
  cap: number
  focus: ZumFocus // Zumwalt target priority
  lockT: number // seconds until the guns are locked on the current target
  retaliating: boolean // answering a warship that is shooting at this ship (overrides any chosen target)
  open: boolean // barge: the bow ramp is down (a docked barge lets its troops off and takes new ones aboard only while it is open)
  fireT: number // seconds a badly damaged Zumwalt keeps burning (cosmetic)
  evadeT: number // sim time until which an AI Zumwalt is backing away from gunships (its other orders wait)
  hpSeen: number // hull at the last shore-discipline check (a drop means something is hitting the ship)
  lockKey: string // 'kind:id' of the target being locked
  strike: StrikeTarget | null // manual target (an X on the map or a chosen enemy); the usual priority applies again once it is gone
  load: Stock // cargo boat / gunship: resources aboard
  want: Stock // cargo boat: what the player asked pawns to load
  unload: Stock // cargo boat: amounts the player asked pawns to put ashore (cleared as they do)
  trade: TradeRoute | null
  gunCd: number // gunship reload
  loading: number // seconds until the next load/unload step
  volleyCd: number
  shotsLeft: number
  shotT: number
  flash: number
  seq: number
  blockedT: number // seconds a landing has been held off by someone's troops on the beach
  stallT: number // seconds a ship with somewhere to go has barely moved (the watchdog re-plans it)
  noDock: boolean // AI warships and staging boats stay afloat: no accidental mooring beside a coast
  dockSince: number // sim time the boat moored (its territory lasts DOCK.lifetime seconds, then it must redock)
  dockSpent: boolean
}

export type PawnState = 'wander' | 'seek-tree' | 'travel-to-tree' | 'chopping' | 'carrying' | 'return-to-town' | 'deposit' | 'retreat' | 'travel-to-build' | 'building' | 'travel-to-sheep' | 'hitting' | 'travel-to-gold' | 'mining' | 'haul' | 'repair'

export type Pawn = {
  id: number
  town: number
  faction: number
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  cell: number
  facing: 1 | -1
  state: PawnState
  route: number[]
  routeIdx: number
  tree: number // targeted tree id or -1
  pendingTree: number
  pendingJob: { kind: 'gold' | 'sheep'; id: number } | null // a player-picked deposit / sheep, started once the current task is done
  haulBoat: number // a player-picked cargo boat this pawn serves until its orders are met (or -1)
  carry: number
  carryKind: 'lumber' | 'gold' | 'meat' // what `carry` is
  job: number // sheep / gold deposit id being worked, or -1
  hitT: number // seconds until the next sheep strike
  haul: { boat: number; dir: 'load' | 'unload'; kind: 'lumber' | 'gold' | 'meat'; phase: 'fetch' | 'deliver' } | null // porter errand for a cargo boat
  planT: number
  animT: number
  manual: boolean
  destTown: number
  site: number // tower id being built or -1
  stuck: number
  chkX: number
  chkY: number
}

export type Selection = { kind: 'units'; ids: number[] } | { kind: 'pawn'; id: number } | { kind: 'town'; id: number } | { kind: 'structure'; id: number } | { kind: 'boats'; ids: number[] } | null
export type Relation = 'allied' | 'neutral' | 'conflict' | 'war' | 'total'

/** A shipyard: free, built on the shore of one of a nation's towns (one per town). Its 10-tile stretch of coast (the white line) is where ships may be laid down. */
export type Yard = { id: number; faction: number; town: number; cx: number; cy: number; x: number; y: number; flash: number }
