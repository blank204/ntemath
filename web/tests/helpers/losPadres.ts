import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { RegionData, RegionMeta } from '../../src/lib/loadRegion'
import type { PlaceParams } from '../../src/lib/pipeline'
import { burnableMaskOf, DEFAULT_WEIGHTS } from '../../src/lib/risk'

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'public', 'data', 'los-padres',
)

/**
 * Node's readFileSync returns a Buffer that may be a view into a pooled
 * allocation, so `buf.buffer` alone would read the wrong bytes. Slice by the
 * view's own offset and length.
 */
function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

/**
 * The real region, assembled from the committed COMPONENTS — there is no
 * pre-combined risk raster to load any more, because the browser recombines.
 */
export function loadLosPadres(): RegionData {
  const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8')) as RegionMeta
  const cb = bytes('classes.bin')
  const ab = bytes('activity.bin')
  const classes = { nx: meta.nx, ny: meta.ny, data: cb }
  const [west, south, east, north] = meta.box
  return {
    meta,
    classes,
    activity: new Float32Array(ab.buffer, ab.byteOffset, ab.byteLength / 4),
    mask: burnableMaskOf(classes, meta.burnableClasses),
    bbox: { west, south, east, north },
  }
}

/**
 * The Lab's shipped defaults, as the tests need them. The weights are spread
 * from risk.ts's DEFAULT_WEIGHTS — plan.risk_field's own literals, never
 * restated — and the budget mode is saturation, so spacing is derived.
 */
export const DEFAULT_TEST_PARAMS: PlaceParams = {
  seed: 7,
  detectKm: 2.0,
  target: 0.95,
  demandStride: 4,
  budgetMode: 'saturation',
  fixedNodes: 100,
  spacingOverride: null,
  ...DEFAULT_WEIGHTS,
}
