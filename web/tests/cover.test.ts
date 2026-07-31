import { describe, it, expect } from 'vitest'
import { demandPoints, coverageOf, greedyMinimise } from '../src/lib/cover'
import { variablePoissonDisk } from '../src/lib/poisson'
import { RefRNG } from '../src/lib/refrng'
import type { Field } from '../src/lib/types'
import fixture from './fixtures/cover.json'

const f = fixture as any

const risk: Field = { nx: f.nx, ny: f.ny, data: Float32Array.from(f.risk) }
const mask: Field = {
  nx: f.nx, ny: f.ny,
  data: Float32Array.from(f.mask.map((b: boolean) => (b ? 1 : 0))),
}
const candXY = Float64Array.from(f.candidates.flat())
const demandXY = Float64Array.from(f.demand_xy.flat())
const demandW = Float64Array.from(f.demand_w)

describe('demandPoints', () => {
  it('produces the same points as the Python', () => {
    const d = demandPoints(risk, mask, f.width_km, f.height_km, f.stride)
    expect(d.xy.length / 2).toBe(f.demand_xy.length)
    for (let i = 0; i < f.demand_xy.length; i++) {
      expect(Math.abs(d.xy[2 * i] - f.demand_xy[i][0])).toBeLessThan(1e-9)
      expect(Math.abs(d.xy[2 * i + 1] - f.demand_xy[i][1])).toBeLessThan(1e-9)
      expect(Math.abs(d.w[i] - f.demand_w[i])).toBeLessThan(1e-6)
    }
  })
})

describe('coverageOf', () => {
  it('matches the Python for the full candidate pool', () => {
    const [wFrac, aFrac] = coverageOf(candXY, demandXY, demandW, f.radius_km)
    expect(Math.abs(wFrac - f.full_pool_coverage[0])).toBeLessThan(1e-9)
    expect(Math.abs(aFrac - f.full_pool_coverage[1])).toBeLessThan(1e-9)
  })
})

describe('greedyMinimise', () => {
  it('chooses the same nodes in the same order', () => {
    const r = greedyMinimise(candXY, demandXY, demandW, f.radius_km, f.target)
    expect(r.chosen).toEqual(f.chosen)
  })

  it('reports the same coverage', () => {
    const r = greedyMinimise(candXY, demandXY, demandW, f.radius_km, f.target)
    expect(Math.abs(r.coveredFraction - f.covered_fraction)).toBeLessThan(1e-9)
    expect(Math.abs(r.areaFraction - f.area_fraction)).toBeLessThan(1e-9)
  })

  it('reaches the coverage target, or exhausts the candidate pool trying', () => {
    // For this fixture the full 116-candidate pool only ever covers ~84.67%
    // of demand at radius_km=2 (see full_pool_coverage) -- the 0.95 target is
    // unreachable with these candidates, so greedy correctly empties its heap
    // (every remaining candidate has zero marginal gain) before hitting it.
    // The real invariant is: greedy gets to the target *or* to the best any
    // candidate subset of this pool can do, whichever is smaller.
    const r = greedyMinimise(candXY, demandXY, demandW, f.radius_km, f.target)
    const ceiling = Math.min(f.target, f.full_pool_coverage[0])
    expect(r.coveredFraction).toBeGreaterThanOrEqual(ceiling - 1e-9)
  })

  it('honours maxNodes', () => {
    const r = greedyMinimise(candXY, demandXY, demandW, f.radius_km, f.target, 5)
    expect(r.chosen.length).toBeLessThanOrEqual(5)
  })

  it('returns nothing for empty inputs', () => {
    const empty = new Float64Array(0)
    const r = greedyMinimise(empty, demandXY, demandW, f.radius_km, f.target)
    expect(r.chosen).toEqual([])
    expect(r.coveredFraction).toBe(0)
  })
})

describe('candidate generation', () => {
  it('regenerating via variablePoissonDisk with the resolved seed reproduces the fixture candidates', () => {
    // The fixture's seed_flat_index is what place.py's own argsort-based seed
    // scan actually landed on. Passing it through here proves the TS Poisson
    // sampler and the Python one agree on the exact candidate set that feeds
    // greedyMinimise -- not just that greedyMinimise itself is a faithful
    // port given someone else's candidates.
    const cand = variablePoissonDisk(
      new RefRNG(f.seed), risk, f.width_km, f.height_km,
      f.r_min_km, f.r_max_km, mask, 24, 200_000, f.seed_flat_index,
    )
    expect(cand.length / 2).toBe(f.candidates.length)
    for (let i = 0; i < f.candidates.length; i++) {
      expect(Math.abs(cand[2 * i] - f.candidates[i][0])).toBeLessThan(1e-9)
      expect(Math.abs(cand[2 * i + 1] - f.candidates[i][1])).toBeLessThan(1e-9)
    }
  })
})
