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

  // scipy's cKDTree.query_ball_point(cand_xy, r=radius_km), called with the
  // full candidate array at once, returns each hit list sorted ascending by
  // demand index (its documented "multi-point query" behaviour). pairwiseSum
  // is sensitive to element order, so GridIndex's set-only guarantee is not
  // enough here: sort each hit list the same way scipy does, or a gain sum
  // can differ in the last bit and flip a heap comparison against Python.
  const sees: number[][] = new Array(nc)
  for (let i = 0; i < nc; i++) {
    const s = dIndex.withinRadius(candXY[2 * i], candXY[2 * i + 1], radiusKm)
    s.sort((a, b) => a - b)
    sees[i] = s
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
      if (stamp === it || heap.length === 0 || trueGain >= -heap[0][0] - 1e-12) {
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
