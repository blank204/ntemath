import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_PARAMS, DEFAULT_REGION, WEIGHT_SUM_MAX, clampWeights, useModelStore,
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
    regionName: DEFAULT_REGION, region: null, availableRegions: [],
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
    expect(DEFAULT_PARAMS.target).toBe(0.95)
  })

  it('detects at tower range, not at rod range', () => {
    // 2 km was a smoke sensor on a post. A tower sees a flash to the horizon
    // and hears the thunder that confirms it out to roughly 15–20 km, which
    // is the range the acoustic layer can actually stand behind. It also
    // drops tower counts into the tens — the regime where Benchmark A
    // measured risk-driven siting beating a uniform grid by its widest
    // margin, rather than the hundreds where the grid wins.
    expect(DEFAULT_PARAMS.detectKm).toBe(15)
  })

  it('opens on the region whose data is driven by lightning', () => {
    // Asserted on the constant rather than on the live store, because
    // beforeEach resets the store FROM that constant — reading it back would
    // only prove the reset worked.
    expect(DEFAULT_REGION).toBe('james-bay')
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

  it('refuses NaN, which Math.min and Math.max both pass straight through', () => {
    // A NaN weight makes every pixel NaN, so no pixel is the maximum, the seed
    // never resolves, and the run fails with a message about the mask that
    // has nothing to do with the cause.
    expect(clampWeights({ wWeather: NaN, wActivity: 0.35 }).wWeather).toBe(0)
    expect(clampWeights({ wWeather: 0.45, wActivity: NaN }).wActivity).toBe(0)
    for (const v of Object.values(clampWeights({ wWeather: NaN, wActivity: NaN }))) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('restores an exact snapshot through setParams without clamping it', () => {
    // setParams must not rewrite the model's literal wBase into the derived
    // one — it is how a reader gets back to the shipped defaults.
    useModelStore.getState().setWeights({ wWeather: 0.9, wActivity: 0.9 })
    useModelStore.getState().setParams(DEFAULT_PARAMS)
    expect(useModelStore.getState().params.wBase).toBe(0.2)
    expect(useModelStore.getState().params).toEqual(DEFAULT_PARAMS)
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
    expect(DEFAULT_PARAMS.detectKm).toBe(15)   // the default object is not mutated
  })
})
