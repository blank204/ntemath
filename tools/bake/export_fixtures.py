"""Emit golden fixtures the TypeScript port must reproduce exactly.

Run from the repo root:  python -m tools.bake.export_fixtures
"""

from __future__ import annotations

import json
import os

from .refrng import RefRNG

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "web", "tests", "fixtures"))


def _write(name: str, payload: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    print("wrote", path)


def refrng_fixture() -> None:
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
    _write("refrng.json", {"cases": cases})


if __name__ == "__main__":
    refrng_fixture()
