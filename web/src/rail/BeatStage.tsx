import { PALETTE } from '../theme/palette'
import { SIZE, TRACK, TYPE, WIDTH } from '../theme/type'
import { FlashToBang } from '../ui/FlashToBang'
import { TowerCanvas } from './tower/TowerCanvas'

/**
 * The Rail's visual, as a pure function of which beat is active and how far
 * through it the reader is.
 *
 * No timers and no refs: `t` comes from the scroll position, so every frame
 * of every beat can be rendered — and asserted — at any point without
 * scrolling anything.
 */
export interface StageProps {
  beatId: string
  /** Progress through the beat, 0..1. */
  t: number
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

/**
 * Portrait, and close to the pinned pane's own aspect (roughly 3:4).
 *
 * A much taller box would be sliced so hard horizontally that the subject
 * blows up past the frame edges; this crops the top and bottom, which is the
 * intent, and leaves the ground contact inside the visible band.
 */
const TALL_W = 560
const TALL_H = 820

/**
 * A stage that fills the pinned pane and is cropped by it.
 *
 * `slice` rather than the default `meet`: the point is that the subject runs
 * off the top and bottom of the frame. A visual scaled to fit inside its box
 * is a diagram in a letterbox, which is the composition this replaced.
 */
const tallFrame = (children: React.ReactNode, label: string) => (
  <svg
    viewBox={`0 0 ${TALL_W} ${TALL_H}`} role="img" aria-label={label}
    preserveAspectRatio="xMidYMid slice"
    style={{ display: 'block', width: '100%', height: '100%' }}
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

export function BeatStage({ beatId, t, reducedMotion = false }: StageProps) {
  switch (beatId) {
    case 'flash': {
      // One strike, held bright through the first half of its beat and
      // dimming as the reader scrolls off it. The threshold is 0.6 rather
      // than something near zero because a beat that opens the page starts
      // at t = 0.5 — half of it is already above the fold — and the cold
      // open has to be lit when the page loads.
      const hot = t < 0.6 && !reducedMotion
      const core = hot ? PALETTE.heat[4] : PALETTE.heat[2]
      // The channel runs off the top of the frame and reaches ground low in
      // it: the reader is under the storm, not looking at a diagram of one.
      const CHANNEL = 'M 236 -40 L 274 150 L 246 214 L 292 352 L 262 424 '
        + 'L 300 552 L 280 618 L 296 690'
      // Two, short. Three long ones read as a second bolt rather than as
      // branches off this one.
      const BRANCHES = [
        'M 274 150 L 224 244',
        'M 292 352 L 344 452',
      ]
      const GROUND = 690
      return tallFrame(
        <>
          {/* The glow: the same channel, wider and faint, under the core.
              Two tight passes rather than one broad one — a single 26px
              stroke at low alpha read as a grey smudge beside the bolt
              instead of as light coming off it. Filters would do this
              properly and cost a composite on every scroll frame, which is
              not affordable on the laptop GPU this has to run on. */}
          <path
            d={CHANNEL} fill="none" stroke={core}
            strokeWidth={hot ? 16 : 9} opacity={hot ? 0.1 : 0.05}
            strokeLinecap="round" strokeLinejoin="round"
          />
          <path
            d={CHANNEL} fill="none" stroke={core}
            strokeWidth={hot ? 9 : 5} opacity={hot ? 0.22 : 0.1}
            strokeLinecap="round" strokeLinejoin="round"
          />
          {BRANCHES.map((d) => (
            <path
              key={d} d={d} fill="none" stroke={core}
              strokeWidth={hot ? 2.5 : 1.5} opacity={hot ? 0.5 : 0.28}
              strokeLinecap="round" strokeLinejoin="round"
            />
          ))}
          <path
            d={CHANNEL} fill="none" stroke={core}
            strokeWidth={hot ? 6 : 3} opacity={hot ? 1 : 0.75}
            strokeLinecap="round" strokeLinejoin="round"
          />
          {/* Where it lands. The ground is unwatched, which is the beat: the
              contact is bright and there is nothing near it. */}
          <ellipse
            cx={296} cy={GROUND} rx={26 + 150 * t} ry={5 + 16 * t}
            fill="none" stroke={PALETTE.chart.axis} strokeWidth={1}
            opacity={0.7}
          />
          <ellipse
            cx={296} cy={GROUND} rx={12 + 60 * t} ry={3 + 7 * t}
            fill="none" stroke={PALETTE.chart.axis} strokeWidth={1}
            opacity={0.45}
          />
          <line x1={0} y1={GROUND} x2={TALL_W} y2={GROUND}
            stroke={PALETTE.chart.axis} strokeWidth={1} />
        </>,
        'A single lightning strike reaching unwatched ground',
      )
    }

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

    case 'gap': {
      // Located, everywhere. Scored against the ground, nowhere.
      const dots = Array.from({ length: 24 }, (_, i) => ({
        x: 50 + (i % 8) * 60, y: 90 + Math.floor(i / 8) * 70,
        scored: i === 11,
      }))
      return frame(
        <>
          {dots.map((d, i) => (
            <circle
              key={i} cx={d.x} cy={d.y} r={d.scored ? 7 : 4}
              fill={d.scored ? PALETTE.heat[2] : PALETTE.chart.axis}
              opacity={d.scored ? 1 : 0.5 + 0.5 * t}
            />
          ))}
          <text x={W / 2} y={40} textAnchor="middle" {...CAPTION}
            fill={PALETTE.chart.inkMuted}>
            EVERY STROKE, LOCATED
          </text>
        </>,
        'Many located strokes, only one of which will start a fire',
      )
    }

    case 'tower':
      // Three dimensions where there is a GPU, the flat schematic where
      // there is not — a locked-down machine or a blocklisted driver gets
      // the same information, drawn differently, rather than a hole.
      // The pinned hero, at frame height and cropped by the pane, rather than
      // a render in a box. The parts list is off here — it collided with the
      // headline — and the five subsystems are named in the beat's figureNote
      // and its source note instead.
      return (
        <TowerCanvas
          t={t} height={880} showParts={false}
          fallback={<TowerSchematic t={t} />}
        />
      )

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

    default: {
      // The question. A scatter that firms up as the reader arrives at it —
      // the network the Lab below is about to argue over.
      const towers = Array.from({ length: 28 }, (_, i) => ({
        x: 40 + ((i * 97) % (W - 80)),
        y: 60 + ((i * 143) % (H - 120)),
      }))
      return frame(
        <>
          {towers.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={3.5}
              fill={PALETTE.signal} opacity={0.25 + 0.75 * t} />
          ))}
        </>,
        'A scattered network of towers over the demo region',
      )
    }
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
