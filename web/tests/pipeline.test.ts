import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { runPlacement } from '../src/lib/pipeline'
import { loadRegion, type RegionData, type RegionMeta } from '../src/lib/loadRegion'
import { burnableMaskOf, DEFAULT_WEIGHTS } from '../src/lib/risk'
import { DEFAULT_PARAMS } from '../src/state/useModelStore'

// Hand-transcribed from `python -m tools.bake.verify_parity`. NOT generated
// into this file: this test is worth having only because a Python run and a
// TypeScript run, written independently, arrive at the same numbers. If it
// fails, find the divergence — never re-baseline it from the TS output.
const PARITY = {
  demandCount: 31045,
  candidateCount: 927,
  nodeCount: 572,
  coveredFraction: 0.9501274126362225,
  areaFraction: 0.948204219681108,
  chosenSha256: '6e607409dd821efaa1580c31856e23d814c4b53a9bbe88126ee3ccce6fdece3b',
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'public', 'data', 'los-padres')

/**
 * The synthetic region is built from COMPONENTS now, not a pre-combined risk
 * raster: `runPlacement` recombines, so handing it a risk field is no longer
 * possible. Every pixel is WorldCover 10 (tree cover, flammability 1.0) and
 * the spatial structure lives in the activity field, which is what the live
 * `w_activity` weight actually multiplies.
 */
function synthetic(nx = 40, ny = 30): RegionData {
  const activity = new Float32Array(nx * ny)
  const classes = new Uint8Array(nx * ny).fill(10)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      activity[j * nx + i] =
        0.5 + 0.5 * Math.sin((3 * Math.PI * i) / (nx - 1)) *
        Math.cos((2 * Math.PI * j) / (ny - 1))
    }
  }
  const meta: RegionMeta = {
    name: 'synthetic', box: [0, 0, 1, 1], nx, ny,
    widthKm: 40, heightKm: 30, areaKm2: 1200, forestFraction: 1, fwiP90: 40,
    fwiNorm: 0.8, firmsCount: 0, firmsPadDeg: 0.25, classMix: {},
    seedFlatIndex: Math.floor((nx * ny) / 2), seedTiesAtMax: 1, riskPeak: 1,
    flammability: { '10': 1.0, '80': 0.0 },
    burnableClasses: [10],
    weightDefaults: { ...DEFAULT_WEIGHTS },
    fwiFullScale: 80, km2PerNode: 140, budgetLo: 6, budgetHi: 40,
    generated: '', sourceNotes: {},
  }
  const field = { nx, ny, data: classes }
  return {
    meta,
    classes: field,
    activity,
    mask: burnableMaskOf(field, meta.burnableClasses),
    bbox: { west: 0, south: 0, east: 1, north: 1 },
  }
}

const params = {
  seed: 7, detectKm: 2, rMinKm: 1.1, rMaxKm: 2.6,
  target: 0.95, demandStride: 2, maxNodes: null,
  ...DEFAULT_WEIGHTS,
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

  it('throws a clear error instead of returning an empty network when the mask allows nothing', () => {
    const region = synthetic()
    // Block every pixel, so resolveSeedIndex has no allowed pixel to start
    // from. Silently continuing would hand the site an empty network as if it
    // were a real result.
    const blockedMask = new Float32Array(region.mask.data.length).fill(0)
    const blocked = { ...region, mask: { ...region.mask, data: blockedMask } }
    expect(() => runPlacement(blocked, params)).toThrow(/no burnable pixel/)
    expect(() => runPlacement(blocked, params)).toThrow(/synthetic/)
  })
})

const slice = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)

function realFetch() {
  const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf-8'))
  const classBuf = readFileSync(join(dataDir, 'classes.bin'))
  const actBuf = readFileSync(join(dataDir, 'activity.bin'))
  return (async (url: string) => {
    if (url.endsWith('meta.json')) return { ok: true, json: async () => meta } as never
    if (url.endsWith('classes.bin')) return { ok: true, arrayBuffer: async () => slice(classBuf) } as never
    if (url.endsWith('activity.bin')) return { ok: true, arrayBuffer: async () => slice(actBuf) } as never
    return { ok: false, status: 404 } as never
  }) as unknown as typeof fetch
}

/**
 * The real region, assembled from the committed COMPONENTS. `b.buffer` alone
 * would be Node's pooled allocation, not this file's bytes — hence the slice.
 */
function losPadres(): RegionData {
  const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf-8')) as RegionMeta
  const cb = readFileSync(join(dataDir, 'classes.bin'))
  const ab = readFileSync(join(dataDir, 'activity.bin'))
  const classes = { nx: meta.nx, ny: meta.ny, data: new Uint8Array(slice(cb)) }
  const [west, south, east, north] = meta.box
  return {
    meta,
    classes,
    activity: new Float32Array(slice(ab)),
    mask: burnableMaskOf(classes, meta.burnableClasses),
    bbox: { west, south, east, north },
  }
}

describe('runPlacement on the real los-padres region', () => {
  const loadReal = async () => loadRegion('los-padres', realFetch())

  it('reproduces the Python reference run on the committed rasters', async () => {
    const region = await loadReal()

    const r = runPlacement(region, {
      seed: 7,
      detectKm: 2.0,
      rMinKm: 2.0 * 0.55,
      rMaxKm: 2.0 * 1.30,
      target: 0.95,
      demandStride: 4,
      maxNodes: null,
      ...DEFAULT_WEIGHTS,
    })

    expect(r.candidateCount).toBe(PARITY.candidateCount)
    expect(r.nodeCount).toBe(PARITY.nodeCount)
    expect(r.coveredFraction).toBe(PARITY.coveredFraction)
    expect(r.areaFraction).toBe(PARITY.areaFraction)
    expect(createHash('sha256').update(r.chosen.join(',')).digest('hex'))
      .toBe(PARITY.chosenSha256)
  }, 60000)

  it('reproduces the Python at a NON-default detection radius (0.6 km)', async () => {
    // detectKm = 2.0 is the one point on the slider where float64 radius
    // arithmetic happened to agree with numpy's float32. It does not agree
    // everywhere: before field.ts mirrored NEP 50's narrowing with
    // Math.fround, this configuration produced 10262 candidates in the
    // browser against 10322 in Python — a different network, reachable by
    // dragging one slider. Reference from a matched Python run
    // (place.variable_poisson_disk + demand_points + greedy_minimise,
    // RefRNG(7), float32 risk.bin/mask.bin, stride 4, target 0.95).
    const region = await loadReal()

    const r = runPlacement(region, {
      seed: 7,
      detectKm: 0.6,
      rMinKm: 0.6 * 0.55,
      rMaxKm: 0.6 * 1.30,
      target: 0.95,
      demandStride: 4,
      maxNodes: null,
      ...DEFAULT_WEIGHTS,
    })

    expect(r.candidateCount).toBe(10322)
    expect(r.nodeCount).toBe(5514)
    expect(r.coveredFraction).toBe(0.9500380659125003)
    expect(r.areaFraction).toBe(0.9447898212272507)
  }, 300000)
})

describe('live weights', () => {
  it('moves the network when the activity weight moves', () => {
    const region = losPadres()
    const a = runPlacement(region, DEFAULT_PARAMS)
    const b = runPlacement(region, { ...DEFAULT_PARAMS, wActivity: 0 })
    expect(b.candidateCount).not.toBe(a.candidateCount)
  }, 600000)

  it('is invariant to weight triples with the same activity-to-scalar ratio', () => {
    // fwiNorm is a single regional SCALAR, so w_weather has no spatial
    // structure: with s = w_base + w_weather*fwiNorm, the normalised field
    // depends on (w_weather, w_activity, w_base) only through w_activity / s.
    // Two triples with the same ratio must therefore produce the same field —
    // and the same network. This is a property of the model as written, and
    // the Lab says so on screen rather than implying three independent
    // controls.
    const region = losPadres()
    const fwi = region.meta.fwiNorm
    const sOf = (ww: number, wb: number) => wb + ww * fwi

    const p1 = { wWeather: 0.45, wActivity: 0.35, wBase: 0.20 }
    const k = p1.wActivity / sOf(p1.wWeather, p1.wBase)
    // Any second (wWeather, wBase) reproducing k gives the same normalised
    // field; the three weights are independent, so pick them directly rather
    // than solving under a sum-to-1 constraint the model never imposes.
    const ww2 = 0.20
    const wb2 = 0.50
    const p2 = { wWeather: ww2, wBase: wb2, wActivity: k * sOf(ww2, wb2) }

    const a = runPlacement(region, { ...DEFAULT_PARAMS, ...p1 })
    const b = runPlacement(region, { ...DEFAULT_PARAMS, ...p2 })

    let worst = 0
    for (let i = 0; i < a.risk.data.length; i++) {
      worst = Math.max(worst, Math.abs(a.risk.data[i] - b.risk.data[i]))
    }
    // Not exact: the two paths reach the same real number by different
    // float64 roundings, so allow a couple of float32 ulps at 1.0.
    expect(worst).toBeLessThan(2.4e-7)
    expect(b.candidateCount).toBe(a.candidateCount)
  }, 300000)

  it('reports the seed it actually used and how contested it was', () => {
    const r = runPlacement(losPadres(), DEFAULT_PARAMS)
    expect(r.seedFlatIndex).toBe(539100)
    expect(r.seedTiesAtMax).toBe(1)
  }, 120000)
})
