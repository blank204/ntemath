import type { BBox, ClassField, Field } from './types'
import { burnableMaskOf } from './risk'

/**
 * What the third term of the risk formula means in a given region.
 *
 * `lightning` is strike density from the NASA LIS/OTD climatology — where
 * ignition is likely. `fire-activity` is FIRMS detections — where fire has
 * recently been. They are opposite claims wearing the same array shape, so
 * no region is allowed to leave it unsaid.
 */
export type RiskLayer = 'lightning' | 'fire-activity'

/**
 * The measurement the bake ran on the raw climatology before it was allowed
 * to influence a single tower position: is the strike field across this box
 * distinguishable from a uniform rate, and does it vary along the axis the
 * region was chosen for? Published so the page can quote a measurement
 * instead of a claim. See tools/bake/lightning.py:gradient_report.
 */
export interface LightningGate {
  /** Native climatology cells observed inside the box. Forty, at 0.5°. */
  cells: number
  nativeDeg: number
  flashes: number
  flashesPerCell: number
  viewtimeSpreadPct: number
  rateMin: number
  rateMax: number
  rateMean: number
  chi2: number
  dof: number
  pUniform: number
  westFlashes: number
  eastFlashes: number
  eastWestRatio: number
  pEastWest: number
  spearmanRho: number
  pSpearman: number
  /** 'gradient' | 'structured' | 'flat' — 'flat' means decorative, say so. */
  verdict: string
}

export interface RegionMeta {
  name: string
  layer: RiskLayer
  /** Filename of that layer's raster, relative to the region directory. */
  layerFile: string
  box: [number, number, number, number]
  nx: number
  ny: number
  widthKm: number
  heightKm: number
  areaKm2: number
  forestFraction: number
  fwiP90: number
  fwiNorm: number
  /** Fire-activity regions only. */
  firmsCount?: number
  firmsPadDeg?: number
  /** Lightning regions only: the measured gradient gate, verbatim. */
  lightningGate?: LightningGate
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
  /**
   * The third risk term's field, float32, same orientation as `classes`,
   * normalised to its own peak inside the box. What it MEANS is
   * `meta.layer`: lightning strike density, or FIRMS fire activity. The
   * property keeps the name of `plan.risk_field`'s `activity` parameter,
   * which is upstream and read-only — anything user-facing must read the
   * meaning off `meta.layer` rather than off this name.
   */
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
    ['layer', meta.layer], ['layerFile', meta.layerFile],
    ['box', meta.box],
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

  // The layer file is named by the region, never assumed: james-bay ships
  // lightning.bin and los-padres ships activity.bin, and loading one while
  // believing it is the other would relabel the entire risk field.
  const actBuf = await (await get(fetchImpl, `${base}/${meta.layerFile}`)).arrayBuffer()
  const activity = new Float32Array(actBuf)
  if (activity.length !== expected) {
    throw new Error(
      `${meta.layerFile} has ${activity.length} values, meta says ${expected}`,
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
