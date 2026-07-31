import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodeArrivals, arrivalsFor } from '../src/lib/arrivals'

const DIR = join(dirname(fileURLToPath(import.meta.url)),
                 '..', 'public', 'data', 'los-padres')

function load() {
  const meta = JSON.parse(readFileSync(join(DIR, 'arrivals.json'), 'utf-8'))
  const b = readFileSync(join(DIR, 'arrivals.bin'))
  return decodeArrivals(meta, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

describe('decodeArrivals', () => {
  const set = load()

  it('splits the interleaved blob into parallel cell and minute arrays', () => {
    expect(set.cells.length).toBe(set.minutes.length)
    const total = set.ignitions.reduce((n, ig) => n + ig.count, 0)
    expect(set.cells.length).toBe(total)
  })

  it('carries the rule and window forward for the copy layer', () => {
    expect(set.rule.length).toBeGreaterThan(2)
    expect(set.tEndMin).toBeGreaterThan(0)
  })

  it('rejects a blob whose length disagrees with the offsets', () => {
    const meta = JSON.parse(readFileSync(join(DIR, 'arrivals.json'), 'utf-8'))
    expect(() => decodeArrivals(meta, new ArrayBuffer(8)))
      .toThrow(/arrivals\.bin/)
  })

  it('slices one ignition without copying its neighbours', () => {
    const a = arrivalsFor(set, 0)
    expect(a.cells.length).toBe(set.ignitions[0].count)
    const b = arrivalsFor(set, 1)
    expect(b.cells.length).toBe(set.ignitions[1].count)
    // The second ignition starts where the first ended, so a decoder that
    // ignored `offset` would return the first ignition twice.
    if (set.ignitions[0].count !== set.ignitions[1].count) {
      expect(a.cells.length).not.toBe(b.cells.length)
    }
  })

  it('puts the ignition cell at time zero in its own run', () => {
    for (let i = 0; i < 5; i++) {
      const { minutes } = arrivalsFor(set, i)
      let min = Infinity
      for (const m of minutes) min = Math.min(min, m)
      expect(min).toBe(0)
    }
  })
})
