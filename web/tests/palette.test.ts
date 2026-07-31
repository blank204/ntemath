import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PALETTE } from '../src/theme/palette'

const HEX = /^#[0-9A-Fa-f]{6}$/
const ROOT = join(__dirname, '..')

describe('palette', () => {
  it('exposes every required token as a hex string', () => {
    for (const key of ['canvas', 'fieldLit', 'surface', 'surfaceRaised', 'ink',
                       'inkMuted', 'ember', 'signal', 'control'] as const) {
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
    const nonFire = [PALETTE.canvas, PALETTE.fieldLit, PALETTE.surface,
                     PALETTE.surfaceRaised, PALETTE.ink, PALETTE.inkMuted,
                     PALETTE.signal, PALETTE.control,
                     ...PALETTE.riskRamp].map((c) => c.toLowerCase())
    for (const h of PALETTE.heat) {
      expect(nonFire).not.toContain(h.toLowerCase())
    }
  })

  it('lets no hex outside this module survive a palette change', () => {
    // "Never a hex colour outside palette.ts" is the rule, and src obeys it —
    // but index.html and the favicon are not src, so nothing was checking
    // them. Both sat at the retired #060706 through this rebuild. The
    // index.html one was an opaque, full-height #root: it covered the lit
    // field with the old world's black, and the page still looked like the
    // void that got the first visual pass rejected while every test passed.
    const known = new Set([
      PALETTE.canvas, PALETTE.fieldLit, PALETTE.surface, PALETTE.surfaceRaised,
      PALETTE.ink, PALETTE.inkMuted, PALETTE.ember, PALETTE.signal,
      PALETTE.control, ...PALETTE.heat, ...PALETTE.riskRamp,
      ...Object.values(PALETTE.chart),
    ].map((c) => c.toLowerCase()))

    for (const file of ['index.html', join('public', 'favicon.svg')]) {
      const text = readFileSync(join(ROOT, file), 'utf-8')
      for (const hex of text.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
        expect(known.has(hex.toLowerCase()), `${file} paints ${hex}`).toBe(true)
      }
    }
  })

  it('paints the pre-bundle background in the current canvas colour', () => {
    // The inline style in index.html exists to stop a white flash before the
    // CSS arrives. If it drifts from PALETTE.canvas the page flashes the
    // previous palette instead, which is worse than flashing white.
    const html = readFileSync(join(ROOT, 'index.html'), 'utf-8')
    expect(html).toContain(PALETTE.canvas)
  })

  it('keeps the field lit rather than a void', () => {
    // The first visual pass was a near-black surface with bright line work on
    // it, and it read as neon. The field is an indigo that is lighter where
    // the storm is lit from inside — so `fieldLit` has to actually be lighter
    // than `canvas`, not merely a second dark value.
    const lum = (h: string) =>
      [1, 3, 5].reduce((s, i) => s + parseInt(h.slice(i, i + 2), 16), 0)
    expect(lum(PALETTE.fieldLit)).toBeGreaterThan(lum(PALETTE.canvas))
  })
})

describe('series slots', () => {
  it('names the two series by the job they do, not by hue', () => {
    expect(PALETTE.series.pyra).toBe(PALETTE.signal)
    expect(PALETTE.series.baseline).toBe(PALETTE.control)
  })

  it('keeps the reserved heat ramp out of the series slots', () => {
    const heat = PALETTE.heat.map((c) => c.toLowerCase())
    expect(heat).not.toContain(PALETTE.series.pyra.toLowerCase())
    expect(heat).not.toContain(PALETTE.series.baseline.toLowerCase())
    expect(heat).not.toContain(PALETTE.chart.grid.toLowerCase())
    expect(heat).not.toContain(PALETTE.chart.axis.toLowerCase())
  })

  it('keeps the ember out of every chart token', () => {
    const chartTokens = [
      PALETTE.series.pyra, PALETTE.series.baseline,
      ...Object.values(PALETTE.chart),
    ].map((c) => c.toLowerCase())
    expect(chartTokens).not.toContain(PALETTE.ember.toLowerCase())
  })

  it('gives chart chrome its own recessive tokens', () => {
    for (const v of Object.values(PALETTE.chart)) expect(v).toMatch(HEX)
    // Grid and axis must not be the ink colour — recessive means recessive.
    expect(PALETTE.chart.grid).not.toBe(PALETTE.ink)
    expect(PALETTE.chart.axis).not.toBe(PALETTE.ink)
  })

  it('keeps the pair exactly as docs/palette-validation.md measured it', () => {
    // Unlike the pair this replaced, these two carry NO waiver: they clear the
    // dark lightness band, the chroma floor, CVD separation, the normal-vision
    // floor and contrast, all five, on surface #111C3E. Re-stepping either one
    // silently would leave the site claiming a clean run it no longer has.
    //
    //   npm run validate:palette          → ALL CHECKS PASS
    expect(PALETTE.series.pyra).toBe('#2696E4')
    expect(PALETTE.series.baseline).toBe('#AB437B')
    expect(PALETTE.chart.surface).toBe('#111C3E')
  })
})
