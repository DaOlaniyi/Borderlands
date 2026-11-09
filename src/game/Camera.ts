import { TILE } from './config'

export type Camera = { x: number; y: number; zoom: number } // x,y = world position of the viewport's top-left

export const screenToWorld = (c: Camera, sx: number, sy: number) => ({ x: sx / c.zoom + c.x, y: sy / c.zoom + c.y })
export const worldToScreen = (c: Camera, wx: number, wy: number) => ({ x: (wx - c.x) * c.zoom, y: (wy - c.y) * c.zoom })
export { worldToCell, cellCenter, cellBounds } from './Grid'

export const ZOOM_MIN = 0.22
export const ZOOM_MAX = 1.6

export function fitZoom(viewW: number, viewH: number, mapW: number, mapH: number) {
  return Math.min(viewW / (mapW * TILE), viewH / (mapH * TILE))
}

/** Keep the island (plus a water margin) overlapping the viewport. */
export function clampCamera(c: Camera, viewW: number, viewH: number, mapW: number, mapH: number, margin = 3 * TILE) {
  const vw = viewW / c.zoom, vh = viewH / c.zoom
  const minX = -margin, maxX = mapW * TILE + margin - vw, minY = -margin, maxY = mapH * TILE + margin - vh
  c.x = maxX < minX ? (minX + maxX) / 2 : Math.max(minX, Math.min(maxX, c.x))
  c.y = maxY < minY ? (minY + maxY) / 2 : Math.max(minY, Math.min(maxY, c.y))
}

/** Zoom around a screen point so the world point under it stays fixed. */
export function zoomAt(c: Camera, sx: number, sy: number, factor: number, minZ = ZOOM_MIN) {
  const wx = sx / c.zoom + c.x, wy = sy / c.zoom + c.y
  c.zoom = Math.max(minZ, Math.min(ZOOM_MAX, c.zoom * factor))
  c.x = wx - sx / c.zoom
  c.y = wy - sy / c.zoom
}
