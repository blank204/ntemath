"""M3 - Cell and edge attributes.

Samples the M1 rasters at each Voronoi generator and precomputes, for every
Delaunay edge, the geometric quantities the fire rule needs.  Edges are stored
*directed* (each undirected Delaunay edge appears twice, i->j and j->i) because
slope and wind alignment are not symmetric.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from domain import FUEL_PROPS, UNBURNABLE_FUELS, Domain, out
from mesh import Mesh

# cell states
UNBURNABLE = 0
UNBURNT = 1
BURNING = 2
BURNT = 3

STATE_NAMES = {UNBURNABLE: "unburnable", UNBURNT: "unburnt", BURNING: "burning", BURNT: "burnt"}
STATE_COLORS = {
    UNBURNABLE: "#7a7a7a",
    UNBURNT: "#9ec27a",
    BURNING: "#e8542a",
    BURNT: "#2b2b2b",
}


def reference_spacing(mesh: Mesh) -> float:
    """The mesh's characteristic generator spacing: median Delaunay edge length.

    Used as ``d_ref`` in the ``g_geom`` term and in the burn-duration scaling.
    Defined on Delaunay edge lengths (not nearest-neighbour distances) so that
    ``g_geom`` averages to 1 on the mesh it was measured from.
    """
    return float(np.median(mesh.edge_dist))


@dataclass
class Attributes:
    """Per-cell and per-directed-edge attributes for one mesh."""

    # --- per cell ---
    fuel: np.ndarray  # (n,) fuel class code
    k_veg: np.ndarray  # (n,)
    k_den: np.ndarray  # (n,)
    tau: np.ndarray  # (n,) burn duration in *steps*
    elev: np.ndarray  # (n,) metres
    state0: np.ndarray  # (n,) initial state
    spacing: np.ndarray  # (n,) mean distance to Delaunay neighbours

    # --- per directed edge ---
    src: np.ndarray  # (2m,) source cell
    dst: np.ndarray  # (2m,) target cell
    e_dist: np.ndarray  # (2m,) generator separation
    e_bear: np.ndarray  # (2m, 2) unit vector src -> dst
    e_slope: np.ndarray  # (2m,) radians, uphill positive
    e_share: np.ndarray  # (2m,) shared Voronoi face length

    mean_edge_len: float
    dt_s: float

    @property
    def n(self) -> int:
        return len(self.fuel)


def build_attributes(mesh: Mesh, domain: Domain, dt_s: float = 60.0, d_ref: float | None = None) -> Attributes:
    """Sample the landscape onto ``mesh`` and precompute edge geometry.

    ``d_ref`` is the reference generator spacing used to scale burn duration
    with cell size; it defaults to this mesh's own median nearest-neighbour
    distance (correct for a standalone run, but the sweep passes the *fixed*
    reference-mesh value so that residence time means the same real duration at
    every resolution).
    """
    pts = mesh.points
    fuel = domain.sample_fuel(pts[:, 0], pts[:, 1]).astype(int)
    elev = domain.sample_elev(pts[:, 0], pts[:, 1]).astype(float)

    n = mesh.n
    k_veg = np.array([FUEL_PROPS[int(f)]["k_veg"] for f in fuel])
    k_den = np.array([FUEL_PROPS[int(f)]["k_den"] for f in fuel])
    tau_min = np.array([FUEL_PROPS[int(f)]["tau_min"] for f in fuel])

    # mean distance from each cell to its Delaunay neighbours
    i, j = mesh.edges[:, 0], mesh.edges[:, 1]
    dsum = np.zeros(n)
    dcnt = np.zeros(n)
    np.add.at(dsum, i, mesh.edge_dist)
    np.add.at(dsum, j, mesh.edge_dist)
    np.add.at(dcnt, i, 1.0)
    np.add.at(dcnt, j, 1.0)
    spacing = np.where(dcnt > 0, dsum / np.maximum(dcnt, 1), np.median(mesh.edge_dist))

    if d_ref is None:
        d_ref = reference_spacing(mesh)

    # residence time scales with cell size, then converts to whole steps
    tau_steps = np.ceil(tau_min * 60.0 / dt_s * (spacing / d_ref)).astype(int)
    tau_steps = np.maximum(tau_steps, 1)
    tau_steps[np.isin(fuel, UNBURNABLE_FUELS)] = 0

    state0 = np.where(np.isin(fuel, UNBURNABLE_FUELS), UNBURNABLE, UNBURNT).astype(np.int8)

    # --- directed edges ---------------------------------------------------
    src = np.concatenate((i, j))
    dst = np.concatenate((j, i))
    e_dist = np.concatenate((mesh.edge_dist, mesh.edge_dist))
    e_share = np.concatenate((mesh.edge_len, mesh.edge_len))

    delta = pts[dst] - pts[src]
    e_bear = delta / np.maximum(np.linalg.norm(delta, axis=1, keepdims=True), 1e-12)
    e_slope = np.arctan2(elev[dst] - elev[src], np.maximum(e_dist, 1e-12))

    return Attributes(
        fuel=fuel,
        k_veg=k_veg,
        k_den=k_den,
        tau=tau_steps,
        elev=elev,
        state0=state0,
        spacing=spacing,
        src=src,
        dst=dst,
        e_dist=e_dist,
        e_bear=e_bear,
        e_slope=e_slope,
        e_share=e_share,
        mean_edge_len=float(mesh.edge_len.mean()),
        dt_s=dt_s,
    )


# --------------------------------------------------------------------------
# figure
# --------------------------------------------------------------------------


def plot_attributes(mesh: Mesh, attrs: Attributes, path: str) -> str:
    """Histograms of cell area, coordination number, slope and shared-face length."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    coord = mesh.coordination[mesh.interior_mask()]
    area = mesh.cell_area / 1e4  # hectares

    fig, axes = plt.subplots(1, 4, figsize=(19, 4.4))

    axes[0].hist(area, bins=60, color="#4a7ba7", edgecolor="none")
    axes[0].axvline(area.mean(), color="#c0392b", lw=1.5, label=f"mean {area.mean():.2f} ha")
    axes[0].set_xlabel("cell area (ha)")
    axes[0].set_title("Cell areas")
    axes[0].legend(fontsize=8)

    bins = np.arange(coord.min() - 0.5, coord.max() + 1.5)
    axes[1].hist(coord, bins=bins, color="#4a7ba7", edgecolor="white")
    axes[1].axvline(coord.mean(), color="#c0392b", lw=1.5, label=f"mean {coord.mean():.3f}")
    axes[1].set_xlabel("coordination number (interior cells)")
    axes[1].set_title("Delaunay coordination")
    axes[1].legend(fontsize=8)

    axes[2].hist(np.rad2deg(attrs.e_slope), bins=60, color="#4a7ba7", edgecolor="none")
    axes[2].set_xlabel("edge slope (deg, uphill +)")
    axes[2].set_title("Slope between adjacent cells")

    axes[3].hist(attrs.e_share, bins=60, color="#4a7ba7", edgecolor="none")
    axes[3].axvline(
        attrs.mean_edge_len, color="#c0392b", lw=1.5, label=f"mean {attrs.mean_edge_len:.0f} m"
    )
    axes[3].set_xlabel("shared Voronoi face length (m)")
    axes[3].set_title("Contact length")
    axes[3].legend(fontsize=8)

    for a in axes:
        a.set_ylabel("count")

    fig.suptitle(
        f"M3 attributes — d_min={mesh.d_min:.0f} m, n={mesh.n:,} cells, "
        f"{len(attrs.src):,} directed edges",
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


if __name__ == "__main__":
    from domain import FUEL_NAMES, make_domain
    from mesh import build_mesh

    dom = make_domain(np.random.default_rng(0))
    mesh = build_mesh(np.random.default_rng(1), dom, 160.0, lloyd_iters=2)
    attrs = build_attributes(mesh, dom)

    print(f"cells {attrs.n:,}   directed edges {len(attrs.src):,}")
    for c in sorted(FUEL_NAMES):
        m = attrs.fuel == c
        if m.any():
            print(
                f"   {FUEL_NAMES[c]:10s} {m.sum():6,} cells  "
                f"tau {attrs.tau[m].min()}..{attrs.tau[m].max()} steps"
            )
    print(f"elevation on cells: {attrs.elev.min():.1f} .. {attrs.elev.max():.1f} m")
    print(f"mean shared face  : {attrs.mean_edge_len:.1f} m")
    print(f"interior coordination mean: {mesh.coordination[mesh.interior_mask()].mean():.4f}")
    print("wrote", plot_attributes(mesh, attrs, out("m3_attributes.png")))
