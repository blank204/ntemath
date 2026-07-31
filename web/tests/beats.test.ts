import { describe, it, expect } from 'vitest'
import { BEATS, BODY_WORD_CEILING, LAB_ANCHOR, type Beat }
  from '../src/rail/beats'

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

describe('BEATS', () => {
  it('is the seven beats the spec names, in its order', () => {
    expect(BEATS.map((b) => b.id)).toEqual([
      'flash', 'clock', 'gap', 'tower', 'bang', 'two', 'question',
    ])
  })

  it('announces every beat with a quantity, not with a number in a circle', () => {
    // The figure is the page's structural device, and a device that encodes
    // nothing is decoration. Every one of them has to carry a figure the beat
    // is actually about, and it has to be short enough to survive at 148px.
    for (const b of BEATS) {
      expect(b.figure, `beat ${b.id}`).toMatch(/\d/)
      expect(b.figure.length, `beat ${b.id}`).toBeLessThanOrEqual(10)
    }
  })

  it('never shows a bare figure without saying what it measures', () => {
    // A number at 148px with no unit is the most confident way this page
    // could lie. `81–93%` of what, `>40 ms` of what, `111` of what.
    for (const b of BEATS) {
      expect(words(b.figureNote).length, `beat ${b.id}`).toBeGreaterThan(3)
    }
  })

  it('gives every beat an eyebrow, a headline and a body', () => {
    for (const b of BEATS) {
      expect(b.eyebrow.length).toBeGreaterThan(2)
      expect(b.headline.length).toBeGreaterThan(8)
      expect(b.body.length).toBeGreaterThan(40)
    }
  })

  it('keeps every body under the word ceiling', () => {
    // THIS IS THE REBUILD, AS A TEST. The bodies ran 60–90 words and the page
    // read as documentation nobody wanted to look at — the actual words of
    // the rejection were "too much text, and I don't WANT to look at it".
    // The research did not get cut, it moved to `source` and end matter. A
    // body that creeps back over this ceiling is the old page growing back.
    for (const b of BEATS) {
      expect(words(b.body).length, `beat ${b.id}`)
        .toBeLessThanOrEqual(BODY_WORD_CEILING)
    }
  })

  it('keeps the whole rail under a screenful of prose', () => {
    // Per-beat ceilings can all pass while the total still creeps. The
    // reference sites carry about 20 words per screen; seven beats at the
    // ceiling is the most this page may ever put in front of a reader.
    const total = BEATS.reduce((n, b) => n + words(b.body).length, 0)
    expect(total).toBeLessThanOrEqual(BODY_WORD_CEILING * BEATS.length)
  })

  it('ends by handing the reader to the Lab', () => {
    const last = BEATS[BEATS.length - 1]
    expect(last.id).toBe('question')
    expect(last.cta).toBeTruthy()
    expect(last.cta!.href).toBe(`#${LAB_ANCHOR}`)
  })

  it('sources every number it states, including the giant one', () => {
    // A figure with no source on a scroll page is a figure a judge cannot
    // check, and this project's whole posture is that they can. The figure
    // is the largest number on the page and so the one most worth checking.
    for (const b of BEATS) {
      if (/\d/.test(b.body) || /\d/.test(b.figure)) {
        expect(b.source, `beat ${b.id}`).toBeTruthy()
      }
    }
  })

  it('keeps every measured figure traceable to its own source note', () => {
    // Moving the sourcing to end matter only works if each note stands on its
    // own: a reader who jumps straight to the sources has to be able to match
    // a note back to the figure it supports without scrolling back up.
    //
    // `tower` is deliberately absent. Its figure is 30 m of mast, which is a
    // design parameter of our own instrument rather than a measurement of the
    // world — there is nothing external to cite, and inventing a citation for
    // it would be worse than having none.
    const MEASURED: Record<string, string> = {
      flash: '81–93%',
      clock: '40 milliseconds',
      gap: '<1 km',
      bang: '340.4 m/s',
      two: '54.6%',
      question: '111',
    }
    for (const [id, needle] of Object.entries(MEASURED)) {
      const b = BEATS.find((x) => x.id === id)!
      expect(b.source, `beat ${id} has a source`).toBeTruthy()
      expect(b.source!, `beat ${id} source states ${needle}`).toContain(needle)
    }
  })
})

/** Everything the Rail puts in front of a reader. */
const railCopy = (): string =>
  BEATS.map((b: Beat) =>
    [b.figure, b.figureNote, b.eyebrow, b.headline, b.body, b.source ?? '',
     b.cta?.label ?? ''].join(' '),
  ).join(' ').toLowerCase()

describe('the Rail obeys the same science constraints as the Lab', () => {
  it('quotes no current magnitude for continuing current', () => {
    expect(railCopy()).not.toMatch(/\d+\s*(–|-|to )?\s*\d*\s*(amp|ampere|ka)\b/)
  })

  it('never uses polarity as a proxy', () => {
    const all = railCopy()
    expect(all).not.toContain('positive stroke')
    expect(all).not.toContain('polarity')
  })

  it('never makes cloud-to-ground versus cloud-to-cloud the discriminator', () => {
    expect(railCopy()).not.toContain('cloud-to-cloud')
  })

  it('promises no fixed lead time before smoke', () => {
    expect(railCopy()).not.toMatch(/hours? (before|ahead of) (the )?smoke/)
  })

  it('claims no novelty for the ignition science', () => {
    const all = railCopy()
    for (const banned of ['first ever', 'world-first', 'unprecedented',
                          'never been done', 'the first system']) {
      expect(all).not.toContain(banned)
    }
  })

  it('never claims to beat an electromagnetic lightning network', () => {
    expect(railCopy())
      .not.toMatch(/(better|more accurate|beats).{0,30}(nldn|gld360|lightning network)/)
  })

  it('never mentions Blitzortung', () => {
    expect(railCopy()).not.toContain('blitzortung')
  })

  it('does not attribute the holdover dataset to Canada', () => {
    // 152,375 fires across 13 countries. The demo region is Canadian and the
    // slip would be one word wide.
    const clock = BEATS.find((b) => b.id === 'clock')!
    const text = `${clock.body} ${clock.source ?? ''}`.toLowerCase()
    if (text.includes('152,375')) expect(text).toContain('countries')
  })

  it('says what the acoustic layer is not, where it introduces it', () => {
    const bang = BEATS.find((b) => b.id === 'bang')!
    const text = `${bang.body} ${bang.source ?? ''}`.toLowerCase()
    expect(text).toMatch(/20 km|confirmation|local/)
  })

  it('still says the two-tower result is a trade, now that it is shorter', () => {
    // Cutting to 25 words is exactly where a caveat gets lost. The 54.6% is
    // bought with single coverage and the page has to keep saying so.
    const two = BEATS.find((b) => b.id === 'two')!
    const text = `${two.body} ${two.figureNote}`.toLowerCase()
    expect(text).toContain('88.1%')
    expect(text).toMatch(/trade|drops|costs/)
  })
})
