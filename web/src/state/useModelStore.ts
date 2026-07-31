import { create } from 'zustand'
import type { RegionData } from '../lib/loadRegion'
import type { PlaceParams, PlaceResult } from '../lib/pipeline'

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
 * UI defaults. rMinKm/rMaxKm reproduce plan.py:207-208's saturation-regime
 * derivation verbatim (detectKm * 0.55 and detectKm * 1.30). maxNodes is
 * null, i.e. saturation: node count is whatever the coverage target requires.
 */
export const DEFAULT_PARAMS: PlaceParams = {
  seed: 7,
  detectKm: 2.0,
  rMinKm: 1.1,        // detectKm * 0.55, per plan_region's saturation regime
  rMaxKm: 2.6,        // detectKm * 1.30, same source
  target: 0.95,
  demandStride: 4,
  maxNodes: null,
}

/** Keep spacing tied to the detection radius exactly as plan_region does. */
export function spacingFor(detectKm: number): { rMinKm: number; rMaxKm: number } {
  return { rMinKm: detectKm * 0.55, rMaxKm: detectKm * 1.3 }
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
