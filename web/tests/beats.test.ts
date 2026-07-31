import { describe, it, expect } from 'vitest'
import { BEATS, LAB_ANCHOR, type Beat } from '../src/rail/beats'

describe('BEATS', () => {
  it('is the seven beats the spec names, in its order', () => {
    expect(BEATS.map((b) => b.id)).toEqual([
      'flash', 'clock', 'gap', 'tower', 'bang', 'two', 'question',
    ])
  })

  it('announces every beat with a quantity, not with a number in a circle', () => {
    // The measurement chip is the page's structural device, and a device
    // that encodes nothing is decoration. Every one of them has to carry a
    // figure the beat is actually about.
    for (const b of BEATS) {
      expect(b.measure, `beat ${b.id}`).toMatch(/\d/)
      expect(b.measure.length).toBeLessThan(40)
    }
  })

  it('gives every beat a kicker, a headline and a body', () => {
    for (const b of BEATS) {
      expect(b.kicker.length).toBeGreaterThan(2)
      expect(b.headline.length).toBeGreaterThan(8)
      expect(b.body.length).toBeGreaterThan(40)
    }
  })

  it('ends by handing the reader to the Lab', () => {
    const last = BEATS[BEATS.length - 1]
    expect(last.id).toBe('question')
    expect(last.cta).toBeTruthy()
    expect(last.cta!.href).toBe(`#${LAB_ANCHOR}`)
  })

  it('sources every number it states', () => {
    // A figure with no source on a scroll page is a figure a judge cannot
    // check, and this project's whole posture is that they can.
    for (const b of BEATS) {
      if (/\d/.test(b.body)) expect(b.source, `beat ${b.id}`).toBeTruthy()
    }
  })
})

/** Everything the Rail puts in front of a reader. */
const railCopy = (): string =>
  BEATS.map((b: Beat) =>
    [b.measure, b.kicker, b.headline, b.body, b.source ?? '',
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
})
