import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { RegionData, RegionMeta } from '../../src/lib/loadRegion'
import type { PlaceParams } from '../../src/lib/pipeline'
import { burnableMaskOf } from '../../src/lib/risk'
import { DEFAULT_PARAMS } from '../../src/state/useModelStore'

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
 * The detection radius every committed Los Padres figure was measured at.
 *
 * It is NOT the shipped default any more. That was 2 km — a smoke sensor on
 * a post — and the lightning pivot moved the shipped default to a tower's
 * 15 km confirmation range. The Python parity references in pipeline.test.ts
 * and the benchmark curve in benchmark.test.ts were measured at 2 km, so
 * that is what they must keep running at; re-pointing them at the new
 * default would not "update" those numbers, it would silently replace one
 * measurement with a different one and call it the same claim.
 */
export const LOS_PADRES_DETECT_KM = 2

/**
 * The Lab's shipped defaults, with only that radius pinned back.
 *
 * Everything else is spread from the real DEFAULT_PARAMS rather than
 * restated, so changing any OTHER shipped default — a weight, the coverage
 * target, the demand stride — still moves these numbers and still fails
 * loudly. `losPadresParamsDivergeOnlyInRadius` in benchmark.test.ts is what
 * keeps that promise honest.
 */
export const DEFAULT_TEST_PARAMS: PlaceParams = {
  ...DEFAULT_PARAMS, detectKm: LOS_PADRES_DETECT_KM,
}
