"""Bake one region's model inputs into static files the web app can fetch.

    python -m tools.bake.bake_region --region los-padres
    python -m tools.bake.bake_region --all

The heavy dependencies (GDAL via rasterio, the FIRMS and Open-Meteo feeds)
live here and only here. The browser never sees them -- it receives a risk
raster, a burnable mask, and a resolved placement seed, and runs the same
placement algorithm ``place.py`` runs, on those exact values.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os

import numpy as np

from ._repo_import import repo_modules
from .export_fixtures import _resolve_seed_flat_index

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.abspath(
    os.path.join(HERE, "..", "..", "web", "public", "data")
)

forest, hazard, plan = repo_modules("forest", "hazard", "plan")
REGIONS = plan.REGIONS
normalise_fwi = plan.normalise_fwi
risk_field = plan.risk_field


def bake(name: str, max_px: int = 900) -> str:
    box = REGIONS[name]
    print(f"[{name}] {box.width_km:.0f} x {box.height_km:.0f} km "
          f"({box.area_km2:,.0f} km2)")

    # read_landcover returns a 3-tuple, not an array: (classes, transform
    # bounds, missing tiles). classes is None when the box is probably all
    # ocean -- WorldCover only publishes land, so that's the one legitimate
    # way this fails, and it needs a clear error rather than an AttributeError
    # three lines later.
    classes, _, missing = forest.read_landcover(box, max_px=max_px)
    if classes is None:
        raise RuntimeError(
            f"no WorldCover data for {name} {box} (missing tiles {missing}) "
            "-- this box is probably entirely ocean"
        )
    mask = forest.burnable_mask(classes)
    print(f"  land cover {classes.shape}, "
          f"forest {100 * forest.forest_fraction(classes):.1f}%"
          + (f", missing tiles {missing}" if missing else ""))

    # NOTE the argument order: box comes FIRST in both of these.
    dets = hazard.fetch_firms()
    local = hazard.detections_in(box, dets)
    n_local = 0 if local is None else len(local)
    activity = hazard.activity_field(box, dets, classes.shape)

    # Same date window plan_region uses: end = today - 7d, start = end - 180d.
    # peak_fwi_for_points takes a LIST OF (lon, lat) POINTS, not a box, and
    # returns an array -- one point (the region centre) is enough at ERA5's
    # ~25 km resolution for boxes this size.
    end = (dt.date.today() - dt.timedelta(days=7)).isoformat()
    start = (dt.date.fromisoformat(end) - dt.timedelta(days=180)).isoformat()
    lon0, lat0 = box.centre
    fwi = float(hazard.peak_fwi_for_points([(lon0, lat0)], start, end)[0])
    fwi_norm = normalise_fwi(fwi)
    print(f"  FIRMS in box: {n_local}   FWI p90 ({start}..{end}): {fwi:.1f}")

    risk = risk_field(classes, activity, fwi_norm)

    # Snap to float32 BEFORE anything else consumes it. risk.bin is float32
    # on disk and the browser's placement algorithm runs on those exact
    # bits. Computing the seed (or any other downstream statistic) on the
    # float64 risk_field() output and only narrowing on write would leave
    # every value ~1.2e-7 off from what the browser reads back, and
    # place.py's radius/position math compounds that drift across the
    # active-list chain -- so every value used from here on is the snapped
    # one, never the float64 original.
    risk32 = np.ascontiguousarray(risk, dtype="<f4")
    mask8 = np.ascontiguousarray(mask.astype(np.uint8))

    # place.variable_poisson_disk seeds its blue-noise sampler by scanning
    # np.argsort(risk, axis=None)[::-1] for the highest-risk allowed pixel.
    # numpy's argsort is unstable quicksort, and on real data ties are the
    # *normal* case: whenever a box has no FIRMS detections above confidence
    # 40, activity is all zeros, risk_field's `drive` term collapses to a
    # scalar, and risk is exactly 1.0 at every tree/shrub pixel -- so the
    # seed pixel argsort lands on is implementation-defined and the browser
    # cannot reproduce it by sorting. Resolve the actual index place.py's
    # loop would land on -- over the float32-snapped array, mask included --
    # with the same helper export_fixtures.py uses, and ship it as data.
    risk64_snapped = risk32.astype(np.float64)
    burn_mask_bool = mask.astype(bool)
    ties_at_max = int(np.count_nonzero(risk32 == risk32.max()))
    seed_flat_index = _resolve_seed_flat_index(risk64_snapped, burn_mask_bool)
    print(f"  seed flat index {seed_flat_index} "
          f"({ties_at_max} pixel(s) tied at max risk {float(risk32.max()):.6f})")

    out_dir = os.path.join(OUT_ROOT, name)
    os.makedirs(out_dir, exist_ok=True)

    # Row 0 must be the SOUTH edge, matching place.py's convention -- classes
    # (and therefore risk/mask, which share its shape) already come out of
    # forest.read_landcover in that orientation.
    risk32.tofile(os.path.join(out_dir, "risk.bin"))
    mask8.tofile(os.path.join(out_dir, "mask.bin"))

    ny, nx = risk32.shape
    meta = {
        "name": name,
        "box": [box.west, box.south, box.east, box.north],
        "nx": int(nx), "ny": int(ny),
        "widthKm": float(box.width_km), "heightKm": float(box.height_km),
        "forestFraction": float(forest.forest_fraction(classes)),
        "fwiP90": float(fwi),
        "fwiNorm": float(fwi_norm),
        "firmsCount": int(n_local),
        "classMix": {str(k): float(v)
                     for k, v in forest.class_mix(classes).items()},
        "seedFlatIndex": seed_flat_index,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sourceNotes": {
            "landcover": "ESA WorldCover v200, 10 m, windowed via GDAL /vsicurl",
            "activity": "NASA FIRMS VIIRS 375 m + MODIS 1 km; RECENCY SIGNAL "
                        "ONLY - the open feeds reach back days, not years",
            "weather": "Canadian FWI from ERA5 via Open-Meteo, 180-day p90",
            "riskFormula": "flammability(landcover) * (w_base + w_weather*FWI "
                           "+ w_activity*activity)",
            "notModelled": ["elevation/slope", "camper traffic"],
        },
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)

    print(f"  wrote {out_dir}  ({nx}x{ny})")
    return out_dir


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--region", default="los-padres", choices=sorted(REGIONS))
    p.add_argument("--all", action="store_true", help="bake every region")
    p.add_argument("--max-px", dest="max_px", type=int, default=900)
    a = p.parse_args(argv)
    for name in (sorted(REGIONS) if a.all else [a.region]):
        bake(name, max_px=a.max_px)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
