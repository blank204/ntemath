"""Assemble the self-contained globe page from the planner's output.

The Artifact CSP blocks every external host, so the coastlines, the node
positions and the whole renderer are inlined.

Prefers the global sweep (``world_nodes.json``) and falls back to the named
demo regions, so the page can be rebuilt at any point during a long run and
will simply show however much of the world has been planned so far.
"""

from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "outputs", "nodenet")

WORLD = os.path.join(OUT, "world_nodes.json")
DEMO = os.path.join(OUT, "global_nodes.json")
LAND = os.path.join(OUT, "land_simplified.json")
TEMPLATE = os.path.join(HERE, "globe_template.html")
OUTPUT = os.path.join(OUT, "forest_node_globe.html")

#: Node coordinates are rounded before embedding. 3 decimals is ~110 m, far
#: finer than the globe can draw and finer than a 2 km detection radius cares
#: about, but it halves the payload.
COORD_DP = 3


def collect() -> dict:
    """Whichever dataset is available, normalised to one shape."""
    if os.path.exists(WORLD):
        with open(WORLD, encoding="utf-8") as f:
            w = json.load(f)
        regions = w.get("regions", [])
        meta = {
            "source": "world",
            "cells_examined": w.get("cells_examined", 0),
            "cells_forested": w.get("cells_forested", len(regions)),
            "cells_no_forest": w.get("cells_no_forest", 0),
            "cells_failed": w.get("cells_failed", 0),
            "generated": w.get("generated", ""),
        }
    else:
        with open(DEMO, encoding="utf-8") as f:
            d = json.load(f)
        regions = d.get("regions", [])
        meta = {"source": "demo", "cells_examined": len(regions),
                "cells_forested": len(regions), "cells_no_forest": 0,
                "cells_failed": 0, "generated": ""}

    for r in regions:
        r["nodes_lonlat"] = [[round(float(a), COORD_DP), round(float(b), COORD_DP)]
                             for a, b in r.get("nodes_lonlat", [])]
        r.pop("class_mix", None)
        r.pop("missing_worldcover_tiles", None)

    with open(LAND, encoding="utf-8") as f:
        land = json.load(f)

    return {
        **meta,
        "detect_km": regions[0].get("detect_radius_km", 2.0) if regions else 2.0,
        "total_nodes": sum(r.get("nodes", 0) for r in regions),
        "total_area_km2": round(sum(r.get("area_km2", 0.0) for r in regions), 1),
        "regions": regions,
        "land": land,
    }


def build(out_path: str = OUTPUT, template_path: str = TEMPLATE) -> str:
    data = collect()
    with open(template_path, encoding="utf-8") as f:
        html = f.read()
    if "__PAYLOAD__" not in html:
        raise RuntimeError("template has no __PAYLOAD__ marker")
    html = html.replace("__PAYLOAD__", json.dumps(data, separators=(",", ":")))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    return out_path


if __name__ == "__main__":
    d = collect()
    p = build()
    print(f"wrote {p}  ({os.path.getsize(p)/1024:.0f} KB)")
    print(f"  source={d['source']}  regions={len(d['regions'])}  "
          f"nodes={d['total_nodes']:,}  examined={d['cells_examined']} cells")
