import { describe, it, expect } from 'vitest'
import { buildDone } from '../src/workers/place.worker'
import { loadLosPadres, DEFAULT_TEST_PARAMS } from './helpers/losPadres'

/**
 * The worker's transfer list is the riskiest line in the app: it fails at
 * runtime with a DataCloneError or a silently truncated raster, and passes
 * every type check on the way there. `buildDone` exists so it can be tested
 * without a Worker.
 */
describe('buildDone', () => {
  const built = buildDone(7, loadLosPadres(), DEFAULT_TEST_PARAMS)

  it('carries the placement and the benchmark under the run id it was given', () => {
    expect(built.message.type).toBe('done')
    expect(built.message.runId).toBe(7)
    expect(built.message.result.nodeCount).toBe(572)
    expect(built.message.benchmark.atBudget.scored).toBe(526)
    expect(built.message.benchmark.crossoverNodes).toBe(285)
  }, 300000)

  it('carries the double-coverage curve beside the single one', () => {
    // Both rules, from one run, on one set of demand points — otherwise the
    // two numbers on screen would come from different placements and the
    // comparison between them would mean nothing.
    expect(built.message.benchmark.minTowers).toBe(1)
    expect(built.message.triangulation.minTowers).toBe(2)
    expect(built.message.triangulation.atBudget.scored)
      .toBe(built.message.benchmark.atBudget.scored)
    expect(built.message.triangulation.atBudget.pyra)
      .toBeLessThan(built.message.benchmark.atBudget.pyra)
  }, 300000)

  it('transfers three distinct buffers, each owning the whole of its own', () => {
    // Distinct: postMessage throws DataCloneError on a duplicate transferable,
    // which would happen the moment two of these views shared a buffer.
    expect(new Set(built.transfer).size).toBe(3)

    // Whole-buffer: a view created by subarray() would hand away its parent's
    // slack too, detaching memory the sender still believes it owns. Every one
    // of these is a freshly allocated exact-size array — assert that, so a
    // later refactor to subarray() is caught here rather than in a browser.
    const views = [
      built.message.result.candidates,
      built.message.result.nodes,
      built.message.result.risk.data,
    ]
    for (const v of views) {
      expect(v.byteOffset).toBe(0)
      expect(v.byteLength).toBe(v.buffer.byteLength)
    }
    expect(views.map((v) => v.buffer)).toEqual(built.transfer)
  }, 300000)

  it('leaves nothing in the benchmark pointing back at a transferred buffer', () => {
    // If BenchmarkResult held a view onto `nodes` or `risk`, transferring them
    // would detach it and the main thread would read zeros. Every field is a
    // number or a plain object of numbers.
    const b = built.message.benchmark
    for (const p of [...b.points, b.atBudget, b.bestMargin]) {
      for (const v of Object.values(p)) expect(typeof v).toBe('number')
    }
    expect(ArrayBuffer.isView(b.points as unknown as ArrayBufferView)).toBe(false)
  }, 300000)
})
