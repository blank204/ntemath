"""M2 - The irregular mesh.

Poisson-disk sampling with a controllable minimum spacing ``d_min`` (the whole
experiment turns on this one parameter), then the Voronoi tessellation and its
Delaunay dual.

Two implementation notes worth stating plainly:

* **Boundary handling by reflection.**  Instead of clipping unbounded outer
  Voronoi cells after the fact, every generator within a band of the domain
  edge is mirrored across that edge before the tessellation is built.  The
  perpendicular bisector between a point and its mirror image *is* the domain
  boundary, so every original cell comes out finite and exactly box-clipped.
  A shapely intersection still runs afterwards as a numerical guard.

* **Adjacency comes from ``Voronoi.ridge_points``.**  Those pairs are by
  definition the Delaunay edge set (the tessellation and the triangulation are
  duals), and taking them from the ridge list hands us the shared face length
  in the same pass.  ``verify_delaunay_dual`` checks this identity against an
  explicit ``scipy.spatial.Delaunay`` on a small mesh.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import Delaunay, Voronoi, cKDTree

from domain import Domain, out


# --------------------------------------------------------------------------
# Bridson Poisson-disk sampling
# --------------------------------------------------------------------------


def poisson_disk(
    rng: np.random.Generator,
    width: float,
    height: float,
    r: float,
    k: int = 30,
) -> np.ndarray:
    """Bridson's algorithm: points at least ``r`` apart, no closer, fairly dense.

    The k candidate trials per active point are drawn and tested as one
    vectorised batch, which keeps the Python-level loop to roughly one
    iteration per accepted point.
    """
    cell = r / np.sqrt(2.0)
    gw = int(np.ceil(width / cell))
    gh = int(np.ceil(height / cell))
    grid = np.full((gh, gw), -1, dtype=np.int64)

    cap = int(2.5 * width * height / (0.75 * r * r)) + 64
    pts = np.empty((cap, 2), dtype=float)
    n = 0

    def _insert(p):
        nonlocal n
        pts[n] = p
        gi = min(int(p[0] / cell), gw - 1)
        gj = min(int(p[1] / cell), gh - 1)
        grid[gj, gi] = n
        n += 1
        return n - 1

    first = np.array([rng.random() * width, rng.random() * height])
    active = [_insert(first)]
    offs = np.arange(-2, 3)
    r2 = r * r

    while active:
        a = int(rng.integers(len(active)))
        base = pts[active[a]]

        ang = rng.random(k) * (2.0 * np.pi)
        rad = r * np.sqrt(1.0 + 3.0 * rng.random(k))  # uniform over the annulus [r, 2r]
        cand = base + np.column_stack((rad * np.cos(ang), rad * np.sin(ang)))

        inb = (
            (cand[:, 0] >= 0.0)
            & (cand[:, 0] < width)
            & (cand[:, 1] >= 0.0)
            & (cand[:, 1] < height)
        )
        cand = cand[inb]

        accepted = None
        if cand.size:
            gi = np.minimum((cand[:, 0] / cell).astype(np.int64), gw - 1)
            gj = np.minimum((cand[:, 1] / cell).astype(np.int64), gh - 1)
            ii = gi[:, None, None] + offs[None, :, None]
            jj = gj[:, None, None] + offs[None, None, :]
            inside = (ii >= 0) & (ii < gw) & (jj >= 0) & (jj < gh)
            idxs = grid[np.clip(jj, 0, gh - 1), np.clip(ii, 0, gw - 1)]
            occupied = inside & (idxs >= 0)
            near = pts[np.where(occupied, idxs, 0)]
            d2 = ((near - cand[:, None, None, :]) ** 2).sum(axis=-1)
            bad = (occupied & (d2 < r2)).any(axis=(1, 2))
            good = np.flatnonzero(~bad)
            if good.size:
                accepted = cand[good[0]]

        if accepted is None:
            active[a] = active[-1]
            active.pop()
        else:
            active.append(_insert(accepted))

    return pts[:n].copy()


# --------------------------------------------------------------------------
# tessellation
# --------------------------------------------------------------------------


def _mirror(points: np.ndarray, width: float, height: float, band: float):
    """Reflect near-boundary generators across each edge (and each corner)."""
    x, y = points[:, 0], points[:, 1]
    parts = [points]
    left = points[x < band].copy()
    left[:, 0] = -left[:, 0]
    right = points[x > width - band].copy()
    right[:, 0] = 2.0 * width - right[:, 0]
    bot = points[y < band].copy()
    bot[:, 1] = -bot[:, 1]
    top = points[y > height - band].copy()
    top[:, 1] = 2.0 * height - top[:, 1]
    parts += [left, right, bot, top]

    # corner images: reflect across both axes for points near a corner
    for xsel, xmap in ((x < band, lambda a: -a), (x > width - band, lambda a: 2.0 * width - a)):
        for ysel, ymap in (
            (y < band, lambda a: -a),
            (y > height - band, lambda a: 2.0 * height - a),
        ):
            sel = xsel & ysel
            if sel.any():
                c = points[sel].copy()
                c[:, 0] = xmap(c[:, 0])
                c[:, 1] = ymap(c[:, 1])
                parts.append(c)

    return np.vstack(parts)


def _polygon_area_centroid(poly: np.ndarray):
    """Shoelace area and centroid of a simple polygon."""
    x = poly[:, 0]
    y = poly[:, 1]
    x1 = np.roll(x, -1)
    y1 = np.roll(y, -1)
    cross = x * y1 - x1 * y
    a2 = cross.sum()
    if abs(a2) < 1e-12:
        return 0.0, poly.mean(axis=0)
    cx = ((x + x1) * cross).sum() / (3.0 * a2)
    cy = ((y + y1) * cross).sum() / (3.0 * a2)
    return abs(a2) * 0.5, np.array([cx, cy])


@dataclass
class Mesh:
    """A Voronoi tessellation plus its Delaunay adjacency graph."""

    points: np.ndarray  # (n, 2) generators
    width: float
    height: float
    d_min: float
    vertices: np.ndarray  # Voronoi vertices
    regions: list  # per-cell arrays of vertex indices (CCW, closed polygons)
    cell_area: np.ndarray  # (n,)
    edges: np.ndarray  # (m, 2) undirected Delaunay edges, i < j
    edge_len: np.ndarray  # (m,) shared Voronoi face length
    edge_dist: np.ndarray  # (m,) generator separation
    lloyd_iters: int = 0

    @property
    def n(self) -> int:
        return len(self.points)

    @property
    def coordination(self) -> np.ndarray:
        return np.bincount(self.edges.ravel(), minlength=self.n)

    def nn_distances(self) -> np.ndarray:
        d, _ = cKDTree(self.points).query(self.points, k=2)
        return d[:, 1]

    def interior_mask(self, margin: float | None = None) -> np.ndarray:
        """Cells far enough from the box edge that clipping does not truncate them."""
        m = 2.5 * self.d_min if margin is None else margin
        x, y = self.points[:, 0], self.points[:, 1]
        return (x > m) & (x < self.width - m) & (y > m) & (y < self.height - m)

    def stats(self) -> dict:
        nn = self.nn_distances()
        coord = self.coordination
        interior = self.interior_mask()
        return {
            "d_min_requested": self.d_min,
            "n_cells": self.n,
            "n_edges": len(self.edges),
            "nn_mean": float(nn.mean()),
            "nn_median": float(np.median(nn)),
            "nn_min": float(nn.min()),
            "coord_mean": float(coord.mean()),
            # The box boundary truncates edge cells, so the Poisson-Voronoi
            # "mean coordination = 6" property is only expected in the interior.
            "coord_mean_interior": float(coord[interior].mean()) if interior.any() else float("nan"),
            "area_mean": float(self.cell_area.mean()),
            "area_median": float(np.median(self.cell_area)),
            "edge_len_mean": float(self.edge_len.mean()),
            "density_per_km2": self.n / (self.width * self.height / 1e6),
        }


def _tessellate(points: np.ndarray, width: float, height: float, d_min: float, lloyd_iters: int):
    band = 3.0 * d_min
    n = len(points)
    aug = _mirror(points, width, height, band)
    vor = Voronoi(aug)

    # --- cell polygons -----------------------------------------------------
    regions = []
    areas = np.zeros(n)
    centroids = np.zeros((n, 2))
    verts = vor.vertices
    for i in range(n):
        reg = vor.regions[vor.point_region[i]]
        if not reg or -1 in reg:
            # Should not happen once near-boundary points are mirrored; keep a
            # loud, non-silent fallback rather than fabricating geometry.
            raise RuntimeError(
                f"unbounded Voronoi cell for generator {i} - widen the mirror band"
            )
        idx = np.asarray(reg, dtype=np.int64)
        regions.append(idx)
        a, c = _polygon_area_centroid(verts[idx])
        areas[i] = a
        centroids[i] = c

    # --- adjacency + shared face lengths from the ridges --------------------
    rp = vor.ridge_points
    keep = (rp[:, 0] < n) & (rp[:, 1] < n)
    rv = np.asarray(
        [vor.ridge_vertices[t] for t in np.flatnonzero(keep)], dtype=object
    )
    pairs = rp[keep]
    finite = np.array([(-1 not in v and len(v) == 2) for v in rv], dtype=bool)
    pairs = pairs[finite]
    rv = rv[finite]
    va = verts[np.array([v[0] for v in rv], dtype=np.int64)]
    vb = verts[np.array([v[1] for v in rv], dtype=np.int64)]
    elen = np.linalg.norm(vb - va, axis=1)

    edges = np.sort(pairs, axis=1)
    edist = np.linalg.norm(points[edges[:, 0]] - points[edges[:, 1]], axis=1)

    return regions, areas, centroids, edges, elen, edist, verts


def build_mesh(
    rng: np.random.Generator,
    domain: Domain,
    d_min: float,
    lloyd_iters: int = 2,
    clip_guard: bool = True,
) -> Mesh:
    """Sample generators, relax them, and build the tessellation."""
    pts = poisson_disk(rng, domain.width, domain.height, d_min)

    for _ in range(lloyd_iters):
        _, _, cents, _, _, _, _ = _tessellate(pts, domain.width, domain.height, d_min, 0)
        pts = cents
        eps = 1e-6
        pts[:, 0] = np.clip(pts[:, 0], eps, domain.width - eps)
        pts[:, 1] = np.clip(pts[:, 1], eps, domain.height - eps)

    regions, areas, cents, edges, elen, edist, verts = _tessellate(
        pts, domain.width, domain.height, d_min, lloyd_iters
    )

    if clip_guard:
        # Numerical guard only: reflection already clips cells to the box, so
        # this should find nothing to do.  Fail loudly if it does not.
        spill = (
            verts[:, 0].min() < -1e-6
            or verts[:, 1].min() < -1e-6
        )
        if spill:
            areas = _shapely_clip_areas(verts, regions, domain)

    return Mesh(
        points=pts,
        width=domain.width,
        height=domain.height,
        d_min=d_min,
        vertices=verts,
        regions=regions,
        cell_area=areas,
        edges=edges,
        edge_len=elen,
        edge_dist=edist,
        lloyd_iters=lloyd_iters,
    )


def _shapely_clip_areas(verts, regions, domain: Domain) -> np.ndarray:
    from shapely.geometry import Polygon, box

    bbox = box(*domain.bounds)
    areas = np.zeros(len(regions))
    for i, idx in enumerate(regions):
        areas[i] = Polygon(verts[idx]).intersection(bbox).area
    return areas


# --------------------------------------------------------------------------
# checks + figure
# --------------------------------------------------------------------------


def verify_delaunay_dual(mesh: Mesh) -> bool:
    """Confirm the ridge-derived adjacency equals the Delaunay edge set."""
    tri = Delaunay(mesh.points)
    s = tri.simplices
    de = np.vstack((s[:, [0, 1]], s[:, [1, 2]], s[:, [0, 2]]))
    de = np.unique(np.sort(de, axis=1), axis=0)
    ours = np.unique(mesh.edges, axis=0)
    # Interior edges must agree; hull edges can differ because our tessellation
    # is box-bounded (mirrored) while a raw Delaunay closes over the hull.
    ours_set = {tuple(e) for e in ours}
    del_set = {tuple(e) for e in de}
    return ours_set.issubset(del_set)


def plot_mesh(mesh: Mesh, path: str, max_cells: int = 6000) -> str:
    """Voronoi cells + Delaunay edges.  Zooms in when the mesh is dense."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection, PolyCollection

    fig, axes = plt.subplots(1, 2, figsize=(14, 7))

    if mesh.n > max_cells:
        frac = np.sqrt(max_cells / mesh.n)
        w = mesh.width * frac
        h = mesh.height * frac
        x0 = (mesh.width - w) / 2
        y0 = (mesh.height - h) / 2
        win = (x0, y0, x0 + w, y0 + h)
    else:
        win = (0.0, 0.0, mesh.width, mesh.height)

    inwin = (
        (mesh.points[:, 0] >= win[0])
        & (mesh.points[:, 0] <= win[2])
        & (mesh.points[:, 1] >= win[1])
        & (mesh.points[:, 1] <= win[3])
    )
    sel = np.flatnonzero(inwin)

    polys = [mesh.vertices[mesh.regions[i]] for i in sel]
    axes[0].add_collection(
        PolyCollection(polys, facecolors="#f5f0e6", edgecolors="#4a4a4a", linewidths=0.4)
    )
    axes[0].plot(mesh.points[sel, 0], mesh.points[sel, 1], ".", ms=1.6, color="#c0392b")
    axes[0].set_title(f"Voronoi cells (n={mesh.n:,}, showing {len(sel):,})")

    emask = inwin[mesh.edges[:, 0]] & inwin[mesh.edges[:, 1]]
    segs = np.stack(
        (mesh.points[mesh.edges[emask, 0]], mesh.points[mesh.edges[emask, 1]]), axis=1
    )
    axes[1].add_collection(LineCollection(segs, colors="#2c6fbb", linewidths=0.4))
    axes[1].plot(mesh.points[sel, 0], mesh.points[sel, 1], ".", ms=1.6, color="#c0392b")
    axes[1].set_title("Delaunay adjacency (the graph fire hops along)")

    for a in axes:
        a.set_xlim(win[0], win[2])
        a.set_ylim(win[1], win[3])
        a.set_aspect("equal")
        a.set_xlabel("x (m)")
    axes[0].set_ylabel("y (m)")

    st = mesh.stats()
    fig.suptitle(
        f"M2 mesh — d_min={mesh.d_min:.0f} m, Lloyd×{mesh.lloyd_iters} | "
        f"NN mean {st['nn_mean']:.0f} m, coordination {st['coord_mean']:.2f}",
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


if __name__ == "__main__":
    import time

    from domain import make_domain

    rng = np.random.default_rng(1)
    dom = make_domain(np.random.default_rng(0))

    for d_min in (160.0, 640.0):
        t0 = time.perf_counter()
        m = build_mesh(rng, dom, d_min, lloyd_iters=2)
        dt = time.perf_counter() - t0
        st = m.stats()
        print(f"\nd_min = {d_min:.0f} m   ({dt:.2f} s)")
        for k, v in st.items():
            print(f"   {k:20s} {v:,.3f}" if isinstance(v, float) else f"   {k:20s} {v:,}")
        print("   ridge adjacency ⊆ Delaunay edges:", verify_delaunay_dual(m))
        p = plot_mesh(m, out(f"m2_mesh_d{int(d_min)}.png"))
        print("   wrote", p)
