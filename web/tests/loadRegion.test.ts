import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadRegion } from '../src/lib/loadRegion'

const __dirname = dirname(fileURLToPath(import.meta.url))

const meta = {
  name: 'test', box: [-1, 2, 0, 3], nx: 2, ny: 2,
  widthKm: 10, heightKm: 20, forestFraction: 0.5, fwiP90: 40,
  fwiNorm: 0.8, firmsCount: 3, firmsPadDeg: 0.25, classMix: { '10': 0.5 },
  seedFlatIndex: 1,
  generated: '2026-07-31T00:00:00Z',
  sourceNotes: { notModelled: ['elevation/slope', 'camper traffic'] },
}

function fakeFetch(risk: Float32Array, mask: Uint8Array): typeof fetch {
  return (async (url: string) => {
    if (url.endsWith('meta.json')) {
      return { ok: true, json: async () => meta } as any
    }
    if (url.endsWith('risk.bin')) {
      return { ok: true, arrayBuffer: async () => risk.buffer } as any
    }
    if (url.endsWith('mask.bin')) {
      return { ok: true, arrayBuffer: async () => mask.buffer } as any
    }
    return { ok: false, status: 404 } as any
  }) as any
}

describe('loadRegion', () => {
  it('decodes metadata, risk and mask into Fields', async () => {
    const risk = Float32Array.from([0, 0.25, 0.5, 1])
    const mask = Uint8Array.from([1, 1, 0, 1])
    const r = await loadRegion('test', fakeFetch(risk, mask))

    expect(r.meta.name).toBe('test')
    expect(r.risk.nx).toBe(2)
    expect(r.risk.ny).toBe(2)
    expect(Array.from(r.risk.data)).toEqual([0, 0.25, 0.5, 1])
    expect(Array.from(r.mask.data)).toEqual([1, 1, 0, 1])
    expect(r.bbox).toEqual({ west: -1, south: 2, east: 0, north: 3 })
  })

  it('rejects when the raster size disagrees with the metadata', async () => {
    const risk = Float32Array.from([0, 1])          // 2 values, meta says 4
    const mask = Uint8Array.from([1, 1, 1, 1])
    await expect(loadRegion('test', fakeFetch(risk, mask)))
      .rejects.toThrow(/risk\.bin/)
  })

  it('rejects a failed fetch', async () => {
    const bad = (async () => ({ ok: false, status: 500 })) as any
    await expect(loadRegion('test', bad)).rejects.toThrow(/500/)
  })

  it('loads the real committed los-padres data from disk', async () => {
    const dataDir = join(__dirname, '..', 'public', 'data', 'los-padres')
    const realMeta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf-8'))
    const riskBuf = readFileSync(join(dataDir, 'risk.bin'))
    const maskBuf = readFileSync(join(dataDir, 'mask.bin'))

    const realFetch = (async (url: string) => {
      if (url.endsWith('meta.json')) {
        return { ok: true, json: async () => realMeta } as any
      }
      if (url.endsWith('risk.bin')) {
        return {
          ok: true,
          arrayBuffer: async () =>
            riskBuf.buffer.slice(riskBuf.byteOffset, riskBuf.byteOffset + riskBuf.byteLength),
        } as any
      }
      if (url.endsWith('mask.bin')) {
        return {
          ok: true,
          arrayBuffer: async () =>
            maskBuf.buffer.slice(maskBuf.byteOffset, maskBuf.byteOffset + maskBuf.byteLength),
        } as any
      }
      return { ok: false, status: 404 } as any
    }) as any

    const r = await loadRegion('los-padres', realFetch)

    const expected = r.meta.nx * r.meta.ny
    expect(r.risk.data.length).toBe(expected)
    expect(r.mask.data.length).toBe(expected)

    let riskOutOfRange = 0
    for (let i = 0; i < r.risk.data.length; i++) {
      const v = r.risk.data[i]
      if (v < 0 || v > 1) riskOutOfRange++
    }
    expect(riskOutOfRange).toBe(0)

    let maskInvalid = 0
    for (let i = 0; i < r.mask.data.length; i++) {
      const v = r.mask.data[i]
      if (v !== 0 && v !== 1) maskInvalid++
    }
    expect(maskInvalid).toBe(0)

    expect(typeof r.meta.seedFlatIndex).toBe('number')
    expect(r.meta.seedFlatIndex).toBeGreaterThanOrEqual(0)
    expect(r.meta.seedFlatIndex).toBeLessThan(expected)
    expect(r.mask.data[r.meta.seedFlatIndex]).toBe(1)
  }, 20000)
})
