/**
 * Single source of truth for colour.
 *
 * The governing rule: green and black are the world, orange means fire.
 * `heat` is reserved — it may only be used for fire, heat and alert states,
 * never as a data series colour. `meshTeal` carries the network and all
 * Pyra-series data; `baselineGray` carries comparison baselines.
 */
export const PALETTE = {
  canvas: '#060706',
  surface: '#0E1F16',
  surfaceRaised: '#1B3B29',
  ink: '#F2EFE6',

  /** Wordmark only. Never UI chrome — that would spend the fire signal. */
  brandOrange: '#FF6B1A',

  /** Network links, telemetry, nodes, and the Pyra data series. */
  meshTeal: '#4DE1C1',

  /** Uniform-grid comparison series. */
  baselineGray: '#8A9691',

  /** RESERVED: fire, heat, alert. Nothing else. */
  heat: ['#7A1B00', '#E03A00', '#FF8A00', '#FFD166', '#FFF3D6'],

  /** Sequential magnitude ramp for the risk raster. Deliberately low-chroma. */
  riskRamp: ['#2A2A22', '#4A4433', '#6E6144', '#958054', '#BFA06A'],

  /**
   * Data-series slots, addressed by the job each one does.
   *
   * This is the dataviz skill's EMPHASIS form, not a categorical palette: one
   * accent carrying the system, one de-emphasis grey carrying the thing it is
   * being compared against. Chart code asks for `series.pyra`, never for a
   * hue, so a series can never be recoloured by its rank or by which filter is
   * active.
   *
   * The pair is validated in docs/palette-validation.md. It passes CVD
   * separation (deutan ΔE 15.9), the normal-vision floor (20.0) and contrast;
   * it is waived on the dark lightness band and the chroma floor, and every
   * step that would satisfy those two collapses the separation to ΔE 0.4–7.5.
   * The waiver is paid for with a legend, direct labels and a table view.
   */
  series: {
    pyra: '#4DE1C1',        // === meshTeal
    baseline: '#8A9691',    // === baselineGray
  },

  /** Chart chrome. Recessive by construction: one step off the surface. */
  chart: {
    surface: '#0E1F16',     // === surface
    grid: '#1B3B29',        // === surfaceRaised
    axis: '#2C5540',
    inkMuted: '#9FB3A8',
  },
} as const
