import { describe, expect, it } from 'vitest'
import { Game } from '../game/Game'
import { applyInput, inputCursor, keyBefore, keyText, packFilm, recordInputs, stepFilm, unpackFilm } from '../game/Film'
import { applySave, serializeGame } from '../game/SaveLoad'

const PARAMS = { seed: '9', color: 0, kingdoms: 0, playerTowns: 3 }

describe('the film (literal replay)', () => {
  it('replaying from a keyframe with the logged commands reproduces the live game exactly', async () => {
    const g = Game.fromSeed(PARAMS.seed, 0, 3, { archipelago: true })
    g.rec.startFilm(PARAMS, serializeGame)
    const cmd = recordInputs(g)
    const mine = () => g.units.filter(u => u.faction === 0 && u.state !== 'dead')
    for (let tick = 0; tick < 25 * 100; tick++) {
      g.step(1 / 25)
      g.rec.keyTick(g)
      if (tick === 200) { const u = mine()[0]; cmd.orderMoveTo(u, u.x + 400, u.y + 150) }          // a player order
      if (tick === 900) { cmd.setHarvest(0, 'high') }
      if (tick === 1500) { cmd.selection = { kind: 'units', ids: mine().slice(0, 3).map(u => u.id) }; cmd.stopSelected() }
    }
    const film = g.rec.film!
    expect(film.keys.length).toBeGreaterThanOrEqual(3)
    expect(film.inputs.map(i => i.m)).toEqual(expect.arrayContaining(['orderMoveTo', 'setHarvest', '$set:selection', 'stopSelected']))
    const live = serializeGame(g)
    // watch it back: restore the last keyframe at or before 60 s and run the real simulation forward to the same tick
    const k = keyBefore(film, 60)!
    expect(k.t).toBeLessThanOrEqual(60)
    const r = Game.fromSeed(PARAMS.seed, 0, 3, { archipelago: true })
    r.rec.disabled = true
    applySave(r, await keyText(k))
    const cur = { i: inputCursor(film, k.tick) }
    stepFilm(r, film, cur, g.tickCount - k.tick)
    expect(r.tickCount).toBe(g.tickCount)
    expect(serializeGame(r)).toBe(live)
    void applyInput
  }, 240000)

  it('packs to one binary blob and back, keeping keyframes and commands', async () => {
    const g = Game.fromSeed(PARAMS.seed, 0, 3, { archipelago: true })
    g.rec.startFilm(PARAMS, serializeGame)
    const cmd = recordInputs(g)
    for (let tick = 0; tick < 25 * 65; tick++) { g.step(1 / 25); g.rec.keyTick(g); if (tick === 100) cmd.setHarvest(0, 'low') }
    const bytes = await packFilm(g.rec.film!)
    const back = unpackFilm(bytes)
    expect(back.keys.length).toBe(g.rec.film!.keys.length)
    expect(back.inputs).toEqual(g.rec.film!.inputs)
    expect(await keyText(back.keys[1])).toBe(await keyText(g.rec.film!.keys[1]))
    expect(bytes.length).toBeLessThan(5e6)
  }, 120000)
})
