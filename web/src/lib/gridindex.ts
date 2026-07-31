/**
 * Uniform-grid spatial index, replacing scipy's cKDTree.
 *
 * Both queries place.py needs (query_ball_point, query k=1) are exact, so any
 * correct index returns the same set — only the internal ordering differs, and
 * nothing downstream depends on that. A uniform grid is a fraction of the code
 * of a KD-tree and is faster for the roughly-uniform point sets we have.
 */
export class GridIndex {
  private readonly xs: Float64Array
  private readonly ys: Float64Array
  private readonly cell: number
  private readonly minX: number
  private readonly minY: number
  private readonly nx: number
  private readonly ny: number
  private readonly buckets: number[][]

  constructor(xs: Float64Array, ys: Float64Array, cell: number) {
    this.xs = xs
    this.ys = ys
    this.cell = Math.max(cell, 1e-9)

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < minX) minX = xs[i]
      if (xs[i] > maxX) maxX = xs[i]
      if (ys[i] < minY) minY = ys[i]
      if (ys[i] > maxY) maxY = ys[i]
    }
    if (xs.length === 0) { minX = minY = maxX = maxY = 0 }

    this.minX = minX
    this.minY = minY
    this.nx = Math.max(1, Math.ceil((maxX - minX) / this.cell) + 1)
    this.ny = Math.max(1, Math.ceil((maxY - minY) / this.cell) + 1)
    this.buckets = Array.from({ length: this.nx * this.ny }, () => [] as number[])

    for (let i = 0; i < xs.length; i++) {
      this.buckets[this.bucketOf(xs[i], ys[i])].push(i)
    }
  }

  private bucketOf(x: number, y: number): number {
    const i = Math.min(Math.max(Math.floor((x - this.minX) / this.cell), 0), this.nx - 1)
    const j = Math.min(Math.max(Math.floor((y - this.minY) / this.cell), 0), this.ny - 1)
    return j * this.nx + i
  }

  /** Indices of every point within `r` of (x, y), inclusive. */
  withinRadius(x: number, y: number, r: number): number[] {
    const out: number[] = []
    const reach = Math.ceil(r / this.cell)
    const ci = Math.floor((x - this.minX) / this.cell)
    const cj = Math.floor((y - this.minY) / this.cell)
    const r2 = r * r
    for (let dj = -reach; dj <= reach; dj++) {
      const j = cj + dj
      if (j < 0 || j >= this.ny) continue
      for (let di = -reach; di <= reach; di++) {
        const i = ci + di
        if (i < 0 || i >= this.nx) continue
        for (const p of this.buckets[j * this.nx + i]) {
          const dx = this.xs[p] - x
          const dy = this.ys[p] - y
          if (dx * dx + dy * dy <= r2) out.push(p)
        }
      }
    }
    return out
  }

  /** Distance to the nearest indexed point, or Infinity if there are none. */
  nearestDistance(x: number, y: number): number {
    if (this.xs.length === 0) return Infinity
    // Expand the ring until something is found, then one ring further so a
    // closer point in a diagonal neighbour cannot be missed.
    for (let reach = 1; ; reach++) {
      let best = Infinity
      const ci = Math.floor((x - this.minX) / this.cell)
      const cj = Math.floor((y - this.minY) / this.cell)
      for (let dj = -reach; dj <= reach; dj++) {
        const j = cj + dj
        if (j < 0 || j >= this.ny) continue
        for (let di = -reach; di <= reach; di++) {
          const i = ci + di
          if (i < 0 || i >= this.nx) continue
          for (const p of this.buckets[j * this.nx + i]) {
            const d = Math.hypot(this.xs[p] - x, this.ys[p] - y)
            if (d < best) best = d
          }
        }
      }
      if (best < Infinity && best <= reach * this.cell) return best
      if (reach > this.nx + this.ny) {
        // Exhausted the grid: fall back to a linear scan.
        let b = Infinity
        for (let p = 0; p < this.xs.length; p++) {
          const d = Math.hypot(this.xs[p] - x, this.ys[p] - y)
          if (d < b) b = d
        }
        return b
      }
    }
  }
}
