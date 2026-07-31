import { describe, it, expect } from 'vitest'
import { RefRNG } from '../src/lib/refrng'
import { variablePoissonDisk } from '../src/lib/poisson'
import { radiusAt } from '../src/lib/field'
import type { Field } from '../src/lib/types'
import fixture from './fixtures/poisson.json'

function riskFieldOf(c: any): Field {
  return { nx: c.nx, ny: c.ny, data: Float32Array.from(c.risk) }
}

function maskFieldOf(c: any): Field | null {
  if (!c.mask) return null
  return { nx: c.nx, ny: c.ny, data: Float32Array.from(c.mask.map((b: boolean) => (b ? 1 : 0))) }
}

function run(c: any): Float64Array {
  return variablePoissonDisk(
    new RefRNG(c.seed), riskFieldOf(c), c.width_km, c.height_km,
    c.r_min_km, c.r_max_km, maskFieldOf(c), 24, 200_000, c.seed_flat_index,
  )
}

describe('variablePoissonDisk reproduces the Python exactly', () => {
  for (const c of fixture.cases as any[]) {
    it(`case ${c.tag}: same point count`, () => {
      const out = run(c)
      expect(out.length / 2).toBe(c.points.length)
    })

    it(`case ${c.tag}: same points in the same order`, () => {
      const out = run(c)
      for (let i = 0; i < c.points.length; i++) {
        expect(Math.abs(out[2 * i] - c.points[i][0])).toBeLessThan(1e-9)
        expect(Math.abs(out[2 * i + 1] - c.points[i][1])).toBeLessThan(1e-9)
      }
    })

    it(`case ${c.tag}: no pair closer than the larger of the two local radii`, () => {
      const out = run(c)
      const risk = riskFieldOf(c)
      const n = out.length / 2
      for (let a = 0; a < n; a++) {
        const ra = radiusAt(risk, out[2 * a], out[2 * a + 1], c.width_km, c.height_km, c.r_min_km, c.r_max_km)
        for (let b = a + 1; b < n; b++) {
          const rb = radiusAt(risk, out[2 * b], out[2 * b + 1], c.width_km, c.height_km, c.r_min_km, c.r_max_km)
          const d = Math.hypot(out[2 * a] - out[2 * b], out[2 * a + 1] - out[2 * b + 1])
          expect(d).toBeGreaterThan(Math.max(ra, rb) - 1e-9)
        }
      }
    })
  }
})
