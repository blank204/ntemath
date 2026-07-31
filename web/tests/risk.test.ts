import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  recombineRisk, flammabilityLut, burnableMaskOf, DEFAULT_WEIGHTS,
  meanOverMask,
} from '../src/lib/risk'
import fixture from './fixtures/recombine.json'

const f = fixture as any
const DIR = join(__dirname, '..', 'public', 'data', 'los-padres')

function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

describe('DEFAULT_WEIGHTS', () => {
  it('matches plan.risk_field\'s own literal parameter defaults exactly, not a derived remainder', () => {
    // w_base is an independent parameter in plan.risk_field
    // (w_weather=0.45, w_activity=0.35, w_base=0.20), not 1 - w_weather -
    // w_activity. Those two are not the same float64 bit pattern
    // (1.0 - 0.45 - 0.35 === 0.20000000000000007, not 0.2), so DEFAULT_WEIGHTS
    // must carry the literal, or the peak recorded in meta.json stops
    // matching bit-for-bit.
    expect(DEFAULT_WEIGHTS).toEqual({ wWeather: 0.45, wActivity: 0.35, wBase: 0.20 })
    expect(DEFAULT_WEIGHTS.wBase).toBe(0.2)
    expect(1.0 - DEFAULT_WEIGHTS.wWeather - DEFAULT_WEIGHTS.wActivity)
      .not.toBe(DEFAULT_WEIGHTS.wBase)
  })
})

describe('flammabilityLut', () => {
  it('maps every published code and leaves the rest at zero', () => {
    const lut = flammabilityLut(f.flammability)
    expect(lut.length).toBe(256)
    expect(lut[10]).toBe(1)
    expect(lut[30]).toBe(0.75)
    expect(lut[100]).toBe(0.55)
    expect(lut[80]).toBe(0)
    expect(lut[0]).toBe(0)
    expect(lut[255]).toBe(0)
  })
})

describe('recombineRisk reproduces plan.risk_field', () => {
  const classes = { nx: f.nx, ny: f.ny, data: Uint8Array.from(f.classes) }
  const activity = Float32Array.from(f.activity32)
  const lut = flammabilityLut(f.flammability)

  for (const c of f.cases as any[]) {
    it(`matches float32-for-float32 at wWeather=${c.wWeather} wActivity=${c.wActivity}`, () => {
      const out = recombineRisk(
        { classes, activity, fwiNorm: c.fwiNorm, lut },
        { wWeather: c.wWeather, wActivity: c.wActivity, wBase: c.wBase },
      )
      expect(out.risk.data.length).toBe(c.risk32.length)
      for (let i = 0; i < c.risk32.length; i++) {
        // Exact equality, not a tolerance. Both sides are float32 values
        // produced by the same float64 arithmetic and the same rounding.
        expect(out.risk.data[i]).toBe(c.risk32[i])
      }
      expect(out.peak).toBe(c.peak)
    })
  }
})

describe('recombineRisk on the real region', () => {
  const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8'))

  function inputs() {
    const cb = bytes('classes.bin')
    const ab = bytes('activity.bin')
    return {
      classes: { nx: meta.nx, ny: meta.ny, data: cb },
      activity: new Float32Array(ab.buffer, ab.byteOffset, ab.byteLength / 4),
      fwiNorm: meta.fwiNorm as number,
      lut: flammabilityLut(meta.flammability),
    }
  }

  it('reproduces the committed risk.bin bit for bit at the default weights', () => {
    const rb = bytes('risk.bin')
    const baked = new Float32Array(rb.buffer, rb.byteOffset, rb.byteLength / 4)
    const out = recombineRisk(inputs(), {
      wWeather: meta.weightDefaults.wWeather,
      wActivity: meta.weightDefaults.wActivity,
      wBase: meta.weightDefaults.wBase,
    })
    let diffs = 0
    let firstBad = -1
    for (let i = 0; i < baked.length; i++) {
      if (out.risk.data[i] !== baked[i]) { if (firstBad < 0) firstBad = i; diffs++ }
    }
    expect({ diffs, firstBad }).toEqual({ diffs: 0, firstBad: -1 })
    expect(out.peak).toBe(meta.riskPeak)
  })

  it('survives a derived w_base, so the anchor is not the reason for three weights', () => {
    // `1 - 0.45 - 0.35` is 0.20000000000000007, not the float64 literal 0.2
    // that plan.risk_field defaults to and that risk.bin was baked with. The
    // comment on recombineRisk used to claim that deriving w_base this way is
    // "exactly what breaks bit-for-bit reproduction". Measured here: it does
    // not. Zero of 540,000 pixels move. The /peak normalisation divides the
    // near-uniform perturbation of `s` back out, and float32 narrowing absorbs
    // what is left.
    //
    // The three independent weights are still right, on the honest reason:
    // plan.risk_field's signature takes three, and nothing in the model
    // requires them to sum to 1. Forcing that constraint at the model boundary
    // would misreport what the Python does. The sum-to-1 rule is a slider
    // convention and lives in the store.
    //
    // Keep this test. If a future change makes the derivation start costing
    // pixels, that is worth knowing immediately.
    const rb = bytes('risk.bin')
    const baked = new Float32Array(rb.buffer, rb.byteOffset, rb.byteLength / 4)
    const derivedBase = 1 - meta.weightDefaults.wWeather - meta.weightDefaults.wActivity
    expect(derivedBase).not.toBe(meta.weightDefaults.wBase)

    const out = recombineRisk(inputs(), {
      wWeather: meta.weightDefaults.wWeather,
      wActivity: meta.weightDefaults.wActivity,
      wBase: derivedBase,
    })
    let diffs = 0
    for (let i = 0; i < baked.length; i++) {
      if (out.risk.data[i] !== baked[i]) diffs++
    }
    expect(diffs).toBe(0)
  })

  it('changes the field when the weights change', () => {
    const a = recombineRisk(inputs(), { wWeather: 0.45, wActivity: 0.35, wBase: 0.20 })
    const b = recombineRisk(inputs(), { wWeather: 0.45, wActivity: 0, wBase: 0.20 })
    let diffs = 0
    for (let i = 0; i < a.risk.data.length; i++) {
      if (a.risk.data[i] !== b.risk.data[i]) diffs++
    }
    expect(diffs).toBeGreaterThan(1000)
  })

  it('derives the burnable mask that mask.bin recorded', () => {
    const m = burnableMaskOf(inputs().classes, meta.burnableClasses)
    const baked = bytes('mask.bin')
    let diffs = 0
    for (let i = 0; i < baked.length; i++) {
      if (m.data[i] !== baked[i]) diffs++
    }
    expect(diffs).toBe(0)
  })

  it('reports the mean risk over burnable ground that auto-budget uses', () => {
    const inp = inputs()
    const m = burnableMaskOf(inp.classes, meta.burnableClasses)
    const r = recombineRisk(inp, {
      wWeather: meta.weightDefaults.wWeather,
      wActivity: meta.weightDefaults.wActivity,
      wBase: meta.weightDefaults.wBase,
    })
    // Measured against the committed rasters with numpy: risk[mask].mean().
    expect(meanOverMask(r.risk, m)).toBeCloseTo(0.5062295198440552, 6)
  })
})
