import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadRegion, loadManifest } from '../src/lib/loadRegion'

const __dirname = dirname(fileURLToPath(import.meta.url))

const meta = {
  name: 'test', box: [-1, 2, 0, 3], nx: 2, ny: 2,
  widthKm: 10, heightKm: 20, forestFraction: 0.5, fwiP90: 40,
  fwiNorm: 0.5, firmsCount: 3, firmsPadDeg: 0.25, classMix: { '10': 0.5 },
  seedFlatIndex: 0, seedTiesAtMax: 1, areaKm2: 200, riskPeak: 0.7,
  flammability: { '10': 1, '30': 0.75, '80': 0 },
  burnableClasses: [10, 30],
  weightDefaults: { wBase: 0.2, wWeather: 0.45, wActivity: 0.35 },
  fwiFullScale: 80, km2PerNode: 140, budgetLo: 6, budgetHi: 40,
  generated: '2026-07-31T00:00:00Z',
  sourceNotes: { notModelled: ['elevation/slope', 'camper traffic'] },
}

function fakeFetch(classes: Uint8Array, activity: Float32Array): typeof fetch {
  return (async (url: string) => {
    if (url.endsWith('meta.json')) return { ok: true, json: async () => meta } as any
    if (url.endsWith('classes.bin')) return { ok: true, arrayBuffer: async () => classes.buffer } as any
    if (url.endsWith('activity.bin')) return { ok: true, arrayBuffer: async () => activity.buffer } as any
    return { ok: false, status: 404 } as any
  }) as any
}

describe('loadRegion', () => {
  it('decodes the components and derives the burnable mask', async () => {
    const r = await loadRegion('test', fakeFetch(
      Uint8Array.from([10, 30, 80, 10]),
      Float32Array.from([0, 0.25, 0.5, 1]),
    ))
    expect(r.meta.name).toBe('test')
    expect(Array.from(r.classes.data)).toEqual([10, 30, 80, 10])
    expect(Array.from(r.activity)).toEqual([0, 0.25, 0.5, 1])
    expect(Array.from(r.mask.data)).toEqual([1, 1, 0, 1])
    expect(r.bbox).toEqual({ west: -1, south: 2, east: 0, north: 3 })
  })

  it('rejects when classes.bin disagrees with the metadata', async () => {
    await expect(loadRegion('test', fakeFetch(
      Uint8Array.from([10, 30]), Float32Array.from([0, 0, 0, 0]),
    ))).rejects.toThrow(/classes\.bin/)
  })

  it('rejects when activity.bin disagrees with the metadata', async () => {
    await expect(loadRegion('test', fakeFetch(
      Uint8Array.from([10, 30, 80, 10]), Float32Array.from([0, 1]),
    ))).rejects.toThrow(/activity\.bin/)
  })

  it('rejects metadata that is missing a constant the model needs', async () => {
    const stripped = { ...meta } as any
    delete stripped.flammability
    const f = (async (url: string) =>
      url.endsWith('meta.json')
        ? { ok: true, json: async () => stripped }
        : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) as any
    await expect(loadRegion('test', f)).rejects.toThrow(/flammability/)
  })

  it('rejects a failed fetch', async () => {
    const bad = (async () => ({ ok: false, status: 500 })) as any
    await expect(loadRegion('test', bad)).rejects.toThrow(/500/)
  })

  it('loads the real committed los-padres components from disk', async () => {
    const dataDir = join(__dirname, '..', 'public', 'data', 'los-padres')
    const realMeta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf-8'))
    const slice = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
    const classBuf = readFileSync(join(dataDir, 'classes.bin'))
    const actBuf = readFileSync(join(dataDir, 'activity.bin'))

    const realFetch = (async (url: string) => {
      if (url.endsWith('meta.json')) {
        return { ok: true, json: async () => realMeta } as any
      }
      if (url.endsWith('classes.bin')) {
        return { ok: true, arrayBuffer: async () => slice(classBuf) } as any
      }
      if (url.endsWith('activity.bin')) {
        return { ok: true, arrayBuffer: async () => slice(actBuf) } as any
      }
      return { ok: false, status: 404 } as any
    }) as any

    const r = await loadRegion('los-padres', realFetch)

    const expected = r.meta.nx * r.meta.ny
    expect(r.classes.data.length).toBe(expected)
    expect(r.activity.length).toBe(expected)
    expect(r.mask.data.length).toBe(expected)

    let activityOutOfRange = 0
    for (let i = 0; i < r.activity.length; i++) {
      const v = r.activity[i]
      if (!(v >= 0 && v <= 1)) activityOutOfRange++
    }
    expect(activityOutOfRange).toBe(0)

    let maskInvalid = 0
    for (let i = 0; i < r.mask.data.length; i++) {
      const v = r.mask.data[i]
      if (v !== 0 && v !== 1) maskInvalid++
    }
    expect(maskInvalid).toBe(0)

    // The mask is derived here, not fetched, so it must still agree with the
    // seed the bake resolved — otherwise placement would start from a pixel
    // the browser's own mask forbids.
    expect(typeof r.meta.seedFlatIndex).toBe('number')
    expect(r.meta.seedFlatIndex).toBeGreaterThanOrEqual(0)
    expect(r.meta.seedFlatIndex).toBeLessThan(expected)
    expect(r.mask.data[r.meta.seedFlatIndex]).toBe(1)
  }, 20000)
})

describe('loadManifest', () => {
  it('reads the baked-region list from /data/manifest.json', async () => {
    let asked = ''
    const f = (async (url: string) => {
      asked = url
      return { ok: true, json: async () => ({ baked: ['los-padres'], generated: 'x' }) }
    }) as any
    const m = await loadManifest(f)
    expect(asked).toBe('/data/manifest.json')
    expect(m.baked).toEqual(['los-padres'])
  })
})
