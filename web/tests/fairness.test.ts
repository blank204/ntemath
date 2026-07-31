import { describe, it, expect } from 'vitest'
import { uniformGrid } from '../src/lib/grid'
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
})

describe('benchmark fairness', () => {
  it('scores both strategies on identical demand points and node count', () => {
    const d = demandPoints(risk, null, W, H, 2)
    const N = 30
    const grid = uniformGrid(W, H, N, null)

    // A stand-in "model" arm: the same node count, different positions.
    const model = new Float64Array(grid.length)
    for (let i = 0; i < grid.length / 2; i++) {
      model[2 * i] = (grid[2 * i] + 1.3) % W
      model[2 * i + 1] = grid[2 * i + 1]
    }

    // The guarantee: identical counts, identical demand set.
    expect(model.length).toBe(grid.length)

    const a = coverageOf(grid, d.xy, d.w, 3)
    const b = coverageOf(model, d.xy, d.w, 3)
    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
