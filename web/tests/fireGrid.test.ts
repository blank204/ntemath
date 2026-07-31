import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = join(dirname(fileURLToPath(import.meta.url)),
                 '..', 'public', 'data', 'los-padres')

function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

const meta = JSON.parse(readFileSync(join(DIR, 'arrivals.json'), 'utf-8'))

describe('baked arrival set', () => {
  it('names the spread rule it was produced by', () => {
    // Every detection number the site shows has to state this, and it must
    // come from the bake rather than from a string in the UI.
    expect(typeof meta.rule).toBe('string')
    expect(meta.rule.length).toBeGreaterThan(2)
    expect(meta.tEndMin).toBeGreaterThan(0)
    expect(meta.dMin).toBeGreaterThan(0)
    expect(meta.meshCells).toBeGreaterThan(100000)
  })

  it('ships exactly 100 ignitions, each inside the region box', () => {
    expect(meta.ignitions).toHaveLength(100)
    const [w, s, e, n] = meta.grid.boxLonLat
    for (const ig of meta.ignitions) {
      expect(ig.lon).toBeGreaterThanOrEqual(w)
      expect(ig.lon).toBeLessThanOrEqual(e)
      expect(ig.lat).toBeGreaterThanOrEqual(s)
      expect(ig.lat).toBeLessThanOrEqual(n)
    }
  })

  it('lays out arrivals.bin exactly as the offsets claim', () => {
    const raw = bytes('arrivals.bin')
    expect(raw.length % 8).toBe(0)
    const total = raw.length / 8
    let expected = 0
    for (const ig of meta.ignitions) {
      expect(ig.offset).toBe(expected)
      expected += ig.count
    }
    expect(total).toBe(expected)
  })

  it('keeps every cell index inside the declared grid', () => {
    const raw = bytes('arrivals.bin')
    const u32 = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    const cells = meta.grid.nx * meta.grid.ny
    expect(cells).toBeLessThanOrEqual(4294967295)
    let worst = -1
    for (let i = 0; i < u32.length; i += 2) worst = Math.max(worst, u32[i])
    expect(worst).toBeLessThan(cells)
  })

  it('keeps every arrival time inside the simulated window', () => {
    const raw = bytes('arrivals.bin')
    const u32 = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    let worst = -1
    for (let i = 1; i < u32.length; i += 2) worst = Math.max(worst, u32[i])
    expect(worst).toBeLessThanOrEqual(meta.tEndMin)
  })

  it('burns something on every ignition', () => {
    // A run that burnt nothing is not an ignition, it is a censored row
    // pretending to be one, and it would drag the median toward censoring
    // for a reason that has nothing to do with the placement.
    for (const ig of meta.ignitions) expect(ig.burntCells).toBeGreaterThan(0)
  })

  it('records how far each ignition was snapped', () => {
    for (const ig of meta.ignitions) {
      expect(Number.isFinite(ig.shiftM)).toBe(true)
      expect(ig.shiftM).toBeGreaterThanOrEqual(0)
    }
  })
})
