import { useEffect, useRef, useState } from 'react'
import { PALETTE } from '../theme/palette'
import { FIGURE, LABEL, SIZE, TABULAR, TRACK, TYPE, WEIGHT, WIDTH } from '../theme/type'
import { BEATS, LAB_ANCHOR, SOURCES_ANCHOR } from './beats'
import { BeatStage, TowerSchematic } from './BeatStage'
import { TowerCanvas } from './tower/TowerCanvas'
import { RailSeam } from './RailSeam'
import { railProgress, type RailPosition } from './railProgress'

/**
 * The Rail: seven beats, as a pinned split.
 *
 * TEXT ON ONE SIDE ONLY. The left half is pinned and holds the tower and
 * nothing else — no headline, no caption. The first pass put a per-beat
 * headline over there as well, and the verdict was that the page was
 * cluttered and that the reference site "doesn't have text on both sides".
 * That is right, and the reason is subtler than it first looks: STR8FIRE's
 * left-hand line never changes, so it stops being something to read and
 * becomes texture. A line that swaps every beat cannot do that — it asks to
 * be read, opposite a column that is also asking to be read.
 *
 * So the left half is the object. One tower for the whole rail, coming apart
 * a subsystem at a time on overall scroll progress, which is the move both
 * references make: one thing carries the page and the words go past it.
 *
 * The right half is the only text: an eyebrow, one enormous figure, what that
 * figure measures, and the beat's headline. Three of the seven beats also
 * carry a small inset, for the visuals that show a measured shape rather than
 * illustrating a noun.
 *
 * The pane clips deliberately (`overflow: hidden`): that is what crops the
 * tower at the top and bottom of the frame, so it reads as an object too big
 * for the picture rather than a render sitting in a letterbox.
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
            {/* THE OBJECT, and the only thing on this side of the seam.
                One tower for the whole rail, coming apart a subsystem at a
                time as the reader scrolls — driven by overall progress, not
                by the beat, so it is continuous rather than seven diagrams
                swapping places.

                There is no headline over here any more. Both reference sites
                put text on one side only: STR8FIRE's left-hand line never
                changes, so it reads as texture rather than as something to
                read. A per-beat headline here asked the reader to read two
                columns at once, which is what made the page cluttered. */}
            <div style={{ width: '100%', height: '100%' }}>
              <TowerCanvas
                t={overall} height="100%" showParts={false}
                fallback={<TowerSchematic t={overall} />}
              />
            </div>
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

              {/* The beat's argument, and the real heading — the pinned pane
                  carries no text now, so this is the only place the headline
                  appears and the document outline is genuine rather than a
                  hidden duplicate. The body paragraph that used to sit under
                  it has moved to end matter: eyebrow, figure, unit, one line
                  is the whole column. */}
              <h2 style={{
                fontFamily: TYPE.display, fontStretch: WIDTH.displayWide,
                fontWeight: WEIGHT.medium, letterSpacing: TRACK.display,
                fontSize: `clamp(21px, 2.1vw, ${SIZE.headline}px)`,
                lineHeight: 1.16, color: PALETTE.ink,
                margin: '22px 0 0', maxWidth: '20ch',
              }}>
                {b.headline}
              </h2>

              {b.inset && (
                <div style={{ marginTop: 26, maxWidth: 420 }}>
                  <BeatStage beatId={b.id} t={i === active ? pos.t : 0} />
                </div>
              )}

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
          {/* The body paragraph the column used to carry. It did not get cut
              when the column came down to a figure and one line — it reads
              here, first, as the plain-language version of the beat. */}
          <p style={{
            fontFamily: TYPE.body, fontSize: SIZE.body, lineHeight: 1.65,
            color: PALETTE.ink, margin: '0 0 10px', maxWidth: '52ch',
          }}>
            {b.body}
          </p>
          <p style={{
            fontFamily: TYPE.body, fontSize: SIZE.small, lineHeight: 1.7,
            color: PALETTE.inkMuted, margin: 0, maxWidth: '52ch',
          }}>
            {b.source}
          </p>
        </div>
      ))}
    </section>
  )
}
