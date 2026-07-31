import { PALETTE } from '../theme/palette'
import type { BenchmarkPoint, BenchmarkResult } from '../lib/benchmark'

export interface ChartSeries {
  key: 'pyra' | 'uniform'
  label: string
  color: string
  path: string
  points: Array<{ x: number; y: number; datum: BenchmarkPoint }>
  endLabel: { x: number; y: number; text: string }
}

export interface ChartAxis {
  orientation: 'x' | 'y'
  ticks: Array<{ value: number; pos: number; label: string }>
}

export interface ChartAnnotation {
  x: number
  y: number
  text: string
  /** Which side of `x` the text runs, so a right-side label cannot be clipped. */
  anchor: 'start' | 'end'
  leader: { x1: number; y1: number; x2: number; y2: number }
}

export interface ChartModel {
  width: number
  height: number
  pad: { top: number; right: number; bottom: number; left: number }
  series: ChartSeries[]
  axes: ChartAxis[]
  legend: Array<{ label: string; color: string }>
  annotations: ChartAnnotation[]
  table: Array<{ nodes: number; pyra: string; uniform: string; delta: string }>
  xOf: (nodes: number) => number
  yOf: (fraction: number) => number
}

// `right` is wide enough for a direct label that NAMES its series, not just a
// percentage. A bare "92.8%" leaves a reader who cannot separate the two hues
// with no colour-free way to tell the lines apart, which is exactly what the
// palette waiver obliges the chart to provide.
const PAD = { top: 18, right: 112, bottom: 44, left: 52 }
/** Below this vertical gap the two end labels read as one block. */
const LABEL_MIN_GAP = 13
const pct = (f: number) => `${(100 * f).toFixed(1)}%`
const signedPP = (pp: number) => `${pp >= 0 ? '+' : '-'}${Math.abs(pp).toFixed(1)} pp`

/**
 * Pure geometry for the coverage-versus-budget comparison chart.
 *
 * Split out of the component so the rules that matter are unit-testable
 * without a DOM: one y-axis (never two), colour assigned by the job each
 * series does rather than by which one is ahead, a legend for both series, and
 * a table view. The last two are not decoration — Task 9 waived two of the
 * palette's colour checks, and secondary encoding is what pays for that. See
 * docs/palette-validation.md.
 *
 * The x-axis is log-scaled in node count. The interesting half of this chart
 * is the small-budget end, where the two strategies genuinely differ; a linear
 * axis spends two-thirds of its width on the saturated tail where both arms
 * are flat and converging.
 */
export function buildChartModel(
  result: BenchmarkResult, width = 640, height = 320,
): ChartModel {
  const pts = result.points
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  const nMin = pts.length ? pts[0].requested : 1
  const nMax = pts.length ? pts[pts.length - 1].requested : 1
  const lo = Math.log(Math.max(nMin, 1))
  const hi = Math.log(Math.max(nMax, Math.max(nMin, 1) + 1))

  const xOf = (nodes: number) =>
    PAD.left + ((Math.log(Math.max(nodes, 1)) - lo) / (hi - lo)) * plotW
  // Coverage is a fraction in [0, 1] on a single axis anchored at zero. Not
  // auto-scaled to the data: a y-axis starting at 0.9 would turn a 4-point
  // difference into a visual chasm.
  const yOf = (f: number) => PAD.top + (1 - Math.min(Math.max(f, 0), 1)) * plotH

  const build = (
    key: 'pyra' | 'uniform', label: string, short: string, color: string,
    pick: (p: BenchmarkPoint) => number,
  ): ChartSeries => {
    const points = pts.map((p) => ({ x: xOf(p.requested), y: yOf(pick(p)), datum: p }))
    const path = points
      .map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`)
      .join(' ')
    const last = points[points.length - 1]
    return {
      key, label, color, path, points,
      // The label names the series as well as giving its value. A legend
      // swatch is itself a colour cue, so without the name there is no
      // colour-free path to identity except the table.
      endLabel: last
        ? { x: last.x, y: last.y, text: `${short} ${pct(pick(last.datum))}` }
        : { x: PAD.left, y: PAD.top, text: `${short} 0.0%` },
    }
  }

  const series: ChartSeries[] = pts.length
    ? [
        build('pyra', 'Risk-driven placement', 'Risk-driven', PALETTE.series.pyra, (p) => p.pyra),
        build('uniform', 'Uniform grid', 'Uniform', PALETTE.series.baseline, (p) => p.uniform),
      ]
    : []

  // On the real curve the two arms end 4.2 points apart, which is ~11 units —
  // close enough that the labels read as one block. Push them apart around
  // their midpoint. The MARKS stay where the data is; only the text moves.
  if (series.length === 2) {
    const [a, b] = series
    const gap = Math.abs(a.endLabel.y - b.endLabel.y)
    if (gap < LABEL_MIN_GAP) {
      const mid = (a.endLabel.y + b.endLabel.y) / 2
      const half = LABEL_MIN_GAP / 2
      const aAbove = a.endLabel.y <= b.endLabel.y
      a.endLabel.y = mid + (aAbove ? -half : half)
      b.endLabel.y = mid + (aAbove ? half : -half)
    }
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) => ({
    value: v, pos: yOf(v), label: `${Math.round(v * 100)}%`,
  }))
  // Every third budget, plus both ends. The last modulo tick is then dropped
  // if it would crowd the endpoint — on the real 14-point curve it lands 40
  // units from it while every other gap is 120.
  const xTickValues = pts.length
    ? pts.map((p) => p.requested)
        .filter((_, i, a) => i === 0 || i === a.length - 1 || i % 3 === 0)
        .filter((v, i, a) =>
          i !== a.length - 2 || xOf(a[a.length - 1]) - xOf(v) > 50)
    : []
  const axes: ChartAxis[] = [
    { orientation: 'y', ticks: yTicks },
    {
      orientation: 'x',
      ticks: xTickValues.map((v) => ({
        value: v, pos: xOf(v), label: String(v),
      })),
    },
  ]

  const annotations: ChartAnnotation[] = []
  const cross = result.crossoverNodes
  if (cross != null && pts.length) {
    // The crossover is BISECTED, so it almost never coincides with a plotted
    // budget — on the real curve it is 285, between the 215 and 351 samples.
    // Taking the y from the nearest plotted point would put the leader tip
    // ~30 units above both curves, pointing at empty plot. Interpolate along
    // the same log-x the lines are drawn on, between the bracket the
    // bisection actually narrowed to.
    const bracket = result.crossoverBracket
    const lo = bracket ? pts.find((p) => p.requested === bracket[0]) : undefined
    const hi = bracket ? pts.find((p) => p.requested === bracket[1]) : undefined
    let uniformAt: number
    if (lo && hi && hi.requested > lo.requested) {
      const t = (Math.log(cross) - Math.log(lo.requested))
        / (Math.log(hi.requested) - Math.log(lo.requested))
      uniformAt = lo.uniform + t * (hi.uniform - lo.uniform)
    } else {
      uniformAt = (pts.find((p) => p.requested >= cross) ?? pts[pts.length - 1]).uniform
    }

    const x = xOf(cross)
    const y = yOf(uniformAt)
    // The crossing is late on this curve by construction, so a start-anchored
    // label runs off the right edge and the SVG clips it mid-sentence. Flip
    // the text to the left of the leader once past mid-plot.
    const rightHalf = x > (PAD.left + width - PAD.right) / 2
    annotations.push({
      x: rightHalf ? x - 10 : x + 10,
      y: y - 26,
      anchor: rightHalf ? 'end' : 'start',
      // Names the crossing explicitly. This is the chart's finding, not a
      // caption on it: the two strategies swap places here.
      text: `crossover — uniform grid takes the lead at ~${cross} nodes`,
      // A leader line, not a nudged label: the two lines converge here, and
      // stacking labels detaches them from the marks they describe.
      leader: { x1: x, y1: y, x2: rightHalf ? x - 8 : x + 8, y2: y - 20 },
    })
  }

  return {
    width, height, pad: PAD, series, axes,
    legend: series.map((s) => ({ label: s.label, color: s.color })),
    annotations,
    table: pts.map((p) => ({
      nodes: p.scored,
      pyra: pct(p.pyra),
      uniform: pct(p.uniform),
      delta: signedPP(p.deltaPP),
    })),
    xOf, yOf,
  }
}
