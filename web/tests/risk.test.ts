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

/**
 * The lightning region's anchor. The pivot's whole claim is that swapping ONE
 * raster changes what risk means without changing a line of the arithmetic —
 * so the same recombination that reproduces the fire-driven region has to
 * reproduce the lightning-driven one, bit for bit, off a file with a different
 * name and a completely different meaning. If sample_density ever flips north
 * for south, or the normalisation drifts, this is what fails.
 */
describe('recombineRisk on the lightning region', () => {
  const jbDir = join(__dirname, '..', 'public', 'data', 'james-bay')
  const meta = JSON.parse(readFileSync(join(jbDir, 'meta.json'), 'utf-8'))
  const jbBytes = (name: string): Uint8Array => {
    const b = readFileSync(join(jbDir, name))
    return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  }

  it('is driven by lightning, not by fire history', () => {
    expect(meta.layer).toBe('lightning')
    expect(meta.layerFile).toBe('lightning.bin')
    expect(meta.firmsCount).toBeUndefined()
  })

  it('reproduces the committed risk.bin bit for bit from classes + lightning', () => {
    const cb = jbBytes('classes.bin')
    const lb = jbBytes('lightning.bin')
    const rb = jbBytes('risk.bin')
    const baked = new Float32Array(rb.buffer, rb.byteOffset, rb.byteLength / 4)
    const out = recombineRisk({
      classes: { nx: meta.nx, ny: meta.ny, data: cb },
      activity: new Float32Array(lb.buffer, lb.byteOffset, lb.byteLength / 4),
      fwiNorm: meta.fwiNorm as number,
      lut: flammabilityLut(meta.flammability),
    }, {
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

  it('carries the strike gradient west to east, the way the counts do', () => {
    // The region was chosen for a coast-to-inland gradient and the bake
    // measured one in the raw flash counts (1.91x, p = 4.8e-06). This checks
    // the shipped raster kept it, and kept its DIRECTION: row 0 is the south
    // edge and column 0 is the west edge — the shoreline — so a mirrored
    // sample would look entirely plausible and be completely wrong.
    const lb = jbBytes('lightning.bin')
    const f = new Float32Array(lb.buffer, lb.byteOffset, lb.byteLength / 4)
    let west = 0
    let east = 0
    for (let y = 0; y < meta.ny; y++) {
      west += f[y * meta.nx]
      east += f[y * meta.nx + meta.nx - 1]
    }
    expect(east / west).toBeGreaterThan(2)
    expect(meta.lightningGate.eastWestRatio).toBeGreaterThan(1.5)
    expect(meta.lightningGate.verdict).toBe('gradient')
  })
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
    // "exactly what breaks bit-for-bit reproduction". Measured here: the
    // RASTER does not move — 0 of 540,000 pixels — though the recorded peak
    // scalar does, by one ulp, which is why this test asserts the two
    // separately.
    //
    // This is a statement about THESE weights, not a general one. float32
    // rounding happens to absorb a ~6e-17 relative perturbation here; at
    // wWeather = 0 the same nudge moves up to 432 pixels. Do not broaden this
    // into "the derivation never costs pixels" — that is false and the test
    // would fail.
    //
    // The three independent weights are right for a different reason:
    // plan.risk_field's signature takes three, and nothing in the model
    // requires them to sum to 1. Forcing that constraint at the model boundary
    // would misreport what the Python does. The sum-to-1 rule is a slider
    // convention and lives in the store.
    //
    // Keep this test: once Task 11 wires the sliders, moving one and putting
    // it back swaps wBase from the literal 0.2 to 0.20000000000000007, so this
    // is the round trip a reader will actually perform.
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

    // ...but the pre-normalisation peak is NOT reproduced. One ulp. Nothing
    // consumes it (runPlacement discards `peak`), and that is exactly why it
    // is worth pinning: an unconsumed scalar is where a quiet divergence hides.
    expect(out.peak).not.toBe(meta.riskPeak)
    expect(out.peak).toBeCloseTo(meta.riskPeak, 15)
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
