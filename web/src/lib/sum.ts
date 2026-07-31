/**
 * Pairwise summation, matching numpy's algorithm (blocksize 128, unrolled by
 * 8 in the base case).
 *
 * This is not gold-plating. greedy_minimise compares marginal gains against a
 * 1e-12 tolerance; a last-bit difference from naive summation can flip which
 * node wins a round and desynchronise every subsequent choice from the Python.
 */
const BLOCK = 128

export function pairwiseSum(
  a: Float64Array | number[],
  from = 0,
  to: number = a.length,
): number {
  const n = to - from
  if (n <= 0) return 0

  if (n <= 8) {
    let s = 0
    for (let i = from; i < to; i++) s += a[i]
    return s
  }

  if (n <= BLOCK) {
    // numpy's unrolled base case: eight running partials, combined at the end.
    let r0 = a[from], r1 = a[from + 1], r2 = a[from + 2], r3 = a[from + 3]
    let r4 = a[from + 4], r5 = a[from + 5], r6 = a[from + 6], r7 = a[from + 7]
    let i = from + 8
    for (; i + 7 < to; i += 8) {
      r0 += a[i]; r1 += a[i + 1]; r2 += a[i + 2]; r3 += a[i + 3]
      r4 += a[i + 4]; r5 += a[i + 5]; r6 += a[i + 6]; r7 += a[i + 7]
    }
    let s = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7))
    for (; i < to; i++) s += a[i]
    return s
  }

  // Split at a multiple of 8 so the halves stay aligned with the base case.
  let half = n >> 1
  half -= half % 8
  return pairwiseSum(a, from, from + half) + pairwiseSum(a, from + half, to)
}
