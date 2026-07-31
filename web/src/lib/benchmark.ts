import type { Field } from './types'
import { uniformGrid, capToCommonCount } from './grid'
import { coverageOf, demandPoints } from './cover'

export interface BenchmarkPoint {
  /** The node budget asked for. */
  requested: number
  /** What both arms were actually scored on, after capping to the common count. */
  scored: number
  /** Risk-weighted coverage, risk-driven placement. */
  pyra: number
  /** Risk-weighted coverage, uniform grid. */
  uniform: number
  /** pyra - uniform, in percentage points. */
  deltaPP: number
}

export interface BenchmarkResult {
  points: BenchmarkPoint[]
  /** The point at the run's own node count — the headline pair. */
  atBudget: BenchmarkPoint
  /** Where the risk-driven arm leads by the most. */
  bestMargin: BenchmarkPoint
  /** The smallest budget at which the uniform grid takes the lead, if any. */
  crossoverNodes: number | null
  /** Scoring stride in km. Every coverage number shown must state this. */
  strideKm: number
  demandCount: number
  detectKm: number
}

const EMPTY: BenchmarkPoint = {
  requested: 0, scored: 0, pyra: 0, uniform: 0, deltaPP: 0,
}

/**
 * The node budgets to score. Roughly geometric so the small-budget end — where
 * the two strategies actually differ — is not swamped by the saturated end,
 * and always ending exactly at `maxNodes` so `atBudget` is a real measurement
 * rather than an interpolation.
 */
export function benchmarkBudgets(maxNodes: number, steps = 14): number[] {
  const n = Math.floor(maxNodes)
  if (n <= 0) return []
  if (n <= steps) return Array.from({ length: n }, (_, i) => i + 1)

  const out: number[] = []
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    const v = Math.round(Math.exp(t * Math.log(n)))
    const clamped = Math.min(Math.max(v, 1), n)
    if (out.length === 0 || clamped > out[out.length - 1]) out.push(clamped)
  }
  if (out[out.length - 1] !== n) out.push(n)
  return out
}

/**
 * Benchmark A: at the same realised node count, over the same region and the
 * same demand points, how much risk-weighted burnable demand does the
 * risk-driven placement cover, and how much does a uniform grid cover?
 *
 * Swept across node budgets rather than reported at one, because the answer
 * changes sign. Measured on Los Padres at detect 2 km: the risk-driven arm
 * leads by up to 3.6 pp around 170 nodes and trails by 4.2 pp at the 572-node
 * saturation budget, crossing near 270. Reporting either end alone would be a
 * cherry-pick.
 *
 * The sweep costs one extra `uniformGrid` per budget and nothing at all for
 * the risk-driven arm: `greedyMinimise` selects in descending marginal gain
 * and never revisits, so its first N nodes ARE the N-node solution.
 *
 * The uniform arm is given the burnable mask on purpose. That hands the
 * baseline part of the model's own input and makes it stronger — measured, it
 * scores 96.9% versus an unmasked grid's 98.4% at 572 requested, because the
 * unmasked grid wastes nodes on the Pacific. Any ambiguity is resolved in the
 * baseline's favour; a flattered baseline is worse than no benchmark.
 */
export function runBenchmark(args: {
  risk: Field
  mask: Field
  widthKm: number
  heightKm: number
  nodes: Float64Array
  detectKm: number
  demandStride: number
  strideKm: number
}): BenchmarkResult {
  const { risk, mask, widthKm, heightKm, nodes, detectKm } = args
  const total = nodes.length / 2
  const demand = demandPoints(risk, mask, widthKm, heightKm, args.demandStride)
  const demandCount = demand.xy.length / 2

  const base = {
    strideKm: args.strideKm,
    demandCount,
    detectKm,
  }
  if (total === 0 || demandCount === 0) {
    return {
      points: [], atBudget: EMPTY, bestMargin: EMPTY,
      crossoverNodes: null, ...base,
    }
  }

  const points: BenchmarkPoint[] = []
  for (const requested of benchmarkBudgets(total)) {
    // The first `requested` nodes are the `requested`-node greedy solution.
    const pyraArm = nodes.slice(0, 2 * requested)
    const gridArm = uniformGrid(widthKm, heightKm, requested, mask)
    // Neither arm reliably realises the count it was asked for, so cap both to
    // the common realised count before scoring. The site says "capped to the
    // same realised count", which is what this does — not "identical count".
    const [a, b] = capToCommonCount(pyraArm, gridArm)
    const scored = a.length / 2
    if (scored === 0) continue
    const [pyra] = coverageOf(a, demand.xy, demand.w, detectKm)
    const [uniform] = coverageOf(b, demand.xy, demand.w, detectKm)
    points.push({
      requested, scored, pyra, uniform,
      deltaPP: 100 * (pyra - uniform),
    })
  }

  if (points.length === 0) {
    return {
      points: [], atBudget: EMPTY, bestMargin: EMPTY,
      crossoverNodes: null, ...base,
    }
  }

  const atBudget = points[points.length - 1]
  const bestMargin = points.reduce((best, p) => (p.deltaPP > best.deltaPP ? p : best))
  const crossing = points.find((p) => p.deltaPP < 0)
  return {
    points,
    atBudget,
    bestMargin,
    crossoverNodes: crossing ? crossing.requested : null,
    ...base,
  }
}
