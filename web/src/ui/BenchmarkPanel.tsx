import { PALETTE } from '../theme/palette'
import { LABEL, SIZE } from '../theme/type'
import { useModelStore } from '../state/useModelStore'
import { CoverageBudgetChart } from './CoverageBudgetChart'
import { HeroFigure, KpiRow, StatTile } from './StatTile'
import {
  benchmarkSentence, coverageSentence, seedSentence, triangulationSentence,
  doubleCoverageSentence,
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
  const { result, benchmark, triangulation, doubleCoverage } = useModelStore()
  if (!result || !benchmark || benchmark.points.length === 0) return null

  const at = benchmark.atBudget
  const seedNote = seedSentence(result.seedTiesAtMax)

  return (
    <section style={{
      position: 'absolute', right: 16, top: 16, width: 520, padding: 16,
      background: PALETTE.surface, color: PALETTE.ink,
      border: `1px solid ${PALETTE.surfaceRaised}`, borderRadius: 8,
      fontSize: SIZE.small, lineHeight: 1.55, zIndex: 10,
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
        margin: '18px 0 4px', ...LABEL, color: PALETTE.chart.inkMuted,
      }}>
        Risk-weighted coverage against tower budget
      </h3>
      <CoverageBudgetChart result={benchmark} />

      <p style={{ color: PALETTE.chart.inkMuted, fontSize: SIZE.small, marginTop: 10, lineHeight: 1.6 }}>
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
            margin: '12px 0 4px', ...LABEL, color: PALETTE.chart.inkMuted,
          }}>
            The same network, scored on two towers instead of one
          </h3>
          <KpiRow>
            {/* Both tiles are at the CAPPED realised count, which is smaller
                than the run's own tower count whenever the grid cannot place
                as many as it was asked for. Saying which count each number
                belongs to is the difference between a comparison and a
                sleight of hand — the tuned pair below is at the full count. */}
            <StatTile label="Triangulated"
              value={`${(100 * triangulation.atBudget.pyra).toFixed(1)}%`}
              note={`within range of two towers, at ${
                triangulation.atBudget.scored} towers`} />
            <StatTile label="Uniform grid, same rule"
              value={`${(100 * triangulation.atBudget.uniform).toFixed(1)}%`}
              note={`same ${triangulation.atBudget.scored}; risk-driven leads by ${
                Math.abs(triangulation.atBudget.deltaPP).toFixed(1)} pp`} />
          </KpiRow>
          <p style={{ color: PALETTE.chart.inkMuted, fontSize: SIZE.small, marginTop: 8, lineHeight: 1.6 }}>
            {triangulationSentence(benchmark, triangulation)}
          </p>
          {doubleCoverage && (
            <>
              <KpiRow>
                <StatTile label="Tuned for two towers"
                  value={`${(100 * doubleCoverage.tunedDouble).toFixed(1)}%`}
                  note={`up from ${(100 * doubleCoverage.siteDouble).toFixed(1)}% at the same ${
                    doubleCoverage.nodeCount} towers`} />
                <StatTile label="What it costs"
                  value={`−${(100 * (doubleCoverage.siteSingle - doubleCoverage.tunedSingle)).toFixed(1)} pp`}
                  note="single coverage given up to get it" />
              </KpiRow>
              <p style={{ color: PALETTE.chart.inkMuted, fontSize: SIZE.small, marginTop: 8, lineHeight: 1.6 }}>
                {doubleCoverageSentence(doubleCoverage)}
              </p>
            </>
          )}
        </div>
      )}
      {seedNote && (
        <p style={{ color: PALETTE.chart.inkMuted, fontSize: SIZE.small, lineHeight: 1.6 }}>{seedNote}</p>
      )}
    </section>
  )
}
