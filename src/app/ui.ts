import type { Assets } from '../game/AssetLoader'
import { FACTION_COLORS, FACTION_DARK, type UnitType } from '../game/config'
import { drawEmblem } from '../game/Emblems'

const BASE = `${import.meta.env.BASE_URL}assets/ts/`
export const assetUrl = (p: string) => BASE + p.split('/').map(encodeURIComponent).join('/')

/**
 * The paper/button sheets are 320×320 nine-slice atlases whose pieces sit in the 64×64 cells at offsets 0/128/256.
 * Pack the nine cells next to each other so CSS border-image (slice 64) can stretch them.
 */
export function compactNineSlice(img: HTMLImageElement): string {
  const c = document.createElement('canvas'); c.width = c.height = 192
  const g = c.getContext('2d')!
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) g.drawImage(img, col * 128, r * 128, 64, 64, col * 64, r * 64, 64, 64)
  return c.toDataURL()
}

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })

/** Tight-cropped first frame of a unit sheet, as a data URL, for use as a button icon. */
function frameIcon(sheet: { img: CanvasImageSource & { width: number; height: number }; fw: number; fh: number }, size = 56): string {
  const probe = document.createElement('canvas'); probe.width = sheet.fw; probe.height = sheet.fh
  const pg = probe.getContext('2d', { willReadFrequently: true })!
  pg.drawImage(sheet.img, 0, 0, sheet.fw, sheet.fh, 0, 0, sheet.fw, sheet.fh)
  const d = pg.getImageData(0, 0, sheet.fw, sheet.fh).data
  let x0 = sheet.fw, y0 = sheet.fh, x1 = 0, y1 = 0
  for (let y = 0; y < sheet.fh; y++) for (let x = 0; x < sheet.fw; x++) if (d[(y * sheet.fw + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  const w = Math.max(1, x1 - x0 + 1), h = Math.max(1, y1 - y0 + 1), s = Math.min((size - 4) / w, (size - 4) / h)
  const out = document.createElement('canvas'); out.width = out.height = size
  const g = out.getContext('2d')!; g.imageSmoothingEnabled = false
  g.drawImage(probe, x0, y0, w, h, (size - w * s) / 2, (size - h * s) / 2, w * s, h * s)
  return out.toDataURL()
}

let uiAssets: Assets | null = null
const dataUrls = new WeakMap<object, string>()
/** Any sprite (a loaded image, or a recoloured canvas) as a URL usable in <img>. */
const imgUrl = (img: HTMLImageElement | HTMLCanvasElement) => {
  if (img instanceof HTMLImageElement) return img.src
  let u = dataUrls.get(img)
  if (!u) { u = img.toDataURL(); dataUrls.set(img, u) }
  return u
}
/** URL of a building sprite in a kingdom's colour (recoloured colours are rendered once and cached). */
export const buildingUrl = (color: number, name: string) => {
  const a = uiAssets
  if (!a) return ''
  const set = name === 'House1' ? a.houses : name === 'House3' ? a.lots : name === 'Barracks' ? a.barracks : a.towers
  return imgUrl(set[color])
}
/** Ship sprite (bow up) for a kingdom colour. */
export const shipUrl = (kind: 'boat' | 'zumwalt', color: number) => (uiAssets ? imgUrl(uiAssets.ships[kind][color].up) : '')
export const tintStyle = (_color: number): { filter?: string } => ({}) // (sprites are recoloured for real now; kept so call sites stay simple)

const emblemCache = new Map<string, string>()
/** A kingdom's emblem badge as an image URL (for the menu and the kingdom list). */
export function emblemUrl(emblem: number, color: number, size = 40): string {
  const key = `${emblem}|${color}|${size}`
  let u = emblemCache.get(key)
  if (u) return u
  const c = document.createElement('canvas'); c.width = c.height = size * 2
  const g = c.getContext('2d')!
  const hex = FACTION_COLORS[color], lum = (parseInt(hex.slice(1, 3), 16) * 0.3 + parseInt(hex.slice(3, 5), 16) * 0.59 + parseInt(hex.slice(5, 7), 16) * 0.11) / 255
  drawEmblem(g, emblem, size, size, size * 1.8, hex, lum > 0.62 ? FACTION_DARK[color] : '#ffffff')
  u = c.toDataURL(); emblemCache.set(key, u)
  return u
}

export const unitIcons: Partial<Record<UnitType, string>> = {}

export async function installUiTheme(assets?: Assets) {
  const root = document.documentElement.style
  const defs: [string, string][] = [
    ['--paper-img', 'UI Elements/UI Elements/Papers/RegularPaper.png'],
    ['--special-img', 'UI Elements/UI Elements/Papers/SpecialPaper.png'],
    ['--btn-blue', 'UI Elements/UI Elements/Buttons/BigBlueButton_Regular.png'],
    ['--btn-blue-down', 'UI Elements/UI Elements/Buttons/BigBlueButton_Pressed.png'],
    ['--btn-red', 'UI Elements/UI Elements/Buttons/BigRedButton_Regular.png'],
    ['--btn-red-down', 'UI Elements/UI Elements/Buttons/BigRedButton_Pressed.png'],
  ]
  await Promise.all(defs.map(async ([v, p]) => root.setProperty(v, `url(${compactNineSlice(await load(assetUrl(p)))})`)))
  if (assets) {
    uiAssets = assets
    unitIcons.warrior = frameIcon(assets.warrior[0].Idle) // colour 0 is Blue, a native sprite family
    unitIcons.archer = frameIcon(assets.archer[0].Idle)
    unitIcons.lancer = frameIcon(assets.lancer[0].Idle)
  }
}
