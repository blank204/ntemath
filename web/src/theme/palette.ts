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
} as const
