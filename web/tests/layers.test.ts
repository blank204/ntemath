import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEFAULT_WEIGHTS } from '../src/lib/risk'

/**
 * vite.config.ts sets `environment: 'node'`, where `ImageData` does not
 * exist. riskToImage only ever calls `new ImageData(w, h)` and then writes
 * into `.data`, so a four-line shim covers the whole surface it uses — far
 * less machinery than pulling jsdom in for one constructor. Installed before
 * the module under test is imported.
 */
class ImageDataShim {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}
;(globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataShim

const __dirname = dirname(fileURLToPath(import.meta.url))

// Imported after the shim is installed.
let riskToImage: typeof import('../src/map/layers')['riskToImage']
let nodesLayer: typeof import('../src/map/layers')['nodesLayer']
let loadRegion: typeof import('../src/lib/loadRegion')['loadRegion']
let runPlacement: typeof import('../src/lib/pipeline')['runPlacement']
let LocalFrame: typeof import('../src/lib/frame')['LocalFrame']

beforeAll(async () => {
  ;({ riskToImage, nodesLayer } = await import('../src/map/layers'))
  ;({ loadRegion } = await import('../src/lib/loadRegion'))
  ;({ runPlacement } = await import('../src/lib/pipeline'))
  ;({ LocalFrame } = await import('../src/lib/frame'))
})

const dataDir = join(__dirname, '..', 'public', 'data', 'los-padres')

function realFetch() {
  const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf-8'))
  const classBuf = readFileSync(join(dataDir, 'classes.bin'))
  const actBuf = readFileSync(join(dataDir, 'activity.bin'))
  const slice = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  return (async (url: string) => {
    if (url.endsWith('meta.json')) return { ok: true, json: async () => meta } as never
    if (url.endsWith('classes.bin')) return { ok: true, arrayBuffer: async () => slice(classBuf) } as never
    if (url.endsWith('activity.bin')) return { ok: true, arrayBuffer: async () => slice(actBuf) } as never
    return { ok: false, status: 404 } as never
  }) as unknown as typeof fetch
}

describe('riskToImage vertical flip', () => {
  it('puts raster row 0 (SOUTH) at the BOTTOM of the ImageData', () => {
    // Two rows, two columns. Row 0 is the south edge and carries risk 1.0;
    // row 1 (north) carries risk 0.0. ImageData row 0 is the TOP of the
    // picture, so the south row must come out LAST.
    const nx = 2, ny = 2
    const risk = { nx, ny, data: Float32Array.from([1, 1, 0, 0]) }
    const mask = { nx, ny, data: Float32Array.from([1, 1, 1, 1]) }
    const img = riskToImage(risk, mask)

    const px = (row: number, col: number) => {
      const o = (row * nx + col) * 4
      return [img.data[o], img.data[o + 1], img.data[o + 2]]
    }
    // PALETTE.riskRamp: index 0 is '#644E38' (risk 0), index 4 is '#E7C3A2'
    // (risk 1). The hot row must land on ImageData's bottom row (row 1).
    expect(px(1, 0)).toEqual([0xe7, 0xc3, 0xa2])
    expect(px(1, 1)).toEqual([0xe7, 0xc3, 0xa2])
    expect(px(0, 0)).toEqual([0x64, 0x4e, 0x38])
    expect(px(0, 1)).toEqual([0x64, 0x4e, 0x38])
  })

  it('flips every row, not just the ends', () => {
    const nx = 1, ny = 5
    const risk = { nx, ny, data: Float32Array.from([0, 0.25, 0.5, 0.75, 1]) }
    const mask = { nx, ny, data: Float32Array.from([1, 1, 1, 1, 1]) }
    const img = riskToImage(risk, mask)
    // Risk ascends south -> north in the raster, so after the flip the
    // brightest ramp value must sit at the TOP of the ImageData and the red
    // channel must fall monotonically downward. Without the flip it rises.
    const reds = [0, 1, 2, 3, 4].map((r) => img.data[r * 4])
    expect(reds).toEqual([0xe7, 0xd0, 0xb0, 0x89, 0x64])
    for (let r = 1; r < reds.length; r++) {
      expect(reds[r]).toBeLessThan(reds[r - 1])
    }
  })

  it('carries the mask through as alpha without flipping it separately', () => {
    const nx = 1, ny = 2
    const risk = { nx, ny, data: Float32Array.from([0.5, 0.5]) }
    const mask = { nx, ny, data: Float32Array.from([1, 0]) } // south burnable
    const img = riskToImage(risk, mask)
    // South row -> bottom of the image, and it is the burnable one (alpha 200).
    expect(img.data[7]).toBe(200)   // row 1 (bottom), alpha
    expect(img.data[3]).toBe(40)    // row 0 (top), alpha
  })
})

describe('nodesLayer coordinate conversion', () => {
  it('places every real Los Padres node inside the region bbox', async () => {
    const region = await loadRegion('los-padres', realFetch())
    const r = runPlacement(region, {
      seed: 7, detectKm: 2.0, target: 0.95, demandStride: 4,
      budgetMode: 'saturation', fixedNodes: 100, spacingOverride: null,
      ...DEFAULT_WEIGHTS,
    })
    expect(r.nodeCount).toBe(572)

    const layer = nodesLayer(region, r.nodes)
    const data = layer.props.data as { position: [number, number] }[]
    expect(data.length).toBe(572)

    const { west, south, east, north } = region.bbox
    let outside = 0
    for (const d of data) {
      const [lon, lat] = d.position
      if (lon < west || lon > east || lat < south || lat > north) outside++
    }
    expect(outside).toBe(0)

    // MUTATION GUARD. variablePoissonDisk returns km from the region's
    // SOUTH-WEST CORNER; LocalFrame is CENTRE-origin. Without the
    // half-extent subtraction in nodesLayer, the whole network shifts
    // north-east by half the box — which is exactly the bug plan.py:285-286
    // still ships (see docs/repo-issues.md 1.5). Prove the correction is
    // load-bearing rather than decorative.
    const frame = new LocalFrame(region.bbox)
    let outsideUncorrected = 0
    for (let i = 0; i < r.nodes.length / 2; i++) {
      const [lon, lat] = frame.toLonLat(r.nodes[2 * i], r.nodes[2 * i + 1])
      if (lon < west || lon > east || lat < south || lat > north) outsideUncorrected++
    }
    expect(outsideUncorrected).toBe(449)
    expect(outsideUncorrected / data.length).toBeGreaterThan(0.5)
  }, 120000)

  it('maps the region centre in SW-corner km to the box centre in lon/lat', () => {
    const region = {
      meta: { widthKm: 82.36896718278675, heightKm: 66.79200000000016 },
      bbox: { west: -120.3, south: 34.4, east: -119.4, north: 35.0 },
    } as never as Parameters<typeof nodesLayer>[0]
    const nodes = Float64Array.from([82.36896718278675 / 2, 66.79200000000016 / 2])
    const layer = nodesLayer(region, nodes)
    const [lon, lat] = (layer.props.data as { position: [number, number] }[])[0].position
    expect(lon).toBeCloseTo(-119.85, 9)
    expect(lat).toBeCloseTo(34.7, 9)
  })

  it('maps the SW corner in SW-corner km to the box SW corner', () => {
    const region = {
      meta: { widthKm: 82.36896718278675, heightKm: 66.79200000000016 },
      bbox: { west: -120.3, south: 34.4, east: -119.4, north: 35.0 },
    } as never as Parameters<typeof nodesLayer>[0]
    const layer = nodesLayer(region, Float64Array.from([0, 0]))
    const [lon, lat] = (layer.props.data as { position: [number, number] }[])[0].position
    expect(lon).toBeCloseTo(-120.3, 6)
    expect(lat).toBeCloseTo(34.4, 6)
  })
})
