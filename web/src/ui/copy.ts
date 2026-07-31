import type { BenchmarkResult } from '../lib/benchmark'
import type { BudgetMode } from '../lib/budget'

const pct1 = (f: number) => `${(100 * f).toFixed(1)}%`
const pp1 = (x: number) => Math.abs(x).toFixed(1)

/**
 * Every coverage number the site shows goes through here.
 *
 * A coverage figure without its weighting and its stride is not a result. The
 * same network scored at a 0.37 km stride and at a 4 km stride gives different
 * numbers, so the stride is part of the claim, not a footnote.
 */
export function coverageSentence(a: {
  coveredFraction: number; strideKm: number; demandCount: number; detectKm: number
}): string {
  return (
    `${pct1(a.coveredFraction)} risk-weighted coverage — the share of ` +
    `burnable-area demand weight within ${a.detectKm} km of a node, scored ` +
    `over ${a.demandCount.toLocaleString()} demand points on a ` +
    `${a.strideKm.toFixed(2)} km stride.`
  )
}

/**
 * The benchmark caption, including which arm is ahead at the budget on screen.
 *
 * It is allowed to say the uniform grid wins, and on Los Padres at saturation
 * it does. A caption that always announced a Pyra win would be a caption that
 * had stopped reading its own data.
 */
export function benchmarkSentence(r: BenchmarkResult): string {
  const at = r.atBudget
  const leader = at.deltaPP >= 0 ? 'the risk-driven placement' : 'the uniform grid'
  const head =
    `At ${at.scored.toLocaleString()} nodes — both arms capped to the same ` +
    `realised count, same region, same demand points — ${leader} leads by ` +
    `${pp1(at.deltaPP)} percentage points ` +
    `(${pct1(at.pyra)} risk-driven vs ${pct1(at.uniform)} uniform grid).`

  const best =
    ` The risk-driven placement's best margin is ${pp1(r.bestMargin.deltaPP)} pp ` +
    `at ${r.bestMargin.scored.toLocaleString()} nodes.`

  const cross = r.crossoverNodes == null
    ? ' The uniform grid never takes the lead across this budget range.'
    : ` The uniform grid takes the lead from about ${r.crossoverNodes.toLocaleString()} ` +
      'nodes: risk-driven siting pays when the budget is too small to blanket ' +
      'the ground, and a lattice packs discs better once it is not.'

  return head + best + cross
}

/**
 * Shown only when the current weights leave the highest-risk pixel contested.
 *
 * The blue-noise sampler starts at the highest-risk allowed pixel. When several
 * tie, this browser picks the lowest flat index; numpy's unstable argsort would
 * pick some other one. Both are valid seeds under the algorithm as written, but
 * the reader is told rather than left to assume bit-parity that is not there.
 */
export function seedSentence(tiesAtMax: number): string | null {
  if (tiesAtMax <= 1) return null
  return (
    `${tiesAtMax.toLocaleString()} pixels tie at the maximum risk, so the ` +
    'placement seed was tie-broken by position. The run is a valid run of the ' +
    'algorithm; it is not the same tie-break the Python reference would make.'
  )
}

/** Why the two weight sliders are not two independent controls. */
export function weightSentence(a: {
  wWeather: number; wActivity: number; wBase: number; fwiNorm: number
}): string {
  return (
    `Base weight ${a.wBase.toFixed(2)} is the remainder of the other two. ` +
    'Fire weather enters as a single regional value, not a map, so the ' +
    'weather weight shifts the whole field evenly and changes the placement ' +
    'only through its ratio to the activity weight. The spatial structure ' +
    'comes from fuel flammability, which multiplies, and from observed ' +
    'activity, which adds.'
  )
}

export function budgetSentence(a: {
  mode: BudgetMode; maxNodes: number | null; nodeCount: number
}): string {
  if (a.mode === 'saturation') {
    // Before the first run there is no node count. Saying "0 here" would read
    // as a result rather than an absence.
    return a.nodeCount > 0
      ? 'Saturation: the node count is whatever reaching the coverage target ' +
        `requires — ${a.nodeCount.toLocaleString()} here.`
      : 'Saturation: the node count will be whatever reaching the coverage ' +
        'target requires.'
  }
  if (a.mode === 'auto') {
    return (
      "Auto: the library's own default budget rule scales with risk-weighted " +
      `burnable area and clamps, giving ${a.maxNodes} nodes here. That is far ` +
      'below what the coverage target needs, which is why the Lab does not ' +
      'start in this mode.'
    )
  }
  return a.nodeCount > 0
    ? `Fixed: ${a.maxNodes} nodes requested, ${a.nodeCount.toLocaleString()} placed.`
    : `Fixed: ${a.maxNodes} nodes requested.`
}

export function unbakedNotice(label: string): string {
  return (
    `${label} is not baked yet — only Los Padres has committed model inputs ` +
    'in this build. The siting model itself runs on any box on Earth; what ' +
    'is missing is the offline data bake, not the algorithm.'
  )
}
