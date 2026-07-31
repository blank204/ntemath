import { describe, it, expect } from 'vitest'
import { benchmarkBudgets, runBenchmark } from '../src/lib/benchmark'
import { runPlacement, strideKm } from '../src/lib/pipeline'
import { uniformGrid, capToCommonCount } from '../src/lib/grid'
import { coverageOf, demandPoints } from '../src/lib/cover'
import { loadLosPadres, DEFAULT_TEST_PARAMS } from './helpers/losPadres'

describe('benchmarkBudgets', () => {
  it('is strictly increasing, starts small, and ends at the full count', () => {
    const b = benchmarkBudgets(572, 12)
    expect(b[0]).toBeGreaterThanOrEqual(1)
    expect(b[b.length - 1]).toBe(572)
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1])
    expect(b.length).toBeLessThanOrEqual(12)
  })

  it('degenerates gracefully for tiny networks', () => {
    expect(benchmarkBudgets(1, 12)).toEqual([1])
    expect(benchmarkBudgets(0, 12)).toEqual([])
    expect(benchmarkBudgets(3, 12)).toEqual([1, 2, 3])
  })
})

/**
 * One real placement and one real sweep, shared by every case below. Computed
 * on first use rather than at collection time so a slow region load cannot
 * time out the whole file.
 */
let cached: ReturnType<typeof build> | null = null
function build() {
  const region = loadLosPadres()
  const placed = runPlacement(region, DEFAULT_TEST_PARAMS)
  const d = demandPoints(
    placed.risk, region.mask, region.meta.widthKm, region.meta.heightKm,
    DEFAULT_TEST_PARAMS.demandStride,
  )
  const result = runBenchmark({
    risk: placed.risk, mask: region.mask,
    widthKm: region.meta.widthKm, heightKm: region.meta.heightKm,
    nodes: placed.nodes, detectKm: DEFAULT_TEST_PARAMS.detectKm,
    demandStride: DEFAULT_TEST_PARAMS.demandStride,
    strideKm: strideKm(region.meta, DEFAULT_TEST_PARAMS.demandStride),
  })
  return { region, placed, d, result }
}
function real() {
  if (cached === null) cached = build()
  return cached
}

describe('runBenchmark on the real region', () => {
  it('scores both arms on exactly the same number of nodes at every budget', () => {
    const { result } = real()
    expect(result.points.length).toBeGreaterThan(5)
    for (const p of result.points) {
      expect(p.scored).toBeGreaterThan(0)
      expect(p.scored).toBeLessThanOrEqual(p.requested)
    }
  }, 300000)

  it('reports a case where the two arms would NOT have matched without capping', () => {
    // The cap has to be doing work, or the fairness guarantee is a tautology
    // about array lengths — the defect Plan 1's Task 9 review found twice.
    const { region, placed } = real()
    const n = placed.nodeCount
    const grid = uniformGrid(region.meta.widthKm, region.meta.heightKm, n, region.mask)
    expect(grid.length / 2).not.toBe(n)                   // the arms differ raw
    const [a, b] = capToCommonCount(placed.nodes, grid)
    expect(a.length).toBe(b.length)                       // and match after capping
    expect(a.length / 2).toBe(Math.min(n, grid.length / 2))
  }, 300000)

  it('agrees with a directly computed head-to-head at the full budget', () => {
    const { region, placed, d, result } = real()
    const grid = uniformGrid(
      region.meta.widthKm, region.meta.heightKm, placed.nodeCount, region.mask,
    )
    const [ca, cb] = capToCommonCount(placed.nodes, grid)
    const [pw] = coverageOf(ca, d.xy, d.w, DEFAULT_TEST_PARAMS.detectKm)
    const [gw] = coverageOf(cb, d.xy, d.w, DEFAULT_TEST_PARAMS.detectKm)
    expect(result.atBudget.pyra).toBeCloseTo(pw, 12)
    expect(result.atBudget.uniform).toBeCloseTo(gw, 12)
  }, 300000)

  it('reproduces the measured curve, including the crossover', () => {
    // Measured against the committed rasters: the risk-driven arm leads at
    // small budgets by up to +3.55 pp at 132 nodes, the uniform grid leads at
    // the 572-node saturation budget by 4.17 pp, and the lead changes hands at
    // 285. If these move, the site's headline claim moved with them —
    // re-measure and rewrite the copy, do not adjust the assertion.
    //
    // 285 is bisected from the committed rasters. The plan's prose says "about
    // 270" from a coarser sweep taken before Task 1 re-baked risk.bin; 285 is
    // the measurement, and the copy must follow the measurement.
    const { result } = real()
    expect(result.bestMargin.deltaPP).toBeCloseTo(3.5488421301039463, 9)
    expect(result.bestMargin.requested).toBe(132)
    expect(result.atBudget.deltaPP).toBeCloseTo(-4.174842118917466, 9)
    expect(result.crossoverNodes).toBe(285)
    expect(result.crossoverBracket).toEqual([215, 351])
  }, 300000)

  it('bisects the crossover instead of reporting a ladder sample', () => {
    // The ladder samples 215 (pyra still ahead) and 351 (grid ahead), so a
    // `points.find(p => p.deltaPP < 0)` would report 351 as the crossover of a
    // curve that actually turns at 270 — the ladder's resolution dressed up as
    // a finding. Prove the reported node is a real sign change by scoring the
    // two budgets either side of it directly.
    const { region, placed, d, result } = real()
    const n = result.crossoverNodes!
    expect(result.points.some((p) => p.requested === n)).toBe(false)

    const deltaAt = (requested: number) => {
      const grid = uniformGrid(
        region.meta.widthKm, region.meta.heightKm, requested, region.mask,
      )
      const [a, b] = capToCommonCount(placed.nodes.slice(0, 2 * requested), grid)
      const pyra = coverageOf(a, d.xy, d.w, DEFAULT_TEST_PARAMS.detectKm)[0]
      const uniform = coverageOf(b, d.xy, d.w, DEFAULT_TEST_PARAMS.detectKm)[0]
      return 100 * (pyra - uniform)
    }
    expect(deltaAt(n)).toBeLessThan(0)
    expect(deltaAt(n - 1)).toBeGreaterThanOrEqual(0)
  }, 300000)

  it('takes the FIRST n nodes, which is what makes the sweep legitimate', () => {
    // greedyMinimise selects in descending marginal gain and never revisits,
    // so its first n entries ARE the n-node solution. Scoring the LAST n
    // instead would still produce a plausible-looking curve — and would be
    // measuring the worst nodes the run chose, not the best.
    const { region, placed, d, result } = real()
    const mid = result.points[Math.floor(result.points.length / 2)]
    const head = placed.nodes.slice(0, 2 * mid.requested)
    const tail = placed.nodes.slice(placed.nodes.length - 2 * mid.requested)
    const grid = uniformGrid(
      region.meta.widthKm, region.meta.heightKm, mid.requested, region.mask,
    )
    const [ha] = capToCommonCount(head, grid)
    const [ta] = capToCommonCount(tail, grid)
    const headCov = coverageOf(ha, d.xy, d.w, DEFAULT_TEST_PARAMS.detectKm)[0]
    const tailCov = coverageOf(ta, d.xy, d.w, DEFAULT_TEST_PARAMS.detectKm)[0]
    expect(mid.pyra).toBeCloseTo(headCov, 12)
    expect(headCov).toBeGreaterThan(tailCov)
  }, 300000)

  it('carries the stride and the demand count so the copy can state them', () => {
    const { d, result } = real()
    expect(result.strideKm).toBeCloseTo(0.36608429859016334, 9)
    expect(result.demandCount).toBe(d.xy.length / 2)
    expect(result.detectKm).toBe(DEFAULT_TEST_PARAMS.detectKm)
  }, 300000)
})

describe('runBenchmark degenerate inputs', () => {
  it('returns an empty curve when nothing was placed', () => {
    const r = runBenchmark({
      risk: { nx: 2, ny: 2, data: Float32Array.from([1, 1, 1, 1]) },
      mask: { nx: 2, ny: 2, data: Float32Array.from([1, 1, 1, 1]) },
      widthKm: 10, heightKm: 10, nodes: new Float64Array(0),
      detectKm: 2, demandStride: 1, strideKm: 5,
    })
    expect(r.points).toEqual([])
    expect(r.crossoverNodes).toBeNull()
    expect(r.atBudget.scored).toBe(0)
  })

  it('returns an empty curve when the mask leaves no demand to score', () => {
    const r = runBenchmark({
      risk: { nx: 2, ny: 2, data: Float32Array.from([1, 1, 1, 1]) },
      mask: { nx: 2, ny: 2, data: new Float32Array(4) },
      widthKm: 10, heightKm: 10, nodes: Float64Array.from([1, 1, 2, 2]),
      detectKm: 2, demandStride: 1, strideKm: 5,
    })
    expect(r.points).toEqual([])
    expect(r.demandCount).toBe(0)
  })
})
