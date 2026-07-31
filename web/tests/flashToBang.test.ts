import { describe, it, expect } from 'vitest'
import {
  speedOfSound, rangeKmFromDelay, delayForRangeKm, phaseAt,
  warmAirErrorFraction, REFERENCE_TEMP_C, REFERENCE_SPEED_MS,
} from '../src/lib/flashToBang'

describe('speedOfSound', () => {
  it('is the textbook 343 m/s at 20 °C', () => {
    expect(speedOfSound(20)).toBeCloseTo(343.4, 1)
    expect(REFERENCE_SPEED_MS).toBeCloseTo(speedOfSound(REFERENCE_TEMP_C), 6)
  })

  it('falls in cold air, which is the whole reason temperature is a control', () => {
    // 331.3 + 0.606 T. A boreal storm cell is not a 20 °C laboratory, and
    // the thing this interactive teaches is a measurement, so the number it
    // divides by has to be the real one.
    expect(speedOfSound(-10)).toBeLessThan(speedOfSound(20))
    expect(speedOfSound(-10)).toBeCloseTo(325.2, 1)
    expect(speedOfSound(0)).toBeCloseTo(331.3, 1)
  })
})

describe('rangeKmFromDelay', () => {
  it('turns a delay into a distance at the air temperature given', () => {
    // The measurement the towers actually make: distance = c * dt.
    expect(rangeKmFromDelay(3, 20)).toBeCloseTo(1.03026, 5)
    expect(rangeKmFromDelay(0, 20)).toBe(0)
  })

  it('is the exact inverse of delayForRangeKm', () => {
    for (const km of [0.5, 3, 12, 20]) {
      expect(rangeKmFromDelay(delayForRangeKm(km, 5), 5)).toBeCloseTo(km, 9)
    }
  })

  it('refuses a negative delay rather than returning a negative distance', () => {
    expect(() => rangeKmFromDelay(-1, 20)).toThrow(/delay/)
  })
})

describe('warmAirErrorFraction', () => {
  it('is zero when the air really is at the reference temperature', () => {
    expect(warmAirErrorFraction(REFERENCE_TEMP_C)).toBeCloseTo(0, 12)
  })

  it('shows the overestimate from assuming 343 m/s in cold air', () => {
    // Assuming the textbook speed in -10 °C air overstates the distance by
    // about 5.6%. At 15 km that is over 800 m of error, which is the honest
    // caveat this interactive has to carry rather than imply a precision it
    // does not have.
    const e = warmAirErrorFraction(-10)
    expect(e).toBeGreaterThan(0.05)
    expect(e).toBeLessThan(0.06)
  })

  it('goes negative in air warmer than the reference', () => {
    expect(warmAirErrorFraction(35)).toBeLessThan(0)
  })
})

describe('phaseAt', () => {
  const delay = 4

  it('opens on the flash, which is instantaneous at these ranges', () => {
    // Light covers 15 km in 50 microseconds. The flash IS the start signal.
    expect(phaseAt(0, delay).phase).toBe('flash')
    expect(phaseAt(0.15, delay).phase).toBe('flash')
  })

  it('spends the gap in silence, with the clock running', () => {
    const s = phaseAt(2, delay)
    expect(s.phase).toBe('silence')
    expect(s.elapsedS).toBe(2)
    // Nothing is known about the distance yet — that is the point of the
    // beat. A readout during the silence would give away the measurement
    // before the sound arrives.
    expect(s.rangeKm).toBeNull()
  })

  it('reports the range only once the sound has actually arrived', () => {
    const s = phaseAt(delay, delay, 20)
    expect(s.phase).toBe('boom')
    expect(s.rangeKm).toBeCloseTo(1.3736, 3)
  })

  it('holds the answer after the boom instead of resetting', () => {
    const s = phaseAt(delay + 3, delay, 20)
    expect(s.phase).toBe('resolved')
    expect(s.rangeKm).toBeCloseTo(1.3736, 3)
  })

  it('stops the clock when the thunder lands', () => {
    // The measurement IS the interval between the two arrivals. A clock that
    // kept running would put a bigger number in front of the same range and
    // print arithmetic that does not hold — which it did, on screen, before
    // this test existed.
    expect(phaseAt(delay + 3, delay, 20).elapsedS).toBe(delay)
  })

  it('always reports a range its own clock reading would produce', () => {
    // The screen prints "<elapsed> s x <speed> m/s = <range> km". That
    // sentence has to be true at every instant it is shown, not just at the
    // instant of arrival.
    for (const t of [delay, delay + 0.5, delay + 9]) {
      const s = phaseAt(t, delay, 20)
      expect(s.rangeKm).toBeCloseTo(rangeKmFromDelay(s.elapsedS, 20), 12)
    }
  })

  it('draws the ring at the distance the sound has travelled, not the answer', () => {
    // The ring is the sound wave itself, so halfway through the gap it is
    // halfway out. Snapping it to the final radius would draw a measurement
    // the tower has not made yet.
    expect(phaseAt(2, delay, 20).ringKm).toBeCloseTo(rangeKmFromDelay(2, 20), 9)
    expect(phaseAt(delay, delay, 20).ringKm).toBeCloseTo(
      rangeKmFromDelay(delay, 20), 9)
  })

  it('stops the ring at the strike rather than running past it', () => {
    expect(phaseAt(delay + 5, delay, 20).ringKm)
      .toBeCloseTo(rangeKmFromDelay(delay, 20), 9)
  })
})
