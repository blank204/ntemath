import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { REGIONS, regionOptions } from '../src/lib/regions'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('REGIONS', () => {
  it('lists exactly the eight regions plan.py defines, in its order', () => {
    expect(REGIONS.map((r) => r.key)).toEqual([
      'los-padres', 'amazon-rondonia', 'siberia-baikal', 'portugal-centro',
      'victoria-alpine', 'congo-basin', 'sweden-norrland', 'greece-peloponnese',
    ])
  })

  it('gives every region a country and a fire regime', () => {
    for (const r of REGIONS) {
      expect(r.label.length).toBeGreaterThan(3)
      expect(r.country.length).toBeGreaterThan(2)
      expect(r.regime.length).toBeGreaterThan(3)
    }
  })
})

describe('regionOptions', () => {
  it('marks only the regions the manifest says are baked', () => {
    const opts = regionOptions(['los-padres'])
    expect(opts).toHaveLength(8)
    expect(opts.filter((o) => o.baked).map((o) => o.key)).toEqual(['los-padres'])
  })

  it('marks nothing baked when the manifest is empty', () => {
    expect(regionOptions([]).some((o) => o.baked)).toBe(false)
  })

  it('ignores a manifest entry that is not a known region', () => {
    const opts = regionOptions(['los-padres', 'atlantis'])
    expect(opts).toHaveLength(8)
    expect(opts.filter((o) => o.baked)).toHaveLength(1)
  })

  it('agrees with the manifest actually committed to the repo', () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, '..', 'public', 'data', 'manifest.json'), 'utf-8'))
    const opts = regionOptions(manifest.baked)
    expect(opts.filter((o) => o.baked).map((o) => o.key)).toEqual(['los-padres'])
  })

  it('keeps all eight visible rather than hiding the unbaked seven', () => {
    // The picker is what makes "the same code path runs anywhere on Earth"
    // checkable. Filtering to the baked one would turn a global model into a
    // single demo.
    expect(regionOptions(['los-padres']).map((o) => o.key))
      .toEqual(REGIONS.map((r) => r.key))
  })
})
