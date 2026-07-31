"""Where to put the sensors, and how few will do.

Two stages, because they answer different questions.

**Stage 1 - variable-radius blue noise.**  Bridson's Poisson-disk algorithm
with the minimum spacing made a function of position rather than a constant:

    r(x) = r_max - (r_max - r_min) * risk(x)

so spacing collapses toward ``r_min`` where fire risk is high and relaxes
toward ``r_max`` where it is low.  Blue noise is the right family here for the
same reason it is used for the simulation mesh: points are irregular, so the
network has no lattice direction a fire can slip along, yet no two are ever
closer than the local radius, so there is no clustering and no wasted
hardware.  A uniform grid fails the first property and uniform random sampling
fails the second -- random points clump, leaving holes that need extra nodes
to patch.

The acceptance test for variable radius uses ``max(r(p), r(q))`` rather than
``r(p)``: without that, a dense high-risk point can be planted just inside a
sparse neighbour's exclusion zone, and the sparse region quietly inherits the
dense region's spacing.

**Stage 2 - greedy minimisation.**  Blue noise gives good spacing but does not
know about detection range, so it over-provisions where circles already
overlap.  Minimum sensor count for a coverage target is the classic set-cover
problem and is NP-hard, so this uses the standard greedy rule -- repeatedly
take the node covering the most still-uncovered risk-weighted demand.  Greedy
is not merely a convenient heuristic here: for maximum coverage it is provably
within (1 - 1/e) ~ 63% of optimal, and no polynomial algorithm does
asymptotically better unless P = NP.

Distances are computed in a local equirectangular frame in kilometres,
recentred on each region.  Working in raw degrees would stretch every network
toward the poles and put boreal nodes about three times too close together.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree

from .geo import M_PER_DEG_LAT, BBox, m_per_deg_lon


# --------------------------------------------------------------------------
# local projection
# --------------------------------------------------------------------------


class LocalFrame:
    """Equirectangular km frame about a box centre. Good to ~0.1% over a forest."""

    def __init__(self, box: BBox):
        self.lon0, self.lat0 = box.centre
        self.kx = m_per_deg_lon(self.lat0) / 1000.0
        self.ky = M_PER_DEG_LAT / 1000.0
        self.box = box

    def to_km(self, lon, lat):
        return (np.asarray(lon, float) - self.lon0) * self.kx, \
               (np.asarray(lat, float) - self.lat0) * self.ky

    def to_lonlat(self, x, y):
        return np.asarray(x, float) / self.kx + self.lon0, \
               np.asarray(y, float) / self.ky + self.lat0

    @property
    def extent_km(self):
        w = (self.box.east - self.box.west) * self.kx
        h = (self.box.north - self.box.south) * self.ky
        return w, h


# --------------------------------------------------------------------------
# stage 1: variable-radius blue noise
# --------------------------------------------------------------------------


def _sample_field(field: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Nearest-neighbour lookup into a field indexed by fractional (u, v)."""
    ny, nx = field.shape
    j = np.clip((v * (ny - 1)).astype(int), 0, ny - 1)
    i = np.clip((u * (nx - 1)).astype(int), 0, nx - 1)
    return field[j, i]


def variable_poisson_disk(rng: np.random.Generator, risk: np.ndarray,
                          width_km: float, height_km: float,
                          r_min_km: float, r_max_km: float,
                          mask: np.ndarray | None = None,
                          k: int = 24, max_points: int = 200_000) -> np.ndarray:
    """Blue-noise points whose spacing follows a risk field.

    ``risk`` and ``mask`` are 2D arrays covering the same rectangle, row 0 at
    the south edge.  Returns an (n, 2) array of km coordinates.
    """
    if r_min_km <= 0 or r_max_km < r_min_km:
        raise ValueError("need 0 < r_min_km <= r_max_km")

    risk = np.clip(np.nan_to_num(risk, nan=0.0), 0.0, 1.0)

    def radius_at(x, y):
        u = np.clip(x / max(width_km, 1e-9), 0, 1)
        v = np.clip(y / max(height_km, 1e-9), 0, 1)
        return r_max_km - (r_max_km - r_min_km) * _sample_field(risk, u, v)

    def allowed(x, y):
        if mask is None:
            return np.ones(np.shape(x), dtype=bool)
        u = np.clip(x / max(width_km, 1e-9), 0, 1)
        v = np.clip(y / max(height_km, 1e-9), 0, 1)
        return _sample_field(mask.astype(float), u, v) > 0.5

    # Grid sized on the *smallest* radius so the neighbour test is never wrong;
    # the search window then has to span the largest.
    cell = r_min_km / np.sqrt(2.0)
    gw = max(1, int(np.ceil(width_km / cell)))
    gh = max(1, int(np.ceil(height_km / cell)))
    grid = np.full((gh, gw), -1, dtype=np.int64)
    reach = int(np.ceil(r_max_km / cell)) + 1
    offs = np.arange(-reach, reach + 1)

    pts = np.empty((max_points, 2), dtype=float)
    rad = np.empty(max_points, dtype=float)
    n = 0

    def insert(p, r):
        nonlocal n
        pts[n] = p
        rad[n] = r
        gi = min(int(p[0] / cell), gw - 1)
        gj = min(int(p[1] / cell), gh - 1)
        grid[gj, gi] = n
        n += 1
        return n - 1

    # Seed on the highest-risk allowed pixel, so growth starts where it matters.
    seeded = False
    order = np.argsort(risk, axis=None)[::-1]
    for flat in order[: max(1, risk.size // 4)]:
        jj, ii = np.unravel_index(flat, risk.shape)
        x = (ii + 0.5) / risk.shape[1] * width_km
        y = (jj + 0.5) / risk.shape[0] * height_km
        if bool(allowed(np.array([x]), np.array([y]))[0]):
            insert(np.array([x, y]), float(radius_at(np.array([x]), np.array([y]))[0]))
            seeded = True
            break
    if not seeded:
        return np.empty((0, 2))

    active = [0]
    while active and n < max_points:
        a = int(rng.integers(len(active)))
        idx = active[a]
        base = pts[idx]
        rb = rad[idx]

        ang = rng.random(k) * 2.0 * np.pi
        # Annulus [rb, 2*rb], area-uniform.
        rr = rb * np.sqrt(1.0 + 3.0 * rng.random(k))
        cand = base + np.column_stack((rr * np.cos(ang), rr * np.sin(ang)))

        ok = ((cand[:, 0] >= 0) & (cand[:, 0] < width_km)
              & (cand[:, 1] >= 0) & (cand[:, 1] < height_km))
        cand = cand[ok]
        if len(cand):
            cand = cand[allowed(cand[:, 0], cand[:, 1])]

        placed = False
        if len(cand):
            cr = radius_at(cand[:, 0], cand[:, 1])
            gi = np.minimum((cand[:, 0] / cell).astype(np.int64), gw - 1)
            gj = np.minimum((cand[:, 1] / cell).astype(np.int64), gh - 1)
            for c in range(len(cand)):
                ii = np.clip(gi[c] + offs, 0, gw - 1)
                jj = np.clip(gj[c] + offs, 0, gh - 1)
                near = grid[np.ix_(jj, ii)]
                near = near[near >= 0]
                if near.size:
                    d = np.hypot(pts[near, 0] - cand[c, 0], pts[near, 1] - cand[c, 1])
                    # The larger of the two radii governs -- see module docstring.
                    if np.any(d < np.maximum(rad[near], cr[c])):
                        continue
                new = insert(cand[c], float(cr[c]))
                active.append(new)
                placed = True
                break

        if not placed:
            active.pop(a)

    return pts[:n].copy()


# --------------------------------------------------------------------------
# stage 2: greedy minimisation
# --------------------------------------------------------------------------


@dataclass
class Coverage:
    """What a chosen set of nodes actually achieves."""

    chosen: np.ndarray            # indices into the candidate array
    covered_fraction: float       # risk-weighted demand covered
    area_fraction: float          # unweighted burnable demand covered
    per_node_gain: list = field(default_factory=list)

    @property
    def n(self) -> int:
        return int(len(self.chosen))


def greedy_minimise(cand_xy: np.ndarray, demand_xy: np.ndarray,
                    demand_w: np.ndarray, radius_km: float,
                    target: float = 0.95, max_nodes: int | None = None) -> Coverage:
    """Fewest candidates covering ``target`` of risk-weighted demand.

    Greedy: take whichever node adds the most uncovered weight, repeat.  Within
    (1 - 1/e) of optimal for coverage, and that bound is tight unless P = NP.
    """
    if len(cand_xy) == 0 or len(demand_xy) == 0:
        return Coverage(np.empty(0, dtype=int), 0.0, 0.0)

    w = np.asarray(demand_w, float)
    total = float(w.sum())
    if total <= 0:
        return Coverage(np.empty(0, dtype=int), 0.0, 0.0)

    # Which demand points each candidate can see.
    tree = cKDTree(demand_xy)
    sees = tree.query_ball_point(cand_xy, r=radius_km)
    sees = [np.asarray(s, dtype=np.int64) for s in sees]

    import heapq

    covered = np.zeros(len(demand_xy), dtype=bool)
    chosen = []
    gains = []
    limit = max_nodes if max_nodes is not None else len(cand_xy)

    # Lazy greedy (CELF). Marginal gain is submodular -- covering more demand
    # can only shrink what any other node adds -- so a candidate's stored gain
    # is always an upper bound on its true gain. That means a candidate whose
    # refreshed gain still beats every other candidate's stale bound is
    # provably the best pick, and the rest never need recomputing. Same answer
    # as recomputing all of them each round, at a fraction of the work.
    heap = [(-float(w[s].sum()) if s.size else 0.0, int(i), -1)
            for i, s in enumerate(sees)]
    heapq.heapify(heap)

    got = 0.0
    it = 0
    while got / total < target and len(chosen) < limit and heap:
        it += 1
        best = None
        while heap:
            neg, i, stamp = heapq.heappop(heap)
            s = sees[i]
            true_gain = float(w[s][~covered[s]].sum()) if s.size else 0.0
            if true_gain <= 0.0:
                continue
            if stamp == it or not heap or true_gain >= -heap[0][0] - 1e-12:
                best = (i, true_gain)
                break
            heapq.heappush(heap, (-true_gain, i, it))
        if best is None:
            break

        i, g = best
        covered[sees[i]] = True
        got = float(w[covered].sum())
        chosen.append(i)
        gains.append(g / total)

    area = float(covered.mean())
    return Coverage(np.asarray(chosen, dtype=int), got / total, area, gains)


def coverage_of(cand_xy: np.ndarray, demand_xy: np.ndarray, demand_w: np.ndarray,
                radius_km: float) -> tuple:
    """(risk-weighted, unweighted) demand fraction within range of any node."""
    if len(cand_xy) == 0 or len(demand_xy) == 0:
        return 0.0, 0.0
    tree = cKDTree(cand_xy)
    d, _ = tree.query(demand_xy, k=1)
    hit = d <= radius_km
    w = np.asarray(demand_w, float)
    tot = w.sum()
    return (float(w[hit].sum() / tot) if tot > 0 else 0.0), float(hit.mean())


def demand_points(risk: np.ndarray, mask: np.ndarray, width_km: float,
                  height_km: float, stride: int = 4) -> tuple:
    """Sample the burnable area into weighted demand points.

    Every burnable pixel is a place fire could start; using all of them at 10 m
    would be hundreds of millions of points, so they are sampled on a stride
    and weighted by risk.  The stride is the resolution at which coverage is
    scored, and is reported so the number means something.
    """
    ny, nx = risk.shape
    jj, ii = np.mgrid[0:ny:stride, 0:nx:stride]
    m = mask[jj, ii] if mask is not None else np.ones(jj.shape, dtype=bool)
    r = risk[jj, ii]
    keep = m & (r > 0)
    x = (ii[keep] + 0.5) / nx * width_km
    y = (jj[keep] + 0.5) / ny * height_km
    return np.column_stack((x, y)), r[keep]
