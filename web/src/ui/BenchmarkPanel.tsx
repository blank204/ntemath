import { PALETTE } from '../theme/palette'
import { useModelStore } from '../state/useModelStore'
import { CoverageBudgetChart } from './CoverageBudgetChart'
import { HeroFigure, KpiRow, StatTile } from './StatTile'
import {
  benchmarkSentence, coverageSentence, seedSentence, triangulationSentence,
} from './copy'

/**
 * Benchmark A, presented as data rather than prose.
 *
 * One hero figure (the head-to-head margin at the budget on screen), a KPI row
 * of the numbers that are single values rather than distributions, and one
 * comparison chart. `areaFraction` and the set-cover reduction were both
 * computed by the model from the first run of Plan 1 and shown to nobody;
 * they are stat tiles now.
 */
export function BenchmarkPanel() {
  const { result, benchmark, triangulation } = useModelStore()
  if (!result || !benchmark || benchmark.points.length === 0) return null

  const at = benchmark.atBudget
  const seedNote = seedSentence(result.seedTiesAtMax)

  return (
    <section style={{
      position: 'absolute', right: 16, top: 16, width: 520, padding: 16,
      background: PALETTE.surface, color: PALETTE.ink,
      border: `1px solid ${PALETTE.surfaceRaised}`, borderRadius: 8,
      font: '13px/1.5 system-ui, sans-serif', zIndex: 10,
      maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
    }}>
      <HeroFigure
        label="Head to head, at the same realised tower count"
        value={`${at.deltaPP >= 0 ? '+' : '−'}${Math.abs(at.deltaPP).toFixed(1)} pp`}
        note={benchmarkSentence(benchmark)}
      />

      <KpiRow>
        <StatTile label="Towers" value={result.nodeCount.toLocaleString()}
          note={`from ${result.candidateCount.toLocaleString()} blue-noise candidates`} />
        <StatTile label="Set-cover saving" value={`${result.reductionPct.toFixed(0)}%`}
          note="hardware removed by the minimisation stage alone" />
        <StatTile label="Risk-weighted coverage"
          value={`${(100 * result.coveredFraction).toFixed(1)}%`}
          note={`${benchmark.strideKm.toFixed(2)} km stride`} />
        <StatTile label="Area covered"
          value={`${(100 * result.areaFraction).toFixed(1)}%`}
          note="same demand points, counted unweighted" />
      </KpiRow>

      <h3 style={{
        margin: '16px 0 2px', fontSize: 12, fontWeight: 600,
        color: PALETTE.chart.inkMuted, letterSpacing: 0.4,
      }}>
        Risk-weighted coverage against tower budget
      </h3>
      <CoverageBudgetChart result={benchmark} />

      <p style={{ color: PALETTE.chart.inkMuted, fontSize: 11, marginTop: 10 }}>
        {coverageSentence({
          coveredFraction: result.coveredFraction,
          strideKm: benchmark.strideKm,
          demandCount: benchmark.demandCount,
          detectKm: benchmark.detectKm,
        })}
      </p>
      {triangulation && triangulation.points.length > 0 && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${PALETTE.surfaceRaised}` }}>
          <h3 style={{
            margin: '10px 0 2px', fontSize: 12, fontWeight: 600,
            color: PALETTE.chart.inkMuted, letterSpacing: 0.4,
          }}>
            The same network, scored on two towers instead of one
          </h3>
          <KpiRow>
            <StatTile label="Triangulated"
              value={`${(100 * triangulation.atBudget.pyra).toFixed(1)}%`}
              note="demand within range of at least two towers" />
            <StatTile label="Uniform grid, same rule"
              value={`${(100 * triangulation.atBudget.uniform).toFixed(1)}%`}
              note={`risk-driven leads by ${
                Math.abs(triangulation.atBudget.deltaPP).toFixed(1)} pp here`} />
          </KpiRow>
          <p style={{ color: PALETTE.chart.inkMuted, fontSize: 11, marginTop: 8 }}>
            {triangulationSentence(benchmark, triangulation)}
          </p>
        </div>
      )}
      {seedNote && (
        <p style={{ color: PALETTE.chart.inkMuted, fontSize: 11 }}>{seedNote}</p>
      )}
    </section>
  )
}
