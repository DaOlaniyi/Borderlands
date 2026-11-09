import { TILE } from './config'
import { isLandCell } from './Grid'
import type { World } from './types'

/** Flat-ground atlas (Tilemap_color1.png, 576×384, 64×64 cells) — tile numbers follow references/Tiny Swords Instructions.md. */
const TILE_CELL: Record<number, [number, number]> = {
  1: [0, 0], 2: [1, 0], 3: [2, 0], 4: [0, 1], 5: [1, 1], 6: [2, 1], 7: [0, 2], 8: [1, 2], 9: [2, 2],
  10: [0, 3], 11: [1, 3], 12: [2, 3], 13: [3, 0], 14: [3, 1], 15: [3, 2], 16: [3, 3],
}
export const flatFrame = (n: number) => ({ sx: TILE_CELL[n][0] * TILE, sy: TILE_CELL[n][1] * TILE, sw: TILE, sh: TILE })

// key = N E S W bits as a 4-char string
const TABLE: Record<string, number> = {
  '0000': 16, '0010': 13, '1010': 14, '1000': 15, '0100': 10, '0101': 11, '0001': 12,
  '0110': 1, '0111': 2, '0011': 3, '1110': 4, '1111': 5, '1011': 6, '1100': 7, '1101': 8, '1001': 9,
}

export function autotileNumber(world: World, cx: number, cy: number): number {
  const n = isLandCell(world, cx, cy - 1) ? 1 : 0, e = isLandCell(world, cx + 1, cy) ? 1 : 0
  const s = isLandCell(world, cx, cy + 1) ? 1 : 0, wv = isLandCell(world, cx - 1, cy) ? 1 : 0
  return TABLE['' + n + e + s + wv]
}

/** Land cells that touch water (8-neighbourhood) — foam is placed under these. */
export function isCoastCell(world: World, cx: number, cy: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !isLandCell(world, cx + dx, cy + dy)) return true
  return false
}
