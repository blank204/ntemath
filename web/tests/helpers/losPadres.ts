import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { RegionData, RegionMeta } from '../../src/lib/loadRegion'
import { burnableMaskOf } from '../../src/lib/risk'

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
 * The Lab's shipped defaults — re-exported, not restated. A second copy would
 * let someone change the shipped `detectKm` while the benchmark tests kept
 * passing at 2.0, and the site would ship a curve nobody measured.
 */
export { DEFAULT_PARAMS as DEFAULT_TEST_PARAMS } from '../../src/state/useModelStore'
