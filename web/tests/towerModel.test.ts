import { describe, it, expect } from 'vitest'
import {
  TOWER_PARTS, MAST_HEIGHT_M, explodedY, latticeRungs, partAt,
} from '../src/rail/tower/towerModel'
import { BEATS } from '../src/rail/beats'

describe('TOWER_PARTS', () => {
  it('is the instrument the tower beat describes, part for part', () => {
    // The copy names five subsystems. A model that showed four, or showed a
    // sixth nobody wrote about, would be a different product from the one the
    // page is describing.
    expect(TOWER_PARTS.map((p) => p.id)).toEqual([
      'camera', 'mics', 'compute', 'solar', 'backhaul',
    ])
    // Body AND figureNote: when the beat came down to 25 words the body kept
    // the three subsystems that do the measuring and the figureNote took the
    // full parts list. Between them the page still names all five, which is
    // what this test is actually for — the model must not show a part the
    // reader was never told about.
    const beat = BEATS.find((b) => b.id === 'tower')!
    const copy = `${beat.body} ${beat.figureNote}`.toLowerCase()
    for (const p of TOWER_PARTS) {
      expect(copy, `part ${p.id}`).toContain(p.keyword)
    }
  })

  it('stacks the parts down the mast without overlapping them', () => {
    const sorted = [...TOWER_PARTS].sort((a, b) => b.y - a.y)
    expect(sorted.map((p) => p.id)).toEqual(TOWER_PARTS.map((p) => p.id))
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i - 1].y - sorted[i - 1].height / 2)
        - (sorted[i].y + sorted[i].height / 2)
      expect(gap, `between ${sorted[i - 1].id} and ${sorted[i].id}`)
        .toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps every part on the mast', () => {
    for (const p of TOWER_PARTS) {
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0)
      expect(p.y + p.height / 2).toBeLessThanOrEqual(MAST_HEIGHT_M)
    }
  })

  it('puts the camera at the top and the compute low, where a technician reaches it', () => {
    expect(partAt('camera').y).toBeGreaterThan(partAt('mics').y)
    expect(partAt('compute').y).toBeLessThan(partAt('mics').y)
    expect(partAt('backhaul').y).toBeLessThan(partAt('compute').y)
  })
})

describe('explodedY', () => {
  it('leaves the tower assembled at rest', () => {
    for (const p of TOWER_PARTS) expect(explodedY(p, 0)).toBeCloseTo(p.y, 9)
  })

  it('separates every part from its neighbours as it opens', () => {
    const ys = TOWER_PARTS.map((p) => explodedY(p, 1)).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThan(2)
    }
  })

  it('moves the top parts up and the bottom parts down, around the middle', () => {
    // An explode that pushed everything one way would walk the whole tower
    // off the top of the frame instead of opening it.
    expect(explodedY(partAt('camera'), 1)).toBeGreaterThan(partAt('camera').y)
    expect(explodedY(partAt('backhaul'), 1)).toBeLessThan(partAt('backhaul').y)
  })

  it('is monotone in t, so scrubbing back and forth never jumps', () => {
    for (const p of TOWER_PARTS) {
      let prev = explodedY(p, 0)
      for (let t = 0.1; t <= 1.0001; t += 0.1) {
        const now = explodedY(p, t)
        if (p.y > partAt('compute').y) expect(now).toBeGreaterThanOrEqual(prev - 1e-9)
        else expect(now).toBeLessThanOrEqual(prev + 1e-9)
        prev = now
      }
    }
  })
})

describe('latticeRungs', () => {
  it('spans the mast from the ground up', () => {
    const rungs = latticeRungs()
    expect(rungs.length).toBeGreaterThan(6)
    expect(Math.min(...rungs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...rungs)).toBeLessThanOrEqual(MAST_HEIGHT_M)
  })

  it('spaces them evenly, because a lattice that wanders reads as a mistake', () => {
    const rungs = latticeRungs()
    const gaps = rungs.slice(1).map((r, i) => r - rungs[i])
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6)
  })
})
