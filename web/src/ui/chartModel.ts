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

const PAD = { top: 18, right: 72, bottom: 34, left: 46 }
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
    key: 'pyra' | 'uniform', label: string, color: string,
    pick: (p: BenchmarkPoint) => number,
  ): ChartSeries => {
    const points = pts.map((p) => ({ x: xOf(p.requested), y: yOf(pick(p)), datum: p }))
    const path = points
      .map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`)
      .join(' ')
    const last = points[points.length - 1]
    return {
      key, label, color, path, points,
      endLabel: last
        ? { x: last.x, y: last.y, text: pct(pick(last.datum)) }
        : { x: PAD.left, y: PAD.top, text: '0.0%' },
    }
  }

  const series: ChartSeries[] = pts.length
    ? [
        build('pyra', 'Risk-driven placement', PALETTE.series.pyra, (p) => p.pyra),
        build('uniform', 'Uniform grid', PALETTE.series.baseline, (p) => p.uniform),
      ]
    : []

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) => ({
    value: v, pos: yOf(v), label: `${Math.round(v * 100)}%`,
  }))
  const xTickValues = pts.length
    ? Array.from(new Set([nMin, ...pts.map((p) => p.requested)]))
        .filter((_, i, a) => i === 0 || i === a.length - 1 || i % 3 === 0)
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
    const at = pts.find((p) => p.requested >= cross) ?? pts[pts.length - 1]
    const x = xOf(cross)
    const y = yOf(at.uniform)
    annotations.push({
      x: x + 10,
      y: y - 26,
      // Names the crossing explicitly. This is the chart's finding, not a
      // caption on it: the two strategies swap places here.
      text: `crossover — uniform grid takes the lead at ~${cross} nodes`,
      // A leader line, not a nudged label: the two lines converge here, and
      // stacking labels detaches them from the marks they describe.
      leader: { x1: x, y1: y, x2: x + 8, y2: y - 20 },
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
