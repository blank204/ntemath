import { useEffect, useRef, useState } from 'react'
import { PALETTE } from '../theme/palette'
import { LABEL, SIZE, TABULAR, TYPE, WEIGHT } from '../theme/type'
import { BEATS, LAB_ANCHOR } from './beats'
import { BeatStage } from './BeatStage'
import { railProgress, type RailPosition } from './railProgress'

/**
 * The Rail: seven beats, scrolled.
 *
 * The stage is sticky and the text scrolls past it, so the visual for a beat
 * is on screen for exactly as long as the words that explain it. Progress
 * within a beat comes from `railProgress`, which is pure and tested — this
 * component only measures the sections and hands the numbers over.
 */
export function Rail() {
  const refs = useRef<Array<HTMLElement | null>>([])
  const [pos, setPos] = useState<RailPosition>({ index: 0, t: 0 })

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const boxes = refs.current.flatMap((el) => {
        if (!el) return []
        const r = el.getBoundingClientRect()
        return [{ top: r.top + window.scrollY, height: r.height }]
      })
      setPos(railProgress(boxes, window.scrollY, window.innerHeight))
    }
    // Coalesce to one measurement per frame: scroll fires far faster than
    // anything here needs to redraw, and getBoundingClientRect forces layout.
    //
    // Cancel-and-reschedule rather than "skip if one is already pending".
    // The pending-flag version wedges permanently if a scheduled frame never
    // runs — which the renderer does under a devtools screenshot, and did:
    // the stage stopped tracking after one gesture and sat a whole beat
    // behind while the text scrolled on.
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const active = pos.index < 0 ? 0 : pos.index

  return (
    <div style={{ background: PALETTE.canvas, color: PALETTE.ink }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 20px', background: PALETTE.canvas,
        borderBottom: `1px solid ${PALETTE.surfaceRaised}`,
        fontSize: SIZE.small,
      }}>
        <span style={{
          fontFamily: TYPE.display, color: PALETTE.brandOrange,
          fontWeight: WEIGHT.semibold, fontSize: SIZE.subhead,
          letterSpacing: '0.16em',
        }}>
          PYRA
        </span>
        {/* Skip-to-Lab, first thing in the tab order after the wordmark: a
            judge with four minutes should not have to scroll seven beats to
            reach the thing being judged. */}
        <a
          href={`#${LAB_ANCHOR}`}
          style={{
            ...LABEL, color: PALETTE.meshTeal, textDecoration: 'none',
          }}
        >
          Skip to the Lab →
        </a>
      </header>

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 1fr',
        gap: 40, maxWidth: 1200, margin: '0 auto', padding: '0 24px',
      }}>
        <div>
          {BEATS.map((b, i) => (
            <section
              key={b.id}
              id={`beat-${b.id}`}
              ref={(el) => { refs.current[i] = el }}
              aria-current={i === active ? 'step' : undefined}
              style={{
                minHeight: '92vh', display: 'flex', flexDirection: 'column',
                justifyContent: 'center',
                // Top padding clears the sticky header, which is 44px of
                // chrome the centred text would otherwise slide under.
                padding: '76px 0 48px',
                opacity: i === active ? 1 : 0.45,
                transition: 'opacity 240ms ease',
              }}
            >
              {/* The measurement, then the beat's name. The quantity comes
                  first because it is the thing the beat is about; the name
                  is the handle for it. */}
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 10,
                flexWrap: 'wrap',
              }}>
                <span style={{
                  ...TABULAR, fontFamily: TYPE.mono, fontSize: SIZE.small,
                  fontWeight: WEIGHT.medium, color: PALETTE.meshTeal,
                }}>
                  {b.measure}
                </span>
                <span aria-hidden style={{
                  flex: '1 1 40px', height: 1, background: PALETTE.surfaceRaised,
                }} />
                <span style={{ ...LABEL, color: PALETTE.chart.inkMuted }}>
                  {b.kicker}
                </span>
              </div>
              {/* The opening beat is the thesis and gets the hero size; the
                  other six are chapters and share one size. Two sizes, not
                  seven. */}
              <h2 style={{
                margin: '14px 0 16px',
                fontSize: i === 0 ? SIZE.hero : SIZE.headline,
                maxWidth: i === 0 ? '15ch' : '19ch',
              }}>
                {b.headline}
              </h2>
              <p style={{
                margin: 0, fontSize: SIZE.body, lineHeight: 1.65,
                maxWidth: '58ch',
              }}>
                {b.body}
              </p>
              {b.source && (
                <p style={{
                  marginTop: 14, fontSize: SIZE.small, lineHeight: 1.6,
                  maxWidth: '58ch', paddingLeft: 12,
                  borderLeft: `1px solid ${PALETTE.surfaceRaised}`,
                  color: PALETTE.chart.inkMuted,
                }}>
                  {b.source}
                </p>
              )}
              {b.cta && (
                <a
                  href={b.cta.href}
                  style={{
                    marginTop: 22, alignSelf: 'flex-start', padding: '11px 18px',
                    border: `1px solid ${PALETTE.meshTeal}`, borderRadius: 4,
                    color: PALETTE.meshTeal, textDecoration: 'none',
                    ...LABEL, fontSize: SIZE.small,
                  }}
                >
                  {b.cta.label}
                </a>
              )}
            </section>
          ))}
        </div>

        {/* The stage. Sticky rather than fixed so it stays inside its column
            and cannot cover the text on a narrow window. */}
        <div style={{
          position: 'sticky', top: 0, height: '100vh', display: 'flex',
          alignItems: 'center',
        }}>
          <div style={{ width: '100%' }}>
            <BeatStage beatId={BEATS[active].id} t={pos.t} />
          </div>
        </div>
      </div>
    </div>
  )
}
