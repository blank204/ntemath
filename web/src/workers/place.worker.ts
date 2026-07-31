import { runPlacement, type PlaceParams } from '../lib/pipeline'
import type { RegionData } from '../lib/loadRegion'

/**
 * Runs the siting pipeline off the main thread.
 *
 * Placement on a real region is hundreds of milliseconds of tight numeric
 * work. On the main thread it would stall the map and, later, the scroll —
 * so it never runs there.
 */
export interface RunMessage {
  type: 'run'
  region: RegionData
  params: PlaceParams
}

self.onmessage = (e: MessageEvent<RunMessage>) => {
  if (e.data?.type !== 'run') return
  try {
    const result = runPlacement(e.data.region, e.data.params)
    // Transfer the big buffers rather than structured-cloning them.
    ;(self as unknown as Worker).postMessage(
      { type: 'done', result },
      [result.candidates.buffer, result.nodes.buffer] as unknown as Transferable[],
    )
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
