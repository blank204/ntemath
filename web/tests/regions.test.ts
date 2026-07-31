import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { REGIONS, regionOptions } from '../src/lib/regions'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('REGIONS', () => {
  it('leads with the lightning region the demo is built on', () => {
    expect(REGIONS[0].key).toBe('james-bay')
  })

  it('keeps every region plan.py defines, in its order, after it', () => {
    // plan.REGIONS is the team's shared model and is read-only. The picker
    // adds beside it; dropping one would quietly narrow what the site claims
    // the same code path can run on.
    expect(REGIONS.slice(1).map((r) => r.key)).toEqual([
      'los-padres', 'amazon-rondonia', 'siberia-baikal', 'portugal-centro',
      'victoria-alpine', 'congo-basin', 'sweden-norrland', 'greece-peloponnese',
    ])
  })

  it('gives every region a country, a fuel regime and an ignition regime', () => {
    for (const r of REGIONS) {
      expect(r.label.length).toBeGreaterThan(3)
      expect(r.country.length).toBeGreaterThan(2)
      expect(r.regime.length).toBeGreaterThan(3)
      expect(r.ignition.length).toBeGreaterThan(3)
    }
  })

  it('says plainly where lightning does NOT start the fires', () => {
    // The product only makes sense where lightning is the ignition source.
    // A picker that offered the Mediterranean without saying that >95% of
    // fires there are human-caused would be selling into a problem this
    // system does not solve.
    const byKey = Object.fromEntries(REGIONS.map((r) => [r.key, r]))
    for (const key of ['greece-peloponnese', 'portugal-centro',
                       'amazon-rondonia', 'congo-basin', 'los-padres']) {
      expect(byKey[key].lightningDriven).toBe(false)
      expect(byKey[key].ignition.toLowerCase()).toMatch(/human|clearing|deforest/)
    }
    for (const key of ['james-bay', 'siberia-baikal', 'sweden-norrland']) {
      expect(byKey[key].lightningDriven).toBe(true)
    }
  })

  it('quotes the Canadian split as the measured range, not one number', () => {
    // 81% is the long-run average and single seasons have run to 93%. The
    // evidence base says report the range; one number reads as a constant.
    const jb = REGIONS[0]
    expect(jb.ignition).toMatch(/81/)
    expect(jb.ignition).toMatch(/93/)
  })
})

describe('regionOptions', () => {
  it('marks only the regions the manifest says are baked', () => {
    const opts = regionOptions(['james-bay'])
    expect(opts).toHaveLength(9)
    expect(opts.filter((o) => o.baked).map((o) => o.key)).toEqual(['james-bay'])
  })

  it('marks nothing baked when the manifest is empty', () => {
    expect(regionOptions([]).some((o) => o.baked)).toBe(false)
  })

  it('ignores a manifest entry that is not a known region', () => {
    const opts = regionOptions(['james-bay', 'atlantis'])
    expect(opts).toHaveLength(9)
    expect(opts.filter((o) => o.baked)).toHaveLength(1)
  })

  it('agrees with the manifest actually committed to the repo', () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, '..', 'public', 'data', 'manifest.json'), 'utf-8'))
    const opts = regionOptions(manifest.baked)
    expect(opts.filter((o) => o.baked).map((o) => o.key).sort())
      .toEqual(['james-bay', 'los-padres'])
  })

  it('keeps every region visible rather than hiding the unbaked ones', () => {
    // The picker is what makes "the same code path runs anywhere on Earth"
    // checkable. Filtering to the baked ones would turn a global model into a
    // single demo.
    expect(regionOptions(['james-bay']).map((o) => o.key))
      .toEqual(REGIONS.map((r) => r.key))
  })
})
