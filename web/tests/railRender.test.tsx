import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BeatStage, TowerSchematic } from '../src/rail/BeatStage'
import { Rail } from '../src/rail/Rail'
import { BEATS, LAB_ANCHOR } from '../src/rail/beats'
import { PALETTE } from '../src/theme/palette'

const stage = (beatId: string, t: number, reducedMotion = false) =>
  renderToStaticMarkup(
    <BeatStage beatId={beatId} t={t} reducedMotion={reducedMotion} />)

describe('BeatStage', () => {
  it('renders an inset for exactly the beats that declare one', () => {
    // Three beats earn a diagram; the rest get nothing rather than filler.
    // A beat that quietly grew one back would be the "way too simple"
    // illustration-of-a-noun problem returning, and a beat that quietly lost
    // one would drop a measured shape off the page.
    const withInset = BEATS.filter((b) => b.inset).map((b) => b.id)
    expect(withInset).toEqual(['clock', 'bang', 'two'])
    for (const b of BEATS) {
      const html = stage(b.id, 0.5)
      if (b.inset) expect(html.length, `beat ${b.id}`).toBeGreaterThan(100)
      else expect(html, `beat ${b.id}`).toBe('')
    }
  })

  it('describes every inset it does render to a screen reader', () => {
    for (const b of BEATS) {
      if (!b.inset || b.id === 'bang') continue   // bang carries its own
      expect(stage(b.id, 0.5), `beat ${b.id}`).toContain('aria-label=')
    }
  })

  it('still offers the tower to a machine with no WebGL', () => {
    // The pinned hero is a WebGL canvas. On a locked-down machine or a
    // blocklisted GPU it falls back to the schematic, and that fallback has
    // to keep naming all five subsystems — otherwise the reader who cannot
    // run the 3D version silently gets a different product.
    const flat = renderToStaticMarkup(<TowerSchematic t={0.6} />)
    for (const word of ['camera head', 'microphone array', 'compute',
                        'solar', 'backhaul']) {
      expect(flat).toContain(word)
    }
    expect(flat).toContain('aria-label=')
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
      PALETTE.ember, PALETTE.signal, PALETTE.control,
      PALETTE.fieldLit, PALETTE.inkMuted,
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
  /**
   * The markup, with entities turned back into the characters the copy
   * actually contains. `>40 ms` ships as `&gt;40 ms` and `Canada's` as
   * `Canada&#x27;s`, so asserting on the raw string quietly checks the
   * escaping rather than the copy.
   */
  const text = html
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')

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

  it('stacks rather than splits when there is no room for two columns', () => {
    // This is the server-rendered branch: `useIsSplit` starts false wherever
    // there is no window, which is also the narrow case. It is asserted here
    // because the browser check for it could not be run — see the note in
    // docs/HANDOFF.md. It proves the narrow branch renders every beat and
    // drops the split-only chrome; it does NOT prove the layout looks right
    // at 390px, and nothing here should be read as claiming that.
    expect(html).not.toContain('aria-label="Beats"')   // beat list is split-only
    for (const b of BEATS) {
      expect(text, `beat ${b.id}`).toContain(b.figure)
      expect(text, `beat ${b.id}`).toContain(b.eyebrow)
    }
  })

  it('keeps every figure paired with what it measures', () => {
    // The figure and its unit are one thing. If a layout change ever renders
    // the figure without its note, the page is showing a bare number at
    // 148px, which is the one failure mode this rebuild could introduce.
    for (const b of BEATS) {
      expect(text, `beat ${b.id}`).toContain(b.figureNote)
    }
  })

  it('keeps the sources on the page after cutting the bodies', () => {
    // The bodies came down to 25 words and the research moved to end matter.
    // If that section ever stops rendering, the site is making claims it no
    // longer shows the working for.
    for (const b of BEATS) {
      if (b.source) expect(text, `beat ${b.id}`).toContain(b.source.slice(0, 40))
    }
  })

  it('shows the first beat before any scroll has happened', () => {
    // Server-rendered, refs empty, scrollY unknown: the Rail must open on
    // beat one rather than on whatever index -1 would index into.
    expect(html).toContain(BEATS[0].headline.slice(0, 24))
  })
})
