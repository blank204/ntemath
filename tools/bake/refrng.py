"""A small, fully-specified RNG shared by the Python and TypeScript sides.

``place.variable_poisson_disk`` takes its generator as an argument and uses
only ``.random(k)`` and ``.integers(high)``.  Passing this instead of
``numpy.random.default_rng`` makes the browser reproduce the Python stream
exactly, without porting PCG64 or SeedSequence and without touching place.py.

Algorithm: xoshiro256** seeded through SplitMix64.  Both are short, public,
and unambiguous, which is the whole point of choosing them.
"""

from __future__ import annotations

import numpy as np

M64 = (1 << 64) - 1


def _rotl(x: int, k: int) -> int:
    return ((x << k) | (x >> (64 - k))) & M64


class RefRNG:
    """xoshiro256** with a numpy-Generator-shaped surface."""

    def __init__(self, seed: int):
        s = seed & M64
        self.s = []
        for _ in range(4):
            s = (s + 0x9E3779B97F4A7C15) & M64
            z = s
            z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & M64
            z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & M64
            self.s.append(z ^ (z >> 31))

    def next_uint64(self) -> int:
        s0, s1, s2, s3 = self.s
        result = (_rotl((s1 * 5) & M64, 7) * 9) & M64
        t = (s1 << 17) & M64
        s2 ^= s0
        s3 ^= s1
        s1 ^= s2
        s0 ^= s3
        s2 ^= t
        s3 = _rotl(s3, 45)
        self.s = [s0, s1, s2, s3]
        return result

    def random(self, k=None):
        """Float64 in [0,1) — the same 53-bit construction numpy uses."""
        if k is None:
            return (self.next_uint64() >> 11) * (2.0 ** -53)
        return np.array([(self.next_uint64() >> 11) * (2.0 ** -53)
                         for _ in range(int(k))], dtype=float)

    def integers(self, high: int) -> int:
        """Unbiased integer in [0, high) via Lemire's method."""
        high = int(high)
        if high <= 0:
            raise ValueError("high must be positive")
        threshold = ((1 << 64) - high) % high
        while True:
            x = self.next_uint64()
            m = x * high
            lo = m & M64
            if lo >= threshold:
                return m >> 64
