import { describe, it, expect } from 'vitest'
import { cellCentreKm, detectionTime } from '../src/lib/detection'
import type { ArrivalSet, FireGridSpec } from '../src/lib/arrivals'

const grid: FireGridSpec = {
  nx: 4, ny: 3, cellM: 1000,
  widthM: 4000, heightM: 3000,
  boxLonLat: [0, 0, 1, 1],
}

/** A 4x3 grid. Ignition 0 burns cells 0,1,2 at 0,10,20 min. */
function toy(): ArrivalSet {
  return {
    grid,
    rule: 'ros',
    tEndMin: 120,
    ignitions: [
      { lon: 0, lat: 0, xM: 500, yM: 500, shiftM: 0, burntCells: 3, offset: 0, count: 3 },
      { lon: 0, lat: 0, xM: 500, yM: 500, shiftM: 0, burntCells: 1, offset: 3, count: 1 },
    ],
    cells: Uint32Array.from([0, 1, 2, 11]),
    minutes: Uint32Array.from([0, 10, 20, 5]),
    meta: {},
  }
}

describe('cellCentreKm', () => {
  it('puts cell 0 at the south-west corner, half a cell in', () => {
    expect(cellCentreKm(grid, 0)).toEqual([0.5, 0.5])
  })

  it('advances along the row before wrapping to the next row north', () => {
    // Row 0 is the SOUTH edge, matching every other raster in this project.
    expect(cellCentreKm(grid, 1)).toEqual([1.5, 0.5])
    expect(cellCentreKm(grid, 4)).toEqual([0.5, 1.5])
    expect(cellCentreKm(grid, 11)).toEqual([3.5, 2.5])
  })
})

describe('detectionTime', () => {
  const set = toy()

  it('returns the earliest burnt cell within range of any node', () => {
    // A node at (1.6, 0.5) is 0.1 km from cell 1 (10 min) and 1.1 km from
    // cell 0 (0 min). At a 0.5 km radius only cell 1 is visible.
    const r = detectionTime(set, 0, Float64Array.from([1.6, 0.5]), 0.5)
    expect(r.minutes).toBe(10)
    expect(r.cellIndex).toBe(1)
    expect(r.nodeIndex).toBe(0)
  })

  it('sees the earlier cell once the radius reaches it', () => {
    const r = detectionTime(set, 0, Float64Array.from([1.6, 0.5]), 1.5)
    expect(r.minutes).toBe(0)
    expect(r.cellIndex).toBe(0)
  })

  it('censors a run no node ever sees, rather than returning a big number', () => {
    // Nothing burns near (3.5, 2.5) in ignition 0.
    const r = detectionTime(set, 0, Float64Array.from([3.5, 2.5]), 0.4)
    expect(r.minutes).toBeNull()
    expect(r.cellIndex).toBeNull()
    expect(r.nodeIndex).toBeNull()
  })

  it('reports which node saw it when several are in range', () => {
    const nodes = Float64Array.from([3.5, 2.5, 1.6, 0.5])
    const r = detectionTime(set, 0, nodes, 1.5)
    expect(r.nodeIndex).toBe(1)
  })

  it('reads only its own ignition', () => {
    // Cell 11 burns at 5 min, but only in ignition 1. A detector that
    // ignored `offset` would find it in ignition 0 and report 5.
    const r0 = detectionTime(set, 0, Float64Array.from([3.5, 2.5]), 1.0)
    expect(r0.minutes).toBeNull()
    const r1 = detectionTime(set, 1, Float64Array.from([3.5, 2.5]), 1.0)
    expect(r1.minutes).toBe(5)
  })

  it('censors when there are no nodes at all', () => {
    expect(detectionTime(set, 0, new Float64Array(0), 5).minutes).toBeNull()
  })
})
