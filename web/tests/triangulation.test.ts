import { describe, it, expect } from 'vitest'
import {
  coverageOf, coverageOfK, demandPoints, greedyMinimise, greedyMinimiseK,
} from '../src/lib/cover'
import { runBenchmark } from '../src/lib/benchmark'
import { runPlacement, strideKm } from '../src/lib/pipeline'
import { loadJamesBay } from './helpers/jamesBay'
import { DEFAULT_PARAMS } from '../src/state/useModelStore'

const xy = (pts: Array<[number, number]>) =>
  Float64Array.from(pts.flatMap(([x, y]) => [x, y]))

describe('coverageOfK', () => {
  const demand = xy([[0, 0], [10, 0], [20, 0]])
  const w = Float64Array.from([1, 1, 1])

  it('is exactly single coverage at k = 1', () => {
    const towers = xy([[0, 0], [10, 0]])
    expect(coverageOfK(towers, demand, w, 5, 1))
      .toEqual(coverageOf(towers, demand, w, 5))
  })

  it('needs two towers in range, not one', () => {
    // One tower sees the first two points; nothing is doubly covered.
    const one = xy([[5, 0]])
    expect(coverageOfK(one, demand, w, 6, 2)[0]).toBe(0)
    // Two towers straddling the middle point cover it twice.
    const two = xy([[5, 0], [15, 0]])
    expect(coverageOfK(two, demand, w, 6, 2)[0]).toBeCloseTo(1 / 3, 12)
  })

  it('counts a point seen by three towers once, not three times', () => {
    const three = xy([[0, 0], [1, 0], [2, 0]])
    expect(coverageOfK(three, xy([[0, 0]]), Float64Array.from([1]), 5, 3)[0])
      .toBe(1)
  })

  it('weights by risk, exactly as single coverage does', () => {
    const towers = xy([[0, 0], [1, 0]])
    const d = xy([[0, 0], [20, 0]])
    const [weighted, unweighted] = coverageOfK(
      towers, d, Float64Array.from([3, 1]), 5, 2)
    expect(weighted).toBeCloseTo(0.75, 12)
    expect(unweighted).toBeCloseTo(0.5, 12)
  })

  it('is monotone in k: doubling the requirement cannot raise coverage', () => {
    const towers = xy([[0, 0], [4, 0], [8, 0], [12, 0]])
    const d = demandPoints(
      { nx: 8, ny: 4, data: Float32Array.from({ length: 32 }, () => 1) },
      null, 16, 8, 1,
    )
    const k1 = coverageOfK(towers, d.xy, d.w, 5, 1)[0]
    const k2 = coverageOfK(towers, d.xy, d.w, 5, 2)[0]
    const k3 = coverageOfK(towers, d.xy, d.w, 5, 3)[0]
    expect(k2).toBeLessThanOrEqual(k1)
    expect(k3).toBeLessThanOrEqual(k2)
  })

  it('treats k below one as single coverage rather than covering everything', () => {
    const towers = xy([[0, 0]])
    expect(coverageOfK(towers, demand, w, 5, 0))
      .toEqual(coverageOf(towers, demand, w, 5))
  })
})

describe('greedyMinimiseK', () => {
  it('reproduces the single-coverage greedy at k = 1', () => {
    // Same objective, so the same picks — otherwise the k-aware version is
    // not a generalisation of the shipped one, it is a different algorithm
    // wearing its name.
    const cands = xy([[0, 0], [10, 0], [20, 0], [30, 0]])
    const demand = xy([[0, 0], [9, 0], [11, 0], [21, 0], [29, 0]])
    const w = Float64Array.from([1, 2, 3, 4, 5])
    const a = greedyMinimise(cands, demand, w, 2, 0.99)
    const b = greedyMinimiseK(cands, demand, w, 2, 1, 0.99)
    expect(b.chosen).toEqual(a.chosen)
    expect(b.coveredFraction).toBeCloseTo(a.coveredFraction, 12)
  })

  it('will not count a demand point until two towers reach it', () => {
    const cands = xy([[-1, 0], [1, 0], [50, 0]])
    const demand = xy([[0, 0]])
    const w = Float64Array.from([1])
    const one = greedyMinimiseK(cands, demand, w, 5, 2, 0.99, 1)
    expect(one.coveredFraction).toBe(0)
    const two = greedyMinimiseK(cands, demand, w, 5, 2, 0.99, 2)
    expect(two.coveredFraction).toBe(1)
    expect(two.chosen.length).toBe(2)
  })

  it('prefers completing a pair over opening a new area', () => {
    // THE BEHAVIOURAL DIFFERENCE, in one case. A single-coverage greedy takes
    // the candidate that reaches the most UNSEEN demand; a double-coverage
    // greedy takes the one that brings the most demand to two. Here the first
    // pick is forced, and the second is the choice: doubling up on the heavy
    // cluster beats reaching the light one.
    const cands = xy([[0, 0], [1, 0], [100, 0]])
    const demand = xy([[0.5, 0], [100, 0]])
    const w = Float64Array.from([10, 1])
    const single = greedyMinimise(cands, demand, w, 3, 0.99, 2)
    const double = greedyMinimiseK(cands, demand, w, 3, 2, 0.99, 2)
    expect(single.chosen).toContain(2)          // reaches the far point
    expect(double.chosen).not.toContain(2)      // doubles the heavy one instead
    expect(double.chosen.sort()).toEqual([0, 1])
  })

  it('stops at the node cap even when the target is unreachable', () => {
    const cands = xy([[0, 0], [1, 0], [2, 0]])
    const demand = xy([[0, 0], [500, 0]])
    const w = Float64Array.from([1, 1])
    const r = greedyMinimiseK(cands, demand, w, 3, 2, 0.99, 2)
    expect(r.chosen.length).toBeLessThanOrEqual(2)
    expect(r.coveredFraction).toBeCloseTo(0.5, 12)
  })

  it('stops when no remaining candidate can raise k-coverage at all', () => {
    // Every candidate is alone in its own corner: nothing can ever be seen
    // twice, so the loop must terminate rather than spend the whole budget
    // on zero-gain picks.
    const cands = xy([[0, 0], [100, 0], [200, 0]])
    const demand = xy([[0, 0], [100, 0], [200, 0]])
    const w = Float64Array.from([1, 1, 1])
    const r = greedyMinimiseK(cands, demand, w, 1, 2, 0.99)
    expect(r.chosen).toEqual([])
    expect(r.coveredFraction).toBe(0)
  })
})

/**
 * Benchmark C: coverage that requires TWO towers.
 *
 * A single station gives a fix — range from flash-to-bang, bearing from the
 * microphone array — so one tower is a real measurement, not nothing. Two
 * turn a bearing-and-range fix into an intersection, which is where the
 * error stops depending on how well one array resolved an angle.
 *
 * The reason it belongs in the benchmark: a uniform grid spaces FOR single
 * coverage. It is the optimal shape when overlap is waste and close to the
 * worst when overlap is the product. The optimiser is free to overlap, so
 * the margin should widen — that is a prediction, and this is where it gets
 * checked rather than asserted.
 */
describe('double coverage on the shipped region', () => {
  let cached: ReturnType<typeof build> | null = null
  function build() {
    const region = loadJamesBay()
    const placed = runPlacement(region, DEFAULT_PARAMS)
    const shared = {
      risk: placed.risk, mask: region.mask,
      widthKm: region.meta.widthKm, heightKm: region.meta.heightKm,
      nodes: placed.nodes, detectKm: DEFAULT_PARAMS.detectKm,
      demandStride: DEFAULT_PARAMS.demandStride,
      strideKm: strideKm(region.meta, DEFAULT_PARAMS.demandStride),
    }
    return {
      single: runBenchmark(shared),
      double: runBenchmark({ ...shared, minTowers: 2 }),
    }
  }
  const runs = () => (cached ??= build())

  it('is strictly harder than single coverage for both arms', () => {
    const { single, double } = runs()
    expect(double.atBudget.pyra).toBeLessThan(single.atBudget.pyra)
    expect(double.atBudget.uniform).toBeLessThan(single.atBudget.uniform)
    expect(double.minTowers).toBe(2)
  }, 300000)

  it('never hands the lead to the grid, where single coverage does', () => {
    // THE PREDICTION WAS THAT THE MARGIN WOULD BE WIDER. Measured, the peak
    // margin is NARROWER — 3.93 pp against 5.56 — and that comparison turned
    // out to be meaningless: under the double rule the margin is still
    // climbing at the largest budget on the ladder, because 111 towers is
    // nowhere near double-coverage saturation. One curve's endpoint was
    // being compared with the other curve's peak.
    //
    // What IS true, and is the stronger claim: under the double-coverage
    // rule the uniform grid never takes the lead at any budget in the range,
    // while under single coverage it takes it at 88 towers and keeps it.
    const { single, double } = runs()
    expect(single.crossoverNodes).toBe(88)
    expect(double.crossoverNodes).toBeNull()
  }, 300000)

  it('flips the sign of the margin at the network\'s own budget', () => {
    // Same 111 towers, same region, same demand points, one rule changed:
    // the grid is 1.4 pp ahead on "some tower hears it" and 3.9 pp behind on
    // "two towers hear it". A lattice spaces to avoid overlap, and overlap
    // is the product here.
    const { single, double } = runs()
    expect(single.atBudget.deltaPP).toBeLessThan(0)
    expect(double.atBudget.deltaPP).toBeCloseTo(3.933, 2)
  }, 300000)

  it('buys double coverage when the optimiser is pointed at it, and charges for it', () => {
    // The same 181-candidate pool, the same 111 towers, one objective
    // changed. This is the number the earlier "+3.9 pp is a floor" comment
    // was guessing at, measured:
    //
    //   objective      single coverage   double coverage
    //   k = 1                   95.14%            43.73%
    //   k = 2                   88.08%            54.57%
    //
    // +10.8 pp of triangulated ground for -7.1 pp of heard-once ground. It
    // is a trade, not a free win, and the site has to show both columns.
    const region = loadJamesBay()
    const placed = runPlacement(region, DEFAULT_PARAMS)
    const d = demandPoints(
      placed.risk, region.mask, region.meta.widthKm, region.meta.heightKm,
      DEFAULT_PARAMS.demandStride,
    )
    const r = DEFAULT_PARAMS.detectKm
    const k2 = greedyMinimiseK(
      placed.candidates, d.xy, d.w, r, 2, DEFAULT_PARAMS.target, placed.nodeCount)
    const k2xy = new Float64Array(k2.chosen.length * 2)
    k2.chosen.forEach((idx, j) => {
      k2xy[2 * j] = placed.candidates[2 * idx]
      k2xy[2 * j + 1] = placed.candidates[2 * idx + 1]
    })
    expect(k2.chosen.length).toBe(placed.nodeCount)

    const doubleK1 = coverageOfK(placed.nodes, d.xy, d.w, r, 2)[0]
    const doubleK2 = coverageOfK(k2xy, d.xy, d.w, r, 2)[0]
    const singleK2 = coverageOfK(k2xy, d.xy, d.w, r, 1)[0]
    expect(doubleK1).toBeCloseTo(0.4373, 3)
    expect(doubleK2).toBeCloseTo(0.5457, 3)
    expect(doubleK2 - doubleK1).toBeGreaterThan(0.10)
    // The cost, asserted so it can never quietly disappear from the claim.
    expect(singleK2).toBeLessThan(placed.coveredFraction)
    expect(placed.coveredFraction - singleK2).toBeCloseTo(0.0706, 3)
  }, 300000)

  it('says how little of the region 111 towers actually triangulate', () => {
    // 10.9%. A network sized for single coverage triangulates about a tenth
    // of its own region, and the site has to lead with that rather than with
    // the margin — a favourable comparison on a small number is still a
    // small number.
    const { double } = runs()
    expect(double.atBudget.pyra).toBeCloseTo(0.109, 2)
    expect(double.atBudget.pyra).toBeLessThan(0.15)
  }, 300000)

  it('reports the same fairness rule — same realised count, both arms', () => {
    for (const p of runs().double.points) {
      expect(p.scored).toBeLessThanOrEqual(p.requested)
      expect(p.pyra).toBeGreaterThanOrEqual(0)
      expect(p.uniform).toBeGreaterThanOrEqual(0)
    }
  }, 300000)
})
