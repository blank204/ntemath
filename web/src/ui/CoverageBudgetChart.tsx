import { useState } from 'react'
import { PALETTE } from '../theme/palette'
import { buildChartModel } from './chartModel'
import type { BenchmarkResult } from '../lib/benchmark'

/**
 * Two lines, one y-axis, a legend, direct end labels, a hover layer, and a
 * table view behind a toggle. Every one of those is required rather than
 * chosen: the legend and the table are what pay for the two waived palette
 * checks recorded in docs/palette-validation.md.
 */
export function CoverageBudgetChart({ result }: { result: BenchmarkResult }) {
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const m = buildChartModel(result)
  if (m.series.length === 0) return null

  const yAxis = m.axes.find((a) => a.orientation === 'y')!
  const xAxis = m.axes.find((a) => a.orientation === 'x')!
  const hovered = hover === null ? null : m.series[0].points[hover]?.datum ?? null

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
          'Risk-weighted coverage against node budget, for risk-driven ' +
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
        <text
          x={(m.pad.left + m.width - m.pad.right) / 2} y={m.height - 4}
          textAnchor="middle" fill={PALETTE.chart.inkMuted} fontSize={10}
        >nodes (both arms, realised)</text>

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
              <text
                x={last.x + 8} y={last.y + 3} fill={PALETTE.ink} fontSize={11}
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
            <text x={a.x} y={a.y} fill={PALETTE.chart.inkMuted} fontSize={10}>
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
        {hover !== null && (
          <line
            x1={m.series[0].points[hover].x} x2={m.series[0].points[hover].x}
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
        style={{
          marginTop: 6, background: 'transparent', color: PALETTE.chart.inkMuted,
          border: 0, font: 'inherit', fontSize: 11, cursor: 'pointer', padding: 0,
        }}
      >
        {showTable ? '▾' : '▸'} Table view
      </button>
      {showTable && (
        <table style={{
          marginTop: 4, borderCollapse: 'collapse', fontSize: 11,
          color: PALETTE.ink, fontVariantNumeric: 'tabular-nums',
        }}>
          <thead>
            <tr style={{ color: PALETTE.chart.inkMuted, textAlign: 'right' }}>
              <th style={{ padding: '2px 8px' }}>nodes</th>
              <th style={{ padding: '2px 8px' }}>risk-driven</th>
              <th style={{ padding: '2px 8px' }}>uniform grid</th>
              <th style={{ padding: '2px 8px' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {m.table.map((r) => (
              <tr key={r.nodes} style={{ textAlign: 'right' }}>
                <td style={{ padding: '2px 8px' }}>{r.nodes}</td>
                <td style={{ padding: '2px 8px' }}>{r.pyra}</td>
                <td style={{ padding: '2px 8px' }}>{r.uniform}</td>
                <td style={{ padding: '2px 8px' }}>{r.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
