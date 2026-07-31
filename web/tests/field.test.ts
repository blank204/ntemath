import { describe, it, expect } from 'vitest'
import { sampleField, radiusAt, allowedAt } from '../src/lib/field'
import type { Field } from '../src/lib/types'

const f3: Field = { nx: 3, ny: 3, data: Float32Array.from([
  0, 0.1, 0.2,
  0.3, 0.4, 0.5,
  0.6, 0.7, 0.8,
]) }

describe('sampleField', () => {
  it('reads row 0 at v = 0 (south edge)', () => {
    expect(sampleField(f3, 0, 0)).toBeCloseTo(0, 6)
    expect(sampleField(f3, 1, 0)).toBeCloseTo(0.2, 6)
  })

  it('reads the last row at v = 1', () => {
    expect(sampleField(f3, 0, 1)).toBeCloseTo(0.6, 6)
    expect(sampleField(f3, 1, 1)).toBeCloseTo(0.8, 6)
  })

  it('truncates rather than rounds, matching astype(int)', () => {
    // v * (ny-1) = 0.9 -> trunc 0, NOT round 1.
    expect(sampleField(f3, 0, 0.45)).toBeCloseTo(0, 6)
  })

  it('clamps out-of-range coordinates', () => {
    expect(sampleField(f3, -5, -5)).toBeCloseTo(0, 6)
    expect(sampleField(f3, 5, 5)).toBeCloseTo(0.8, 6)
  })
})

describe('radiusAt', () => {
  it('returns r_max where risk is 0 and r_min where risk is 1', () => {
    const zero: Field = { nx: 1, ny: 1, data: Float32Array.from([0]) }
    const one: Field = { nx: 1, ny: 1, data: Float32Array.from([1]) }
    expect(radiusAt(zero, 5, 5, 10, 10, 2, 20)).toBeCloseTo(20, 9)
    expect(radiusAt(one, 5, 5, 10, 10, 2, 20)).toBeCloseTo(2, 9)
  })

  it('interpolates linearly between the bounds', () => {
    const half: Field = { nx: 1, ny: 1, data: Float32Array.from([0.5]) }
    expect(radiusAt(half, 5, 5, 10, 10, 2, 20)).toBeCloseTo(11, 6)
  })
})

describe('allowedAt', () => {
  it('allows everything when the mask is null', () => {
    expect(allowedAt(null, 1, 1, 10, 10)).toBe(true)
  })

  it('uses a 0.5 threshold', () => {
    const m: Field = { nx: 2, ny: 1, data: Float32Array.from([0, 1]) }
    expect(allowedAt(m, 0, 0, 10, 10)).toBe(false)
    expect(allowedAt(m, 10, 0, 10, 10)).toBe(true)
  })
})
