import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useModelStore } from '../state/useModelStore'
import { loadRegion } from '../lib/loadRegion'
import { riskToImage, riskLayer, nodesLayer } from './layers'
import { fitWhenStyleReady, type CameraTarget } from './camera'
import { PALETTE } from '../theme/palette'

const KEY = import.meta.env.VITE_MAPTILER_KEY

/**
 * The single MapLibre instance. Created once, never unmounted.
 *
 * Later work (the story rail) depends on this: the rail and the Lab are two
 * states of one living map, not two pages. Unmounting it would break the
 * handoff and reset the camera.
 */
export function MapRoot() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  // Bounds that arrived before the style finished loading, plus the handler
  // waiting to apply them. See fitRegion() below.
  const pendingFitRef = useRef<(() => void) | null>(null)
  const [image, setImage] = useState<ImageBitmap | null>(null)

  const { regionName, region, result, setRegion, setError } = useModelStore()

  useEffect(() => {
    if (mapRef.current || !ref.current) return
    const style = KEY
      ? `https://api.maptiler.com/maps/satellite/style.json?key=${KEY}`
      : { version: 8 as const, sources: {}, layers: [
          { id: 'bg', type: 'background' as const,
            paint: { 'background-color': PALETTE.canvas } },
        ] }

    const map = new maplibregl.Map({
      container: ref.current,
      style: style as maplibregl.StyleSpecification | string,
      center: [-119.85, 34.7],
      zoom: 8.4,
      pitch: 0,
      attributionControl: {
        compact: true,
        // ESA WorldCover is CC BY 4.0 and the licence requires attribution
        // wherever the derived product is shown. The risk raster on this map
        // IS a derived product, so the credit belongs on the map itself, not
        // only in a panel the viewer may never open.
        customAttribution:
          'Land cover: <a href="https://esa-worldcover.org/" target="_blank" ' +
          'rel="noreferrer">ESA WorldCover</a> (CC BY 4.0) · ' +
          'Fire detections: NASA FIRMS · Weather: ERA5 / Open-Meteo',
      },
    })
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    mapRef.current = map
    overlayRef.current = overlay
  }, [])

  // Gate camera framing on style readiness — see fitWhenStyleReady.
  const fitRegion = (box: [number, number, number, number]) => {
    const map = mapRef.current
    if (!map) return
    const [w, s, e, n] = box
    pendingFitRef.current = fitWhenStyleReady(
      map as unknown as CameraTarget,
      [[w, s], [e, n]],
      pendingFitRef.current,
    )
  }

  useEffect(() => {
    let cancelled = false
    // Clear the previous region's raster immediately so a failed load (an
    // unbaked region) never leaves a stale, mismatched image on screen.
    setImage(null)
    loadRegion(regionName)
      .then(async (r) => {
        if (cancelled) return
        setRegion(r)
        setImage(await createImageBitmap(riskToImage(r.risk, r.mask)))
        fitRegion(r.meta.box)
      })
      .catch((err) => {
        if (cancelled) return
        const detail = err instanceof Error ? err.message : String(err)
        setError(
          `Region "${regionName}" has no baked data yet (${detail}). ` +
          `Only Los Padres is baked so far — pick that one to see a live run.`,
        )
      })
    return () => { cancelled = true }
  }, [regionName, setRegion, setError])

  useEffect(() => {
    if (!overlayRef.current) return
    if (!region) {
      // No region loaded (e.g. an unbaked region 404ed) — clear any layers
      // left over from a previously selected region rather than showing a
      // stale raster/nodes for the wrong place.
      overlayRef.current.setProps({ layers: [] })
      return
    }
    const layers = []
    if (image) layers.push(riskLayer(region, image))
    if (result) layers.push(nodesLayer(region, result.nodes))
    overlayRef.current.setProps({ layers })
  }, [region, image, result])

  return <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
}
