import { useState } from 'react'
import { PALETTE } from '../theme/palette'
import { LABEL, SIZE, TABULAR } from '../theme/type'
import { buildChartModel } from './chartModel'
import type { BenchmarkResult } from '../lib/benchmark'

/**
 * Two lines, one y-axis, a legend, direct end labels, a hover layer, and a
 * table view behind a toggle. Every one of those is required rather than
 * chosen: the legend and the table are what pay for the two waived palette
 * checks recorded in docs/palette-validation.md.
 */
/**
 * The table view, split out so it can be rendered and asserted on its own.
 * It is not optional decoration: with two colour checks waived, this is the
 * only fully colour-free path to every plotted number, and the hover tooltip
 * (pointer-only) does not substitute for it.
 */
export function ChartTable({ rows }: {
  rows: Array<{ nodes: number; pyra: string; uniform: string; delta: string }>
}) {
  const cell = { padding: '2px 8px' }
  return (
    <table style={{
      marginTop: 4, borderCollapse: 'collapse', ...TABULAR, fontSize: SIZE.micro,
      color: PALETTE.ink, fontVariantNumeric: 'tabular-nums',
    }}>
      <caption style={{
        captionSide: 'top', textAlign: 'left', ...LABEL,
        color: PALETTE.chart.inkMuted, paddingBottom: 2,
      }}>
        Risk-weighted coverage by realised tower count
      </caption>
      <thead>
        <tr style={{ color: PALETTE.chart.inkMuted, textAlign: 'right' }}>
          <th scope="col" style={cell}>towers</th>
          <th scope="col" style={cell}>risk-driven</th>
          <th scope="col" style={cell}>uniform grid</th>
          <th scope="col" style={cell}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.nodes} style={{ textAlign: 'right' }}>
            <td style={cell}>{r.nodes}</td>
            <td style={cell}>{r.pyra}</td>
            <td style={cell}>{r.uniform}</td>
            <td style={cell}>{r.delta}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function CoverageBudgetChart({ result, width = 488, height = 300 }: {
  result: BenchmarkResult; width?: number; height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  // Built at the size it will actually render at, so 10px text is 10px on
  // screen. A 640-wide viewBox squeezed into a 420px panel renders its labels
  // at ~6px, which is unreadable.
  const m = buildChartModel(result, width, height)
  if (m.series.length === 0) return null

  const yAxis = m.axes.find((a) => a.orientation === 'y')!
  const xAxis = m.axes.find((a) => a.orientation === 'x')!
  // Index into the PREVIOUS result's points if a run landed while the pointer
  // was inside the chart, so this must be looked up defensively rather than
  // dereferenced.
  const hoverPoint = hover === null ? null : m.series[0].points[hover] ?? null
  const hovered = hoverPoint?.datum ?? null

  return (
    <div>
      {/* Legend first: identity is never carried by colour alone. */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 4 }}>
        {m.legend.map((l) => (
          <span key={l.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: PALETTE.chart.inkMuted, fontSize: 11,
          }}>
            <span style={{
              width: 14, height: 2, borderRadius: 1, background: l.color,
            }} />
            {l.label}
          </span>
        ))}
      </div>

      <svg
        width="100%" viewBox={`0 0 ${m.width} ${m.height}`}
        role="img"
        aria-label={
          'Risk-weighted coverage against tower budget, for risk-driven ' +
          `placement and a uniform grid, over ${result.demandCount.toLocaleString()} ` +
          `demand points at a ${result.strideKm.toFixed(2)} km stride.`
        }
        onMouseLeave={() => setHover(null)}
      >
        {yAxis.ticks.map((t) => (
          <g key={t.value}>
            <line
              x1={m.pad.left} x2={m.width - m.pad.right} y1={t.pos} y2={t.pos}
              stroke={PALETTE.chart.grid} strokeWidth={1}
            />
            <text
              x={m.pad.left - 8} y={t.pos + 3} textAnchor="end"
              fill={PALETTE.chart.inkMuted} fontSize={10}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >{t.label}</text>
          </g>
        ))}
        {xAxis.ticks.map((t) => (
          <text
            key={t.value} x={t.pos} y={m.height - m.pad.bottom + 14}
            textAnchor="middle" fill={PALETTE.chart.inkMuted} fontSize={10}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >{t.label}</text>
        ))}
        {/* The x-axis plots and ticks the budget REQUESTED. The realised count
            both arms were scored on is smaller and differs per budget — it is
            in the tooltip and the table. Labelling this axis "realised" would
            show a tick reading 572 while the tooltip on it says 526. */}
        <text
          x={(m.pad.left + m.width - m.pad.right) / 2} y={m.height - 6}
          textAnchor="middle" fill={PALETTE.chart.inkMuted} fontSize={10}
        >tower budget requested (log scale)</text>
        <text
          x={12} y={(m.pad.top + m.height - m.pad.bottom) / 2}
          textAnchor="middle" fill={PALETTE.chart.inkMuted} fontSize={10}
          transform={`rotate(-90 12 ${(m.pad.top + m.height - m.pad.bottom) / 2})`}
        >risk-weighted coverage</text>

        {m.series.map((s) => (
          <path
            key={s.key} d={s.path} fill="none" stroke={s.color}
            strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          />
        ))}

        {/* End markers carry a 2px surface ring so they stay legible where
            the two lines cross. */}
        {m.series.map((s) => {
          const last = s.points[s.points.length - 1]
          return (
            <g key={`${s.key}-end`}>
              <circle
                cx={last.x} cy={last.y} r={4} fill={s.color}
                stroke={PALETTE.chart.surface} strokeWidth={2}
              />
              {/* The label sits at endLabel.y, which the model may have nudged
                  apart from the other series'; the marker stays on the data. */}
              <text
                x={last.x + 8} y={s.endLabel.y + 3} fill={PALETTE.ink} fontSize={10}
              >{s.endLabel.text}</text>
            </g>
          )
        })}

        {m.annotations.map((a) => (
          <g key={a.text}>
            <line
              x1={a.leader.x1} y1={a.leader.y1} x2={a.leader.x2} y2={a.leader.y2}
              stroke={PALETTE.chart.axis} strokeWidth={1}
            />
            <text
              x={a.x} y={a.y} textAnchor={a.anchor}
              fill={PALETTE.chart.inkMuted} fontSize={10}
            >
              {a.text}
            </text>
          </g>
        ))}

        {/* Hover layer: a full-height band per budget, so the hit target is far
            bigger than the 8px marks. */}
        {m.series[0].points.map((p, i) => (
          <rect
            key={p.datum.requested}
            x={p.x - 14} y={m.pad.top} width={28} height={m.height - m.pad.top - m.pad.bottom}
            fill="transparent" onMouseEnter={() => setHover(i)}
          />
        ))}
        {hoverPoint && (
          <line
            x1={hoverPoint.x} x2={hoverPoint.x}
            y1={m.pad.top} y2={m.height - m.pad.bottom}
            stroke={PALETTE.chart.axis} strokeWidth={1}
          />
        )}
      </svg>

      {hovered && (
        <div style={{ color: PALETTE.ink, fontSize: 11, marginTop: 2 }}>
          {hovered.scored} nodes · risk-driven {(100 * hovered.pyra).toFixed(1)}%
          {' · '}uniform {(100 * hovered.uniform).toFixed(1)}%
          {' · '}Δ {hovered.deltaPP >= 0 ? '+' : ''}{hovered.deltaPP.toFixed(1)} pp
        </div>
      )}

      <button
        onClick={() => setShowTable((v) => !v)}
        aria-expanded={showTable}
        aria-controls="coverage-budget-table"
        style={{
          marginTop: 6, background: 'transparent', color: PALETTE.chart.inkMuted,
          border: 0, font: 'inherit', fontSize: 11, cursor: 'pointer', padding: 0,
        }}
      >
        <span aria-hidden="true">{showTable ? '▾' : '▸'}</span> Table view
      </button>
      {showTable && (
        <div id="coverage-budget-table">
          <ChartTable rows={m.table} />
        </div>
      )}
    </div>
  )
}
