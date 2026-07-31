"""Run place.py over the committed rasters and print what it gets.

    python -m tools.bake.verify_parity

This is the Python half of the parity claim. The TypeScript suite asserts
the same numbers as hand-written literals; if the two ever disagree, one of
them changed and the site is misreporting the team's own model. Do not
"fix" a disagreement by copying this output into the test -- find the cause.
"""

from __future__ import annotations

import hashlib
import json
import os

import numpy as np

from ._repo_import import repo_modules
from .refrng import RefRNG

place, plan = repo_modules("place", "plan")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "..", "web", "public", "data"))

#: The Lab's defaults. plan_region's saturation regime gives the spacing:
#: detect_km * 0.55 and detect_km * 1.30. demand_stride 4 matches
#: web/src/state/useModelStore.ts:DEFAULT_PARAMS.
DEFAULTS = dict(seed=7, detect_km=2.0, r_min_km=1.1, r_max_km=2.6,
                target=0.95, demand_stride=4)


def _load(region: str):
    d = os.path.join(DATA, region)
    with open(os.path.join(d, "meta.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    ny, nx = meta["ny"], meta["nx"]
    risk = np.fromfile(os.path.join(d, "risk.bin"), dtype="<f4").reshape(ny, nx)
    mask = np.fromfile(os.path.join(d, "mask.bin"),
                       dtype=np.uint8).reshape(ny, nx).astype(bool)
    return meta, risk, mask


def run(region: str = "los-padres", **over) -> dict:
    p = dict(DEFAULTS, **over)
    meta, risk, mask = _load(region)
    w_km, h_km = meta["widthKm"], meta["heightKm"]

    cand = place.variable_poisson_disk(
        RefRNG(p["seed"]), risk, w_km, h_km, p["r_min_km"], p["r_max_km"],
        mask=mask, k=24,
    )
    dem_xy, dem_w = place.demand_points(risk, mask, w_km, h_km,
                                        stride=p["demand_stride"])
    cov = place.greedy_minimise(cand, dem_xy, dem_w, p["detect_km"],
                                target=p["target"])
    chosen = [int(i) for i in cov.chosen]
    n_cand = int(len(cand))
    return {
        "region": region,
        "params": p,
        "seedFlatIndex": meta["seedFlatIndex"],
        "demandCount": int(len(dem_w)),
        "candidateCount": n_cand,
        "nodeCount": len(chosen),
        "coveredFraction": repr(float(cov.covered_fraction)),
        "areaFraction": repr(float(cov.area_fraction)),
        "reductionPct": repr(100.0 * (1.0 - len(chosen) / n_cand)),
        "chosenSha256": hashlib.sha256(
            ",".join(str(i) for i in chosen).encode()).hexdigest(),
        "firstTenChosen": chosen[:10],
    }


def run_auto_budget(region: str = "los-padres", **over) -> dict:
    """The budgeted regime, sequenced exactly as plan_region sequences it.

    The saturation run above is the only one Plan 1 ever pinned, so the whole
    of Plan 2's Task 6 -- auto and fixed -- rested on two figures measured by
    hand and pasted into a TypeScript test. This regenerates them, and the
    network they imply, from place.py and plan.py themselves.

    plan_region's budgeted path, in order (plan.py:252-264):
        burn_km2  = burn.mean() * box.area_km2
        n_budget  = auto_budget(burn_km2, risk[burn].mean(), budget_lo, budget_hi)
        spread    = sqrt(max(burn_km2, 1.0) / max(n_budget, 1))
        r_min_km  = spread * 0.45 ; r_max_km = spread * 1.10
        target    = 1.01  -- unreachable on purpose, so the node cap binds
    """
    p = dict(DEFAULTS, **over)
    meta, risk, mask = _load(region)
    w_km, h_km = meta["widthKm"], meta["heightKm"]

    burn_km2 = float(mask.mean()) * meta["areaKm2"]
    mean_risk = float(risk[mask].mean())
    n_budget = plan.auto_budget(burn_km2, mean_risk,
                                meta["budgetLo"], meta["budgetHi"])
    spread = np.sqrt(max(burn_km2, 1.0) / max(n_budget, 1))
    r_min_km = float(spread * 0.45)
    r_max_km = float(spread * 1.10)

    cand = place.variable_poisson_disk(
        RefRNG(p["seed"]), risk, w_km, h_km, r_min_km, r_max_km,
        mask=mask, k=24,
    )
    dem_xy, dem_w = place.demand_points(risk, mask, w_km, h_km,
                                        stride=p["demand_stride"])
    cov = place.greedy_minimise(cand, dem_xy, dem_w, p["detect_km"],
                                target=1.01, max_nodes=n_budget)
    chosen = [int(i) for i in cov.chosen]
    return {
        "region": region,
        "mode": "auto",
        # The two figures web/tests/pipeline.test.ts pins the TS pipeline to.
        "burnKm2": repr(burn_km2),
        "meanRiskBurnable": repr(mean_risk),
        "nBudget": int(n_budget),
        "rMinKm": repr(r_min_km),
        "rMaxKm": repr(r_max_km),
        "candidateCount": int(len(cand)),
        "nodeCount": len(chosen),
        "coveredFraction": repr(float(cov.covered_fraction)),
        "areaFraction": repr(float(cov.area_fraction)),
        "chosenSha256": hashlib.sha256(
            ",".join(str(i) for i in chosen).encode()).hexdigest(),
    }


def main(argv=None) -> int:
    print(json.dumps({"saturation": run(), "auto": run_auto_budget()}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
