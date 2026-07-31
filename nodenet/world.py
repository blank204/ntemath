"""Sweep the whole land surface, not a handful of hand-picked forests.

The grid is generated, not curated: every land cell between the chosen
latitudes gets planned, and cells that turn out to hold no forest are recorded
as such rather than quietly skipped.  That distinction matters -- "we checked
and there is nothing there" is a different claim from "we did not look".

Two things make a global run affordable:

* **Fire weather is batched.**  Open-Meteo accepts many coordinates per
  request, so a thousand cells cost about ten requests rather than a thousand.
* **Forest is read in windows.**  Nothing downloads a WorldCover tile; each
  cell reads only its own footprint over HTTP range requests.

Progress is written after every cell, so an interrupted run resumes instead of
starting over.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import time

import numpy as np

from . import forest, hazard
from .geo import BBox
from .plan import OUT_DIR, plan_region

LAND_PATH = os.path.join(OUT_DIR, "land_simplified.json")
STATE_PATH = os.path.join(OUT_DIR, "world_state.json")
RESULT_PATH = os.path.join(OUT_DIR, "world_nodes.json")


def load_land_rings(path: str = LAND_PATH) -> list:
    with open(path, encoding="utf-8") as f:
        return [np.asarray(r, dtype=float) for r in json.load(f)]


def _point_in_ring(lon: float, lat: float, ring: np.ndarray) -> bool:
    """Ray casting. Coarse coastlines, so this is a land *hint*, not a mask."""
    x, y = ring[:, 0], ring[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    crosses = ((y > lat) != (y2 > lat))
    if not crosses.any():
        return False
    with np.errstate(divide="ignore", invalid="ignore"):
        xint = x + (lat - y) * (x2 - x) / np.where(y2 - y == 0, np.nan, y2 - y)
    hits = crosses & np.isfinite(xint) & (lon < xint)
    return bool(hits.sum() % 2 == 1)


def on_land(lon: float, lat: float, rings: list) -> bool:
    return any(_point_in_ring(lon, lat, r) for r in rings)


def land_grid(lon_step: float = 5.0, lat_step: float = 4.0,
              lat_min: float = -56.0, lat_max: float = 72.0,
              box_lon: float = 0.5, box_lat: float = 0.4,
              rings: list | None = None) -> list:
    """Every land cell on a regular grid, as (name, BBox).

    Latitudes are cut at -56 and 72: beyond those there is effectively no
    forest, only ice and open ocean, and planning them wastes the run.
    """
    rings = rings if rings is not None else load_land_rings()
    out = []
    lat = lat_min
    while lat <= lat_max:
        lon = -180.0
        while lon < 180.0:
            if on_land(lon, lat, rings):
                w, s = lon - box_lon / 2, lat - box_lat / 2
                # Nudge boxes off the antimeridian and the poles rather than
                # letting them straddle: a box crossing +/-180 is not
                # expressible as west < east, and every raster read would fail.
                w = min(max(w, -180.0), 180.0 - box_lon)
                s = min(max(s, -90.0), 90.0 - box_lat)
                b = BBox(round(w, 3), round(s, 3),
                         round(w + box_lon, 3), round(s + box_lat, 3))
                ns = "n" if lat >= 0 else "s"
                ew = "e" if lon >= 0 else "w"
                out.append((f"{ns}{abs(int(round(lat))):02d}{ew}{abs(int(round(lon))):03d}", b))
            lon += lon_step
        lat += lat_step
    return out


def _load_state() -> dict:
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"done": {}}


def _save(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, STATE_PATH)


def run_world(lon_step: float = 5.0, lat_step: float = 4.0,
              detect_km: float = 2.0, min_forest: float = 0.08,
              max_px: int = 260, resume: bool = True,
              limit: int | None = None, verbose: bool = True) -> dict:
    """Plan every forested land cell on the grid."""
    cells = land_grid(lon_step, lat_step)
    if limit:
        cells = cells[:limit]

    state = _load_state() if resume else {"done": {}}
    todo = [(n, b) for n, b in cells if n not in state["done"]]

    if verbose:
        print(f"grid: {len(cells)} land cells, {len(todo)} still to do "
              f"({len(state['done'])} cached)")

    # Fire weather for every cell centre, batched.
    end = (dt.date.today() - dt.timedelta(days=7)).isoformat()
    start = (dt.date.fromisoformat(end) - dt.timedelta(days=180)).isoformat()
    fwi_by_name = {}
    BATCH = 100
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        pts = [b.centre for _, b in chunk]
        try:
            vals = hazard.peak_fwi_for_points(pts, start, end)
        except Exception as e:
            if verbose:
                print(f"  fire weather batch {i//BATCH} failed ({e}); using 0")
            vals = np.zeros(len(chunk))
        for (n, _), v in zip(chunk, vals):
            fwi_by_name[n] = float(v)
        if verbose:
            print(f"  fire weather: {min(i+BATCH, len(todo))}/{len(todo)}")

    dets = hazard.fetch_firms()
    if verbose:
        print(f"  FIRMS: {len(dets):,} detections worldwide")

    t0 = time.perf_counter()
    for k, (name, box) in enumerate(todo, 1):
        try:
            p = plan_region(box, name, detect_km=detect_km, max_px=max_px,
                            dets=dets, fwi_value=fwi_by_name.get(name, 0.0),
                            verbose=False)
        except Exception as e:
            state["done"][name] = {"name": name, "status": f"{type(e).__name__}",
                                   "bbox": [box.west, box.south, box.east, box.north]}
            _save(state)
            continue

        ff = forest.forest_fraction(p.classes)
        if ff < min_forest:
            state["done"][name] = {"name": name, "status": "no-forest",
                                   "forest_fraction": round(ff, 4),
                                   "bbox": [box.west, box.south, box.east, box.north]}
        else:
            s = p.summary()
            s["status"] = "planned"
            s["nodes_lonlat"] = [[round(float(a), 4), round(float(b), 4)]
                                 for a, b in p.nodes_lonlat]
            state["done"][name] = s
        _save(state)

        if verbose and (k % 10 == 0 or k == len(todo)):
            planned = sum(1 for v in state["done"].values() if v.get("status") == "planned")
            nodes = sum(v.get("nodes", 0) for v in state["done"].values())
            rate = k / max(time.perf_counter() - t0, 1e-9)
            eta = (len(todo) - k) / max(rate, 1e-9) / 60
            print(f"  {k}/{len(todo)} cells | {planned} forested | {nodes:,} nodes "
                  f"| {rate*60:.0f} cells/min | eta {eta:.0f} min", flush=True)

    return summarise(state)


def summarise(state: dict | None = None, out_path: str = RESULT_PATH) -> dict:
    state = state or _load_state()
    planned = [v for v in state["done"].values() if v.get("status") == "planned"]
    no_forest = [v for v in state["done"].values() if v.get("status") == "no-forest"]
    failed = [v for v in state["done"].values()
              if v.get("status") not in ("planned", "no-forest")]

    payload = {
        "generated": dt.date.today().isoformat(),
        "cells_examined": len(state["done"]),
        "cells_forested": len(planned),
        "cells_no_forest": len(no_forest),
        "cells_failed": len(failed),
        "total_nodes": sum(v.get("nodes", 0) for v in planned),
        "total_area_km2": round(sum(v.get("area_km2", 0) for v in planned), 1),
        "regions": sorted(planned, key=lambda v: -v.get("fwi_p90", 0)),
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return payload


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Plan nodes for every forested land cell.")
    ap.add_argument("--lon-step", type=float, default=5.0)
    ap.add_argument("--lat-step", type=float, default=4.0)
    ap.add_argument("--detect-km", type=float, default=2.0)
    ap.add_argument("--max-px", type=int, default=260)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--fresh", action="store_true", help="ignore saved progress")
    a = ap.parse_args()

    res = run_world(a.lon_step, a.lat_step, a.detect_km, max_px=a.max_px,
                    resume=not a.fresh, limit=a.limit)
    print(f"\nexamined {res['cells_examined']} cells: "
          f"{res['cells_forested']} forested, {res['cells_no_forest']} without forest, "
          f"{res['cells_failed']} failed")
    print(f"{res['total_nodes']:,} nodes over "
          f"{res['total_area_km2']:,.0f} km2 of forest")
    print(f"wrote {RESULT_PATH}")
