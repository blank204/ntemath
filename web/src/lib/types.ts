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
