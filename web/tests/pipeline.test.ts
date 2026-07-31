import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runPlacement } from '../src/lib/pipeline'
import { loadRegion, type RegionData } from '../src/lib/loadRegion'

const __dirname = dirname(fileURLToPath(import.meta.url))

function synthetic(nx = 40, ny = 30): RegionData {
  const data = new Float32Array(nx * ny)
  const mask = new Float32Array(nx * ny).fill(1)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      data[j * nx + i] =
        0.5 + 0.5 * Math.sin((3 * Math.PI * i) / (nx - 1)) *
        Math.cos((2 * Math.PI * j) / (ny - 1))
    }
  }
  return {
    meta: {
      name: 'synthetic', box: [0, 0, 1, 1], nx, ny,
      widthKm: 40, heightKm: 30, forestFraction: 1, fwiP90: 40,
      fwiNorm: 0.8, firmsCount: 0, firmsPadDeg: 0.25, classMix: {},
      seedFlatIndex: Math.floor((nx * ny) / 2),
      generated: '', sourceNotes: {},
    },
    risk: { nx, ny, data },
    mask: { nx, ny, data: mask },
    bbox: { west: 0, south: 0, east: 1, north: 1 },
  }
}

const params = {
  seed: 7, detectKm: 2, rMinKm: 1.1, rMaxKm: 2.6,
  target: 0.95, demandStride: 2, maxNodes: null,
}

describe('runPlacement', () => {
  it('produces candidates and a smaller chosen set', () => {
    const r = runPlacement(synthetic(), params)
    expect(r.candidateCount).toBeGreaterThan(0)
    expect(r.nodeCount).toBeGreaterThan(0)
    expect(r.nodeCount).toBeLessThanOrEqual(r.candidateCount)
  })

  it('reaches the coverage target', () => {
    const r = runPlacement(synthetic(), params)
    expect(r.coveredFraction).toBeGreaterThanOrEqual(params.target - 1e-9)
  })

  it('is deterministic for a fixed seed', () => {
    const a = runPlacement(synthetic(), params)
    const b = runPlacement(synthetic(), params)
    expect(Array.from(a.nodes)).toEqual(Array.from(b.nodes))
  })

  it('changes with the seed', () => {
    const a = runPlacement(synthetic(), params)
    const b = runPlacement(synthetic(), { ...params, seed: 8 })
    expect(Array.from(a.candidates)).not.toEqual(Array.from(b.candidates))
  })

  it('reports the reduction from the minimisation stage', () => {
    const r = runPlacement(synthetic(), params)
    const expected = 100 * (1 - r.nodeCount / r.candidateCount)
    expect(r.reductionPct).toBeCloseTo(expected, 9)
  })

  it('honours maxNodes', () => {
    const r = runPlacement(synthetic(), { ...params, maxNodes: 10 })
    expect(r.nodeCount).toBeLessThanOrEqual(10)
  })

  it('throws a clear error when seedFlatIndex is missing (stale meta.json)', () => {
    const region = synthetic()
    // Simulate a stale meta.json decoded through loadRegion's compile-time
    // cast: the field is typed as `number` but is absent at runtime.
    const stale = {
      ...region,
      meta: { ...region.meta, seedFlatIndex: undefined as unknown as number },
    }
    expect(() => runPlacement(stale, params)).toThrow(/seedFlatIndex/)
    expect(() => runPlacement(stale, params)).toThrow(/synthetic/)
  })

  it('throws a clear error when seedFlatIndex is out of range', () => {
    const region = synthetic()
    const bad = { ...region, meta: { ...region.meta, seedFlatIndex: region.meta.nx * region.meta.ny } }
    expect(() => runPlacement(bad, params)).toThrow(/seedFlatIndex/)
  })

  it('throws a clear error instead of returning an empty network when the seed pixel is masked out', () => {
    const region = synthetic()
    // Block every pixel, so variablePoissonDisk's mask check fails at the
    // seed pixel and it returns zero candidates.
    const blockedMask = new Float32Array(region.mask.data.length).fill(0)
    const blocked = { ...region, mask: { ...region.mask, data: blockedMask } }
    expect(() => runPlacement(blocked, params)).toThrow(/seedFlatIndex/)
    expect(() => runPlacement(blocked, params)).toThrow(/synthetic/)
  })
})

describe('runPlacement on the real los-padres region', () => {
  it('places hundreds of nodes and reaches 0.95 coverage', async () => {
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

    const region = await loadRegion('los-padres', realFetch)

    const r = runPlacement(region, {
      seed: 7,
      detectKm: 2.0,
      rMinKm: 2.0 * 0.55,
      rMaxKm: 2.0 * 1.30,
      target: 0.95,
      demandStride: 4,
      maxNodes: null,
    })

    // Exact parity reference, established against a matched Python run that
    // called place.variable_poisson_disk / greedy_minimise directly with
    // RefRNG(7) and these same parameters on the committed los-padres
    // rasters: 927 candidates -> 572 nodes, chosen sequence and coverage
    // bit-identical to 15 digits. Assert exactly (toBe, not a tolerance) so
    // a parity regression fails loudly instead of slipping past a loose
    // bound the way the earlier (wrong) 928/561 reference did.
    expect(r.candidateCount).toBe(927)
    expect(r.nodeCount).toBe(572)
    expect(r.coveredFraction).toBe(0.950127412638781)
  }, 60000)
})
