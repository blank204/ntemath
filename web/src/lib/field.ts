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

/**
 * r(x) = r_max - (r_max - r_min) * risk(x). Mirrors the closure in place.py.
 *
 * The `Math.fround` calls are load-bearing — do NOT remove them.
 *
 * `risk` is float32 (risk.bin ships as `<f4`; `Field.data` is a Float32Array),
 * and under NEP 50 (numpy >= 2.0) a Python float is a *weak* scalar: numpy
 * casts it down to the array's dtype instead of promoting the array. So
 * place.py:108's `r_max_km - (r_max_km - r_min_km) * _sample_field(risk, ...)`
 * evaluates as
 *
 *     float32(float32(r_max) - float32(float32(r_max - r_min) * risk32))
 *
 * — one float64 subtraction for the span (both operands are Python floats),
 * then everything else narrowed to float32. JavaScript has only float64, so
 * without these frounds the browser computes a radius that can differ from
 * numpy's in the last float32 bit. That is not cosmetic: the radius feeds the
 * Poisson-disk acceptance test, so one flipped comparison forks the whole
 * point sequence. Measured on the committed Los Padres rasters, float64 TS vs
 * float32 numpy agreed at detectKm = 2.0 but produced 14799 vs 14794
 * candidates at 0.5 km and 10262 vs 10322 at 0.6 km — different networks,
 * inside the range the UI slider exposes.
 *
 * Verified empirically against numpy 2.4.4: narrowing the span *before* the
 * multiply is required. `fround(r_max - fround((r_max - r_min) * risk))`
 * (span kept at float64) disagrees with numpy whenever `r_max - r_min` is not
 * float32-representable — e.g. detectKm 0.7, 1.3, 3.3, 4.9.
 */
export function radiusAt(
  risk: Field, x: number, y: number,
  widthKm: number, heightKm: number,
  rMinKm: number, rMaxKm: number,
): number {
  const u = clamp(x / Math.max(widthKm, 1e-9), 0, 1)
  const v = clamp(y / Math.max(heightKm, 1e-9), 0, 1)
  const span = Math.fround(rMaxKm - rMinKm)
  return Math.fround(
    Math.fround(rMaxKm) - Math.fround(span * sampleField(risk, u, v)),
  )
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
