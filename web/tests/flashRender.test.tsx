import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FlashScene } from '../src/ui/FlashToBang'
import { phaseAt, delayForRangeKm } from '../src/lib/flashToBang'
import { PALETTE } from '../src/theme/palette'

const KM = 2
const TEMP = 15
const DELAY = delayForRangeKm(KM, TEMP)

const at = (t: number, reducedMotion = false) => renderToStaticMarkup(
  <FlashScene
    state={phaseAt(t, DELAY, TEMP)} distanceKm={KM} tempC={TEMP}
    reducedMotion={reducedMotion}
  />,
)

describe('FlashScene', () => {
  it('shows the clock running and no range during the silence', () => {
    const html = at(DELAY / 2)
    expect(html).toContain('listening')
    // The measurement must not appear before the sound arrives — that is the
    // one thing the whole sequence exists to prevent.
    expect(html).not.toContain('km')
  })

  it('shows the arithmetic once the thunder lands', () => {
    const html = at(DELAY)
    expect(html).toContain('BOOM')
    expect(html).toContain('m/s')
    expect(html).toContain('2.00 km')
    expect(html).not.toContain('listening')
  })

  it('keeps the answer on screen after the boom', () => {
    expect(at(DELAY + 1.5)).toContain('2.00 km')
  })

  it('describes the state to a screen reader, not just to the eye', () => {
    expect(at(DELAY / 2)).toContain('thunder has not arrived')
    expect(at(DELAY)).toContain('Thunder arrived after')
  })

  it('grows the ring with the sound rather than snapping to the answer', () => {
    // Radii, parsed out of the rendered circles: the wavefront is a physical
    // object and it is halfway out halfway through the gap.
    const radius = (html: string) => {
      const m = html.match(/<circle[^>]*r="([\d.]+)"/)
      return m ? Number(m[1]) : 0
    }
    const half = radius(at(DELAY / 2))
    const full = radius(at(DELAY))
    expect(half).toBeGreaterThan(0)
    expect(full / half).toBeCloseTo(2, 1)
  })

  it('holds the flash at full brightness only at the start', () => {
    // heat[4] is the brightest heat step and is reserved for exactly this.
    expect(at(0)).toContain(PALETTE.heat[4])
    expect(at(DELAY / 2)).not.toContain(PALETTE.heat[4])
  })

  it('never flashes at full brightness when reduced motion is requested', () => {
    expect(at(0, true)).not.toContain(PALETTE.heat[4])
    // ...but the sequence still plays and still reads.
    expect(at(0, true)).toContain('listening')
  })

  it('paints nothing outside the palette', () => {
    const html = [at(0), at(DELAY / 2), at(DELAY)].join('')
    const known = new Set<string>([
      PALETTE.canvas, PALETTE.surface, PALETTE.surfaceRaised, PALETTE.ink,
      PALETTE.ember, PALETTE.signal, PALETTE.control,
      ...PALETTE.heat, ...PALETTE.riskRamp,
      PALETTE.chart.surface, PALETTE.chart.grid, PALETTE.chart.axis,
      PALETTE.chart.inkMuted,
    ].map((c) => c.toLowerCase()))
    for (const hex of html.match(/#[0-9a-fA-F]{3,8}/g) ?? []) {
      expect(known.has(hex.toLowerCase())).toBe(true)
    }
  })
})
