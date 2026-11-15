import { describe, expect, it } from 'vitest'
import { TILE, TEMPER_MIX } from '../game/config'
import { Game } from '../game/Game'
import { spawnBoat, orderSail, undock } from '../game/BoatSystem'
import type { Game as GameT } from '../game/Game'
import { placeSettlement, townLabel } from '../game/Economy'
import { manageGarrisons } from '../game/Garrison'
import { manageNavalForces, escortNeed } from '../game/NavyAI'
import { writeLetter, onRelationChange } from '../game/Letters'
import { Recorder } from '../game/Recorder'
import { parseRecording, serializeRecording, serializeGame, restoreGame } from '../game/SaveLoad'
import { makeGame, stepN, withYards } from './helpers'

const px = (c: number) => (c + 0.5) * TILE
// a west island (kingdom 0), a neutral middle island and an east island (kingdom 1) with sea between
const rows = Array.from({ length: 40 }, () => '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(30) + '.'.repeat(10) + '#'.repeat(20))
/** Kingdom `k` has a troop and a moored cargo boat on the middle island, so it may plant a settlement there. */
function withLanding(g: GameT, k: number) {
  g.kingdoms[k].lumber = 500
  const cargo = spawnBoat(g, k, 'cargo', px(31), px(10)); undock(g, cargo); cargo.x = cargo.px = px(39); cargo.y = cargo.py = px(20); cargo.vx = cargo.vy = 0; cargo.route = []; cargo.docking = false
  orderSail(g, cargo, [px(39), px(20)])
  stepN(g, 25 * 8)
  g.spawnUnit(k, px(41), px(20)); stepN(g, 3)
}

describe('colony names', () => {
  it('a settlement is "X of <nation>", follows a renamed nation, and only its owner can rename it', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 95, 20]], units: [], relation: 'neutral' })
    withLanding(g, 0)
    const s = placeSettlement(g, 0, px(50), px(20))!
    expect(s).toBeTruthy()
    expect(townLabel(g, s)).toBe(`${s.name} of ${g.kingdoms[0].name}`)
    g.renameKingdom(0, 'Newlands'); expect(townLabel(g, s)).toBe(`${s.name} of Newlands`)
    g.renameTown(s.id, 'Fort Pelican'); expect(townLabel(g, s)).toBe('Fort Pelican')
    g.renameTown(s.id, ''); expect(townLabel(g, s)).toBe(`${s.name} of Newlands`) // empty name restores the default
    s.owner = 1; g.renameTown(s.id, 'Stolen'); expect(s.name).not.toBe('Stolen') // not the player's: no rename
  })
})

describe('imperialist share', () => {
  it('80 % of the AI nations are imperialists in an archipelago game', () => {
    const g = Game.fromSeed(11, 0, 3, { archipelago: true })
    const ai = g.kingdoms.filter(k => !k.isPlayer)
    expect(ai.filter(k => k.temperament === 'imperialist').length).toBe(Math.round(ai.length * TEMPER_MIX.imperialShare))
  }, 60000)
})

describe('garrison posts', () => {
  it('a nation of 6+ towns posts 1-2 troops at a border town; a small one posts none; a settlement is always guarded', () => {
    const towns: [number, number, number][] = [[0, 3, 3], [1, 5, 20], [1, 9, 20], [1, 13, 20], [1, 5, 25], [1, 9, 25], [1, 13, 25], [2, 28, 22]]
    const g = makeGame({ rows: Array.from({ length: 40 }, () => '#'.repeat(40)), towns, units: Array.from({ length: 16 }, (_, i) => [1, 6 + (i % 8), 22 + Math.floor(i / 8)] as [number, number, number]), relation: 'neutral' })
    expect(g.ownedTowns(1)).toBe(6)
    const mine = g.units.filter(u => u.faction === 1)
    manageGarrisons(g, 1, mine, [])
    const posted = mine.filter(u => u.aiRole === 'post')
    expect(posted.length).toBeGreaterThan(0)
    expect(posted.length).toBeLessThanOrEqual(Math.ceil(mine.length * 0.34))
    const perTown = new Map<number, number>(); for (const u of posted) perTown.set(u.post!, (perTown.get(u.post!) ?? 0) + 1)
    for (const n of perTown.values()) expect(n).toBeLessThanOrEqual(2)
    for (const id of perTown.keys()) expect(g.towns[id].owner).toBe(1)
    // a 3-town nation does none of this
    const h = makeGame({ rows: Array.from({ length: 40 }, () => '#'.repeat(40)), towns: [[1, 5, 20], [1, 9, 20], [1, 13, 20], [2, 28, 22]], units: [[1, 6, 22], [1, 7, 22], [1, 8, 22], [1, 9, 22]], relation: 'neutral' })
    const m2 = h.units.filter(u => u.faction === 1); manageGarrisons(h, 1, m2, [])
    expect(m2.some(u => u.aiRole === 'post')).toBe(false)
  })
  it('posted troops stay posted for minutes (the hold watchdog no longer sends them away)', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 95, 20]], units: [], ai: true, relation: 'neutral' })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    withLanding(g, 1)
    for (const dx of [1, 2, 3]) g.spawnUnit(1, px(41 + dx), px(21))
    const s = placeSettlement(g, 1, px(50), px(20))!
    g.time = 200; stepN(g, 25 * 30)
    const mine = g.units.filter(u => u.faction === 1 && g.info.landmass[g.cellAt(u.x, u.y)] === s.land)
    expect(mine.filter(u => u.aiRole === 'post').length).toBeGreaterThanOrEqual(2)
    stepN(g, 25 * 150)
    expect(g.towns[s.id].owner).toBe(1)
    expect(g.units.filter(u => u.faction === 1 && u.aiRole === 'post' && Math.hypot(u.x - s.x, u.y - s.y) < 8 * TILE).length).toBeGreaterThanOrEqual(2)
  })
})

describe('Zumwalt squads', () => {
  it('each gunship is bonded to one Zumwalt, at most three per Zumwalt, and the bond survives', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 34, 20]], units: [], relation: 'neutral' })
    withYards(g, 1)
    const zs = [0, 1].map(i => spawnBoat(g, 1, 'zumwalt', px(33), px(10 + i * 6)))
    const gs = Array.from({ length: 7 }, (_, i) => spawnBoat(g, 1, 'gunship', px(35), px(8 + i * 3)))
    manageNavalForces(g, 1, null, g.towns.filter(t => t.owner === 1))
    for (const z of zs) expect(gs.filter(b => b.escortOf === z.id).length).toBe(3)
    expect(gs.filter(b => b.escortOf === -1).length).toBe(1) // the spare one hunts and patrols
    const before = gs.map(b => b.escortOf)
    manageNavalForces(g, 1, null, g.towns.filter(t => t.owner === 1))
    expect(gs.map(b => b.escortOf)).toEqual(before)
    zs[0].hp = 0; g.boats = g.boats.filter(b => b !== zs[0])
    manageNavalForces(g, 1, null, g.towns.filter(t => t.owner === 1))
    expect(gs.filter(b => b.escortOf === zs[1].id).length).toBe(3) // the orphans join the other Zumwalt only as far as it has room
    expect(gs.filter(b => b.escortOf === -1).length).toBe(4)
  })
})

describe('Zumwalts in a narrow strait', () => {
  it('an AI Zumwalt passes a channel between two hostile coasts instead of being turned back by the shoreline rule', () => {
    // two hostile shores 5 tiles apart: every water cell is within 13 tiles of hostile land
    const strait = Array.from({ length: 30 }, (_, y) => (y < 12 ? '#'.repeat(120) : y < 17 ? '.'.repeat(120) : '#'.repeat(120)))
    const g = makeGame({ rows: strait, towns: [[0, 5, 5], [1, 5, 25], [2, 110, 5]], units: [], relation: 'war' })
    g.diplomacy.set(0, 2, 'neutral', 0)
    const z = spawnBoat(g, 1, 'zumwalt', px(10), px(14)); z.noDock = true
    expect(orderSail(g, z, [px(100), px(14)])).toBe(true)
    stepN(g, 25 * 120)
    expect(z.x / TILE).toBeGreaterThan(85)
  }, 60000)
})

describe('letters', () => {
  it('a declaration of war between two AI kingdoms writes a letter in the writer\'s voice, and letters are rate limited', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 85, 20], [2, 60, 5]], units: [], relation: 'neutral' })
    g.kingdoms[1].temperament = 'imperialist'; g.time = 100
    onRelationChange(g, { a: 1, b: 2, prev: 'neutral', next: 'war' })
    expect(g.letters.length).toBe(1)
    expect(g.letters[0]).toMatchObject({ from: 1, to: 2, kind: 'declare' })
    expect(g.letters[0].text).toContain(g.kingdoms[2].name)
    writeLetter(g, 1, 2, 'insult'); expect(g.letters.length).toBe(1) // too soon after the last one
    g.time = 200; writeLetter(g, 1, 0, 'insult'); expect(g.letters.length).toBe(1) // never to or from the player
    g.time = 200; writeLetter(g, 1, 2, 'insult'); expect(g.letters.length).toBe(2)
  })
})

describe('recording', () => {
  it('captures a frame every 10 s with towns, units, ships and events, and round-trips through the save format', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 85, 20]], units: [[0, 21, 20], [1, 84, 20]], relation: 'neutral' })
    spawnBoat(g, 0, 'cargo', px(35), px(20))
    stepN(g, 25 * 35)
    const d = g.rec.data
    expect(d.frames.length).toBeGreaterThanOrEqual(3)
    expect(d.frames[1].t - d.frames[0].t).toBeGreaterThanOrEqual(9)
    const f = d.frames[d.frames.length - 1]
    expect(f.towns.length).toBe(8); expect(f.units.length).toBeGreaterThanOrEqual(6); expect(f.boats.length).toBe(3)
    const back = parseRecording(serializeRecording(g))
    expect(back.frames.length).toBe(d.frames.length)
    expect(Array.from(back.frames[2].units)).toEqual(Array.from(d.frames[2].units))
    expect(back.w).toBe(d.w)
  })
  it('a restored game carries on recording where it left off, and the recording is not inside the save data', () => {
    const g = Game.fromSeed(7, 0, 3, { archipelago: true })
    for (let i = 0; i < 25 * 45; i++) g.step(1 / 25)
    const n = g.rec.data.frames.length
    expect(n).toBeGreaterThanOrEqual(4)
    const json = serializeGame(g)
    expect(json.length).toBeLessThan(40e6)
    const r = restoreGame({ seed: '7', color: 0, kingdoms: 0, playerTowns: 3 } as never, json, serializeRecording(g))
    expect(r.rec.data.frames.length).toBe(n)
    for (let i = 0; i < 25 * 25; i++) r.step(1 / 25)
    expect(r.rec.data.frames.length).toBeGreaterThan(n)
    void Recorder
  }, 120000)
})

describe('settlement archer towers', () => {
  it('a settlement may have at most 2 archer towers, and an AI nation builds them from the settlement\'s own store', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 95, 20]], units: [], pawns: true, ai: true, relation: 'neutral' })
    for (const k of g.kingdoms) k.produce = { warrior: false, archer: false, lancer: false, knight: false }
    withLanding(g, 1)
    for (const dx of [1, 2, 3]) g.spawnUnit(1, px(41 + dx), px(21))
    const s = placeSettlement(g, 1, px(50), px(20))!
    expect(g.structureError('tower', 1, px(53), px(20))).toMatch(/level 2/)  // level 1: no archer towers
    s.level = 2; s.store!.lumber = 200
    g.time = 100
    stepN(g, 25 * 150)
    const towers = g.towers.filter(t => t.kind === 'tower' && t.town === s.id)
    expect(towers.length).toBe(2)
    stepN(g, 25 * 60)
    expect(g.towers.filter(t => t.kind === 'tower' && t.town === s.id).length).toBe(2) // never a third
    s.store!.lumber = 500
    expect(g.structureError('tower', 1, s.x + 4 * TILE, s.y)).toMatch(/at most 2 archer towers|Too close|inside your territory/)
  }, 120000)
})

describe('Zumwalt escort need and hunting', () => {
  it('escorts wanted depend on who waits there: none for a lone gunship, more for a pair, the squad for a Zumwalt', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 95, 20], [2, 60, 5]], units: [], relation: 'war' })
    g.diplomacy.set(1, 2, 'neutral', 0)
    const at = { x: px(35), y: px(20) }
    expect(escortNeed(g, 1, at.x, at.y)).toBe(0)
    spawnBoat(g, 0, 'gunship', px(34), px(20)); expect(escortNeed(g, 1, at.x, at.y)).toBe(0)       // a lone gunship: a Zumwalt can deal with it alone
    expect(escortNeed(g, 1, at.x, at.y, 0.4)).toBeGreaterThanOrEqual(1)                              // ...unless it is hurt
    spawnBoat(g, 0, 'gunship', px(34), px(22)); expect(escortNeed(g, 1, at.x, at.y)).toBe(2)
    spawnBoat(g, 0, 'gunship', px(34), px(24)); expect(escortNeed(g, 1, at.x, at.y)).toBe(3)
    expect(escortNeed(g, 1, px(2), px(2))).toBe(0)                                                    // nobody there
  })
  it('a Zumwalt with no escort at all goes after a lone enemy gunship that is raiding its nation\'s cargo boat', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 95, 20]], units: [], relation: 'war' })
    withYards(g, 1)
    const z = spawnBoat(g, 1, 'zumwalt', px(35), px(12)); z.noDock = true
    const cargo = spawnBoat(g, 1, 'cargo', px(36), px(28)); cargo.noDock = true
    const raider = spawnBoat(g, 0, 'gunship', px(38), px(30)); raider.noDock = true
    raider.target = { kind: 'boat', id: cargo.id, x: cargo.x, y: cargo.y } as never
    g.time = 100
    manageNavalForces(g, 1, null, g.towns.filter(t => t.owner === 1))
    expect(z.strike?.kind).toBe('boat')
    expect(z.strike?.id).toBe(raider.id)
  })
  it('an enemy Zumwalt is only hunted with escorts', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 95, 20]], units: [], relation: 'war' })
    withYards(g, 1)
    const z = spawnBoat(g, 1, 'zumwalt', px(35), px(12)); z.noDock = true
    const enemy = spawnBoat(g, 0, 'zumwalt', px(38), px(20)); enemy.noDock = true
    g.time = 100
    manageNavalForces(g, 1, null, g.towns.filter(t => t.owner === 1))
    expect(z.strike).toBeNull()
  })
})

describe('settlement cost', () => {
  it('lumber landed by the moored cargo boat pays for a settlement (the home stockpile may be empty); the boat pays first', () => {
    const g = makeGame({ rows, towns: [[0, 20, 20], [1, 95, 20]], units: [], relation: 'neutral' })
    withLanding(g, 0)
    g.kingdoms[0].lumber = 0
    const cargo = g.boats.find(b => b.kind === 'cargo' && b.faction === 0)!
    expect(cargo.docked).toBe(true)
    expect(g.structureError('settlement', 0, px(50), px(20))).toMatch(/Needs 100 lumber/)       // nothing at home, nothing aboard
    cargo.load.lumber = 60
    expect(g.structureError('settlement', 0, px(50), px(20))).toMatch(/Needs 100 lumber/)       // 60 is not enough
    cargo.load.lumber = 100
    expect(g.structureError('settlement', 0, px(50), px(20))).toBeNull()                         // 100 aboard is enough
    cargo.load.lumber = 70; g.kingdoms[0].lumber = 40
    const s = placeSettlement(g, 0, px(50), px(20))!
    expect(s).toBeTruthy()
    expect(g.kingdoms[0].lumber).toBe(10)                                                          // the boat's 70 went first, 30 came from home
    expect(s.store!.lumber).toBe(0)                                                                // nothing was left aboard to unload
  })
})
