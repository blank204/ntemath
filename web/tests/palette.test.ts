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
