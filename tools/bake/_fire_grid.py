"""Rasterise a mesh arrival field onto a coarse grid, sparsely.

The browser needs arrival times to compute detection time live, but it must
not download 100 dense rasters. A two-hour fire burns a small part of an
82x67 km box, so storing only the burnt cells costs about 4 bytes each.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

#: 100 m, matched to the SIMULATION's own resolution rather than to the
#: detection radius.
#:
#: This was 500 m, sized against the Bernoulli rule's 27-30 km2 scars. Task 2
#: then selected spread.simulate_ros, whose scars are 0.4-0.7 km2 -- smaller
#: than two 500 m cells. Measured on the first bake: a median of 2 burnt cells
#: per ignition and 2 ignitions burning nothing at all, which is not a fire the
#: detection query can say anything about. The grid has to resolve the thing it
#: is rasterising.
#:
#: 100 m is about the mesh's own spacing at d_min = 90 (~76 cells/km2, so
#: ~115 m between generators); finer than that would interpolate detail the
#: simulation never had. The download does not object: only burnt cells are
#: stored, and a 0.5 km2 scar is ~50 cells, so 100 ignitions cost tens of
#: kilobytes even at 8 bytes a record.
DEFAULT_CELL_M = 100.0
#: uint32 cell indices. At 100 m this box is 844 x 690 = 582,360 cells, well
#: past uint16 -- the previous dtype. Assert, never assume: a wrap here would
#: scatter each fire uniformly across the map, which looks like data.
MAX_CELLS = 4294967295


@dataclass(frozen=True)
class FireGrid:
    nx: int
    ny: int
    cell_m: float
    width_m: float
    height_m: float

    @staticmethod
    def over(width_m: float, height_m: float, cell_m: float = DEFAULT_CELL_M):
        nx = int(np.ceil(width_m / cell_m))
        ny = int(np.ceil(height_m / cell_m))
        if nx * ny > MAX_CELLS:
            raise RuntimeError(
                f"grid {nx}x{ny} = {nx * ny} cells exceeds uint32; either "
                f"coarsen cell_m or widen the index dtype -- do not let it wrap"
            )
        return FireGrid(nx, ny, float(cell_m), float(width_m), float(height_m))

    def centres(self):
        """(N, 2) cell centres in domain metres, row 0 at the SOUTH edge."""
        xs = (np.arange(self.nx) + 0.5) * self.width_m / self.nx
        ys = (np.arange(self.ny) + 0.5) * self.height_m / self.ny
        gx, gy = np.meshgrid(xs, ys)
        return np.column_stack([gx.ravel(), gy.ravel()])


def encode(mesh, arrival_min, grid: FireGrid, owners=None):
    """-> (cell_index uint32, minutes uint32) for burnt cells only.

    Nearest-generator lookup, the same rule metrics.RefGrid uses. `owners`
    is the precomputed nearest-generator index per grid cell -- hoist it out
    of the ignition loop, it does not depend on the ignition.

    Both halves are uint32 so a record is 8 aligned bytes. Minutes would fit
    in uint16, but a 4+2 record misaligns every second field and buys nothing:
    the file is tens of kilobytes either way.
    """
    if owners is None:
        owners = cKDTree(mesh.points).query(grid.centres())[1]
    t = np.asarray(arrival_min, dtype=np.float64)[owners]
    burnt = np.isfinite(t)
    idx = np.flatnonzero(burnt).astype(np.uint32)
    mins = np.rint(t[burnt]).astype(np.uint32)
    return idx, mins


def owners_for(mesh, grid: FireGrid):
    """Nearest mesh generator per grid cell. Ignition-independent."""
    return cKDTree(mesh.points).query(grid.centres())[1]
