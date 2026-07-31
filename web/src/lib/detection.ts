import { arrivalsFor, type ArrivalSet, type FireGridSpec } from './arrivals'

export interface DetectionResult {
  /** Minutes until first seen, or null when the run was never detected. */
  minutes: number | null
  ignitionIndex: number
  /** Which node saw it first, or null when censored. */
  nodeIndex: number | null
  /** Which grid cell was seen, or null when censored. */
  cellIndex: number | null
}

/**
 * Cell centre in kilometres from the region's south-west corner — the same
 * frame `place.LocalFrame` puts the nodes in.
 *
 * Row 0 is the SOUTH edge, matching risk.bin, mask.bin and every other
 * raster in this project. Getting that backwards mirrors every fire
 * vertically, which looks entirely plausible and is completely wrong.
 */
export function cellCentreKm(grid: FireGridSpec, cellIndex: number): [number, number] {
  const col = cellIndex % grid.nx
  const row = Math.floor(cellIndex / grid.nx)
  return [
    ((col + 0.5) / grid.nx) * (grid.widthM / 1000),
    ((row + 0.5) / grid.ny) * (grid.heightM / 1000),
  ]
}

/**
 * The earliest minute at which any node has burning ground within
 * `detectKm`.
 *
 * This is deliberately NOT "when the fire reaches a node". A rod detects
 * fire it can see, at a distance — that is what the hardware is for, and
 * measuring arrival at the node itself would understate every network by
 * roughly the detection radius divided by the rate of spread.
 *
 * A run no node ever sees is CENSORED and returns null. It must never be
 * reported as `tEndMin`: a median taken over a censoring substitute is a
 * function of how long the simulation happened to run.
 */
export function detectionTime(
  set: ArrivalSet, i: number, nodesKm: Float64Array, detectKm: number,
): DetectionResult {
  const { cells, minutes } = arrivalsFor(set, i)
  const nNodes = nodesKm.length / 2
  const r2 = detectKm * detectKm

  let best = Infinity
  let bestCell: number | null = null
  let bestNode: number | null = null

  for (let k = 0; k < cells.length; k++) {
    const t = minutes[k]
    // Records are not sorted by time, so this cannot break early on the
    // first hit — but it can skip anything that could not improve.
    if (t >= best) continue
    const [cx, cy] = cellCentreKm(set.grid, cells[k])
    for (let n = 0; n < nNodes; n++) {
      const dx = nodesKm[2 * n] - cx
      const dy = nodesKm[2 * n + 1] - cy
      if (dx * dx + dy * dy <= r2) {
        best = t
        bestCell = cells[k]
        bestNode = n
        break
      }
    }
  }

  return {
    minutes: bestCell === null ? null : best,
    ignitionIndex: i,
    nodeIndex: bestNode,
    cellIndex: bestCell,
  }
}
