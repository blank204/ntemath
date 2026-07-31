import { useEffect, useRef, useState } from 'react'
import { PALETTE } from '../theme/palette'
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
        padding: '10px 20px', background: PALETTE.canvas,
        borderBottom: `1px solid ${PALETTE.surfaceRaised}`,
        font: '13px/1.5 system-ui, sans-serif',
      }}>
        <span style={{ color: PALETTE.brandOrange, fontWeight: 700, letterSpacing: 1 }}>
          PYRA
        </span>
        {/* Skip-to-Lab, first thing in the tab order after the wordmark: a
            judge with four minutes should not have to scroll seven beats to
            reach the thing being judged. */}
        <a
          href={`#${LAB_ANCHOR}`}
          style={{ color: PALETTE.meshTeal, textDecoration: 'none' }}
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
              <div style={{
                color: PALETTE.meshTeal, fontSize: 12, letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}>
                {b.kicker}
              </div>
              <h2 style={{
                margin: '10px 0 14px', fontSize: 30, lineHeight: 1.15,
                fontWeight: 600,
              }}>
                {b.headline}
              </h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65 }}>
                {b.body}
              </p>
              {b.source && (
                <p style={{
                  marginTop: 12, fontSize: 12, lineHeight: 1.6,
                  color: PALETTE.chart.inkMuted,
                }}>
                  {b.source}
                </p>
              )}
              {b.cta && (
                <a
                  href={b.cta.href}
                  style={{
                    marginTop: 20, alignSelf: 'flex-start', padding: '10px 16px',
                    border: `1px solid ${PALETTE.meshTeal}`, borderRadius: 6,
                    color: PALETTE.meshTeal, textDecoration: 'none', fontSize: 14,
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
