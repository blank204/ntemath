"""Emit golden fixtures the TypeScript port must reproduce exactly.

Run from the repo root:  python -m tools.bake.export_fixtures
"""

from __future__ import annotations

import json
import os

from ._repo_import import repo_modules
from .refrng import RefRNG, M64

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "web", "tests", "fixtures"))


def _repo_geo_and_place():
    """Import geo.py and place.py as submodules of a synthetic package
    aliasing the repo root, so place.py's `from .geo import ...` resolves --
    without ever touching sys.path. See ``_repo_import.repo_modules`` for why.
    """
    return repo_modules("geo", "place")

# Chosen so the Lemire rejection branch in RefRNG.integers() actually fires
# within a small, fast-to-replay window, while every emitted value stays well
# under Number.MAX_SAFE_INTEGER (2**53) so the TS side can compare with plain
# `toBe` on numbers instead of introducing a bigint comparison path just for
# this fixture. HIGH is tuned (offset search over a small range near 2**45)
# so threshold == (2**64 - HIGH) % HIGH is ~99.999998% of HIGH, which
# maximizes the per-draw rejection probability at this magnitude and keeps
# the expected number of draws-to-first-rejection near 2**19 (~524k) instead
# of the 2**24+ (~16.7M) a naively chosen HIGH near 2**45 would need.
REJECTION_HIGH = 35184372088833  # 2**45 + 1, tuned for max threshold/HIGH
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

        # web/src/lib/types.ts stores Field.data as Float32Array, and
        # risk.bin ships as "<f4", so keep this array float32 -- dtype and
        # all, not merely float32-*valued*.
        #
        # The dtype matters as much as the values. Under NEP 50 (numpy >=
        # 2.0) a Python float is a weak scalar, so place.py:108's
        # `r_max_km - (r_max_km - r_min_km) * _sample_field(risk, ...)`
        # narrows to float32 when `risk` is float32 and stays float64 when it
        # is not. A float64 array carrying float32 values would therefore
        # make this fixture pin the *wrong* arithmetic: the reference would
        # compute radii in double while the browser computes them in single.
        # web/src/lib/field.ts mirrors the narrowing with Math.fround; this
        # is the reference that holds it honest.
        risk = risk.astype(np.float32)

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

    # float32 dtype, not just float32 values -- same standing rule as
    # poisson_fixture, and for the same NEP-50 reason documented there: the
    # radius closure in place.py narrows to float32 only when `risk` really
    # is float32, which is what risk.bin ships and what Field.data holds.
    # (greedy_minimise and coverage_of both do `np.asarray(demand_w, float)`,
    # so the weight sums stay float64 either way -- the dtype change moves
    # the radius arithmetic only.)
    risk = risk.astype(np.float32)
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

    # target=0.95 is unreachable with this candidate pool (full_w caps at
    # ~0.8467), so that run only ever exits by exhausting the CELF heap --
    # the target-reached branch of greedy_minimise's while-loop guard is
    # never taken. Run the same cand/dxy/dw a second time with a target this
    # pool *can* reach, so the fixture also exercises (and the TS port must
    # also reproduce) the exit path production actually takes.
    cov_lo = greedy_minimise(cand, dxy, dw, radius_km=2.0, target=0.5)

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
        "per_node_gain": [float(x) for x in cov.per_node_gain],
        "full_pool_coverage": [float(full_w), float(full_a)],
        "target_low": 0.5,
        "chosen_low": [int(i) for i in cov_lo.chosen],
        "covered_fraction_low": float(cov_lo.covered_fraction),
    })


def recombine_fixture() -> None:
    """Small, hand-built cases pinning the recombination at several weights.

    Deliberately not real data: the real-data case is the bit-for-bit test in
    web/tests/risk.test.ts, which reads the committed rasters directly. These
    cases exist to exercise weight settings the shipped raster cannot -- zero
    activity weight, zero base weight, a nonzero fwiNorm, and a peak that lands
    on a grassland pixel rather than a tree pixel.
    """
    import numpy as np

    forest, plan = repo_modules("forest", "plan")

    # Codes chosen to span the flammability table: tree, shrub, grass, crop,
    # moss, water (flammability 0), built (flammability 0).
    classes = np.array([
        [10, 20, 30, 40],
        [100, 80, 50, 10],
        [30, 30, 10, 20],
    ], dtype=np.uint8)
    ny, nx = classes.shape
    activity32 = np.ascontiguousarray(
        (np.arange(ny * nx, dtype=np.float64).reshape(ny, nx) / (ny * nx - 1)),
        dtype="<f4",
    )
    activity = activity32.astype(np.float64)

    cases = []
    for fwi_norm, w_weather, w_activity in [
        (0.6103508388605902, 0.45, 0.35),   # the shipped default
        (0.6103508388605902, 0.45, 0.00),   # activity off: a huge plateau
        (0.0, 0.00, 1.00),                  # base off: pure activity
        (1.0, 1.00, 0.00),                  # weather saturated
        (0.25, 0.10, 0.60),                 # an off-centre pair
    ]:
        w_base = 1.0 - w_weather - w_activity
        r = plan.risk_field(classes, activity, fwi_norm,
                            w_weather=w_weather, w_activity=w_activity,
                            w_base=w_base)
        flam = forest.flammability_field(classes)
        drive = (w_base + w_weather * float(np.clip(fwi_norm, 0, 1))
                 + w_activity * activity)
        peak = float((flam * drive).max())
        cases.append({
            "fwiNorm": fwi_norm,
            "wWeather": w_weather, "wActivity": w_activity, "wBase": w_base,
            "peak": peak,
            # float32 exactly as the browser will hold it
            "risk32": [float(x) for x in
                       np.ascontiguousarray(r, dtype="<f4").ravel()],
        })

    _write("recombine.json", {
        "nx": int(nx), "ny": int(ny),
        "classes": [int(c) for c in classes.ravel()],
        "activity32": [float(a) for a in activity32.ravel()],
        "flammability": {str(int(k)): float(v)
                         for k, v in forest.FLAMMABILITY.items()},
        "burnableClasses": [int(c) for c in forest.BURNABLE],
        "cases": cases,
    })


if __name__ == "__main__":
    refrng_fixture()
    frame_fixture()
    poisson_fixture()
    cover_fixture()
    recombine_fixture()
