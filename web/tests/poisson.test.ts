import { describe, it, expect } from 'vitest'
import { RefRNG } from '../src/lib/refrng'
import { variablePoissonDisk } from '../src/lib/poisson'
import type { Field } from '../src/lib/types'
import fixture from './fixtures/poisson.json'

describe('variablePoissonDisk reproduces the Python exactly', () => {
  for (const c of fixture.cases as any[]) {
    it(`case ${c.tag}: same point count`, () => {
      const risk: Field = { nx: c.nx, ny: c.ny, data: Float32Array.from(c.risk) }
      const out = variablePoissonDisk(
        new RefRNG(c.seed), risk, c.width_km, c.height_km,
        c.r_min_km, c.r_max_km, null, 24,
      )
      expect(out.length / 2).toBe(c.points.length)
    })

    it(`case ${c.tag}: same points in the same order`, () => {
      const risk: Field = { nx: c.nx, ny: c.ny, data: Float32Array.from(c.risk) }
      const out = variablePoissonDisk(
        new RefRNG(c.seed), risk, c.width_km, c.height_km,
        c.r_min_km, c.r_max_km, null, 24,
      )
      for (let i = 0; i < c.points.length; i++) {
        expect(Math.abs(out[2 * i] - c.points[i][0])).toBeLessThan(1e-9)
        expect(Math.abs(out[2 * i + 1] - c.points[i][1])).toBeLessThan(1e-9)
      }
    })

    it(`case ${c.tag}: no pair closer than the larger local radius`, () => {
      const risk: Field = { nx: c.nx, ny: c.ny, data: Float32Array.from(c.risk) }
      const out = variablePoissonDisk(
        new RefRNG(c.seed), risk, c.width_km, c.height_km,
        c.r_min_km, c.r_max_km, null, 24,
      )
      const n = out.length / 2
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const d = Math.hypot(out[2 * a] - out[2 * b], out[2 * a + 1] - out[2 * b + 1])
          expect(d).toBeGreaterThan(c.r_min_km - 1e-9)
        }
      }
    })
  }
})
