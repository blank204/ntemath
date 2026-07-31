import { describe, it, expect } from 'vitest'
import { railProgress } from '../src/rail/railProgress'

/** Seven sections, one viewport tall each, laid out from y = 0. */
const sections = (n: number, h = 800) =>
  Array.from({ length: n }, (_, i) => ({ top: i * h, height: h }))

describe('railProgress', () => {
  it('opens on the first beat, half way through it', () => {
    // Each beat's text is centred in its own section, so at rest the reader
    // is looking at the middle of beat one — not its top edge.
    const r = railProgress(sections(7), 0, 800)
    expect(r.index).toBe(0)
    expect(r.t).toBeCloseTo(0.5, 6)
  })

  it('advances when the beat under the middle of the screen changes', () => {
    // THE BUG THIS PINS: anchoring on the top edge instead left the stage a
    // full beat behind — beat two's words centred on screen under beat one's
    // picture, seen in a browser.
    expect(railProgress(sections(7), 400, 800).index).toBe(1)
    expect(railProgress(sections(7), 2400, 800).index).toBe(3)
  })

  it('reports progress within the active beat, not just which one', () => {
    // The stage animates on this: a marker that walks a distribution needs to
    // know how far into its own beat it is, not how far down the page.
    const r = railProgress(sections(7), 800, 800)
    expect(r.index).toBe(1)
    expect(r.t).toBeCloseTo(0.5, 6)
    expect(railProgress(sections(7), 400, 800).t).toBeCloseTo(0, 6)
    expect(railProgress(sections(7), 1199, 800).t).toBeCloseTo(0.99875, 5)
  })

  it('holds the last beat at the bottom of the page', () => {
    const r = railProgress(sections(7), 999_999, 800)
    expect(r.index).toBe(6)
    expect(r.t).toBe(1)
  })

  it('never returns an index outside the sections it was given', () => {
    for (const y of [-500, 0, 137, 5600, 1e9]) {
      const r = railProgress(sections(7), y, 800)
      expect(r.index).toBeGreaterThanOrEqual(0)
      expect(r.index).toBeLessThan(7)
      expect(r.t).toBeGreaterThanOrEqual(0)
      expect(r.t).toBeLessThanOrEqual(1)
    }
  })

  it('degrades to nothing active when there are no sections', () => {
    // Before the first layout pass the refs are empty, and a hook that
    // returned index 0 there would flash beat one's visual over beat four's
    // text on a reload part-way down the page.
    expect(railProgress([], 0, 800)).toEqual({ index: -1, t: 0 })
  })

  it('handles sections of unequal height', () => {
    const uneven = [
      { top: 0, height: 400 },
      { top: 400, height: 1600 },
      { top: 2000, height: 400 },
    ]
    expect(railProgress(uneven, 0, 400).index).toBe(0)
    expect(railProgress(uneven, 800, 800).index).toBe(1)
    expect(railProgress(uneven, 800, 800).t).toBeCloseTo(0.5, 6)
    expect(railProgress(uneven, 1800, 800).index).toBe(2)
  })
})
