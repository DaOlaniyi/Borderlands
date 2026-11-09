import raw from './palette.json'

/**
 * Kingdom colours. src/game/palette.json is the single source of truth (the dev script scripts/palette-preview.py reads it too).
 * The five native Tiny Swords families (Blue, Red, Yellow, Purple, Black) are used as drawn and are the recommended picks; every
 * other colour is made from the Blue family at run time: the pixels that differ between the families and sit in the blue hue band
 * are hue-shifted, re-saturated and re-lit (`tintPixel`). `hex` is the vivid banner colour used for territory, borders and the UI.
 */
export const NATIVE_FAMILIES = ['Black', 'Blue', 'Purple', 'Red', 'Yellow'] as const
export type Family = (typeof NATIVE_FAMILIES)[number]

export type ColorDef = { name: string; hex: string; native?: Family; recommended?: boolean; shift?: number; sat?: number; light?: number; lightAdd?: number }
export const PALETTE: ColorDef[] = raw as ColorDef[]
export const COLOR_COUNT = PALETTE.length

/** The hue band (degrees) and minimum saturation of the Blue family's team colour. */
export const TEAM_BAND = { lo: 150, hi: 270, minSat: 0.12 }

export const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const darker = (hex: string, k = 0.55) => '#' + hexRgb(hex).map(v => Math.round(v * k).toString(16).padStart(2, '0')).join('')

/** Colour indices, with the five recommended (native) ones first and the rest in palette order (the order the menu lists them in). */
export const MENU_ORDER = [...PALETTE.keys()].sort((a, b) => Number(!!PALETTE[b].recommended) - Number(!!PALETTE[a].recommended) || a - b)
export const colorSpec = (i: number): ColorDef => PALETTE[i]
export const darkOf = (i: number) => darker(PALETTE[i].hex)

/** Colours handed to the AI kingdoms: palette order (it is arranged so the first few are the most distinct), minus the player's. */
export function assignColors(count: number, playerColor: number): number[] {
  const out = [playerColor]
  for (let c = 0; c < COLOR_COUNT && out.length < count; c++) if (c !== playerColor) out.push(c)
  while (out.length < count) out.push(out.length % COLOR_COUNT) // more kingdoms than colours: share (never expected)
  return out
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return [h, s, l]
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** Is this Blue-family pixel one of the team colour pixels (hue in the blue band, saturated enough)? */
export function isTeamPixel(r: number, g: number, b: number): boolean {
  const [h, s] = rgbToHsl(r, g, b)
  return s >= TEAM_BAND.minSat && h >= TEAM_BAND.lo && h <= TEAM_BAND.hi
}

/** The new colour of a team pixel for colour `spec` (hue shift, saturation multiplier, lightness multiplier + offset). */
export function tintPixel(r: number, g: number, b: number, spec: ColorDef): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b)
  const h2 = (h + (spec.shift ?? 0) + 720) % 360, s2 = Math.min(1, s * (spec.sat ?? 1)), l2 = Math.min(1, Math.max(0, l * (spec.light ?? 1) + (spec.lightAdd ?? 0)))
  return hslToRgb(h2, s2, l2)
}
