import type { RegionData, RegionMeta } from './loadRegion'
import type { Field } from './types'
import { RefRNG } from './refrng'
import { variablePoissonDisk } from './poisson'
import { demandPoints, greedyMinimise } from './cover'
import { recombineRisk, flammabilityLut, meanOverMask } from './risk'
import { resolveSeedIndex } from './seed'

export interface PlaceParams {
  seed: number
  detectKm: number
  rMinKm: number
  rMaxKm: number
  target: number
  demandStride: number
  maxNodes: number | null
  /**
   * The three drive weights `plan.risk_field` takes, all independent inputs.
   * The model boundary carries what the model takes; a two-slider UI that
   * computes `wBase` as a remainder is a presentation choice and belongs in
   * the UI layer, not here.
   */
  wWeather: number
  wActivity: number
  wBase: number
}

export interface PlaceResult {
  candidates: Float64Array
  nodes: Float64Array
  chosen: number[]
  coveredFraction: number
  areaFraction: number
  candidateCount: number
  nodeCount: number
  /** Hardware saved by the greedy minimisation stage, as a percentage. */
  reductionPct: number
  /** The field this run was actually placed on, recombined at `p`'s weights. */
  risk: Field
  /** The seed pixel resolved against `risk`, not read from meta.json. */
  seedFlatIndex: number
  /** How many allowed pixels tied for the maximum. 1 means numpy would agree. */
  seedTiesAtMax: number
  /** `risk[burnable].mean()`, the quantity plan_region feeds to auto_budget. */
  meanRiskBurnable: number
}

/**
 * The resolution at which coverage is scored, in km.
 *
 * Mirrors plan.py:274 (`stride_km = demand_stride * w_km / risk.shape[1]`).
 * cover.ts's demandPoints and place.py:303 both say the stride must be
 * reported wherever a coverage number is shown — coverage at a 0.37 km stride
 * and coverage at a 4 km stride are not the same claim.
 */
export function strideKm(meta: RegionMeta, demandStride: number): number {
  return (demandStride * meta.widthKm) / Math.max(meta.nx, 1)
}

/**
 * The whole siting pipeline, exactly as plan.plan_region sequences it:
 * blue-noise candidates, then greedy set cover to the coverage target.
 *
 * Budget is saturation by default (maxNodes = null) — node count is whatever
 * reaching `target` requires. The Python's budget="auto" path clamps to 40
 * nodes, which cannot reach the target on a real region and is not used here.
 */
export function runPlacement(region: RegionData, p: PlaceParams): PlaceResult {
  const { widthKm, heightKm, name } = region.meta

  // Rebuild the risk field from the baked components at the caller's weights.
  // This is the whole point of Plan 2: the field the sampler reads is computed
  // here, on this run, not fetched pre-combined.
  const { risk } = recombineRisk(
    {
      classes: region.classes,
      activity: region.activity,
      fwiNorm: region.meta.fwiNorm,
      lut: flammabilityLut(region.meta.flammability),
    },
    { wWeather: p.wWeather, wActivity: p.wActivity, wBase: p.wBase },
  )

  // Resolve the seed against THIS field, not the baked one — see seed.ts for
  // why a shipped index stops being the argmax once the weights move.
  const seed = resolveSeedIndex(risk, region.mask)
  if (seed.index < 0) {
    throw new Error(
      `region "${name}" has no burnable pixel to seed placement from; the ` +
      'mask allows nothing.',
    )
  }

  const candidates = variablePoissonDisk(
    new RefRNG(p.seed), risk, widthKm, heightKm,
    p.rMinKm, p.rMaxKm, region.mask, 24, 200_000, seed.index,
  )

  if (candidates.length === 0) {
    throw new Error(
      `region "${name}" produced zero placement candidates from seed pixel ` +
      `${seed.index}. This should be unreachable: the seed is chosen from the ` +
      'mask-allowed pixels.',
    )
  }

  const demand = demandPoints(
    risk, region.mask, widthKm, heightKm, p.demandStride,
  )

  const cov = greedyMinimise(
    candidates, demand.xy, demand.w, p.detectKm, p.target, p.maxNodes,
  )

  const nodes = new Float64Array(cov.chosen.length * 2)
  cov.chosen.forEach((idx, k) => {
    nodes[2 * k] = candidates[2 * idx]
    nodes[2 * k + 1] = candidates[2 * idx + 1]
  })

  const candidateCount = candidates.length / 2
  const nodeCount = cov.chosen.length

  return {
    candidates,
    nodes,
    chosen: cov.chosen,
    coveredFraction: cov.coveredFraction,
    areaFraction: cov.areaFraction,
    candidateCount,
    nodeCount,
    reductionPct: candidateCount > 0
      ? 100 * (1 - nodeCount / candidateCount)
      : 0,
    risk,
    seedFlatIndex: seed.index,
    seedTiesAtMax: seed.tiesAtMax,
    meanRiskBurnable: meanOverMask(risk, region.mask),
  }
}
