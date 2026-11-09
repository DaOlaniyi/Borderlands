import { TEAM_BAND, NATIVE_FAMILIES, isTeamPixel, tintPixel, type ColorDef } from './Palette'

export type Img = HTMLImageElement | HTMLCanvasElement
/** One animation strip. `tint` is set on recoloured kingdom colours: their frames are made (and cached) the first time they are drawn. */
export type Sheet = { img: Img; fw: number; fh: number; frames: number; tint?: Tint }

type FrameInfo = { x0: number; y0: number; w: number; h: number; pix: Uint8ClampedArray; team: Uint32Array }
type Frame = { c: HTMLCanvasElement; x0: number; y0: number }

/**
 * Shared by every recoloured colour of one strip: the Blue frames cropped to their pixels, plus the list of team pixels (those that
 * differ between the five native families AND lie in the blue hue band). Worked out lazily per frame, once.
 */
export class TintSource {
  private infos: (FrameInfo | null)[] = []
  constructor(public blue: Sheet, public families: Sheet[]) {}
  info(fr: number): FrameInfo {
    let inf = this.infos[fr]
    if (inf) return inf
    const { fw, fh } = this.blue
    const read = (sh: Sheet) => {
      const c = document.createElement('canvas'); c.width = fw; c.height = fh
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(sh.img, fr * fw, 0, fw, fh, 0, 0, fw, fh)
      return g.getImageData(0, 0, fw, fh).data
    }
    const base = read(this.blue), others = this.families.map(read)
    let x0 = fw, y0 = fh, x1 = -1, y1 = -1
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (base[(y * fw + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0 }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, pix = new Uint8ClampedArray(w * h * 4), team: number[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((y + y0) * fw + x + x0) * 4, d = (y * w + x) * 4
      pix[d] = base[s]; pix[d + 1] = base[s + 1]; pix[d + 2] = base[s + 2]; pix[d + 3] = base[s + 3]
      if (base[s + 3] === 0 || !isTeamPixel(base[s], base[s + 1], base[s + 2])) continue
      let differs = false
      for (const o of others) if (o[s] !== base[s] || o[s + 1] !== base[s + 1] || o[s + 2] !== base[s + 2]) { differs = true; break }
      if (differs) team.push(y * w + x)
    }
    inf = { x0, y0, w, h, pix, team: Uint32Array.from(team) }
    this.infos[fr] = inf
    return inf
  }
}

export class Tint {
  private cache: (Frame | null)[] = []
  constructor(public src: TintSource, public spec: ColorDef) {}
  frame(fr: number): Frame {
    let f = this.cache[fr]
    if (f) return f
    const inf = this.src.info(fr)
    const c = document.createElement('canvas'); c.width = inf.w; c.height = inf.h
    const g = c.getContext('2d')!
    const data = new ImageData(new Uint8ClampedArray(inf.pix), inf.w, inf.h), d = data.data
    for (let k = 0; k < inf.team.length; k++) {
      const i = inf.team[k] * 4, [r, gg, b] = tintPixel(d[i], d[i + 1], d[i + 2], this.spec)
      d[i] = r; d[i + 1] = gg; d[i + 2] = b
    }
    g.putImageData(data, 0, 0)
    f = { c, x0: inf.x0, y0: inf.y0 }
    this.cache[fr] = f
    return f
  }
}

/** Build a recoloured strip from the native sheets (`famSheets` in NATIVE_FAMILIES order). */
export function tintedSheet(src: TintSource, spec: ColorDef): Sheet {
  return { ...src.blue, tint: new Tint(src, spec) }
}
export const makeTintSource = (famSheets: Sheet[]) => new TintSource(famSheets[NATIVE_FAMILIES.indexOf('Blue')], famSheets)

/** Draw frame `fr` of a strip into the rectangle (dx,dy,dw,dh) that frame as a whole would fill. */
export function drawSheet(ctx: CanvasRenderingContext2D, sh: Sheet, fr: number, dx: number, dy: number, dw: number, dh: number) {
  if (!sh.tint) { ctx.drawImage(sh.img, fr * sh.fw, 0, sh.fw, sh.fh, dx, dy, dw, dh); return }
  const f = sh.tint.frame(fr), sx = dw / sh.fw, sy = dh / sh.fh
  ctx.drawImage(f.c, dx + f.x0 * sx, dy + f.y0 * sy, f.c.width * sx, f.c.height * sy)
}

/** A whole-image recolour (buildings, ships): every pixel passing `isTeam` is tinted. */
export function recolorImage(img: Img, spec: ColorDef, isTeam: (r: number, g: number, b: number) => boolean = isTeamPixel): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  const data = g.getImageData(0, 0, c.width, c.height), d = data.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8 || !isTeam(d[i], d[i + 1], d[i + 2])) continue
    const [r, gg, b] = tintPixel(d[i], d[i + 1], d[i + 2], spec)
    d[i] = r; d[i + 1] = gg; d[i + 2] = b
  }
  g.putImageData(data, 0, 0)
  return c
}

/** Buildings: only pixels that differ between the native families are team pixels (a house's wood and stone stay as drawn). */
export function recolorBuilding(blue: Img, others: Img[], spec: ColorDef): HTMLCanvasElement {
  const read = (im: Img) => { const c = document.createElement('canvas'); c.width = blue.width; c.height = blue.height; const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(im, 0, 0); return g.getImageData(0, 0, c.width, c.height) }
  const base = read(blue), os = others.map(read)
  const d = base.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8 || !isTeamPixel(d[i], d[i + 1], d[i + 2])) continue
    let differs = false
    for (const o of os) if (o.data[i] !== d[i] || o.data[i + 1] !== d[i + 1] || o.data[i + 2] !== d[i + 2]) { differs = true; break }
    if (!differs) continue
    const [r, g, b] = tintPixel(d[i], d[i + 1], d[i + 2], spec)
    d[i] = r; d[i + 1] = g; d[i + 2] = b
  }
  const c = document.createElement('canvas'); c.width = blue.width; c.height = blue.height
  c.getContext('2d')!.putImageData(base, 0, 0)
  return c
}

export { TEAM_BAND }
