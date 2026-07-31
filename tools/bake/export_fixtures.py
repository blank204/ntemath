"""Emit golden fixtures the TypeScript port must reproduce exactly.

Run from the repo root:  python -m tools.bake.export_fixtures
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sys

from .refrng import RefRNG, M64

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "web", "tests", "fixtures"))

# The repo root (this checkout: "Pyra NTE", not the README's "ntemath") is a
# Python package -- it has its own __init__.py, and place.py imports geo.py
# via a relative `from .geo import ...`. That relative import only resolves
# if place.py is loaded *as a submodule of that package*.
#
# We used to get that package context by pushing the repo root's parent onto
# sys.path and importing through the checkout's on-disk directory name. That
# mutates sys.path for the whole process just from importing this module,
# and puts a filesystem root at the *front* of the search path ahead of the
# stdlib and site-packages -- a shadowing hazard for anything else that runs
# afterwards, even though nothing collides today.
#
# Instead, register the repo root as a package under a private, fixed name
# directly in sys.modules via importlib.util.spec_from_file_location, with
# submodule_search_locations pointing at the repo root. That gives place.py
# a real package context to resolve its relative import against, without
# touching sys.path or geo.py/place.py at all, and is deterministic
# regardless of what the checkout directory is named or where it lives.
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
_REPO_PKG_NAME = "_ntemath_repo"


def _repo_geo_and_place():
    """Import geo.py and place.py as submodules of a synthetic package
    aliasing the repo root, so place.py's `from .geo import ...` resolves --
    without ever touching sys.path.
    """
    if _REPO_PKG_NAME not in sys.modules:
        init_path = os.path.join(REPO_ROOT, "__init__.py")
        spec = importlib.util.spec_from_file_location(
            _REPO_PKG_NAME, init_path, submodule_search_locations=[REPO_ROOT]
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[_REPO_PKG_NAME] = module
        spec.loader.exec_module(module)
    geo = importlib.import_module(f"{_REPO_PKG_NAME}.geo")
    place = importlib.import_module(f"{_REPO_PKG_NAME}.place")
    return geo, place

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


def frame_fixture() -> None:
    geo, place = _repo_geo_and_place()
    BBox = geo.BBox
    LocalFrame = place.LocalFrame

    boxes = {
        "los-padres": BBox(-120.3, 34.4, -119.4, 35.0),
        "sweden-norrland": BBox(15.5, 63.5, 16.5, 64.1),
        "congo-basin": BBox(23.0, 0.2, 23.9, 0.9),
    }
    cases = []
    for name, box in boxes.items():
        f = LocalFrame(box)
        w, h = f.extent_km
        probes = [(box.west, box.south), (box.east, box.north),
                  (f.lon0, f.lat0), (box.west, box.north)]
        cases.append({
            "name": name,
            "box": [box.west, box.south, box.east, box.north],
            "lon0": f.lon0, "lat0": f.lat0, "kx": f.kx, "ky": f.ky,
            "extent_km": [float(w), float(h)],
            "to_km": [[float(v) for v in f.to_km(lon, lat)]
                      for lon, lat in probes],
        })
    _write("frame.json", {"cases": cases})


def poisson_fixture() -> None:
    import numpy as np

    _, place = _repo_geo_and_place()
    variable_poisson_disk = place.variable_poisson_disk

    cases = []
    for tag, ny, nx, seed, rmin, rmax in [
        ("smooth", 32, 32, 3, 1.0, 4.0),
        ("peaked", 24, 40, 11, 0.8, 6.0),
    ]:
        # A deterministic, non-trivial risk field -- no RNG, so both sides agree.
        yy, xx = np.mgrid[0:ny, 0:nx]
        u = xx / (nx - 1)
        v = yy / (ny - 1)
        risk = (0.5 + 0.5 * np.sin(3 * np.pi * u) * np.cos(2 * np.pi * v))
        if tag == "peaked":
            risk = risk ** 3

        # This grid's sin/cos symmetry produces exact float64 ties among the
        # very highest values (e.g. for the 32x32 "smooth" case, (ii=26,jj=31)
        # and (ii=5,jj=0) land on bit-identical risk). place.py's internal
        # `np.argsort(...)[::-1]` breaks such ties via quicksort's unstable,
        # undocumented internal order -- not the total order (-risk, flatIndex)
        # the TS port uses (see poisson.ts). Reproducing numpy's specific
        # quicksort tie order in TS would mean depending on an implementation
        # detail numpy itself does not guarantee across versions, so instead
        # the fixture is built to have an unambiguous single maximum: a tiny
        # monotonic-in-flat-index multiplier that only ever shrinks risk (so
        # it can never push a value past the 1.0 clip boundary and create a
        # *new* tie there), sized well above float32 rounding noise so the
        # winning pixel stays the same after the risk array is snapped to
        # float32 below.
        flat_idx = (yy * nx + xx).astype(np.float64)
        risk = risk * (1.0 - 1e-3 * flat_idx / flat_idx.max())
        risk = np.clip(risk, 0.0, 1.0)

        # web/src/lib/types.ts stores Field.risk as Float32Array. Snap here so
        # place.py computes on the exact values the TS port will read back --
        # otherwise every radius and candidate position drifts by the
        # float64-vs-float32 rounding gap, and that drift compounds across
        # the active-list chain as points get placed.
        risk = risk.astype(np.float32).astype(np.float64)

        pts = variable_poisson_disk(
            RefRNG(seed), risk, width_km=40.0, height_km=30.0,
            r_min_km=rmin, r_max_km=rmax, mask=None, k=24,
        )
        cases.append({
            "tag": tag, "ny": ny, "nx": nx, "seed": seed,
            "r_min_km": rmin, "r_max_km": rmax,
            "width_km": 40.0, "height_km": 30.0,
            "risk": [float(x) for x in risk.ravel()],
            "points": [[float(p[0]), float(p[1])] for p in pts],
        })
    _write("poisson.json", {"cases": cases})


if __name__ == "__main__":
    refrng_fixture()
    frame_fixture()
    poisson_fixture()
