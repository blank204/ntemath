/** A lon/lat bounding box, west/south/east/north. Mirrors geo.BBox. */
export interface BBox {
  west: number
  south: number
  east: number
  north: number
}

/** A 2D scalar field stored row-major, row 0 at the SOUTH edge. */
export interface Field {
  data: Float32Array
  nx: number
  ny: number
}

/**
 * A 2D field of ESA WorldCover class codes, row-major, row 0 at the SOUTH
 * edge — the same orientation as `Field`. Codes are shipped rather than a
 * pre-computed flammability raster so the browser can apply the model's own
 * float64 lookup table and reproduce Python exactly; a float32 flammability
 * raster could not (float32(0.55) is not float64(0.55)).
 */
export interface ClassField {
  data: Uint8Array
  nx: number
  ny: number
}
