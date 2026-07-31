"""Turn a bounding box into sited sensor nodes.

The pipeline, end to end:

1. **Forest** -- ESA WorldCover 10 m, windowed, gives what is there and what
   can burn.
2. **Hazard** -- FIRMS detections give observed activity; the Canadian FWI
   computed from ERA5 gives fire weather.  Sampled on a coarse grid and
   interpolated, because fire weather varies over tens of kilometres while
   fuel varies over tens of metres.
3. **Risk** -- combined into one field in [0, 1].
4. **Placement** -- variable-radius blue noise, dense where risk is high.
5. **Minimisation** -- greedy set cover to the coverage target.

Nothing here is specific to a region: the same call runs for any box on Earth,
which is what makes the global sweep possible.  What is *not* claimed is that
running every box is free -- see ``estimate_global_cost``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import numpy as np

from . import forest, hazard
from .geo import BBox, M_PER_DEG_LAT, m_per_deg_lon
from .place import (
    Coverage,
    LocalFrame,
    coverage_of,
    demand_points,
    greedy_minimise,
    variable_poisson_disk,
)

OUT_DIR = hazard.CACHE_DIR

#: A spread of real forests across biomes, for demonstrating the pipeline on
#: genuinely different fire regimes rather than five versions of the same one.
REGIONS = {
    "los-padres": BBox(-120.3, 34.4, -119.4, 35.0),      # CA chaparral
    "amazon-rondonia": BBox(-63.5, -10.5, -62.6, -9.8),  # tropical moist
    "siberia-baikal": BBox(107.0, 55.0, 108.0, 55.8),    # boreal larch
    "portugal-centro": BBox(-8.5, 39.9, -7.7, 40.5),     # Mediterranean pine
    "victoria-alpine": BBox(146.4, -37.5, 147.3, -36.9),  # eucalypt
    "congo-basin": BBox(23.0, 0.2, 23.9, 0.9),           # tropical moist
    "sweden-norrland": BBox(15.5, 63.5, 16.5, 64.1),     # boreal spruce
    "greece-peloponnese": BBox(21.6, 37.5, 22.4, 38.1),  # Mediterranean
}


@dataclass
class NodePlan:
    """A sited network for one box."""

    box: BBox
    name: str
    nodes_lonlat: np.ndarray          # (n, 2) after minimisation
    candidates_lonlat: np.ndarray     # blue-noise points before minimisation
    risk: np.ndarray
    classes: np.ndarray
    detect_km: float
    coverage: Coverage
    budget: int | None = None
    raw_coverage: tuple = (0.0, 0.0)
    fwi_p90: float = 0.0
    detections: int = 0
    missing_tiles: list = field(default_factory=list)
    stride_km: float = 0.0

    @property
    def n_nodes(self) -> int:
        return int(len(self.nodes_lonlat))

    @property
    def nodes_per_1000km2(self) -> float:
        a = self.box.area_km2
        return 1000.0 * self.n_nodes / a if a > 0 else 0.0

    @property
    def reduction(self) -> float:
        """How much of the blue-noise set the minimiser removed."""
        c = len(self.candidates_lonlat)
        return 1.0 - (self.n_nodes / c) if c else 0.0

    def summary(self) -> dict:
        return {
            "name": self.name,
            "bbox": [self.box.west, self.box.south, self.box.east, self.box.north],
            "area_km2": round(self.box.area_km2, 1),
            "forest_fraction": round(forest.forest_fraction(self.classes), 4),
            "class_mix": {k: round(v, 4) for k, v in
                          list(forest.class_mix(self.classes).items())[:6]},
            "fwi_p90": round(float(self.fwi_p90), 2),
            "firms_detections": int(self.detections),
            "detect_radius_km": self.detect_km,
            "candidates": int(len(self.candidates_lonlat)),
            "budget": self.budget,
            "nodes": self.n_nodes,
            "reduction_vs_bluenoise": round(self.reduction, 4),
            "risk_weighted_coverage": round(float(self.coverage.covered_fraction), 4),
            "area_coverage": round(float(self.coverage.area_fraction), 4),
            "nodes_per_1000km2": round(self.nodes_per_1000km2, 2),
            "coverage_scoring_stride_km": round(self.stride_km, 3),
            "missing_worldcover_tiles": self.missing_tiles,
        }


def risk_field(classes: np.ndarray, activity: np.ndarray, fwi_norm: float,
               w_weather: float = 0.45, w_activity: float = 0.35,
               w_base: float = 0.20) -> np.ndarray:
    """Combine fuel, observed activity and fire weather into [0, 1].

    Flammability multiplies rather than adds: no amount of fire weather makes
    open water a fire risk, and a model that lets weather alone drive risk will
    happily site sensors in a lake.  The remaining terms are a weighted sum so
    that a forest with no recent detections still registers risk from weather
    alone -- absence of a detection in a one-week feed is very weak evidence of
    safety.
    """
    flam = forest.flammability_field(classes)
    drive = w_base + w_weather * float(np.clip(fwi_norm, 0, 1)) + w_activity * activity
    r = flam * drive
    peak = float(r.max())
    return r / peak if peak > 0 else r


#: Full-scale value for normalising the fire-weather index.
#:
#: NOT the classic ~40 "extreme" threshold. The FWI System expects *noon*
#: temperature, humidity and wind; the daily reanalysis fields used here are
#: daily maximum temperature and daily minimum humidity, which is a common
#: practice for gridded FWI but runs systematically hotter than the noon-based
#: operational scale. Measured over 491 forested cells worldwide this basis
#: produces a median of 17 and a 99th percentile of 113. Normalising at 40
#: clamped 27% of cells to maximum risk, so fire weather stopped discriminating
#: across exactly the dangerous quarter it exists to rank.
FWI_FULL_SCALE = 80.0


def normalise_fwi(fwi_value: float, full_scale: float = FWI_FULL_SCALE) -> float:
    """Fire-weather index to [0, 1] on the daily-extreme basis.

    See :data:`FWI_FULL_SCALE`: these values are not directly comparable to a
    noon-based operational FWI, though the *ranking* they give -- which is what
    siting actually uses -- is preserved.
    """
    return float(np.clip(fwi_value / full_scale, 0.0, 1.0))


#: Risk-weighted km2 of burnable ground that earns one node.
#:
#: Calibrated against the global sweep. An earlier value of 330 was tuned on
#: 5,500 km2 regions and left 447 of 491 cells pinned at the floor, so the
#: budget was constant and node count answered to nothing -- the opposite of
#: the intent. At 140 the same cells spread across roughly 3-14 nodes.
KM2_PER_NODE = 140.0


def auto_budget(area_km2: float, mean_risk: float,
                lo: int = 3, hi: int = 40) -> int:
    """A defensible node count when none is given.

    Scales with risk-weighted burnable area so a big, dangerous forest earns
    more hardware than a small damp one, then clamps: a sentinel network that
    grows without bound stops being a sentinel network.
    """
    raw = area_km2 * float(np.clip(mean_risk, 0.0, 1.0)) / KM2_PER_NODE
    return int(np.clip(round(raw), lo, hi))


def plan_region(box: BBox, name: str = "region", detect_km: float = 2.0,
                r_min_km: float | None = None, r_max_km: float | None = None,
                target: float = 0.95, seed: int = 7, max_px: int = 900,
                fwi_start: str | None = None, fwi_end: str | None = None,
                dets=None, refresh: bool = False, verbose: bool = True,
                demand_stride: int = 4, budget: int | str | None = "auto",
                budget_lo: int = 6, budget_hi: int = 40,
                fwi_value: float | None = None) -> NodePlan:
    """Site a network over one box.

    ``budget`` caps the node count.  ``"auto"`` derives one from area and risk;
    an integer fixes it; ``None`` reverts to saturation siting, where the count
    is whatever reaching ``target`` coverage requires.
    """
    rng = np.random.default_rng(seed)

    # Two regimes, and which one applies depends entirely on the budget.
    #
    # Saturation (no budget): the pool must be denser than the answer, because
    # the minimiser can only delete. Discs of radius R tile the plane only at
    # hexagonal spacing R*sqrt(3), so a sparser pool leaves gaps no pruning can
    # close.
    #
    # Sentinel (a budget of a few nodes): total coverage is unreachable -- ten
    # 2 km sensors see 1.8% of a 5,500 km2 forest -- so the job is to watch the
    # most risk, not to blanket the ground. Here the pool spacing has to come
    # from the *budget*, not the detection radius: with no overlap between
    # discs, greedy has no diminishing-returns pressure to spread out and will
    # stack the whole budget in one hot valley. Spacing the pool at roughly the
    # mean separation the budget implies forces geographic spread, and greedy
    # then picks the best sites within it.
    if budget is None:
        r_min_km = r_min_km if r_min_km is not None else detect_km * 0.55
        r_max_km = r_max_km if r_max_km is not None else detect_km * 1.30

    if verbose:
        print(f"[{name}] {box.width_km:.0f} x {box.height_km:.0f} km "
              f"({box.area_km2:,.0f} km2)")

    classes, _, missing = forest.read_landcover(box, max_px=max_px)
    if classes is None:
        raise RuntimeError(
            f"no WorldCover data for {name} {box} (missing {missing}) -- "
            "this box is probably entirely ocean"
        )
    burn = forest.burnable_mask(classes)
    if verbose:
        print(f"  land cover {classes.shape}, forest {100*forest.forest_fraction(classes):.1f}%"
              + (f", missing tiles {missing}" if missing else ""))

    if dets is None:
        dets = hazard.fetch_firms(refresh=refresh)
    local = hazard.detections_in(box, dets)
    n_det = 0 if local is None else len(local)
    activity = hazard.activity_field(box, dets, classes.shape)

    # Fire weather: one point per region centre is enough at ERA5's ~25 km
    # resolution for boxes this size, and keeps the request count sane for a
    # global run.
    end = fwi_end or (hazard.dt.date.today() - hazard.dt.timedelta(days=7)).isoformat()
    start = fwi_start or (hazard.dt.date.fromisoformat(end)
                          - hazard.dt.timedelta(days=180)).isoformat()
    lon0, lat0 = box.centre
    # A precomputed value lets a global run batch thousands of points into a
    # handful of requests instead of one per region.
    fwi_p90 = (float(fwi_value) if fwi_value is not None else
               float(hazard.peak_fwi_for_points([(lon0, lat0)], start, end,
                                                refresh=refresh)[0]))
    if verbose:
        print(f"  FIRMS detections in box: {n_det}   FWI p90 ({start}..{end}): "
              f"{fwi_p90:.1f}")

    risk = risk_field(classes, activity, normalise_fwi(fwi_p90))

    frame = LocalFrame(box)
    w_km, h_km = frame.extent_km

    # Resolve the budget now that risk is known, then size the pool from it.
    burn_km2 = float(burn.mean()) * box.area_km2
    n_budget = None
    if budget == "auto":
        n_budget = auto_budget(burn_km2, float(risk[burn].mean()) if burn.any() else 0.0,
                               budget_lo, budget_hi)
    elif budget is not None:
        n_budget = int(budget)

    if n_budget is not None:
        spread = np.sqrt(max(burn_km2, 1.0) / max(n_budget, 1))
        r_min_km = r_min_km if r_min_km is not None else spread * 0.45
        r_max_km = r_max_km if r_max_km is not None else spread * 1.10

    cand_km = variable_poisson_disk(rng, risk, w_km, h_km, r_min_km, r_max_km,
                                    mask=burn)
    if verbose:
        b = f", budget {n_budget}" if n_budget else ""
        print(f"  blue noise: {len(cand_km):,} candidates "
              f"(spacing {r_min_km:.2f}-{r_max_km:.2f} km{b})")

    dem_xy, dem_w = demand_points(risk, burn, w_km, h_km, stride=demand_stride)
    stride_km = demand_stride * w_km / max(risk.shape[1], 1)
    raw = coverage_of(cand_km, dem_xy, dem_w, detect_km)

    # With a budget the objective flips: not "fewest nodes for this coverage"
    # but "most risk watched with this many nodes". Same greedy, and the same
    # (1 - 1/e) guarantee, which is stated for exactly this budgeted form.
    cov = greedy_minimise(cand_km, dem_xy, dem_w, detect_km,
                          target=(1.01 if n_budget else target),
                          max_nodes=n_budget)
    nodes_km = cand_km[cov.chosen] if cov.n else np.empty((0, 2))

    lon, lat = frame.to_lonlat(nodes_km[:, 0], nodes_km[:, 1]) if cov.n else ([], [])
    clon, clat = frame.to_lonlat(cand_km[:, 0], cand_km[:, 1]) if len(cand_km) else ([], [])

    plan = NodePlan(
        box=box, name=name,
        nodes_lonlat=np.column_stack((lon, lat)) if cov.n else np.empty((0, 2)),
        candidates_lonlat=(np.column_stack((clon, clat)) if len(cand_km)
                           else np.empty((0, 2))),
        risk=risk, classes=classes, detect_km=detect_km, coverage=cov,
        raw_coverage=raw, fwi_p90=fwi_p90, detections=n_det, budget=n_budget,
        missing_tiles=missing, stride_km=stride_km,
    )
    if verbose:
        print(f"  nodes: {plan.n_nodes:,} after minimisation "
              f"({100*plan.reduction:.0f}% fewer than blue noise alone), "
              f"risk-weighted coverage {100*cov.covered_fraction:.1f}%")
    return plan


# --------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------


def to_geojson(plan: NodePlan) -> dict:
    """Node positions as GeoJSON points, with the risk that justified each."""
    ny, nx = plan.risk.shape
    feats = []
    for lon, lat in plan.nodes_lonlat:
        u = (lon - plan.box.west) / (plan.box.east - plan.box.west)
        v = (lat - plan.box.south) / (plan.box.north - plan.box.south)
        j = int(np.clip(v * (ny - 1), 0, ny - 1))
        i = int(np.clip(u * (nx - 1), 0, nx - 1))
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(float(lon), 6),
                                                          round(float(lat), 6)]},
            "properties": {
                "risk": round(float(plan.risk[j, i]), 4),
                "landcover": int(plan.classes[j, i]),
                "detect_radius_km": plan.detect_km,
            },
        })
    return {"type": "FeatureCollection",
            "properties": plan.summary(),
            "features": feats}


def write_plan(plan: NodePlan, out_dir: str | None = None) -> dict:
    out_dir = out_dir or OUT_DIR
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    gj = os.path.join(out_dir, f"{plan.name}_nodes.geojson")
    with open(gj, "w", encoding="utf-8") as f:
        json.dump(to_geojson(plan), f)
    paths["geojson"] = gj

    csv_path = os.path.join(out_dir, f"{plan.name}_nodes.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        f.write("lon,lat\n")
        for lon, lat in plan.nodes_lonlat:
            f.write(f"{lon:.6f},{lat:.6f}\n")
    paths["csv"] = csv_path
    return paths


def estimate_global_cost(detect_km: float = 2.0, forest_km2: float = 40.6e6,
                         mean_nodes_per_1000km2: float = 100.0) -> dict:
    """Honest arithmetic on what 'every forest on Earth' would actually mean.

    ``forest_km2`` is the FAO 2020 global forest area, ~4.06 billion hectares.
    """
    nodes = forest_km2 / 1000.0 * mean_nodes_per_1000km2
    return {
        "global_forest_km2": forest_km2,
        "detect_radius_km": detect_km,
        "implied_nodes": int(nodes),
        "worldcover_tiles_with_land": 2651,
        "note": (
            "The pipeline runs any tile, but siting every one at 10 m is a "
            "compute and bandwidth exercise measured in tile-days, not a thing "
            "a single session produces. Node counts scale as 1/r^2: halving "
            "detection radius quadruples hardware."
        ),
    }
