export interface FireGridSpec {
  nx: number
  ny: number
  cellM: number
  widthM: number
  heightM: number
  boxLonLat: [number, number, number, number]
}

export interface Ignition {
  lon: number
  lat: number
  xM: number
  yM: number
  /** How far pick_seed_cell moved this ignition, in metres. */
  shiftM: number
  burntCells: number
  offset: number
  count: number
}

export interface ArrivalSet {
  grid: FireGridSpec
  /** The spread rule the bake used. Every displayed number must name it. */
  rule: string
  tEndMin: number
  ignitions: Ignition[]
  /** Grid cell index per record, all ignitions concatenated. */
  cells: Uint32Array
  /** Arrival time in minutes per record, parallel to `cells`. */
  minutes: Uint32Array
  meta: Record<string, unknown>
}

/**
 * Split the interleaved `(cellIndex, minutes)` blob into two parallel
 * arrays.
 *
 * Only burnt cells are stored, and absence is the encoding for never-burnt
 * — there is no sentinel, so nothing here can mistake a large number for
 * "unburned".
 */
export function decodeArrivals(meta: unknown, buf: ArrayBuffer): ArrivalSet {
  const m = meta as {
    grid: FireGridSpec; rule: string; tEndMin: number; ignitions: Ignition[]
  }
  const expected = m.ignitions.reduce((n, ig) => n + ig.count, 0)
  const records = buf.byteLength / 8
  if (records !== expected) {
    throw new Error(
      `arrivals.bin holds ${records} records, the index claims ${expected}`,
    )
  }
  const u32 = new Uint32Array(buf)
  const cells = new Uint32Array(expected)
  const minutes = new Uint32Array(expected)
  for (let i = 0; i < expected; i++) {
    cells[i] = u32[2 * i]
    minutes[i] = u32[2 * i + 1]
  }
  return {
    grid: m.grid, rule: m.rule, tEndMin: m.tEndMin, ignitions: m.ignitions,
    cells, minutes, meta: meta as Record<string, unknown>,
  }
}

/** The records for one ignition. Views, not copies. */
export function arrivalsFor(set: ArrivalSet, i: number) {
  const ig = set.ignitions[i]
  if (!ig) throw new Error(`no ignition ${i}; the set holds ${set.ignitions.length}`)
  return {
    cells: set.cells.subarray(ig.offset, ig.offset + ig.count),
    minutes: set.minutes.subarray(ig.offset, ig.offset + ig.count),
  }
}
