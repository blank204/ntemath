import { create } from 'zustand'
import type { RegionData } from '../lib/loadRegion'
import type { PlaceParams, PlaceResult } from '../lib/pipeline'
import type { BenchmarkResult } from '../lib/benchmark'
import { DEFAULT_WEIGHTS, type Weights } from '../lib/risk'

/** The two drive weights the Lab exposes as sliders. */
export interface DriveWeights {
  wWeather: number
  wActivity: number
}

/** The drive weights are presented as a partition of 1, so a pair cannot exceed it. */
export const WEIGHT_SUM_MAX = 1

/**
 * Force a legal slider pair and derive `w_base` from what it leaves.
 *
 * This is a PRESENTATION rule, not the model's. `plan.risk_field` takes three
 * independent weights and nowhere requires them to sum to 1 — see risk.ts.
 * What the Lab needs is only that `w_base` never goes negative, because a
 * negative base scores unburnt, unwatched ground below zero and inverts the
 * spacing rule that `radiusAt` reads off the field. Giving way on the activity
 * weight buys exactly that.
 *
 * DEFAULT_PARAMS is not built from this function: it carries `plan.risk_field`'s
 * own three literals, so the shipped defaults are the model's defaults rather
 * than an arithmetic reconstruction of them. (`1 - 0.45 - 0.35` is
 * 0.20000000000000007, not the literal 0.2 — measured to cost zero pixels
 * against risk.bin, but there is no reason to introduce the discrepancy.)
 */
export function clampWeights(w: DriveWeights): Weights {
  // NaN survives Math.min/Math.max, and a NaN weight makes the whole field
  // NaN, which makes the seed unresolvable and fails the run with a message
  // about the mask. A slider that briefly reads "" is enough to get here.
  const finite = (v: number) => (Number.isFinite(v) ? v : 0)
  const wWeather = Math.min(Math.max(finite(w.wWeather), 0), WEIGHT_SUM_MAX)
  const room = WEIGHT_SUM_MAX - wWeather
  const wActivity = Math.min(Math.max(finite(w.wActivity), 0), room)
  return { wWeather, wActivity, wBase: WEIGHT_SUM_MAX - wWeather - wActivity }
}

interface ModelState {
  regionName: string
  region: RegionData | null
  /** Which regions the data manifest says are actually baked. */
  availableRegions: string[]
  params: PlaceParams
  result: PlaceResult | null
  benchmark: BenchmarkResult | null
  running: boolean
  error: string | null

  setRegionName: (n: string) => void
  setRegion: (r: RegionData) => void
  setAvailableRegions: (r: string[]) => void
  setParam: <K extends keyof PlaceParams>(k: K, v: PlaceParams[K]) => void
  setParams: (p: PlaceParams) => void
  /** Both drive weights move together so `w_base` can never go negative. */
  setWeights: (w: DriveWeights) => void
  setRunning: (b: boolean) => void
  setResult: (r: PlaceResult | null) => void
  setBenchmark: (b: BenchmarkResult | null) => void
  setError: (m: string | null) => void
}

/**
 * UI defaults. Saturation is the default budget mode: node count is whatever
 * the coverage target requires, and spacing is derived from detectKm by
 * budget.ts (detectKm * 0.55 and detectKm * 1.30), never restated here.
 *
 * The drive weights are spread from risk.ts's DEFAULT_WEIGHTS, which carries
 * plan.risk_field's own literal parameter defaults — also never restated here.
 */
/**
 * The region the Lab opens on: the one whose risk field is driven by
 * lightning rather than by fire history. Every other region in the picker
 * still loads, and the picker says which of them lightning even applies to.
 */
export const DEFAULT_REGION = 'james-bay'

export const DEFAULT_PARAMS: PlaceParams = {
  seed: 7,
  /**
   * A tower's confirmation range, not a rod's. The camera sees a flash to
   * the horizon; what bounds this number is the acoustics — audible thunder
   * tops out near 20 km, and terrain and temperature gradients open shadow
   * zones well inside that, so 15 km is the range the flash-to-bang layer
   * can stand behind rather than the range a camera can see.
   *
   * It is also what puts tower counts in the tens, which is the regime where
   * Benchmark A measured risk-driven siting beating a uniform grid by its
   * widest margin (+3.55 pp at 132 nodes, with the grid ahead past 285).
   */
  detectKm: 15,
  target: 0.95,
  demandStride: 4,
  budgetMode: 'saturation',
  fixedNodes: 100,
  spacingOverride: null,
  ...DEFAULT_WEIGHTS,
}

export const useModelStore = create<ModelState>((set) => ({
  regionName: DEFAULT_REGION,
  region: null,
  availableRegions: [],
  params: DEFAULT_PARAMS,
  result: null,
  benchmark: null,
  running: false,
  error: null,

  // A benchmark curve belongs to one region. Carrying it across a region
  // change would render one region's finding under another region's name.
  setRegionName: (n) => set({
    regionName: n, region: null, result: null, benchmark: null, error: null,
  }),
  setRegion: (r) => set({ region: r }),
  setAvailableRegions: (r) => set({ availableRegions: r }),
  setParam: (k, v) => set((s) => ({ params: { ...s.params, [k]: v } })),
  // Deliberately NOT routed through clampWeights: this restores an exact
  // snapshot, and clamping would rewrite the model's literal wBase 0.2 into
  // the derived 0.20000000000000007. Only setWeights enforces the slider
  // invariant, because only the sliders can violate it.
  setParams: (p) => set({ params: p }),
  setWeights: (w) => set((s) => ({ params: { ...s.params, ...clampWeights(w) } })),
  setRunning: (b) => set({ running: b }),
  setResult: (r) => set({ result: r }),
  setBenchmark: (b) => set({ benchmark: b }),
  setError: (m) => set({ error: m }),
}))
