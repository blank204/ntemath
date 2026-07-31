import type { Field } from './types'

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x

/**
 * Nearest-neighbour lookup into a field indexed by fractional (u, v).
 *
 * Mirrors place._sample_field. NOTE: numpy's `.astype(int)` truncates toward
 * zero — it does not round. Using Math.round here shifts every lookup by up
 * to one cell and silently changes the placement result.
 */
export function sampleField(f: Field, u: number, v: number): number {
  const j = clamp(Math.trunc(v * (f.ny - 1)), 0, f.ny - 1)
  const i = clamp(Math.trunc(u * (f.nx - 1)), 0, f.nx - 1)
  return f.data[j * f.nx + i]
}

/** r(x) = r_max - (r_max - r_min) * risk(x). Mirrors the closure in place.py. */
export function radiusAt(
  risk: Field, x: number, y: number,
  widthKm: number, heightKm: number,
  rMinKm: number, rMaxKm: number,
): number {
  const u = clamp(x / Math.max(widthKm, 1e-9), 0, 1)
  const v = clamp(y / Math.max(heightKm, 1e-9), 0, 1)
  return rMaxKm - (rMaxKm - rMinKm) * sampleField(risk, u, v)
}

/** Mask lookup with the same 0.5 threshold place.py uses. */
export function allowedAt(
  mask: Field | null, x: number, y: number,
  widthKm: number, heightKm: number,
): boolean {
  if (mask === null) return true
  const u = clamp(x / Math.max(widthKm, 1e-9), 0, 1)
  const v = clamp(y / Math.max(heightKm, 1e-9), 0, 1)
  return sampleField(mask, u, v) > 0.5
}
