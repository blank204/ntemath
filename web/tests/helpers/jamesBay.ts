import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { RegionData, RegionMeta } from '../../src/lib/loadRegion'
import { burnableMaskOf } from '../../src/lib/risk'

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'public', 'data', 'james-bay',
)

function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

/**
 * The shipped region, assembled from its committed components — classes and
 * the LIGHTNING layer, not the fire-activity one Los Padres carries. The
 * loader picks the file off `meta.layerFile`; this helper reads the same
 * field rather than hardcoding a name, so a region rebaked onto the other
 * layer cannot silently keep loading the old file.
 */
export function loadJamesBay(): RegionData {
  const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8')) as RegionMeta
  const cb = bytes('classes.bin')
  const lb = bytes(meta.layerFile)
  const classes = { nx: meta.nx, ny: meta.ny, data: cb }
  const [west, south, east, north] = meta.box
  return {
    meta,
    classes,
    activity: new Float32Array(lb.buffer, lb.byteOffset, lb.byteLength / 4),
    mask: burnableMaskOf(classes, meta.burnableClasses),
    bbox: { west, south, east, north },
  }
}
