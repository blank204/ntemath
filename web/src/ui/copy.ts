import type { BenchmarkResult } from '../lib/benchmark'
import type { BudgetMode } from '../lib/budget'
import type { LightningGate, RiskLayer } from '../lib/loadRegion'
import type { RegionEntry } from '../lib/regions'

const pct1 = (f: number) => `${(100 * f).toFixed(1)}%`
const pp1 = (x: number) => Math.abs(x).toFixed(1)

/**
 * Scientific notation a reader can say out loud. `toExponential` gives
 * "6.8e-10", which is right and reads as noise in a sentence.
 */
const p1 = (p: number) => (p < 1e-4 ? `p < 0.0001` : `p = ${p.toFixed(4)}`)

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
    `burnable-area demand weight within ${a.detectKm} km of a tower, scored ` +
    `over ${a.demandCount.toLocaleString()} demand points on a ` +
    `${a.strideKm.toFixed(2)} km stride.`
  )
}

/**
 * Benchmark C, in a sentence: the same network scored on two towers.
 *
 * It leads with how little of the region is triangulated, not with the
 * margin. A favourable comparison on a small number is still a small number,
 * and the small number is the one a reader needs first.
 */
export function triangulationSentence(
  single: BenchmarkResult, double: BenchmarkResult,
): string {
  const at = double.atBudget
  const head =
    `At ${at.scored.toLocaleString()} towers — the count both arms can ` +
    `actually realise — only ${pct1(at.pyra)} of this region's demand is ` +
    `within range of two towers, against ${pct1(single.atBudget.pyra)} ` +
    'within range of one. A network sized to hear every strike once ' +
    'triangulates a fraction of it.'
  const lead = at.deltaPP >= 0
    ? ` On that harder rule the risk-driven placement leads the uniform grid ` +
      `by ${pp1(at.deltaPP)} pp`
    : ` On that harder rule the uniform grid leads by ${pp1(at.deltaPP)} pp`
  const cross = double.crossoverNodes == null
    ? ', and unlike single coverage the grid never takes the lead at any ' +
      'budget measured — a lattice spaces to avoid overlap, and overlap is ' +
      'the product here.'
    : `, until ${double.crossoverNodes.toLocaleString()} towers, where the ` +
      'grid takes the lead.'
  return head + lead + cross
}

/**
 * What re-optimising the same towers for the two-tower rule costs and buys.
 *
 * Both columns, always. Triangulating more ground means hearing less of it at
 * all, and a sentence that reported only the number that went up would be
 * selling rather than measuring.
 */
export function doubleCoverageSentence(a: {
  nodeCount: number
  siteSingle: number; siteDouble: number
  tunedSingle: number; tunedDouble: number
}): string {
  return (
    `Those same ${a.nodeCount.toLocaleString()} towers, re-chosen from the ` +
    'same candidate pool to maximise two-tower coverage instead of one, ' +
    `reach ${pct1(a.tunedDouble)} triangulated against ${pct1(a.siteDouble)} ` +
    `— and the cost is real: single coverage falls from ` +
    `${pct1(a.siteSingle)} to ${pct1(a.tunedSingle)}. Hearing more of the ` +
    'region twice means hearing less of it at all. Which one a deployment ' +
    'wants depends on whether a bearing-and-range fix from one tower is ' +
    'good enough for the ground it is over.'
  )
}

/**
 * The gradient gate, in a sentence.
 *
 * The region was chosen on a hypothesis — that a coast gives land-water
 * convective contrast and therefore real spatial structure in strike density
 * — and no literature quantifies that for this coast. So the bake measured
 * it on the raw flash counts before building anything, and this is where the
 * measurement gets published. A verdict of "flat" says the layer is
 * decorative, in those words, because the alternative is a risk field that
 * looks informative and is not.
 */
export function gateSentence(g: LightningGate): string {
  const base =
    `Strike density comes from ${g.flashes.toLocaleString()} flashes observed ` +
    `across the ${g.cells} native climatology cells inside this box ` +
    `(NASA LIS/OTD, ${g.nativeDeg}° — about 55 km, so this layer carries a ` +
    'regional gradient and nothing finer). '
  if (g.verdict === 'flat') {
    return base + (
      'Across this box that field is statistically flat: it is decorative, ' +
      'and the placement you see is driven by fuel and weather alone.'
    )
  }
  const direction = g.verdict === 'gradient'
    ? `and it runs ${g.eastWestRatio.toFixed(2)}× higher inland than at the ` +
      `coast (${p1(g.pEastWest)}) — the land-water contrast this region was ` +
      'chosen for.'
    : 'though it has no consistent direction across the box.'
  return base + (
    `That field is not uniform (${p1(g.pUniform)} against a constant rate), ` + direction
  )
}

/**
 * Shown when the selected region is one where people, not lightning, start
 * the fires. The model still runs there — it is the same code path on any
 * box on Earth — but the product's premise does not, and the picker should
 * not let that pass in silence.
 */
export function ignitionCaveat(r: RegionEntry): string | null {
  if (r.lightningDriven) return null
  return (
    `${r.label} is a region where ignition is ${r.ignition}. The siting model ` +
    'runs here exactly as it does anywhere else, but a tower that watches for ' +
    'lightning is watching for the wrong thing in this landscape.'
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
    `At ${at.scored.toLocaleString()} towers — both arms capped to the same ` +
    `realised count, same region, same demand points — ${leader} leads by ` +
    `${pp1(at.deltaPP)} percentage points ` +
    `(${pct1(at.pyra)} risk-driven vs ${pct1(at.uniform)} uniform grid).`

  const best =
    ` The risk-driven placement's best margin is ${pp1(r.bestMargin.deltaPP)} pp ` +
    `at ${r.bestMargin.scored.toLocaleString()} towers.`

  const cross = r.crossoverNodes == null
    ? ' The uniform grid never takes the lead across this budget range.'
    : ` The uniform grid takes the lead from about ${r.crossoverNodes.toLocaleString()} ` +
      'towers: risk-driven siting pays when the budget is too small to blanket ' +
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
  layer: RiskLayer
}): string {
  // The third weight multiplies a different quantity in each region, and the
  // two mean opposite things. Naming it "activity" everywhere would describe
  // a lightning map in the vocabulary of a fire map.
  const layerName = a.layer === 'lightning'
    ? 'lightning strike density' : 'observed fire activity'
  return (
    `Base weight ${a.wBase.toFixed(2)} is the remainder of the other two. ` +
    'Fire weather enters as a single regional value, not a map, so the ' +
    'weather weight shifts the whole field evenly and changes the placement ' +
    `only through its ratio to the ${layerName} weight. The spatial structure ` +
    'comes from fuel flammability, which multiplies, and from ' +
    `${layerName}, which adds.`
  )
}

export function budgetSentence(a: {
  mode: BudgetMode; maxNodes: number | null; nodeCount: number
}): string {
  if (a.mode === 'saturation') {
    // Before the first run there is no node count. Saying "0 here" would read
    // as a result rather than an absence.
    return a.nodeCount > 0
      ? 'Saturation: the tower count is whatever reaching the coverage target ' +
        `requires — ${a.nodeCount.toLocaleString()} here.`
      : 'Saturation: the tower count will be whatever reaching the coverage ' +
        'target requires.'
  }
  if (a.mode === 'auto') {
    return (
      "Auto: the library's own default budget rule scales with risk-weighted " +
      `burnable area and clamps, giving ${a.maxNodes} towers here. That is far ` +
      'below what the coverage target needs, which is why the Lab does not ' +
      'start in this mode.'
    )
  }
  return a.nodeCount > 0
    ? `Fixed: ${a.maxNodes} towers requested, ${a.nodeCount.toLocaleString()} placed.`
    : `Fixed: ${a.maxNodes} towers requested.`
}

/**
 * `baked` comes from the manifest, never from memory. This sentence read
 * "only Los Padres has committed model inputs" for as long as that was true
 * and would have gone on saying it after James Bay was baked.
 */
export function unbakedNotice(label: string, baked: string[]): string {
  const list = baked.length === 0
    ? 'no region has'
    : baked.length === 1
      ? `only ${baked[0]} has`
      : `${baked.slice(0, -1).join(', ')} and ${baked[baked.length - 1]} have`
  return (
    `${label} is not baked yet — ${list} committed model inputs ` +
    'in this build. The siting model itself runs on any box on Earth; what ' +
    'is missing is the offline data bake, not the algorithm.'
  )
}
