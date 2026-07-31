import { PALETTE } from '../theme/palette'
import { FlashToBang } from '../ui/FlashToBang'

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

export function BeatStage({ beatId, t, reducedMotion = false }: StageProps) {
  switch (beatId) {
    case 'flash': {
      // One strike, held bright through the first half of its beat and
      // dimming as the reader scrolls off it. The threshold is 0.6 rather
      // than something near zero because a beat that opens the page starts
      // at t = 0.5 — half of it is already above the fold — and the cold
      // open has to be lit when the page loads.
      const hot = t < 0.6 && !reducedMotion
      return frame(
        <>
          <path
            d={`M 300 40 l -40 150 l 34 0 l -50 140`}
            fill="none" stroke={hot ? PALETTE.heat[4] : PALETTE.heat[2]}
            strokeWidth={hot ? 7 : 3} opacity={hot ? 1 : 0.8}
          />
          <ellipse
            cx={244} cy={330} rx={90 + 200 * t} ry={12 + 20 * t}
            fill="none" stroke={PALETTE.chart.axis} strokeWidth={1}
          />
          <line x1={0} y1={330} x2={W} y2={330}
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
          <path d={gammaPath()} fill="none" stroke={PALETTE.meshTeal} strokeWidth={2} />
          <line x1={40} y1={H - 60} x2={W - 40} y2={H - 60}
            stroke={PALETTE.chart.axis} strokeWidth={1} />
          <line x1={x} y1={60} x2={x} y2={H - 60}
            stroke={PALETTE.heat[2]} strokeWidth={1} strokeDasharray="4 4" />
          <text x={40} y={H - 36} fontSize={12} fill={PALETTE.chart.inkMuted}>
            minutes
          </text>
          <text x={W - 40} y={H - 36} textAnchor="end" fontSize={12}
            fill={PALETTE.chart.inkMuted}>
            weeks
          </text>
          <text x={W / 2} y={40} textAnchor="middle" fontSize={12}
            fill={PALETTE.chart.inkMuted}>
            strike → detectable fire
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
          <text x={W / 2} y={40} textAnchor="middle" fontSize={12}
            fill={PALETTE.chart.inkMuted}>
            every stroke, located
          </text>
          <text x={W / 2} y={H - 30} textAnchor="middle" fontSize={12}
            fill={PALETTE.heat[2]}>
            one of them is going to start a fire
          </text>
        </>,
        'Many located strokes, only one of which will start a fire',
      )
    }

    case 'tower': {
      // Exploded schematic. Placeholder for the 3D build, and honest as a
      // schematic in its own right: every part is one the brief names.
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
                  fill={PALETTE.surfaceRaised} stroke={PALETTE.meshTeal}
                  strokeWidth={1}
                />
                <text
                  x={W / 2 + 60} y={y + 4} fontSize={12}
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
            stroke={PALETTE.meshTeal} strokeWidth={2} opacity={0.9} />
          <circle cx={cx2} cy={H / 2} r={r} fill="none"
            stroke={PALETTE.meshTeal} strokeWidth={2} opacity={0.35 + 0.55 * t} />
          {/* The intersection, drawn as the two arcs that bound it. */}
          <path
            d={`M ${W / 2} ${H / 2 - Math.sqrt(r * r - (sep / 2) ** 2)}
                A ${r} ${r} 0 0 1 ${W / 2} ${H / 2 + Math.sqrt(r * r - (sep / 2) ** 2)}
                A ${r} ${r} 0 0 1 ${W / 2} ${H / 2 - Math.sqrt(r * r - (sep / 2) ** 2)}`}
            fill={PALETTE.meshTeal} opacity={0.12 + 0.2 * t} stroke="none"
          />
          <circle cx={W / 2} cy={H / 2} r={4} fill={PALETTE.heat[2]} />
          <text x={cx1} y={H / 2 + 4} textAnchor="middle" fontSize={12}
            fill={PALETTE.chart.inkMuted}>tower</text>
          <text x={cx2} y={H / 2 + 4} textAnchor="middle" fontSize={12}
            fill={PALETTE.chart.inkMuted}>tower</text>
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
              fill={PALETTE.meshTeal} opacity={0.25 + 0.75 * t} />
          ))}
          <text x={W / 2} y={H - 24} textAnchor="middle" fontSize={12}
            fill={PALETTE.chart.inkMuted}>
            111 towers, and the argument about where they go
          </text>
        </>,
        'A scattered network of towers over the demo region',
      )
    }
  }
}
