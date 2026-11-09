// Central tuning. Everything gameplay-relevant lives here so it can be changed in one place.
import { COLOR_COUNT, PALETTE, darkOf, hexRgb } from './Palette'
export const TILE = 64
export const SIM_HZ = 25
export const SIM_DT = 1 / SIM_HZ
export const MAX_FRAME_DT = 0.25

// The world is an archipelago on a MAP.size × MAP.size grid (see WorldGenerator.generateArchipelago). The single-island generator
// (generateWorld) is kept for tests and small experiments: its island is MAP.minSize..maxSize tiles wide inside `pad` tiles of ocean.
export const MAP = { minSize: 56, maxSize: 84, pad: 30, chunk: 8, size: 200 }
/** Islands grow with the kingdom count: 5–8 kingdoms get 40 / 55 / 70 / 85 % more land area than a 1–4 kingdom game (so room for 3–5 towns each). */
export const islandAreaBonus = (kingdoms: number) => (kingdoms <= 4 ? 0 : 0.4 + 0.15 * (Math.min(kingdoms, 8) - 5))
export const islandScale = (kingdoms: number) => Math.sqrt(1 + islandAreaBonus(kingdoms)) // linear scale of each side

/** The player plus up to 19 AI kingdoms (one per palette colour); a new game starts with DEFAULT_KINGDOMS.min..max of them. */
export const MAX_KINGDOMS = COLOR_COUNT
export const DEFAULT_KINGDOMS = { min: 10, max: 15 }
/** Kingdom count derived from the seed (10–15), so a shared seed always means the same world. */
export const kingdomsForSeed = (seed: number) => DEFAULT_KINGDOMS.min + (seed >>> 0) % (DEFAULT_KINGDOMS.max - DEFAULT_KINGDOMS.min + 1)
// Colour tables come from src/game/palette.json (see Palette.ts); a colour index addresses all of them.
export const FACTION_NAMES = PALETTE.map(c => c.name)
export const FACTION_COLORS = PALETTE.map(c => c.hex)
export const FACTION_DARK = PALETTE.map((_, i) => darkOf(i))
export const FACTION_RGB: [number, number, number][] = PALETTE.map(c => hexRgb(c.hex))

export const TERRITORY = {
  townRadius: 11,
  barracksRadius: 13,
  unitRadius: 2,
  townWeight: 2.5,
  barracksWeight: 3.5,
  unitWeight: 1,
  unitFalloff: 3.5,
  firstFriendly: 1.0,
  extraFriendly: 0.5,
  stackCap: 2.5,
  attritionPct: 0.012, // of max HP per second once the cut-off grace period is over
  cutGrace: 20, // seconds a cut-off unit takes no damage, so it can push deep before attrition begins
  pocketGrowth: 1.25, pocketMaxMult: 2, // cut-off damage is multiplied by 1.25 for every additional unit in the same cut-off pocket, clamped to 2× in total
  blob: 2, // every unit always owns at least a blob × blob patch, even deep inside enemy land
}

export type UnitType = 'warrior' | 'archer' | 'lancer'
export const UNIT_TYPES: UnitType[] = ['warrior', 'archer', 'lancer']
export type UnitStats = { label: string; hp: number; speed: number; accel: number; damage: number; range: number; attackDuration: number; activeAt: number; cooldown: number; cost: number; knockback: number; scale: number; foot: number }
/** Speeds are px/s (64 px = 1 tile): warrior 5 tiles / 10 s, archer 5 tiles / 5 s, lancer in between. */
export const UNIT: Record<UnitType, UnitStats> = {
  warrior: { label: 'Warrior', hp: 900, speed: 32, accel: 130, damage: 38.4, range: 70, attackDuration: 0.56, activeAt: 0.5, cooldown: 0.7, cost: 40, knockback: 0, scale: 0.8, foot: 128 },
  archer: { label: 'Archer', hp: 225, speed: 64, accel: 210, damage: 16, range: 384, attackDuration: 0.64, activeAt: 0.6, cooldown: 0.9, cost: 20, knockback: 0, scale: 0.8, foot: 128 },
  lancer: { label: 'Lancer', hp: 324, speed: 40, accel: 150, damage: 10, range: 100, attackDuration: 0.5, activeAt: 0.5, cooldown: 1.5, cost: 30, knockback: TILE, scale: 0.8, foot: 190 },
}

/** Boat units are never in the unit list: ships live in `game.boats`. Units aboard are hidden with inTower = BOAT_FLAG + boatId. */
export const BOAT_FLAG = 1_000_000
export type BoatKind = 'boat' | 'zumwalt'
export const BOAT_KINDS: BoatKind[] = ['boat', 'zumwalt']
/**
 * Ships. The boat costs 50 wood and the Zumwalt 300, are built by a pawn in the water beside the owner's shoreline, move at an archer's walking speed
 * over open sea (territory does not matter) and carry units that do not count against the population cap while aboard.
 * Infantry boat: half a warrior's HP, no weapons. Zumwalt: an archer's HP, 15-tile cannons (bursts of two, 0.5 s apart,
 * 3 s between volleys, each shell 2.5× a warrior's damage dropping to 10 % at maximum range).
 */
export const BOAT = { cost: 50, buildTime: 30, hp: UNIT.warrior.hp * 0.5, cap: 5, speed: UNIT.archer.speed, accel: 140, length: 3 * TILE }
export const ZUMWALT = {
  cost: 300, buildTime: 60, hp: UNIT.archer.hp, cap: 8, speed: UNIT.archer.speed, accel: 110, length: 5 * TILE,
  rangeTiles: 15, shots: 2, shotGap: 0.5, volleyGap: 3, damageMult: 2.5, minDamage: 0.1,
  /** Cannon muzzles (px from the sprite centre) for each hull orientation: the cannons sit on one side only (bow up → east, bow down → west,
   *  bow left/right → south; drawn upside down they point north). Measured on the generated sprites. */
  muzzles: { up: [[47, -56], [47, 4]], down: [[-47, -41], [-47, 16]], left: [[-15, 41], [38, 41]], right: [[-55, 42], [8, 42]] } as Record<'up' | 'down' | 'left' | 'right', [number, number][]>,
}
/** A docked ship is a mini town: it claims friendly territory (and supply) around the land it is moored against. */
export const DOCK = {
  radius: 6, weight: 1.6, snapTiles: 1.6, siteShoreTiles: 2,
  time: 5, // seconds a ship must lie beside the coast before it moors (and can unload)
  guardTiles: 2.5, // a hostile unit this close to the mooring spot keeps the ship from landing...
  strikeTiles: 3.2, // ...and melee troops this close to a ship at the shore strike it
}
/** A nation with no towns left may keep this many troops per ship (boat or Zumwalt), up to a cap, so a beaten kingdom can retreat to sea. */
export const RESCUE = { perShip: 2, max: 5 }
/** Zumwalt turn: seconds per quarter turn (it swings its broadside toward the target; it has no cannons on its far side). */
export const TURN = { quarter: 0.7 }
export type ZumFocus = 'ships' | 'buildings' | 'troops'
export const ZUM_FOCUS: ZumFocus[] = ['ships', 'buildings', 'troops']

export const UNIT_BODY = {
  hitRadius: 40,
  separation: 32, // personal space between units
  blockSeparation: 64, // a blocking unit occupies twice the space
  blockReduction: 0.9,
  disengageGrace: 1.2,
  lookAhead: 46,
  arrive: 36,
  waypointTol: 26, // intermediate waypoints count as reached inside this distance
  endTol: 12, // route end counts as reached inside this distance
  maxSquad: 5,
  aggroTiles: 3, // idle melee units (and units just shoved back) chase a hostile this close
  knockbackTime: 0.22, // lancer shove: sharp ease-out glide, never a teleport
  refocusTime: 3,
}

export const CARE = {
  restDistTiles: 5, // no enemy within this many tiles → slow regeneration
  baseRegenPct: 0.004, // of max HP per second (0.4 %; 1 % beside a town)
  townMult: 2.5, // regeneration multiplier at an owned town
  townRadiusTiles: 2, // heal radius and the radius that protects a town from capture
  overcapPct: 0.03,
}

/** Capacity: 3 per town (5 per barracks, +1 per lot). Power income = free capacity (capacity − troops) per second. */
export const POP = { perTown: 3, perBarracks: 5, spawnInterval: 10, startPower: 60, startLumber: 30 }

export type HarvestMode = 'none' | 'low' | 'med' | 'high' | 'unlimited'
export const HARVEST_MODES: HarvestMode[] = ['none', 'low', 'med', 'high', 'unlimited']
/** Pawn tree extraction: chopping speed multiplier and the lumber stock above which pawns stop cutting. */
export const HARVEST: Record<HarvestMode, { label: string; rate: number; cap: number }> = {
  none: { label: 'NONE', rate: 0, cap: 0 },
  low: { label: 'LOW', rate: 0.35, cap: 99 },
  med: { label: 'MED', rate: 1, cap: 300 },
  high: { label: 'HIGH', rate: 2.5, cap: 500 },
  unlimited: { label: 'UNLIMITED', rate: 2.5, cap: Infinity },
}
/** Trees and shrubs only sway when the camera is zoomed in at least this far (and they are on screen). */
export const SWAY_ZOOM = 0.75
/** Tower garrison damage: damageMult× an archer's damage within `closeTiles`, falling off linearly to 1× at maximum range. */
export const TOWER = { cost: 30, buildTime: 30, hpMult: 3, rangeMult: 2, damageMult: 2, closeTiles: 1, garrisonRange: 150, radius: 44, minTownGap: 3 }
/** A lot is a mini town (House3) that adds one unit of capacity to its nearest town. Each town may have one. */
export const LOT = { cost: 200, buildTime: 40, hp: 1800, radius: 40 }
export const SHOT_REACT = { fleeBelow: 0.5, fleeTiles: 7, chaseSeconds: 4, chaseTiles: 9 }
export const REL = { coolAfter: 90, warKills: 2, warAfter: 120, declareChance: 0.12, aiWarKills: 5, aiWarAfter: 360, aiDeclareChance: 0.03, provokeAfter: 150, totalWarCapacityMult: 2, warnSeconds: 5, immediateTiles: 5 }

export const PAWN = {
  speed: 56,
  accel: 280,
  interactRange: 46,
  depositRange: 78,
  conifer: { time: 150, yield: 20 },
  broadleaf: { time: 60, yield: 10 },
  replanEvery: 1.0,
  spriteScale: 0.7,
}

/** Towns have 3× the health of an archer tower (tower hp = 3 warriors) and mend slowly while no hostile unit is near. */
export const TOWN = { captureRadius: 54, hpMult: 3, regenPct: 0.004, regenQuietTiles: 8 }
/** A unit's damage is scaled by max(minFactor, health fraction). */
export const DAMAGE = { minHealthFactor: 0.2 }

export const ROUTE = { sampleDist: 14, rdpTolerance: 7, dragThresholdPx: 6, step: 8 }

export const AI = {
  interval: 1.4, minHold: 4, maxTowers: 5, towerEvery: 18, maxBridges: 4, towerBorderTiles: 4, towerSpacingTiles: 6,
  lastStandHp: 0.35, lastStandRecover: 0.2, readyHp: 0.45, // freshly spawned / wounded units rest until they reach this health fraction
  retreatHp: 0.4, cutOffPatience: 60, // seconds a cut-off assault unit presses on while healthy
  zumReserve: 40, ambushSeconds: 30, blockRushTiles: 16, fleetMinTowns: 4, fleetPerTowns: 3, maxFleet: 5, expandAfter: 420, expandEvery: 90, expandTiles: 90, // AI fleets (large nations) and overseas expansion
  maxBlockSeconds: 25, blockCooldown: 30, garrisonSeconds: 40, // watchdogs: no AI unit stays frozen in a block / hold pose forever
  navyAfter: 150, navyEvery: 25, maxBoats: 2, maxZumwalts: 1, navyReserve: 40, loadSeconds: 45, boatRaidMin: 3, // AI navy: starts after 2.5 min of war, keeps 40 lumber spare
  respondSeconds: 20, grievanceWindow: 25, dashHp: 0.6, dashGuard: 1, warShare: 0.7, totalShare: 0.8, conflictShare: 0.5, quietWarzone: 8,
}
/** Largest starting kingdom by game size: small games stay modest, 6–8 kingdom games can open with 4–5 town powers. */
export const maxStartTowns = (kingdoms: number) => (kingdoms <= 4 ? 3 : kingdoms === 5 ? 4 : 5)
export const START = { unitsPerTown: 2, maxPlayerTowns: 5, maxStartTowns: 5, pawnsPerTown: 2, barracksMinTowns: 4 }

/**
 * Agitation (AI only): how nervous / ready a kingdom is. Percent units; rates are per second.
 * A foreign war takes ~5 minutes to raise nearby nations to 25 % (0.083 %/s) and distant ones to 15 % (0.05 %/s).
 */
export const AGIT = {
  nearTiles: 35, rateNear: 25 / 300, rateFar: 15 / 300, conflictWeight: 0.5, warWeight: 1, totalWeight: 2, decay: 0.1,
  underAttackFloor: 55, spikeNear: 25, spikeFar: 10, spikeNearTiles: 12, spikeFarTiles: 50,
  readyOn: 35, readyOff: 30, reactAbove: 40, reactBase: 0.0002, reactMax: 0.006, earlyPeace: 300, maxWarsDivisor: 3, initialConflicts: 2, initialConflictChance: 0.08,
  tippedShare: 0.4, tippedRate: 0.1, preyTiles: 35, reactCooldown: 240, spillSeconds: 14,
  normalTowers: 3, readyTowers: 5,
}
