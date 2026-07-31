/**
 * Single source of truth for type, alongside palette.ts for colour.
 *
 * THE CHOICE, AND WHY. IBM Plex was commissioned for a technology company's
 * engineering documentation, and documentation is exactly what the first
 * visual pass read as — which was the rejection. The replacement is set by
 * what this page actually is: a field instrument at night. An instrument has
 * two voices, a reading and the label under it, and it has them at wildly
 * different sizes.
 *
 *   display — Anybody, a variable techno grotesque with a 50–150% width axis.
 *             Run WIDE (135%) it gives the giant figures their own presence at
 *             150px without turning into a logo, and it crops legibly, which
 *             matters because the pinned headline is cut in half by the split.
 *   mono    — Martian Mono, a wide monospace with a slashed zero and a 75–112%
 *             width axis. Every label and every number on the site. Run
 *             slightly NARROW (87.5%) for labels, because the longest caption
 *             here runs to forty characters and a wide mono would break it.
 *   body    — Instrument Sans. Prose only: end matter, the Lab, /assumptions.
 *             The Rail has almost none left, and that is the point.
 *
 * NUMBERS ARE THE PRODUCT. A p-value, a coverage percentage, a flash-to-bang
 * clock and a tower count are the whole claim. Small numbers are set in mono
 * with tabular figures so they stop jittering when they recompute; the one
 * number a beat is *about* is promoted to `SIZE.figure` in the display face,
 * where it stops being a statistic in a sentence and becomes the content.
 *
 * The rule matches the palette's: nothing outside this file names a font
 * family, and a test enforces it.
 */

export const TYPE = {
  /** The giant figures, the pinned headline, the wordmark. */
  display: "'Anybody Variable', 'Segoe UI Semibold', system-ui, sans-serif",
  /** Running prose. End matter and the Lab; the Rail barely uses it. */
  body: "'Instrument Sans Variable', system-ui, 'Segoe UI', sans-serif",
  /** Every label, every axis tick, every readout, every small number. */
  mono: "'Martian Mono Variable', ui-monospace, Consolas, monospace",
} as const

/**
 * The width axis, which is half of why these faces were chosen.
 *
 * `font-stretch` is the CSS property that drives `wdth` on a variable font.
 * Named here rather than inline for the same reason families are: a width
 * typed into a component is a width nobody can retune.
 */
export const WIDTH = {
  /** Figures and the pinned headline. Anybody at 135 of 150. */
  displayWide: '135%',
  /** Mono labels. Martian at 87.5 of 112.5, so long captions still fit. */
  labelNarrow: '87.5%',
  /** Mono set as running text — readouts, source lines. */
  mono: '100%',
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
 * The scale. Six steps, and no others: a page that reaches for a seventh size
 * is a page that has stopped having a system.
 *
 * `figure` and `hero` are the two big ones and they are big on purpose — the
 * reference sites both put one object or one number at a size the frame cannot
 * contain. These are the ceilings; components clamp down from them so the
 * ratio survives a 390px window.
 */
export const SIZE = {
  /** The one number a beat is about. Cropped by nothing; it is the content. */
  figure: 148,
  /** The pinned headline, set to be cut in half by the split. */
  hero: 96,
  headline: 26,
  body: 15,
  small: 12.5,
  micro: 11,
} as const

export const WEIGHT = { regular: 400, medium: 500, semibold: 600 } as const

/**
 * Tracking. Mono labels are set in caps at small sizes, where letterforms
 * crowd; the display face is set tight, because a figure at 148px opens up on
 * its own and default tracking makes it drift apart.
 */
export const TRACK = {
  // 0.11em, not 0.14: the widest labels here run to forty characters and
  // looser tracking turned them into a line of scattered letters rather than
  // a caption.
  label: '0.11em',
  display: '-0.02em',
  none: '0',
} as const

/** The measurement chip above every Rail beat and every stat tile. */
export const LABEL = {
  fontFamily: TYPE.mono,
  fontSize: SIZE.micro,
  fontWeight: WEIGHT.medium,
  fontStretch: WIDTH.labelNarrow,
  letterSpacing: TRACK.label,
  textTransform: 'uppercase',
} as const

/** The giant figure. One per beat, one per stat tile, never twice in a row. */
export const FIGURE = {
  fontFamily: TYPE.display,
  fontWeight: WEIGHT.medium,
  fontStretch: WIDTH.displayWide,
  letterSpacing: TRACK.display,
  lineHeight: 0.86,
  ...TABULAR,
} as const
