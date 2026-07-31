import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', 'public', 'data')
const DIR = join(ROOT, 'los-padres')

/**
 * Node's readFileSync returns a Buffer that may be a view into a pooled
 * allocation, so `buf.buffer` alone would read the wrong bytes. Slice by the
 * view's own offset and length — the trap Plan 1's Task 11 handled.
 */
function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8'))

describe('baked component artifacts', () => {
  it('publishes the model constants instead of leaving them to be guessed', () => {
    expect(meta.flammability['10']).toBe(1)
    expect(meta.flammability['30']).toBe(0.75)
    expect(meta.flammability['100']).toBe(0.55)
    expect(meta.flammability['40']).toBe(0.3)
    expect(meta.flammability['80']).toBe(0)
    expect(meta.burnableClasses.slice().sort((a: number, b: number) => a - b))
      .toEqual([10, 20, 30, 40, 100])
    expect(meta.weightDefaults).toEqual({ wBase: 0.2, wWeather: 0.45, wActivity: 0.35 })
    expect(meta.fwiFullScale).toBe(80)
    expect(meta.km2PerNode).toBe(140)
    expect(meta.budgetLo).toBe(6)
    expect(meta.budgetHi).toBe(40)
    expect(meta.riskPeak).toBeGreaterThan(0)
    expect(meta.areaKm2).toBeGreaterThan(1000)
  })

  it('sizes classes.bin and activity.bin to the declared grid', () => {
    const n = meta.nx * meta.ny
    expect(bytes('classes.bin').length).toBe(n)
    expect(bytes('activity.bin').length).toBe(n * 4)
    expect(bytes('risk.bin').length).toBe(n * 4)
    expect(bytes('mask.bin').length).toBe(n)
  })

  it('only emits class codes the flammability table knows about', () => {
    const known = new Set(Object.keys(meta.flammability).map(Number))
    const seen = new Set<number>()
    for (const c of bytes('classes.bin')) seen.add(c)
    for (const c of seen) expect(known.has(c) || c === 0).toBe(true)
    expect(seen.size).toBeGreaterThan(3)
  })

  it('derives mask.bin exactly from classes.bin', () => {
    const classes = bytes('classes.bin')
    const mask = bytes('mask.bin')
    const burnable = new Set<number>(meta.burnableClasses)
    let mismatches = 0
    let firstBad = -1
    for (let i = 0; i < classes.length; i++) {
      const want = burnable.has(classes[i]) ? 1 : 0
      if (mask[i] !== want) { if (firstBad < 0) firstBad = i; mismatches++ }
    }
    expect({ mismatches, firstBad }).toEqual({ mismatches: 0, firstBad: -1 })
  })

  it('keeps the activity field finite, non-negative, and peaked at 1', () => {
    const a = bytes('activity.bin')
    const f = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4)
    let max = -Infinity
    let bad = 0
    for (let i = 0; i < f.length; i++) {
      if (!Number.isFinite(f[i]) || f[i] < 0) bad++
      if (f[i] > max) max = f[i]
    }
    expect(bad).toBe(0)
    // hazard.activity_field normalises to its own peak inside the box.
    expect(max).toBeCloseTo(1, 6)
  })

  it('reports a seed index that is in range and on a burnable pixel', () => {
    const classes = bytes('classes.bin')
    const burnable = new Set<number>(meta.burnableClasses)
    expect(Number.isInteger(meta.seedFlatIndex)).toBe(true)
    expect(meta.seedFlatIndex).toBeGreaterThanOrEqual(0)
    expect(meta.seedFlatIndex).toBeLessThan(meta.nx * meta.ny)
    expect(burnable.has(classes[meta.seedFlatIndex])).toBe(true)
    expect(meta.seedTiesAtMax).toBeGreaterThanOrEqual(1)
  })
})

describe('data manifest', () => {
  it('lists exactly the region directories that hold a meta.json', () => {
    const onDisk = readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, 'meta.json')))
      .map((d) => d.name)
      .sort()
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'))
    expect(manifest.baked.slice().sort()).toEqual(onDisk)
    expect(onDisk).toContain('los-padres')
  })
})
