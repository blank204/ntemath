"""M6 - Comparing burn scars across resolutions.

Meshes at different ``d_min`` do not line up cell-for-cell, so every comparison
happens on a **common fine raster**.  A Voronoi cell is by definition the set of
points closer to its generator than to any other, so painting a scar onto the
raster is exactly a nearest-generator lookup -- a single cKDTree query per mesh,
and exact rather than an approximation of polygon rasterisation.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from attributes import Attributes
from domain import Wind
from fire import FireResult
from mesh import Mesh


@dataclass
class RefGrid:
    """The common raster every burn scar is compared on."""

    width: float
    height: float
    nx: int = 512
    ny: int = 512

    def __post_init__(self):
        # pixel centres
        self.xs = (np.arange(self.nx) + 0.5) * self.width / self.nx
        self.ys = (np.arange(self.ny) + 0.5) * self.height / self.ny
        gx, gy = np.meshgrid(self.xs, self.ys)
        self.pix = np.column_stack((gx.ravel(), gy.ravel()))

    @property
    def pixel_area(self) -> float:
        return (self.width / self.nx) * (self.height / self.ny)

    @property
    def shape(self):
        return (self.ny, self.nx)

    def owners(self, mesh: Mesh) -> np.ndarray:
        """Index of the Voronoi cell containing each pixel centre."""
        _, idx = cKDTree(mesh.points).query(self.pix)
        return idx.reshape(self.shape)


def rasterise_mask(owners: np.ndarray, cell_mask: np.ndarray) -> np.ndarray:
    return cell_mask[owners]


def rasterise_values(owners: np.ndarray, cell_values: np.ndarray) -> np.ndarray:
    return cell_values[owners]


# --------------------------------------------------------------------------
# metrics
# --------------------------------------------------------------------------


def iou(a: np.ndarray, b: np.ndarray) -> float:
    """Jaccard index of two boolean rasters."""
    inter = np.count_nonzero(a & b)
    union = np.count_nonzero(a | b)
    return float(inter / union) if union else float("nan")


def burned_area_error(a: np.ndarray, ref: np.ndarray) -> float:
    """|A - A_ref| / A_ref on pixel counts."""
    ar = np.count_nonzero(ref)
    if ar == 0:
        return float("nan")
    return float(abs(np.count_nonzero(a) - ar) / ar)


def burned_area_signed(a: np.ndarray, ref: np.ndarray) -> float:
    ar = np.count_nonzero(ref)
    if ar == 0:
        return float("nan")
    return float((np.count_nonzero(a) - ar) / ar)


def arrival_rmse(t: np.ndarray, t_ref: np.ndarray) -> float:
    """RMSE of arrival time (minutes) over pixels burnt in both rasters."""
    both = np.isfinite(t) & np.isfinite(t_ref)
    if not both.any():
        return float("nan")
    d = t[both] - t_ref[both]
    return float(np.sqrt(np.mean(d * d)))


def position_series(mesh: Mesh, res: FireResult, direction=None) -> np.ndarray:
    """Furthest distance reached along ``direction``, per step (metres).

    ``direction`` is a unit vector; ``None`` means "no preferred axis", in which
    case the maximum radius from the ignition point is used instead.
    """
    origin = mesh.points[res.seed_cell]
    rel = mesh.points - origin
    if direction is None:
        proj = np.linalg.norm(rel, axis=1)
    else:
        proj = rel @ np.asarray(direction, dtype=float)

    burnt = res.arrival_step >= 0
    a = res.arrival_step[burnt]
    p = proj[burnt]
    order = np.argsort(a, kind="stable")
    a = a[order]
    p = p[order]
    running = np.maximum.accumulate(p)

    # for each step, the running max over cells that had arrived by then
    steps = np.arange(res.steps + 1)
    idx = np.searchsorted(a, steps, side="right") - 1
    return np.where(idx >= 0, running[np.clip(idx, 0, len(running) - 1)], 0.0)


def _edge_distance(mesh: Mesh, res: FireResult, direction=None) -> float:
    """Distance from the ignition point to the domain edge, along ``direction``."""
    ox, oy = mesh.points[res.seed_cell]
    if direction is None:
        return min(ox, oy, mesh.width - ox, mesh.height - oy)
    vx, vy = np.asarray(direction, dtype=float)
    ts = []
    if vx > 1e-9:
        ts.append((mesh.width - ox) / vx)
    elif vx < -1e-9:
        ts.append(-ox / vx)
    if vy > 1e-9:
        ts.append((mesh.height - oy) / vy)
    elif vy < -1e-9:
        ts.append(-oy / vy)
    return min(ts) if ts else min(ox, oy, mesh.width - ox, mesh.height - oy)


def ros_along(mesh: Mesh, res: FireResult, direction=None, lo: float = 0.15) -> float:
    """Rate of spread along ``direction`` in m/min, from a straight-line fit.

    The fit stops once the front nears the domain edge; past that point the
    series plateaus for want of anywhere to go, and including the plateau would
    report a spread rate that says more about the box than about the fire.
    """
    pos = position_series(mesh, res, direction)
    n = len(pos)
    if n < 5:
        return float("nan")

    cap = 0.85 * _edge_distance(mesh, res, direction)
    valid = np.flatnonzero(pos < cap)
    i1 = int(valid[-1]) if valid.size else n - 1
    i0 = int(lo * i1)
    if i1 - i0 < 4:
        i0, i1 = 0, min(n - 1, max(4, i1))
    if i1 <= i0:
        return float("nan")

    t = np.arange(i0, i1 + 1) * res.dt_s / 60.0
    return float(np.polyfit(t, pos[i0 : i1 + 1], 1)[0])


def _wind_axis(wind: Wind):
    """The head direction for a wind, or ``None`` when the wind is calm."""
    return wind.vector if wind.speed_ms > 0 else None


def head_position_series(mesh: Mesh, res: FireResult, wind: Wind) -> np.ndarray:
    """Furthest downwind distance reached by the fire, per step (metres)."""
    return position_series(mesh, res, _wind_axis(wind))


def head_ros(mesh: Mesh, res: FireResult, wind: Wind, lo: float = 0.15) -> float:
    """Head rate of spread in m/min (radial rate when the wind is calm)."""
    return ros_along(mesh, res, _wind_axis(wind), lo=lo)


# --------------------------------------------------------------------------
# consensus reference
# --------------------------------------------------------------------------


@dataclass
class Reference:
    """A stochastic-ensemble reference truth built from many fine-mesh runs.

    Tying the reference to one point layout would confound layout noise with
    resolution error, so the reference scar is the pixel-wise **majority vote**
    over independently re-meshed replicates, and the reference arrival time is
    the replicate mean.
    """

    burnt: np.ndarray  # bool raster: burnt in >= half the replicates
    arrival: np.ndarray  # float raster, minutes, NaN outside `burnt`
    masks: list  # per-replicate boolean rasters
    arrivals: list  # per-replicate arrival rasters
    d_min: float
    grid: RefGrid

    @property
    def n_replicates(self) -> int:
        return len(self.masks)

    def area_km2(self) -> float:
        return np.count_nonzero(self.burnt) * self.grid.pixel_area / 1e6

    def leave_one_out(self, i: int):
        """Consensus built from every replicate except ``i``.

        Comparing reference replicate ``i`` against this gives an unbiased
        estimate of the stochastic noise floor -- the IoU a *perfect* coarse
        mesh could achieve, given that the model itself is random.
        """
        others = [m for k, m in enumerate(self.masks) if k != i]
        oth_a = [a for k, a in enumerate(self.arrivals) if k != i]
        return _consensus(others, oth_a)


def _consensus(masks, arrivals):
    import warnings

    stack = np.stack(masks)
    votes = stack.sum(axis=0)
    burnt = votes >= np.ceil(len(masks) / 2.0)
    with warnings.catch_warnings():
        # Pixels burnt in no replicate are all-NaN columns; their mean is
        # discarded by the `burnt` mask two lines below, so the warning is noise.
        warnings.simplefilter("ignore", RuntimeWarning)
        arr = np.nanmean(np.stack(arrivals), axis=0)
    arr = np.where(burnt, arr, np.nan)
    return burnt, arr


def build_reference(masks, arrivals, d_min: float, grid: RefGrid) -> Reference:
    burnt, arr = _consensus(masks, arrivals)
    return Reference(
        burnt=burnt, arrival=arr, masks=list(masks), arrivals=list(arrivals),
        d_min=d_min, grid=grid,
    )


def scar_rasters(mesh: Mesh, attrs: Attributes, res: FireResult, grid: RefGrid):
    """(burnt mask, arrival-time raster in minutes) for one run."""
    own = grid.owners(mesh)
    burnt = rasterise_mask(own, res.burnt_mask)
    arr = rasterise_values(own, res.arrival_min)
    arr = np.where(burnt, arr, np.nan)
    return burnt, arr


def compare(burnt, arrival, ref_burnt, ref_arrival) -> dict:
    return {
        "iou": iou(burnt, ref_burnt),
        "area_err": burned_area_error(burnt, ref_burnt),
        "area_signed": burned_area_signed(burnt, ref_burnt),
        "arrival_rmse": arrival_rmse(arrival, ref_arrival),
    }


def mean_ci(values, conf: float = 0.95):
    """Mean and half-width of the normal-approximation confidence interval."""
    v = np.asarray([x for x in values if np.isfinite(x)], dtype=float)
    if v.size == 0:
        return float("nan"), float("nan")
    if v.size == 1:
        return float(v[0]), 0.0
    from scipy import stats

    m = float(v.mean())
    se = float(v.std(ddof=1) / np.sqrt(v.size))
    h = float(stats.t.ppf(0.5 + conf / 2.0, v.size - 1) * se)
    return m, h
