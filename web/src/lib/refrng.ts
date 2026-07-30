/**
 * xoshiro256** seeded through SplitMix64 — the TypeScript half of the shared
 * reference generator. Must stay byte-identical to tools/bake/refrng.py;
 * tests/refrng.test.ts enforces that against committed fixtures.
 *
 * BigInt is used deliberately. Number cannot hold 64 bits exactly, and an
 * approximate RNG would silently desynchronise the two implementations.
 */
const M64 = (1n << 64n) - 1n

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & M64
}

export class RefRNG {
  private s: [bigint, bigint, bigint, bigint]

  constructor(seed: number | bigint) {
    let z = BigInt(seed) & M64
    const out: bigint[] = []
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b97f4a7c15n) & M64
      let x = z
      x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & M64
      x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & M64
      out.push(x ^ (x >> 31n))
    }
    this.s = [out[0], out[1], out[2], out[3]]
  }

  nextUint64(): bigint {
    let [s0, s1, s2, s3] = this.s
    const result = (rotl((s1 * 5n) & M64, 7n) * 9n) & M64
    const t = (s1 << 17n) & M64
    s2 ^= s0
    s3 ^= s1
    s1 ^= s2
    s0 ^= s3
    s2 ^= t
    s3 = rotl(s3, 45n)
    this.s = [s0, s1, s2, s3]
    return result
  }

  /** Float64 in [0,1) using the same 53-bit construction as numpy. */
  random(): number {
    return Number(this.nextUint64() >> 11n) * Math.pow(2, -53)
  }

  randomArray(k: number): Float64Array {
    const a = new Float64Array(k)
    for (let i = 0; i < k; i++) a[i] = this.random()
    return a
  }

  /** Unbiased integer in [0, high) via Lemire's method. */
  integers(high: number): number {
    const h = BigInt(Math.trunc(high))
    if (h <= 0n) throw new Error('high must be positive')
    const threshold = ((1n << 64n) - h) % h
    for (;;) {
      const x = this.nextUint64()
      const m = x * h
      const lo = m & M64
      if (lo >= threshold) return Number(m >> 64n)
    }
  }
}
