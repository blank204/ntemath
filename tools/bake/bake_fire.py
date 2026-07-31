"""Simulate 100 ignitions over Los Padres and emit the sparse arrival set.

    python -m tools.bake.bake_fire

One mesh, one attribute set, one hundred ignitions -- the mesh takes no
ignition argument, so it is built once and reused, which is what makes this
affordable at all (about 180 s of mesh plus a few seconds per run).

Three corrections against the original task brief, all confirmed by
`inspect.signature` before writing the call sites below (see
task-4-report.md for the full trace):

1. ``domain.Wind`` takes ``speed_ms``/``dir_deg``, not ``speed``/``direction``.
2. ``calibrate.reference_d_ref()`` cannot be called as-is: it builds its
   reference mesh without ``clip_guard=False``, and that guard's only
   remedy (shapely) is not installed here. Its own public building blocks
   (``calibrate.flat_domain``, ``calibrate.REF_D_MIN``,
   ``calibrate.reference_spacing``) are called directly instead, exactly as
   ``tools/bake/spread_probe.py`` already does, with ``clip_guard=False``
   added to the inner ``build_mesh`` call.
3. This bake runs ``spread.simulate_ros``, which takes ``spread.PARAMS_ROS``
   (``ros0_m_min``/``wind_gain``/``lb_cap``), not ``fire.PARAMS``
   (``p0``/``c1``/``c2``, the Bernoulli-rule dict) -- handing it the wrong
   dict raises ``KeyError: 'lb_cap'``. ``fire.edge_probabilities`` is
   Bernoulli-only and this bake never calls it, so ``fire`` is not imported
   here at all.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import time

import numpy as np

from ._repo_import import repo_modules
from .fire_domain import build_domain, UTM_EPSG_LOS_PADRES
from .ignitions import IGNITION_SEED, sample_ignitions, snap_report
from ._fire_grid import DEFAULT_CELL_M, FireGrid, encode, owners_for

mesh_m, attributes, spread, calibrate, domain = repo_modules(
    "mesh", "attributes", "spread", "calibrate", "domain")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(
    HERE, "..", "..", "web", "public", "data", "los-padres"))

LOS_PADRES = (-120.3, 34.4, -119.4, 35.0)
D_MIN = 90.0
T_END_MIN = 120.0
WIND_SPEED = 8.0
WIND_DIR = 90.0
MESH_SEED = 1
#: Set by Task 2's measurement. Read docs/fire-model-choice.md before changing.
RULE = "ros"


def _reference_d_ref() -> float:
    """Reproduce ``calibrate.reference_d_ref()`` with ``clip_guard=False``.

    ``calibrate.py`` is read-root and cannot be edited; its own
    ``reference_d_ref`` calls ``mesh_m.build_mesh`` without
    ``clip_guard=False`` internally, and the guard is a universal false
    positive whose only remedy imports shapely, which is not installed in
    this environment. Its three building blocks are all public, so they are
    called directly here instead, in the same order, with the mandatory
    flag added to the inner build_mesh call.
    """
    return calibrate.reference_spacing(
        mesh_m.build_mesh(np.random.default_rng(101), calibrate.flat_domain(),
                          calibrate.REF_D_MIN, lloyd_iters=2, clip_guard=False))


def main(argv=None) -> int:
    # NOTE: domain.Wind's real fields are speed_ms/dir_deg, not the brief's
    # speed/direction -- confirmed via inspect.signature before writing this.
    wind = domain.Wind(speed_ms=WIND_SPEED, dir_deg=WIND_DIR)
    dom, prov = build_domain(LOS_PADRES, wind=wind, epsg=UTM_EPSG_LOS_PADRES)

    t0 = time.time()
    # clip_guard=False is mandatory -- the guard is a universal false
    # positive and its remedy imports shapely, which is not installed.
    m = mesh_m.build_mesh(np.random.default_rng(MESH_SEED), dom, D_MIN,
                          lloyd_iters=2, clip_guard=False)
    mesh_s = time.time() - t0
    print(f"mesh: {m.n} cells in {mesh_s:.0f}s")

    d_ref = _reference_d_ref()
    # spread.simulate_ros takes spread.PARAMS_ROS (ros0_m_min/wind_gain/
    # lb_cap), not fire.PARAMS (p0/c1/c2) -- the latter raises
    # KeyError: 'lb_cap' inside simulate_ros.
    params = dict(spread.PARAMS_ROS)
    params["t_end_min"] = T_END_MIN
    attrs = attributes.build_attributes(m, dom, dt_s=params["dt_s"], d_ref=d_ref)

    grid = FireGrid.over(dom.width, dom.height, DEFAULT_CELL_M)
    owners = owners_for(m, grid)
    xy = sample_ignitions(dom, n=100)
    # snap_report's real signature is (mesh, attrs, xy) -- it calls
    # fire.pick_seed_cell(mesh, attrs, xy) directly and needs attrs to find
    # burnable generators, unlike the brief's two-argument call site.
    snaps = snap_report(m, attrs, xy)

    west, south, east, north = LOS_PADRES
    records, entries = [], []
    offset = 0
    for k, (x, y) in enumerate(xy):
        res = spread.simulate_ros(m, attrs, wind, d_ref,
                                  seed_xy=(float(x), float(y)), params=params)
        idx, mins = encode(m, res.arrival_min, grid, owners=owners)
        records.append(np.column_stack([idx, mins]).astype("<u4"))
        entries.append({
            "lon": west + (x / dom.width) * (east - west),
            "lat": south + (y / dom.height) * (north - south),
            "xM": float(x), "yM": float(y),
            "shiftM": snaps[k]["shiftM"],
            "burntCells": int(idx.size),
            "offset": offset, "count": int(idx.size),
        })
        offset += int(idx.size)
        if (k + 1) % 10 == 0:
            print(f"  {k + 1}/100 ignitions, {offset} records so far")

    os.makedirs(OUT_DIR, exist_ok=True)
    blob = np.concatenate(records) if records else np.zeros((0, 2), dtype="<u4")
    blob.astype("<u4").tofile(os.path.join(OUT_DIR, "arrivals.bin"))

    # Task 4 must report the real-mesh snap displacements: Task 3 could only
    # measure them on a small synthetic mesh. Printed here rather than only
    # stashed in the JSON, so a large shift is visible without re-parsing.
    shifts = np.array([e["shiftM"] for e in entries], dtype=np.float64)
    print(
        f"snap shiftM: min={shifts.min():.1f} median={np.median(shifts):.1f} "
        f"max={shifts.max():.1f}  count>1000m={int(np.count_nonzero(shifts > 1000.0))}"
    )

    meta = {
        "grid": {"nx": grid.nx, "ny": grid.ny, "cellM": grid.cell_m,
                 "boxLonLat": list(LOS_PADRES),
                 "originLon": west, "originLat": south,
                 "widthM": dom.width, "heightM": dom.height},
        "rule": RULE,
        "detectRadiusBakedM": None,
        "tEndMin": T_END_MIN,
        "dMin": D_MIN,
        "meshCells": int(m.n),
        "meshSeed": MESH_SEED,
        "ignitionSeed": IGNITION_SEED,
        "wind": {"speedMs": WIND_SPEED, "directionDeg": WIND_DIR},
        "dRef": float(d_ref),
        "params": {k: (float(v) if isinstance(v, (int, float)) else v)
                   for k, v in params.items()},
        "ignitions": entries,
        "provenance": prov,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    with open(os.path.join(OUT_DIR, "arrivals.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)

    size = os.path.getsize(os.path.join(OUT_DIR, "arrivals.bin"))
    print(f"wrote {offset} records, {size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
