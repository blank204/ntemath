"""CLI entry point.

    python run.py --mode demo       one annotated run, wind/slope asymmetry visible
    python run.py --mode calibrate  p0 table + the section-6 sanity checks
    python run.py --mode sweep      the resolution experiment -> RESULTS.md
    python run.py --mode real       M7, a real fire on real data

Real mode asks which fire to run unless told:

    python run.py --mode real                      prompts for year, then name
    python run.py --mode real --fire LAKE --year 2024
    python run.py --mode real --year 2020 --min-acres 50000 --sensitivity
"""

from __future__ import annotations

import argparse
import sys

import numpy as np

from domain import Wind, make_domain, out, plot_domain


def cmd_demo(args) -> int:
    """One full run on the synthetic landscape, with the M1-M5 figures."""
    from attributes import build_attributes, plot_attributes
    from calibrate import reference_d_ref
    from fire import PARAMS, plot_burn_scar, plot_front_series, simulate
    from mesh import build_mesh, plot_mesh, verify_delaunay_dual
    from metrics import head_ros

    wind = Wind(args.wind, args.wind_dir)
    dom = make_domain(np.random.default_rng(args.domain_seed), wind=wind)
    d_ref = reference_d_ref()

    print(f"landscape {dom.width/1000:.0f}x{dom.height/1000:.0f} km, "
          f"wind {wind.speed_ms:.0f} m/s toward {wind.dir_deg:.0f} deg")
    print(f"d_ref = {d_ref:.2f} m   p0 = {PARAMS['p0']}")

    mesh = build_mesh(np.random.default_rng(1), dom, args.d_min, lloyd_iters=2)
    st = mesh.stats()
    print(f"mesh: n={mesh.n:,} cells, {len(mesh.edges):,} edges, "
          f"interior coordination {st['coord_mean_interior']:.3f} (Poisson-Voronoi ~6)")
    print("ridge adjacency is a subset of the Delaunay edges:",
          verify_delaunay_dual(mesh))

    P = dict(PARAMS)
    P["t_end_min"] = args.t_end
    attrs = build_attributes(mesh, dom, dt_s=P["dt_s"], d_ref=d_ref)
    res = simulate(
        mesh, attrs, wind, np.random.default_rng(args.seed), d_ref,
        seed_xy=(args.x, args.y), params=P,
    )
    burnt_km2 = res.area_per_step[-1] / 1e6
    print(f"run: {res.steps} steps ({res.duration_min:.0f} min), "
          f"{res.burnt_mask.sum():,}/{mesh.n:,} cells burnt, "
          f"{burnt_km2:.1f} km2 ({100*burnt_km2/dom.area_km2:.0f}% of the domain)")
    print(f"head ROS: {head_ros(mesh, res, wind):.1f} m/min")

    for p in (
        plot_domain(dom, out("m1_landscape.png")),
        plot_mesh(mesh, out(f"m2_mesh_d{int(args.d_min)}.png")),
        plot_attributes(mesh, attrs, out("m3_attributes.png")),
        plot_burn_scar(mesh, attrs, res, out("m5_burn_scar.png")),
        plot_front_series(mesh, res, out("m5_front_series.png")),
    ):
        print("wrote", p)
    return 0


def cmd_calibrate(args) -> int:
    from calibrate import run_all

    checks = run_all(quick=args.quick)
    return 1 if any(not c.passed for c in checks) else 0


def cmd_sweep(args) -> int:
    from sweep import SweepConfig, main

    cfg = SweepConfig()
    if args.quick:
        cfg = SweepConfig(
            replicates=4, d_mins=(80.0, 160.0, 320.0, 640.0), grid_n=256
        )
    if args.replicates:
        cfg = SweepConfig(**{**cfg.__dict__, "replicates": args.replicates})
    main(cfg)
    return 0


def cmd_real(args) -> int:
    """M7: any FRAP-mapped fire on real LANDFIRE / FRAP / Open-Meteo data.

    With no ``--fire``/``--year`` this prompts for the fire to run; with both
    it never prompts, so sweeps and scripts stay non-interactive.
    """
    try:
        import geopandas  # noqa: F401
        import rasterio  # noqa: F401
        import requests  # noqa: F401
    except ImportError as e:
        print(
            f"M7 needs the geospatial stack and {e.name} is missing.\n"
            "  pip install requests pyproj rasterio geopandas"
        )
        return 2

    import datetime as dt
    import os

    from catalog import choose_fire
    from realdata import (
        append_results_section,
        load_fire,
        plot_real_domain,
        plot_validation,
        plot_wind_series,
        sensitivity,
        validate,
    )

    record = choose_fire(year=args.year, name=args.fire, min_acres=args.min_acres)

    ig = None
    if args.ignition_lonlat:
        try:
            lon, lat = (float(v) for v in args.ignition_lonlat.split(","))
        except ValueError:
            print("--ignition-lonlat wants 'lon,lat', e.g. -119.9556,34.7767")
            return 2
        ig = (lon, lat)

    start_date = None
    if args.start_date:
        start_date = dt.date.fromisoformat(args.start_date)

    fire = load_fire(
        record,
        refresh=args.refresh,
        wind_source=args.wind_source,
        start_hour=args.start_hour,
        ignition_lonlat=ig,
        start_date=start_date,
    )

    slug = record.slug
    paths = {
        f"outputs/m7_{slug}_domain.png":
            plot_real_domain(fire, out(f"m7_{slug}_domain.png")),
        f"outputs/m7_{slug}_wind.png":
            plot_wind_series(fire, out(f"m7_{slug}_wind.png")),
    }

    print("\n--- validation against the mapped perimeter ---")
    stats, bundle = validate(fire, d_min=args.d_min if args.d_min != 80.0 else 90.0,
                             rule=args.rule)
    paths[f"outputs/m7_{slug}_validation.png"] = plot_validation(
        fire, stats, bundle, out(f"m7_{slug}_validation.png")
    )

    sens = None
    if args.sensitivity:
        print("\n--- wind sensitivity (3 further runs) ---")
        sens = sensitivity(fire, d_min=args.d_min if args.d_min != 80.0 else 90.0,
                           rule=args.rule)

    md = append_results_section(
        fire, stats, paths,
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "RESULTS.md"),
        sens=sens,
    )
    for p in paths.values():
        print("wrote", p)
    print("wrote", md, "(M7 section)")

    if fire.warnings:
        print("\ncaveats recorded in RESULTS.md:")
        for w in fire.warnings:
            print(f"  - {w}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mode", required=True,
                   choices=("demo", "calibrate", "sweep", "real"))
    p.add_argument("--quick", action="store_true",
                   help="fewer replicates / levels, for a fast check")
    p.add_argument("--replicates", type=int, default=None,
                   help="override the replicate count (sweep mode)")
    p.add_argument("--d-min", dest="d_min", type=float, default=80.0,
                   help="generator spacing for demo mode (m)")
    p.add_argument("--wind", type=float, default=8.0, help="wind speed (m/s)")
    p.add_argument("--wind-dir", dest="wind_dir", type=float, default=90.0,
                   help="direction the wind blows toward (deg, 90 = +x)")
    p.add_argument("--t-end", dest="t_end", type=float, default=90.0,
                   help="stop after this many simulated minutes")
    p.add_argument("-x", type=float, default=5000.0, help="ignition x (m)")
    p.add_argument("-y", type=float, default=5000.0, help="ignition y (m)")
    p.add_argument("--seed", type=int, default=2, help="simulation RNG seed")
    p.add_argument("--domain-seed", dest="domain_seed", type=int, default=0)
    p.add_argument("--refresh", action="store_true",
                   help="re-download the M7 source layers instead of using the cache")

    real = p.add_argument_group("real mode (M7) — fire selection and wind")
    real.add_argument("--fire", default=None,
                      help="FRAP fire name, e.g. LAKE. Omit to be asked.")
    real.add_argument("--year", type=int, default=None,
                      help="fire year, e.g. 2024. Omit to be asked.")
    real.add_argument("--min-acres", dest="min_acres", type=float, default=0.0,
                      help="hide fires smaller than this when listing")
    real.add_argument("--wind-source", dest="wind_source", default="sustained",
                      choices=("sustained", "gust", "midflame"),
                      help="which hourly wind drives spread (default: sustained; "
                           "gust measured slightly worse, see RESULTS.md)")
    real.add_argument("--start-hour", dest="start_hour", type=int, default=12,
                      help="local hour on the alarm date taken as t=0. FRAP "
                           "records no time of day; noon avoids handing the run "
                           "its first hours of calm overnight wind.")
    real.add_argument("--start-date", dest="start_date", default=None,
                      help="override the alarm date (YYYY-MM-DD) when FRAP has none")
    real.add_argument("--ignition-lonlat", dest="ignition_lonlat", default=None,
                      help="ignition point as 'lon,lat'; otherwise a known origin "
                           "is used, or the perimeter centroid with a warning")
    real.add_argument("--rule", default="bernoulli", choices=("bernoulli", "ros"),
                      help="transition rule: 'bernoulli' is the per-step draw; "
                           "'ros' is the arrival-time reformulation that keeps "
                           "wind anisotropy from being diluted by residence time")
    real.add_argument("--sensitivity", action="store_true",
                      help="also run the constant-mean and no-wind arms and put "
                           "the comparison in RESULTS.md (3 extra runs)")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return {
        "demo": cmd_demo,
        "calibrate": cmd_calibrate,
        "sweep": cmd_sweep,
        "real": cmd_real,
    }[args.mode](args)


if __name__ == "__main__":
    sys.exit(main())
