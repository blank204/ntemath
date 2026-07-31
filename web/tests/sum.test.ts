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

  it('matches numpy exactly at boundary n=8 with non-trivial floats', () => {
    // Tests the unrolled path: r0..r7 initialized from 8 elements, combined as ((r0+r1)+(r2+r3))+((r4+r5)+(r6+r7))
    // numpy reference from Float64Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
    const a = Float64Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
    expect(pairwiseSum(a)).toBe(3.6)
  })

  it('matches numpy exactly at BLOCK boundary n=128', () => {
    // numpy reference: 814.0800000000002
    const a = new Float64Array(128)
    for (let i = 0; i < 128; i++) {
      a[i] = i * 0.1 + 0.01
    }
    expect(pairwiseSum(a)).toBe(814.0800000000002)
  })

  it('matches numpy exactly past BLOCK boundary n=129', () => {
    // numpy reference: 826.8900000000001
    const a = new Float64Array(129)
    for (let i = 0; i < 129; i++) {
      a[i] = i * 0.1 + 0.01
    }
    expect(pairwiseSum(a)).toBe(826.8900000000001)
  })

  it('matches numpy exactly at n=130, where the 8-alignment guard first bites', () => {
    // numpy 2.4.4 reference: 839.8000000000001.
    //
    // This is the smallest n at which dropping `half -= half % 8` from the
    // recursive split diverges from numpy: at n=129 both the aligned split
    // (64/65 -> 64/65 after alignment) and the unaligned one agree, and n=130
    // is the first size where the unaligned halves (65/65) put the base-case
    // unrolled loop out of phase. Verified against live numpy for n=129..139:
    // the aligned split matches at every size, the unaligned one first fails
    // here.
    const a = new Float64Array(130)
    for (let i = 0; i < 130; i++) {
      a[i] = i * 0.1 + 0.01
    }
    expect(pairwiseSum(a)).toBe(839.8000000000001)
  })
})
