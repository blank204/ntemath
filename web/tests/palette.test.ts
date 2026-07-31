import { describe, it, expect } from 'vitest'
import { PALETTE } from '../src/theme/palette'

const HEX = /^#[0-9A-Fa-f]{6}$/

describe('palette', () => {
  it('exposes every required token as a hex string', () => {
    for (const key of ['canvas', 'surface', 'surfaceRaised', 'ink',
                       'brandOrange', 'meshTeal', 'baselineGray'] as const) {
      expect(PALETTE[key]).toMatch(HEX)
    }
  })

  it('has a five-step heat ramp and a five-step risk ramp', () => {
    expect(PALETTE.heat).toHaveLength(5)
    expect(PALETTE.riskRamp).toHaveLength(5)
    PALETTE.heat.forEach((c) => expect(c).toMatch(HEX))
    PALETTE.riskRamp.forEach((c) => expect(c).toMatch(HEX))
  })

  it('keeps the reserved heat ramp disjoint from every non-fire token', () => {
    const nonFire = [PALETTE.canvas, PALETTE.surface, PALETTE.surfaceRaised,
                     PALETTE.ink, PALETTE.meshTeal, PALETTE.baselineGray,
                     ...PALETTE.riskRamp].map((c) => c.toLowerCase())
    for (const h of PALETTE.heat) {
      expect(nonFire).not.toContain(h.toLowerCase())
    }
  })
})

describe('series slots', () => {
  it('names the two series by the job they do, not by hue', () => {
    expect(PALETTE.series.pyra).toBe(PALETTE.meshTeal)
    expect(PALETTE.series.baseline).toBe(PALETTE.baselineGray)
  })

  it('keeps the reserved heat ramp out of the series slots', () => {
    const heat = PALETTE.heat.map((c) => c.toLowerCase())
    expect(heat).not.toContain(PALETTE.series.pyra.toLowerCase())
    expect(heat).not.toContain(PALETTE.series.baseline.toLowerCase())
    expect(heat).not.toContain(PALETTE.chart.grid.toLowerCase())
    expect(heat).not.toContain(PALETTE.chart.axis.toLowerCase())
  })

  it('keeps the brand orange out of every chart token', () => {
    const chartTokens = [
      PALETTE.series.pyra, PALETTE.series.baseline,
      ...Object.values(PALETTE.chart),
    ].map((c) => c.toLowerCase())
    expect(chartTokens).not.toContain(PALETTE.brandOrange.toLowerCase())
  })

  it('gives chart chrome its own recessive tokens', () => {
    for (const v of Object.values(PALETTE.chart)) expect(v).toMatch(HEX)
    // Grid and axis must not be the ink colour — recessive means recessive.
    expect(PALETTE.chart.grid).not.toBe(PALETTE.ink)
    expect(PALETTE.chart.axis).not.toBe(PALETTE.ink)
  })

  it('keeps the validated pair exactly as docs/palette-validation.md measured it', () => {
    // The waiver recorded in that file is specific to these two hex values:
    // deutan dE 15.9, normal-vision 20.0. Re-stepping either one silently
    // would leave the site carrying a waiver for a pair it no longer ships.
    expect(PALETTE.series.pyra).toBe('#4DE1C1')
    expect(PALETTE.series.baseline).toBe('#8A9691')
  })
})
