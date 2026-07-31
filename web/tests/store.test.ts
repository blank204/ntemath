import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_PARAMS, WEIGHT_SUM_MAX, clampWeights, useModelStore,
} from '../src/state/useModelStore'
import { DEFAULT_WEIGHTS } from '../src/lib/risk'
import type { BenchmarkResult } from '../src/lib/benchmark'

const EMPTY_CURVE: BenchmarkResult = {
  points: [],
  atBudget: { requested: 0, scored: 0, pyra: 0, uniform: 0, deltaPP: 0 },
  bestMargin: { requested: 0, scored: 0, pyra: 0, uniform: 0, deltaPP: 0 },
  crossoverNodes: null,
  crossoverBracket: null,
  strideKm: 1,
  demandCount: 0,
  detectKm: 2,
}

beforeEach(() => {
  useModelStore.setState({
    regionName: 'los-padres', region: null, availableRegions: [],
    params: DEFAULT_PARAMS, result: null, benchmark: null,
    running: false, error: null,
  })
})

describe('store defaults', () => {
  it("defaults to saturation and the model's own published weights", () => {
    expect(DEFAULT_PARAMS.budgetMode).toBe('saturation')
    expect(DEFAULT_PARAMS.wWeather).toBe(0.45)
    expect(DEFAULT_PARAMS.wActivity).toBe(0.35)
    expect(DEFAULT_PARAMS.demandStride).toBe(4)
    expect(DEFAULT_PARAMS.spacingOverride).toBeNull()
    expect(DEFAULT_PARAMS.detectKm).toBe(2.0)
    expect(DEFAULT_PARAMS.target).toBe(0.95)
  })

  it('takes w_base from the model, never from the slider arithmetic', () => {
    // The shipped defaults are plan.risk_field's own three literals, not an
    // arithmetic reconstruction of them: `1 - 0.45 - 0.35` is NOT 0.2 in
    // float64. (Measured in risk.test.ts, that ulp costs zero pixels against
    // risk.bin — but the defaults should still be the model's own numbers.)
    expect(DEFAULT_PARAMS.wBase).toBe(0.2)
    expect(DEFAULT_PARAMS.wBase).toBe(DEFAULT_WEIGHTS.wBase)
    const derived = clampWeights({ wWeather: 0.45, wActivity: 0.35 })
    expect(derived.wBase).not.toBe(0.2)
    expect(derived.wBase).toBe(0.20000000000000007)
  })
})

describe('clampWeights', () => {
  it('never lets the pair sum above one, giving way on activity', () => {
    const c = clampWeights({ wWeather: 0.9, wActivity: 0.9 })
    expect(c.wWeather).toBe(0.9)
    expect(c.wActivity).toBeCloseTo(0.1, 12)
    expect(c.wBase).toBeGreaterThanOrEqual(0)
    expect(c.wWeather + c.wActivity).toBeLessThanOrEqual(WEIGHT_SUM_MAX + 1e-12)
  })

  it('refuses negative weights on either slider', () => {
    const c = clampWeights({ wWeather: -1, wActivity: -1 })
    expect(c).toEqual({ wWeather: 0, wActivity: 0, wBase: 1 })
  })

  it('leaves an already-legal pair alone apart from deriving the base', () => {
    const c = clampWeights({ wWeather: 0.2, wActivity: 0.3 })
    expect(c.wWeather).toBe(0.2)
    expect(c.wActivity).toBe(0.3)
    expect(c.wBase).toBeCloseTo(0.5, 12)
  })
})

describe('store actions', () => {
  it('routes setWeights through the clamp so w_base cannot go negative', () => {
    useModelStore.getState().setWeights({ wWeather: 0.9, wActivity: 0.9 })
    const p = useModelStore.getState().params
    expect(p.wWeather + p.wActivity).toBeLessThanOrEqual(1 + 1e-12)
    expect(p.wWeather).toBe(0.9)
    expect(p.wActivity).toBeCloseTo(0.1, 12)
    expect(p.wBase).toBeGreaterThanOrEqual(0)
    // Nothing else in the params was disturbed.
    expect(p.detectKm).toBe(DEFAULT_PARAMS.detectKm)
    expect(p.budgetMode).toBe(DEFAULT_PARAMS.budgetMode)
  })

  it('clears the previous benchmark when the region changes', () => {
    useModelStore.getState().setBenchmark(EMPTY_CURVE)
    useModelStore.getState().setResult({ nodeCount: 3 } as never)
    expect(useModelStore.getState().benchmark).not.toBeNull()

    useModelStore.getState().setRegionName('congo-basin')
    expect(useModelStore.getState().benchmark).toBeNull()
    expect(useModelStore.getState().result).toBeNull()
    expect(useModelStore.getState().region).toBeNull()
    expect(useModelStore.getState().regionName).toBe('congo-basin')
  })

  it('keeps the manifest list across a region change', () => {
    // availableRegions describes the DATA, not the selection — clearing it on
    // every pick would empty the picker the moment someone used it.
    useModelStore.getState().setAvailableRegions(['los-padres'])
    useModelStore.getState().setRegionName('congo-basin')
    expect(useModelStore.getState().availableRegions).toEqual(['los-padres'])
  })

  it('setParam changes one field and leaves the rest', () => {
    useModelStore.getState().setParam('detectKm', 3.5)
    const p = useModelStore.getState().params
    expect(p.detectKm).toBe(3.5)
    expect(p.target).toBe(DEFAULT_PARAMS.target)
    expect(DEFAULT_PARAMS.detectKm).toBe(2.0)   // the default object is not mutated
  })
})
