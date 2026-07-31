import type { Field } from './types'
import { allowedAt } from './field'

/**
 * The benchmark's control arm: a uniform grid of at most `n` nodes.
 *
 * Deliberately naive — that is the point. It is what you get without a risk
 * model: evenly spaced, blind to terrain, wasteful where nothing burns and
 * thin where everything does.
 *
 * Rows and columns are chosen to match the region's aspect ratio, so the grid
 * is a genuinely reasonable baseline rather than a straw man.
 */
export function uniformGrid(
  widthKm: number, heightKm: number, n: number,
  mask: Field | null = null,
): Float64Array {
  if (n <= 0) return new Float64Array(0)

  const aspect = widthKm / Math.max(heightKm, 1e-9)

  // Find the (cols, rows) pair that avoids degenerate shapes (min(cols,rows) === 1)
  // while maintaining an aspect ratio close to the region's aspect.
  // Allow a percentage-based shortfall (5% for large n, more for small n).
  let bestCols = 1
  let bestRows = 1
  let bestAspectDiff = Infinity
  let bestProduct = 0

  // Relative shortfall: 5% for large n, but at least 2 for tiny n.
  const percentShortfall = Math.ceil(n * 0.05)
  const minShortfall = Math.max(2, percentShortfall)
  const minProduct = Math.max(1, n - minShortfall)

  // Search for the best non-degenerate factorization.
  for (let product = n; product >= minProduct; product--) {
    // Find all factorizations of product where both factors >= 2.
    for (let cols = 2; cols * cols <= product; cols++) {
      if (product % cols === 0) {
        const rows = product / cols
        if (Math.min(cols, rows) >= 2) {
          // Non-degenerate candidate found. Score on aspect ratio quality.
          const gridAspect = cols / rows
          const aspectDiff = Math.abs(gridAspect - aspect)
          // Prefer closest aspect ratio; only break ties by product.
          if (aspectDiff < bestAspectDiff) {
            bestCols = cols
            bestRows = rows
            bestProduct = product
            bestAspectDiff = aspectDiff
          }
        }
      }
    }
  }

  // Fallback: if no non-degenerate solution exists (e.g., n < 4),
  // use simple 2D decomposition respecting the n limit.
  if (bestProduct === 0) {
    let cols = Math.max(1, Math.round(Math.sqrt(n * aspect)))
    let rows = Math.max(1, Math.floor(n / cols))
    // Adjust to ensure cols * rows <= n.
    while (cols * rows > n && cols > 1) cols--
    while ((cols + 1) * rows <= n) cols++
    bestCols = cols
    bestRows = rows
  }

  const cols = bestCols
  const rows = bestRows

  const out: number[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ((i + 0.5) / cols) * widthKm
      const y = ((j + 0.5) / rows) * heightKm
      if (allowedAt(mask, x, y, widthKm, heightKm)) out.push(x, y)
    }
  }
  return Float64Array.from(out)
}

/**
 * Ensures both arrays have the same number of pairs by truncating to the minimum.
 * Used to guarantee fairness in benchmark comparisons.
 */
export function capToCommonCount(
  a: Float64Array,
  b: Float64Array,
): [Float64Array, Float64Array] {
  const countA = a.length / 2
  const countB = b.length / 2
  const common = Math.min(countA, countB)
  const commonLength = common * 2

  return [a.slice(0, commonLength), b.slice(0, commonLength)]
}
