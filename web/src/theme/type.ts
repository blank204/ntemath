/**
 * Single source of truth for type, alongside palette.ts for colour.
 *
 * THE CHOICE, AND WHY. IBM Plex was commissioned for a technology company's
 * engineering documentation, and that is what this page is — documentation
 * that happens to be persuasive. Condensed carries the headlines because a
 * 30 m mast and a 314 km box are both tall, narrow subjects; the regular sans
 * carries argument; and the mono carries every number on the site.
 *
 * NUMBERS ARE THE PRODUCT. A p-value, a coverage percentage, a flash-to-bang
 * clock and a tower count are the whole claim, so they are all set in mono
 * with tabular figures — the digits line up in columns and stop jittering
 * when a running clock changes. Prose is never mono; data is never not.
 *
 * The rule matches the palette's: nothing outside this file names a font
 * family, and a test enforces it.
 */

export const TYPE = {
  /** Headlines and the wordmark. Used with restraint. */
  display: "'IBM Plex Sans Condensed', 'Segoe UI Semibold', system-ui, sans-serif",
  /** Running text. */
  body: "'IBM Plex Sans', system-ui, 'Segoe UI', sans-serif",
  /** Every number, label, axis tick and readout. */
  mono: "'IBM Plex Mono', ui-monospace, Consolas, monospace",
} as const

/**
 * Figures that do not jitter. Applied wherever a number can change in
 * place — the flash-to-bang clock, coverage percentages under a slider,
 * anything recomputed on a run.
 */
export const TABULAR = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum" 1, "zero" 1',
} as const

/**
 * The scale. Six steps, and no others: a page that reaches for a seventh
 * size is a page that has stopped having a system.
 */
export const SIZE = {
  hero: 46,
  headline: 30,
  subhead: 19,
  body: 15,
  small: 12.5,
  micro: 11,
} as const

export const WEIGHT = { regular: 400, medium: 500, semibold: 600 } as const

/**
 * Tracking. Mono labels are set in caps at small sizes, where letterforms
 * crowd; the display face is set tight, because condensed headlines already
 * have their own rhythm and default tracking loosens it.
 */
export const TRACK = {
  // 0.11em, not 0.14: the widest labels here run to forty characters
  // ("head to head, at the same realised tower count") and looser tracking
  // turned them into a line of scattered letters rather than a caption.
  label: '0.11em',
  display: '-0.015em',
  none: '0',
} as const

/** The measurement chip above every Rail beat and every stat tile. */
export const LABEL = {
  fontFamily: TYPE.mono,
  fontSize: SIZE.micro,
  fontWeight: WEIGHT.medium,
  letterSpacing: TRACK.label,
  textTransform: 'uppercase',
} as const
