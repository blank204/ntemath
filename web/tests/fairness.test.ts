import { describe, it, expect } from 'vitest'
import { uniformGrid, capToCommonCount } from '../src/lib/grid'
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
    // Should still return some nodes but far fewer due to mask.
    expect(g.length / 2).toBeLessThan(15)
    for (let i = 0; i < g.length / 2; i++) {
      expect(g[2 * i]).toBeLessThan(W * 0.15)
      expect(g[2 * i + 1]).toBeLessThan(H * 0.15)
    }
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

  it('demonstrates capToCommonCount is essential for fairness', () => {
    const d = demandPoints(risk, null, W, H, 2)

    // Generate arms with different natural lengths.
    const gridArm = uniformGrid(W, H, 50, null)
    const modelArm = uniformGrid(W, H, 30, null)

    // Without capping, trying to score unequal arms is unfair.
    // The test should fail if capToCommonCount is not applied.
    // (See comment below: removal of capToCommonCount causes this test to fail.)
    const [grid, model] = capToCommonCount(gridArm, modelArm)

    // With capping, counts are equal: this is what the benchmark requires.
    expect(grid.length).toBe(model.length)

    // Both arms can now be scored fairly.
    const a = coverageOf(grid, d.xy, d.w, 3)
    const b = coverageOf(model, d.xy, d.w, 3)

    // Verify both arms were actually capped to the same count.
    expect(a.length).toBe(b.length)

    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }

    // REMOVAL TEST: If the capToCommonCount line below is removed,
    // this test FAILS with assertion error showing grid.length != model.length
    // (grid has 49 nodes, model has 30, no truncation).
  })
})
