"""Geographic helpers and the global tile grid.

Everything downstream works in WGS84 degrees but reasons about distances in
metres, so the conversion is centralised here rather than reinvented per
module.  At the equator a degree of longitude is ~111.3 km and at 70N it is
~38 km; a node network sized in kilometres has to respect that or it silently
becomes three times too dense in the boreal forest, which is exactly where the
largest fires are.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

#: Mean metres per degree of latitude (WGS84, close enough for spacing work).
M_PER_DEG_LAT = 111_320.0

#: ESA WorldCover ships 3x3 degree tiles on a fixed grid.
TILE_DEG = 3.0


def m_per_deg_lon(lat_deg: float) -> float:
    """Metres in one degree of longitude at a given latitude."""
    return M_PER_DEG_LAT * math.cos(math.radians(float(lat_deg)))


def deg_box_for_km(lat_deg: float, km: float) -> tuple:
    """(dlon, dlat) degrees spanning ``km`` at a latitude."""
    dlat = km * 1000.0 / M_PER_DEG_LAT
    dlon = km * 1000.0 / max(m_per_deg_lon(lat_deg), 1.0)
    return dlon, dlat


def haversine_km(lon1, lat1, lon2, lat2) -> np.ndarray:
    """Great-circle distance in km, vectorised."""
    r = 6371.0088
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


@dataclass(frozen=True)
class BBox:
    """A lon/lat bounding box, west/south/east/north."""

    west: float
    south: float
    east: float
    north: float

    def __post_init__(self):
        if self.east <= self.west or self.north <= self.south:
            raise ValueError(f"degenerate bbox {self!r}")
        if not (-180 <= self.west < 180 and -180 < self.east <= 180):
            raise ValueError(f"longitude out of range in {self!r}")
        if not (-90 <= self.south < self.north <= 90):
            raise ValueError(f"latitude out of range in {self!r}")

    @property
    def centre(self) -> tuple:
        return ((self.west + self.east) / 2.0, (self.south + self.north) / 2.0)

    @property
    def width_km(self) -> float:
        return (self.east - self.west) * m_per_deg_lon(self.centre[1]) / 1000.0

    @property
    def height_km(self) -> float:
        return (self.north - self.south) * M_PER_DEG_LAT / 1000.0

    @property
    def area_km2(self) -> float:
        return self.width_km * self.height_km

    def tiles(self) -> list:
        """Every WorldCover tile this box touches."""
        out = []
        y = math.floor(self.south / TILE_DEG) * TILE_DEG
        while y < self.north:
            x = math.floor(self.west / TILE_DEG) * TILE_DEG
            while x < self.east:
                out.append(tile_name(x, y))
                x += TILE_DEG
            y += TILE_DEG
        return out


def tile_name(lon: float, lat: float) -> str:
    """WorldCover tile id for the tile whose SW corner contains this point.

    Names are the south-west corner, e.g. ``N33W120``.  Getting the sign
    convention wrong silently fetches a tile on the other side of the world,
    so the floor is applied to the tile grid rather than to the raw value.
    """
    ty = int(math.floor(lat / TILE_DEG) * TILE_DEG)
    tx = int(math.floor(lon / TILE_DEG) * TILE_DEG)
    ns = "N" if ty >= 0 else "S"
    ew = "E" if tx >= 0 else "W"
    return f"{ns}{abs(ty):02d}{ew}{abs(tx):03d}"


def global_tiles(step: float = TILE_DEG) -> list:
    """Every tile name on the global grid, south-west corners.

    WorldCover only publishes tiles containing land, so a fetch may 404; that
    is expected and is how the pipeline discovers the land mask for free
    rather than shipping a coastline dataset.
    """
    names = []
    lat = -90.0
    while lat < 90.0:
        lon = -180.0
        while lon < 180.0:
            names.append(tile_name(lon, lat))
            lon += step
        lat += step
    return names


def subdivide(box: BBox, max_deg: float = 0.5) -> list:
    """Split a box into chunks no larger than ``max_deg`` on a side.

    A 10 m raster over one degree is 12000x12000 samples; anything bigger than
    a fraction of a degree has to be streamed in pieces or it will not fit in
    memory, and a global run would die on its first large forest.
    """
    out = []
    ny = max(1, int(math.ceil((box.north - box.south) / max_deg)))
    nx = max(1, int(math.ceil((box.east - box.west) / max_deg)))
    for j in range(ny):
        s = box.south + (box.north - box.south) * j / ny
        n = box.south + (box.north - box.south) * (j + 1) / ny
        for i in range(nx):
            w = box.west + (box.east - box.west) * i / nx
            e = box.west + (box.east - box.west) * (i + 1) / nx
            out.append(BBox(w, s, e, n))
    return out
