"""Where the forest actually is: ESA WorldCover 10 m, read in windows.

WorldCover is ~2650 tiles of 36000x36000 pixels; the full set is a few hundred
gigabytes, so nothing here ever downloads a tile.  GDAL's ``/vsicurl/`` driver
issues HTTP range requests against the public S3 bucket and reads only the
window asked for, which is what makes a global pipeline possible on a laptop.

Classes used downstream (WorldCover v200 legend):

===  ======================  ==================================================
 10  tree cover              the forest itself
 20  shrubland               burns readily -- chaparral, maquis, fynbos
 30  grassland               fast, low-intensity spread; carries fire between stands
 40  cropland                mostly a break, though stubble burns
 50  built-up                what the network exists to protect
 60  bare / sparse           unburnable
 70  snow and ice            unburnable
 80  permanent water         unburnable
 90  herbaceous wetland      rarely carries fire
 95  mangroves               rarely carries fire
100  moss and lichen         burns in the boreal, slowly
===  ======================  ==================================================
"""

from __future__ import annotations

import os

import numpy as np

from .geo import BBox

WORLDCOVER_BASE = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
)

TREE, SHRUB, GRASS, CROP, BUILT, BARE, SNOW, WATER, WETLAND, MANGROVE, MOSS = (
    10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100
)

CLASS_NAMES = {
    TREE: "tree cover", SHRUB: "shrubland", GRASS: "grassland",
    CROP: "cropland", BUILT: "built-up", BARE: "bare/sparse",
    SNOW: "snow/ice", WATER: "water", WETLAND: "wetland",
    MANGROVE: "mangroves", MOSS: "moss/lichen",
}

#: Relative flammability by class.  These are weights on *how readily the class
#: carries fire*, not fuel load: grassland ignites and spreads faster than
#: closed canopy even though it holds far less biomass, which is why it is not
#: simply ordered by vegetation size.
FLAMMABILITY = {
    TREE: 1.00, SHRUB: 1.00, GRASS: 0.75, MOSS: 0.55, CROP: 0.30,
    WETLAND: 0.15, MANGROVE: 0.10, BUILT: 0.0, BARE: 0.0, SNOW: 0.0, WATER: 0.0,
}

#: Classes a node may be sited on or near and expect to detect something.
BURNABLE = (TREE, SHRUB, GRASS, MOSS, CROP)


def _gdal_env():
    """Range-request settings. Without these GDAL lists the whole bucket."""
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
    os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")


def tile_url(tile: str) -> str:
    return WORLDCOVER_BASE.format(tile=tile)


def read_landcover(box: BBox, max_px: int = 1400):
    """Land-cover classes over a box, decimated to at most ``max_px`` a side.

    Returns ``(classes, transform_bounds, missing_tiles)``.  Reading at native
    10 m over a whole forest would be hundreds of megapixels and is not needed
    to site sensors that cover kilometres, so the read is decimated on the way
    out of GDAL -- the decimation happens server-side in the sense that only
    the overview levels touched are fetched.

    Tiles that 404 are reported rather than raised: WorldCover only publishes
    land, so a box spanning coastline legitimately misses tiles, and treating
    that as an error would make every coastal forest unrunnable.
    """
    import rasterio
    from rasterio.errors import RasterioIOError
    from rasterio.windows import from_bounds

    _gdal_env()

    # One output grid for the whole box, then each tile is pasted into its own
    # sub-block.  Merging tiles by overlapping their raw arrays instead would
    # silently crop the box to the smaller tile's footprint -- a box straddling
    # a tile seam would come back a fraction of its true width, with no error.
    native = 1.0 / 12000.0  # WorldCover is 1/12000 degree, ~10 m
    full_w = max(1, int(round((box.east - box.west) / native)))
    full_h = max(1, int(round((box.north - box.south) / native)))
    scale = max(1, int(np.ceil(max(full_w, full_h) / max_px)))
    out_w = max(1, full_w // scale)
    out_h = max(1, full_h // scale)

    out = np.zeros((out_h, out_w), dtype=np.uint8)
    missing = []
    any_data = False

    for t in box.tiles():
        try:
            with rasterio.open(f"/vsicurl/{tile_url(t)}") as ds:
                tb = ds.bounds
                w = max(box.west, tb.left)
                e = min(box.east, tb.right)
                s = max(box.south, tb.bottom)
                n = min(box.north, tb.top)
                if e <= w or n <= s:
                    continue

                # Destination block, in output pixels, north-up for now.
                c0 = int(round((w - box.west) / (box.east - box.west) * out_w))
                c1 = int(round((e - box.west) / (box.east - box.west) * out_w))
                r0 = int(round((box.north - n) / (box.north - box.south) * out_h))
                r1 = int(round((box.north - s) / (box.north - box.south) * out_h))
                bh, bw = r1 - r0, c1 - c0
                if bh < 1 or bw < 1:
                    continue

                arr = ds.read(1, window=from_bounds(w, s, e, n, ds.transform),
                              out_shape=(bh, bw), boundless=True, fill_value=0)
                blank = out[r0:r1, c0:c1] == 0
                out[r0:r1, c0:c1][blank] = arr[blank]
                any_data = True
        except RasterioIOError:
            missing.append(t)
            continue

    if not any_data:
        return None, box, missing

    # Row 0 = south edge, matching the convention the rest of the project uses
    # for rasters; getting this backwards mirrors every network north-south.
    return np.flipud(out).copy(), box, missing


def flammability_field(classes: np.ndarray) -> np.ndarray:
    """Per-pixel flammability weight in [0, 1] from land-cover classes."""
    f = np.zeros(classes.shape, dtype=float)
    for code, w in FLAMMABILITY.items():
        if w > 0:
            f[classes == code] = w
    return f


def burnable_mask(classes: np.ndarray) -> np.ndarray:
    return np.isin(classes, BURNABLE)


def forest_fraction(classes: np.ndarray) -> float:
    """Share of the box that is tree cover or shrubland."""
    if classes is None or classes.size == 0:
        return 0.0
    return float(np.isin(classes, (TREE, SHRUB)).mean())


def class_mix(classes: np.ndarray) -> dict:
    """Readable class breakdown, largest first."""
    if classes is None or classes.size == 0:
        return {}
    vals, counts = np.unique(classes, return_counts=True)
    tot = counts.sum()
    mix = {
        CLASS_NAMES.get(int(v), f"class {int(v)}"): float(c) / tot
        for v, c in zip(vals, counts) if v != 0
    }
    return dict(sorted(mix.items(), key=lambda kv: -kv[1]))
