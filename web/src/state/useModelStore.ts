import { create } from 'zustand'
import type { RegionData } from '../lib/loadRegion'
import type { PlaceParams, PlaceResult } from '../lib/pipeline'
import { DEFAULT_WEIGHTS } from '../lib/risk'

interface ModelState {
  regionName: string
  region: RegionData | null
  params: PlaceParams
  result: PlaceResult | null
  running: boolean
  error: string | null

  setRegionName: (n: string) => void
  setRegion: (r: RegionData) => void
  setParam: <K extends keyof PlaceParams>(k: K, v: PlaceParams[K]) => void
  setRunning: (b: boolean) => void
  setResult: (r: PlaceResult | null) => void
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
export const DEFAULT_PARAMS: PlaceParams = {
  seed: 7,
  detectKm: 2.0,
  target: 0.95,
  demandStride: 4,
  budgetMode: 'saturation',
  fixedNodes: 100,
  spacingOverride: null,
  ...DEFAULT_WEIGHTS,
}

export const useModelStore = create<ModelState>((set) => ({
  regionName: 'los-padres',
  region: null,
  params: DEFAULT_PARAMS,
  result: null,
  running: false,
  error: null,

  setRegionName: (n) => set({ regionName: n, region: null, result: null, error: null }),
  setRegion: (r) => set({ region: r }),
  setParam: (k, v) => set((s) => ({ params: { ...s.params, [k]: v } })),
  setRunning: (b) => set({ running: b }),
  setResult: (r) => set({ result: r }),
  setError: (m) => set({ error: m }),
}))
