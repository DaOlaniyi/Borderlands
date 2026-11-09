/** Uniform grid hash over entity indices; linked-list buckets avoid per-frame allocation. */
export class SpatialHash {
  private head: Int32Array
  private next: Int32Array
  private cols: number
  private rows: number
  constructor(private width: number, private height: number, private cell = 96, capacity = 256) {
    this.cols = Math.ceil(width / cell) + 1
    this.rows = Math.ceil(height / cell) + 1
    this.head = new Int32Array(this.cols * this.rows).fill(-1)
    this.next = new Int32Array(capacity)
  }
  rebuild(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number, alive?: (i: number) => boolean) {
    if (this.next.length < count) this.next = new Int32Array(count * 2)
    this.head.fill(-1)
    for (let i = 0; i < count; i++) {
      if (alive && !alive(i)) continue
      const c = this.bucket(xs[i], ys[i])
      this.next[i] = this.head[c]; this.head[c] = i
    }
  }
  private bucket(x: number, y: number) {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell))), cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)))
    return cy * this.cols + cx
  }
  /** Appends indices within the square of half-size r around (x,y) to out; returns count. */
  query(x: number, y: number, r: number, out: number[]): number {
    out.length = 0
    const x0 = Math.max(0, Math.floor((x - r) / this.cell)), x1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cell))
    const y0 = Math.max(0, Math.floor((y - r) / this.cell)), y1 = Math.min(this.rows - 1, Math.floor((y + r) / this.cell))
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (let i = this.head[cy * this.cols + cx]; i !== -1; i = this.next[i]) out.push(i)
    return out.length
  }
}
