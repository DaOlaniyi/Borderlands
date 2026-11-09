import { N4 } from './Grid'
import { TILE } from './config'
import type { World } from './types'

/** Derived, read-only facts about a world's geography (computed once per world). */
export type WorldInfo = {
  /** Landmass id per cell (4-connected land), -1 on water. */
  landmass: Int32Array
  /** Land cells per landmass, and the centre (world px) of each. */
  sizes: number[]
  centers: { x: number; y: number }[]
  /** 1 on water that connects to the open ocean (touches the map edge, or is huge); 0 on land and on landlocked lakes. */
  sea: Uint8Array
}

const cache = new WeakMap<World, WorldInfo>()

export function worldInfo(world: World): WorldInfo {
  const hit = cache.get(world)
  if (hit) return hit
  const { w, h, land } = world
  const landmass = new Int32Array(w * h).fill(-1), sizes: number[] = [], sx: number[] = [], sy: number[] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!land[s] || landmass[s] >= 0) continue
    const id = sizes.length
    let n = 0, ax = 0, ay = 0
    landmass[s] = id; stack.push(s)
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i / w) | 0
      n++; ax += x; ay += y
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (land[j] && landmass[j] < 0) { landmass[j] = id; stack.push(j) }
      }
    }
    sizes.push(n); sx.push(ax / n); sy.push(ay / n)
  }
  const sea = new Uint8Array(w * h), seen = new Uint8Array(w * h)
  for (let s = 0; s < w * h; s++) {
    if (land[s] || seen[s]) continue
    const cells: number[] = [s]; seen[s] = 1
    let edge = false
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k], x = i % w, y = (i / w) | 0
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (!land[j] && !seen[j]) { seen[j] = 1; cells.push(j) }
      }
    }
    if (edge || cells.length >= 1500) for (const i of cells) sea[i] = 1
  }
  const info: WorldInfo = { landmass, sizes, centers: sx.map((x, i) => ({ x: (x + 0.5) * TILE, y: (sy[i] + 0.5) * TILE })), sea }
  cache.set(world, info)
  return info
}

/** Landmass id at a world position (-1 on water / off the map). */
export function landmassAt(world: World, x: number, y: number): number {
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE)
  if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return -1
  return worldInfo(world).landmass[cy * world.w + cx]
}
