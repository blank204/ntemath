import { describe, it, expect } from 'vitest'
import {
  coverageSentence, benchmarkSentence, seedSentence, weightSentence,
  budgetSentence, unbakedNotice, gateSentence, ignitionCaveat,
  triangulationSentence, doubleCoverageSentence,
} from '../src/ui/copy'
import { REGIONS } from '../src/lib/regions'
import type { BenchmarkResult } from '../src/lib/benchmark'
import type { LightningGate } from '../src/lib/loadRegion'

const result: BenchmarkResult = {
  points: [
    { requested: 37, scored: 22, pyra: 0.3462, uniform: 0.2907, deltaPP: 5.557 },
    { requested: 111, scored: 64, pyra: 0.7735, uniform: 0.7875, deltaPP: -1.409 },
  ],
  atBudget: { requested: 111, scored: 64, pyra: 0.7735, uniform: 0.7875, deltaPP: -1.409 },
  bestMargin: { requested: 37, scored: 22, pyra: 0.3462, uniform: 0.2907, deltaPP: 5.557 },
  crossoverNodes: 88,
  crossoverBracket: [77, 111],
  strideKm: 1.413744948247486,
  demandCount: 13676,
  detectKm: 15,
  minTowers: 1,
}

const gate: LightningGate = {
  cells: 40, nativeDeg: 0.5, flashes: 218, flashesPerCell: 5.45,
  viewtimeSpreadPct: 3.06413099847435,
  rateMin: 0, rateMax: 2.1898388862609863, rateMean: 0.6346980383619666,
  chi2: 118.14678899082568, dof: 39, pUniform: 6.780253488190625e-10,
  westFlashes: 75, eastFlashes: 143, eastWestRatio: 1.9066666666666667,
  pEastWest: 4.807536069149131e-6,
  spearmanRho: 0.46938486054009504, pSpearman: 0.002246710533900096,
  verdict: 'gradient',
}

describe('coverageSentence', () => {
  const s = coverageSentence({
    coveredFraction: 0.9513636910819747, strideKm: 1.413744948247486,
    demandCount: 13676, detectKm: 15,
  })

  it('says the coverage is risk-weighted', () => {
    expect(s.toLowerCase()).toContain('risk-weighted')
  })

  it('reports the scoring stride in km', () => {
    expect(s).toContain('1.41 km')
  })

  it('reports the detection radius the number was scored at', () => {
    expect(s).toContain('15 km')
  })

  it('reports the number itself', () => {
    expect(s).toContain('95.1%')
  })

  it('counts towers, not sensor rods', () => {
    expect(s.toLowerCase()).toContain('tower')
  })
})

describe('benchmarkSentence', () => {
  const s = benchmarkSentence(result)

  it('states the fairness rule as a realised count, not an identical one', () => {
    expect(s).toContain('same realised count')
    expect(s).not.toContain('identical node count')
  })

  it('names the arm that leads at the budget on screen, even when it is the grid', () => {
    expect(s.toLowerCase()).toContain('uniform grid')
    expect(s).toContain('1.4')
  })

  it('names the crossover and the best margin', () => {
    expect(s).toContain('88')
    expect(s).toContain('5.6')
  })

  it('says the risk-driven arm leads when it does', () => {
    const flipped = benchmarkSentence({ ...result, atBudget: result.bestMargin })
    expect(flipped.toLowerCase()).toContain('risk-driven')
    expect(flipped).toContain('5.6')
  })

  it('does not claim a crossover when there is none', () => {
    const s2 = benchmarkSentence({ ...result, crossoverNodes: null })
    expect(s2).not.toContain('88')
    expect(s2.toLowerCase()).toContain('never')
  })
})

describe('triangulationSentence', () => {
  const double: BenchmarkResult = {
    ...result,
    minTowers: 2,
    atBudget: { requested: 111, scored: 64, pyra: 0.109, uniform: 0.070, deltaPP: 3.933 },
    bestMargin: { requested: 111, scored: 64, pyra: 0.109, uniform: 0.070, deltaPP: 3.933 },
    crossoverNodes: null,
  }
  const s = triangulationSentence(result, double)

  it('leads with how little is triangulated, not with the margin', () => {
    // A favourable comparison on a small number is still a small number, and
    // the small number is the one a reader needs.
    expect(s.indexOf('10.9%')).toBeLessThan(s.indexOf('3.9'))
  })

  it('names the rule that produced it', () => {
    expect(s.toLowerCase()).toContain('two towers')
  })

  it('says how many towers the figure belongs to', () => {
    // The panel puts this beside a second pair measured at the full tower
    // count. Two coverage figures at different counts, neither stating its
    // count, would read as a contradiction or worse as a sleight of hand.
    expect(s).toContain('64 towers')
  })

  it('says the grid never takes the lead under this rule, when it does not', () => {
    expect(s.toLowerCase()).toContain('never')
  })

  it('does not claim that when the grid does take the lead', () => {
    const s2 = triangulationSentence(result, { ...double, crossoverNodes: 90 })
    expect(s2.toLowerCase()).not.toContain('never')
    expect(s2).toContain('90')
  })
})

describe('doubleCoverageSentence', () => {
  const arms = {
    nodeCount: 111,
    siteSingle: 0.9514, siteDouble: 0.4373,
    tunedSingle: 0.8808, tunedDouble: 0.5457,
  }
  const s = doubleCoverageSentence(arms)

  it('states both halves of the trade, not just the half that improved', () => {
    expect(s).toContain('43.7%')
    expect(s).toContain('54.6%')
    expect(s).toContain('95.1%')
    expect(s).toContain('88.1%')
  })

  it('names it a trade in words, not only in numbers', () => {
    expect(s.toLowerCase()).toMatch(/cost|trade|gives up|pay/)
  })

  it('says the two arms came from the same towers and the same pool', () => {
    expect(s).toContain('111')
    expect(s.toLowerCase()).toContain('same')
  })
})

describe('gateSentence', () => {
  const s = gateSentence(gate)

  it('quotes the sample the verdict rests on, not just the verdict', () => {
    expect(s).toContain('218')
    expect(s).toContain('40')
  })

  it('gives the coast-to-inland ratio and its significance', () => {
    expect(s).toContain('1.9')
    expect(s.toLowerCase()).toMatch(/p\s*[=<]/)
  })

  it('says the resolution is 0.5°, the number the spec first got wrong', () => {
    expect(s).toContain('0.5')
    expect(s).not.toContain('0.1°')
  })

  it('calls a flat field decorative rather than dressing it up', () => {
    const flat = gateSentence({ ...gate, verdict: 'flat', pUniform: 0.6 })
    expect(flat.toLowerCase()).toContain('decorative')
  })
})

describe('ignitionCaveat', () => {
  it('says nothing where lightning is the ignition source', () => {
    expect(ignitionCaveat(REGIONS.find((r) => r.key === 'james-bay')!)).toBeNull()
  })

  it('warns where people start the fires, naming the region', () => {
    const s = ignitionCaveat(REGIONS.find((r) => r.key === 'greece-peloponnese')!)!
    expect(s).toContain('Peloponnese')
    expect(s.toLowerCase()).toContain('human')
  })
})

describe('seedSentence', () => {
  it('says nothing when the maximum is unique', () => {
    expect(seedSentence(1)).toBeNull()
  })

  it('warns, with the count, when the seed had to be tie-broken', () => {
    const s = seedSentence(112155)!
    expect(s).toContain('112,155')
    expect(s.toLowerCase()).toContain('tie')
  })
})

describe('weightSentence', () => {
  it('states that fire weather is a single regional scalar', () => {
    const s = weightSentence({
      wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.15,
      layer: 'lightning',
    })
    expect(s.toLowerCase()).toContain('single')
    expect(s).toContain('0.20')
  })

  it('names the layer that third weight actually multiplies', () => {
    const lightning = weightSentence({
      wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.15,
      layer: 'lightning',
    })
    const fire = weightSentence({
      wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.61,
      layer: 'fire-activity',
    })
    expect(lightning.toLowerCase()).toContain('strike')
    expect(fire.toLowerCase()).toContain('fire')
    expect(fire.toLowerCase()).not.toContain('strike')
  })
})

describe('budgetSentence', () => {
  it('states what saturation means', () => {
    const s = budgetSentence({ mode: 'saturation', maxNodes: null, nodeCount: 111 })
    expect(s.toLowerCase()).toContain('saturation')
    expect(s).toContain('111')
  })

  it('states that auto is the library default and what it produced', () => {
    const s = budgetSentence({ mode: 'auto', maxNodes: 18, nodeCount: 18 })
    expect(s).toContain('18')
    expect(s.toLowerCase()).toContain('default')
  })

  it('reports both the request and the placement for a fixed budget', () => {
    const s = budgetSentence({ mode: 'fixed', maxNodes: 200, nodeCount: 187 })
    expect(s).toContain('200')
    expect(s).toContain('187')
  })
})

describe('unbakedNotice', () => {
  it('names the region and says the data is not baked', () => {
    const s = unbakedNotice('Congo Basin', ['James Bay', 'Los Padres'])
    expect(s).toContain('Congo Basin')
    expect(s.toLowerCase()).toContain('not baked')
  })

  it('names the regions that ARE baked, from the manifest rather than a memory', () => {
    // This sentence said "only Los Padres" for as long as one region was
    // baked, and would have gone on saying it after a second one appeared.
    const s = unbakedNotice('Congo Basin', ['James Bay', 'Los Padres'])
    expect(s).toContain('James Bay')
    expect(s).toContain('Los Padres')
  })
})

/** Everything the site can say, assembled once. */
function allCopy(): string {
  return [
    coverageSentence({ coveredFraction: 0.9, strideKm: 1.41, demandCount: 10, detectKm: 15 }),
    benchmarkSentence(result),
    seedSentence(9)!,
    weightSentence({ wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.15, layer: 'lightning' }),
    weightSentence({ wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.61, layer: 'fire-activity' }),
    budgetSentence({ mode: 'saturation', maxNodes: null, nodeCount: 111 }),
    gateSentence(gate),
    gateSentence({ ...gate, verdict: 'flat' }),
    triangulationSentence(result, { ...result, minTowers: 2, crossoverNodes: null }),
    doubleCoverageSentence({
      nodeCount: 111, siteSingle: 0.95, siteDouble: 0.44,
      tunedSingle: 0.88, tunedDouble: 0.55,
    }),
    unbakedNotice('Congo Basin', ['James Bay', 'Los Padres']),
    ...REGIONS.map((r) => `${r.label} ${r.country} ${r.regime} ${r.ignition}`),
    ...REGIONS.map((r) => ignitionCaveat(r) ?? ''),
  ].join(' ').toLowerCase()
}

describe('no copy overclaims the fire model', () => {
  it('never mentions fire simulation or validation', () => {
    const all = allCopy()
    for (const banned of ['fire spread', 'fire model', 'detection time',
                          'validated', 'simulated fire']) {
      expect(all).not.toContain(banned)
    }
  })
})

/**
 * The spec's section 2 constraints, as tests.
 *
 * Three of these claims were asserted in a draft, disproved by research the
 * same day, and came within one editing pass of a competition video. A
 * constraint that lives only in a document is a constraint that gets
 * forgotten at 2 a.m.
 */
describe('no copy overclaims the lightning science', () => {
  it('never quotes a current magnitude for continuing current', () => {
    // No primary source was found for "100–200 A" and the secondary
    // paraphrases disagree. The >40 ms DURATION is the attested mechanism.
    expect(allCopy()).not.toMatch(/\d+\s*(–|-|to )?\s*\d*\s*(a|amp|ampere|ka)\b/)
  })

  it('never uses polarity as a proxy for ignition', () => {
    // It points the wrong way in practice: 90% of fire-starting strokes in
    // the largest matched dataset were NEGATIVE, because negative strokes
    // vastly outnumber positive ones.
    const all = allCopy()
    expect(all).not.toContain('positive stroke')
    expect(all).not.toContain('negative stroke')
    expect(all).not.toContain('polarity')
  })

  it('never claims cloud-to-ground versus cloud-to-cloud is the discriminator', () => {
    expect(allCopy()).not.toContain('cloud-to-cloud')
  })

  it('never promises a fixed lead time before smoke', () => {
    // Holdover is minutes to weeks and gamma-distributed. Report the
    // distribution or say nothing.
    expect(allCopy()).not.toMatch(/hours? (before|ahead of) (the )?smoke/)
  })

  it('never claims novelty for the ignition science', () => {
    // Wotton & Martell has been operational in Ontario for two decades and
    // the US Forest Service publishes lightning-ignition maps. We claim the
    // deployment, not the discovery.
    const all = allCopy()
    for (const banned of ['first ever', 'world-first', 'unprecedented',
                          'never been done', 'the first system']) {
      expect(all).not.toContain(banned)
    }
  })

  it('never claims to beat electromagnetic lightning networks', () => {
    // NLDN and GLD360 are sub-kilometre and range-unlimited. Audible thunder
    // tops out near 20 km.
    const all = allCopy()
    expect(all).not.toMatch(/(better|more accurate|beats).{0,30}(nldn|gld360|lightning network)/)
  })

  it('never mentions Blitzortung, whose terms forbid this use', () => {
    expect(allCopy()).not.toContain('blitzortung')
  })
})
