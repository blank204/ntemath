import type { Field } from './types'
import { allowedAt } from './field'

/** At most this fraction of `n` may go unplaced to buy a better-shaped grid. */
const SHORTFALL_FRACTION = 0.05
/** ...but always allow at least this many, or small `n` has no room to move. */
const MIN_SHORTFALL = 3
/** ...and never drop below this fraction of `n`, which binds only for tiny `n`. */
const KEEP_FRACTION = 0.6
/** Accept a cell up to this much more elongated than the best available if it holds more nodes. */
const ELONGATION_BAND = 0.15
/** ...but never let that trade push elongation past this bar when something at or below it exists. */
const ELONGATION_BAR = 2

/**
 * The aspect ratio of a single grid cell. 1.0 is a square cell; larger is a
 * sliver. This — not the whole grid's aspect ratio — is what determines
 * whether a uniform grid covers the region evenly.
 */
export function cellElongation(
  widthKm: number, heightKm: number, cols: number, rows: number,
): number {
  const cellW = widthKm / cols
  const cellH = heightKm / rows
  return Math.max(cellW, cellH) / Math.min(cellW, cellH)
}

/**
 * Chooses the grid's shape: how many columns, how many rows.
 *
 * Searches (cols, rows) pairs directly rather than factorising `n`, so both
 * orientations are reachable — a wide region gets a wide grid — and no node
 * count is penalised for being prime. Candidates are scored on cell
 * elongation, subject to `cols * rows <= n`.
 *
 * Two guards keep the search honest:
 *  - a floor on `cols * rows`, so the baseline never throws away a pile of
 *    nodes to buy a marginally rounder cell;
 *  - a band above the best elongation within which more nodes wins, capped so
 *    that trade can never push a grid past an elongation of 2.
 */
export function gridShape(
  widthKm: number, heightKm: number, n: number,
): [cols: number, rows: number] {
  const w = Math.max(widthKm, 1e-9)
  const h = Math.max(heightKm, 1e-9)
  // Rows per column that would make cells exactly square.
  const squareRatio = h / w

  // For each column count, the row counts worth considering: the two nearest
  // to square cells, and the one that uses the node budget most fully.
  const candidates: Array<[number, number]> = []
  for (let cols = 1; cols <= n; cols++) {
    const maxRows = Math.floor(n / cols)
    if (maxRows < 1) break
    const ideal = cols * squareRatio
    const lo = Math.min(maxRows, Math.max(1, Math.floor(ideal)))
    const hi = Math.min(maxRows, Math.max(1, Math.ceil(ideal)))
    candidates.push([cols, lo])
    if (hi !== lo) candidates.push([cols, hi])
    if (maxRows !== lo && maxRows !== hi) candidates.push([cols, maxRows])
  }

  const allowedShortfall = Math.max(MIN_SHORTFALL, Math.ceil(n * SHORTFALL_FRACTION))
  const minProduct = Math.max(
    1,
    Math.min(n, Math.max(n - allowedShortfall, Math.ceil(n * KEEP_FRACTION))),
  )

  // Pass 1: the best cell shape available within the node budget.
  let bestElongation = Infinity
  for (const [cols, rows] of candidates) {
    if (cols * rows < minProduct) continue
    const e = cellElongation(w, h, cols, rows)
    if (e < bestElongation) bestElongation = e
  }
  // cols = 1, rows = n is always a candidate with product n >= minProduct,
  // so pass 1 always finds something; this is belt and braces.
  if (!Number.isFinite(bestElongation)) return [1, 1]

  const band = Math.min(
    bestElongation * (1 + ELONGATION_BAND),
    Math.max(ELONGATION_BAR, bestElongation),
  )

  // Pass 2: within that band, the shape that places the most nodes.
  let bestCols = 1
  let bestRows = 1
  let bestProduct = 0
  let bestBanded = Infinity
  for (const [cols, rows] of candidates) {
    const product = cols * rows
    if (product < minProduct) continue
    const e = cellElongation(w, h, cols, rows)
    if (e > band + 1e-12) continue
    if (product > bestProduct || (product === bestProduct && e < bestBanded)) {
      bestCols = cols
      bestRows = rows
      bestProduct = product
      bestBanded = e
    }
  }
  return [bestCols, bestRows]
}

/**
 * The benchmark's control arm: a uniform grid of at most `n` nodes.
 *
 * Deliberately naive — that is the point. It is what you get without a risk
 * model: evenly spaced, blind to terrain, wasteful where nothing burns and
 * thin where everything does.
 *
 * Rows and columns are chosen so that grid cells come out as close to square
 * as the node budget allows, so the grid is a genuinely reasonable baseline
 * rather than a straw man. A sliver-shaped grid would cover far less than an
 * honest uniform grid and would flatter whatever it is compared against.
 */
export function uniformGrid(
  widthKm: number, heightKm: number, n: number,
  mask: Field | null = null,
): Float64Array {
  if (n <= 0) return new Float64Array(0)

  const [cols, rows] = gridShape(widthKm, heightKm, n)

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
