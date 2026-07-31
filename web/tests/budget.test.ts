import { describe, it, expect } from 'vitest'
import {
  roundHalfToEven, autoBudget, saturationSpacing, budgetSpacing, resolveBudget,
} from '../src/lib/budget'

describe('roundHalfToEven', () => {
  it('rounds halves to the even neighbour, as numpy does', () => {
    expect(roundHalfToEven(0.5)).toBe(0)
    expect(roundHalfToEven(1.5)).toBe(2)
    expect(roundHalfToEven(2.5)).toBe(2)
    expect(roundHalfToEven(3.5)).toBe(4)
    expect(roundHalfToEven(-0.5)).toBe(-0)
    expect(roundHalfToEven(-1.5)).toBe(-2)
  })

  it('agrees with ordinary rounding away from halves', () => {
    expect(roundHalfToEven(2.4)).toBe(2)
    expect(roundHalfToEven(2.6)).toBe(3)
    expect(roundHalfToEven(18.346845156542415)).toBe(18)
  })
})

describe('autoBudget', () => {
  it('reproduces plan.auto_budget on the real Los Padres inputs', () => {
    // Measured: burn_km2 5073.900713469231, risk[burn].mean() 0.5062295198440552,
    // KM2_PER_NODE 140, plan_region's clamps (6, 40) -> raw 18.346845, budget 18.
    expect(autoBudget(5073.900713469231, 0.5062295198440552, 140, 6, 40)).toBe(18)
  })

  it('clamps at both ends', () => {
    expect(autoBudget(10, 0.01, 140, 6, 40)).toBe(6)
    expect(autoBudget(1e7, 1, 140, 6, 40)).toBe(40)
  })

  it('clamps the mean risk into [0, 1] before scaling', () => {
    expect(autoBudget(140 * 20, 5, 140, 6, 40)).toBe(20)
    expect(autoBudget(140 * 20, -3, 140, 6, 40)).toBe(6)
  })

  it('uses banker\'s rounding on the raw count', () => {
    // raw exactly 18.5 -> 18 under round-half-to-even, 19 under Math.round.
    expect(autoBudget(140 * 18.5, 1, 140, 6, 40)).toBe(18)
    // raw exactly 19.5 -> 20 either way, so this pins the direction too.
    expect(autoBudget(140 * 19.5, 1, 140, 6, 40)).toBe(20)
  })
})

describe('spacing derivations', () => {
  it('uses plan_region\'s saturation multipliers', () => {
    expect(saturationSpacing(2)).toEqual({ rMinKm: 1.1, rMaxKm: 2.6 })
    const s = saturationSpacing(0.5)
    expect(s.rMinKm).toBeCloseTo(0.275, 12)
    expect(s.rMaxKm).toBeCloseTo(0.65, 12)
  })

  it('uses plan_region\'s budgeted spread on the real region', () => {
    // spread = sqrt(5073.900713469231 / 18) = 16.78938274536955
    const s = budgetSpacing(5073.900713469231, 18)
    expect(s.rMinKm).toBeCloseTo(7.555222235416298, 9)
    expect(s.rMaxKm).toBeCloseTo(18.468321019906508, 9)
  })

  it('never divides by zero nodes or a zero area', () => {
    const s = budgetSpacing(0, 0)
    expect(Number.isFinite(s.rMinKm)).toBe(true)
    expect(s.rMinKm).toBeGreaterThan(0)
  })
})

describe('resolveBudget', () => {
  const common = {
    detectKm: 2, target: 0.95, burnKm2: 5073.900713469231,
    meanRiskBurnable: 0.5062295198440552, km2PerNode: 140,
    budgetLo: 6, budgetHi: 40, override: null,
  }

  it('saturation leaves the node count open and keeps the reader\'s target', () => {
    const b = resolveBudget({ ...common, mode: 'saturation', fixedNodes: 100 })
    expect(b.maxNodes).toBeNull()
    expect(b.greedyTarget).toBe(0.95)
    expect(b.rMinKm).toBe(1.1)
    expect(b.rMaxKm).toBe(2.6)
  })

  it('auto resolves 18 nodes on Los Padres and makes the target unreachable', () => {
    const b = resolveBudget({ ...common, mode: 'auto', fixedNodes: 100 })
    expect(b.maxNodes).toBe(18)
    expect(b.greedyTarget).toBe(1.01)
    expect(b.rMinKm).toBeCloseTo(7.555222235416298, 9)
  })

  it('fixed uses the integer given and the same budgeted spacing', () => {
    const b = resolveBudget({ ...common, mode: 'fixed', fixedNodes: 200 })
    expect(b.maxNodes).toBe(200)
    expect(b.greedyTarget).toBe(1.01)
    expect(b.rMinKm).toBeCloseTo(Math.sqrt(common.burnKm2 / 200) * 0.45, 9)
  })

  it('an explicit spacing override wins over every derivation', () => {
    const b = resolveBudget({
      ...common, mode: 'saturation', fixedNodes: 1,
      override: { rMinKm: 3, rMaxKm: 9 },
    })
    expect(b.rMinKm).toBe(3)
    expect(b.rMaxKm).toBe(9)
    expect(b.derived).toBe(false)
  })

  it('refuses a fixed budget below one node', () => {
    expect(() => resolveBudget({ ...common, mode: 'fixed', fixedNodes: 0 }))
      .toThrow(/at least 1/)
  })
})
