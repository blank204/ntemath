import { runPlacement } from '../lib/pipeline'
import type { PlaceParams, PlaceResult } from '../lib/pipeline'
import type { RegionData } from '../lib/loadRegion'

/**
 * Runs the siting pipeline off the main thread.
 *
 * Placement on a real region is hundreds of milliseconds of tight numeric
 * work. On the main thread it would stall the map and, later, the scroll —
 * so it never runs there.
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
    const result = runPlacement(e.data.region, e.data.params)
    // Transfer the big buffers rather than structured-cloning them.
    ;(self as unknown as Worker).postMessage(
      { type: 'done', runId, result } satisfies DoneMessage,
      [result.candidates.buffer, result.nodes.buffer] as unknown as Transferable[],
    )
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      type: 'error',
      runId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies ErrorMessage)
  }
}
