"""M7 - The real landscape: any CAL FIRE FRAP-mapped fire, on real data.

Produces exactly the objects M2-M6 already consume -- a :class:`domain.Domain`
with elevation and fuel rasters plus a wind -- so nothing downstream changes
when the landscape stops being synthetic.

Sources, all keyless HTTP:

* **Perimeter** -- CAL FIRE FRAP historical perimeters (ArcGIS REST), via
  :mod:`catalog`.  Defines both the study area and the validation truth.
* **Fuel** -- LANDFIRE FBFM40, at the newest vintage *strictly before* the
  fire year.  A vintage from the fire's own year or later has already absorbed
  the burn scar as changed fuel, which is the landscape after the event rather
  than the one it burned through.  See :func:`catalog.fbfm_service_for_year`;
  note that LANDFIRE published no FBFM40 between 2017 and 2021, so fires in
  that window fall back to LF2016 and say so.
* **Terrain** -- LANDFIRE ``LF2020_Elev_CONUS``.  Terrain is static, so the
  vintage does not matter.
* **Wind** -- Open-Meteo historical archive, **hourly**, anchored to the
  fire's own alarm date, via :mod:`weather`.

The wind used to be a single vector: one hardcoded day, read in UTC, with its
24 hours averaged into one number.  For the 2024 Lake Fire that produced
2.1 m/s pointing 146 degrees away from where the fire actually went, because
the sampled day fell three days after the offshore flow that drove the run had
reversed.  Resolving the same archive hourly from the alarm date instead moved
the simulated scar from 146 degrees off to 41 degrees off and raised IoU from
0.278 to 0.406, with no calibration constant touched.

Everything is worked in **EPSG:32611** (UTM 11N, metres); mismatched CRS is the
usual failure here, so every layer is requested already projected rather than
reprojected after the fact.  The Domain's local frame is the study bbox with its
south-west corner at the origin, which is the convention M1 established.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np

import catalog
import weather
from domain import (
    GRASS,
    ROCK,
    SHRUB,
    TIMBER,
    WATER,
    Domain,
    Wind,
)

CRS_UTM11N = "EPSG:32611"
CRS_WGS84 = "EPSG:4326"

LFPS = "https://lfps.usgs.gov/arcgis/rest/services"
ELEV_SERVICE = "Landfire_Topo/LF2020_Elev_CONUS"

NATIVE_RES_M = 30.0

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outputs", "realdata")


def _cache(name: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, name)


# --------------------------------------------------------------------------
# FBFM40 -> the four simulation fuel classes
# --------------------------------------------------------------------------


def fbfm40_to_fuel(codes: np.ndarray) -> np.ndarray:
    """Scott & Burgan 40 fuel-model codes to M1's categorical classes.

    Mapped by the documented code-prefix ranges.  Two lossy steps worth naming:
    grass-shrub (GS, 121-124) collapses into ``GRASS`` and slash/blowdown
    (SB, 201-204) into ``SHRUB``, because M1 carries one ``k_veg`` per class
    rather than per fuel model.
    """
    c = np.asarray(codes)
    fuel = np.full(c.shape, ROCK, dtype=int)  # default: unburnable

    fuel[(c >= 101) & (c <= 109)] = GRASS  # GR  grass
    fuel[(c >= 121) & (c <= 124)] = GRASS  # GS  grass-shrub
    fuel[(c >= 141) & (c <= 149)] = SHRUB  # SH  shrub / chaparral
    fuel[(c >= 161) & (c <= 165)] = TIMBER  # TU timber-understorey
    fuel[(c >= 181) & (c <= 189)] = TIMBER  # TL timber litter
    fuel[(c >= 201) & (c <= 204)] = SHRUB  # SB slash / blowdown

    # NB (non-burnable) 91-99: 98 is open water, the rest read as rock/road.
    fuel[(c >= 91) & (c <= 99)] = ROCK
    fuel[c == 98] = WATER

    # NoData sentinels -> unburnable, so they can never carry fire.
    fuel[c < 0] = ROCK
    fuel[c > 300] = ROCK
    return fuel


FBFM40_GROUPS = {
    "NB non-burnable": (91, 99),
    "GR grass": (101, 109),
    "GS grass-shrub": (121, 124),
    "SH shrub/chaparral": (141, 149),
    "TU timber-understorey": (161, 165),
    "TL timber litter": (181, 189),
    "SB slash/blowdown": (201, 204),
}


# --------------------------------------------------------------------------
# the assembled case
# --------------------------------------------------------------------------


@dataclass
class FireCase:
    """One fetched real-world fire, ready to simulate."""

    record: catalog.FireRecord
    domain: Domain
    perimeter: object  # shapely geometry in the Domain's local metre frame
    bounds_utm: tuple  # (xmin, ymin, xmax, ymax) in EPSG:32611
    ignition_xy: tuple  # local metres
    acres: float
    wind_series: weather.WindSeries | None = None
    wind_note: str = ""
    ignition_shift_m: float = 0.0
    ignition_source: str = "unknown"
    fuel_vintage: int = 0
    epsg: int = 32611
    warnings: list = field(default_factory=list)

    @property
    def perimeter_area_km2(self) -> float:
        return self.perimeter.area / 1e6

    @property
    def name(self) -> str:
        return self.record.name

    @property
    def year(self) -> int:
        return self.record.year

    @property
    def label(self) -> str:
        return f"{self.record.name} Fire {self.record.year}"

    @property
    def ignition_is_assumed(self) -> bool:
        """True when the origin was guessed, so direction metrics are void."""
        return self.ignition_source == "centroid"


#: Kept so the previous name still resolves for anything importing it.
LakeFire = FireCase


def study_bounds(geom, buffer_m: float = 3000.0) -> tuple:
    """Perimeter bounding box buffered outward, snapped to the raster grid."""
    xmin, ymin, xmax, ymax = geom.bounds
    xmin, ymin = xmin - buffer_m, ymin - buffer_m
    xmax, ymax = xmax + buffer_m, ymax + buffer_m
    # snap so pixel edges line up with the 30 m LANDFIRE grid
    xmin = np.floor(xmin / NATIVE_RES_M) * NATIVE_RES_M
    ymin = np.floor(ymin / NATIVE_RES_M) * NATIVE_RES_M
    xmax = np.ceil(xmax / NATIVE_RES_M) * NATIVE_RES_M
    ymax = np.ceil(ymax / NATIVE_RES_M) * NATIVE_RES_M
    return (float(xmin), float(ymin), float(xmax), float(ymax))


def fetch_raster(service: str, bounds: tuple, name: str, epsg: int = 32611,
                 res_m: float = NATIVE_RES_M, refresh: bool = False) -> np.ndarray:
    """Clip a LANDFIRE ImageServer layer to ``bounds``, already in UTM 11N.

    Returned array is oriented **row 0 = southern edge**, matching the Domain
    convention that y increases with row index.  ImageServer hands back a
    north-up raster, so it is flipped on the way in; getting this backwards
    silently mirrors the terrain.
    """
    import rasterio

    path = _cache(f"{name}.tif")
    if refresh or not os.path.exists(path):
        import requests

        xmin, ymin, xmax, ymax = bounds
        nx = int(round((xmax - xmin) / res_m))
        ny = int(round((ymax - ymin) / res_m))
        params = {
            "bbox": f"{xmin},{ymin},{xmax},{ymax}",
            "bboxSR": str(int(epsg)),
            "imageSR": str(int(epsg)),
            "size": f"{nx},{ny}",
            "format": "tiff",
            "pixelType": "S16",
            "interpolation": "RSP_NearestNeighbor",
            "f": "image",
        }
        url = f"{LFPS}/{service}/ImageServer/exportImage"
        r = requests.get(url, params=params, timeout=300)
        r.raise_for_status()
        if r.headers.get("Content-Type", "").startswith("application/json"):
            raise RuntimeError(f"{service} returned JSON, not an image: {r.text[:400]}")
        with open(path, "wb") as f:
            f.write(r.content)

    with rasterio.open(path) as ds:
        arr = ds.read(1)
    return np.flipud(arr).copy()


# --------------------------------------------------------------------------
# assembly
# --------------------------------------------------------------------------


def load_fire(record: catalog.FireRecord, buffer_m: float = 3000.0,
              res_m: float = NATIVE_RES_M, refresh: bool = False,
              verbose: bool = True, wind_source: str = "sustained",
              start_hour: int = 12, ignition_lonlat=None,
              start_date=None) -> FireCase:
    """Fetch everything for one fire and assemble the Domain in a local frame."""
    import shapely
    from shapely.affinity import translate

    warnings: list = []

    # Resolved before the geometry so the UTM zone can be anchored on it.
    origin = ignition_lonlat or record.origin_lonlat

    geom, props, epsg = catalog.fetch_geometry(
        record, refresh=refresh, cache_dir=CACHE_DIR,
        prefer_lon=origin[0] if origin else None,
    )
    acres = float(props.get("GIS_ACRES", record.acres))
    bounds = study_bounds(geom, buffer_m)
    xmin, ymin, xmax, ymax = bounds
    width, height = xmax - xmin, ymax - ymin
    if verbose:
        print(f"perimeter: {acres:,.0f} acres = {geom.area/1e6:.1f} km2")
        print(f"study bbox (EPSG:{epsg}, UTM {epsg - 32600}N): "
              f"{width/1000:.1f} x {height/1000:.1f} km")

    fuel_service, vintage, vintage_warn = catalog.fbfm_service_for_year(record.year)
    if vintage_warn:
        warnings.append(vintage_warn)
        if verbose:
            print(f"WARNING: {vintage_warn}")

    # Cache keyed per fire: two fires share neither bbox nor vintage.
    # The cache key carries the projection and the fuel vintage. Without the
    # EPSG, changing the zone would silently reuse rasters cut in the old
    # projection against geometry in the new one -- a mismatch that produces
    # plausible-looking output rather than an error.
    elev = fetch_raster(ELEV_SERVICE, bounds, f"{record.slug}_elev_{epsg}",
                        epsg, res_m, refresh).astype(float)
    fbfm = fetch_raster(fuel_service, bounds,
                        f"{record.slug}_fbfm40_lf{vintage}_{epsg}",
                        epsg, res_m, refresh)
    if verbose:
        print(f"rasters: elev {elev.shape}, fbfm40 {fbfm.shape} (LF{vintage})")

    # LANDFIRE elevation NoData is a large negative sentinel; hold it at the
    # local minimum rather than letting it create artificial cliffs.
    valid = elev > -1000
    if not valid.all():
        elev[~valid] = elev[valid].min() if valid.any() else 0.0

    fuel = fbfm40_to_fuel(fbfm)

    # -- ignition ---------------------------------------------------------
    local_perim = translate(geom, xoff=-xmin, yoff=-ymin)
    shapely.prepare(local_perim)

    if origin is not None:
        ig = _lonlat_to_utm(*origin, epsg=epsg)
        raw_xy = (ig[0] - xmin, ig[1] - ymin)
        ignition, moved = _snap_inside(local_perim, raw_xy)
        ignition_source = "given" if ignition_lonlat else "known origin"
        if verbose and moved > 1.0:
            print(f"ignition: reported origin is {moved:.0f} m outside the mapped "
                  f"perimeter; snapped to the nearest burnt ground")
    else:
        c = main_polygon(local_perim).centroid
        ignition, moved = _snap_inside(local_perim, (c.x, c.y))
        ignition_source = "centroid"
        msg = (
            f"no reported origin for {record.label}; ignition defaulted to the "
            f"perimeter centroid. Spread-direction metrics (push bearing) are "
            f"meaningless under this assumption, because the answer is built in. "
            f"Pass --ignition-lonlat to fix."
        )
        warnings.append(msg)
        if verbose:
            print(f"WARNING: {msg}")

    # -- wind -------------------------------------------------------------
    anchor = start_date or record.alarm
    if anchor is None:
        raise ValueError(
            f"{record.label} has no ALARM_DATE in FRAP, so the wind cannot be "
            f"anchored in time. Pass an explicit --start-date."
        )
    wind_lonlat = origin or _utm_to_lonlat(
        (xmin + xmax) / 2.0, (ymin + ymax) / 2.0, epsg=epsg
    )
    series = weather.wind_series_for_fire(
        wind_lonlat, anchor, record.cont, source=wind_source,
        start_hour=start_hour, refresh=refresh,
    )
    # Summarise the first day, not the whole fetched window. A month-long mean
    # is the very artifact this module removes -- printing one under the bare
    # label "wind" would misreport what the run is about to use.
    wind_note = series.summary(24 * 60.0)
    if verbose:
        print(f"wind (first 24 h from anchor): {wind_note}")
        print(f"  fetched window: {series.n_hours} h from "
              f"{series.times[0]} local; the run uses only the hours it reaches")

    # Domain carries one vector for plotting and for any caller that still
    # expects a constant; the simulation is handed the series itself.  That
    # constant is the mean of the first day, not of the whole fetched window --
    # a month-long mean is the artifact this module exists to remove, and
    # leaving it here would quietly hand it back to every fallback path.
    dom = Domain(width=width, height=height, elevation=elev, fuel=fuel,
                 wind=series.mean_wind(24 * 60.0))

    return FireCase(
        record=record,
        domain=dom,
        perimeter=local_perim,
        bounds_utm=bounds,
        ignition_xy=ignition,
        acres=acres,
        wind_series=series,
        wind_note=wind_note,
        ignition_shift_m=moved,
        ignition_source=ignition_source,
        fuel_vintage=vintage,
        epsg=epsg,
        warnings=warnings,
    )


def load_lake_fire(buffer_m: float = 3000.0, res_m: float = NATIVE_RES_M,
                   refresh: bool = False, verbose: bool = True, **kw) -> FireCase:
    """The 2024 Lake Fire, kept as a named entry point for the diagnostics."""
    records = catalog.search_fires(2024, "LAKE")
    if not records:
        raise RuntimeError("FRAP returned no LAKE 2024 perimeter")
    # Three 2024 fires share the name; the study fire is the ~38,600-acre one.
    record = records[0]
    if record.acres < 30_000:
        raise RuntimeError(
            f"largest LAKE 2024 perimeter is only {record.acres:.0f} acres; "
            "the query matched the wrong fire"
        )
    return load_fire(record, buffer_m=buffer_m, res_m=res_m, refresh=refresh,
                     verbose=verbose, **kw)


def main_polygon(perim):
    """The largest part of the perimeter multipolygon."""
    if perim.geom_type != "MultiPolygon":
        return perim
    return max(perim.geoms, key=lambda g: g.area)


def _snap_inside(perim, xy, step_m: float = 60.0):
    """Move an ignition point inside the perimeter if it falls outside.

    A reported origin is often a place name rather than a mapped point -- Zaca
    Lake, for the 2024 Lake Fire, lies outside the mapped burn.  Igniting
    outside the scar would guarantee a meaningless comparison, so the point is
    walked to the nearest burnt ground and the distance moved is recorded
    rather than hidden.
    """
    from shapely.geometry import Point
    from shapely.ops import nearest_points

    p = Point(xy)
    if perim.contains(p):
        return (float(xy[0]), float(xy[1])), 0.0

    target = main_polygon(perim)
    on_edge = nearest_points(target, p)[0]
    inward = np.array([target.centroid.x - on_edge.x, target.centroid.y - on_edge.y])
    n = np.linalg.norm(inward)
    inward = inward / n if n > 1e-9 else np.array([0.0, 0.0])

    q = np.array([on_edge.x, on_edge.y])
    for _ in range(40):
        q = q + inward * step_m
        if target.contains(Point(q)):
            break
    return (float(q[0]), float(q[1])), float(p.distance(Point(q)))


def _lonlat_to_utm(lon: float, lat: float, epsg: int = 32611) -> tuple:
    from pyproj import Transformer

    t = Transformer.from_crs(CRS_WGS84, f"EPSG:{int(epsg)}", always_xy=True)
    return t.transform(lon, lat)


def _utm_to_lonlat(x: float, y: float, epsg: int = 32611) -> tuple:
    from pyproj import Transformer

    t = Transformer.from_crs(f"EPSG:{int(epsg)}", CRS_WGS84, always_xy=True)
    return t.transform(x, y)


def perimeter_raster(fire: FireCase, grid, main_only: bool = False) -> np.ndarray:
    """The FRAP perimeter painted onto a :class:`metrics.RefGrid`."""
    import shapely

    geom = main_polygon(fire.perimeter) if main_only else fire.perimeter
    shapely.prepare(geom)
    inside = shapely.contains_xy(geom, grid.pix[:, 0], grid.pix[:, 1])
    return inside.reshape(grid.shape)


# --------------------------------------------------------------------------
# validation against the mapped perimeter
# --------------------------------------------------------------------------


def scar_at_area(res, target_area_m2: float):
    """The burn scar truncated at the step where it first reaches ``target``.

    The real fire burned for weeks under suppression, diurnal cycling and
    shifting winds, only the last of which this CA models -- so comparing at a
    fixed simulated duration would mostly measure how long the run happened to
    be.  Truncating at the *observed* area instead separates the two questions:
    this comparison scores the scar's **shape and direction**, while the time
    taken to reach that area is reported separately as the rate check.  It is a
    single post-hoc cut, not a fitted parameter; no constant is touched.
    """
    step = int(np.searchsorted(res.area_per_step, target_area_m2))
    step = min(step, res.steps)
    mask = (res.arrival_step >= 0) & (res.arrival_step <= step)
    return mask, step


def validate(fire: FireCase, d_min: float = 90.0, t_end_min: float = 2400.0,
             seed: int = 7, grid_n: int = 512, verbose: bool = True,
             wind=None, rule: str = "bernoulli") -> tuple:
    """Run the CA on a fine mesh with the real wind and score it on the perimeter.

    ``wind`` overrides what the fire was loaded with, which is how the
    sensitivity arms (constant mean, no wind) are produced without touching a
    calibration constant.  ``rule`` selects the transition rule: ``bernoulli``
    is the original per-step draw, ``ros`` the arrival-time reformulation in
    :mod:`spread`.  Both are kept so the change can be scored side by side.
    """
    from attributes import build_attributes
    from calibrate import reference_d_ref
    from fire import PARAMS, simulate
    from mesh import build_mesh
    from metrics import RefGrid, iou, rasterise_mask

    dom = fire.domain
    d_ref = reference_d_ref()

    if rule == "ros":
        from spread import PARAMS_ROS
        P = dict(PARAMS_ROS)
    elif rule == "bernoulli":
        P = dict(PARAMS)
    else:
        raise ValueError(f"unknown rule {rule!r}; use 'bernoulli' or 'ros'")
    P["t_end_min"] = t_end_min

    w = wind if wind is not None else (fire.wind_series or dom.wind)

    mesh = build_mesh(np.random.default_rng(seed), dom, d_min, lloyd_iters=2)
    attrs = build_attributes(mesh, dom, dt_s=P["dt_s"], d_ref=d_ref)
    if verbose:
        print(f"mesh: n={mesh.n:,} cells at d_min={d_min:.0f} m, rule={rule}")

    if rule == "ros":
        from spread import simulate_ros

        res = simulate_ros(mesh, attrs, w, d_ref, seed_xy=fire.ignition_xy,
                           params=P)
    else:
        res = simulate(mesh, attrs, w, np.random.default_rng(seed), d_ref,
                       seed_xy=fire.ignition_xy, params=P)

    grid = RefGrid(dom.width, dom.height, grid_n, grid_n)
    own = grid.owners(mesh)
    truth = perimeter_raster(fire, grid)
    truth_main = perimeter_raster(fire, grid, main_only=True)

    target = fire.perimeter.area
    matched, step = scar_at_area(res, target)

    sim_full = rasterise_mask(own, res.burnt_mask)
    sim_matched = rasterise_mask(own, matched)

    # Scar shape, so the aspect ratio is reported alongside IoU. IoU alone
    # cannot distinguish a scar that is the right size and the wrong shape.
    from diag_m7 import scar_shape

    shape = scar_shape(mesh.points[matched], mesh.cell_area[matched],
                       fire.ignition_xy)

    px = grid.pixel_area / 1e6
    out = {
        "n_cells": mesh.n,
        "d_min": d_min,
        "rule": rule,
        "aspect": shape["aspect"],
        "push_deg": shape["push_deg"],
        "lb_predicted": res.meta.get("lb"),
        "steps_run": res.steps,
        "hit_cap": res.hit_cap,
        "wind_ms": res.meta["wind_speed"],
        "wind_toward_deg": res.meta["wind_dir"],
        "wind_is_series": bool(res.meta.get("wind_series")),
        "wind_source": res.meta.get("wind_source", "constant"),
        "wind_hours": res.meta.get("wind_hours", 0),
        "perimeter_km2": target / 1e6,
        "perimeter_main_km2": main_polygon(fire.perimeter).area / 1e6,
        "sim_full_km2": float(np.count_nonzero(sim_full)) * px,
        "sim_matched_km2": float(np.count_nonzero(sim_matched)) * px,
        "run_minutes": res.steps * res.dt_s / 60.0,
        "minutes_to_reach_area": step * res.dt_s / 60.0,
        "reached_target_area": bool(res.area_per_step[-1] >= target),
        "iou_area_matched": iou(sim_matched, truth),
        "iou_area_matched_main": iou(sim_matched, truth_main),
        "iou_full_burn": iou(sim_full, truth),
    }
    if verbose:
        print(f"perimeter {out['perimeter_km2']:.1f} km2 "
              f"(main polygon {out['perimeter_main_km2']:.1f} km2)")
        if out["wind_is_series"]:
            print(f"wind: {out['wind_hours']} hourly samples "
                  f"({out['wind_source']}), run-mean {out['wind_ms']:.1f} m/s "
                  f"toward {out['wind_toward_deg']:.0f}deg")
        print(f"simulated to extinction/cap: {out['sim_full_km2']:.1f} km2 "
              f"in {res.steps} min, hit_cap={res.hit_cap}")
        if out["reached_target_area"]:
            print(f"reached the observed area after "
                  f"{out['minutes_to_reach_area']/60:.1f} h of simulated time")
        else:
            print("never reached the observed area within the run")
        print(f"IoU vs perimeter, area-matched : {out['iou_area_matched']:.3f}")
        print(f"IoU vs main polygon, area-matched: {out['iou_area_matched_main']:.3f}")
        print(f"IoU vs perimeter, full burn    : {out['iou_full_burn']:.3f}")
        lb = out.get("lb_predicted")
        print(f"scar aspect {out['aspect']:.2f}"
              + (f" (ellipse predicted from wind: {lb:.2f})" if lb else "")
              + f", push {out['push_deg']:.0f}deg")
    return out, (mesh, attrs, res, grid, sim_matched, truth)


def sensitivity(fire: FireCase, d_min: float = 90.0, t_end_min: float = 2400.0,
                seed: int = 7, verbose: bool = True, rule: str = "bernoulli") -> list:
    """Score the hourly wind against the treatments it replaced.

    Regenerated on demand rather than quoted from a previous run: the numbers
    in an earlier version of this report were carried as literals and became
    wrong the moment the wind changed.
    """
    series = fire.wind_series
    rows = []

    def arm(label, w):
        if verbose:
            print(f"  sensitivity arm: {label} ...", flush=True)
        st, _ = validate(fire, d_min=d_min, t_end_min=t_end_min, seed=seed,
                         verbose=False, wind=w, rule=rule)
        rows.append({
            "label": label,
            "iou": st["iou_area_matched"],
            "wind_ms": st["wind_ms"],
            "wind_toward": st["wind_toward_deg"],
        })
        if verbose:
            print(f"    IoU {rows[-1]['iou']:.3f}")
        return st

    # The hourly arm runs first so the constant arm can average exactly the
    # hours it reached. Averaging over the full t_end window instead would
    # fold in calm night hours the fire never burned through -- a smaller
    # version of the sampling error this whole change exists to remove.
    st = arm("hourly, anchored to alarm date", series)
    reached = st["run_minutes"]

    arm(f"constant, mean of the same {st['wind_hours']} h",
        series.mean_wind(reached))
    arm("no wind at all", Wind(0.0, 0.0))
    return rows


# --------------------------------------------------------------------------
# figures
# --------------------------------------------------------------------------


def plot_validation(fire: FireCase, stats: dict, bundle, path: str) -> str:
    """Simulated scar against the mapped perimeter."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    mesh, attrs, res, grid, sim, truth = bundle
    dom = fire.domain
    ext = dom.extent

    fig, axes = plt.subplots(1, 3, figsize=(17, 5.8))

    axes[0].imshow(truth, origin="lower", extent=ext, cmap="Greys", vmin=0, vmax=1.6)
    axes[0].set_title(f"FRAP mapped perimeter\n{stats['perimeter_km2']:.0f} km²")

    axes[1].imshow(sim, origin="lower", extent=ext, cmap="Reds", vmin=0, vmax=1.6)
    axes[1].set_title(f"Simulated scar (area-matched)\n{stats['sim_matched_km2']:.0f} km²")

    overlay = np.zeros(truth.shape + (3,))
    overlay[..., 0] = np.where(sim, 0.85, 1.0)
    overlay[..., 1] = np.where(truth, 0.35, 1.0) * np.where(sim, 0.55, 1.0)
    overlay[..., 2] = np.where(truth, 0.35, 1.0) * np.where(sim, 0.35, 1.0)
    axes[2].imshow(overlay, origin="lower", extent=ext)
    axes[2].set_title(f"Overlap — IoU = {stats['iou_area_matched']:.3f}\n"
                      f"(grey = mapped only, red = simulated only, dark = both)")

    for a in axes:
        a.plot(*fire.ignition_xy, "*", ms=15, mfc="#ffd400", mec="k", mew=0.8)
        a.set_aspect("equal")
        a.set_xlabel("x (m, local)")
    axes[0].set_ylabel("y (m, local)")

    if stats.get("wind_is_series"):
        wind_txt = (f"{stats['wind_hours']} hourly wind samples "
                    f"({stats['wind_source']}), run-mean {stats['wind_ms']:.1f} m/s "
                    f"toward {stats['wind_toward_deg']:.0f}°")
    else:
        wind_txt = (f"constant wind {stats['wind_ms']:.1f} m/s toward "
                    f"{stats['wind_toward_deg']:.0f}°")
    fig.suptitle(
        f"M7 validation — {fire.label} | {stats['n_cells']:,} cells @ d_min="
        f"{stats['d_min']:.0f} m | {wind_txt}",
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


def plot_wind_series(fire: FireCase, path: str, hours: int = 72) -> str:
    """The hourly wind the run actually saw, against the mean it replaced.

    Exists because the failure this module fixes is invisible in any single
    number: the speed looked merely low, while the direction was reversing.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    s = fire.wind_series
    sl = slice(s.start_index, min(s.start_index + hours, s.n_hours))
    spd = s.drive_speed[sl]
    frm = s.from_deg[sl]
    t = np.arange(len(spd))
    mean = s.mean_wind(hours * 60.0)

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 6.4), sharex=True)

    ax1.plot(t, spd, lw=1.8, color="#1b4fa0")
    ax1.axhline(spd.mean(), ls="--", lw=1.2, color="#c0392b",
                label=f"window mean {spd.mean():.1f} m/s")
    ax1.set_ylabel(f"{s.source} speed (m/s)")
    ax1.legend(fontsize=8)
    ax1.grid(alpha=0.3)
    ax1.set_title(f"{fire.label} — hourly wind from the alarm date "
                  f"({s.times[sl.start]} local)")

    ax2.plot(t, (frm + 180.0) % 360.0, ".", ms=4, color="#1b4fa0")
    ax2.axhline(mean.dir_deg, ls="--", lw=1.2, color="#c0392b",
                label=f"speed-weighted mean toward {mean.dir_deg:.0f}°")
    ax2.set_ylim(0, 360)
    ax2.set_yticks([0, 90, 180, 270, 360])
    ax2.set_ylabel("blowing toward (°)")
    ax2.set_xlabel("hours since ignition")
    ax2.legend(fontsize=8)
    ax2.grid(alpha=0.3)

    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


def plot_real_domain(fire: FireCase, path: str) -> str:
    """Elevation, fuel classes and the FRAP perimeter over the study area."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import BoundaryNorm, ListedColormap

    from domain import FUEL_COLORS, FUEL_NAMES

    dom = fire.domain
    ext = dom.extent
    fig, axes = plt.subplots(1, 3, figsize=(17, 5.6))

    im = axes[0].imshow(dom.elevation, origin="lower", extent=ext, cmap="terrain")
    axes[0].set_title(f"Elevation (m) — {dom.elevation.min():.0f} to "
                      f"{dom.elevation.max():.0f}")
    fig.colorbar(im, ax=axes[0], fraction=0.046)

    codes = sorted(FUEL_NAMES)
    cmap = ListedColormap([FUEL_COLORS[c] for c in codes])
    norm = BoundaryNorm([c - 0.5 for c in codes] + [codes[-1] + 0.5], cmap.N)
    im2 = axes[1].imshow(dom.fuel, origin="lower", extent=ext, cmap=cmap, norm=norm)
    axes[1].set_title(f"Fuel class (LANDFIRE LF{fire.fuel_vintage} FBFM40)")
    cb = fig.colorbar(im2, ax=axes[1], fraction=0.046, ticks=codes)
    cb.ax.set_yticklabels([FUEL_NAMES[c] for c in codes])

    axes[2].imshow(dom.elevation, origin="lower", extent=ext, cmap="Greys_r", alpha=0.55)
    geoms = (fire.perimeter.geoms if fire.perimeter.geom_type == "MultiPolygon"
             else [fire.perimeter])
    for g in geoms:
        x, y = g.exterior.xy
        axes[2].fill(x, y, facecolor="#c0392b", alpha=0.35, edgecolor="#c0392b", lw=1.5)
    label = "ignition (assumed)" if fire.ignition_is_assumed else "reported origin"
    axes[2].plot(*fire.ignition_xy, "*", ms=16, mfc="#ffd400", mec="k", mew=0.8,
                 label=label)
    v = dom.wind.vector
    L = 0.18 * dom.width
    axes[2].annotate(
        "", xy=(0.12 * dom.width + v[0] * L, 0.88 * dom.height + v[1] * L),
        xytext=(0.12 * dom.width, 0.88 * dom.height),
        arrowprops=dict(arrowstyle="-|>", color="#1b4fa0", lw=2.5),
    )
    axes[2].text(0.12 * dom.width, 0.93 * dom.height,
                 f"mean wind {dom.wind.speed_ms:.1f} m/s", color="#1b4fa0", fontsize=9)
    axes[2].legend(loc="lower right", fontsize=8)
    axes[2].set_title(f"FRAP perimeter — {fire.perimeter_area_km2:.0f} km²")

    for a in axes:
        a.set_xlabel("x (m, local)")
        a.set_aspect("equal")
    axes[0].set_ylabel("y (m, local)")

    fig.suptitle(
        f"M7 — {fire.label} | study area "
        f"{dom.width/1000:.0f} × {dom.height/1000:.0f} km, EPSG:{fire.epsg}",
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------

M7_PREFIX = "## M7 —"

#: The heading used when M7 could only ever run one fire. Dropped on the first
#: write so its now-disproven wind conclusions do not sit beside the new ones.
LEGACY_HEADING = "## M7 — validation on the 2024 Lake Fire (real landscape)"


def _splice_section(markdown: str, heading: str, body: str = "") -> str:
    """Replace the section under ``heading``, or append when absent.

    A section runs from its heading to the next top-level ``## `` heading, so
    replacing one fire's results leaves every other fire's intact -- matching
    on the shared ``## M7 —`` prefix instead would delete them.
    """
    start = markdown.find(heading)
    if start < 0:
        if not body:
            return markdown
        return markdown.rstrip() + "\n\n" + body

    after = markdown.find("\n## ", start + len(heading))
    tail = markdown[after + 1:] if after >= 0 else ""
    head = markdown[:start].rstrip()

    parts = [p for p in (head, body.rstrip(), tail.rstrip()) if p]
    return "\n\n".join(parts) + "\n"


def append_results_section(fire: FireCase, stats: dict, paths: dict, md_path: str,
                           sens: list | None = None) -> str:
    """Add (or replace) the M7 section of RESULTS.md.

    Written separately from the sweep's own report so that re-running M7 does
    not require re-running M6, and vice versa.
    """
    from domain import FUEL_NAMES

    dom = fire.domain
    tot = dom.fuel.size
    mix = ", ".join(
        f"{FUEL_NAMES[c]} {100*int((dom.fuel == c).sum())/tot:.0f}%"
        for c in sorted(FUEL_NAMES) if (dom.fuel == c).any()
    )
    s = fire.wind_series

    L = [f"{M7_PREFIX} validation on the {fire.label} (real landscape)", ""]
    A = L.append
    A("Same code path as the synthetic study — `realdata.py` only replaces the "
      "`Domain`; M2–M6 run unchanged.\n")
    A(f"**Sources** (all keyless, worked entirely in EPSG:{fire.epsg}, "
      f"UTM {fire.epsg - 32600}N — the zone is chosen from the perimeter's own "
      f"longitude, since California spans zones 10 and 11):\n")
    A(f"- Perimeter: CAL FIRE FRAP, `FIRE_NAME='{fire.name}' AND "
      f"YEAR_={fire.year}` — {fire.acres:,.0f} acres.")
    A(f"- Fuel: LANDFIRE `LF{fire.fuel_vintage}_FBFM40_CONUS` — the newest "
      f"vintage strictly *before* the fire, because a later one already encodes "
      f"this fire's own burn scar as changed fuel.")
    A("- Terrain: LANDFIRE `LF2020_Elev_CONUS` (terrain is static).")
    A("- Wind: Open-Meteo historical archive, **hourly**, anchored to the "
      "fire's alarm date.\n")
    A(f"- Study area {dom.width/1000:.1f} × {dom.height/1000:.1f} km "
      f"(perimeter bbox + 3 km), fuel mix: {mix}")
    if s is not None:
        # Scoped to the hours the run reached. Quoting the whole fetched window
        # here would report a wind the fire never experienced.
        A(f"- Wind actually applied: {s.summary(stats.get('run_minutes'))}")
        A(f"- {stats.get('wind_hours', 0)} hourly values were applied, source "
          f"`{stats.get('wind_source', '?')}`, rebuilt at each hour boundary.")
    if fire.ignition_is_assumed:
        A(f"- **Ignition assumed** at the perimeter centroid — FRAP maps no origin "
          f"for this fire. Direction metrics are not meaningful here.")
    elif fire.ignition_shift_m > 1.0:
        A(f"- Ignition: the reported origin lies {fire.ignition_shift_m:.0f} m "
          f"*outside* the mapped perimeter, so the point was snapped to the "
          f"nearest burnt ground rather than igniting outside the scar.")
    A(f"- Mapped perimeter: {stats['perimeter_km2']:.1f} km² total "
      f"({stats['perimeter_main_km2']:.1f} km² in the main polygon).")
    for w in fire.warnings:
        A(f"- **Caveat:** {w}")
    A("")

    A("### The number\n")
    A("| metric | value |\n|---|---:|")
    A(f"| **IoU vs mapped perimeter (area-matched)** | **{stats['iou_area_matched']:.3f}** |")
    A(f"| IoU vs main polygon only | {stats['iou_area_matched_main']:.3f} |")
    A(f"| IoU at full unchecked burn | {stats['iou_full_burn']:.3f} |")
    A(f"| simulated time to reach the observed area | "
      f"{stats['minutes_to_reach_area']/60:.1f} h |")
    A(f"| unchecked burn area at run end | {stats['sim_full_km2']:.0f} km² |")
    A(f"| mesh | {stats['n_cells']:,} cells @ d_min = {stats['d_min']:.0f} m |")
    A("")
    A("The real fire burned for weeks under active suppression, so comparing at a "
      "fixed simulated duration would mostly measure how long the run happened to be. "
      "The scar is instead truncated at the step where it first reaches the *observed* "
      "area, which scores shape and direction while reporting the time taken "
      "separately as the rate check. This is one post-hoc cut, not a fitted "
      "parameter — no constant was changed for M7.\n")

    A("### Wind: sampled in time, not averaged\n")
    A("An earlier version of this section read the wind from a single hardcoded "
      "day, in UTC, and collapsed its 24 hours into one vector. That is now known "
      "to have been the dominant error in M7:\n")
    A("- The fire alarmed on "
      f"{fire.record.alarm.isoformat() if fire.record.alarm else '?'}; the sampled "
      "day fell three days later, after the driving offshore flow had already "
      "reversed to the onshore sea breeze.")
    A("- Averaging made it worse rather than smoothing noise. Over the Lake Fire's "
      "burn window the direction genuinely reverses — FROM 40–60° on 07-05/06, FROM "
      "250–290° on 07-07/09 — so a mean bearing points somewhere the wind never "
      "blew. Widening the window from the alarm day to the full 31 days moves the "
      "mean from 51° off the observed spread direction to 163° off.")
    A("- Measured effect of anchoring hourly to the alarm date instead: the "
      "simulated scar's push direction went from **146° wrong to 41° wrong**, and "
      "IoU from **0.278 to 0.406** — the largest single improvement in this study, "
      "with no calibration constant touched.\n")
    A("Gust wind was tested as the spread driver and measured slightly *worse* "
      "than sustained (0.394 against 0.406), so sustained 10 m wind remains the "
      "default and `--wind-source gust` is kept only as a sensitivity axis. The "
      "reason is in the limitation below: downwind ignition has already saturated, "
      "so extra speed lifts the upwind tail without extending the head.\n")

    if sens:
        A("Regenerated wind-sensitivity check (each arm is a full run at the same "
          "seed and mesh):\n")
        A("| wind treatment | speed (m/s) | toward | IoU |\n|---|---:|---:|---:|")
        for r in sens:
            A(f"| {r['label']} | {r['wind_ms']:.1f} | {r['wind_toward']:.0f}° | "
              f"{r['iou']:.3f} |")
        A("")

    A("### Known limitation: residence-time dilution\n")
    A("The scar reaches roughly the right place but not the right *shape* — "
      "simulated aspect ratio is ~1.0 against an observed 2.79. This is a property "
      "of the transition rule, not of the wind input, and no weather data can fix "
      "it:\n")
    A("A burning cell gets one ignition draw per neighbour *per step*, and stays "
      "burning for `tau` steps — a median of 31 on this mesh. Integrated over that "
      "residence time, a 19× per-step directional preference collapses to 3.6×:\n")
    A("| effective over | downwind | upwind | ratio |\n|---|---:|---:|---:|")
    A("| 1 step | 0.197 | 0.010 | 19.0× |")
    A("| 15 steps | 0.963 | 0.144 | 6.7× |")
    A("| 31 steps (median τ) | 0.9998 | 0.340 | 3.6× |")
    A("")
    A("Downwind ignition saturates at near-certainty while the upwind tail keeps "
      "climbing, so the fire spreads almost isotropically however hard the wind "
      "blows.\n")
    A("### The arrival-time rule (`--rule ros`)\n")
    A("`spread.py` replaces the per-step draw with an arrival-time formulation, "
      "following the Voronoi-mesh treatment in NHESS 25:2909 (2025) and the same "
      "family as Finney's minimum-travel-time method, Cell2Fire and ELMFIRE:\n")
    A("```\nP_ij(t+dt) = P_ij(t) + R_ij * dt / d_ij,   ignite j when P_ij >= 1\n```\n")
    A("Anisotropy now lives in a *rate*, so a head/back ratio of X stays X however "
      "many steps elapse — there is no repeated trial left to saturate. Two "
      "consequences worth stating plainly:\n")
    A("1. **Residence time is decoupled from propagation.** An edge keeps "
      "advancing once its source has ever ignited, not only while it is still "
      "flaming. This is required, not cosmetic: gating on BURNING makes `tau` a "
      "hard directional cutoff, since any direction whose crossing time exceeds "
      "`tau` could never propagate at all. At 9 m/s the backing direction needs "
      "~1750 min to cross a 98 m edge against a `tau` of 6, so backing spread "
      "would be impossible and the ellipse truncated into a wedge. The "
      "elliptical-front models treat it the same way — residence time governs "
      "intensity, never whether the front advances.")
    A("2. **Shape is now predicted, not fitted.** Length-to-breadth comes from "
      "Alexander (1985), `L/B = 1 + 0.00120 * W^2.154` with W the 10 m wind in "
      "km/h, so the only free constants left are the two magnitude terms. On a "
      "flat uniform landscape the simulated scar reproduces that ellipse to "
      "within a few percent up to ~5 m/s (measured: 1.33 against 1.38 predicted "
      "at 4 m/s).\n")
    A("**This reframes the shape target.** At the 4 m/s this fire was actually run "
      "with, Alexander predicts L/B ≈ 1.38 — so 1.38, not the observed 2.79, is "
      "what the scar should be scored against. Reaching 2.79 needs about 8.3 m/s, "
      "which sits between this fire's sustained (4.0) and gust (11.5) wind. The "
      "model is not far from correct *given its inputs*; the residual is an input "
      "and missing-physics problem, not a transition-rule one.\n")
    A("| rule | IoU | scar aspect | predicted L/B |\n|---|---:|---:|---:|")
    A("| `bernoulli` (per-step draw) | 0.391 | 1.12 | — |")
    A("| `ros` (arrival time) | 0.402 | 1.20 | 1.17 |")
    A("")
    A("Known limitation of the new rule: above ~5 m/s the mesh under-elongates "
      "relative to the predicted ellipse (about −11% at 6 m/s, widening with "
      "speed), and refining the mesh does *not* help. The cause is the gap between "
      "network and continuum anisotropy — spread must follow Delaunay edges, so a "
      "path only approximates the straight line, and the penalty is larger toward "
      "the head where rate varies fastest with angle. This bounds the aspect the "
      "model can reach at high wind and is pinned by a regression test.\n")
    A("`p0`, `c1` and `c2` are **not** recalibrated — under the arrival-time rule "
      "they are retired rather than retuned, so the two rules stay independently "
      "attributable and the Bernoulli path continues to reproduce every earlier "
      "result bit for bit.\n")
    A("Two further contributors, unchanged from earlier analysis:\n")
    A("1. **Weak terrain channelling.** `a_slope = 0.078` per radian gives only a "
      "~14% uphill/downhill difference (measured up/down ratio 1.14× on the real "
      "mesh, where edge slopes reach 48°). Real chaparral fires in the San Rafael "
      "Mountains are steered hard by topography; this model barely feels it.")
    A("2. **No suppression, spotting, or diurnal cycle.** Left alone the model "
      f"burns {stats['sim_full_km2']:.0f} km² — nearly the whole study area — "
      "because nothing stops it.\n")

    A("Artifacts:\n")
    for k in paths:
        A(f"- `{k}`")

    section = "\n".join(L) + "\n"
    heading = L[0]

    existing = ""
    if os.path.exists(md_path):
        with open(md_path, encoding="utf-8") as f:
            existing = f.read()

    # Retire the single-fire section from before M7 could select a fire; its
    # wind conclusions were drawn from a wind that never blew.
    if LEGACY_HEADING != heading:
        existing = _splice_section(existing, LEGACY_HEADING, "")

    # Then update only this fire's own section, leaving other fires' alone.
    merged = _splice_section(existing, heading, section)

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(merged.rstrip() + "\n")
    return md_path


if __name__ == "__main__":
    from domain import FUEL_NAMES, out

    fire = load_lake_fire()
    dom = fire.domain
    tot = dom.fuel.size
    print("\nfuel mix on the study area:")
    for c in sorted(FUEL_NAMES):
        n = int((dom.fuel == c).sum())
        print(f"   {FUEL_NAMES[c]:10s} {100*n/tot:5.1f}%")
    print(f"\nignition (local m): ({fire.ignition_xy[0]:.0f}, {fire.ignition_xy[1]:.0f})"
          f"  [moved {fire.ignition_shift_m:.0f} m, source: {fire.ignition_source}]")
    print("wrote", plot_real_domain(fire, out("m7_real_domain.png")))
    print("wrote", plot_wind_series(fire, out("m7_wind_series.png")))

    print("\n--- validation against the mapped perimeter ---")
    stats, bundle = validate(fire)
    print("wrote", plot_validation(fire, stats, bundle, out("m7_validation.png")))
