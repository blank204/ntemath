import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BeatStage } from '../src/rail/BeatStage'
import { Rail } from '../src/rail/Rail'
import { BEATS, LAB_ANCHOR } from '../src/rail/beats'
import { PALETTE } from '../src/theme/palette'

const stage = (beatId: string, t: number, reducedMotion = false) =>
  renderToStaticMarkup(
    <BeatStage beatId={beatId} t={t} reducedMotion={reducedMotion} />)

describe('BeatStage', () => {
  it('renders every beat the Rail can ask for', () => {
    // A beat whose stage falls through to the default would show the closing
    // scatter under, say, the holdover distribution's text.
    for (const b of BEATS) {
      const html = stage(b.id, 0.5)
      expect(html.length, `beat ${b.id}`).toBeGreaterThan(100)
    }
  })

  it('describes each stage to a screen reader', () => {
    for (const b of BEATS) {
      if (b.id === 'bang') continue           // its own component carries this
      expect(stage(b.id, 0.5)).toContain('aria-label=')
    }
  })

  it('lights the opening flash on load and dims it as the reader leaves', () => {
    // A beat that opens the page sits at t = 0.5, not 0 — half of it is
    // above the fold — so the cold open has to still be lit there.
    expect(stage('flash', 0)).toContain(PALETTE.heat[4])
    expect(stage('flash', 0.5)).toContain(PALETTE.heat[4])
    expect(stage('flash', 0.9)).not.toContain(PALETTE.heat[4])
  })

  it('never flashes at full brightness when reduced motion is requested', () => {
    expect(stage('flash', 0, true)).not.toContain(PALETTE.heat[4])
  })

  it('moves the holdover marker with the reader', () => {
    const x = (html: string) => {
      const m = html.match(/<line x1="([\d.]+)"[^>]*stroke-dasharray/)
      return m ? Number(m[1]) : -1
    }
    expect(x(stage('clock', 0.9))).toBeGreaterThan(x(stage('clock', 0.1)))
  })

  it('paints nothing outside the palette', () => {
    const html = BEATS.map((b) => stage(b.id, 0.3) + stage(b.id, 0.9)).join('')
    const known = new Set<string>([
      PALETTE.canvas, PALETTE.surface, PALETTE.surfaceRaised, PALETTE.ink,
      PALETTE.brandOrange, PALETTE.meshTeal, PALETTE.baselineGray,
      ...PALETTE.heat, ...PALETTE.riskRamp,
      PALETTE.chart.surface, PALETTE.chart.grid, PALETTE.chart.axis,
      PALETTE.chart.inkMuted,
    ].map((c) => c.toLowerCase()))
    for (const hex of html.match(/#[0-9a-fA-F]{3,8}/g) ?? []) {
      expect(known.has(hex.toLowerCase()), hex).toBe(true)
    }
  })
})

describe('Rail', () => {
  const html = renderToStaticMarkup(<Rail />)

  it('renders all seven headlines, in order', () => {
    let at = -1
    for (const b of BEATS) {
      const i = html.indexOf(b.headline.slice(0, 24))
      expect(i, `beat ${b.id}`).toBeGreaterThan(at)
      at = i
    }
  })

  it('offers the skip-to-Lab link before the beats', () => {
    // A judge with four minutes should not have to scroll seven beats to
    // reach the thing being judged.
    const skip = html.indexOf(`href="#${LAB_ANCHOR}"`)
    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(html.indexOf(BEATS[0].headline.slice(0, 24)))
  })

  it('uses real headings, so the page has an outline', () => {
    expect((html.match(/<h2/g) ?? []).length).toBe(BEATS.length)
  })

  it('shows the first beat before any scroll has happened', () => {
    // Server-rendered, refs empty, scrollY unknown: the Rail must open on
    // beat one rather than on whatever index -1 would index into.
    expect(html).toContain(BEATS[0].headline.slice(0, 24))
  })
})
