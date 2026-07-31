import { describe, it, expect } from 'vitest'
import { buildChartModel } from '../src/ui/chartModel'
import { PALETTE } from '../src/theme/palette'
import type { BenchmarkResult } from '../src/lib/benchmark'

function fakeResult(): BenchmarkResult {
  const points = [
    { requested: 10, scored: 9, pyra: 0.026, uniform: 0.023, deltaPP: 0.3 },
    { requested: 100, scored: 92, pyra: 0.253, uniform: 0.223, deltaPP: 3.0 },
    { requested: 170, scored: 157, pyra: 0.414, uniform: 0.378, deltaPP: 3.6 },
    { requested: 300, scored: 274, pyra: 0.655, uniform: 0.672, deltaPP: -1.7 },
    { requested: 572, scored: 526, pyra: 0.928, uniform: 0.969, deltaPP: -4.2 },
  ]
  return {
    points,
    atBudget: points[4],
    bestMargin: points[2],
    crossoverNodes: 300,
    crossoverBracket: [170, 300],
    strideKm: 0.36608429859016334,
    demandCount: 31045,
    detectKm: 2,
  }
}

describe('buildChartModel', () => {
  const m = buildChartModel(fakeResult(), 640, 320)

  it('has exactly one y-axis and one x-axis — never a dual axis', () => {
    expect(m.axes.filter((a) => a.orientation === 'y')).toHaveLength(1)
    expect(m.axes.filter((a) => a.orientation === 'x')).toHaveLength(1)
  })

  it('assigns colour by the job each series does', () => {
    const pyra = m.series.find((s) => s.key === 'pyra')!
    const uniform = m.series.find((s) => s.key === 'uniform')!
    expect(pyra.color).toBe(PALETTE.series.pyra)
    expect(uniform.color).toBe(PALETTE.series.baseline)
  })

  it('keeps the risk-driven series teal even where it is losing', () => {
    // Colour follows the entity, never its rank. A model that recoloured the
    // leader would repaint the chart halfway along the x-axis — so assert that
    // the series which is BEHIND at the last point still wears the accent, and
    // that the one ahead still wears the de-emphasis grey. (Asserting only
    // `pyra.color === series.pyra` duplicates the test above and cannot fail
    // for any mutation that one survives.)
    const pyra = m.series.find((s) => s.key === 'pyra')!
    const uniform = m.series.find((s) => s.key === 'uniform')!
    const lastPyra = pyra.points[pyra.points.length - 1]
    const lastUniform = uniform.points[uniform.points.length - 1]
    expect(lastPyra.datum.pyra).toBeLessThan(lastUniform.datum.uniform)
    expect(pyra.color).toBe(PALETTE.series.pyra)
    expect(uniform.color).toBe(PALETTE.series.baseline)
  })

  it('spaces the x-axis logarithmically, not linearly', () => {
    // The module's central layout decision, and nothing else pinned it: a
    // silent switch to a linear scale passes every monotonicity assertion.
    // Equal ratios must map to equal pixel distances.
    const d1 = m.xOf(100) - m.xOf(10)
    const d2 = m.xOf(500) - m.xOf(50)
    expect(d1).toBeCloseTo(d2, 6)
    // ...and a linear scale would not do that.
    expect(m.xOf(300) - m.xOf(200)).toBeLessThan(m.xOf(30) - m.xOf(20) + 1e-6)
  })

  it('carries a legend for both series — the waived colour checks require it', () => {
    expect(m.legend).toHaveLength(2)
    expect(m.legend.map((l) => l.color).sort())
      .toEqual([PALETTE.series.baseline, PALETTE.series.pyra].sort())
    for (const l of m.legend) expect(l.label.length).toBeGreaterThan(3)
  })

  it('direct-labels both line ends and nothing else', () => {
    for (const s of m.series) {
      expect(s.endLabel.text).toMatch(/%$/)
      expect(s.endLabel.x).toBeCloseTo(s.points[s.points.length - 1].x, 6)
    }
  })

  it('names the series in its end label, not just the value', () => {
    // The legend maps name to a colour swatch, which is itself a colour cue.
    // With two colour checks waived, a reader who cannot separate the hues
    // needs the line to say what it is at the point they are reading.
    const pyra = m.series.find((s) => s.key === 'pyra')!
    const uniform = m.series.find((s) => s.key === 'uniform')!
    expect(pyra.endLabel.text.toLowerCase()).toContain('risk-driven')
    expect(uniform.endLabel.text.toLowerCase()).toContain('uniform')
  })

  it('separates end labels that would otherwise read as one block', () => {
    // 92.8% and 96.9% are ~11 units apart at this height — closer than the
    // label leading. The marks stay on the data; only the text moves.
    const [a, b] = m.series
    expect(Math.abs(a.endLabel.y - b.endLabel.y)).toBeGreaterThanOrEqual(12)
    const lastA = a.points[a.points.length - 1]
    const lastB = b.points[b.points.length - 1]
    expect(Math.abs(lastA.y - lastB.y)).toBeLessThan(12)
  })

  it('maps coverage monotonically down the y-axis and pins the ends', () => {
    expect(m.yOf(0)).toBeGreaterThan(m.yOf(1))
    expect(m.yOf(1)).toBeCloseTo(m.pad.top, 6)
    expect(m.yOf(0)).toBeCloseTo(m.height - m.pad.bottom, 6)
  })

  it('maps the node budget monotonically across the x-axis', () => {
    expect(m.xOf(10)).toBeLessThan(m.xOf(572))
    expect(m.xOf(10)).toBeCloseTo(m.pad.left, 6)
    expect(m.xOf(572)).toBeCloseTo(m.width - m.pad.right, 6)
  })

  it('emits one point per benchmark point per series, in budget order', () => {
    for (const s of m.series) {
      expect(s.points).toHaveLength(5)
      for (let i = 1; i < s.points.length; i++) {
        expect(s.points[i].x).toBeGreaterThan(s.points[i - 1].x)
      }
      expect(s.path.startsWith('M')).toBe(true)
      expect((s.path.match(/L/g) ?? []).length).toBe(4)
    }
  })

  it('annotates the crossover with a leader line, not a stacked label', () => {
    expect(m.annotations).toHaveLength(1)
    const a = m.annotations[0]
    expect(a.text.toLowerCase()).toContain('cross')
    expect(a.text).toContain('300')
    expect(a.leader.x1).not.toBe(a.leader.x2)
  })

  it('points the leader at the curve when the crossover falls between samples', () => {
    // The real crossover is bisected, so it is almost never a plotted budget:
    // 285 sits between the 170 and 300 samples here. Taking y from the nearest
    // plotted point put the leader tip ~30 units above both curves, pointing at
    // empty plot — the chart's headline finding annotating nothing.
    const r = fakeResult()
    const m2 = buildChartModel(
      { ...r, crossoverNodes: 285, crossoverBracket: [170, 300] }, 640, 320,
    )
    const a = m2.annotations[0]
    const yLo = m2.yOf(0.378)   // uniform at 170
    const yHi = m2.yOf(0.672)   // uniform at 300
    // The tip must sit between the two bracketing uniform values, not outside.
    expect(a.leader.y1).toBeLessThan(yLo)
    expect(a.leader.y1).toBeGreaterThan(yHi)
    expect(a.leader.x1).toBeCloseTo(m2.xOf(285), 6)
  })

  it('keeps a late crossover label inside the plot instead of clipping it', () => {
    // The crossing is late on this curve by construction, so a start-anchored
    // label runs past the viewBox and the SVG clips it mid-sentence.
    const a = m.annotations[0]
    expect(a.anchor).toBe('end')
    expect(a.x).toBeLessThanOrEqual(m.width - m.pad.right)
    expect(a.x).toBeGreaterThan(m.pad.left)
  })

  it('anchors an early crossover the other way', () => {
    const r = fakeResult()
    const m2 = buildChartModel(
      { ...r, crossoverNodes: 12, crossoverBracket: [10, 100] }, 640, 320,
    )
    expect(m2.annotations[0].anchor).toBe('start')
  })

  it('omits the crossover annotation when the arms never cross', () => {
    const r = fakeResult()
    const m2 = buildChartModel({ ...r, crossoverNodes: null }, 640, 320)
    expect(m2.annotations).toHaveLength(0)
  })

  it('carries a table view of every plotted value', () => {
    expect(m.table).toHaveLength(5)
    expect(m.table[0]).toEqual({
      nodes: 9, pyra: '2.6%', uniform: '2.3%', delta: '+0.3 pp',
    })
    expect(m.table[4].delta).toBe('-4.2 pp')
  })

  it('reports the realised node count in the table, not the requested one', () => {
    // "Both arms capped to the same realised count" is the claim; the table
    // has to show the number that was actually scored.
    expect(m.table.map((r) => r.nodes)).toEqual([9, 92, 157, 274, 526])
  })

  it('uses round y ticks and no more than six of them', () => {
    const y = m.axes.find((a) => a.orientation === 'y')!
    expect(y.ticks.length).toBeGreaterThan(2)
    expect(y.ticks.length).toBeLessThanOrEqual(6)
    for (const t of y.ticks) expect(t.label).toMatch(/^\d{1,3}%$/)
  })

  it('anchors the y-axis at zero rather than framing the data', () => {
    // An auto-scaled axis starting near 0.9 would turn a 4-point difference
    // into a visual chasm — the single most common way a true chart lies.
    const y = m.axes.find((a) => a.orientation === 'y')!
    expect(y.ticks[0].value).toBe(0)
    expect(y.ticks[y.ticks.length - 1].value).toBe(1)
  })

  it('survives an empty curve without inventing a chart', () => {
    const empty = buildChartModel({
      ...fakeResult(), points: [], crossoverNodes: null, crossoverBracket: null,
    }, 640, 320)
    expect(empty.series).toEqual([])
    expect(empty.legend).toEqual([])
    expect(empty.table).toEqual([])
    expect(empty.annotations).toEqual([])
  })
})
