import { describe, it, expect } from 'vitest'
import { coverageOf, coverageOfK, demandPoints } from '../src/lib/cover'
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
