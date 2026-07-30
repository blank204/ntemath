"""M4/M5 - The transition rule and one full simulation run.

Per-step probability that a BURNING cell i ignites an UNBURNT Delaunay
neighbour j (generalised Alexandridis et al. 2008, extended to irregular
cells):

    p_ij = p0 · k_veg(j) · k_den(j) · p_wind(i→j) · p_slope(i→j) · g_geom(i,j)

Every factor is static for a given mesh + wind + landscape, so the whole
directed-edge probability vector is computed once and the timestep loop is a
handful of vectorised array operations over it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree

from attributes import BURNING, BURNT, UNBURNABLE, UNBURNT, Attributes
from domain import Domain, Wind, out
from mesh import Mesh

# --------------------------------------------------------------------------
# All calibration constants live here so they are easy to log and tune.
# --------------------------------------------------------------------------

PARAMS = {
    # Base per-step spread probability.  The spec's starting value was 0.58;
    # calibrate.py shows that saturates the box (>70% of the domain burnt) which
    # would score every resolution at IoU ~ 1 and measure nothing.  0.35 keeps
    # the fire clear of both saturation and the percolation threshold, and is
    # where g_geom invariance holds best across d_min.  See calibrate.py.
    "p0": 0.35,
    "c1": 0.045,  # wind speed gain
    "c2": 0.131,  # wind direction sharpness
    "a_slope": 0.078,  # slope sensitivity (per radian)
    "dt_s": 60.0,  # seconds per timestep
    "t_end_min": None,  # stop after this many simulated minutes (None = burn out)
    "max_steps": 6000,
}


def static_terms(attrs: Attributes, d_ref: float, params: dict | None = None):
    """The factors of ``p_ij`` that do not depend on wind.

    Split out so a time-varying wind only pays for the term that actually
    changes.  Returns ``(pre, p_slope, g_geom)`` where ``pre`` folds together
    ``p0 · k_veg · k_den`` **in that order** -- float multiplication is not
    associative, and preserving the original grouping is what lets a constant
    :class:`~weather.WindSeries` reproduce a constant :class:`Wind` bit for bit.
    """
    P = dict(PARAMS if params is None else params)

    pre = P["p0"] * attrs.k_veg[attrs.dst] * attrs.k_den[attrs.dst]
    p_slope = np.exp(P["a_slope"] * attrs.e_slope)
    g_geom = (d_ref / np.maximum(attrs.e_dist, 1e-9)) * (
        attrs.e_share / max(attrs.mean_edge_len, 1e-9)
    )
    return pre, p_slope, g_geom


def wind_factor(attrs: Attributes, wind: Wind, params: dict | None = None) -> np.ndarray:
    """The wind term alone -- the only factor a changing wind touches."""
    P = dict(PARAMS if params is None else params)
    V = float(wind.speed_ms)
    cos_phi = attrs.e_bear @ wind.vector
    return np.exp(P["c1"] * V) * np.exp(P["c2"] * V * (cos_phi - 1.0))


def combine_terms(pre, p_wind, p_slope, g_geom) -> np.ndarray:
    """Assemble and clamp, in the original left-to-right grouping."""
    return np.clip(((pre * p_wind) * p_slope) * g_geom, 0.0, 1.0)


def edge_probabilities(
    attrs: Attributes,
    wind: Wind,
    d_ref: float,
    params: dict | None = None,
    return_terms: bool = False,
):
    """Per-directed-edge ignition probability, clamped to [0, 1]."""
    pre, p_slope, g_geom = static_terms(attrs, d_ref, params)
    p_wind = wind_factor(attrs, wind, params)
    p = combine_terms(pre, p_wind, p_slope, g_geom)

    if return_terms:
        return p, {"p_wind": p_wind, "p_slope": p_slope, "g_geom": g_geom}
    return p


@dataclass
class FireResult:
    """Outcome of one simulation run."""

    state: np.ndarray  # (n,) final state
    arrival_step: np.ndarray  # (n,) step of ignition, -1 if never burnt
    burned_per_step: np.ndarray  # (steps+1,) cumulative burnt-or-burning count
    area_per_step: np.ndarray  # (steps+1,) cumulative burnt area, m^2
    steps: int
    dt_s: float
    seed_cell: int
    hit_cap: bool = False
    meta: dict = field(default_factory=dict)

    @property
    def burnt_mask(self) -> np.ndarray:
        return (self.state == BURNT) | (self.state == BURNING)

    @property
    def arrival_min(self) -> np.ndarray:
        """Arrival time in minutes; NaN where the cell never burnt."""
        t = self.arrival_step.astype(float) * self.dt_s / 60.0
        t[self.arrival_step < 0] = np.nan
        return t

    @property
    def duration_min(self) -> float:
        return self.steps * self.dt_s / 60.0


def pick_seed_cell(mesh: Mesh, attrs: Attributes, xy) -> int:
    """Nearest *burnable* generator to a world coordinate."""
    burnable = np.flatnonzero(attrs.state0 == UNBURNT)
    if burnable.size == 0:
        raise RuntimeError("no burnable cells in the mesh")
    tree = cKDTree(mesh.points[burnable])
    _, k = tree.query(np.asarray(xy, dtype=float))
    return int(burnable[k])


def simulate(
    mesh: Mesh,
    attrs: Attributes,
    wind,
    rng: np.random.Generator,
    d_ref: float,
    seed_xy=None,
    seed_cell: int | None = None,
    params: dict | None = None,
    p_edge: np.ndarray | None = None,
) -> FireResult:
    """Run the CA to extinction (or the step cap).

    Update is synchronous: all ignitions are drawn from the state at the start
    of the step and applied together, so there is no within-step chaining and
    no scan-order bias.

    ``wind`` is either a constant :class:`~domain.Wind` or a
    :class:`~weather.WindSeries`.  Given a series, the edge probabilities are
    rebuilt whenever the run crosses into a new hour -- only the wind factor is
    recomputed, and the draw sequence is untouched, so a seeded run stays
    reproducible and a series of constant wind gives exactly the constant-wind
    answer.
    """
    P = dict(PARAMS if params is None else params)

    # Duck-typed rather than imported, so fire.py keeps no dependency on the
    # networked weather module.
    series = wind if hasattr(wind, "at") else None
    if series is not None and p_edge is not None:
        raise ValueError(
            "pass either a WindSeries or a precomputed p_edge, not both -- a "
            "fixed p_edge cannot express a wind that changes"
        )

    pre = p_slope = g_geom = None
    cur_hour = -1
    wind_log: list = []

    if series is None:
        if p_edge is None:
            p_edge = edge_probabilities(attrs, wind, d_ref, P)
    else:
        pre, p_slope, g_geom = static_terms(attrs, d_ref, P)

    n = attrs.n
    state = attrs.state0.copy()
    timer = np.zeros(n, dtype=np.int32)
    arrival = np.full(n, -1, dtype=np.int32)

    if seed_cell is None:
        if seed_xy is None:
            seed_xy = (mesh.width / 2.0, mesh.height / 2.0)
        seed_cell = pick_seed_cell(mesh, attrs, seed_xy)

    state[seed_cell] = BURNING
    arrival[seed_cell] = 0

    src, dst = attrs.src, attrs.dst
    area = mesh.cell_area
    burned_hist = [1]
    area_hist = [float(area[seed_cell])]

    step = 0
    hit_cap = False
    step_limit = int(P["max_steps"])
    if P.get("t_end_min") is not None:
        step_limit = min(step_limit, int(round(P["t_end_min"] * 60.0 / P["dt_s"])))

    while True:
        burning = state == BURNING
        if not burning.any():
            break
        if step >= step_limit:
            hit_cap = step >= int(P["max_steps"])
            break

        # 0. advance the wind if the run has crossed into a new hour
        if series is not None:
            minutes = step * P["dt_s"] / 60.0
            h = series.index_at(minutes)
            if h != cur_hour:
                cur_hour = h
                w_now = series.at(minutes)
                p_edge = combine_terms(
                    pre, wind_factor(attrs, w_now, P), p_slope, g_geom
                )
                wind_log.append(
                    (float(minutes), series.time_at(minutes),
                     float(w_now.speed_ms), float(w_now.dir_deg))
                )

        # 1. draw ignitions from the current state only
        active = burning[src] & (state[dst] == UNBURNT)
        idx = np.flatnonzero(active)
        newly = np.empty(0, dtype=np.int64)
        if idx.size:
            hit = idx[rng.random(idx.size) < p_edge[idx]]
            if hit.size:
                newly = np.unique(dst[hit])

        # 2. age the cells that were burning at the start of the step
        timer[burning] += 1
        done = burning & (timer >= attrs.tau)
        state[done] = BURNT

        # 3. apply all ignitions together
        step += 1
        if newly.size:
            state[newly] = BURNING
            timer[newly] = 0
            arrival[newly] = step

        ever = arrival >= 0
        burned_hist.append(int(ever.sum()))
        area_hist.append(float(area[ever].sum()))

    # Downstream plots want one representative vector. For a series that is
    # the speed-weighted mean over the hours the run actually reached, not the
    # whole fetched window -- reporting wind the fire never saw would repeat
    # the averaging mistake this path exists to avoid.
    if series is None:
        meta = {"d_ref": d_ref, "wind_speed": wind.speed_ms, "wind_dir": wind.dir_deg}
    else:
        mw = series.mean_wind(step * P["dt_s"] / 60.0)
        meta = {
            "d_ref": d_ref,
            "wind_speed": mw.speed_ms,
            "wind_dir": mw.dir_deg,
            "wind_series": True,
            "wind_source": series.source,
            "wind_hours": len(wind_log),
            "wind_log": wind_log,
            "wind_summary": series.summary(step * P["dt_s"] / 60.0),
        }

    return FireResult(
        state=state,
        arrival_step=arrival,
        burned_per_step=np.asarray(burned_hist),
        area_per_step=np.asarray(area_hist),
        steps=step,
        dt_s=P["dt_s"],
        seed_cell=int(seed_cell),
        hit_cap=hit_cap,
        meta=meta,
    )


# --------------------------------------------------------------------------
# figures
# --------------------------------------------------------------------------


def _cell_polys(mesh: Mesh, sel=None):
    idx = range(mesh.n) if sel is None else sel
    return [mesh.vertices[mesh.regions[i]] for i in idx]


def plot_burn_scar(mesh: Mesh, attrs: Attributes, res: FireResult, path: str, title: str = "") -> str:
    """Final burn scar: cells coloured by state, with the wind vector drawn."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    from matplotlib.lines import Line2D
    from matplotlib.patches import FancyArrow

    from attributes import STATE_COLORS, STATE_NAMES

    fig, (ax, ax2) = plt.subplots(
        1, 2, figsize=(15, 7), gridspec_kw={"width_ratios": [1.35, 1]}
    )

    colors = np.array([STATE_COLORS[s] for s in (UNBURNABLE, UNBURNT, BURNING, BURNT)])
    face = colors[np.clip(res.state, 0, 3)]
    ax.add_collection(
        PolyCollection(_cell_polys(mesh), facecolors=face, edgecolors="none")
    )
    ax.plot(
        mesh.points[res.seed_cell, 0],
        mesh.points[res.seed_cell, 1],
        "*",
        ms=16,
        mfc="#ffd400",
        mec="k",
        mew=0.8,
        label="ignition",
    )

    w = res.meta["wind_speed"]
    if w > 0:
        wv = Wind(w, res.meta["wind_dir"]).vector
        L = 0.18 * mesh.width
        ax.add_patch(
            FancyArrow(
                0.06 * mesh.width,
                0.94 * mesh.height - wv[1] * L,
                wv[0] * L,
                wv[1] * L,
                width=L * 0.03,
                head_width=L * 0.14,
                head_length=L * 0.18,
                color="#1b4fa0",
                length_includes_head=True,
                zorder=5,
            )
        )
        ax.text(
            0.06 * mesh.width,
            0.965 * mesh.height,
            f"wind {w:.0f} m/s",
            color="#1b4fa0",
            fontsize=9,
        )

    ax.set_xlim(0, mesh.width)
    ax.set_ylim(0, mesh.height)
    ax.set_aspect("equal")
    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    handles = [
        Line2D([], [], marker="s", ls="", mfc=STATE_COLORS[s], mec="none", ms=10, label=STATE_NAMES[s])
        for s in (UNBURNABLE, UNBURNT, BURNING, BURNT)
    ]
    ax.legend(handles=handles, loc="lower right", fontsize=8, framealpha=0.9)
    ax.set_title("Final burn scar")

    t = np.arange(len(res.area_per_step)) * res.dt_s / 60.0
    ax2.plot(t / 60.0, res.area_per_step / 1e6, lw=2, color="#c0392b")
    ax2.set_xlabel("time (hours)")
    ax2.set_ylabel("cumulative burnt area (km²)")
    ax2.set_title("Growth curve")
    ax2.grid(alpha=0.3)

    burnt_area = res.area_per_step[-1] / 1e6
    total = mesh.cell_area.sum() / 1e6
    fig.suptitle(
        title
        or (
            f"d_min={mesh.d_min:.0f} m | {res.steps} steps "
            f"({res.duration_min/60:.1f} h) | burnt {burnt_area:.1f} / {total:.0f} km² "
            f"({100*burnt_area/total:.0f}%)"
        ),
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


def plot_front_series(mesh: Mesh, res: FireResult, path: str, n_panels: int = 6) -> str:
    """Small multiples of the advancing front."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection

    reached = res.arrival_step[res.arrival_step >= 0]
    tmax = int(reached.max()) if reached.size else 1
    cuts = np.linspace(tmax / n_panels, tmax, n_panels).astype(int)

    polys = _cell_polys(mesh)
    fig, axes = plt.subplots(1, n_panels, figsize=(3.0 * n_panels, 3.4))
    for ax, c in zip(axes, cuts):
        burnt = (res.arrival_step >= 0) & (res.arrival_step <= c)
        front = burnt & (res.arrival_step > c - max(1, tmax // 20))
        face = np.full(mesh.n, "#e8e4d9", dtype=object)
        face[res.state == UNBURNABLE] = "#9a9a9a"
        face[burnt] = "#3a3a3a"
        face[front] = "#e8542a"
        ax.add_collection(PolyCollection(polys, facecolors=list(face), edgecolors="none"))
        ax.set_xlim(0, mesh.width)
        ax.set_ylim(0, mesh.height)
        ax.set_aspect("equal")
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_title(f"t = {c * res.dt_s / 3600:.1f} h", fontsize=10)

    fig.suptitle("M5 front propagation", fontsize=13)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


if __name__ == "__main__":
    from attributes import build_attributes, reference_spacing
    from domain import make_domain
    from mesh import build_mesh

    dom = make_domain(np.random.default_rng(0), wind=Wind(8.0, 90.0))
    mesh = build_mesh(np.random.default_rng(1), dom, 160.0, lloyd_iters=2)
    d_ref = reference_spacing(mesh)
    attrs = build_attributes(mesh, dom, dt_s=PARAMS["dt_s"], d_ref=d_ref)

    p, terms = edge_probabilities(attrs, dom.wind, d_ref, return_terms=True)
    print(f"d_ref = {d_ref:.1f} m")
    print(f"g_geom  mean {terms['g_geom'].mean():.3f}  median {np.median(terms['g_geom']):.3f}")
    print(f"p_wind  min {terms['p_wind'].min():.3f}  max {terms['p_wind'].max():.3f}")
    print(f"p_ij    mean {p.mean():.4f}  max {p.max():.4f}  frac clamped {np.mean(p >= 1.0):.4f}")

    res = simulate(mesh, attrs, dom.wind, np.random.default_rng(2), d_ref, p_edge=p)
    print(
        f"steps {res.steps} ({res.duration_min/60:.1f} h)  "
        f"burnt {res.burnt_mask.sum():,}/{mesh.n:,} cells  "
        f"{res.area_per_step[-1]/1e6:.1f} km²  hit_cap={res.hit_cap}"
    )
    print("wrote", plot_burn_scar(mesh, attrs, res, out("m5_burn_scar.png")))
    print("wrote", plot_front_series(mesh, res, out("m5_front_series.png")))
