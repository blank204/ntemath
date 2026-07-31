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

place, = repo_modules("place")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "..", "web", "public", "data"))

#: The Lab's defaults. plan_region's saturation regime gives the spacing:
#: detect_km * 0.55 and detect_km * 1.30. demand_stride 4 matches
#: web/src/state/useModelStore.ts:DEFAULT_PARAMS.
DEFAULTS = dict(seed=7, detect_km=2.0, r_min_km=1.1, r_max_km=2.6,
                target=0.95, demand_stride=4)


def run(region: str = "los-padres", **over) -> dict:
    p = dict(DEFAULTS, **over)
    d = os.path.join(DATA, region)
    with open(os.path.join(d, "meta.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    ny, nx = meta["ny"], meta["nx"]
    risk = np.fromfile(os.path.join(d, "risk.bin"), dtype="<f4").reshape(ny, nx)
    mask = np.fromfile(os.path.join(d, "mask.bin"),
                       dtype=np.uint8).reshape(ny, nx).astype(bool)
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


def main(argv=None) -> int:
    print(json.dumps(run(), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
