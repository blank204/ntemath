"""The 100 ignition points, chosen once and reproducibly.

The same points are fed to both placement arms. That is the whole basis of
the comparison: if the two arms saw different fires, the benchmark would be
measuring the fires.
"""

from __future__ import annotations

import numpy as np

from ._repo_import import repo_modules

domain, fire = repo_modules("domain", "fire")

#: Fixed for the life of the site. Changing it changes every published
#: detection-time figure, so it is a constant and not a parameter.
IGNITION_SEED = 20260731


def sample_ignitions(dom, n: int = 100, seed: int = IGNITION_SEED,
                     margin_frac: float = 0.12) -> np.ndarray:
    """`n` ignition points, in domain metres, on burnable ground.

    Weighted by burnable cells rather than uniform over the box: a uniform
    sample puts points in the Pacific and on bare rock, where
    fire.pick_seed_cell silently relocates them -- possibly kilometres,
    possibly across a firebreak. Inset from the edge because a scar that
    runs off the domain has a truncated arrival field, and a truncated
    arrival field understates detection time without saying so.

    The burnable test is domain.UNBURNABLE_FUELS -- confirmed by inspection
    (see task-3-report.md) to be the real (WATER, ROCK) = (0, 1) sentinel
    pair that fbfm40_to_fuel and fire_domain.py both key off of. There is no
    attributes.UNBURNABLE_FUEL (singular); attributes.UNBURNABLE is an
    unrelated per-cell *state* code (0, coincidentally), not a fuel class.
    """
    fuel = np.asarray(dom.fuel)
    ny, nx = fuel.shape
    burnable = ~np.isin(fuel, domain.UNBURNABLE_FUELS)

    mx = int(nx * margin_frac)
    my = int(ny * margin_frac)
    inset = np.zeros_like(burnable)
    inset[my:ny - my, mx:nx - mx] = True
    ok = burnable & inset
    idx = np.flatnonzero(ok.ravel())
    if idx.size < n:
        raise RuntimeError(
            f"only {idx.size} burnable inset cells; cannot place {n} ignitions"
        )

    rng = np.random.default_rng(seed)
    pick = rng.choice(idx, size=n, replace=False)
    rows, cols = np.divmod(pick, nx)
    # Cell centres. Row 0 is the SOUTH edge, matching domain.Domain
    # (domain.py:_grid_coords maps y=0 -> row 0, increasing with y).
    x = (cols + 0.5) / nx * dom.width
    y = (rows + 0.5) / ny * dom.height
    return np.column_stack([x, y]).astype(np.float64)


def snap_report(mesh, attrs, xy) -> list[dict]:
    """How far each ignition moved when snapped to a mesh generator.

    fire.pick_seed_cell snaps to the nearest BURNABLE generator (mesh cells
    with attrs.state0 == UNBURNT) and reports nothing on its own. Calling it
    directly here -- rather than re-deriving a burnable mask against
    mesh.points -- means this reports the actual relocation pick_seed_cell
    performs, not a guess at it. Over a landscape with water, rock and roads
    some of these will move a long way, and an ignition that silently
    relocated across a ridge is a different experiment from the one that was
    requested.
    """
    report = []
    for x, y in xy:
        cell = fire.pick_seed_cell(mesh, attrs, (x, y))
        px, py = mesh.points[cell]
        shift = float(np.hypot(px - x, py - y))
        report.append({
            "requested": [float(x), float(y)],
            "cell": int(cell),
            "shiftM": shift,
        })
    return report
