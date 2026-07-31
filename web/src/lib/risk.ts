import type { ClassField, Field } from './types'

/**
 * The three drive weights `plan.risk_field` takes. All three are independent
 * inputs, exactly as the Python signature declares them
 * (`w_weather=0.45, w_activity=0.35, w_base=0.20`) — nothing here requires
 * them to sum to 1. They happen to in the shipped defaults because that is
 * how the model's author chose the three literals, not because the model
 * enforces it. Forcing a sum-to-1 constraint here would misreport what the
 * Python does; a UI that wants two sliders whose pair sums to at most 1 can
 * compute `wBase` as the remainder and pass it in, and the store does exactly
 * that (`useModelStore.clampWeights`).
 *
 * An earlier version of this comment claimed the derivation would break
 * bit-for-bit reproduction of `risk.bin`, because `1 - 0.45 - 0.35` is
 * 0.20000000000000007 rather than the literal 0.2. That was measured and is
 * false: zero of 540,000 pixels move, because the `/peak` normalisation
 * divides the near-uniform perturbation back out. See the test
 * "survives a derived w_base" in web/tests/risk.test.ts. The three-weight
 * signature is right for the first reason, not the second.
 */
export interface Weights {
  wWeather: number
  wActivity: number
  wBase: number
}

/**
 * `plan.risk_field`'s own parameter defaults, typed as the same literals —
 * never computed. Using these reproduces `risk.bin` and its recorded peak
 * bit-for-bit; deriving `wBase` from the other two would not.
 */
export const DEFAULT_WEIGHTS: Weights = {
  wWeather: 0.45,
  wActivity: 0.35,
  wBase: 0.20,
}

/**
 * A 256-entry lookup from WorldCover class code to flammability weight.
 *
 * The table comes from `meta.flammability`, which the bake reads straight out
 * of `forest.FLAMMABILITY` — never restate it here. Codes absent from the
 * table weigh 0, which is what `forest.flammability_field` does: it starts
 * from `np.zeros` and only writes the entries whose weight is above zero.
 */
export function flammabilityLut(table: Record<string, number>): Float64Array {
  const lut = new Float64Array(256)
  for (const [code, weight] of Object.entries(table)) {
    const c = Number(code)
    if (Number.isInteger(c) && c >= 0 && c < 256) lut[c] = weight
  }
  return lut
}

export interface RiskInputs {
  classes: ClassField
  /** The baked FIRMS activity field, already float32. */
  activity: Float32Array
  /** The region's single fire-weather scalar. */
  fwiNorm: number
  lut: Float64Array
}

export interface RiskResult {
  risk: Field
  /** The pre-normalisation maximum, i.e. what the field was divided by. */
  peak: number
}

/**
 * `risk = flammability(landcover) * (w_base + w_weather*fwiNorm +
 * w_activity*activity)`, then divided by its own maximum so the peak is
 * exactly 1.0. A port of `plan.risk_field`, statement for statement.
 *
 * Two things are load-bearing and must not be "tidied":
 *
 *  1. `drive` is `(w_base + w_weather*fwi) + w_activity*act_i`. Python's
 *     left-associative expression computes the parenthesised part ONCE as a
 *     scalar; folding the three terms in any other order is a different
 *     rounding, and this function's whole job is to land on the same float32
 *     bits as the committed risk.bin.
 *  2. Flammability MULTIPLIES. No amount of fire weather makes open water
 *     flammable, and a purely additive model sites sensors in lakes.
 *
 * The `/peak` step is why risk values are comparable only within one region:
 * a 1.0 here and a 1.0 elsewhere are not the same absolute danger.
 */
export function recombineRisk(inp: RiskInputs, w: Weights = DEFAULT_WEIGHTS): RiskResult {
  const { classes, activity, lut } = inp
  const n = classes.nx * classes.ny
  const { wWeather, wActivity, wBase } = w

  const fwi = inp.fwiNorm < 0 ? 0 : inp.fwiNorm > 1 ? 1 : inp.fwiNorm
  const s = wBase + wWeather * fwi          // the scalar half of `drive`

  const raw = new Float64Array(n)
  let peak = 0
  for (let i = 0; i < n; i++) {
    const v = lut[classes.data[i]] * (s + wActivity * activity[i])
    raw[i] = v
    if (v > peak) peak = v
  }

  const out = new Float32Array(n)
  if (peak > 0) {
    // Assigning a double into a Float32Array rounds to nearest-even, the same
    // rule numpy's astype('<f4') uses. Math.fround is written out so the
    // narrowing is visible rather than incidental.
    for (let i = 0; i < n; i++) out[i] = Math.fround(raw[i] / peak)
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.fround(raw[i])
  }

  return { risk: { nx: classes.nx, ny: classes.ny, data: out }, peak }
}

/**
 * The burnable mask, as `forest.burnable_mask` computes it: membership of
 * `forest.BURNABLE`. Kept as a `Field` of 0/1 because every consumer
 * (`allowedAt`, `demandPoints`) already takes one.
 */
export function burnableMaskOf(classes: ClassField, burnable: number[]): Field {
  const allow = new Uint8Array(256)
  for (const c of burnable) if (c >= 0 && c < 256) allow[c] = 1
  const n = classes.nx * classes.ny
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = allow[classes.data[i]]
  return { nx: classes.nx, ny: classes.ny, data }
}

/**
 * Mean of `risk` over the pixels the mask allows.
 *
 * `plan_region` feeds exactly this to `auto_budget` (`risk[burn].mean()`), so
 * it has to be the masked mean and not the grid mean — on Los Padres those
 * are 0.5062 and 0.4668, which is a different budget.
 */
export function meanOverMask(risk: Field, mask: Field): number {
  let sum = 0
  let count = 0
  for (let i = 0; i < risk.data.length; i++) {
    if (mask.data[i] > 0.5) { sum += risk.data[i]; count++ }
  }
  return count > 0 ? sum / count : 0
}
