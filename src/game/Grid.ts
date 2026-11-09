import { TILE } from './config'
import type { World } from './types'

export const cellIndex = (w: number, cx: number, cy: number) => cy * w + cx
export const inBounds = (w: number, h: number, cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < w && cy < h
export const worldToCellX = (x: number) => Math.floor(x / TILE)
export const worldToCell = (world: { w: number; h: number }, x: number, y: number): number => {
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE)
  return inBounds(world.w, world.h, cx, cy) ? cy * world.w + cx : -1
}
export const cellCenter = (world: { w: number }, i: number) => ({ x: (i % world.w + 0.5) * TILE, y: (Math.floor(i / world.w) + 0.5) * TILE })
export const cellBounds = (world: { w: number }, i: number) => ({ x: (i % world.w) * TILE, y: Math.floor(i / world.w) * TILE, w: TILE, h: TILE })

export const isLandCell = (world: World, cx: number, cy: number) => inBounds(world.w, world.h, cx, cy) && world.land[cy * world.w + cx] === 1
export const isLandAt = (world: World, x: number, y: number) => isLandCell(world, Math.floor(x / TILE), Math.floor(y / TILE))

export const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const
export const N8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const

/** Largest 4-connected component of a boolean mask (returns new mask). */
export function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const comp = new Int32Array(w * h).fill(-1)
  let best = -1, bestSize = 0, id = 0
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || comp[s] >= 0) continue
    let size = 0
    stack.push(s); comp[s] = id
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i / w) | 0
      size++
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (mask[j] && comp[j] < 0) { comp[j] = id; stack.push(j) }
      }
    }
    if (size > bestSize) { bestSize = size; best = id }
    id++
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = comp[i] === best ? 1 : 0
  return out
}

export function countComponents(mask: Uint8Array, w: number, h: number): number {
  const seen = new Uint8Array(w * h)
  let n = 0
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue
    n++
    stack.push(s); seen[s] = 1
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i / w) | 0
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
      }
    }
  }
  return n
}

/**
 * BFS over cells using 4-neighbours. `passable(i)` decides which cells may be entered.
 * Returns the list of cell indices from `from` to `to` inclusive, or null.
 */
export function bfsPath(w: number, h: number, from: number, to: number, passable: (i: number) => boolean, maxNodes = 20000): number[] | null {
  if (from === to) return [from]
  if (!passable(to)) return null
  const prev = new Int32Array(w * h).fill(-2)
  const queue = [from]
  prev[from] = -1
  let head = 0, nodes = 0
  while (head < queue.length && nodes < maxNodes) {
    const i = queue[head++]; nodes++
    const x = i % w, y = (i / w) | 0
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (prev[j] !== -2 || !passable(j)) continue
      prev[j] = i
      if (j === to) {
        const path = [j]
        for (let k = i; k !== -1; k = prev[k]) path.push(k)
        return path.reverse()
      }
      queue.push(j)
    }
  }
  return null
}
