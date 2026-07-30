import { describe, it, expect } from 'vitest'
import { RefRNG } from '../src/lib/refrng'
import fixture from './fixtures/refrng.json'

describe('RefRNG matches the Python reference', () => {
  // Guards against the fixture silently shrinking to zero assertions: if
  // export_fixtures.py ever regressed and emitted truncated/empty arrays,
  // the per-case `for...of` loops below would run zero times and still
  // report PASS. Pin the fixture's shape explicitly instead.
  it('fixture has the expected number of cases', () => {
    expect(fixture.cases.length).toBe(12)
  })

  for (const c of fixture.cases as any[]) {
    if (c.uint64) {
      it(`uint64 stream, seed ${c.seed}`, () => {
        expect(c.uint64.length).toBe(8)
        const g = new RefRNG(c.seed)
        for (const expected of c.uint64) {
          expect(g.nextUint64().toString()).toBe(expected)
        }
      })
    }
    if (c.random) {
      it(`random() stream, seed ${c.seed}`, () => {
        expect(c.random.length).toBe(8)
        const g = new RefRNG(c.seed)
        for (const expected of c.random) {
          expect(g.random()).toBe(expected)   // exact: same 53-bit construction
        }
      })
    }
    if (c.integers) {
      it(`integers() stream, seed ${c.seed}`, () => {
        expect(c.integers.length).toBe(8)
        const g = new RefRNG(c.seed)
        for (const expected of c.integers) {
          expect(g.integers(c.integers_high)).toBe(expected)
        }
      })
    }
  }
})

describe('RefRNG exercises the Lemire rejection branch', () => {
  // With integers_high = 1000 (used above), P(reject) ~= 3.3e-17 — the
  // retry loop never actually executes past its first iteration, so an
  // off-by-one (`lo > threshold` vs `lo >= threshold`) or a deleted retry
  // loop would pass every test above. This fixture case uses a `high`
  // tuned (see tools/bake/export_fixtures.py) so a rejection genuinely
  // occurs within a replayable window, confirmed at generation time by
  // instrumenting the draw count per call.
  const rc = (fixture as any).rejection_case

  it('rejection fixture actually recorded a rejection', () => {
    expect(rc.values.length).toBe(8)
    expect(rc.rejections_in_window).toBeGreaterThanOrEqual(1)
  })

  it(`integers() reproduces the stream through the reject-retry branch (seed ${rc.seed}, high ${rc.high})`, () => {
    const g = new RefRNG(rc.seed)
    for (let i = 0; i < rc.skip; i++) g.integers(rc.high)
    for (const expected of rc.values) {
      expect(g.integers(rc.high)).toBe(expected)
    }
  })
})
