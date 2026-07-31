import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSeedIndex } from '../src/lib/seed'
import { recombineRisk, flammabilityLut, burnableMaskOf } from '../src/lib/risk'
import type { Field } from '../src/lib/types'

const DIR = join(__dirname, '..', 'public', 'data', 'los-padres')
const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8'))

function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

const field = (nx: number, ny: number, v: number[]): Field =>
  ({ nx, ny, data: Float32Array.from(v) })

describe('resolveSeedIndex', () => {
  it('picks the greatest allowed value', () => {
    const risk = field(3, 1, [0.1, 0.9, 0.4])
    const mask = field(3, 1, [1, 1, 1])
    expect(resolveSeedIndex(risk, mask).index).toBe(1)
  })

  it('ignores pixels the mask disallows even when they are the global max', () => {
    const risk = field(3, 1, [0.1, 0.9, 0.4])
    const mask = field(3, 1, [1, 0, 1])
    const r = resolveSeedIndex(risk, mask)
    expect(r.index).toBe(2)
    expect(r.maxRisk).toBeCloseTo(0.4, 6)
    expect(r.allowedCount).toBe(2)
  })

  it('breaks ties on the lowest flat index and counts them', () => {
    const risk = field(4, 1, [0.5, 0.5, 0.2, 0.5])
    const mask = field(4, 1, [1, 1, 1, 1])
    const r = resolveSeedIndex(risk, mask)
    expect(r.index).toBe(0)
    expect(r.tiesAtMax).toBe(3)
  })

  it('counts ties only among allowed pixels', () => {
    const risk = field(4, 1, [0.5, 0.5, 0.5, 0.5])
    const mask = field(4, 1, [0, 1, 0, 1])
    const r = resolveSeedIndex(risk, mask)
    expect(r.index).toBe(1)
    expect(r.tiesAtMax).toBe(2)
    expect(r.allowedCount).toBe(2)
  })

  it('reports index -1 when nothing is allowed', () => {
    const r = resolveSeedIndex(field(2, 1, [1, 1]), field(2, 1, [0, 0]))
    expect(r.index).toBe(-1)
    expect(r.allowedCount).toBe(0)
  })

  it('uses the same 0.5 mask threshold place.py does', () => {
    const risk = field(2, 1, [0.2, 0.9])
    expect(resolveSeedIndex(risk, field(2, 1, [1, 0.5])).index).toBe(0)
    expect(resolveSeedIndex(risk, field(2, 1, [1, 0.51])).index).toBe(1)
  })
})

describe('resolveSeedIndex against the baked seed', () => {
  function real() {
    const cb = bytes('classes.bin')
    const ab = bytes('activity.bin')
    const classes = { nx: meta.nx, ny: meta.ny, data: cb }
    const inp = {
      classes,
      activity: new Float32Array(ab.buffer, ab.byteOffset, ab.byteLength / 4),
      fwiNorm: meta.fwiNorm as number,
      lut: flammabilityLut(meta.flammability),
    }
    const mask = burnableMaskOf(classes, meta.burnableClasses)
    return { inp, mask }
  }

  it('agrees with numpy on the shipped raster, which has a unique maximum', () => {
    const { inp, mask } = real()
    const r = recombineRisk(inp, {
      wWeather: meta.weightDefaults.wWeather,
      wActivity: meta.weightDefaults.wActivity,
      wBase: meta.weightDefaults.wBase,
    })
    const s = resolveSeedIndex(r.risk, mask)
    expect(s.tiesAtMax).toBe(1)
    expect(meta.seedTiesAtMax).toBe(1)
    expect(s.index).toBe(meta.seedFlatIndex)
    expect(s.index).toBe(539100)
  })

  it('reports a large tie count once the activity term is switched off', () => {
    const { inp, mask } = real()
    const r = recombineRisk(inp, { wWeather: 0.45, wActivity: 0, wBase: 0.20 })
    const s = resolveSeedIndex(r.risk, mask)
    // With w_activity at 0 the field collapses onto the flammability classes,
    // so every tree/shrub pixel ties at 1.0. This is the case the UI must
    // label, and the reason the seed cannot simply be frozen.
    expect(s.tiesAtMax).toBeGreaterThan(10000)
  })
})
