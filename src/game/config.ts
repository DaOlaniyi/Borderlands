// Central tuning. Everything gameplay-relevant lives here so it can be changed in one place.
import { COLOR_COUNT, PALETTE, darkOf, hexRgb } from './Palette'
export const TILE = 64
export const SIM_HZ = 25
export const SIM_DT = 1 / SIM_HZ
export const MAX_FRAME_DT = 0.25

// The world is an archipelago on a MAP.size × MAP.size grid (see WorldGenerator.generateArchipelago). The single-island generator
// (generateWorld) is kept for tests and small experiments: its island is MAP.minSize..maxSize tiles wide inside `pad` tiles of ocean.
export const MAP = { minSize: 56, maxSize: 84, pad: 30, chunk: 8, size: 300, core: 200 }
/** Islands grow with the kingdom count: 5–8 kingdoms get 40 / 55 / 70 / 85 % more land area than a 1–4 kingdom game (so room for 3–5 towns each). */
export const islandAreaBonus = (kingdoms: number) => (kingdoms <= 4 ? 0 : 0.4 + 0.15 * (Math.min(kingdoms, 8) - 5))
export const islandScale = (kingdoms: number) => Math.sqrt(1 + islandAreaBonus(kingdoms)) // linear scale of each side

/** The player plus up to 19 AI kingdoms (one per palette colour); a new game starts with DEFAULT_KINGDOMS.min..max of them. */
export const MAX_KINGDOMS = COLOR_COUNT
export const DEFAULT_KINGDOMS = { min: 10, max: 15 }
/** A new game fills the map to this many kingdoms: the seed's 10-15 on the original 200x200 core, the rest on the outer ring. */
export const TOTAL_KINGDOMS = 20
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

export type UnitType = 'warrior' | 'archer' | 'lancer' | 'knight'
export const UNIT_TYPES: UnitType[] = ['warrior', 'archer', 'lancer', 'knight']
export type UnitStats = { label: string; hp: number; speed: number; accel: number; damage: number; range: number; attackDuration: number; activeAt: number; cooldown: number; cost: number; knockback: number; scale: number; foot: number }
/** Speeds are px/s (64 px = 1 tile): warrior 5 tiles / 10 s, archer 5 tiles / 5 s, lancer in between, knight 1.5x an archer (5 tiles / 3.3 s). */
export const UNIT: Record<UnitType, UnitStats> = {
  warrior: { label: 'Warrior', hp: 900, speed: 32, accel: 130, damage: 38.4, range: 70, attackDuration: 0.56, activeAt: 0.5, cooldown: 0.7, cost: 40, knockback: 0, scale: 0.8, foot: 128 },
  archer: { label: 'Archer', hp: 225, speed: 64, accel: 210, damage: 16, range: 384, attackDuration: 0.64, activeAt: 0.6, cooldown: 0.9, cost: 20, knockback: 0, scale: 0.8, foot: 128 },
  // Knight: the mounted striker, for quick responses and rapid advances. Costs as much as a warrior and runs 1.5x an archer's speed. To pay for that it hits 2x as hard as a
  // warrior (about 2x the damage per second) with under half the hull: it runs archers and lancers down, and a straight fight against an equal-cost warrior is close but
  // goes to the warrior (and it dies fast if it is caught, so use the speed to choose the fight).
  knight: { label: 'Knight', hp: 420, speed: 96, accel: 260, damage: 80, range: 84, attackDuration: 0.6, activeAt: 0.6, cooldown: 0.75, cost: 40, knockback: 0, scale: 0.8, foot: 146 }, // (12-frame thrust: the lance lands at frame 7; the cycle is still 1.35 s; the hooves sit on row 146 of the frame)
  lancer: { label: 'Lancer', hp: 324, speed: 40, accel: 150, damage: 10, range: 100, attackDuration: 0.5, activeAt: 0.5, cooldown: 1.5, cost: 30, knockback: TILE, scale: 0.8, foot: 190 },
}

/** Boat units are never in the unit list: ships live in `game.boats`. Units aboard are hidden with inTower = BOAT_FLAG + boatId. */
export const BOAT_FLAG = 1_000_000
export type BoatKind = 'boat' | 'zumwalt' | 'cargo' | 'gunship' | 'barge'
export const BOAT_KINDS: BoatKind[] = ['boat', 'zumwalt', 'cargo', 'gunship', 'barge']
export const SHIP_NAME: Record<BoatKind, string> = { boat: 'boat', zumwalt: 'Zumwalt', cargo: 'cargo boat', gunship: 'gunship', barge: 'barge' }
/** Resources a region (a home kingdom or a settlement) can hold. */
export type Stock = { lumber: number; gold: number; meat: number }
/**
 * Ships. The boat costs 50 wood and the Zumwalt 300, are built by a pawn in the water beside the owner's shoreline, move at an archer's walking speed
 * over open sea (territory does not matter) and carry units (which still count against the population cap while aboard, so landing never leaves a nation over capacity).
 * Infantry boat: half a warrior's HP, no weapons. Zumwalt: an archer's HP, 24-tile cannons (twice an archer tower's reach) (bursts of two, 0.5 s apart,
 * 3 s between volleys, each shell 2.5× a warrior's damage dropping to 10 % at maximum range).
 */
export const BOAT = { cost: 50, buildTime: 30, hp: UNIT.warrior.hp * 0.5, cap: 10, speed: UNIT.archer.speed, accel: 140, length: 3 * TILE }
/**
 * Barge: the landing craft, the nation's tool for invading across the sea (infantry boats ferry troops between a nation's own lands). 100 lumber, 12 units,
 * the ramp at its bow. It moors in 6 s, and nothing stops it: enemy fire does not interrupt the mooring and troops standing on the beach cannot hold it off;
 * on landing it shoves every hostile unit within `shoveTiles` back out of the way so the troops can walk off. Land units do only 30 % damage to it; ships hit it in full.
 */
export const BARGE = { cost: 100, buildTime: 40, hp: 700, cap: 12, speed: UNIT.archer.speed * 0.85, accel: 120, length: 3.4 * TILE, dockTime: 6, landDamage: 0.3, shoveTiles: 6, dockRadius: 9, dockWeight: 2.6 }
export const ZUMWALT = {
  cost: 300, buildTime: 60, hp: UNIT.warrior.damage * 2.5 * 12, cap: 8, // 12 direct hits from another Zumwalt (96 each) = 32 gunship hits (36 each)
  speed: UNIT.archer.speed * 0.95, accel: 110, length: 5 * TILE, // (5 % slower: the gunships can just about keep up)
  rangeTiles: (UNIT.archer.range * 2 * 2) / TILE, shots: 2, shotGap: 0.5, volleyGap: 3, damageMult: 2.5, minDamage: 0.1,
  fireBelow: 0.15, fireSeconds: 30, // a Zumwalt under 15 % hull burns for 30 s (cosmetic); naval fire sets it burning again
  villageMult: 3, // ...and towns ('villages') three times harder again (settlements keep their 50 % ship resistance)
  buildingMult: 4, // shells hit buildings (towers, lots, towns) four times as hard
  directBase: 0.9, directFar: 0.4, // chance a shell lands exactly on its target: 90 % up close, 40 % at maximum range (about 60 % overall)
  spreadTiles: 8, // a miss lands anywhere inside a circle that grows from nothing to this radius at maximum range
  splashTiles: 3, splashMult: 0.7, splashKnock: 1.1 * TILE, // splash radius, its share of the shell's damage (fading with distance) and the shove it gives troops
  lockSeconds: 4, // time to lock onto a new target (a busy ship can be ambushed)
  /** Cannon muzzles (px from the sprite centre), three to a flank, for each hull orientation and the flank that fires. The ship carries guns on both
   *  flanks, so it simply fires from whichever side faces the target: a hull seen from above (bow up/down) shoots east or west, one seen from the
   *  side (bow left/right) shoots south (the flank the sprite shows) or north (the far one, whose muzzles sit along the hull's top edge). It
   *  only turns, a quarter at a time, when the target lies off both of its flanks. Measured on the generated "Version 2" sprites. */
  muzzles: {
    up: { E: [[49, -53], [49, 0], [49, 54]], W: [[-50, -53], [-50, 0], [-50, 54]] },
    down: { E: [[51, -54], [51, 0], [51, 52]], W: [[-53, -54], [-53, 0], [-53, 52]] },
    left: { S: [[-51, 51], [9, 51], [71, 51]], N: [[-51, -38], [9, -38], [71, -38]] },
    right: { S: [[-79, 47], [-16, 47], [48, 47]], N: [[-79, -34], [-16, -34], [48, -34]] },
  } as Record<'up' | 'down' | 'left' | 'right', Partial<Record<'N' | 'E' | 'S' | 'W', [number, number][]>>>,
}
/** One max-strength Zumwalt shell (point blank, against troops). */
export const SHELL_MAX = UNIT.warrior.damage * ZUMWALT.damageMult
/** Cargo boat: carries resources between regions. Two Zumwalt volleys (four full shells) sink it; seven gunship hits do too. */
export const GUNSHIP_DAMAGE = 36
export const CARGO = { cost: 20, buildTime: 20, hp: GUNSHIP_DAMAGE * 7, cap: { lumber: 100, gold: 10, meat: 30 } as Stock, speed: UNIT.archer.speed * 1.1, accel: 140, length: 1.5 * TILE, loadEvery: 1.2, loadAmount: { lumber: 20, gold: 2, meat: 5 } as Stock, floatSeconds: 180 }
/** Gunship: a pirate vessel. 10 % slower than a cargo boat (it ambushes, it cannot chase), 1.5× its health, 11-tile guns, ships only. */
export const GUNSHIP = { cost: 60, buildTime: 30, hp: CARGO.hp * 1.5, cap: 0, speed: UNIT.archer.speed * 0.9, accel: 130, length: 2 * TILE, rangeTiles: 11, damage: GUNSHIP_DAMAGE, cooldown: 1.5 }
export const shipLength = (k: BoatKind) => (k === 'zumwalt' ? ZUMWALT.length : k === 'cargo' ? CARGO.length : k === 'gunship' ? GUNSHIP.length : k === 'barge' ? BARGE.length : BOAT.length)
export const SHIP_KINDS_ARMED: BoatKind[] = ['zumwalt', 'gunship']

/** A docked ship is a mini town: it claims friendly territory (and supply) around the land it is moored against. */
export const DOCK = {
  radius: 6, weight: 1.6, snapTiles: 1.6, siteShoreTiles: 2,
  time: 5, // seconds a ship must lie beside the coast before it moors (and can unload)
  lifetime: 120, // a moored ship's friendly territory lasts two minutes, then it must redock (settlements are the lasting claim)
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
  blockReduction: 0.6, // a blocking unit takes 40 % of the damage (lancers get no protection at all)
  archerBoatRange: 1.5, // archers shoot ships from 1.5x their normal range
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

/** A felled tree grows back after 15-25 minutes (a different delay for each tree), so lumber never runs out for good. */
export const REGROW = { min: 900, spread: 600, retry: 60 }

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
  lastStandHp: 0.2, lastStandRecover: 0.2, readyHp: 0.45, // (readyHp: 'fit enough' for odd jobs such as rushing a beach)
  retreatBelow: 0.1, restUntil: 0.85, freshRestUntil: 0.5, // a unit pulls back to heal only when nearly dead (below 10 %), and then heals to 85 % (new recruits to 50 %) before it returns; pushing at a town with the upper hand it never pulls back
  retreatHp: 0.2, cutOffPatience: 60, // seconds a cut-off assault unit presses on while healthy
  zumReserve: 40, ambushSeconds: 30, blockRushTiles: 16, fleetMinTowns: 3, fleetPerTowns: 3, maxFleet: 5, expandAfter: 150, expandEvery: 45, expandTiles: 90, // AI fleets (large nations) and overseas expansion
  maxBlockSeconds: 25, blockCooldown: 30, garrisonSeconds: 40, // watchdogs: no AI unit stays frozen in a block / hold pose forever
  navyAfter: 45, navyEvery: 8, maxBoats: 3, // (an invasion wave is 1-3 full infantry boats)
   commitMin: 0.5, commitMax: 0.9, minForce: 4, maxZumwalts: 1, navyReserve: 40, loadSeconds: 20, boatRaidMin: 3, // AI navy: starts after 2.5 min of war, keeps 40 lumber spare
  edge: 1.3, warStall: 150, navyShareAtLandWar: 0.3, farLandTiles: 28, respondSeconds: 20, grievanceWindow: 25, dashHp: 0.6, dashGuard: 1, warShare: 0.7, totalShare: 0.8, conflictShare: 0.5, quietWarzone: 8,
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

/**
 * AI temperament. `aggression` (0..1) feeds the older war/expansion dice; `reactMult` scales the agitation-driven chance to strike,
 * `reactFrom` is the agitation above which that chance applies, `unprovoked` is an extra per-second chance to pick a fight with no
 * agitation at all, `prey` is the odds of choosing a weaker neighbour once it acts (pacifists never do) and `smallBias` favours
 * smaller targets. Retaliation against attackers is not affected: every temperament fights back.
 */
export type Temperament = 'pacifist' | 'neutral' | 'imperialist'
export const TEMPERAMENTS: Temperament[] = ['pacifist', 'neutral', 'imperialist']
export const TEMPER: Record<Temperament, { aggression: [number, number]; reactMult: number; reactFrom: number; unprovoked: number; prey: number; reach: number }> = {
  pacifist: { aggression: [0.21, 0.3], reactMult: 0.25, reactFrom: 40, unprovoked: 0, prey: 0, reach: 0 },
  neutral: { aggression: [0.3, 0.6], reactMult: 1, reactFrom: 40, unprovoked: 0, prey: 0.5, reach: 1 },
  imperialist: { aggression: [0.9, 1], reactMult: 4, reactFrom: 0, unprovoked: 0.004, prey: 1, reach: 1.5 },
}
/** Mix for AI kingdoms: 30 % pacifist, 25 % imperialist, the rest neutral (every game has at least one imperialist). */
export const TEMPER_MIX = { pacifist: 0.4, imperialists: [4, 6] as [number, number] } // of the rest, 40 % are pacifist; a game has 4-6 imperialists (never more than half the AI nations)

/**
 * Meat. Each town keeps one sheep: every `period` seconds it is ripe, a pawn walks to it, strikes it a few times and carries `yield` meat home
 * (the sheep regrows). A settlement eats `eat` meat per `eatPeriod` seconds out of a store of `store`; with no meat (or no troops) it decays.
 */
export const MEAT = { period: 300, yield: 5, eat: 5, eatPeriod: 600, store: 20, hits: 3, hitGap: 0.55, startStock: 5, perTown: 5, sheepHideZoom: 0.3 }
/** Settlements: mini towns founded on a landmass the kingdom does not yet reach. They can never be captured, only destroyed. */
/** A settlement is fragile: `hp` per level (100 / 200 / 300), so a landing party razes it in seconds. AI nations keep `garrison` troops beside it per level. */
export const SETTLE = {
  cost: 100, upgradeCost: [200, 450], upgradeGold: [0, 5], // lumber (and gold) to reach level 2 and level 3, paid out of the settlement's own store
  hp: 100, decaySeconds: 120, troopTiles: 6, minTownGapTiles: 8, landTiles: 3,
  radius: [6, 10, 13], weight: [2, 2.5, 3], cap: [2, 6, 10], pawns: [1, 3, 5], maxLevel: 3, shipLevel: 3, // ships can be laid down beside a level 3 settlement
  crateOffset: [60, 40, 40], shipResist: 0.5, repairPawns: 5, repairPerPawn: 40, repairWindow: 6, // ships do half damage; up to 5 pawns mend 40 hp/s each while it is under fire
}
/** Gold: nuggets are scattered everywhere, bigger veins on uninhabited islands, and rare jackpots. Harvesting takes longer than lumber. */
export const GOLD = {
  time: 30, // seconds a pawn works for each piece of gold (every stone: one piece, always 1 gold)
  reserve: [0, 1, 2, 8, 16, 28, 45], // pieces held by each stone number; stone 6 is rolled between `largeRange` instead; a large stone shrinks (6 → 5 → 4 ...) as it is mined
  largeRange: [40, 50], // a stone 6 holds 40-50 gold: 1200-1500 s of mining for one pawn
  jackpotEvery: [2, 4], uninhabitedPerIsland: 3,
}
export const goldTier = (reserve: number): 1 | 2 | 3 | 4 | 5 | 6 => (reserve >= 36 ? 6 : reserve >= 22 ? 5 : reserve >= 12 ? 4 : reserve >= 5 ? 3 : reserve >= 2 ? 2 : 1)
/**
 * Shipyards and the naval budget. A yard is free; it opens a stretch of coast `zoneTiles` either side of it (a 10-tile white line) where ships may be
 * laid down, and one yard hosts at most `zumwaltsPerYard` (5) Zumwalts. Each town supports one gunboat; an upgraded (level 2) town, or a barracks, adds two more gunboats OR one Zumwalt
 * (a Zumwalt costs 2 points, a gunboat 1). A level 3 settlement supports one gunboat. Infantry and cargo boats are not counted (they need the yard line only).
 */
export const YARD = { zoneTiles: 10, anchorGap: 4, townReach: 16, townPoints: 1, upgradePoints: 2, zumwaltPoints: 2, gunshipPoints: 1, settlementPoints: 1, zumwaltsPerYard: 5, holdingsPerYard: 4 }

/** Town levels: 10 gold lifts a town to level 2: more influence (a bigger territory with more trees), 5 units, and naval slots (see NAVY). */
export const TOWN_LEVEL = { upgradeGold: 10, radiusBonus: 5, weightBonus: 1.3, cap: [3, 5], maxLevel: 2, hpBonus: 1.4 }

/** Fog of war: land masses nobody started on are hidden from the player until explored. Units see `visionTiles` around them; friendly territory is always seen; a settlement (anyone's) reveals its whole island for good. */
export const FOG = { visionTiles: 5, updateEvery: 5 }

/**
 * Outpost: a stake planted for 100 power (no build time) that gives a half-strength friendly buffer around it, for COMBAT ONLY: units standing
 * there are supplied (not cut off), but pawns cannot gather or build in it. It has 1 hp, so any hostile land unit destroys it with a single
 * strike; archer towers cannot shoot it. The AI lays them as its armies advance, so a column can follow a trail into new land.
 */
export const OUTPOST = { cost: 100, radius: 4, weight: 1.3, hp: 1, max: 14, reachTiles: 4, gapTiles: 3, aiReserve: 40, aiEvery: 6 }
