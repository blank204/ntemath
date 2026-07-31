import { PALETTE } from '../theme/palette'

/**
 * The seam: the hard vertical edge between the pinned stage and the scrolling
 * column, drawn as the thing the whole page is about.
 *
 * STR8FIRE leaves this edge as a plain rule. Here it carries the arrival-time
 * trace — the page's one piece of ornament, and the only one, because it is
 * the mechanism rather than a decoration of it. Read top to bottom it is a
 * single microphone channel over the length of the site: the flash at the top,
 * then silence, then the thunder envelope arriving near the end. That is the
 * measurement beat five is about, stretched over the seven beats it takes to
 * earn it.
 *
 * The trace is drawn only *behind* the playhead. Ahead of the reader the
 * channel is flat, because the sound has not arrived yet.
 *
 * Line work, so it is `signal` and never `ember`: the fire signal is spent on
 * fire, and a decorated edge is exactly the kind of place it used to leak.
 */

/** Where the thunder envelope begins, as a fraction of the whole rail. */
export const BANG_AT = 0.62

/**
 * Deterministic band-limited noise. Not Math.random: the seam is server
 * rendered and asserted in tests, so the same scroll position has to produce
 * the same trace every time it is drawn.
 */
function noise(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

/**
 * The channel, as an SVG path in a `width` × `height` box.
 *
 * `t` is progress through the whole rail, 0..1. Amplitude decays after the
 * onset the way a thunder envelope does — a fast rise and a long roll — so the
 * shape says "thunder" rather than "waveform".
 */
export function seamPath(t: number, width: number, height: number): string {
  const mid = width / 2
  const steps = 240
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * height
    const at = i / steps
    let a = 0
    if (at > BANG_AT && at <= t) {
      // Fast rise over the first tenth of the envelope, then a long roll off.
      const into = (at - BANG_AT) / (1 - BANG_AT)
      const env = into < 0.1
        ? into / 0.1
        : Math.exp(-(into - 0.1) * 3.2)
      a = env * noise(i) * (mid - 1)
    }
    pts.push(`${(mid + a).toFixed(2)},${y.toFixed(1)}`)
  }
  return `M ${pts.join(' L ')}`
}

export interface RailSeamProps {
  /** Progress through the whole rail, 0..1. */
  t: number
  width?: number
}

export function RailSeam({ t, width = 56 }: RailSeamProps) {
  const H = 1000
  const clamped = Math.max(0, Math.min(1, t))
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${H}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute', top: 0, bottom: 0, right: -width / 2,
        width, height: '100%', pointerEvents: 'none', zIndex: 3,
      }}
    >
      {/* The edge itself. Present at full height whether or not sound has
          arrived — the channel exists, it is just quiet. */}
      <line
        x1={width / 2} y1={0} x2={width / 2} y2={H}
        stroke={PALETTE.surfaceRaised} strokeWidth={1}
      />
      <path
        d={seamPath(clamped, width, H)}
        fill="none" stroke={PALETTE.signal} strokeWidth={1}
        vectorEffect="non-scaling-stroke" opacity={0.85}
      />
      {/* The playhead: where the reader is on the channel. */}
      <line
        x1={width / 2 - 5} y1={clamped * H} x2={width / 2 + 5} y2={clamped * H}
        stroke={PALETTE.ink} strokeWidth={1} vectorEffect="non-scaling-stroke"
        opacity={0.6}
      />
    </svg>
  )
}
