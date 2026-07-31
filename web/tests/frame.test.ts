import { describe, it, expect } from 'vitest'
import { LocalFrame, mPerDegLon, M_PER_DEG_LAT } from '../src/lib/frame'
import fixture from './fixtures/frame.json'

const near = (a: number, b: number, eps = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(eps)

describe('LocalFrame matches the Python', () => {
  it('has the documented latitude constant', () => {
    expect(M_PER_DEG_LAT).toBe(111320.0)
  })

  it('shrinks a degree of longitude toward the poles', () => {
    near(mPerDegLon(0), 111320.0, 1e-6)
    expect(mPerDegLon(70)).toBeLessThan(mPerDegLon(0) * 0.4)
  })

  for (const c of fixture.cases as any[]) {
    it(`reproduces the frame for ${c.name}`, () => {
      const [west, south, east, north] = c.box
      const f = new LocalFrame({ west, south, east, north })
      near(f.lon0, c.lon0)
      near(f.lat0, c.lat0)
      near(f.kx, c.kx)
      near(f.ky, c.ky)
      const [w, h] = f.extentKm()
      near(w, c.extent_km[0], 1e-8)
      near(h, c.extent_km[1], 1e-8)
    })

    it(`reproduces to_km for ${c.name}`, () => {
      const [west, south, east, north] = c.box
      const f = new LocalFrame({ west, south, east, north })
      const probes: [number, number][] = [
        [west, south], [east, north], [c.lon0, c.lat0], [west, north],
      ]
      probes.forEach((p, i) => {
        const [x, y] = f.toKm(p[0], p[1])
        near(x, c.to_km[i][0], 1e-8)
        near(y, c.to_km[i][1], 1e-8)
      })
    })

    it(`round-trips lon/lat through km for ${c.name}`, () => {
      const [west, south, east, north] = c.box
      const f = new LocalFrame({ west, south, east, north })
      const [x, y] = f.toKm(west, north)
      const [lon, lat] = f.toLonLat(x, y)
      near(lon, west, 1e-9)
      near(lat, north, 1e-9)
    })
  }
})
