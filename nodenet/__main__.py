"""Command line for the node planner.

    python -m nodenet --region los-padres
    python -m nodenet --all --detect-km 2.0
    python -m nodenet --bbox -120.3,34.4,-119.4,35.0 --name my-forest
    python -m nodenet --cost           what 'every forest on Earth' implies

Any lon/lat box on Earth is a valid target; the named regions are only a
convenience set spanning different fire regimes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

from .geo import BBox  # noqa: E402
from .plan import (  # noqa: E402
    OUT_DIR,
    REGIONS,
    estimate_global_cost,
    plan_region,
    write_plan,
)


def _parse_bbox(text: str) -> BBox:
    parts = [float(v) for v in text.split(",")]
    if len(parts) != 4:
        raise ValueError("--bbox wants west,south,east,north")
    return BBox(*parts)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--region", choices=sorted(REGIONS), help="a named demo region")
    g.add_argument("--bbox", help="west,south,east,north in degrees")
    g.add_argument("--all", action="store_true", help="every named region")
    g.add_argument("--cost", action="store_true",
                   help="print what covering all forest would imply")
    g.add_argument("--list", action="store_true", help="list the named regions")

    ap.add_argument("--name", default=None, help="output name for --bbox")
    ap.add_argument("--detect-km", dest="detect_km", type=float, default=2.0,
                    help="sensor detection radius, km (default 2.0)")
    ap.add_argument("--target", type=float, default=0.95,
                    help="risk-weighted coverage to reach (default 0.95)")
    ap.add_argument("--max-px", dest="max_px", type=int, default=700,
                    help="longest raster side to read (default 700)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--refresh", action="store_true", help="ignore cached data")
    ap.add_argument("--combined", default=None,
                    help="also write one combined JSON for the globe view")
    args = ap.parse_args(argv)

    if args.list:
        for k, b in sorted(REGIONS.items()):
            print(f"  {k:22s} {b.west:8.2f},{b.south:7.2f},{b.east:8.2f},{b.north:7.2f}"
                  f"   {b.area_km2:8,.0f} km2")
        return 0

    if args.cost:
        print(json.dumps(estimate_global_cost(args.detect_km), indent=2))
        return 0

    targets = []
    if args.all:
        targets = [(k, REGIONS[k]) for k in sorted(REGIONS)]
    elif args.region:
        targets = [(args.region, REGIONS[args.region])]
    else:
        box = _parse_bbox(args.bbox)
        targets = [(args.name or "region", box)]

    plans, summaries = [], []
    for name, box in targets:
        try:
            p = plan_region(box, name, detect_km=args.detect_km, target=args.target,
                            seed=args.seed, max_px=args.max_px, refresh=args.refresh)
        except Exception as e:                    # keep a global run going
            print(f"[{name}] FAILED: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        write_plan(p)
        plans.append(p)
        summaries.append(p.summary())

    if not plans:
        print("no region produced a plan", file=sys.stderr)
        return 1

    print(f"\n{'region':22s} {'km2':>9} {'forest':>7} {'FWI':>6} "
          f"{'cand':>6} {'nodes':>6} {'cut':>5} {'cover':>6} {'/1000km2':>9}")
    print("-" * 88)
    for s in summaries:
        print(f"{s['name']:22s} {s['area_km2']:9,.0f} "
              f"{100*s['forest_fraction']:6.1f}% {s['fwi_p90']:6.1f} "
              f"{s['candidates']:6,} {s['nodes']:6,} "
              f"{100*s['reduction_vs_bluenoise']:4.0f}% "
              f"{100*s['risk_weighted_coverage']:5.1f}% "
              f"{s['nodes_per_1000km2']:9.1f}")

    if args.combined:
        payload = {
            "detect_km": args.detect_km,
            "target": args.target,
            "regions": [
                {**s, "nodes_lonlat": [[round(float(a), 5), round(float(b), 5)]
                                       for a, b in p.nodes_lonlat]}
                for s, p in zip(summaries, plans)
            ],
        }
        path = args.combined
        os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        print(f"\nwrote {path}")
    print(f"per-region GeoJSON/CSV in {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
