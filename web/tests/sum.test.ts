import { describe, it, expect } from 'vitest'
import { pairwiseSum } from '../src/lib/sum'

describe('pairwiseSum', () => {
  it('sums an empty range to zero', () => {
    expect(pairwiseSum(new Float64Array(0))).toBe(0)
  })

  it('matches a plain sum for small exact-integer inputs', () => {
    const a = Float64Array.from([1, 2, 3, 4, 5])
    expect(pairwiseSum(a)).toBe(15)
  })

  it('is more accurate than naive summation on a hostile input', () => {
    // 1 followed by 10000 copies of 1e-16: naive summation loses them all.
    const n = 10001
    const a = new Float64Array(n)
    a[0] = 1
    a.fill(1e-16, 1)
    let naive = 0
    for (let i = 0; i < n; i++) naive += a[i]
    const exact = 1 + 10000 * 1e-16
    expect(Math.abs(pairwiseSum(a) - exact)).toBeLessThan(Math.abs(naive - exact))
  })

  it('honours an explicit sub-range', () => {
    const a = Float64Array.from([10, 1, 2, 3, 10])
    expect(pairwiseSum(a, 1, 4)).toBe(6)
  })
})
