"""The lightning-density layer: a climatology resampled onto a region grid.

This replaces the FIRMS activity layer. The risk field stops meaning "where
fire has recently been" and starts meaning "where lightning ignition is
likely", which is the whole pivot -- and because the bake already ships
recombinable components, it is one raster swapped rather than a rewrite.

WHY A CLIMATOLOGY AND NOT LIVE STRIKES. Tower siting is a decision you make
once, for twenty years. It wants the long-term average strike density, not
last week's storms. NOAA's GOES-GLM feed is keyless and current and is the
right source for a live strike ticker; it is the wrong source for deciding
where to pour concrete. NASA's LIS/OTD gridded climatology is 20 years of
observations and is the correct product here.

THE HONEST LIMIT, WHICH THE SOURCE NOTES MUST CARRY. LIS/OTD HRFC is 0.5
degrees, about 55 km -- NOT the 0.1 degrees this file and the spec first
claimed. The 0.1-degree product is VHRFC, which is LIS only and therefore
stops at about +-38 degrees of latitude, so it does not exist for any boreal
region. Over the James Bay box, 0.5 degrees is 40 native samples for
314 x 244 km: a real regional gradient and no fine structure. The fine
structure in the risk field comes from fuel. Upsampling to the land-cover
grid is interpolation, not resolution, and anything that reads like a
per-hectare lightning map would be a lie.
"""

from __future__ import annotations

import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "outputs", "lightning"))

#: NASA GHRC DAAC, LIS/OTD gridded climatology. The download needs a free
#: Earthdata Login -- the anonymous endpoint returns 401 -- so the file is
#: fetched once by hand and cached here. It is NASA public domain, so a
#: region subset can be committed alongside the other baked inputs.
CLIMATOLOGY_DOC = (
    "https://lightning.nsstc.nasa.gov/data/data_lis-otd-climatology.html"
)
#: The granule itself: 14.4 MB, netCDF-4, HRFC v2.3.2015 (1995-05..2014-12).
CLIMATOLOGY_URL = (
    "https://data.ghrc.earthdata.nasa.gov/ghrcw-protected/"
    "lohrfc__2.3.2015/LISOTD_HRFC_V2.3.2015.nc"
)
CLIMATOLOGY_FILE = "LISOTD_HRFC_V2.3.2015.nc"

#: Combined LIS+OTD flash rate, flashes per square kilometre per year.
#: Above about 38 degrees of latitude the LIS half contributes nothing --
#: TRMM flew a 35-degree inclination -- so a boreal region is OTD only.
RATE_VAR = "HRFC_COM_FR"
#: OTD raw flash counts. The gradient gate runs on counts, not rates: a rate
#: hides how few observations it rests on, and Poisson error needs the count.
COUNT_VAR = "HRFC_OTD_RF"

#: THE RESOLUTION THE SPEC GOT WRONG. The spec's data table said 0.1 degrees,
#: which is the VHRFC product -- LIS only, and therefore capped at about
#: +-38 degrees of latitude. Any boreal region needs the LIS/OTD HRFC, which
#: is 0.5 degrees, roughly 55 km. Over the James Bay box that is 40 native
#: samples for 314 x 244 km, so this layer carries a regional gradient and
#: nothing finer. The fine structure in the risk field comes from fuel.
NATIVE_DEG = 0.5


def sample_density(lats, lons, values, box, shape):
    """Bilinearly sample a lat/lon climatology onto a region grid.

    `lats` and `lons` are the climatology's 1-D coordinate axes, `values` is
    its 2-D grid indexed ``[lat, lon]``. Returns a float32 array of `shape`
    ``(ny, nx)`` covering `box`, with **row 0 at the SOUTH edge** -- the same
    orientation as classes.bin, mask.bin and every other raster this project
    ships. Getting that backwards mirrors the field vertically, which looks
    plausible on a map and is completely wrong.

    Bilinear rather than nearest: an 11 km source upsampled by nearest
    neighbour produces visible 11 km blocks, and a reader would reasonably
    take those edges for real structure. Interpolation at least looks like
    what it is.

    Out-of-range samples clamp to the edge rather than returning NaN. A
    climatology that does not quite cover the box should degrade to its
    nearest observed value, not punch holes in the risk field.
    """
    lats = np.asarray(lats, dtype=np.float64)
    lons = np.asarray(lons, dtype=np.float64)
    values = np.asarray(values, dtype=np.float64)
    if values.shape != (lats.size, lons.size):
        raise RuntimeError(
            f"climatology grid {values.shape} does not match its axes "
            f"({lats.size}, {lons.size}) -- the file's dimension order is "
            "probably [lon, lat] rather than [lat, lon]"
        )

    ny, nx = shape
    west, south, east, north = box

    # Cell centres of the target grid. Row 0 is the SOUTH edge.
    tx = west + (np.arange(nx) + 0.5) * (east - west) / nx
    ty = south + (np.arange(ny) + 0.5) * (north - south) / ny

    # np.interp needs ascending axes; climatologies often ship north-up.
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        values = values[::-1, :]
    if lons[0] > lons[-1]:
        lons = lons[::-1]
        values = values[:, ::-1]

    # Fractional source index per target coordinate, clamped to the edges.
    fx = np.clip(np.interp(tx, lons, np.arange(lons.size)), 0, lons.size - 1)
    fy = np.clip(np.interp(ty, lats, np.arange(lats.size)), 0, lats.size - 1)

    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    x1 = np.minimum(x0 + 1, lons.size - 1)
    y1 = np.minimum(y0 + 1, lats.size - 1)
    wx = (fx - x0)[None, :]
    wy = (fy - y0)[:, None]

    v00 = values[np.ix_(y0, x0)]
    v01 = values[np.ix_(y0, x1)]
    v10 = values[np.ix_(y1, x0)]
    v11 = values[np.ix_(y1, x1)]
    out = (v00 * (1 - wx) * (1 - wy) + v01 * wx * (1 - wy)
           + v10 * (1 - wx) * wy + v11 * wx * wy)
    return np.ascontiguousarray(out, dtype="<f4")


def normalise(field):
    """Scale to [0, 1] by the field's own peak inside the box.

    The same convention `hazard.activity_field` used for the layer this
    replaces, which is what lets the risk recombination stay byte-identical
    arithmetic. It also means a value of 1.0 marks the most-struck ground in
    THIS box and says nothing about anywhere else -- a caveat the source
    notes must carry, exactly as they already do for the risk field.
    """
    f = np.asarray(field, dtype=np.float64)
    peak = float(f.max()) if f.size else 0.0
    out = f / peak if peak > 0 else f
    return np.ascontiguousarray(out, dtype="<f4")


def axes_from_transform(transform, width, height):
    """Cell-centre lat/lon axes from a GDAL affine transform.

    Returned in the file's own order -- a north-up grid gives descending
    latitudes -- because `sample_density` is the thing that knows how to
    flip, and one place that flips is one place to get it wrong.
    """
    x0, dx, _, y0, _, dy = (float(v) for v in transform)
    lons = x0 + (np.arange(width) + 0.5) * dx
    lats = y0 + (np.arange(height) + 0.5) * dy
    return lats, lons


def load_climatology(variable=RATE_VAR, path=None):
    """Read one variable out of the cached LIS/OTD granule.

    Returns ``(lats, lons, values)`` with `values` indexed ``[lat, lon]`` in
    the file's own orientation, which is what `sample_density` expects.

    rasterio rather than netCDF4: GDAL's netCDF driver is already in the
    bake's dependency set and netCDF4 is not, and this file is a plain
    2-D grid with no groups or time axis to justify a second reader.

    A zero is NOT missing data here even though the file names 0 as its
    fill value. Over five years of OTD sampling at 0.5 degrees, a cell with
    no observed flash is a real observation of a low rate; treating it as a
    hole would quietly delete the low end of the distribution.
    """
    import rasterio  # heavy, and only the bake ever needs it

    path = path or os.path.join(CACHE_DIR, CLIMATOLOGY_FILE)
    if not os.path.isfile(path):
        raise RuntimeError(
            f"lightning climatology not cached at {path}. It needs a free "
            f"NASA Earthdata Login -- the anonymous endpoint returns 401 -- "
            f"so fetch {CLIMATOLOGY_URL} once by hand and drop it there. "
            f"Product documentation: {CLIMATOLOGY_DOC}"
        )
    with rasterio.open(f"netcdf:{path}:{variable}") as ds:
        values = ds.read(1).astype(np.float64)
        lats, lons = axes_from_transform(
            ds.transform.to_gdal(), ds.width, ds.height)
    return lats, lons, values


def region_cells(lats, lons, box):
    """Indices of the native cells whose centres fall inside `box`.

    The gate measures the climatology as it was observed -- native cells,
    raw counts -- rather than the interpolated field, because interpolation
    invents neither signal nor significance and would only inflate the
    sample size.
    """
    lats = np.asarray(lats, dtype=np.float64)
    lons = np.asarray(lons, dtype=np.float64)
    west, south, east, north = box
    rows = np.where((lats >= south) & (lats <= north))[0]
    cols = np.where((lons >= west) & (lons <= east))[0]
    if rows.size == 0 or cols.size == 0:
        raise RuntimeError(
            f"box {box} contains no {NATIVE_DEG} deg climatology cell centres "
            f"({rows.size} rows x {cols.size} cols) -- it is smaller than one "
            "native sample, so there is nothing to measure"
        )
    return rows, cols


def uniformity_chi2(counts):
    """Test the flash counts against a uniform rate across the cells.

    Returns ``(chi2, dof, p)``. This is the gradient gate's core question:
    is the spatial structure in the climatology bigger than the Poisson
    noise of the counts it was built from? With a handful of flashes per
    cell, an eye-catching pattern can be pure sampling scatter, and shipping
    that as a risk layer would be inventing terrain.

    Assumes near-equal observation time per cell -- true for this granule
    over a small box (LIS/OTD viewtime varies ~3% across James Bay) and
    checked by the caller, not here.
    """
    from scipy import stats  # already a repo dependency, via place.py

    obs = np.asarray(counts, dtype=np.float64).ravel()
    total = float(obs.sum())
    if obs.size < 2 or total <= 0:
        raise RuntimeError(
            f"cannot test uniformity of {obs.size} cell(s) totalling {total} "
            "flashes -- there is no distribution to test"
        )
    expected = total / obs.size
    chi2 = float(((obs - expected) ** 2 / expected).sum())
    dof = obs.size - 1
    return chi2, dof, float(stats.chi2.sf(chi2, dof))


#: A gradient has to be significant on BOTH questions to count: the field
#: must differ from uniform at all, and it must differ along the axis the
#: region was chosen for. Structure with no direction is noise you have not
#: explained yet; a direction with no structure is a fluke of two halves.
GATE_ALPHA = 0.01


def gradient_report(box, path=None):
    """Measure the strike field across `box` before anything is baked.

    THE GATE. The spec chose the demo region partly on a hypothesis -- that a
    coast gives land-water convective contrast, and therefore real spatial
    structure in strike density -- and no literature quantifies that for this
    coast. So it gets measured, on the observed counts, before the layer is
    allowed to influence a single tower position. If it comes back flat, the
    honest move is to record that the layer is decorative, not to go shopping
    for a region that flatters the result.
    """
    from scipy import stats

    lats, lons, rate = load_climatology(RATE_VAR, path)
    _, _, counts = load_climatology(COUNT_VAR, path)
    _, _, viewtime = load_climatology("HRFC_OTD_VT", path)
    rows, cols = region_cells(lats, lons, box)
    sel = np.ix_(rows, cols)
    r, c, v = rate[sel], counts[sel], viewtime[sel]

    chi2, dof, p_uniform = uniformity_chi2(c)

    # East-west because that is the coast-to-inland axis here: the box's
    # west edge is the James Bay shoreline. Split at the middle column, and
    # test the halves as a binomial -- under a uniform rate a flash is
    # equally likely to land in either half.
    half = c.shape[1] // 2
    west_n, east_n = float(c[:, :half].sum()), float(c[:, half:].sum())
    p_ew = float(stats.binomtest(int(east_n),
                                 int(west_n + east_n), 0.5).pvalue)
    # And a rank correlation over the cells, which uses the whole axis
    # rather than one arbitrary cut.
    lon_grid = np.tile(lons[cols], (rows.size, 1))
    rho, p_rho = stats.spearmanr(lon_grid.ravel(), c.ravel())

    directional = p_ew < GATE_ALPHA or p_rho < GATE_ALPHA
    verdict = ("gradient" if p_uniform < GATE_ALPHA and directional
               else "structured" if p_uniform < GATE_ALPHA
               else "flat")
    return {
        "box": tuple(float(x) for x in box),
        "shape": (int(rows.size), int(cols.size)),
        "cells": int(rows.size * cols.size),
        "nativeDeg": NATIVE_DEG,
        "flashes": int(c.sum()),
        "flashesPerCell": float(c.mean()),
        "viewtimeSpreadPct": float(100 * (v.max() - v.min()) / v.mean()),
        "rateMin": float(r.min()), "rateMax": float(r.max()),
        "rateMean": float(r.mean()),
        "chi2": chi2, "dof": int(dof), "pUniform": p_uniform,
        "westFlashes": west_n, "eastFlashes": east_n,
        "eastWestRatio": float(east_n / west_n) if west_n else float("inf"),
        "pEastWest": p_ew,
        "spearmanRho": float(rho), "pSpearman": float(p_rho),
        "verdict": verdict,
    }


def main(argv=None):
    """Run the gate on a bake-side region and print the report."""
    import argparse
    import json

    from .regions import REGIONS

    p = argparse.ArgumentParser(description=main.__doc__)
    p.add_argument("--region", default="james-bay", choices=sorted(REGIONS))
    a = p.parse_args(argv)
    box = REGIONS[a.region]
    report = gradient_report(
        (box.west, box.south, box.east, box.north))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
