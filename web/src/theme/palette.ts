/**
 * Single source of truth for colour.
 *
 * THE WORLD IS A NIGHT STORM OVER JAMES BAY, and the page is that world rather
 * than a dark surface with line work on it. The field is a lit indigo — deep at
 * the edges, brighter where the cloud is lit from inside — because a flat
 * near-black void with one bright accent on it is what the first visual pass
 * did, and it read as neon rather than as weather.
 *
 * THE GOVERNING RULE, UNCHANGED: `ember` means fire. It may only be used for
 * fire, heat and alert states, and it appears once or twice per screen — never
 * as line work, never as UI chrome, never as a data series. Spending the fire
 * signal on a border is how the old page stopped being able to say anything
 * with orange at all.
 *
 * `signal` carries the network, the Pyra series and every interactive accent;
 * `control` carries the uniform-grid comparison.
 */
export const PALETTE = {
  /** The deep edge of the field. Indigo, not black — nothing here is a void. */
  canvas: '#070E24',
  /** Where the cloud is lit from within. The field ramps canvas → fieldLit. */
  fieldLit: '#16255C',
  /** Panels, and the chart surface. */
  surface: '#111C3E',
  /** Hairlines, grid, and every rule on the page. */
  surfaceRaised: '#1E2E5E',
  /** Lightning white, with the blue cast it has against an indigo field. */
  ink: '#E8F0FF',
  inkMuted: '#8CA0CE',

  /** RESERVED: fire, heat, alert. Nothing else, and never as line work. */
  ember: '#FF6A2B',

  /** Network links, telemetry, nodes, the Pyra series, interactive accents. */
  signal: '#2696E4',

  /** The uniform-grid comparison series. */
  control: '#AB437B',

  /** RESERVED: fire, heat, alert. Nothing else. */
  heat: ['#5A1400', '#C43A05', '#FF6A2B', '#FFA95C', '#FFE2C2'],

  /**
   * Sequential magnitude ramp for the risk raster — a filled field, which is
   * why a warm ramp here does not compete with `ember`'s line-level fire
   * signal. One hue (OKLCH H65), monotone lightness, ΔL 0.10 per step.
   *
   * Validated as an ordinal ramp, not a categorical one:
   *   node scripts/validate_palette.js "#644E38,#896745,#B08153,#D0A071,#E7C3A2" \
   *     --mode dark --surface "#111C3E" --ordinal      → ALL CHECKS PASS
   *
   * The floor is L 0.44 rather than something darker because the dark-mode
   * light-end check measures the *darkest* step against the surface, and a
   * ramp starting below L 0.42 disappears into the field.
   */
  riskRamp: ['#644E38', '#896745', '#B08153', '#D0A071', '#E7C3A2'],

  /**
   * Data-series slots, addressed by the job each one does.
   *
   * Chart code asks for `series.pyra`, never for a hue, so a series can never
   * be recoloured by its rank or by which filter is active.
   *
   * THIS PAIR CARRIES NO WAIVER. The old teal/grey pair was waived on the dark
   * lightness band and the chroma floor; docs/palette-validation.md records why
   * that waiver was retired rather than reissued. Both slots now clear every
   * computable check:
   *
   *   node scripts/validate_palette.js "#2696E4,#AB437B" --mode dark \
   *     --surface "#111C3E"                            → ALL CHECKS PASS
   *
   * Equal chroma and near-equal weight is deliberate, and it is a claim about
   * the science rather than a style choice: the uniform grid is not a strawman.
   * It takes the lead above 88 towers on single coverage and both columns ship.
   * A comparison that can win is drawn as a peer.
   */
  series: {
    pyra: '#2696E4',        // === signal
    baseline: '#AB437B',    // === control
  },

  /** Chart chrome. Recessive by construction: one step off the surface. */
  chart: {
    surface: '#111C3E',     // === surface
    grid: '#1E2E5E',        // === surfaceRaised
    axis: '#2F447F',
    inkMuted: '#8CA0CE',    // === inkMuted
  },
} as const
