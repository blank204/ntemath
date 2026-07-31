import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pairwiseSum } from '../src/lib/sum'
import { GridIndex } from '../src/lib/gridindex'
import { CELF_TOLERANCE, celfAcceptsRefresh, demandPoints, seenDemand } from '../src/lib/cover'
import { loadRegion } from '../src/lib/loadRegion'
import { runPlacement } from '../src/lib/pipeline'

/**
 * The numerical machinery that cover.json cannot test.
 *
 * cover.json's demand weights are float32 risk values, i.e. integer multiples
 * of 2^-26. Every partial sum therefore needs at most ~40 significand bits,
 * so float addition over that data is EXACT and hence order-independent.
 * Three real regressions ship green against it with exactly zero delta:
 * dropping `- 1e-12` from the CELF refresh, deleting the `sees[i]` ascending
 * sort, and replacing pairwiseSum with a naive left-to-right loop. A
 * risk-plateau fixture would not help — it has the same exactness property.
 *
 * So test the predicates directly.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'public', 'data', 'los-padres')

function realFetch() {
  const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf-8'))
  const riskBuf = readFileSync(join(dataDir, 'risk.bin'))
  const maskBuf = readFileSync(join(dataDir, 'mask.bin'))
  const slice = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  return (async (url: string) => {
    if (url.endsWith('meta.json')) return { ok: true, json: async () => meta } as never
    if (url.endsWith('risk.bin')) return { ok: true, arrayBuffer: async () => slice(riskBuf) } as never
    if (url.endsWith('mask.bin')) return { ok: true, arrayBuffer: async () => slice(maskBuf) } as never
    return { ok: false, status: 404 } as never
  }) as unknown as typeof fetch
}

describe('CELF refresh tolerance', () => {
  it('is 1e-12, matching place.py', () => {
    expect(CELF_TOLERANCE).toBe(1e-12)
  })

  it('accepts a refreshed gain that trails the best stale bound by less than the tolerance', () => {
    // A wide-dynamic-range set: 64 values near 1e-9 and 64 values near 1.
    // Summed pairwise vs left-to-right these disagree in the last bits — the
    // exact situation the tolerance exists to absorb.
    const vals: number[] = []
    for (let i = 0; i < 64; i++) vals.push(1e-9 * (i + 1))
    for (let i = 0; i < 64; i++) vals.push(1.0 + i * 1e-3)

    const bound = pairwiseSum(vals)
    let trueGain = 0
    for (const v of vals) trueGain += v

    // The two agree mathematically and disagree numerically, by a gap that
    // is real, non-zero, and comfortably inside the tolerance window.
    const gap = bound - trueGain
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(CELF_TOLERANCE)

    expect(celfAcceptsRefresh(trueGain, bound)).toBe(true)
    // MUTATION GUARD: without the `- 1e-12` the predicate is a bare `>=`,
    // which rejects this candidate and re-pushes it, changing the pop order.
    expect(trueGain >= bound).toBe(false)
  })

  it('still rejects a gain that trails by more than the tolerance', () => {
    const bound = 1234.5
    expect(celfAcceptsRefresh(bound - 1e-9, bound)).toBe(false)
    expect(celfAcceptsRefresh(bound - 1e-11, bound)).toBe(false)
  })

  it('accepts at and inside the boundary, rejects outside it', () => {
    const bound = 1.0
    expect(celfAcceptsRefresh(bound, bound)).toBe(true)
    expect(celfAcceptsRefresh(bound + 1, bound)).toBe(true)
    expect(celfAcceptsRefresh(bound - 5e-13, bound)).toBe(true)
    expect(celfAcceptsRefresh(bound - 2e-12, bound)).toBe(false)
  })

  it('documents why no float32-risk fixture can reach the tolerance', () => {
    // Every float32 in [0, 1] is an integer multiple of 2^-26, so the
    // smallest non-zero margin any sum of such weights can produce is 2^-26.
    const quantum = Math.pow(2, -26)
    expect(quantum).toBeCloseTo(1.4901161193847656e-8, 20)
    expect(quantum / CELF_TOLERANCE).toBeGreaterThan(1e4)
  })
})

describe('seenDemand hit-list ordering', () => {
  it('returns ascending indices where the raw index does not', () => {
    // Points laid out so the bucket walk visits them out of index order.
    const n = 400
    const xs = new Float64Array(n)
    const ys = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      xs[i] = ((i * 37) % 40) + 0.5
      ys[i] = ((i * 23) % 30) + 0.5
    }
    const idx = new GridIndex(xs, ys, 1.0)

    let checked = 0
    let rawNonAscending = 0
    for (let q = 0; q < 40; q++) {
      const x = (q * 7) % 40
      const y = (q * 11) % 30
      const raw = idx.withinRadius(x, y, 6)
      const sorted = seenDemand(idx, x, y, 6)

      expect(sorted.length).toBe(raw.length)
      // Same set, different order: the sort must not drop or add anything.
      expect([...sorted]).toEqual([...raw].sort((a, b) => a - b))
      for (let k = 1; k < sorted.length; k++) {
        expect(sorted[k]).toBeGreaterThan(sorted[k - 1])
      }
      for (let k = 1; k < raw.length; k++) {
        if (raw[k] < raw[k - 1]) { rawNonAscending++; break }
      }
      checked += sorted.length
    }
    expect(checked).toBeGreaterThan(100)
    // MUTATION GUARD: if GridIndex ever returned sorted lists by
    // construction, deleting the sort would become invisible again.
    expect(rawNonAscending).toBeGreaterThan(0)
  })

  it('produces non-ascending raw hit lists on the real region, so the sort in cover.ts is not dead code', async () => {
    const region = await loadRegion('los-padres', realFetch())
    const r = runPlacement(region, {
      seed: 7, detectKm: 2.0, rMinKm: 1.1, rMaxKm: 2.6,
      target: 0.95, demandStride: 4, maxNodes: null,
    })
    const d = demandPoints(
      region.risk, region.mask, region.meta.widthKm, region.meta.heightKm, 4,
    )
    const nd = d.xy.length / 2
    const dx = new Float64Array(nd)
    const dy = new Float64Array(nd)
    for (let i = 0; i < nd; i++) { dx[i] = d.xy[2 * i]; dy[i] = d.xy[2 * i + 1] }
    const index = new GridIndex(dx, dy, 2.0)

    let nonAscending = 0
    let lists = 0
    for (let i = 0; i < r.candidates.length / 2; i++) {
      const s = index.withinRadius(r.candidates[2 * i], r.candidates[2 * i + 1], 2.0)
      lists++
      for (let k = 1; k < s.length; k++) {
        if (s[k] < s[k - 1]) { nonAscending++; break }
      }
    }
    // Measured: 923 of 927. If GridIndex ever started returning sorted lists
    // by construction, the sort in cover.ts would become untested again and
    // this assertion is the thing that says so.
    expect(lists).toBe(927)
    expect(nonAscending).toBe(923)
  }, 120000)
})

describe('pairwiseSum vs naive accumulation', () => {
  it('differs from a left-to-right loop on a wide-dynamic-range array', () => {
    // One huge value followed by 4095 ones. Naive accumulation absorbs every
    // subsequent 1 into the rounding of 1e16 and returns exactly 1e16;
    // pairwise summation keeps almost all of them.
    const n = 4096
    const a = new Float64Array(n)
    a[0] = 1e16
    a.fill(1, 1)

    let naive = 0
    for (let i = 0; i < n; i++) naive += a[i]

    const pw = pairwiseSum(a)
    const exact = 1e16 + (n - 1)

    expect(naive).toBe(1e16)
    expect(pw).toBe(10000000000004080)
    expect(pw).not.toBe(naive)
    expect(Math.abs(pw - exact)).toBeLessThan(Math.abs(naive - exact))
  })

  it('differs from a left-to-right loop on a mixed-magnitude array', () => {
    const vals: number[] = []
    for (let i = 0; i < 64; i++) vals.push(1e-9 * (i + 1))
    for (let i = 0; i < 64; i++) vals.push(1.0 + i * 1e-3)
    let naive = 0
    for (const v of vals) naive += v
    expect(pairwiseSum(vals)).not.toBe(naive)
  })
})
