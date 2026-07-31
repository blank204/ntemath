import { runPlacement, strideKm } from '../lib/pipeline'
import type { PlaceParams, PlaceResult } from '../lib/pipeline'
import { runBenchmark, type BenchmarkResult } from '../lib/benchmark'
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
  benchmark: BenchmarkResult
}

export interface ErrorMessage {
  type: 'error'
  runId: number
  message: string
}

self.onmessage = (e: MessageEvent<RunMessage>) => {
  if (e.data?.type !== 'run') return
  const { runId } = e.data
  try {
    const { region, params } = e.data
    const result = runPlacement(region, params)
    const benchmark = runBenchmark({
      risk: result.risk,
      mask: region.mask,
      widthKm: region.meta.widthKm,
      heightKm: region.meta.heightKm,
      nodes: result.nodes,
      detectKm: params.detectKm,
      demandStride: params.demandStride,
      strideKm: strideKm(region.meta, params.demandStride),
    })
    // Transfer the big buffers rather than structured-cloning them. `risk`
    // goes too: the map re-renders its raster from it, so the reader sees the
    // field itself change when a weight moves. Transfer happens after
    // runBenchmark has read them, never before.
    ;(self as unknown as Worker).postMessage(
      { type: 'done', runId, result, benchmark } satisfies DoneMessage,
      [
        result.candidates.buffer, result.nodes.buffer, result.risk.data.buffer,
      ] as unknown as Transferable[],
    )
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      type: 'error',
      runId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies ErrorMessage)
  }
}
