import { ScatterplotLayer, BitmapLayer } from '@deck.gl/layers'
import { PALETTE } from '../theme/palette'
import type { Field } from '../lib/types'
import type { RegionData } from '../lib/loadRegion'
import { LocalFrame } from '../lib/frame'

const hexToRGB = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/**
 * Render the risk field to an RGBA image using the sequential sand->brown
 * ramp. Deliberately low-chroma: this is a magnitude layer, and live fire
 * (which arrives in a later plan) must always dominate the frame.
 */
export function riskToImage(risk: Field, mask: Field): ImageData {
  const ramp = PALETTE.riskRamp.map(hexToRGB)
  const img = new ImageData(risk.nx, risk.ny)
  for (let j = 0; j < risk.ny; j++) {
    for (let i = 0; i < risk.nx; i++) {
      const src = j * risk.nx + i
      // Flip vertically: raster row 0 is SOUTH, ImageData row 0 is TOP.
      const dst = (risk.ny - 1 - j) * risk.nx + i
      const v = Math.max(0, Math.min(1, risk.data[src]))
      const t = v * (ramp.length - 1)
      const lo = Math.floor(t)
      const hi = Math.min(lo + 1, ramp.length - 1)
      const f = t - lo
      const c = [0, 1, 2].map((ch) => ramp[lo][ch] + (ramp[hi][ch] - ramp[lo][ch]) * f)
      const o = dst * 4
      img.data[o] = c[0]
      img.data[o + 1] = c[1]
      img.data[o + 2] = c[2]
      img.data[o + 3] = mask.data[src] > 0.5 ? 200 : 40
    }
  }
  return img
}

export function riskLayer(region: RegionData, image: ImageBitmap) {
  const [w, s, e, n] = region.meta.box
  return new BitmapLayer({
    id: 'risk',
    bounds: [w, s, e, n],
    image,
    opacity: 0.75,
  })
}

/**
 * Nodes are mesh teal — system colour. Never orange; orange means fire.
 *
 * Coordinate note: variablePoissonDisk (via runPlacement) returns node
 * positions in km measured from the region's SOUTH-WEST corner, but
 * LocalFrame is centred on the box centre. Subtracting half the region's
 * extent converts from the "SW-corner" frame to the "box-centre" frame
 * LocalFrame expects, before turning km back into lon/lat.
 */
export function nodesLayer(region: RegionData, nodes: Float64Array) {
  const frame = new LocalFrame(region.bbox)
  const data: { position: [number, number] }[] = []
  for (let i = 0; i < nodes.length / 2; i++) {
    const [lon, lat] = frame.toLonLat(
      nodes[2 * i] - region.meta.widthKm / 2,
      nodes[2 * i + 1] - region.meta.heightKm / 2,
    )
    data.push({ position: [lon, lat] })
  }
  return new ScatterplotLayer({
    id: 'nodes',
    data,
    getPosition: (d: { position: [number, number] }) => d.position,
    getFillColor: [...hexToRGB(PALETTE.signal), 230],
    radiusUnits: 'meters',
    getRadius: 260,
    radiusMinPixels: 2.5,
    radiusMaxPixels: 9,
    pickable: true,
  })
}
