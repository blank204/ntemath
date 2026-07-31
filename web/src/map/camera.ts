export type LngLatBoundsPair = [[number, number], [number, number]]

/** The slice of maplibregl.Map this module needs. */
export interface CameraTarget {
  isStyleLoaded(): boolean
  fitBounds(bounds: LngLatBoundsPair, options: { padding: number; duration: number }): void
  once(type: 'load', listener: () => void): unknown
  off(type: 'load', listener: () => void): unknown
}

/**
 * Frame a region — but only once the style has actually loaded.
 *
 * The region fetch and the MapTiler style fetch race each other, and the
 * region usually wins (its rasters come from the same origin). A `fitBounds`
 * issued before the style resolves is discarded when the style lands, so the
 * first view came up zoomed past the region instead of framing it.
 *
 * If the style is ready, fit now. Otherwise queue a single `once('load')`
 * handler, first removing any handler an earlier region left waiting so the
 * newest selection wins rather than the oldest.
 *
 * Returns the handler now waiting on `load`, or `null` if the fit was applied
 * immediately. Pass that value back in as `pending` on the next call.
 */
export function fitWhenStyleReady(
  map: CameraTarget,
  bounds: LngLatBoundsPair,
  pending: (() => void) | null,
): (() => void) | null {
  if (pending) map.off('load', pending)

  if (map.isStyleLoaded()) {
    map.fitBounds(bounds, { padding: 40, duration: 800 })
    return null
  }

  // Deferred fit: no animation. The user has not seen a camera position yet,
  // so easing from the arbitrary initial centre would be motion for its own
  // sake, and it would race the style's first paint all over again.
  const onLoad = () => { map.fitBounds(bounds, { padding: 40, duration: 0 }) }
  map.once('load', onLoad)
  return onLoad
}
