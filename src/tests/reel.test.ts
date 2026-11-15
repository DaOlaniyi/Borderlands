import { describe, expect, it } from 'vitest'
import { Game } from '../game/Game'
import { spawnBoat } from '../game/BoatSystem'
import { captureReel, newReel, packReel, ReelPlayer, unpackReel } from '../game/Reel'

const PARAMS = { seed: '9', color: 0, kingdoms: 0, playerTowns: 3 }
const play = (g: Game, reel: ReturnType<typeof newReel>, seconds: number) => { for (let i = 0; i < 25 * seconds; i++) { g.step(1 / 25); if (i % 25 === 24) captureReel(g, reel) } }

describe('the reel (position-recording film)', () => {
  it('records a frame a second, packs to one blob and unpacks to the same numbers', async () => {
    const g = Game.fromSeed(PARAMS.seed, 0, 3, { archipelago: true })
    const reel = newReel(g, PARAMS)
    play(g, reel, 40)
    expect(reel.frames.length).toBe(40)
    expect(reel.snaps.length).toBeGreaterThanOrEqual(7)
    expect(reel.frames[39].units.length).toBeGreaterThan(0)
    const bytes = await packReel(reel)
    const back = await unpackReel(bytes)
    expect(back.frames.length).toBe(40)
    expect(Array.from(back.frames[20].units)).toEqual(Array.from(reel.frames[20].units))
    expect(Array.from(back.snaps[3].ctl)).toEqual(Array.from(reel.snaps[3].ctl))
    expect(back.snaps[3].trees).toEqual(reel.snaps[3].trees)
    expect(back.endT).toBeCloseTo(reel.endT)
    expect(bytes.length).toBeLessThan(reel.frames.length * 40000) // (a compressed frame is far smaller than this)
  }, 120000)

  it('the player rebuilds units, ships, towns and territory, and glides things between two snapshots', async () => {
    const g = Game.fromSeed(PARAMS.seed, 0, 3, { archipelago: true })
    spawnBoat(g, 0, 'cargo', g.towns[0].x + 700, g.towns[0].y + 700)
    const reel = newReel(g, PARAMS)
    play(g, reel, 60)
    const live = { units: g.units.filter(u => u.state !== 'dead' && u.inTower < 0).length, towns: g.towns.filter(t => !t.ruined).length, controller: Array.from(g.controller).filter(Boolean).length }
    const r = Game.fromSeed(PARAMS.seed, 0, 3, { archipelago: true })
    const player = new ReelPlayer(r, await unpackReel(await packReel(reel)), spawnBoat as never)
    player.show(60)
    expect(r.units.length).toBe(live.units)
    expect(r.towns.filter(t => !t.ruined).length).toBe(live.towns)
    expect(Array.from(r.controller).filter(Boolean).length).toBeGreaterThan(0)
    expect(r.boats.some(b => b.kind === 'cargo')).toBe(true)
    // between two snapshots a moving unit is between its two recorded positions
    const A = reel.frames[30], B = reel.frames[31]
    let checked = 0
    for (let i = 0; i < A.units.length && checked < 5; i += 7) {
      const j = Array.from({ length: B.units.length / 7 }, (_, n) => n * 7).find(n => B.units[n] === A.units[i])
      if (j === undefined || (A.units[i + 1] === B.units[j + 1] && A.units[i + 2] === B.units[j + 2])) continue
      player.show(A.t + 0.5)
      const u = r.units.find(q => q.id === A.units[i])!
      expect(u.x).toBeGreaterThanOrEqual(Math.min(A.units[i + 1], B.units[j + 1]) - 1); expect(u.x).toBeLessThanOrEqual(Math.max(A.units[i + 1], B.units[j + 1]) + 1)
      expect(u.x).toBeCloseTo((A.units[i + 1] + B.units[j + 1]) / 2, 0)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
    // scrubbing back to an earlier moment shows the earlier state (fewer or equal towns/units are not guaranteed, but time must follow)
    player.show(10); expect(r.time).toBeCloseTo(10)
  }, 180000)
})
