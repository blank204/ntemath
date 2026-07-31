import type { RegionData } from './loadRegion'
import { RefRNG } from './refrng'
import { variablePoissonDisk } from './poisson'
import { demandPoints, greedyMinimise } from './cover'

export interface PlaceParams {
  seed: number
  detectKm: number
  rMinKm: number
  rMaxKm: number
  target: number
  demandStride: number
  maxNodes: number | null
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
  const { widthKm, heightKm, seedFlatIndex, nx, ny, name } = region.meta

  // `RegionMeta` is decoded through a compile-time cast in loadRegion (the
  // fetched JSON is asserted, not validated), so a stale meta.json can leave
  // `seedFlatIndex` `undefined` at runtime even though the type claims
  // `number`. Without it, variablePoissonDisk falls back to its own scan,
  // which starts from a different pixel than place.py did and produces a
  // completely different network — fail loudly instead of silently drifting.
  const maxFlat = nx * ny
  if (
    seedFlatIndex === undefined ||
    seedFlatIndex === null ||
    !Number.isInteger(seedFlatIndex) ||
    seedFlatIndex < 0 ||
    seedFlatIndex >= maxFlat
  ) {
    throw new Error(
      `region "${name}" has an invalid meta.seedFlatIndex (${String(seedFlatIndex)}); ` +
      `expected an integer in [0, ${maxFlat}). Re-bake the region so placement can ` +
      `start from the same pixel place.py did.`,
    )
  }

  const candidates = variablePoissonDisk(
    new RefRNG(p.seed), region.risk, widthKm, heightKm,
    p.rMinKm, p.rMaxKm, region.mask, 24, 200_000, seedFlatIndex,
  )

  // variablePoissonDisk returns empty when the seed pixel fails the mask
  // check (e.g. a region whose seedFlatIndex was resolved against a
  // different mask than the one shipped). Silently continuing would hand
  // the site an empty network as if it were a real result — the same
  // silent-wrong-answer failure the seedFlatIndex guard above exists to
  // prevent, so fail loudly here too.
  if (candidates.length === 0) {
    throw new Error(
      `region "${name}" produced zero placement candidates: the seed pixel ` +
      `at meta.seedFlatIndex=${seedFlatIndex} is not allowed by the mask. ` +
      `Re-bake the region so the seed index and mask agree.`,
    )
  }

  const demand = demandPoints(
    region.risk, region.mask, widthKm, heightKm, p.demandStride,
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
  }
}
