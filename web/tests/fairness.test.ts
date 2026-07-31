import { describe, it, expect } from 'vitest'
import { uniformGrid, capToCommonCount, gridShape, cellElongation } from '../src/lib/grid'
import { coverageOf, demandPoints } from '../src/lib/cover'
import type { Field } from '../src/lib/types'

const nx = 40, ny = 30
const data = new Float32Array(nx * ny)
for (let j = 0; j < ny; j++) {
  for (let i = 0; i < nx; i++) {
    data[j * nx + i] = 0.5 + 0.5 * Math.sin((3 * Math.PI * i) / (nx - 1))
  }
}
const risk: Field = { nx, ny, data }
const W = 40, H = 30

/**
 * gridShape is the whole benchmark baseline in one function, and four fix
 * rounds went into stopping it from returning single-file slivers. None of
 * the behavioural tests below could tell: a stub returning [1, n] satisfies
 * "at most n nodes", "inside the region", "deterministic" and every mask
 * assertion. Pin the actual shapes.
 */
describe('gridShape', () => {
  // 40x30 km — the shape used by the rest of this file. n values include the
  // ones that were historically degenerate: 38, 214, 215, 356, 537.
  const W = 40, H = 30
  const cases: Array<[n: number, cols: number, rows: number]> = [
    [1, 1, 1],
    [2, 2, 1],
    [3, 2, 1],
    [4, 2, 2],
    [9, 3, 2],
    [17, 4, 4],
    [25, 6, 4],
    [38, 7, 5],
    [50, 8, 6],
    [130, 13, 10],
    [214, 16, 13],
    [215, 16, 13],
    [356, 22, 16],
    [537, 28, 19],
  ]

  it.each(cases)('n=%i -> %ix%i', (n, cols, rows) => {
    expect(gridShape(W, H, n)).toEqual([cols, rows])
    // ...and the grid that shape produces really does place cols*rows nodes.
    expect(uniformGrid(W, H, n, null).length / 2).toBe(cols * rows)
  })

  it('never returns a single-file grid for n >= 4', () => {
    for (let n = 4; n <= 600; n++) {
      const [cols, rows] = gridShape(W, H, n)
      expect(Math.min(cols, rows)).toBeGreaterThan(1)
    }
  })

  it('keeps cell elongation at or below 2 across the whole range', () => {
    let worst = 0
    let worstN = 0
    for (let n = 1; n <= 600; n++) {
      const [cols, rows] = gridShape(W, H, n)
      const e = cellElongation(W, H, cols, rows)
      if (e > worst) { worst = e; worstN = n }
    }
    expect({ worst, worstN }).toEqual({ worst: 1.5, worstN: 2 })
    expect(worst).toBeLessThanOrEqual(2)
  })

  it('never overshoots n, and never sheds more than the allowed shortfall', () => {
    for (let n = 1; n <= 600; n++) {
      const [cols, rows] = gridShape(W, H, n)
      const product = cols * rows
      expect(product).toBeLessThanOrEqual(n)
      // SHORTFALL_FRACTION = 0.05, MIN_SHORTFALL = 3 in grid.ts.
      expect(n - product).toBeLessThanOrEqual(Math.max(3, Math.ceil(n * 0.05)))
    }
  })

  it('reaches wide shapes on a wide region and tall shapes on a tall one', () => {
    // A [1, n] stub, or a search that forces cols <= rows, fails this.
    const [wideCols, wideRows] = gridShape(100, 10, 40)
    expect(wideCols).toBeGreaterThan(wideRows)
    const [tallCols, tallRows] = gridShape(10, 100, 40)
    expect(tallRows).toBeGreaterThan(tallCols)
  })

  it('matches the real Los Padres extent at the shipped node count', () => {
    const [cols, rows] = gridShape(82.36896718278675, 66.79200000000016, 572)
    expect([cols, rows]).toEqual([26, 22])
    expect(cellElongation(82.36896718278675, 66.79200000000016, cols, rows))
      .toBeLessThan(1.2)
  })
})

describe('uniformGrid', () => {
  it('returns at most the requested node count', () => {
    for (const n of [1, 4, 9, 17, 50]) {
      expect(uniformGrid(W, H, n, null).length / 2).toBeLessThanOrEqual(n)
    }
  })

  it('places every node inside the region', () => {
    const g = uniformGrid(W, H, 25, null)
    for (let i = 0; i < g.length / 2; i++) {
      expect(g[2 * i]).toBeGreaterThanOrEqual(0)
      expect(g[2 * i]).toBeLessThanOrEqual(W)
      expect(g[2 * i + 1]).toBeGreaterThanOrEqual(0)
      expect(g[2 * i + 1]).toBeLessThanOrEqual(H)
    }
  })

  it('is deterministic', () => {
    expect(Array.from(uniformGrid(W, H, 20, null)))
      .toEqual(Array.from(uniformGrid(W, H, 20, null)))
  })

  it('respects a mask', () => {
    const half = new Float32Array(nx * ny)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) half[j * nx + i] = i < nx / 2 ? 1 : 0
    const mask: Field = { nx, ny, data: half }
    const g = uniformGrid(W, H, 40, mask)
    for (let i = 0; i < g.length / 2; i++) {
      expect(g[2 * i]).toBeLessThan(W * 0.55)
    }
  })

  it('respects a restrictive mask', () => {
    // Mask that excludes 90% of the region, keeping only a tiny corner.
    const restrictive = new Float32Array(nx * ny)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) restrictive[j * nx + i] = i < nx * 0.1 && j < ny * 0.1 ? 1 : 0
    const mask: Field = { nx, ny, data: restrictive }
    const g = uniformGrid(W, H, 40, mask)
    // The old form of this test asserted only `< 15` plus a loop over the
    // surviving nodes — both vacuously satisfied by an empty result, so a
    // uniformGrid that returned nothing at all passed. Pin the exact
    // surviving node instead: the 8x5 grid over 40x30 km puts exactly one
    // cell centre (2.5, 3.0) inside the retained corner.
    expect(gridShape(W, H, 40)).toEqual([8, 5])
    expect(g.length / 2).toBe(1)
    expect(Array.from(g)).toEqual([2.5, 3])
    for (let i = 0; i < g.length / 2; i++) {
      expect(g[2 * i]).toBeLessThan(W * 0.15)
      expect(g[2 * i + 1]).toBeLessThan(H * 0.15)
    }
  })

  it('drops every node when the mask excludes everything', () => {
    const none: Field = { nx, ny, data: new Float32Array(nx * ny) }
    expect(uniformGrid(W, H, 40, none).length).toBe(0)
  })
})

describe('capToCommonCount', () => {
  it('truncates unequal arrays to minimum length', () => {
    const a = new Float64Array([1, 2, 3, 4, 5, 6]) // 3 pairs
    const b = new Float64Array([10, 20]) // 1 pair
    const [aOut, bOut] = capToCommonCount(a, b)
    expect(aOut.length).toBe(2) // 1 pair = 2 elements
    expect(bOut.length).toBe(2)
    expect(Array.from(aOut)).toEqual([1, 2])
    expect(Array.from(bOut)).toEqual([10, 20])
  })

  it('leaves equal arrays unchanged', () => {
    const a = new Float64Array([1, 2, 3, 4])
    const b = new Float64Array([10, 20, 30, 40])
    const [aOut, bOut] = capToCommonCount(a, b)
    expect(aOut).toEqual(a)
    expect(bOut).toEqual(b)
  })

  it('handles empty arrays', () => {
    const a = new Float64Array([])
    const b = new Float64Array([1, 2, 3, 4])
    const [aOut, bOut] = capToCommonCount(a, b)
    expect(aOut.length).toBe(0)
    expect(bOut.length).toBe(0)
  })

  it('truncates in both directions', () => {
    const a = new Float64Array([1, 2]) // 1 pair
    const b = new Float64Array([10, 20, 30, 40, 50, 60]) // 3 pairs
    const [aOut, bOut] = capToCommonCount(a, b)
    expect(aOut.length).toBe(2)
    expect(bOut.length).toBe(2)
  })
})

describe('benchmark fairness', () => {
  it('scores two independently-generated arms with equal node counts after capping', () => {
    const d = demandPoints(risk, null, W, H, 2)

    // Generate two independent arms with DIFFERENT natural lengths.
    const gridArm = uniformGrid(W, H, 50, null)
    const modelArm = uniformGrid(W, H, 30, null)

    // Before capping, arms have different counts.
    const gridCount = gridArm.length / 2
    const modelCount = modelArm.length / 2
    expect(gridCount).not.toBe(modelCount)

    // Cap to common count — this is the fairness enforcement.
    const [grid, model] = capToCommonCount(gridArm, modelArm)

    // After capping: identical counts and identical demand set.
    const cappedCount = grid.length / 2
    expect(cappedCount).toBe(model.length / 2)
    expect(cappedCount).toBeLessThanOrEqual(Math.min(gridCount, modelCount))

    // Score both on the same demand points.
    const a = coverageOf(grid, d.xy, d.w, 3)
    const b = coverageOf(model, d.xy, d.w, 3)

    // Both scores should be valid (in [0, 1]).
    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('capping changes the grid arm it is applied to', () => {
    // This test used to end with `expect(a.length).toBe(b.length)`, comparing
    // the arity of coverageOf's fixed 2-tuple against itself — a tautology
    // that could not fail, and which the comment above it described as a node
    // count check. Third time that circularity was found; asserting node
    // counts and scores directly this time.
    const d = demandPoints(risk, null, W, H, 2)

    const gridArm = uniformGrid(W, H, 50, null)     // 8x6 = 48 nodes
    const modelArm = uniformGrid(W, H, 30, null)    // 6x5 = 30 nodes
    expect(gridArm.length / 2).toBe(48)
    expect(modelArm.length / 2).toBe(30)

    const [grid, model] = capToCommonCount(gridArm, modelArm)
    expect(grid.length / 2).toBe(30)
    expect(model.length / 2).toBe(30)
    // The capped arm is a strict prefix of the arm it came from, not a
    // reshuffle: the benchmark must not silently reorder either arm.
    expect(Array.from(grid)).toEqual(Array.from(gridArm.slice(0, 60)))
    expect(Array.from(model)).toEqual(Array.from(modelArm))

    // Capping actually moves the score — it is not a no-op dressed up as
    // fairness. Scoring the uncapped 48-node grid arm beats the capped one.
    const cappedScore = coverageOf(grid, d.xy, d.w, 3)[0]
    const uncappedScore = coverageOf(gridArm, d.xy, d.w, 3)[0]
    expect(uncappedScore).toBeGreaterThan(cappedScore)

    for (const v of [...coverageOf(grid, d.xy, d.w, 3), ...coverageOf(model, d.xy, d.w, 3)]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
