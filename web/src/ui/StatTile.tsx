import type { ReactNode } from 'react'
import { PALETTE } from '../theme/palette'
import { LABEL, SIZE, TABULAR, TYPE, WEIGHT } from '../theme/type'

/**
 * Stat tile: label, value, optional note. Per the dataviz skill's figure
 * contract — a handful of headline numbers is a KPI row, not a chart, and a
 * single number is never a one-bar bar chart.
 *
 * Values are mono with tabular figures, like every other number on the site:
 * these recompute on every run, and a proportional 1 next to a proportional 8
 * makes a row of tiles twitch as the sliders move.
 */
export function StatTile({ label, value, note }: {
  label: string; value: string; note?: string
}) {
  return (
    <div style={{
      background: PALETTE.surface, border: `1px solid ${PALETTE.surfaceRaised}`,
      borderRadius: 8, padding: '10px 12px', minWidth: 108,
    }}>
      <div style={{ ...LABEL, color: PALETTE.chart.inkMuted }}>{label}</div>
      <div style={{
        ...TABULAR, fontFamily: TYPE.mono, color: PALETTE.ink,
        fontSize: 22, fontWeight: WEIGHT.medium, marginTop: 3,
      }}>
        {value}
      </div>
      {note && (
        <div style={{
          color: PALETTE.chart.inkMuted, fontSize: SIZE.micro - 1,
          marginTop: 4, lineHeight: 1.45,
        }}>
          {note}
        </div>
      )}
    </div>
  )
}

/**
 * The one number the view leads with. Exactly one per view.
 *
 * Mono at 48px is a deliberate call: this is an instrument reading, not a
 * marketing figure, and setting it in the display face would make it the
 * loudest thing on a page whose loudest thing is supposed to be the map.
 */
export function HeroFigure({ label, value, note }: {
  label: string; value: string; note: string
}) {
  return (
    <div style={{ padding: '4px 0 10px' }}>
      <div style={{ ...LABEL, color: PALETTE.chart.inkMuted }}>{label}</div>
      <div style={{
        ...TABULAR, fontFamily: TYPE.mono, color: PALETTE.ink,
        fontSize: 48, fontWeight: WEIGHT.medium, lineHeight: 1.05, marginTop: 4,
      }}>
        {value}
      </div>
      <div style={{
        color: PALETTE.chart.inkMuted, fontSize: SIZE.small,
        marginTop: 6, lineHeight: 1.55,
      }}>
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
