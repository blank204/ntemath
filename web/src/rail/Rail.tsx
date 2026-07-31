import { useEffect, useRef, useState } from 'react'
import { PALETTE } from '../theme/palette'
import { FIGURE, LABEL, SIZE, TABULAR, TRACK, TYPE, WEIGHT, WIDTH } from '../theme/type'
import { BEATS, LAB_ANCHOR, SOURCES_ANCHOR } from './beats'
import { BeatStage } from './BeatStage'
import { RailSeam } from './RailSeam'
import { railProgress, type RailPosition } from './railProgress'

/**
 * The Rail: seven beats, as a pinned split.
 *
 * Left half is pinned and cropped by the frame — the stage at full height and,
 * behind it, the beat headline set large enough that the split cuts it in half.
 * Right half scrolls: an eyebrow, one enormous figure, and three lines. The
 * figure is the content; the sentence under it is the footnote.
 *
 * The pane clips deliberately (`overflow: hidden`). That is what crops the
 * headline mid-word at the seam and the stage at the top and bottom of the
 * frame, and it is the whole composition — a headline that fits inside its
 * margins is the layout this replaced.
 *
 * Progress within a beat comes from `railProgress`, which is pure and tested —
 * this component only measures the sections and hands the numbers over.
 */

/** Below this the split cannot hold two columns and the layout stacks. */
const SPLIT_MIN = 900

function useIsSplit(): boolean {
  const [split, setSplit] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= SPLIT_MIN)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SPLIT_MIN}px)`)
    const on = () => setSplit(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return split
}

/**
 * Off-screen but in the accessibility tree. `display: none` would take it out
 * of both, which is the mistake this guards against.
 */
const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0,
  overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
  border: 0,
} as const

/** The `+` crop marks both reference sites put at the corners of the grid. */
function CropMark({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  const v = at[0] === 't' ? { top: 18 } : { bottom: 18 }
  const h = at[1] === 'l' ? { left: 18 } : { right: 18 }
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute', ...v, ...h, ...LABEL, fontSize: SIZE.small,
        color: PALETTE.surfaceRaised, lineHeight: 1, zIndex: 4,
      }}
    >
      +
    </span>
  )
}

export function Rail() {
  const refs = useRef<Array<HTMLElement | null>>([])
  const [pos, setPos] = useState<RailPosition>({ index: 0, t: 0 })
  const isSplit = useIsSplit()

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
  const beat = BEATS[active]
  /** Progress through the whole rail, for the seam and the meter. */
  const overall = (active + pos.t) / BEATS.length

  return (
    <div style={{ color: PALETTE.ink, position: 'relative' }}>
      {/* Chrome. Fixed, tiny, and it never moves — only what it says changes. */}
      <div
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10,
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', padding: '18px 20px',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            fontFamily: TYPE.display, fontStretch: WIDTH.displayWide,
            fontWeight: WEIGHT.semibold, fontSize: SIZE.headline,
            letterSpacing: '0.02em', color: PALETTE.ink, lineHeight: 1,
          }}
        >
          PYRA
        </span>
        {/* Skip-to-Lab, first thing in the tab order after the wordmark: a
            judge with four minutes should not have to scroll seven beats to
            reach the thing being judged. */}
        <a
          href={`#${LAB_ANCHOR}`}
          style={{
            ...LABEL, color: PALETTE.ink, textDecoration: 'none',
            pointerEvents: 'auto', opacity: 0.75,
          }}
        >
          Skip to the Lab ↓
        </a>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isSplit ? '52fr 48fr' : '1fr',
          alignItems: 'start',
        }}
      >
        {/* ── Left: pinned, cropped, and it does not scroll. ────────────── */}
        <div
          style={{
            position: 'sticky', top: 0,
            height: isSplit ? '100vh' : '52vh',
            overflow: 'hidden',
          }}
        >
          {/* The stage, at full frame height and cropped top and bottom. 120%
              and pulled up 10% so neither end of it meets an edge — a visual
              that fits inside its box reads as a diagram in a letterbox,
              which is what this replaced. */}
          <div
            style={{
              position: 'absolute', top: '-10%', left: 0, right: 0,
              height: '120%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', zIndex: 1, opacity: 0.92,
            }}
          >
            {/* Grid with centred content, not a plain block: the tall stages
                fill the pane and crop, and the landscape ones sit centred in
                it. Giving the wrapper a height without centring left every
                landscape stage pinned to the top of the frame with a void
                under it. */}
            <div style={{
              width: '100%', height: '100%',
              display: 'grid', placeItems: 'center',
            }}>
              <BeatStage beatId={beat.id} t={pos.t} />
            </div>
          </div>

          {/* The headline, behind the stage and wider than the pane, so the
              seam cuts it mid-word. `hero` is a ceiling: it clamps down on a
              narrow window rather than reflowing into a paragraph.

              Presentational, and `aria-hidden`: it shows one beat at a time,
              so as a heading it would be a document outline that changes
              under the reader as they scroll. The real seven live in the
              column, one per section. */}
          <div
            aria-hidden
            style={{
              position: 'absolute', left: '4vw', bottom: '9vh',
              // 116%, not 150%. At 150% the lines still broke on word
              // boundaries and the clip then swallowed whole words, so it
              // read as broken grammar. At 116% the overflow is a character
              // or two: the seam cuts the last word mid-letter, which is the
              // move — a slab of type the frame is too small for, not a
              // sentence with its end missing.
              //
              // Only when there is a split to be cut by. Stacked, there is no
              // seam, so an overflowing headline is just a headline with its
              // right-hand side missing and nothing to explain why.
              width: isSplit ? '116%' : '92%', margin: 0, zIndex: 2,
              fontFamily: TYPE.display, fontStretch: WIDTH.displayWide,
              fontWeight: WEIGHT.medium, letterSpacing: TRACK.display,
              lineHeight: 0.92,
              fontSize: `clamp(38px, 6.4vw, ${SIZE.hero}px)`,
              color: PALETTE.ink, opacity: 0.94,
              // Caps. At 96px, sentence case reads as a sentence — something
              // to be read left to right — and this is not one: it is a slab
              // of type the split cuts through. Caps also crop cleanly, which
              // lower-case descenders do not.
              textTransform: 'uppercase',
            }}
          >
            {beat.headline}
          </div>

          <CropMark at="tl" />

          {/* Beat list, bottom-left, active one lit. The rest sit back at 35%,
              which is the one chrome move both references share. */}
          {isSplit && (
            <nav
              aria-label="Beats"
              style={{
                position: 'absolute', left: 20, bottom: 18, zIndex: 4,
                display: 'flex', gap: 14, flexWrap: 'wrap', maxWidth: '84%',
              }}
            >
              {BEATS.map((b, i) => (
                <a
                  key={b.id}
                  href={`#beat-${b.id}`}
                  style={{
                    ...LABEL, textDecoration: 'none',
                    color: i === active ? PALETTE.ink : PALETTE.inkMuted,
                    opacity: i === active ? 1 : 0.35,
                  }}
                >
                  {b.eyebrow}
                </a>
              ))}
            </nav>
          )}

          {/* The seam, on the pane's right edge — which is the split. */}
          {isSplit && <RailSeam t={overall} />}
        </div>

        {/* ── Right: the measurement column. This is the half that scrolls. ─ */}
        <div style={{ position: 'relative' }}>
          {BEATS.map((b, i) => (
            <section
              key={b.id}
              id={`beat-${b.id}`}
              ref={(el) => { refs.current[i] = el }}
              aria-current={i === active ? 'step' : undefined}
              style={{
                minHeight: isSplit ? '100vh' : '62vh',
                display: 'flex', flexDirection: 'column',
                justifyContent: 'center',
                padding: isSplit ? '0 5vw 0 4vw' : '0 6vw',
                opacity: i === active ? 1 : 0.28,
                transition: 'opacity 300ms ease',
              }}
            >
              {/* The heading, carried here rather than on the pinned pane.
                  The pane shows one beat at a time and swaps as the reader
                  scrolls; the outline of the document must not. Visually
                  hidden, because the same words are already on screen at
                  96px on the other side of the seam. */}
              <h2 style={SR_ONLY}>{b.headline}</h2>

              <div style={{ ...LABEL, color: PALETTE.inkMuted, marginBottom: 14 }}>
                / {b.eyebrow}
              </div>

              <hr style={{
                border: 0, borderTop: `1px solid ${PALETTE.surfaceRaised}`,
                margin: 0,
              }} />

              {/* The figure. It is the content, and the sentence under it is
                  the footnote — the inversion this whole rebuild turns on. */}
              <div style={{
                ...FIGURE,
                fontSize: `clamp(56px, 9.5vw, ${SIZE.figure}px)`,
                color: PALETTE.ink, padding: '26px 0 22px',
              }}>
                {b.figure}
              </div>

              <hr style={{
                border: 0, borderTop: `1px solid ${PALETTE.surfaceRaised}`,
                margin: 0,
              }} />

              {/* What the figure measures. A bare number at 148px with no unit
                  is the most confident way this page could lie. */}
              <p style={{
                ...LABEL, ...TABULAR, color: PALETTE.inkMuted,
                margin: '16px 0 0', lineHeight: 1.9, maxWidth: '46ch',
              }}>
                {b.figureNote}
              </p>

              <p style={{
                fontFamily: TYPE.mono, fontStretch: WIDTH.labelNarrow,
                fontSize: SIZE.small, letterSpacing: TRACK.label,
                textTransform: 'uppercase', lineHeight: 1.9,
                color: PALETTE.ink, margin: '18px 0 0', maxWidth: '42ch',
              }}>
                {b.body}
              </p>

              {b.cta && (
                <a
                  href={b.cta.href}
                  style={{
                    marginTop: 26, alignSelf: 'flex-start',
                    padding: '13px 20px',
                    border: `1px solid ${PALETTE.signal}`,
                    color: PALETTE.ink, textDecoration: 'none',
                    ...LABEL, fontSize: SIZE.small,
                  }}
                >
                  {b.cta.label} →
                </a>
              )}
            </section>
          ))}

          <CropMark at="tr" />

          {/* Progress meter and the scroll cue, bottom-right — the way both
              references count a section off. */}
          {isSplit && (
            <div
              aria-hidden
              style={{
                position: 'fixed', right: 20, bottom: 18, zIndex: 10,
                display: 'flex', alignItems: 'center', gap: 14,
              }}
            >
              <span style={{ ...LABEL, color: PALETTE.inkMuted }}>Scroll ↓</span>
              <span style={{ display: 'flex', gap: 3 }}>
                {BEATS.map((b, i) => (
                  <span
                    key={b.id}
                    style={{
                      width: 12, height: 3, transform: 'skewX(-24deg)',
                      background: i <= active
                        ? PALETTE.ink : PALETTE.surfaceRaised,
                    }}
                  />
                ))}
              </span>
            </div>
          )}
        </div>
      </div>

      <SourceNotes />
    </div>
  )
}

/**
 * End matter: every beat's sourcing, in full, in one place.
 *
 * The research did not get deleted when the bodies came down to 25 words — it
 * moved here. A judge who wants to check a figure has one place to look, and
 * on the way past it has stopped competing with the figure it supports.
 */
function SourceNotes() {
  return (
    <section
      id={SOURCES_ANCHOR}
      aria-label="Sources for every figure on this page"
      style={{
        borderTop: `1px solid ${PALETTE.surfaceRaised}`,
        padding: '9vh 6vw', display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '34px 48px', alignItems: 'start',
      }}
    >
      <h3 style={{ ...LABEL, color: PALETTE.inkMuted, gridColumn: '1 / -1' }}>
        / Where every number on this page comes from
      </h3>
      {BEATS.filter((b) => b.source).map((b) => (
        <div key={b.id}>
          <div style={{
            ...FIGURE, fontSize: SIZE.headline, color: PALETTE.ink,
            marginBottom: 8,
          }}>
            {b.figure}
          </div>
          <p style={{
            fontFamily: TYPE.body, fontSize: SIZE.body, lineHeight: 1.65,
            color: PALETTE.inkMuted, margin: 0, maxWidth: '52ch',
          }}>
            {b.source}
          </p>
        </div>
      ))}
    </section>
  )
}
