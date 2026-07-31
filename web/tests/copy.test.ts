import { describe, it, expect } from 'vitest'
import {
  coverageSentence, benchmarkSentence, seedSentence, weightSentence,
  budgetSentence, unbakedNotice,
} from '../src/ui/copy'
import type { BenchmarkResult } from '../src/lib/benchmark'

const result: BenchmarkResult = {
  points: [
    { requested: 170, scored: 157, pyra: 0.414, uniform: 0.378, deltaPP: 3.614 },
    { requested: 572, scored: 526, pyra: 0.9276, uniform: 0.9693, deltaPP: -4.175 },
  ],
  atBudget: { requested: 572, scored: 526, pyra: 0.9276, uniform: 0.9693, deltaPP: -4.175 },
  bestMargin: { requested: 170, scored: 157, pyra: 0.414, uniform: 0.378, deltaPP: 3.614 },
  crossoverNodes: 270,
  crossoverBracket: [170, 572],
  strideKm: 0.36608429859016334,
  demandCount: 31045,
  detectKm: 2,
}

describe('coverageSentence', () => {
  const s = coverageSentence({
    coveredFraction: 0.950127412638781, strideKm: 0.36608429859016334,
    demandCount: 31045, detectKm: 2,
  })

  it('says the coverage is risk-weighted', () => {
    expect(s.toLowerCase()).toContain('risk-weighted')
  })

  it('reports the scoring stride in km', () => {
    expect(s).toContain('0.37 km')
  })

  it('reports the detection radius the number was scored at', () => {
    expect(s).toContain('2 km')
  })

  it('reports the number itself', () => {
    expect(s).toContain('95.0%')
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
    expect(s).toContain('4.2')
  })

  it('names the crossover and the best margin', () => {
    expect(s).toContain('270')
    expect(s).toContain('3.6')
  })

  it('says the risk-driven arm leads when it does', () => {
    const flipped = benchmarkSentence({ ...result, atBudget: result.bestMargin })
    expect(flipped.toLowerCase()).toContain('risk-driven')
    expect(flipped).toContain('3.6')
  })

  it('does not claim a crossover when there is none', () => {
    const s2 = benchmarkSentence({ ...result, crossoverNodes: null })
    expect(s2).not.toContain('270')
    expect(s2.toLowerCase()).toContain('never')
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
    const s = weightSentence({ wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.61 })
    expect(s.toLowerCase()).toContain('single')
    expect(s).toContain('0.20')
  })
})

describe('budgetSentence', () => {
  it('states what saturation means', () => {
    const s = budgetSentence({ mode: 'saturation', maxNodes: null, nodeCount: 572 })
    expect(s.toLowerCase()).toContain('saturation')
    expect(s).toContain('572')
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
    const s = unbakedNotice('Congo Basin')
    expect(s).toContain('Congo Basin')
    expect(s.toLowerCase()).toContain('not baked')
  })
})

describe('no copy overclaims the fire model', () => {
  it('never mentions fire simulation or validation', () => {
    const all = [
      coverageSentence({ coveredFraction: 0.9, strideKm: 0.37, demandCount: 10, detectKm: 2 }),
      benchmarkSentence(result),
      seedSentence(9)!,
      weightSentence({ wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.61 }),
      budgetSentence({ mode: 'saturation', maxNodes: null, nodeCount: 572 }),
      unbakedNotice('Congo Basin'),
    ].join(' ').toLowerCase()
    for (const banned of ['fire spread', 'fire model', 'detection time',
                          'validated', 'simulated fire']) {
      expect(all).not.toContain(banned)
    }
  })
})
