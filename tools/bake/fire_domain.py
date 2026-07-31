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

import numpy as np
from rasterio.warp import transform_bounds

from ._repo_import import repo_modules

realdata, domain, catalog = repo_modules("realdata", "domain", "catalog")

#: Los Padres sits in UTM zone 11N. realdata and catalog both default to it.
UTM_EPSG_LOS_PADRES = 32611


def utm_bounds(box_lonlat, epsg: int = UTM_EPSG_LOS_PADRES):
    """(west, south, east, north) in degrees -> the same in UTM metres.

    transform_bounds densifies the edges before projecting, so the returned
    box is the bounding box of the projected region rather than the
    projection of the four corners. Over 82 km those differ by hundreds of
    metres, and the difference is exactly the kind of quiet error that would
    put every node in the wrong place.
    """
    west, south, east, north = box_lonlat
    return transform_bounds("EPSG:4326", f"EPSG:{epsg}", west, south, east, north,
                             densify_pts=21)


def build_domain(box_lonlat, *, epsg: int = UTM_EPSG_LOS_PADRES,
                  res_m: float = 30.0, wind, year: int = 2022,
                  refresh: bool = False):
    """Fetch elevation and fuel over `box_lonlat` and assemble a Domain.

    Returns (Domain, provenance). Both rasters come back south-up-flipped
    from fetch_raster, which is the orientation domain.Domain expects, so
    neither is flipped again here -- flipping one and not the other is the
    classic way to build a landscape whose fuel does not sit on its terrain.
    """
    bounds = utm_bounds(box_lonlat, epsg)
    west, south, east, north = bounds
    width = float(east - west)
    height = float(north - south)

    elev = realdata.fetch_raster(realdata.ELEV_SERVICE, bounds, "lospadres_elev",
                                  epsg=epsg, res_m=res_m, refresh=refresh)
    # fbfm_service_for_year returns (service_path, vintage, warning) -- the
    # warning is empty when the resolved vintage is close enough to trust,
    # and non-empty when the nearest available FBFM40 vintage is more than a
    # couple of years from `year`. Keep it in the provenance rather than
    # dropping it: a stale-fuel-vintage warning is exactly the kind of thing
    # a benchmark run needs to be able to explain later.
    fbfm_service, vintage, vintage_warning = catalog.fbfm_service_for_year(year)
    fbfm = realdata.fetch_raster(fbfm_service, bounds,
                                  f"lospadres_fbfm40_lf{vintage}",
                                  epsg=epsg, res_m=res_m, refresh=refresh)
    if elev.shape != fbfm.shape:
        raise RuntimeError(
            f"elevation {elev.shape} and fuel {fbfm.shape} disagree; the two "
            "fetches resolved to different grids and the landscape would be "
            "fuel sitting on the wrong terrain"
        )

    fuel = realdata.fbfm40_to_fuel(fbfm)
    codes, counts = np.unique(fuel, return_counts=True)
    dom = domain.Domain(width=width, height=height,
                         elevation=np.asarray(elev, dtype=np.float64),
                         fuel=np.asarray(fuel), wind=wind)

    provenance = {
        "boxLonLat": [float(v) for v in box_lonlat],
        "utmEpsg": int(epsg),
        "utmBounds": [float(v) for v in bounds],
        "widthM": width, "heightM": height,
        "resM": float(res_m),
        "rasterShape": [int(elev.shape[0]), int(elev.shape[1])],
        "elevService": realdata.ELEV_SERVICE,
        "fbfmService": fbfm_service,
        "fbfmVintage": int(vintage),
        "fbfmVintageWarning": vintage_warning,
        "fuelMix": {int(c): int(n) for c, n in zip(codes, counts)},
        "elevRange": [float(np.nanmin(elev)), float(np.nanmax(elev))],
    }
    return dom, provenance
