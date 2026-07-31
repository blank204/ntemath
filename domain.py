"""M1 - The landscape.

Builds a heterogeneous synthetic domain over a rectangle (metres):

  * elevation  -- fractal value noise, ~300 m amplitude
  * fuel       -- categorical patches (water / rock / grass / shrub / timber)
  * wind       -- one global vector

Everything is stored as a fine background raster that later milestones sample
at Voronoi generator points.  All randomness goes through an explicit
``np.random.default_rng`` instance -- there are no bare ``np.random`` calls.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np

# All artifacts live beside this package, never relative to the caller's cwd.
PKG_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(PKG_DIR, "outputs")


def out(name: str) -> str:
    """Absolute path to an artifact in ``outputs/``."""
    os.makedirs(OUT_DIR, exist_ok=True)
    return os.path.join(OUT_DIR, name)

# --------------------------------------------------------------------------
# fuel classes
# --------------------------------------------------------------------------

WATER = 0
ROCK = 1
GRASS = 2
SHRUB = 3
TIMBER = 4

FUEL_NAMES = {
    WATER: "water",
    ROCK: "rock/road",
    GRASS: "grass",
    SHRUB: "shrub",
    TIMBER: "timber",
}

UNBURNABLE_FUELS = (WATER, ROCK)

# k_veg    : how readily the vegetation type takes fire (grass easiest)
# k_den    : fuel density multiplier, in [0.7, 1.3]
# tau_min  : residence time -- how long a *reference-sized* cell of this fuel
#            stays BURNING, in minutes of real time.  attributes.py converts it
#            to a step count using dt and the cell's own size; a physically
#            larger cell burns for proportionally longer.  Holding tau fixed in
#            *steps* instead would make coarse meshes burn out before they could
#            ignite anything, which would dominate the resolution study.
FUEL_PROPS = {
    WATER: {"k_veg": 0.0, "k_den": 0.0, "tau_min": 0.0},
    ROCK: {"k_veg": 0.0, "k_den": 0.0, "tau_min": 0.0},
    GRASS: {"k_veg": 1.00, "k_den": 0.80, "tau_min": 5.0},
    SHRUB: {"k_veg": 0.80, "k_den": 1.00, "tau_min": 15.0},
    TIMBER: {"k_veg": 0.55, "k_den": 1.20, "tau_min": 40.0},
}

FUEL_COLORS = {
    WATER: "#3b6ea5",
    ROCK: "#8a8a8a",
    GRASS: "#c8d96f",
    SHRUB: "#7fa650",
    TIMBER: "#1f5c2e",
}


# --------------------------------------------------------------------------
# noise
# --------------------------------------------------------------------------


def _lattice_noise(rng: np.random.Generator, shape, res_y: int, res_x: int) -> np.ndarray:
    """Smoothstep-interpolated value noise from a coarse random lattice."""
    lat = rng.random((res_y + 1, res_x + 1))

    ys = np.linspace(0.0, res_y, shape[0], endpoint=False)
    xs = np.linspace(0.0, res_x, shape[1], endpoint=False)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    ty = ys - y0
    tx = xs - x0
    sy = (ty * ty * (3.0 - 2.0 * ty))[:, None]
    sx = (tx * tx * (3.0 - 2.0 * tx))[None, :]

    v00 = lat[np.ix_(y0, x0)]
    v01 = lat[np.ix_(y0, x0 + 1)]
    v10 = lat[np.ix_(y0 + 1, x0)]
    v11 = lat[np.ix_(y0 + 1, x0 + 1)]

    top = v00 + (v01 - v00) * sx
    bot = v10 + (v11 - v10) * sx
    return top + (bot - top) * sy


def fractal_noise(
    rng: np.random.Generator,
    shape,
    base_res: int = 4,
    octaves: int = 5,
    persistence: float = 0.5,
) -> np.ndarray:
    """Summed octaves of value noise, normalised to [0, 1]."""
    ny, nx = shape
    aspect = nx / ny
    out = np.zeros(shape, dtype=float)
    amp = 1.0
    total = 0.0
    for o in range(octaves):
        res_y = base_res * (2**o)
        res_x = max(1, int(round(res_y * aspect)))
        out += amp * _lattice_noise(rng, shape, res_y, res_x)
        total += amp
        amp *= persistence
    out /= total
    out -= out.min()
    peak = out.max()
    return out / peak if peak > 0 else out


# --------------------------------------------------------------------------
# wind
# --------------------------------------------------------------------------


@dataclass
class Wind:
    """A single global wind vector.

    ``dir_deg`` is the compass bearing the wind blows *toward*
    (0 = toward north / +y, 90 = toward east / +x).  Meteorological
    observations report the direction wind comes *from*; use
    :meth:`from_meteorological` for those.
    """

    speed_ms: float = 0.0
    dir_deg: float = 90.0

    @classmethod
    def from_meteorological(cls, speed_ms: float, from_deg: float) -> "Wind":
        return cls(speed_ms=speed_ms, dir_deg=(from_deg + 180.0) % 360.0)

    @property
    def vector(self) -> np.ndarray:
        """Unit vector (x, y) pointing downwind."""
        r = np.deg2rad(self.dir_deg)
        return np.array([np.sin(r), np.cos(r)], dtype=float)


# --------------------------------------------------------------------------
# domain
# --------------------------------------------------------------------------


@dataclass
class Domain:
    """A rectangular landscape with elevation and fuel rasters."""

    width: float = 10_000.0
    height: float = 10_000.0
    elevation: np.ndarray = field(default_factory=lambda: np.zeros((512, 512)))
    fuel: np.ndarray = field(default_factory=lambda: np.full((512, 512), GRASS, dtype=int))
    wind: Wind = field(default_factory=Wind)

    # -- geometry helpers --------------------------------------------------
    @property
    def shape(self):
        return self.elevation.shape

    @property
    def bounds(self):
        """(xmin, ymin, xmax, ymax)."""
        return (0.0, 0.0, self.width, self.height)

    @property
    def area_km2(self) -> float:
        return self.width * self.height / 1e6

    @property
    def extent(self):
        """matplotlib imshow extent."""
        return (0.0, self.width, 0.0, self.height)

    def _grid_coords(self, x, y):
        ny, nx = self.shape
        col = np.clip(np.asarray(x, float) / self.width * (nx - 1), 0, nx - 1)
        row = np.clip(np.asarray(y, float) / self.height * (ny - 1), 0, ny - 1)
        return col, row

    # -- sampling ----------------------------------------------------------
    def sample_elev(self, x, y) -> np.ndarray:
        """Bilinear elevation sample at world coordinates."""
        col, row = self._grid_coords(x, y)
        c0 = np.floor(col).astype(int)
        r0 = np.floor(row).astype(int)
        ny, nx = self.shape
        c1 = np.minimum(c0 + 1, nx - 1)
        r1 = np.minimum(r0 + 1, ny - 1)
        fc = col - c0
        fr = row - r0
        e = self.elevation
        top = e[r0, c0] * (1 - fc) + e[r0, c1] * fc
        bot = e[r1, c0] * (1 - fc) + e[r1, c1] * fc
        return top * (1 - fr) + bot * fr

    def sample_fuel(self, x, y) -> np.ndarray:
        """Nearest-neighbour fuel class sample (categorical -- no interpolation)."""
        col, row = self._grid_coords(x, y)
        return self.fuel[np.rint(row).astype(int), np.rint(col).astype(int)]


# --------------------------------------------------------------------------
# builders
# --------------------------------------------------------------------------


def make_domain(
    rng: np.random.Generator,
    width: float = 10_000.0,
    height: float = 10_000.0,
    res: int = 512,
    relief_m: float = 300.0,
    wind: Wind | None = None,
    flat: bool = False,
    uniform_fuel: int | None = None,
    add_road: bool = True,
) -> Domain:
    """Build a synthetic landscape.

    ``flat`` and ``uniform_fuel`` produce the controlled landscapes used by the
    isotropy / slope / firebreak sanity checks in section 6.
    """
    shape = (res, res)

    if flat:
        elev = np.zeros(shape)
    else:
        elev = fractal_noise(rng, shape, base_res=3, octaves=6, persistence=0.55) * relief_m

    if uniform_fuel is not None:
        fuel = np.full(shape, int(uniform_fuel), dtype=int)
    else:
        # A second, independent noise field thresholded into coherent patches.
        f = fractal_noise(rng, shape, base_res=3, octaves=4, persistence=0.5)
        # Use quantiles so the class mix is stable across seeds.
        q = np.quantile(f, [0.08, 0.14, 0.46, 0.76])
        fuel = np.full(shape, TIMBER, dtype=int)
        fuel[f < q[3]] = SHRUB
        fuel[f < q[2]] = GRASS
        fuel[f < q[1]] = ROCK
        fuel[f < q[0]] = WATER

        if add_road:
            # A thin unburnable band crossing the domain -- an explicit firebreak.
            yy, xx = np.mgrid[0:res, 0:res]
            xn = xx / (res - 1)
            yn = yy / (res - 1)
            road = np.abs(yn - (0.34 + 0.12 * np.sin(2.4 * np.pi * xn))) < 0.008
            fuel[road] = ROCK

    return Domain(
        width=width,
        height=height,
        elevation=elev,
        fuel=fuel,
        wind=wind if wind is not None else Wind(speed_ms=6.0, dir_deg=90.0),
    )


# --------------------------------------------------------------------------
# figure
# --------------------------------------------------------------------------


def plot_domain(domain: Domain, path: str) -> str:
    """3-panel figure: elevation, fuel classes, wind."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import BoundaryNorm, ListedColormap
    from matplotlib.patches import FancyArrow

    fig, axes = plt.subplots(1, 3, figsize=(16, 5.4))
    ext = domain.extent

    im = axes[0].imshow(domain.elevation, origin="lower", extent=ext, cmap="terrain")
    axes[0].contour(
        domain.elevation,
        levels=10,
        origin="lower",
        extent=ext,
        colors="k",
        linewidths=0.35,
        alpha=0.4,
    )
    axes[0].set_title("Elevation (m)")
    fig.colorbar(im, ax=axes[0], fraction=0.046)

    codes = sorted(FUEL_NAMES)
    cmap = ListedColormap([FUEL_COLORS[c] for c in codes])
    norm = BoundaryNorm([c - 0.5 for c in codes] + [codes[-1] + 0.5], cmap.N)
    im2 = axes[1].imshow(domain.fuel, origin="lower", extent=ext, cmap=cmap, norm=norm)
    axes[1].set_title("Fuel class")
    cb = fig.colorbar(im2, ax=axes[1], fraction=0.046, ticks=codes)
    cb.ax.set_yticklabels([FUEL_NAMES[c] for c in codes])

    ax = axes[2]
    ax.set_xlim(0, domain.width)
    ax.set_ylim(0, domain.height)
    ax.set_aspect("equal")
    v = domain.wind.vector
    cx, cy = domain.width / 2, domain.height / 2
    L = 0.32 * min(domain.width, domain.height)
    ax.add_patch(
        FancyArrow(
            cx - v[0] * L / 2,
            cy - v[1] * L / 2,
            v[0] * L,
            v[1] * L,
            width=L * 0.02,
            head_width=L * 0.10,
            head_length=L * 0.14,
            color="#c0392b",
            length_includes_head=True,
        )
    )
    ax.set_title(
        f"Wind: {domain.wind.speed_ms:.1f} m/s toward {domain.wind.dir_deg:.0f}°"
    )

    for a in axes:
        a.set_xlabel("x (m)")
    axes[0].set_ylabel("y (m)")

    fig.suptitle(
        f"M1 landscape — {domain.width/1000:.0f} × {domain.height/1000:.0f} km",
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    dom = make_domain(rng)
    p = plot_domain(dom, out("m1_landscape.png"))
    counts = {FUEL_NAMES[c]: int((dom.fuel == c).sum()) for c in sorted(FUEL_NAMES)}
    tot = dom.fuel.size
    print(f"domain {dom.width:.0f} x {dom.height:.0f} m ({dom.area_km2:.0f} km2)")
    print(f"elevation: {dom.elevation.min():.1f} .. {dom.elevation.max():.1f} m")
    print("fuel mix: " + ", ".join(f"{k} {100*v/tot:.1f}%" for k, v in counts.items()))
    print("wrote", p)
