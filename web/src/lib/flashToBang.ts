/**
 * Flash-to-bang: the measurement a tower makes with a camera and a clock.
 *
 * Light covers 15 km in about 50 microseconds, so the flash is the start
 * signal. The thunder takes the same distance at the speed of sound, so the
 * gap between them IS the range. It is the oldest trick in storm-watching and
 * it is exactly what the acoustic layer of a tower does — with a microphone
 * array giving the bearing that turns a range into a position.
 *
 * WHAT THIS IS NOT. It is not competitive with an electromagnetic lightning
 * network: NLDN and GLD360 are sub-kilometre and range-unlimited, while
 * audible thunder gives out near 20 km and terrain and temperature gradients
 * open shadow zones well inside that. It is a LOCAL CONFIRMATION layer, and
 * the site says so.
 */

/**
 * Speed of sound in dry air, m/s, from the standard linear approximation
 * c = 331.3 + 0.606 T. Good to a fraction of a percent over the range any
 * storm happens in, and humidity moves it by less than 0.5%.
 */
export function speedOfSound(tempC: number): number {
  return 331.3 + 0.606 * tempC
}

/** The temperature the textbook 343 m/s belongs to. */
export const REFERENCE_TEMP_C = 20
export const REFERENCE_SPEED_MS = speedOfSound(REFERENCE_TEMP_C)

/** Range in km from the flash-to-bang delay, at a given air temperature. */
export function rangeKmFromDelay(delayS: number, tempC: number): number {
  if (!(delayS >= 0)) {
    throw new Error(`flash-to-bang delay must be >= 0, got ${delayS}`)
  }
  return (speedOfSound(tempC) * delayS) / 1000
}

/** The delay a strike at `km` would produce. The inverse of the above. */
export function delayForRangeKm(km: number, tempC: number): number {
  return (km * 1000) / speedOfSound(tempC)
}

/**
 * How wrong the textbook 343 m/s is at a given temperature, as a fraction of
 * the true distance. Positive means the assumption OVERSTATES the range.
 *
 * This is the honest caveat the interactive has to carry: at -10 °C, using
 * 343 m/s puts a strike 5.6% further away than it is — over 800 m at 15 km,
 * which is the difference between the right drainage and the next one.
 */
export function warmAirErrorFraction(tempC: number): number {
  return REFERENCE_SPEED_MS / speedOfSound(tempC) - 1
}

export type FlashPhase = 'flash' | 'silence' | 'boom' | 'resolved'

export interface FlashState {
  phase: FlashPhase
  /**
   * The clock reading, seconds: time since the flash, FROZEN at the moment
   * the thunder lands. The measurement is the interval between the two
   * arrivals, so a clock that kept running would print a bigger number
   * beside the same range — arithmetic that does not hold, in the one place
   * on the site whose whole job is showing that it does.
   */
  elapsedS: number
  /**
   * Radius the sound has actually reached, km — the wavefront, not the
   * answer. It stops growing when it arrives.
   */
  ringKm: number
  /**
   * The measured range, or null while the sound is still in the air.
   * Showing it early would hand over the measurement before it is made,
   * which is the one thing this animation exists to prevent.
   */
  rangeKm: number | null
}

/** How long the flash itself is held on screen, seconds. */
export const FLASH_HOLD_S = 0.18
/** How long the boom is emphasised before the state settles, seconds. */
export const BOOM_HOLD_S = 0.6

export function phaseAt(
  elapsedS: number, delayS: number, tempC: number = REFERENCE_TEMP_C,
): FlashState {
  const t = Math.max(0, elapsedS)
  const arrived = t >= delayS
  // One quantity, used for the clock, the ring and the range alike, so the
  // three can never disagree with each other.
  const measuredS = Math.min(t, delayS)
  const ringKm = rangeKmFromDelay(measuredS, tempC)
  const rangeKm = arrived ? ringKm : null
  const phase: FlashPhase = arrived
    ? (t < delayS + BOOM_HOLD_S ? 'boom' : 'resolved')
    : (t < FLASH_HOLD_S ? 'flash' : 'silence')
  return { phase, elapsedS: measuredS, ringKm, rangeKm }
}
