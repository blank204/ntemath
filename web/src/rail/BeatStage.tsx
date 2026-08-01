import { PALETTE } from '../theme/palette'
import { SIZE, TRACK, TYPE, WIDTH } from '../theme/type'
import { FlashToBang } from '../ui/FlashToBang'

/**
 * A beat's inset diagram, as a pure function of which beat is active and how
 * far through it the reader is.
 *
 * ONLY THREE BEATS HAVE ONE. This used to render a visual for all seven, on
 * the pinned left half, and the verdict was that they were "way too simple" —
 * which was fair: a polyline lightning bolt beside the word "lightning" is an
 * illustration of a noun, not information. The left half is now the tower for
 * the whole rail, and a beat earns a diagram here only when the picture shows
 * a measured shape the sentence cannot: a distribution with a tail, two
 * ranges crossing, a clock running in real time. Everything else returns null.
 *
 * No timers and no refs: `t` comes from the scroll position, so every frame
 * of every beat can be rendered — and asserted — at any point without
 * scrolling anything.
 */
export interface StageProps {
  beatId: string
  /** Progress through the beat, 0..1. */
  t: number
  /**
   * Kept in the type for callers, unused by the insets that remain: the one
   * stage that animated on a timer was the opening flash, and it is gone.
   * The tower honours the preference itself, in TowerCanvas.
   */
  reducedMotion?: boolean
}

const W = 520
const H = 360

/**
 * Captions inside a stage. Same voice as every other label on the page.
 *
 * These were rendering at 12px in whatever the browser defaults to, which
 * beside a rebuilt column set in Martian Mono read as unstyled SVG rather
 * than as part of the instrument.
 */
const CAPTION = {
  fontFamily: TYPE.mono,
  fontSize: SIZE.micro,
  fontStretch: WIDTH.labelNarrow,
  letterSpacing: TRACK.label,
} as const

const frame = (children: React.ReactNode, label: string) => (
  <svg
    viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}
    style={{ display: 'block' }}
  >
    {children}
  </svg>
)

/** Gamma(k=1.5) density, the shape of the holdover distribution. */
function gammaPath(): string {
  const pts: string[] = []
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * 8
    const y = Math.sqrt(x) * Math.exp(-x / 1.4)      // k = 1.5, unnormalised
    pts.push(`${40 + (x / 8) * (W - 80)},${H - 60 - y * 240}`)
  }
  return `M ${pts.join(' L ')}`
}

export function BeatStage({ beatId, t }: StageProps) {
  switch (beatId) {
    case 'clock': {
      // The holdover distribution: most fires appear early, and the tail
      // runs for weeks. A marker walks it as the reader scrolls.
      const x = 40 + t * (W - 80)
      return frame(
        <>
          <path d={gammaPath()} fill="none" stroke={PALETTE.signal} strokeWidth={2} />
          <line x1={40} y1={H - 60} x2={W - 40} y2={H - 60}
            stroke={PALETTE.chart.axis} strokeWidth={1} />
          <line x1={x} y1={60} x2={x} y2={H - 60}
            stroke={PALETTE.heat[2]} strokeWidth={1} strokeDasharray="4 4" />
          <text x={40} y={H - 36} {...CAPTION} fill={PALETTE.chart.inkMuted}>
            MINUTES
          </text>
          <text x={W - 40} y={H - 36} textAnchor="end" {...CAPTION}
            fill={PALETTE.chart.inkMuted}>
            WEEKS
          </text>
          <text x={W / 2} y={40} textAnchor="middle" {...CAPTION}
            fill={PALETTE.chart.inkMuted}>
            STRIKE → DETECTABLE FIRE
          </text>
        </>,
        'The holdover delay between a strike and a detectable fire, a long-tailed distribution',
      )
    }

    case 'bang':
      return <FlashToBang />

    case 'two': {
      // Two ranges crossing. The lens is what a second tower buys.
      const sep = 150
      const r = 130
      const cx1 = W / 2 - sep / 2
      const cx2 = W / 2 + sep / 2
      return frame(
        <>
          <circle cx={cx1} cy={H / 2} r={r} fill="none"
            stroke={PALETTE.signal} strokeWidth={2} opacity={0.9} />
          <circle cx={cx2} cy={H / 2} r={r} fill="none"
            stroke={PALETTE.signal} strokeWidth={2} opacity={0.35 + 0.55 * t} />
          {/* The intersection, drawn as the two arcs that bound it. */}
          <path
            d={`M ${W / 2} ${H / 2 - Math.sqrt(r * r - (sep / 2) ** 2)}
                A ${r} ${r} 0 0 1 ${W / 2} ${H / 2 + Math.sqrt(r * r - (sep / 2) ** 2)}
                A ${r} ${r} 0 0 1 ${W / 2} ${H / 2 - Math.sqrt(r * r - (sep / 2) ** 2)}`}
            fill={PALETTE.signal} opacity={0.12 + 0.2 * t} stroke="none"
          />
          <circle cx={W / 2} cy={H / 2} r={4} fill={PALETTE.heat[2]} />
          <text x={cx1} y={H / 2 + 4} textAnchor="middle" {...CAPTION}
            fill={PALETTE.chart.inkMuted}>TOWER</text>
          <text x={cx2} y={H / 2 + 4} textAnchor="middle" {...CAPTION}
            fill={PALETTE.chart.inkMuted}>TOWER</text>
        </>,
        'Two overlapping tower ranges; the strike sits in the intersection',
      )
    }

    // Every other beat has no inset. The tower carries the left half
    // for the whole rail, and a beat that would only illustrate its own
    // noun gets nothing rather than filler.
    default:
      return null
  }
}

/**
 * The flat version of the tower: the same five parts, separating on the same
 * progress. Used where WebGL is unavailable, and it was the whole beat until
 * the 3D one existed.
 */
export function TowerSchematic({ t }: { t: number }) {
      const spread = 26 * t
      const parts: Array<[string, number]> = [
        ['camera head', 0],
        ['microphone array', 1],
        ['compute', 2],
        ['solar', 3],
        ['backhaul', 4],
      ]
      return frame(
        <>
          <line x1={W / 2} y1={70} x2={W / 2} y2={H - 40}
            stroke={PALETTE.chart.axis} strokeWidth={1} strokeDasharray="3 5" />
          {parts.map(([label, i]) => {
            const y = 80 + i * 46 + spread * (i - 2)
            return (
              <g key={label}>
                <rect
                  x={W / 2 - 46} y={y - 15} width={92} height={30} rx={4}
                  fill={PALETTE.surfaceRaised} stroke={PALETTE.signal}
                  strokeWidth={1}
                />
                <text
                  x={W / 2 + 60} y={y + 4} {...CAPTION}
                  fill={PALETTE.chart.inkMuted}
                >
                  {label}
                </text>
              </g>
            )
          })}
        </>,
        'An exploded view of the tower: camera head, microphone array, compute, solar, backhaul',
      )
}
