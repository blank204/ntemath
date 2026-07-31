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
  let cols = Math.max(1, Math.round(Math.sqrt(n * aspect)))
  let rows = Math.max(1, Math.floor(n / cols))
  while (cols * rows > n && cols > 1) cols--
  while ((cols + 1) * rows <= n) cols++

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
