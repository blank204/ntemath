import { describe, it, expect } from 'vitest'
import { GridIndex } from '../src/lib/gridindex'

const xs = Float64Array.from([0, 1, 2, 10, 10.5])
const ys = Float64Array.from([0, 0, 0, 10, 10])

describe('GridIndex', () => {
  it('finds exactly the points within the radius', () => {
    const g = new GridIndex(xs, ys, 1.0)
    expect(g.withinRadius(0, 0, 1.5).sort()).toEqual([0, 1])
    expect(g.withinRadius(0, 0, 2.0).sort()).toEqual([0, 1, 2])
  })

  it('is inclusive at exactly the radius', () => {
    const g = new GridIndex(xs, ys, 1.0)
    expect(g.withinRadius(0, 0, 1.0).sort()).toEqual([0, 1])
  })

  it('returns nothing when the query is far away', () => {
    const g = new GridIndex(xs, ys, 1.0)
    expect(g.withinRadius(100, 100, 1)).toEqual([])
  })

  it('reports the nearest distance', () => {
    const g = new GridIndex(xs, ys, 1.0)
    expect(g.nearestDistance(2.5, 0)).toBeCloseTo(0.5, 12)
    expect(g.nearestDistance(10.25, 10)).toBeCloseTo(0.25, 12)
  })

  it('agrees with brute force on random data', () => {
    const n = 400
    const rx = new Float64Array(n)
    const ry = new Float64Array(n)
    let s = 42
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < n; i++) { rx[i] = rand() * 50; ry[i] = rand() * 50 }
    const g = new GridIndex(rx, ry, 3.0)
    for (let t = 0; t < 20; t++) {
      const qx = rand() * 50, qy = rand() * 50, r = 4
      const got = g.withinRadius(qx, qy, r).sort((a, b) => a - b)
      const want: number[] = []
      for (let i = 0; i < n; i++) if (Math.hypot(rx[i] - qx, ry[i] - qy) <= r) want.push(i)
      expect(got).toEqual(want)
    }
  })

  it('nearestDistance agrees with brute force', () => {
    const n = 400
    const rx = new Float64Array(n)
    const ry = new Float64Array(n)
    let s = 42
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

    // Fill first 200 points randomly in [0, 50] x [0, 50]
    for (let i = 0; i < 200; i++) {
      rx[i] = rand() * 50
      ry[i] = rand() * 50
    }

    // Add 100 points along a thin vertical line (tests grid dimension collapse)
    for (let i = 200; i < 300; i++) {
      rx[i] = 25.0
      ry[i] = (i - 200) * 0.5
    }

    // Add 100 points along a thin horizontal line (tests another collapse)
    for (let i = 300; i < 400; i++) {
      rx[i] = (i - 300) * 0.5
      ry[i] = 25.0
    }

    // Use small cell size to force ring expansion
    const g = new GridIndex(rx, ry, 1.0)

    for (let t = 0; t < 20; t++) {
      // Mix of queries: some inside [0, 50]x[0, 50], some outside to test fallback
      let qx: number, qy: number
      if (t < 15) {
        qx = rand() * 50
        qy = rand() * 50
      } else {
        // Outside bounding box to trigger fallback path
        qx = -rand() * 10 - 5
        qy = 50 + rand() * 10 + 5
      }

      const got = g.nearestDistance(qx, qy)
      let want = Infinity
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(rx[i] - qx, ry[i] - qy)
        if (d < want) want = d
      }

      expect(got).toBeCloseTo(want, 9)
    }
  })
})
