import { runPlacement, strideKm } from '../lib/pipeline'
import type { PlaceParams, PlaceResult } from '../lib/pipeline'
import { runBenchmark, type BenchmarkResult } from '../lib/benchmark'
import { coverageOfK, demandPoints, greedyMinimiseK } from '../lib/cover'
import type { RegionData } from '../lib/loadRegion'

/**
 * Runs the siting pipeline and Benchmark A off the main thread.
 *
 * Placement on a real region is hundreds of milliseconds of tight numeric
 * work, and the benchmark adds one uniformGrid and two coverageOf calls per
 * sampled budget on top. On the main thread that would stall the map and,
 * later, the scroll — so it never runs there.
 *
 * Every message carries a `runId`, an integer the caller increments once per
 * run and echoes back on `done`/`error`. Two placement runs can be in flight
 * at once — e.g. a user drags a slider, a run starts, they drag again before
 * it finishes — and without this id the caller cannot tell which response
 * belongs to which request. A stale response for a superseded run must be
 * ignored rather than allowed to overwrite a newer result; the worker's job
 * here is only to make that possible by always echoing the id it was given.
 */
export interface RunMessage {
  type: 'run'
  runId: number
  region: RegionData
  params: PlaceParams
}

export interface DoneMessage {
  type: 'done'
  runId: number
  result: PlaceResult
  /** Benchmark A: covered means at least one tower in range. */
  benchmark: BenchmarkResult
  /**
   * Benchmark C: covered means at least TWO towers in range — the rule a
   * triangulating network is actually sold on. Computed from the same
   * placement and the same demand points as `benchmark`, because two
   * coverage numbers taken from different runs cannot be compared.
   */
  triangulation: BenchmarkResult
  /** What re-optimising the same towers for the two-tower rule costs and buys. */
  doubleCoverage: DoubleCoverageArms
}

/**
 * The same candidate pool and the same tower count, selected twice: once to
 * maximise single coverage (which is what the site ships) and once to
 * maximise double coverage.
 *
 * Both numbers for both arms, because it is a trade rather than a free win —
 * triangulating more ground means hearing less of it at all, and a panel
 * showing only the column that improved would be selling.
 */
export interface DoubleCoverageArms {
  nodeCount: number
  /** The shipped placement. */
  siteSingle: number
  siteDouble: number
  /** The same towers re-chosen for the two-tower rule. */
  tunedSingle: number
  tunedDouble: number
}

export interface ErrorMessage {
  type: 'error'
  runId: number
  message: string
}

/**
 * The whole body of a run: place, benchmark, and name the buffers to transfer.
 *
 * Split out of the message handler so it can be tested. The transfer list is
 * the riskiest line in this file — three buffers that must be distinct, must
 * each own their whole ArrayBuffer, and must all have been read from before
 * they are handed away. Get any of that wrong and it is a runtime
 * `DataCloneError` or a silently truncated raster, neither of which the type
 * checker can see.
 */
export function buildDone(
  runId: number, region: RegionData, params: PlaceParams,
): { message: DoneMessage; transfer: ArrayBufferLike[] } {
  const result = runPlacement(region, params)
  const benchArgs = {
    risk: result.risk,
    mask: region.mask,
    widthKm: region.meta.widthKm,
    heightKm: region.meta.heightKm,
    nodes: result.nodes,
    detectKm: params.detectKm,
    demandStride: params.demandStride,
    strideKm: strideKm(region.meta, params.demandStride),
  }
  const benchmark = runBenchmark(benchArgs)
  const triangulation = runBenchmark({ ...benchArgs, minTowers: 2 })

  // Re-select from the SAME candidate pool at the SAME count, for the other
  // rule. About 65 ms on the shipped region — the pool is small by
  // construction, which is what makes the plain (non-lazy) greedy affordable.
  const demand = demandPoints(
    result.risk, region.mask,
    region.meta.widthKm, region.meta.heightKm, params.demandStride,
  )
  const tunedPick = greedyMinimiseK(
    result.candidates, demand.xy, demand.w, params.detectKm, 2,
    params.target, result.nodeCount,
  )
  const tunedXY = new Float64Array(tunedPick.chosen.length * 2)
  tunedPick.chosen.forEach((idx, j) => {
    tunedXY[2 * j] = result.candidates[2 * idx]
    tunedXY[2 * j + 1] = result.candidates[2 * idx + 1]
  })
  const doubleCoverage: DoubleCoverageArms = {
    nodeCount: result.nodeCount,
    siteSingle: coverageOfK(result.nodes, demand.xy, demand.w, params.detectKm, 1)[0],
    siteDouble: coverageOfK(result.nodes, demand.xy, demand.w, params.detectKm, 2)[0],
    tunedSingle: coverageOfK(tunedXY, demand.xy, demand.w, params.detectKm, 1)[0],
    tunedDouble: coverageOfK(tunedXY, demand.xy, demand.w, params.detectKm, 2)[0],
  }
  // Transfer the big buffers rather than structured-cloning them. `risk` goes
  // too: the map re-renders its raster from it, so the reader sees the field
  // itself change when a weight moves. runBenchmark has already read all three
  // by this point — `BenchmarkResult` is plain scalars and copies, holding no
  // view back onto them.
  return {
    message: {
      type: 'done', runId, result, benchmark, triangulation, doubleCoverage,
    },
    transfer: [
      result.candidates.buffer, result.nodes.buffer, result.risk.data.buffer,
    ],
  }
}

// Guarded so the module can be imported on the main thread — which the tests
// do, to exercise `buildDone` and its transfer list without a Worker. Outside
// a worker there is no `self` to attach a handler to.
if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent<RunMessage>) => {
    if (e.data?.type !== 'run') return
    const { runId } = e.data
    try {
      const { message, transfer } = buildDone(runId, e.data.region, e.data.params)
      ;(self as unknown as Worker).postMessage(
        message, transfer as unknown as Transferable[],
      )
    } catch (err) {
      ;(self as unknown as Worker).postMessage({
        type: 'error',
        runId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies ErrorMessage)
    }
  }
}
