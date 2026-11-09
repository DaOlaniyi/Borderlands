import { describe, expect, it } from 'vitest'
import { Game } from '../game/Game'
import { generateWorld } from '../game/WorldGenerator'

describe('performance (logged for the README)', () => {
  it('generates a maximum-size map and runs a representative battle quickly', () => {
    let pick: { seed: string; w: number; h: number } | null = null
    for (let i = 0; i < 300 && !pick; i++) { const { world } = generateWorld('P' + i, 5); if (world.island.w >= 78 && world.island.h >= 78) pick = { seed: 'P' + i, w: world.w, h: world.h } }
    expect(pick).not.toBeNull()
    const t0 = performance.now()
    const { world, spawns } = generateWorld(pick!.seed, 5)
    const genMs = performance.now() - t0
    const g = new Game({ world, spawns })
        // stage a battle: send every warrior toward the map centre
    const cx = (world.w / 2) * 64, cy = (world.h / 2) * 64
    for (const u of g.units) {
      let best = { x: cx, y: cy, d: Infinity }
      for (let i = 0; i < world.w * world.h; i++) if (world.land[i]) { const x = (i % world.w + 0.5) * 64, y = (Math.floor(i / world.w) + 0.5) * 64, d = Math.hypot(x - cx, y - cy); if (d < best.d) best = { x, y, d } }
      g.orderMoveTo(u, best.x, best.y)
    }
    const stepTimes: number[] = [], terr: number[] = []
    for (let i = 0; i < 25 * 60; i++) { const s = performance.now(); g.step(1 / 25); stepTimes.push(performance.now() - s); if (g.territoryMs) terr.push(g.territoryMs) }
    const avg = stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length, max = Math.max(...stepTimes)
    const p95 = stepTimes.slice().sort((a, b) => a - b)[Math.floor(stepTimes.length * 0.95)]
    const tavg = terr.reduce((a, b) => a + b, 0) / Math.max(1, terr.length)
    console.log(`PERF map ${world.w}x${world.h} warriors ${g.units.length} towns ${g.towns.length} | generate ${genMs.toFixed(1)}ms | sim step avg ${avg.toFixed(3)}ms p95 ${p95.toFixed(3)}ms max ${max.toFixed(2)}ms | territory recompute avg ${tavg.toFixed(3)}ms (${g.recomputeCount}x in 60 sim-s)`)
    expect(avg).toBeLessThan(8)
    expect(tavg).toBeLessThan(5)
  })
})
