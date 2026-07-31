import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', 'public', 'data')

/**
 * Node's readFileSync returns a Buffer that may be a view into a pooled
 * allocation, so `buf.buffer` alone would read the wrong bytes. Slice by the
 * view's own offset and length — the trap Plan 1's Task 11 handled.
 */
function bytesIn(dir: string, name: string): Uint8Array {
  const b = readFileSync(join(dir, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'))

// Every baked region, not just the first one. These checks are about what the
// bake guarantees — grid sizes, a mask derived from the classes, a layer
// normalised to its own peak — and a guarantee that holds for one region and
// is never checked on the next is a guarantee only by habit.
describe.each(manifest.baked as string[])('baked artifacts: %s', (region) => {
  const DIR = join(ROOT, region)
  const bytes = (name: string) => bytesIn(DIR, name)
  const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8'))

  it('declares which layer drives its risk field, and ships that file', () => {
    expect(['lightning', 'fire-activity']).toContain(meta.layer)
    expect(meta.layerFile).toBe(
      meta.layer === 'lightning' ? 'lightning.bin' : 'activity.bin')
    expect(bytes(meta.layerFile).length).toBe(meta.nx * meta.ny * 4)
  })

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

  it('sizes every raster to the declared grid', () => {
    const n = meta.nx * meta.ny
    expect(bytes('classes.bin').length).toBe(n)
    expect(bytes(meta.layerFile).length).toBe(n * 4)
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

  it('keeps the layer field finite, non-negative, and peaked at 1', () => {
    const a = bytes(meta.layerFile)
    const f = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4)
    let max = -Infinity
    let bad = 0
    for (let i = 0; i < f.length; i++) {
      if (!Number.isFinite(f[i]) || f[i] < 0) bad++
      if (f[i] > max) max = f[i]
    }
    expect(bad).toBe(0)
    // Both layers normalise to their own peak inside the box — which is
    // what lets the risk recombination stay byte-identical arithmetic
    // across the pivot, and what makes 1.0 mean "the most-struck (or
    // most-detected) ground in THIS region" and nothing more.
    expect(max).toBeCloseTo(1, 6)
  })

  it('publishes the gradient gate whenever lightning drives the risk', () => {
    if (meta.layer !== 'lightning') {
      expect(meta.lightningGate).toBeUndefined()
      return
    }
    const g = meta.lightningGate
    // The gate is a measurement on the raw climatology, so it has to carry
    // the sample it rests on. A verdict with no counts behind it is a claim.
    expect(g.cells).toBeGreaterThan(0)
    expect(g.flashes).toBeGreaterThan(0)
    expect(g.nativeDeg).toBe(0.5)
    expect(['gradient', 'structured', 'flat']).toContain(g.verdict)
    // The chi-square compares counts directly, which is only fair if every
    // cell was watched for about as long.
    expect(g.viewtimeSpreadPct).toBeLessThan(5)
    if (g.verdict !== 'flat') expect(g.pUniform).toBeLessThan(0.01)
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
