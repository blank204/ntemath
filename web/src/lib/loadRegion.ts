import type { BBox, Field } from './types'

export interface RegionMeta {
  name: string
  box: [number, number, number, number]
  nx: number
  ny: number
  widthKm: number
  heightKm: number
  forestFraction: number
  fwiP90: number
  fwiNorm: number
  firmsCount: number
  firmsPadDeg: number
  classMix: Record<string, number>
  /**
   * Flat pixel index (row-major, row 0 at south) where place.py resolved
   * its blue-noise seed. The placement algorithm must start from this same
   * pixel to reproduce the network the Python baked.
   */
  seedFlatIndex: number
  generated: string
  sourceNotes: Record<string, unknown>
}

export interface RegionData {
  meta: RegionMeta
  risk: Field
  mask: Field
  bbox: BBox
}

async function get(f: typeof fetch, url: string): Promise<Response> {
  const r = await f(url)
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`)
  return r
}

/**
 * Fetch and decode a baked region.
 *
 * Both rasters are row-major with **row 0 at the south edge**, matching
 * place.py's convention. Getting that backwards mirrors every placement
 * vertically, which looks plausible and is completely wrong — hence the
 * explicit size check and this comment. ImageData and most canvas/image
 * code put row 0 at the TOP, so anything that renders this raster later
 * must flip it; this loader does not flip — it hands through exactly what
 * was written.
 */
export async function loadRegion(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegionData> {
  const base = `/data/${name}`
  const meta = (await (await get(fetchImpl, `${base}/meta.json`)).json()) as RegionMeta
  const expected = meta.nx * meta.ny

  // PRECONDITION: little-endian host. bake_region writes risk.bin as explicit
  // `<f4`, but Float32Array decodes in the platform's byte order — correct on
  // every deployable target (x86, ARM, WASM are all LE) and silently wrong on
  // a big-endian one.
  const riskBuf = await (await get(fetchImpl, `${base}/risk.bin`)).arrayBuffer()
  const risk = new Float32Array(riskBuf)
  if (risk.length !== expected) {
    throw new Error(
      `risk.bin has ${risk.length} values, meta says ${meta.nx}x${meta.ny}=${expected}`,
    )
  }

  const maskBuf = await (await get(fetchImpl, `${base}/mask.bin`)).arrayBuffer()
  const maskRaw = new Uint8Array(maskBuf)
  if (maskRaw.length !== expected) {
    throw new Error(
      `mask.bin has ${maskRaw.length} values, meta says ${expected}`,
    )
  }

  const [west, south, east, north] = meta.box
  return {
    meta,
    risk: { nx: meta.nx, ny: meta.ny, data: risk },
    mask: { nx: meta.nx, ny: meta.ny, data: Float32Array.from(maskRaw) },
    bbox: { west, south, east, north },
  }
}
