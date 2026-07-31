import { describe, it, expect } from 'vitest'
import { fitWhenStyleReady, type CameraTarget, type LngLatBoundsPair } from '../src/map/camera'

const LOS_PADRES: LngLatBoundsPair = [[-120.3, 34.4], [-119.4, 35.0]]
const OTHER: LngLatBoundsPair = [[15.5, 63.5], [16.5, 64.1]]

class FakeMap implements CameraTarget {
  styleLoaded = false
  fits: Array<{ bounds: LngLatBoundsPair; duration: number }> = []
  listeners: Array<() => void> = []
  offCalls = 0

  isStyleLoaded() { return this.styleLoaded }
  fitBounds(bounds: LngLatBoundsPair, options: { padding: number; duration: number }) {
    this.fits.push({ bounds, duration: options.duration })
  }
  once(_type: 'load', listener: () => void) { this.listeners.push(listener) }
  off(_type: 'load', listener: () => void) {
    this.offCalls++
    this.listeners = this.listeners.filter((l) => l !== listener)
  }
  /** Simulate the style finishing. */
  emitLoad() {
    const ls = this.listeners
    this.listeners = []
    this.styleLoaded = true
    for (const l of ls) l()
  }
}

describe('fitWhenStyleReady', () => {
  it('fits immediately when the style is already loaded', () => {
    const map = new FakeMap()
    map.styleLoaded = true
    const pending = fitWhenStyleReady(map, LOS_PADRES, null)
    expect(pending).toBeNull()
    expect(map.fits).toEqual([{ bounds: LOS_PADRES, duration: 800 }])
    expect(map.listeners).toHaveLength(0)
  })

  it('defers the fit until the style loads, and does not fit before then', () => {
    // This is the bug: the region resolves first, so a fitBounds issued here
    // is thrown away when the style lands and the first view ends up zoomed
    // past the region.
    const map = new FakeMap()
    const pending = fitWhenStyleReady(map, LOS_PADRES, null)

    expect(map.fits).toHaveLength(0)      // nothing wasted on the racing call
    expect(pending).not.toBeNull()
    expect(map.listeners).toHaveLength(1)

    map.emitLoad()
    expect(map.fits).toEqual([{ bounds: LOS_PADRES, duration: 0 }])
  })

  it('lets the newest region win when two arrive before the style loads', () => {
    const map = new FakeMap()
    const first = fitWhenStyleReady(map, LOS_PADRES, null)
    const second = fitWhenStyleReady(map, OTHER, first)

    expect(map.offCalls).toBe(1)
    expect(map.listeners).toEqual([second])

    map.emitLoad()
    // Exactly one fit, and it frames the region the user actually selected.
    expect(map.fits).toEqual([{ bounds: OTHER, duration: 0 }])
  })

  it('fits immediately once the style has loaded, for later region switches', () => {
    const map = new FakeMap()
    const pending = fitWhenStyleReady(map, LOS_PADRES, null)
    map.emitLoad()
    expect(map.fits).toHaveLength(1)

    const next = fitWhenStyleReady(map, OTHER, pending)
    expect(next).toBeNull()
    expect(map.fits[1]).toEqual({ bounds: OTHER, duration: 800 })
  })
})
