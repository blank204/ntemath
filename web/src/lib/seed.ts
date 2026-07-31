import type { Field } from './types'

export interface SeedResolution {
  /** Flat index of the seed pixel, or -1 when the mask allows nothing. */
  index: number
  /** How many allowed pixels share the maximum. 1 means numpy would agree. */
  tiesAtMax: number
  allowedCount: number
  maxRisk: number
}

/**
 * The pixel `variablePoissonDisk` should start from: the mask-allowed pixel
 * with the greatest risk, ties broken by the lowest flat index.
 *
 * `place.py` expresses the same rule as a scan down `np.argsort(risk,
 * axis=None)[::-1]`. numpy's argsort is an unstable introsort, so when values
 * tie its answer is a property of quicksort's partitioning rather than of the
 * algorithm — not something a second sort implementation can reproduce. Plan 1
 * worked around that by resolving the index in Python and shipping it, which
 * was right while the risk field was frozen at bake time. It is not right once
 * `w_weather` and `w_activity` are live: the argmax genuinely moves when the
 * weights move, so a shipped index stops being the maximum.
 *
 * This completes the underspecified half of the rule with a total order, which
 * both languages can evaluate identically. Where ties exist the choice is
 * *a* valid seed rather than numpy's, so `tiesAtMax` is returned and the UI
 * says so — see ui/copy.ts. On the shipped Los Padres raster at the default
 * weights the maximum is unique and this returns 539100, the same index the
 * bake resolved, which is what keeps the Plan 1 parity chain intact.
 */
export function resolveSeedIndex(risk: Field, mask: Field): SeedResolution {
  const n = risk.data.length
  let index = -1
  let maxRisk = -Infinity
  let tiesAtMax = 0
  let allowedCount = 0

  for (let i = 0; i < n; i++) {
    // The same 0.5 threshold place.allowed() uses. Baked masks hold exactly
    // 0 or 1, so the threshold only matters for synthetic fields.
    if (!(mask.data[i] > 0.5)) continue
    allowedCount++
    const v = risk.data[i]
    if (v > maxRisk) {
      maxRisk = v
      index = i          // strictly greater, so the FIRST maximum is kept
      tiesAtMax = 1
    } else if (v === maxRisk) {
      tiesAtMax++
    }
  }

  if (index < 0) return { index: -1, tiesAtMax: 0, allowedCount: 0, maxRisk: 0 }
  return { index, tiesAtMax, allowedCount, maxRisk }
}
