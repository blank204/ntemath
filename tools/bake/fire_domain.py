"""Build a fire-model Domain over an arbitrary lon/lat box.

realdata.load_fire cannot do this: it is keyed on a CAL FIRE FRAP fire
record and derives its bounds from that fire's perimeter, and it imports
shapely/geopandas/pyproj, none of which are installed. What it has that we
need is fetch_raster, which takes UTM metre bounds -- so this module is the
missing lon/lat -> UTM -> rasters -> Domain leg, and nothing more.

Reprojection goes through rasterio.warp rather than pyproj, per
docs/repo-issues.md:113, because pyproj is not a dependency of this repo
and this plan does not add one.
"""

from __future__ import annotations

import hashlib

import numpy as np
from rasterio.warp import transform_bounds

from ._repo_import import repo_modules

realdata, domain, catalog = repo_modules("realdata", "domain", "catalog")

#: Los Padres sits in UTM zone 11N. realdata and catalog both default to it.
UTM_EPSG_LOS_PADRES = 32611

#: If this much of the fetched box comes back rock/road + water, treat it as
#: a fetch failure rather than a landscape. ROCK is fbfm40_to_fuel's default
#: for every FBFM40 NoData code (c < 0 or c > 300, realdata.py:99-100), so an
#: out-of-CONUS box reads as overwhelmingly ROCK, not as a RuntimeError --
#: nothing downstream would notice until a Domain of bare rock/water produced
#: nonsense detection times. WATER is included too, at the review's direction,
#: since both are domain.UNBURNABLE_FUELS and a bad fetch could in principle
#: land on either sentinel; a real Los Padres box carries at most ~15% of the
#: two combined (measured: 9.5% ROCK + 5.0% WATER over the reference box).
UNBURNABLE_FRACTION_MAX = 0.80


def utm_bounds(box_lonlat, epsg: int = UTM_EPSG_LOS_PADRES):
    """(west, south, east, north) in degrees -> the same in UTM metres.

    transform_bounds densifies the edges before projecting, so the returned
    box is the bounding box of the projected region rather than the
    projection of the four corners. Over 82 km those differ by hundreds of
    metres, and the difference is exactly the kind of quiet error that would
    put every node in the wrong place.

    This is deliberately *not* snapped to any pixel grid -- res_m isn't a
    parameter here, only of build_domain -- so build_domain snaps the result
    itself before fetching (see there for why).
    """
    west, south, east, north = box_lonlat
    return transform_bounds("EPSG:4326", f"EPSG:{epsg}", west, south, east, north,
                             densify_pts=21)


def _cache_key(bounds: tuple, epsg: int, res_m: float) -> str:
    """A short hash identifying one (bounds, epsg, res_m) fetch.

    fetch_raster trusts whatever .tif already sits at its cache path once
    one exists (realdata.py:188-189) -- it never checks that the cached
    raster's extent matches the bounds being requested now. load_fire avoids
    this by keying its cache names on the fire's own slug plus epsg
    (realdata.py:256-260); this module has no fire record to key on, only
    the box/projection/resolution that actually determine the raster, so
    those are what get hashed. Without this, build_domain(other_box) or
    build_domain(box, res_m=60) would silently read back the Los Padres 30 m
    cache while its own provenance claimed the new box -- a wrong landscape
    that looks self-consistent.
    """
    key = f"{tuple(round(b, 3) for b in bounds)}_{int(epsg)}_{float(res_m)}"
    return hashlib.sha256(key.encode()).hexdigest()[:12]


def build_domain(box_lonlat, *, epsg: int = UTM_EPSG_LOS_PADRES,
                  res_m: float = 30.0, wind, year: int = 2022,
                  refresh: bool = False):
    """Fetch elevation and fuel over `box_lonlat` and assemble a Domain.

    Returns (Domain, provenance). Both rasters come back south-up-flipped
    from fetch_raster, which is the orientation domain.Domain expects, so
    neither is flipped again here -- flipping one and not the other is the
    classic way to build a landscape whose fuel does not sit on its terrain.
    """
    bounds_raw = utm_bounds(box_lonlat, epsg)

    # Snap outward to the res_m grid, exactly as realdata.study_bounds does
    # for FRAP fires (realdata.py:164-174). Without this, fetch_raster still
    # divides the un-snapped extent by res_m and rounds to a pixel count
    # (realdata.py:193-194), so both rasters stay mutually co-registered --
    # but the grid sits up to half a pixel off LANDFIRE's own native grid,
    # and the *delivered* cell size is whatever the un-snapped extent divides
    # into evenly, not res_m itself (measured: 29.9962 m, not 30.0, before
    # this fix). Snapping first makes the extent an exact multiple of res_m,
    # so the delivered resolution and the published resM agree exactly.
    west = float(np.floor(bounds_raw[0] / res_m) * res_m)
    south = float(np.floor(bounds_raw[1] / res_m) * res_m)
    east = float(np.ceil(bounds_raw[2] / res_m) * res_m)
    north = float(np.ceil(bounds_raw[3] / res_m) * res_m)
    bounds = (west, south, east, north)
    width = float(east - west)
    height = float(north - south)

    cache_key = _cache_key(bounds, epsg, res_m)
    elev = realdata.fetch_raster(
        realdata.ELEV_SERVICE, bounds, f"box{cache_key}_{epsg}_r{int(res_m)}_elev",
        epsg=epsg, res_m=res_m, refresh=refresh)
    # fbfm_service_for_year returns (service_path, vintage, warning) -- the
    # warning is empty when the resolved vintage is close enough to trust,
    # and non-empty when the nearest available FBFM40 vintage is more than a
    # couple of years from `year`. Keep it in the provenance rather than
    # dropping it: a stale-fuel-vintage warning is exactly the kind of thing
    # a benchmark run needs to be able to explain later.
    fbfm_service, vintage, vintage_warning = catalog.fbfm_service_for_year(year)
    fbfm = realdata.fetch_raster(
        fbfm_service, bounds, f"box{cache_key}_{epsg}_r{int(res_m)}_fbfm40_lf{vintage}",
        epsg=epsg, res_m=res_m, refresh=refresh)
    if elev.shape != fbfm.shape:
        raise RuntimeError(
            f"elevation {elev.shape} and fuel {fbfm.shape} disagree; the two "
            "fetches resolved to different grids and the landscape would be "
            "fuel sitting on the wrong terrain"
        )

    # LANDFIRE elevation NoData is a large negative sentinel (observed as
    # exactly -9999 over the reference box's coastal water). domain.Domain's
    # elevation is sampled bilinearly (domain.py: sample_elev), so leaving
    # -9999 in place would let every mesh node near the coast interpolate
    # against a fictitious cliff, not real terrain. Mirrors realdata.py's
    # own load_fire fix at 269-273 exactly (same threshold, same fill),
    # rather than reinventing a different one for this leg.
    elev = np.asarray(elev, dtype=np.float64)
    elev_valid = elev > -1000
    elev_nodata_count = int(elev.size - np.count_nonzero(elev_valid))
    if not elev_valid.all():
        elev[~elev_valid] = elev[elev_valid].min() if elev_valid.any() else 0.0

    fuel = realdata.fbfm40_to_fuel(fbfm)
    codes, counts = np.unique(fuel, return_counts=True)

    total_px = int(fuel.size)
    unburnable_px = int(sum(
        n for c, n in zip(codes, counts) if int(c) in domain.UNBURNABLE_FUELS
    ))
    unburnable_fraction = unburnable_px / total_px if total_px else 1.0
    if unburnable_fraction > UNBURNABLE_FRACTION_MAX:
        raise RuntimeError(
            f"{unburnable_fraction:.0%} of the fetched box is rock/road + "
            "water -- ROCK is fbfm40_to_fuel's default for FBFM40 NoData "
            "codes (c < 0 or c > 300), so this box most likely returned no "
            "usable LANDFIRE coverage (out-of-CONUS, or a bad/empty fetch) "
            "rather than genuinely being this barren. Refusing to build a "
            "Domain from it; pass refresh=True after checking the box, or "
            "inspect the cached .tif directly."
        )

    dom = domain.Domain(width=width, height=height, elevation=elev,
                         fuel=np.asarray(fuel), wind=wind)

    # Raw FBFM40 code histogram, not just the 5-class collapse below.
    # fbfm40_to_fuel's grass-shrub (GS, 121-124) -> GRASS and slash/blowdown
    # (SB, 201-204) -> SHRUB mappings are lossy (realdata.py:88,92): a box
    # that is mostly GS2 (code 122) reports as pure GRASS in fuelMix even
    # though GS2's k_veg/tau_min in the source data sit between GRASS's and
    # SHRUB's. The raw codes are the only place that distinction survives.
    raw_codes, raw_counts = np.unique(fbfm, return_counts=True)
    fbfm_raw_histogram = {int(c): int(n) for c, n in zip(raw_codes, raw_counts)}

    provenance = {
        "boxLonLat": [float(v) for v in box_lonlat],
        "utmEpsg": int(epsg),
        "utmBoundsRaw": [float(v) for v in bounds_raw],
        "utmBounds": [float(v) for v in bounds],
        "widthM": width, "heightM": height,
        "resM": float(res_m),
        "rasterShape": [int(elev.shape[0]), int(elev.shape[1])],
        "elevService": realdata.ELEV_SERVICE,
        "fbfmService": fbfm_service,
        "fbfmVintage": int(vintage),
        "fbfmVintageWarning": vintage_warning,
        "fuelMix": {int(c): int(n) for c, n in zip(codes, counts)},
        "fbfmRawHistogram": fbfm_raw_histogram,
        "unburnableFraction": unburnable_fraction,
        # Range of VALID elevation only -- the -9999 sentinel is filled
        # in-place above (to the valid minimum), so nanmin/nanmax of the
        # cleaned array already excludes the sentinel rather than reporting
        # it as if it were terrain.
        "elevRange": [float(np.nanmin(elev)), float(np.nanmax(elev))],
        "elevNoDataCount": elev_nodata_count,
    }
    return dom, provenance
