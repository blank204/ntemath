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

THE HONEST LIMIT, WHICH THE SOURCE NOTES MUST CARRY. LIS/OTD is 0.1 degrees,
about 11 km. Over a 3-degree region that is roughly 30x30 native samples, so
it supplies a real regional gradient but no fine structure -- the fine
structure in the risk field comes from fuel. Upsampling it to the land-cover
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
