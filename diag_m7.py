"""M7 diagnostics: are the wind and slope terms wired, and do they steer the scar?

Two separate questions, answered separately:

1. **Wiring** (`probe_terms`) -- no simulation.  Reads the DEM straight through
   to ``p_slope`` and reports the spread of each multiplicative term over the
   real mesh.  If ``p_slope`` is flat at 1.0 the DEM is not reaching the edges,
   regardless of what any run looks like.
2. **Steering** (`run_case`) -- one simulation per condition, scored with the
   *existing* M7 protocol (area-matched truncation) so the IoU is comparable to
   the 0.278 headline.  Reports where the scar actually went, not just how well
   it overlapped: a scar can be wrong in shape and still move the right way.

``p0`` and the run duration are untouched throughout; only ``wind`` and
``a_slope`` are overridden, one at a time.
"""

from __future__ import annotations

import argparse
import time

import numpy as np

from domain import Wind


# --------------------------------------------------------------------------
# scar geometry
# --------------------------------------------------------------------------


def _bearing(vx: float, vy: float) -> float:
    """Compass bearing (0 = +y/north, 90 = +x/east) of a vector, in [0, 360)."""
    return float(np.degrees(np.arctan2(vx, vy)) % 360.0)


def _compass(deg: float) -> str:
    pts = ("N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW")
    return pts[int(round(deg / 22.5)) % 16]


def scar_shape(xy: np.ndarray, weight: np.ndarray, origin) -> dict:
    """Where a burnt patch sits and which way it is stretched.

    ``xy`` are cell centroids (or pixel centres), ``weight`` their areas.
    Returns the directed push from the ignition point to the patch centroid --
    the thing that answers "did it elongate ESE" -- alongside the undirected
    major axis and how elongated the patch is.
    """
    w = np.asarray(weight, dtype=float)
    if w.sum() <= 0 or len(xy) < 3:
        return {"push_deg": float("nan"), "push_m": 0.0,
                "axis_deg": float("nan"), "aspect": float("nan")}

    w = w / w.sum()
    c = (xy * w[:, None]).sum(axis=0)
    d = xy - c
    cov = (d * w[:, None]).T @ d
    evals, evecs = np.linalg.eigh(cov)
    major = evecs[:, int(np.argmax(evals))]
    lo, hi = float(np.min(evals)), float(np.max(evals))

    push = c - np.asarray(origin, dtype=float)
    return {
        # directed: ignition -> centre of mass of the burn
        "push_deg": _bearing(push[0], push[1]),
        "push_m": float(np.hypot(*push)),
        # undirected: the long axis of the patch, folded to [0, 180)
        "axis_deg": _bearing(major[0], major[1]) % 180.0,
        "aspect": float(np.sqrt(hi / lo)) if lo > 1e-12 else float("inf"),
    }


# --------------------------------------------------------------------------
# 1. wiring probe -- no simulation
# --------------------------------------------------------------------------


def probe_terms(fire, mesh, attrs, wind: Wind, a_slope: float) -> dict:
    """Spread of each probability factor over the real mesh, at one setting."""
    from calibrate import reference_d_ref
    from fire import PARAMS, edge_probabilities

    P = dict(PARAMS)
    P["a_slope"] = a_slope
    p, terms = edge_probabilities(attrs, wind, reference_d_ref(), P, return_terms=True)

    sl_deg = np.degrees(attrs.e_slope)
    ps, pw = terms["p_slope"], terms["p_wind"]
    return {
        "a_slope": a_slope,
        "wind_ms": wind.speed_ms,
        "slope_deg_p95": float(np.percentile(np.abs(sl_deg), 95)),
        "slope_deg_max": float(np.abs(sl_deg).max()),
        "p_slope_lo": float(ps.min()),
        "p_slope_hi": float(ps.max()),
        "p_slope_ratio": float(ps.max() / max(ps.min(), 1e-12)),
        "p_wind_lo": float(pw.min()),
        "p_wind_hi": float(pw.max()),
        "p_wind_ratio": float(pw.max() / max(pw.min(), 1e-12)),
        "p_mean": float(p.mean()),
        "frac_clamped": float(np.mean(p >= 1.0)),
    }


# --------------------------------------------------------------------------
# 2. steering -- one run per condition
# --------------------------------------------------------------------------


def run_case(fire, label: str, wind: Wind | None = None, a_slope: float | None = None,
             d_min: float = 90.0, t_end_min: float = 2400.0, seed: int = 7,
             grid_n: int = 512) -> dict:
    """One simulation under an overridden wind / a_slope, scored M7-style."""
    from attributes import build_attributes
    from calibrate import reference_d_ref
    from fire import PARAMS, simulate
    from mesh import build_mesh
    from metrics import RefGrid, iou, rasterise_mask
    from realdata import perimeter_raster, scar_at_area

    dom = fire.domain
    w = dom.wind if wind is None else wind
    d_ref = reference_d_ref()

    P = dict(PARAMS)
    P["t_end_min"] = t_end_min          # unchanged from validate()
    if a_slope is not None:
        P["a_slope"] = a_slope

    t0 = time.time()
    mesh = build_mesh(np.random.default_rng(seed), dom, d_min, lloyd_iters=2)
    attrs = build_attributes(mesh, dom, dt_s=P["dt_s"], d_ref=d_ref)
    res = simulate(mesh, attrs, w, np.random.default_rng(seed), d_ref,
                   seed_xy=fire.ignition_xy, params=P)

    grid = RefGrid(dom.width, dom.height, grid_n, grid_n)
    own = grid.owners(mesh)
    truth = perimeter_raster(fire, grid)

    target = fire.perimeter.area
    matched, step = scar_at_area(res, target)
    sim_matched = rasterise_mask(own, matched)

    shape = scar_shape(mesh.points[matched], mesh.cell_area[matched], fire.ignition_xy)
    probe = probe_terms(fire, mesh, attrs, w, P["a_slope"])

    return {
        "label": label,
        "wind_ms": w.speed_ms,
        "wind_toward": w.dir_deg,
        "a_slope": P["a_slope"],
        "iou": iou(sim_matched, truth),
        "reached": bool(res.area_per_step[-1] >= target),
        "hours_to_area": step * res.dt_s / 3600.0,
        "full_burn_km2": res.area_per_step[-1] / 1e6,
        "frac_clamped": probe["frac_clamped"],
        "p_slope_ratio": probe["p_slope_ratio"],
        "p_wind_ratio": probe["p_wind_ratio"],
        "secs": time.time() - t0,
        **shape,
    }


def truth_shape(fire, grid_n: int = 512) -> dict:
    """The same shape statistics, measured on the mapped perimeter."""
    from metrics import RefGrid
    from realdata import perimeter_raster

    dom = fire.domain
    grid = RefGrid(dom.width, dom.height, grid_n, grid_n)
    truth = perimeter_raster(fire, grid)
    pix = grid.pix.reshape(*grid.shape, 2)[truth]
    return scar_shape(pix, np.ones(len(pix)), fire.ignition_xy)


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------


def print_table(rows: list) -> None:
    hdr = (f"{'case':<26} {'wind':>6} {'a_sl':>6} {'IoU':>6} {'push':>14} "
           f"{'axis':>7} {'aspect':>7} {'p_sl×':>7} {'p_w×':>8} {'clamp':>6} {'h':>6}")
    print("\n" + hdr)
    print("-" * len(hdr))
    for r in rows:
        push = f"{r['push_deg']:5.0f} {_compass(r['push_deg']):>4s} {r['push_m']/1000:4.1f}k"
        print(f"{r['label']:<26} {r['wind_ms']:6.1f} {r['a_slope']:6.3f} "
              f"{r['iou']:6.3f} {push:>14} {r['axis_deg']:7.0f} {r['aspect']:7.2f} "
              f"{r['p_slope_ratio']:7.2f} {r['p_wind_ratio']:8.1f} "
              f"{r['frac_clamped']:6.1%} {r['hours_to_area']:6.1f}")


# Each case may override wind speed (m/s), wind bearing (deg TOWARD) and
# a_slope.  Anything omitted keeps the real / calibrated value.
CASES = {
    "baseline": dict(),
    # the requested test: real July-8 bearing, gust-level speed
    "wind15": dict(wind_ms=15.0),
    "wind17": dict(wind_ms=17.0),
    "wind20": dict(wind_ms=20.0),
    # same speed, pointed where the fire actually went
    "wind17_toward265": dict(wind_ms=17.0, wind_deg=265.0),
    "wind17_toward304": dict(wind_ms=17.0, wind_deg=304.0),
    # slope sensitivity at the real (weak) wind
    "slope0.5": dict(a_slope=0.5),
    "slope1.5": dict(a_slope=1.5),
    "slope3.0": dict(a_slope=3.0),
    "slope8.0": dict(a_slope=8.0),
    "slope3+wind17": dict(a_slope=3.0, wind_ms=17.0),
}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cases", default="baseline",
                    help="comma-separated case names, or 'all'")
    ap.add_argument("--d-min", dest="d_min", type=float, default=90.0)
    ap.add_argument("--probe-only", action="store_true",
                    help="wiring probe only, no simulation")
    args = ap.parse_args(argv)

    from realdata import load_lake_fire

    fire = load_lake_fire(verbose=False)
    dom = fire.domain
    print(f"domain {dom.width/1000:.1f} x {dom.height/1000:.1f} km, "
          f"elev {dom.elevation.min():.0f}..{dom.elevation.max():.0f} m "
          f"(relief {np.ptp(dom.elevation):.0f} m)")
    print(f"real wind: {dom.wind.speed_ms:.1f} m/s toward {dom.wind.dir_deg:.0f} deg "
          f"({_compass(dom.wind.dir_deg)})")

    t = truth_shape(fire)
    print(f"\nMAPPED PERIMETER  push {t['push_deg']:.0f} deg "
          f"({_compass(t['push_deg'])}) {t['push_m']/1000:.1f} km from ignition, "
          f"long axis {t['axis_deg']:.0f} deg, aspect {t['aspect']:.2f}")
    print("  ^ this is what a correct scar should reproduce\n")

    if args.probe_only:
        from attributes import build_attributes
        from calibrate import reference_d_ref
        from mesh import build_mesh

        mesh = build_mesh(np.random.default_rng(7), dom, args.d_min, lloyd_iters=2)
        attrs = build_attributes(mesh, dom, dt_s=60.0, d_ref=reference_d_ref())
        sl = np.degrees(attrs.e_slope)
        print(f"mesh {mesh.n:,} cells @ d_min={args.d_min:.0f} m")
        print(f"edge slope: |median| {np.median(np.abs(sl)):.2f} deg, "
              f"p95 {np.percentile(np.abs(sl), 95):.2f} deg, "
              f"max {np.abs(sl).max():.2f} deg, "
              f"frac |slope|<0.5deg = {np.mean(np.abs(sl) < 0.5):.1%}")
        print("\nIf that spread is ~0, the DEM is not reaching the edges.\n")
        for a in (0.078, 0.5, 1.5, 3.0, 8.0):
            p = probe_terms(fire, mesh, attrs, dom.wind, a)
            print(f"  a_slope={a:5.3f}  p_slope in [{p['p_slope_lo']:.3f}, "
                  f"{p['p_slope_hi']:.3f}]  up/down ratio {p['p_slope_ratio']:6.2f}x")
        for v in (2.0, 15.0, 17.0, 20.0):
            p = probe_terms(fire, mesh, attrs, Wind(v, dom.wind.dir_deg), 0.078)
            print(f"  wind={v:5.1f}    p_wind  in [{p['p_wind_lo']:.4f}, "
                  f"{p['p_wind_hi']:.3f}]  head/back  {p['p_wind_ratio']:8.1f}x"
                  f"   clamped {p['frac_clamped']:.1%}")
        return 0

    names = list(CASES) if args.cases == "all" else args.cases.split(",")
    rows = []
    for name in names:
        spec = dict(CASES[name])
        wind = None
        if "wind_ms" in spec or "wind_deg" in spec:
            wind = Wind(spec.pop("wind_ms", dom.wind.speed_ms),
                        spec.pop("wind_deg", dom.wind.dir_deg))
        print(f"running {name} ...", flush=True)
        rows.append(run_case(fire, name, wind=wind, d_min=args.d_min, **spec))
        print(f"  done in {rows[-1]['secs']:.0f}s  IoU={rows[-1]['iou']:.3f}  "
              f"push {rows[-1]['push_deg']:.0f} ({_compass(rows[-1]['push_deg'])})",
              flush=True)

    print_table(rows)
    print(f"\ntarget push {t['push_deg']:.0f} ({_compass(t['push_deg'])}), "
          f"target axis {t['axis_deg']:.0f}, target aspect {t['aspect']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
