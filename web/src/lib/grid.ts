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
  const targetAspect = aspect

  // Find the (cols, rows) pair that maximizes cols * rows <= n
  // while preferring aspect ratios close to the region's aspect.
  let bestCols = 1
  let bestRows = 1
  let bestProduct = 1
  let bestAspectDiff = Math.abs(1 - targetAspect)

  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.floor(n / cols)
    if (rows < 1) break
    const product = cols * rows
    if (product > n) continue

    const gridAspect = cols / rows
    const aspectDiff = Math.abs(gridAspect - targetAspect)

    // Prefer larger product; if tied, prefer closer aspect ratio.
    if (product > bestProduct || (product === bestProduct && aspectDiff < bestAspectDiff)) {
      bestCols = cols
      bestRows = rows
      bestProduct = product
      bestAspectDiff = aspectDiff
    }
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
