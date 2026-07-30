import { describe, it, expect } from 'vitest'
import { RefRNG } from '../src/lib/refrng'
import fixture from './fixtures/refrng.json'

describe('RefRNG matches the Python reference', () => {
  for (const c of fixture.cases as any[]) {
    if (c.uint64) {
      it(`uint64 stream, seed ${c.seed}`, () => {
        const g = new RefRNG(c.seed)
        for (const expected of c.uint64) {
          expect(g.nextUint64().toString()).toBe(expected)
        }
      })
    }
    if (c.random) {
      it(`random() stream, seed ${c.seed}`, () => {
        const g = new RefRNG(c.seed)
        for (const expected of c.random) {
          expect(g.random()).toBe(expected)   // exact: same 53-bit construction
        }
      })
    }
    if (c.integers) {
      it(`integers() stream, seed ${c.seed}`, () => {
        const g = new RefRNG(c.seed)
        for (const expected of c.integers) {
          expect(g.integers(c.integers_high)).toBe(expected)
        }
      })
    }
  }
})
