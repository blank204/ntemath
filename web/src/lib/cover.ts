import type { Field } from './types'
import { GridIndex } from './gridindex'
import { pairwiseSum } from './sum'

export interface CoverageResult {
  chosen: number[]
  coveredFraction: number
  areaFraction: number
  perNodeGain: number[]
}

/**
 * Sample the burnable area into weighted demand points.
 * Port of place.demand_points. `stride` is the resolution at which coverage
 * is scored, so it must be reported wherever a coverage number is shown.
 */
export function demandPoints(
  risk: Field, mask: Field | null,
  widthKm: number, heightKm: number, stride = 4,
): { xy: Float64Array; w: Float64Array } {
  const xs: number[] = []
  const ys: number[] = []
  const ws: number[] = []
  for (let j = 0; j < risk.ny; j += stride) {
    for (let i = 0; i < risk.nx; i += stride) {
      const r = risk.data[j * risk.nx + i]
      const m = mask === null ? 1 : mask.data[j * mask.nx + i]
      if (m > 0 && r > 0) {
        xs.push(((i + 0.5) / risk.nx) * widthKm)
        ys.push(((j + 0.5) / risk.ny) * heightKm)
        ws.push(r)
      }
    }
  }
  const xy = new Float64Array(xs.length * 2)
  for (let i = 0; i < xs.length; i++) { xy[2 * i] = xs[i]; xy[2 * i + 1] = ys[i] }
  return { xy, w: Float64Array.from(ws) }
}

/** (risk-weighted, unweighted) demand fraction within range of any node. */
export function coverageOf(
  candXY: Float64Array, demandXY: Float64Array,
  demandW: Float64Array, radiusKm: number,
): [number, number] {
  const nc = candXY.length / 2
  const nd = demandXY.length / 2
  if (nc === 0 || nd === 0) return [0, 0]

  const cx = new Float64Array(nc), cy = new Float64Array(nc)
  for (let i = 0; i < nc; i++) { cx[i] = candXY[2 * i]; cy[i] = candXY[2 * i + 1] }
  const index = new GridIndex(cx, cy, Math.max(radiusKm, 1e-6))

  const hitW: number[] = []
  let hits = 0
  for (let i = 0; i < nd; i++) {
    const d = index.nearestDistance(demandXY[2 * i], demandXY[2 * i + 1])
    if (d <= radiusKm) { hitW.push(demandW[i]); hits++ }
  }
  const total = pairwiseSum(demandW)
  return [total > 0 ? pairwiseSum(hitW) / total : 0, hits / nd]
}

/**
 * Fewest candidates bringing `target` of risk-weighted demand within range of
 * at least `k` of them.
 *
 * WHY THIS IS NOT `greedyMinimise` WITH A PARAMETER. "At least k" coverage is
 * NOT submodular for k >= 2: the first tower to reach a demand point buys
 * nothing, and the second buys all of it, so a marginal gain can RISE as the
 * chosen set grows. CELF's whole basis — a stored gain is an upper bound on
 * the true gain — is therefore invalid here, and reusing the lazy loop would
 * silently accept stale bounds that are too low. This one recomputes every
 * candidate's gain each round. That is O(candidates x demand-per-candidate)
 * per pick, which on the shipped region is ~22k operations a round: cheap,
 * because the blue-noise pool is small by construction.
 *
 * At k = 1 it is the same objective as `greedyMinimise` and a test asserts it
 * makes the same picks. The shipped single-coverage numbers still come from
 * `greedyMinimise`, which is the function with Python parity behind it.
 */
export function greedyMinimiseK(
  candXY: Float64Array, demandXY: Float64Array, demandW: Float64Array,
  radiusKm: number, k: number, target = 0.95, maxNodes: number | null = null,
): CoverageResult {
  const nc = candXY.length / 2
  const nd = demandXY.length / 2
  const empty: CoverageResult = {
    chosen: [], coveredFraction: 0, areaFraction: 0, perNodeGain: [],
  }
  if (nc === 0 || nd === 0) return empty
  const total = pairwiseSum(demandW)
  if (total <= 0) return empty

  const dx = new Float64Array(nd), dy = new Float64Array(nd)
  for (let i = 0; i < nd; i++) { dx[i] = demandXY[2 * i]; dy[i] = demandXY[2 * i + 1] }
  const dIndex = new GridIndex(dx, dy, Math.max(radiusKm, 1e-6))
  const sees: number[][] = new Array(nc)
  for (let i = 0; i < nc; i++) {
    sees[i] = seenDemand(dIndex, candXY[2 * i], candXY[2 * i + 1], radiusKm)
  }

  // How many chosen towers already reach each demand point. A point counts
  // once its tally reaches k, and never again.
  const seenBy = new Int32Array(nd)
  const taken = new Uint8Array(nc)
  const chosen: number[] = []
  const gains: number[] = []
  const limit = maxNodes ?? nc
  const need = Math.max(1, Math.floor(k))
  let got = 0

  // Which demand points COULD ever be seen k times, by every candidate in
  // the pool at once. Chasing the rest would spend towers on ground that can
  // never be triangulated no matter what is built — and at k >= 2 the naive
  // objective is blind to this: a first tower on an isolated point scores
  // zero completion gain, so the search would stall on the opening move.
  const reach = new Int32Array(nd)
  for (let i = 0; i < nc; i++) for (const d of sees[i]) reach[d]++

  while (got / total < target && chosen.length < limit) {
    let bestI = -1
    let bestGain = 0
    let bestFinish = 0
    for (let i = 0; i < nc; i++) {
      if (taken[i]) continue
      // Progress towards k, which is submodular and therefore greedy-safe:
      // every step a reachable point takes towards its k-th tower counts the
      // same. Completion gain is carried alongside purely as a tie-break —
      // between two picks that make equal progress, the one that finishes
      // pairs is strictly better for the objective being measured.
      const vals: number[] = []
      const finishing: number[] = []
      for (const d of sees[i]) {
        if (reach[d] < need || seenBy[d] >= need) continue
        vals.push(demandW[d])
        if (seenBy[d] === need - 1) finishing.push(demandW[d])
      }
      const g = vals.length ? pairwiseSum(vals) : 0
      const f = finishing.length ? pairwiseSum(finishing) : 0
      // Ties go to the lower index, matching the ordering greedyMinimise's
      // heap gives (its entries are (-gain, i, stamp) and `i` is unique).
      if (g > bestGain || (g === bestGain && g > 0 && f > bestFinish)) {
        bestGain = g; bestFinish = f; bestI = i
      }
    }
    // Nothing left that can ever reach k. With k >= 2 that happens long
    // before the budget runs out, and spending the rest on zero-gain picks
    // would report towers that buy nothing.
    if (bestI < 0 || bestGain <= 0) break

    taken[bestI] = 1
    for (const d of sees[bestI]) seenBy[d]++
    const coveredVals: number[] = []
    for (let d = 0; d < nd; d++) if (seenBy[d] >= need) coveredVals.push(demandW[d])
    got = pairwiseSum(coveredVals)
    chosen.push(bestI)
    gains.push(bestGain / total)
  }

  let hits = 0
  for (let d = 0; d < nd; d++) if (seenBy[d] >= need) hits++

  return {
    chosen,
    coveredFraction: got / total,
    areaFraction: hits / nd,
    perNodeGain: gains,
  }
}

/**
 * Demand fraction within range of at least `k` towers.
 *
 * WHY K MATTERS HERE. One tower already gives a fix: flash-to-bang for the
 * range, the microphone array for the bearing. Two turn that into an
 * intersection, and the error stops resting on how well a single array
 * resolved an angle. So "covered" for a triangulating network is not "some
 * tower can hear it" but "two can".
 *
 * At k = 1 this returns exactly what `coverageOf` returns, and a test pins
 * that — the two must never drift, because every published single-coverage
 * figure comes from the other one.
 */
export function coverageOfK(
  candXY: Float64Array, demandXY: Float64Array,
  demandW: Float64Array, radiusKm: number, k: number,
): [number, number] {
  if (k <= 1) return coverageOf(candXY, demandXY, demandW, radiusKm)
  const nc = candXY.length / 2
  const nd = demandXY.length / 2
  if (nc === 0 || nd === 0) return [0, 0]

  const cx = new Float64Array(nc), cy = new Float64Array(nc)
  for (let i = 0; i < nc; i++) { cx[i] = candXY[2 * i]; cy[i] = candXY[2 * i + 1] }
  const index = new GridIndex(cx, cy, Math.max(radiusKm, 1e-6))

  // Accumulated in demand order, like coverageOf, so the two agree on the
  // float64 summation order as well as on the answer.
  const hitW: number[] = []
  let hits = 0
  for (let i = 0; i < nd; i++) {
    const seen = index.withinRadius(demandXY[2 * i], demandXY[2 * i + 1], radiusKm)
    if (seen.length >= k) { hitW.push(demandW[i]); hits++ }
  }
  const total = pairwiseSum(demandW)
  return [total > 0 ? pairwiseSum(hitW) / total : 0, hits / nd]
}

/**
 * The demand indices one candidate sees, in the order scipy would return
 * them: **ascending**.
 *
 * `cKDTree.query_ball_point(cand_xy, r=...)`, called with the full candidate
 * array at once, sorts each hit list ascending by demand index (its
 * documented multi-point behaviour). pairwiseSum is sensitive to element
 * order, so GridIndex's set-only guarantee is not enough — its bucket walk
 * returns hit lists in bucket order, which on the committed Los Padres data
 * is non-ascending for 923 of 927 candidates. Sorting here is what makes the
 * gain sums reproduce Python's bit for bit.
 *
 * Split out so the ordering guarantee can be asserted on its own — see the
 * note on CELF_TOLERANCE for why cover.json cannot catch its removal.
 */
export function seenDemand(
  index: GridIndex, x: number, y: number, radiusKm: number,
): number[] {
  const s = index.withinRadius(x, y, radiusKm)
  s.sort((a, b) => a - b)
  return s
}

/**
 * Slack allowed when comparing a refreshed CELF gain against the best stale
 * bound still on the heap. Mirrors place.py:265's `- 1e-12`.
 *
 * KEEP IT, but do not believe it is covered by the fixtures. On any fixture
 * built from float32 risk weights this branch is mathematically unreachable:
 * every weight is a float32 in [0, 1], hence an integer multiple of 2^-26, so
 * every partial sum is too. The smallest non-zero margin
 * `trueGain - bestStaleGain` can therefore take is 2^-26 ~ 1.49e-8 — four
 * orders of magnitude above 1e-12 — and float addition over such values is
 * exact (<= 40 significand bits), so no rounding noise can land inside the
 * window either. Deleting the tolerance ships green against cover.json with
 * exactly zero delta, and a risk-plateau fixture would not change that: it
 * would have the same exactness property. The predicate is tested directly
 * instead, in tests/numerics.test.ts.
 */
export const CELF_TOLERANCE = 1e-12

/**
 * The CELF refresh predicate: is a candidate's freshly recomputed gain good
 * enough to accept, given the best *stale* upper bound left on the heap?
 *
 * Split out of greedyMinimise so it can be exercised on its own — see
 * CELF_TOLERANCE for why no fixture can reach the tolerance.
 */
export function celfAcceptsRefresh(
  trueGain: number, bestStaleGain: number,
): boolean {
  return trueGain >= bestStaleGain - CELF_TOLERANCE
}

/**
 * Fewest candidates covering `target` of risk-weighted demand.
 *
 * Lazy greedy (CELF): marginal gain is submodular, so a stored gain is always
 * an upper bound on the true gain. A candidate whose refreshed gain still
 * beats every other candidate's stale bound is provably the best pick.
 *
 * The Python pushes tuples (-gain, i, stamp) into heapq. Because `i` is unique
 * the ordering is total, so any correct priority queue reproduces the pop
 * sequence exactly — no need to mirror CPython's sift implementation.
 */
export function greedyMinimise(
  candXY: Float64Array, demandXY: Float64Array, demandW: Float64Array,
  radiusKm: number, target = 0.95, maxNodes: number | null = null,
): CoverageResult {
  const nc = candXY.length / 2
  const nd = demandXY.length / 2
  const empty: CoverageResult = {
    chosen: [], coveredFraction: 0, areaFraction: 0, perNodeGain: [],
  }
  if (nc === 0 || nd === 0) return empty

  const total = pairwiseSum(demandW)
  if (total <= 0) return empty

  // Which demand points each candidate can see.
  const dx = new Float64Array(nd), dy = new Float64Array(nd)
  for (let i = 0; i < nd; i++) { dx[i] = demandXY[2 * i]; dy[i] = demandXY[2 * i + 1] }
  const dIndex = new GridIndex(dx, dy, Math.max(radiusKm, 1e-6))

  // Which demand points each candidate can see, in scipy's ascending order —
  // see seenDemand for why the ordering is load-bearing.
  const sees: number[][] = new Array(nc)
  for (let i = 0; i < nc; i++) {
    sees[i] = seenDemand(dIndex, candXY[2 * i], candXY[2 * i + 1], radiusKm)
  }

  const covered = new Uint8Array(nd)
  const chosen: number[] = []
  const gains: number[] = []
  const limit = maxNodes ?? nc

  type Entry = [number, number, number]      // [-gain, i, stamp]
  const cmp = (a: Entry, b: Entry) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

  const heap: Entry[] = []
  const push = (e: Entry) => {
    heap.push(e)
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (cmp(heap[c], heap[p]) < 0) { [heap[c], heap[p]] = [heap[p], heap[c]]; c = p }
      else break
    }
  }
  const pop = (): Entry | undefined => {
    if (heap.length === 0) return undefined
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let p = 0
      for (;;) {
        const l = 2 * p + 1, r = l + 1
        let m = p
        if (l < heap.length && cmp(heap[l], heap[m]) < 0) m = l
        if (r < heap.length && cmp(heap[r], heap[m]) < 0) m = r
        if (m === p) break
        ;[heap[p], heap[m]] = [heap[m], heap[p]]
        p = m
      }
    }
    return top
  }

  const gainOf = (i: number): number => {
    const s = sees[i]
    if (s.length === 0) return 0
    const vals: number[] = []
    for (const d of s) if (!covered[d]) vals.push(demandW[d])
    return pairwiseSum(vals)
  }

  for (let i = 0; i < nc; i++) {
    const s = sees[i]
    const vals: number[] = []
    for (const d of s) vals.push(demandW[d])
    push([s.length ? -pairwiseSum(vals) : 0, i, -1])
  }

  let got = 0
  let it = 0
  while (got / total < target && chosen.length < limit && heap.length > 0) {
    it++
    let best: [number, number] | null = null
    for (;;) {
      const e = pop()
      if (e === undefined) break
      const [, i, stamp] = e
      const trueGain = gainOf(i)
      if (trueGain <= 0) continue
      if (
        stamp === it || heap.length === 0 ||
        celfAcceptsRefresh(trueGain, -heap[0][0])
      ) {
        best = [i, trueGain]
        break
      }
      push([-trueGain, i, it])
    }
    if (best === null) break

    const [i, g] = best
    for (const d of sees[i]) covered[d] = 1
    const coveredVals: number[] = []
    for (let d = 0; d < nd; d++) if (covered[d]) coveredVals.push(demandW[d])
    got = pairwiseSum(coveredVals)
    chosen.push(i)
    gains.push(g / total)
  }

  let hits = 0
  for (let d = 0; d < nd; d++) if (covered[d]) hits++

  return {
    chosen,
    coveredFraction: got / total,
    areaFraction: hits / nd,
    perNodeGain: gains,
  }
}
