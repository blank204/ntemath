import type { RegionData, RegionMeta } from './loadRegion'
import type { Field } from './types'
import { RefRNG } from './refrng'
import { variablePoissonDisk } from './poisson'
import { demandPoints, greedyMinimise } from './cover'
import { recombineRisk, flammabilityLut, meanOverMask } from './risk'
import { resolveSeedIndex } from './seed'
import { resolveBudget } from './budget'
import type { BudgetMode, BudgetPlan } from './budget'

export interface PlaceParams {
  seed: number
  detectKm: number
  target: number
  demandStride: number
  /**
   * Which rule decides how many nodes may be placed. Spacing follows from it,
   * exactly as in `plan_region`: there is no independent rMinKm/rMaxKm input,
   * because in the Python those are derived unless the caller overrides both.
   */
  budgetMode: BudgetMode
  /** Only read when `budgetMode` is `'fixed'`. */
  fixedNodes: number
  /** The manual escape hatch, mirroring plan_region's r_min_km/r_max_km args. */
  spacingOverride: { rMinKm: number; rMaxKm: number } | null
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
  /** The node cap, greedy target and spacing this run actually used. */
  budget: BudgetPlan
  /** Burnable area in km2 — `burn.mean() * box.area_km2`, as plan_region has it. */
  burnKm2: number
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
 * Budget is saturation by default — node count is whatever reaching `target`
 * requires. `'auto'` and `'fixed'` reproduce plan_region's budgeted regimes,
 * including its unreachable coverage target; see budget.ts.
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

  // The budget depends on mean risk over burnable ground, which depends on the
  // weights — so it is resolved from THIS run's field, not from the bake.
  const meanRiskBurnable = meanOverMask(risk, region.mask)
  let burnable = 0
  for (let i = 0; i < region.mask.data.length; i++) {
    if (region.mask.data[i] > 0.5) burnable++
  }
  // plan.py:253 — `burn_km2 = float(burn.mean()) * box.area_km2`.
  const burnKm2 = (burnable / region.mask.data.length) * region.meta.areaKm2

  const budget = resolveBudget({
    mode: p.budgetMode,
    fixedNodes: p.fixedNodes,
    detectKm: p.detectKm,
    target: p.target,
    burnKm2,
    meanRiskBurnable,
    km2PerNode: region.meta.km2PerNode,
    budgetLo: region.meta.budgetLo,
    budgetHi: region.meta.budgetHi,
    override: p.spacingOverride,
  })

  const candidates = variablePoissonDisk(
    new RefRNG(p.seed), risk, widthKm, heightKm,
    budget.rMinKm, budget.rMaxKm, region.mask, 24, 200_000, seed.index,
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
    candidates, demand.xy, demand.w, p.detectKm,
    budget.greedyTarget, budget.maxNodes,
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
    meanRiskBurnable,
    budget,
    burnKm2,
  }
}
