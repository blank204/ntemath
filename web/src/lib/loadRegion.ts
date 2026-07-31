import type { BBox, ClassField, Field } from './types'
import { burnableMaskOf } from './risk'

export interface RegionMeta {
  name: string
  box: [number, number, number, number]
  nx: number
  ny: number
  widthKm: number
  heightKm: number
  areaKm2: number
  forestFraction: number
  fwiP90: number
  fwiNorm: number
  firmsCount: number
  firmsPadDeg: number
  classMix: Record<string, number>
  /**
   * Flat pixel index (row-major, row 0 at south) where the bake resolved the
   * blue-noise seed at the DEFAULT weights. It is a cross-check only: once the
   * weights are live the argmax moves, so the browser resolves the seed itself
   * (see seed.ts) rather than reading this.
   */
  seedFlatIndex: number
  seedTiesAtMax: number
  riskPeak: number
  /** WorldCover class code -> flammability weight, from forest.FLAMMABILITY. */
  flammability: Record<string, number>
  burnableClasses: number[]
  weightDefaults: { wBase: number; wWeather: number; wActivity: number }
  fwiFullScale: number
  km2PerNode: number
  budgetLo: number
  budgetHi: number
  generated: string
  sourceNotes: Record<string, unknown>
}

export interface RegionData {
  meta: RegionMeta
  classes: ClassField
  /** The baked FIRMS activity field, float32, same orientation as `classes`. */
  activity: Float32Array
  /** Derived from `classes` and `meta.burnableClasses`, never fetched. */
  mask: Field
  bbox: BBox
}

export interface DataManifest {
  baked: string[]
  generated: string
}

async function get(f: typeof fetch, url: string): Promise<Response> {
  const r = await f(url)
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`)
  return r
}

/**
 * Fetched JSON is asserted, not parsed, so a stale meta.json would satisfy the
 * type and be `undefined` at runtime — the hole Plan 1's ledger flagged. Check
 * the fields the model cannot run without, by name, and say which is missing.
 */
function requireMeta(meta: RegionMeta, name: string): void {
  const required: Array<[string, unknown]> = [
    ['nx', meta.nx], ['ny', meta.ny], ['widthKm', meta.widthKm],
    ['heightKm', meta.heightKm], ['areaKm2', meta.areaKm2],
    ['fwiNorm', meta.fwiNorm], ['flammability', meta.flammability],
    ['burnableClasses', meta.burnableClasses],
    ['weightDefaults', meta.weightDefaults], ['km2PerNode', meta.km2PerNode],
    ['budgetLo', meta.budgetLo], ['budgetHi', meta.budgetHi],
  ]
  for (const [key, value] of required) {
    if (value === undefined || value === null) {
      throw new Error(
        `region "${name}" meta.json is missing "${key}" — re-bake it with ` +
        'tools/bake/bake_region.py',
      )
    }
  }
}

export async function loadManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<DataManifest> {
  return (await (await get(fetchImpl, '/data/manifest.json')).json()) as DataManifest
}

/**
 * Fetch and decode a baked region's *components*.
 *
 * risk.bin is deliberately not fetched: the browser recombines the risk field
 * from classes + activity so the weights can move. risk.bin stays committed as
 * the golden that web/tests/risk.test.ts checks the recombination against.
 *
 * PRECONDITION: little-endian host. bake_region writes activity.bin as
 * explicit `<f4`, but Float32Array decodes in the platform's byte order —
 * correct on every deployable target (x86, ARM, WASM are all LE) and silently
 * wrong on a big-endian one.
 *
 * Both rasters are row-major with **row 0 at the south edge**, matching
 * place.py. Getting that backwards mirrors every placement vertically, which
 * looks plausible and is completely wrong. ImageData and most canvas/image
 * code put row 0 at the TOP, so anything that renders these rasters later must
 * flip them; this loader does not flip — it hands through exactly what was
 * written.
 */
export async function loadRegion(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegionData> {
  const base = `/data/${name}`
  const meta = (await (await get(fetchImpl, `${base}/meta.json`)).json()) as RegionMeta
  requireMeta(meta, name)
  const expected = meta.nx * meta.ny

  const classBuf = await (await get(fetchImpl, `${base}/classes.bin`)).arrayBuffer()
  const classData = new Uint8Array(classBuf)
  if (classData.length !== expected) {
    throw new Error(
      `classes.bin has ${classData.length} values, meta says ` +
      `${meta.nx}x${meta.ny}=${expected}`,
    )
  }

  const actBuf = await (await get(fetchImpl, `${base}/activity.bin`)).arrayBuffer()
  const activity = new Float32Array(actBuf)
  if (activity.length !== expected) {
    throw new Error(
      `activity.bin has ${activity.length} values, meta says ${expected}`,
    )
  }

  const classes: ClassField = { nx: meta.nx, ny: meta.ny, data: classData }
  const [west, south, east, north] = meta.box
  return {
    meta,
    classes,
    activity,
    mask: burnableMaskOf(classes, meta.burnableClasses),
    bbox: { west, south, east, north },
  }
}
