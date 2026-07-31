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


def _resolve_seed_flat_index(risk, mask) -> int:
    """Exactly mirrors the seed-selection loop inside
    place.variable_poisson_disk -- same `np.argsort(risk, axis=None)[::-1]`
    call over the same array, same `allowed()` mask threshold -- so the
    fixture can hand the TS port the flat index place.py's *real* internal
    loop actually lands on, instead of depending on argsort's undocumented,
    unstable tie-break order to agree with a second implementation.

    place.py is not touched: this duplicates its seed loop with the same
    numpy primitives over the same data, so whatever numpy's argsort does
    with ties is captured verbatim rather than approximated.
    """
    import numpy as np

    ny, nx = risk.shape
    order = np.argsort(risk, axis=None)[::-1]
    for flat in order[: max(1, risk.size // 4)]:
        jj, ii = np.unravel_index(flat, risk.shape)
        if mask is None:
            return int(flat)
        u = (ii + 0.5) / nx
        v = (jj + 0.5) / ny
        mny, mnx = mask.shape
        j = min(max(int(v * (mny - 1)), 0), mny - 1)
        i = min(max(int(u * (mnx - 1)), 0), mnx - 1)
        if bool(mask[j, i]):
            return int(flat)
    raise RuntimeError("no allowed seed pixel found while resolving seed_flat_index")


def poisson_fixture() -> None:
    import numpy as np

    _, place = _repo_geo_and_place()
    variable_poisson_disk = place.variable_poisson_disk

    cases = []
    for tag, ny, nx, seed, rmin, rmax, mask_kind in [
        ("smooth", 32, 32, 3, 1.0, 4.0, None),
        ("peaked", 24, 40, 11, 0.8, 6.0, None),
        ("plateau", 40, 40, 21, 1.0, 4.0, None),
        ("masked", 32, 32, 13, 1.0, 4.0, "exclude_top_bottom_rows"),
    ]:
        yy, xx = np.mgrid[0:ny, 0:nx]
        u = xx / (nx - 1)
        v = yy / (ny - 1)

        if tag == "plateau":
            # Mirrors the real pipeline, not just a synthetic edge case:
            # hazard.activity_field returns an all-zero array whenever a box
            # has no FIRMS detections above confidence 40 -- routine, since
            # the open feed only spans 7 days. With activity zero,
            # plan.risk_field's `drive` term collapses to a scalar constant,
            # so every burnable (TREE/SHRUB, flammability 1.00) pixel ties at
            # risk == 1.0. Reproduced directly here as a fully uniform field
            # -- confirmed (not assumed) that on this exact array, numpy's
            # argsort()[::-1] picks the *last* flat index (1599 for a 40x40
            # grid) as its rank-0 candidate, not the lowest-flat-index pixel
            # a naive total-order fallback would pick -- so this case is a
            # genuine regression test for the explicit-seed fix, not one
            # that happens to agree with the fallback by coincidence.
            risk = np.full((ny, nx), 1.0)
        else:
            risk = 0.5 + 0.5 * np.sin(3 * np.pi * u) * np.cos(2 * np.pi * v)
            if tag == "peaked":
                risk = risk ** 3
            risk = np.clip(risk, 0.0, 1.0)
            # NOTE: this grid's sin/cos symmetry produces exact float64 ties
            # among the very highest values on purpose -- that is the shape
            # real risk fields take (see the "plateau" case above), so the
            # fixture is left carrying genuine ties rather than perturbed
            # away from them. The seed pixel is resolved explicitly below
            # instead of relying on a second sort implementation to agree
            # with numpy's unstable tie-break.

        # web/src/lib/types.ts stores Field.data as Float32Array. Snap here
        # so place.py computes on the exact values the TS port will read
        # back -- otherwise every radius and candidate position drifts by
        # the float64-vs-float32 rounding gap, and that drift compounds
        # across the active-list chain as points get placed. Confirmed as
        # the standing rule for fixtures that feed a Field: the reference
        # must compute on the exact values the consumer will hold.
        risk = risk.astype(np.float32).astype(np.float64)

        mask = None
        if mask_kind == "exclude_top_bottom_rows":
            # A non-trivial mask, verified (not assumed) to exclude the
            # argsort-descending rank-0 candidate (row v=0, where
            # cos(2*pi*v)=1 hits the field's maximum) so the seed loop's
            # t > 0 allowed-pixel scan actually executes -- that path is
            # otherwise dead code under test, since mask=None always accepts
            # the first candidate. Also exercises the real pipeline shape:
            # mask=burn is always passed, never None.
            mask = np.ones((ny, nx), dtype=bool)
            mask[0, :] = False
            mask[-1, :] = False

        seed_flat_index = _resolve_seed_flat_index(risk, mask)

        pts = variable_poisson_disk(
            RefRNG(seed), risk, width_km=40.0, height_km=30.0,
            r_min_km=rmin, r_max_km=rmax, mask=mask, k=24,
        )
        cases.append({
            "tag": tag, "ny": ny, "nx": nx, "seed": seed,
            "r_min_km": rmin, "r_max_km": rmax,
            "width_km": 40.0, "height_km": 30.0,
            "risk": [float(x) for x in risk.ravel()],
            "mask": ([bool(x) for x in mask.ravel()] if mask is not None else None),
            "seed_flat_index": seed_flat_index,
            "points": [[float(p[0]), float(p[1])] for p in pts],
        })
    _write("poisson.json", {"cases": cases})


def cover_fixture() -> None:
    import numpy as np

    _, place = _repo_geo_and_place()
    coverage_of = place.coverage_of
    demand_points = place.demand_points
    greedy_minimise = place.greedy_minimise
    variable_poisson_disk = place.variable_poisson_disk

    ny, nx = 28, 36
    yy, xx = np.mgrid[0:ny, 0:nx]
    u = xx / (nx - 1)
    v = yy / (ny - 1)
    risk = np.clip(0.5 + 0.5 * np.sin(3 * np.pi * u) * np.cos(2 * np.pi * v), 0, 1)

    # web/src/lib/types.ts stores Field.data as Float32Array, so the browser
    # computes on float32 risk values. Snap here -- same standing rule as
    # poisson_fixture -- so place.py's candidate placement, demand sampling,
    # and coverage scoring all run on the exact values the TS port will read
    # back, instead of drifting from a float64 reference.
    risk = risk.astype(np.float32).astype(np.float64)
    mask = risk > 0.15

    w_km, h_km = 40.0, 30.0
    # place.py's variable_poisson_disk seeds by scanning
    # `np.argsort(risk, axis=None)[::-1]`, an unstable sort. Resolve the flat
    # index that loop actually lands on so the fixture can hand the TS port
    # an explicit seed rather than depending on a second sort implementation
    # to agree with numpy's tie-break order (see _resolve_seed_flat_index).
    seed_flat_index = _resolve_seed_flat_index(risk, mask)

    cand = variable_poisson_disk(RefRNG(5), risk, w_km, h_km, 1.0, 5.0,
                                 mask=mask, k=24)
    dxy, dw = demand_points(risk, mask, w_km, h_km, stride=2)
    cov = greedy_minimise(cand, dxy, dw, radius_km=2.0, target=0.95)
    full_w, full_a = coverage_of(cand, dxy, dw, radius_km=2.0)

    _write("cover.json", {
        "ny": ny, "nx": nx, "width_km": w_km, "height_km": h_km,
        "stride": 2, "radius_km": 2.0, "target": 0.95, "seed": 5,
        "r_min_km": 1.0, "r_max_km": 5.0,
        "seed_flat_index": seed_flat_index,
        "risk": [float(x) for x in risk.ravel()],
        "mask": [bool(x) for x in mask.ravel()],
        "candidates": [[float(p[0]), float(p[1])] for p in cand],
        "demand_xy": [[float(p[0]), float(p[1])] for p in dxy],
        "demand_w": [float(x) for x in dw],
        "chosen": [int(i) for i in cov.chosen],
        "covered_fraction": float(cov.covered_fraction),
        "area_fraction": float(cov.area_fraction),
        "full_pool_coverage": [float(full_w), float(full_a)],
    })


if __name__ == "__main__":
    refrng_fixture()
    frame_fixture()
    poisson_fixture()
    cover_fixture()
