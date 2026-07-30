"""Emit golden fixtures the TypeScript port must reproduce exactly.

Run from the repo root:  python -m tools.bake.export_fixtures
"""

from __future__ import annotations

import json
import os

from .refrng import RefRNG, M64

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "web", "tests", "fixtures"))

# Chosen so the Lemire rejection branch in RefRNG.integers() actually fires
# within a small, fast-to-replay window, while every emitted value stays well
# under Number.MAX_SAFE_INTEGER (2**53) so the TS side can compare with plain
# `toBe` on numbers instead of introducing a bigint comparison path just for
# this fixture. HIGH is tuned (offset search over a small range near 2**45)
# so threshold == (2**64 - HIGH) % HIGH is ~99.999998% of HIGH, which
# maximizes the per-draw rejection probability at this magnitude and keeps
# the expected number of draws-to-first-rejection near 2**19 (~524k) instead
# of the 2**24+ (~16.7M) a naively chosen HIGH near 2**45 would need.
REJECTION_HIGH = 35184372088833  # 2**45 + 524289, tuned for max threshold/HIGH
REJECTION_SEED = 999_999
REJECTION_RECORD = 8
REJECTION_SEARCH_BOUND = 5_000_000


def _write(name: str, payload: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    print("wrote", path)


def refrng_cases() -> list[dict]:
    cases = []
    for seed in (0, 1, 7, 12345):
        g = RefRNG(seed)
        cases.append({
            "seed": seed,
            "uint64": [str(g.next_uint64()) for _ in range(8)],
        })
        g = RefRNG(seed)
        cases.append({
            "seed": seed,
            "random": [float(x) for x in g.random(8)],
        })
        g = RefRNG(seed)
        cases.append({
            "seed": seed,
            "integers_high": 1000,
            "integers": [g.integers(1000) for _ in range(8)],
        })
    return cases


def rejection_case() -> dict:
    """Find and record a window where RefRNG.integers() genuinely takes the
    Lemire reject-and-retry branch, so the TS parity test exercises the one
    place the two implementations could silently diverge (e.g. an off-by-one
    between `lo >= threshold` and `lo > threshold`, or a deleted retry loop).

    Searches the *raw* next_uint64() stream (duplicating, not calling,
    RefRNG's internal accept/reject check — refrng.py itself is not touched)
    to find the first draw that would be rejected under REJECTION_HIGH, then
    re-derives the golden values via the real, public RefRNG.integers() API
    so the fixture is authoritative against the actual method under test.
    """
    threshold = (M64 + 1 - REJECTION_HIGH) % REJECTION_HIGH

    probe = RefRNG(REJECTION_SEED)
    skip = None
    for call in range(REJECTION_SEARCH_BOUND):
        x = probe.next_uint64()
        m = x * REJECTION_HIGH
        lo = m & M64
        if lo < threshold:
            skip = call
            break
    if skip is None:
        raise RuntimeError(
            f"no rejection found for seed={REJECTION_SEED} high={REJECTION_HIGH} "
            f"within {REJECTION_SEARCH_BOUND} draws; retune REJECTION_HIGH"
        )

    g = RefRNG(REJECTION_SEED)
    for _ in range(skip):
        g.integers(REJECTION_HIGH)

    draw_count = [0]
    real_next = g.next_uint64

    def counted_next():
        draw_count[0] += 1
        return real_next()

    g.next_uint64 = counted_next  # type: ignore[method-assign]

    values = []
    rejections_in_window = 0
    for _ in range(REJECTION_RECORD):
        before = draw_count[0]
        values.append(g.integers(REJECTION_HIGH))
        rejections_in_window += (draw_count[0] - before) - 1

    if rejections_in_window < 1:
        raise RuntimeError(
            "rejection window recorded zero rejections — the branch was not "
            "actually exercised; retune REJECTION_HIGH or REJECTION_RECORD"
        )

    print(
        f"rejection_case: seed={REJECTION_SEED} high={REJECTION_HIGH} "
        f"skip={skip} rejections_in_window={rejections_in_window}"
    )

    return {
        "seed": REJECTION_SEED,
        "high": REJECTION_HIGH,
        "skip": skip,
        "values": values,
        "rejections_in_window": rejections_in_window,
    }


def refrng_fixture() -> None:
    payload = {
        "cases": refrng_cases(),
        "rejection_case": rejection_case(),
    }
    _write("refrng.json", payload)


if __name__ == "__main__":
    refrng_fixture()
