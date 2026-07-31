import type { ReactNode } from 'react'
import { PALETTE } from '../theme/palette'

/**
 * Stat tile: label, value, optional note. Per the dataviz skill's figure
 * contract — a handful of headline numbers is a KPI row, not a chart, and a
 * single number is never a one-bar bar chart.
 *
 * Values use the font's default proportional figures. `tabular-nums` is for
 * columns that must align vertically (the chart's table view), not for large
 * standalone numbers, where it makes short values look loose.
 */
export function StatTile({ label, value, note }: {
  label: string; value: string; note?: string
}) {
  return (
    <div style={{
      background: PALETTE.surface, border: `1px solid ${PALETTE.surfaceRaised}`,
      borderRadius: 8, padding: '10px 12px', minWidth: 108,
    }}>
      <div style={{ color: PALETTE.chart.inkMuted, fontSize: 11, letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ color: PALETTE.ink, fontSize: 22, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
      {note && (
        <div style={{ color: PALETTE.chart.inkMuted, fontSize: 10, marginTop: 3, lineHeight: 1.4 }}>
          {note}
        </div>
      )}
    </div>
  )
}

/**
 * The one number the view leads with. Exactly one per view, >= 48px, in the
 * same sans as everything else — a display face here reads as decoration.
 */
export function HeroFigure({ label, value, note }: {
  label: string; value: string; note: string
}) {
  return (
    <div style={{ padding: '4px 0 10px' }}>
      <div style={{ color: PALETTE.chart.inkMuted, fontSize: 11, letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ color: PALETTE.ink, fontSize: 48, fontWeight: 600, lineHeight: 1.05 }}>
        {value}
      </div>
      <div style={{ color: PALETTE.chart.inkMuted, fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
        {note}
      </div>
    </div>
  )
}

export function KpiRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      {children}
    </div>
  )
}
