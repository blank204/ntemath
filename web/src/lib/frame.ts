import type { BBox } from './types'

/** Mean metres per degree of latitude (WGS84). Mirrors geo.M_PER_DEG_LAT. */
export const M_PER_DEG_LAT = 111320.0

/** Metres in one degree of longitude at a given latitude. */
export function mPerDegLon(latDeg: number): number {
  return M_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180)
}

/**
 * Equirectangular km frame about a box centre. Good to ~0.1% over a forest.
 *
 * Working in raw degrees instead would stretch every network toward the poles
 * and put boreal nodes about three times too close together — which is exactly
 * where the largest fires are.
 */
export class LocalFrame {
  readonly lon0: number
  readonly lat0: number
  readonly kx: number
  readonly ky: number
  readonly box: BBox

  constructor(box: BBox) {
    this.lon0 = (box.west + box.east) / 2
    this.lat0 = (box.south + box.north) / 2
    this.kx = mPerDegLon(this.lat0) / 1000
    this.ky = M_PER_DEG_LAT / 1000
    this.box = box
  }

  toKm(lon: number, lat: number): [number, number] {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * this.ky]
  }

  toLonLat(x: number, y: number): [number, number] {
    return [x / this.kx + this.lon0, y / this.ky + this.lat0]
  }

  extentKm(): [number, number] {
    return [
      (this.box.east - this.box.west) * this.kx,
      (this.box.north - this.box.south) * this.ky,
    ]
  }
}
