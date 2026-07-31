import type { Field } from './types'
import { uniformGrid, capToCommonCount } from './grid'
import { coverageOfK, demandPoints } from './cover'

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
  /**
   * The smallest budget at which the uniform grid takes the lead, resolved to
   * a single node by bisection — NOT merely the first sampled budget with a
   * negative margin, which would report the ladder's resolution as a finding.
   */
  crossoverNodes: number | null
  /**
   * The two sampled budgets the crossover was bisected between. Carried so the
   * copy can say what was measured and what was interpolated.
   */
  crossoverBracket: [number, number] | null
  /** Scoring stride in km. Every coverage number shown must state this. */
  strideKm: number
  demandCount: number
  detectKm: number
  /**
   * How many towers a demand point needs in range to count as covered. 1 is
   * "some tower can hear it"; 2 is "two can", which is what a triangulating
   * network actually sells. Carried on the result so no coverage figure can
   * be shown without the rule that produced it.
   */
  minTowers: number
}

/**
 * How many budgets the displayed curve samples. It is the chart's resolution,
 * not the benchmark's: `crossoverNodes` is bisected between samples, so
 * raising this buys curve smoothness (one uniformGrid + two coverageOf each)
 * and not accuracy in the headline numbers.
 */
export const CURVE_STEPS = 14

const EMPTY: BenchmarkPoint = Object.freeze({
  requested: 0, scored: 0, pyra: 0, uniform: 0, deltaPP: 0,
})

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
 * changes sign. Reporting either end alone would be a cherry-pick.
 *
 * Measured on the committed Los Padres rasters — 572 nodes, 31,045 demand
 * points, 0.366 km scoring stride, detect 2.0 km. Coverage is risk-weighted:
 *
 *   requested  scored    pyra  uniform    delta
 *          50      45  12.69%   10.96%   +1.74
 *         132     124  33.44%   29.89%   +3.55   <- widest lead
 *         215     193  49.46%   46.57%   +2.88
 *         351     311  71.51%   74.49%   -2.98
 *         572     526  92.76%   96.93%   -4.17  <- the run's own budget
 *
 * The lead changes hands at 285 nodes, bisected between the 215 and 351
 * samples. Re-measure these figures whenever the rasters or the ladder move;
 * the copy layer quotes them.
 *
 * The sweep costs one extra `uniformGrid` per budget and nothing at all for
 * the risk-driven arm: `greedyMinimise` selects in descending marginal gain
 * and never revisits, so its first N nodes ARE the N-node solution.
 *
 * That prefix is the first N nodes of a SATURATION run, and it is not the same
 * network as `runPlacement(..., budgetMode: 'fixed', fixedNodes: N)` — a fixed
 * budget re-spaces the candidate pool through `budgetSpacing`. Sharing one
 * pool across the whole curve is what makes the sweep a like-for-like
 * comparison, but the Lab must not imply that dialling `fixed` to N reproduces
 * the curve's N-node point.
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
  /** Towers required in range per demand point. Defaults to 1. */
  minTowers?: number
}): BenchmarkResult {
  const { risk, mask, widthKm, heightKm, nodes, detectKm } = args
  const minTowers = args.minTowers ?? 1
  const total = nodes.length / 2
  const demand = demandPoints(risk, mask, widthKm, heightKm, args.demandStride)
  const demandCount = demand.xy.length / 2

  const base = {
    strideKm: args.strideKm,
    demandCount,
    detectKm,
    minTowers,
  }
  const empty = {
    points: [], atBudget: EMPTY, bestMargin: EMPTY,
    crossoverNodes: null, crossoverBracket: null, ...base,
  }
  if (total === 0 || demandCount === 0) return empty

  /** Score one budget: both arms, capped to their common realised count. */
  function scoreAt(requested: number): BenchmarkPoint | null {
    // The first `requested` nodes are the `requested`-node greedy solution.
    const pyraArm = nodes.slice(0, 2 * requested)
    const gridArm = uniformGrid(widthKm, heightKm, requested, mask)
    // Neither arm reliably realises the count it was asked for, so cap both to
    // the common realised count before scoring. The site says "capped to the
    // same realised count", which is what this does — not "identical count".
    const [a, b] = capToCommonCount(pyraArm, gridArm)
    const scored = a.length / 2
    if (scored === 0) return null
    const [pyra] = coverageOfK(a, demand.xy, demand.w, detectKm, minTowers)
    const [uniform] = coverageOfK(b, demand.xy, demand.w, detectKm, minTowers)
    return { requested, scored, pyra, uniform, deltaPP: 100 * (pyra - uniform) }
  }

  const points: BenchmarkPoint[] = []
  for (const requested of benchmarkBudgets(total, CURVE_STEPS)) {
    const p = scoreAt(requested)
    if (p !== null) points.push(p)
  }

  if (points.length === 0) return empty

  const atBudget = points[points.length - 1]
  const bestMargin = points.reduce((best, p) => (p.deltaPP > best.deltaPP ? p : best))

  // Where does the lead change hands for good? Take the LAST budget at which
  // the risk-driven arm still leads, not the first at which it does not: a
  // single noisy negative down at one or two nodes would otherwise be reported
  // as the crossover of a 572-node curve.
  let lastLead = -1
  for (let i = 0; i < points.length; i++) if (points[i].deltaPP >= 0) lastLead = i

  let crossoverNodes: number | null = null
  let crossoverBracket: [number, number] | null = null

  if (lastLead === points.length - 1) {
    // The risk-driven arm still leads at the largest budget measured: no
    // crossover exists within the swept range.
    crossoverNodes = null
  } else if (lastLead === -1) {
    // The grid leads even at the smallest budget measured. The crossover is at
    // or below that, and there is nothing smaller to bisect against.
    crossoverNodes = points[0].requested
    crossoverBracket = [0, points[0].requested]
  } else {
    // Bisect between the last leading sample and the first trailing one, so
    // the reported crossover is a property of the curve rather than of the
    // ladder's resolution. The pyra arm is free at every probe (it is still
    // just a prefix); each step costs one uniformGrid and two coverageOf.
    let lo = points[lastLead].requested       // pyra leads here
    let hi = points[lastLead + 1].requested   // grid leads here
    crossoverBracket = [lo, hi]
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      const p = scoreAt(mid)
      // An unscoreable budget cannot be the answer; step past it.
      if (p === null) { lo = mid; continue }
      if (p.deltaPP < 0) hi = mid
      else lo = mid
    }
    crossoverNodes = hi
  }

  return { points, atBudget, bestMargin, crossoverNodes, crossoverBracket, ...base }
}
