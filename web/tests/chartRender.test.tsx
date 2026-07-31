import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CoverageBudgetChart, ChartTable } from '../src/ui/CoverageBudgetChart'
import { buildChartModel } from '../src/ui/chartModel'
import type { BenchmarkResult } from '../src/lib/benchmark'

const points = [
  { requested: 10, scored: 9, pyra: 0.026, uniform: 0.023, deltaPP: 0.3 },
  { requested: 100, scored: 92, pyra: 0.253, uniform: 0.223, deltaPP: 3.0 },
  { requested: 170, scored: 157, pyra: 0.414, uniform: 0.378, deltaPP: 3.6 },
  { requested: 300, scored: 274, pyra: 0.655, uniform: 0.672, deltaPP: -1.7 },
  { requested: 572, scored: 526, pyra: 0.928, uniform: 0.969, deltaPP: -4.2 },
]
const result: BenchmarkResult = {
  points,
  atBudget: points[4],
  bestMargin: points[2],
  crossoverNodes: 285,
  crossoverBracket: [170, 300],
  strideKm: 0.36608429859016334,
  demandCount: 31045,
  detectKm: 2,
}

/**
 * docs/palette-validation.md waives two of the dataviz validator's colour
 * checks and states the price: "every chart using these two series must carry
 * a legend, direct labels on both series, and a table view."
 *
 * chartModel.test.ts checks the MODEL carries the data for all three, which is
 * not the same claim — deleting the legend div, the end-label <text> nodes and
 * the whole table from the component left every model test passing. These
 * assertions are the ones that make the waiver's sentence true.
 */
describe('CoverageBudgetChart pays for the palette waiver', () => {
  const html = renderToStaticMarkup(<CoverageBudgetChart result={result} />)

  it('renders a legend naming both series', () => {
    expect(html).toContain('Risk-driven placement')
    expect(html).toContain('Uniform grid')
  })

  it('renders a direct label at both line ends, each naming its series', () => {
    expect(html).toContain('Risk-driven 92.8%')
    expect(html).toContain('Uniform 96.9%')
  })

  it('offers the table view, and labels the toggle for assistive tech', () => {
    expect(html).toContain('Table view')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="coverage-budget-table"')
  })

  it('names both axes, and says the x-axis is logarithmic', () => {
    expect(html).toContain('risk-weighted coverage')
    expect(html).toContain('log scale')
  })

  it('annotates the crossover in the rendered output', () => {
    expect(html).toContain('285')
    expect(html.toLowerCase()).toContain('crossover')
  })

  it('renders nothing at all for an empty curve', () => {
    const empty = renderToStaticMarkup(
      <CoverageBudgetChart result={{ ...result, points: [], crossoverNodes: null }} />,
    )
    expect(empty).toBe('')
  })
})

describe('ChartTable', () => {
  it('renders one row per plotted point, reporting the realised count', () => {
    const m = buildChartModel(result)
    const html = renderToStaticMarkup(<ChartTable rows={m.table} />)
    const rows = html.match(/<tr/g) ?? []
    expect(rows.length).toBe(m.table.length + 1)   // + the header row
    for (const r of m.table) expect(html).toContain(`>${r.nodes}<`)
    // 526 is the realised count at the 572 budget — the number the fairness
    // claim is about.
    expect(html).toContain('>526<')
    expect(html).not.toContain('>572<')
  })
})
