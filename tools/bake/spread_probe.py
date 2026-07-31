"""Measure both spread rules on the real Los Padres landscape.

    python -m tools.bake.spread_probe

The two rules disagree by ~6x on rate of spread, which decides whether a
detection-time benchmark shows anything at all. This is the measurement
that picks one, and docs/fire-model-choice.md is where its answer lives.
Do not change the rule without re-running this and rewriting that file.
"""

from __future__ import annotations

import json
import time

import numpy as np
from scipy.spatial import cKDTree

from ._repo_import import repo_modules
from .fire_domain import build_domain

mesh_m, attributes, fire, spread, calibrate, domain = repo_modules(
    "mesh", "attributes", "fire", "spread", "calibrate", "domain")

LOS_PADRES = (-120.3, 34.4, -119.4, 35.0)
#: Provisional uniform grids standing in for a placement, purely so the probe
#: can report a DETECTION spread rather than a burnt-area spread.
#:
#: Swept rather than fixed, because detection is a property of the fire AND the
#: network, and a single node count cannot separate the two. 572 is the count
#: the Lab actually ships at its default saturation budget on this region; 24
#: was this probe's original single value and is kept because it demonstrates
#: the trap -- 24 nodes at a 2 km radius watch about 5% of an 5,800 km2 box, so
#: nearly everything censors regardless of which rule is running, and a
#: decision rule fed only that number rejects both rules for a reason that has
#: nothing to do with fire behaviour.
PROBE_NODE_COUNTS = (24, 100, 572)
PROBE_DETECT_M = 2000.0


def _detection_minutes(mesh, arrival_min, node_xy, detect_m):
    """Minutes until any node first has fire within `detect_m`."""
    tree = cKDTree(mesh.points)
    best = np.inf
    for x, y in node_xy:
        idx = tree.query_ball_point((x, y), detect_m)
        if not idx:
            continue
        t = arrival_min[idx]
        t = t[~np.isnan(t)]
        if t.size:
            best = min(best, float(t.min()))
    return best


def probe(d_min: float = 90.0, t_end_min: float = 120.0,
          n_ignitions: int = 5) -> dict:
    # NOTE: domain.Wind's real fields are speed_ms/dir_deg, not the brief's
    # speed/direction -- confirmed via inspect.signature before writing this.
    wind = domain.Wind(speed_ms=8.0, dir_deg=90.0)
    dom, prov = build_domain(LOS_PADRES, wind=wind)

    t0 = time.time()
    # clip_guard=False is mandatory -- the guard is a universal false
    # positive and its remedy imports shapely, which is not installed.
    m = mesh_m.build_mesh(np.random.default_rng(1), dom, d_min,
                          lloyd_iters=2, clip_guard=False)
    mesh_s = time.time() - t0

    # calibrate.reference_d_ref() calls mesh_m.build_mesh internally without
    # clip_guard=False, and the guard is a universal false positive on this
    # box (shapely, its only remedy, is not installed) -- so the call as
    # written always raises ModuleNotFoundError here. calibrate.py is
    # read-only, so reference_d_ref's own three building blocks (all public)
    # are called directly instead, reproducing it exactly but with the
    # mandatory clip_guard=False added.
    d_ref = calibrate.reference_spacing(
        mesh_m.build_mesh(np.random.default_rng(101), calibrate.flat_domain(),
                          calibrate.REF_D_MIN, lloyd_iters=2, clip_guard=False))
    # The two rules take DIFFERENT parameter dicts, and handing one the other's
    # raises KeyError: fire.PARAMS carries p0/c1/c2 (the Bernoulli edge
    # probabilities), spread.PARAMS_ROS carries ros0_m_min/wind_gain/lb_cap
    # (the elliptical rate-of-spread model). Only a_slope, dt_s, max_steps and
    # t_end_min are common to both. dt_s is 60.0 either way, so the attribute
    # build below does not depend on which one is used.
    params_bernoulli = dict(fire.PARAMS)
    params_bernoulli["t_end_min"] = t_end_min
    params_ros = dict(spread.PARAMS_ROS)
    params_ros["t_end_min"] = t_end_min
    if params_bernoulli["dt_s"] != params_ros["dt_s"]:
        raise RuntimeError(
            "the two rules disagree about dt_s, so one Attributes cannot serve "
            "both -- build a separate attribute set per rule before comparing"
        )
    attrs = attributes.build_attributes(m, dom, dt_s=params_ros["dt_s"], d_ref=d_ref)

    # Provisional uniform grids over the domain, only so detection spread can
    # be measured. These are NOT the benchmark's grid arm.
    def grid_of(n):
        cols = int(round(np.sqrt(n * dom.width / dom.height)))
        rows = max(1, n // max(cols, 1))
        return [((i + 0.5) / cols * dom.width, (j + 0.5) / rows * dom.height)
                for j in range(rows) for i in range(cols)]

    node_sets = {n: grid_of(n) for n in PROBE_NODE_COUNTS}

    rng = np.random.default_rng(7)
    ignitions = [(float(rng.uniform(0.2, 0.8) * dom.width),
                  float(rng.uniform(0.2, 0.8) * dom.height))
                 for _ in range(n_ignitions)]

    out = {"meshSeconds": mesh_s, "cells": int(m.n), "dMin": d_min,
           "tEndMin": t_end_min, "provenance": prov, "rules": {}}

    p_edge = fire.edge_probabilities(attrs, wind, d_ref, params_bernoulli)
    for name in ("bernoulli", "ros"):
        # One simulation per ignition, scored against every node count -- the
        # arrival field does not depend on the network, so sweeping the grid
        # costs a KD-tree query, not another simulation.
        times = {n: [] for n in PROBE_NODE_COUNTS}
        areas, secs = [], []
        for k, xy in enumerate(ignitions):
            t0 = time.time()
            if name == "bernoulli":
                res = fire.simulate(m, attrs, wind, np.random.default_rng(100 + k),
                                    d_ref, seed_xy=xy, params=params_bernoulli,
                                    p_edge=p_edge)
            else:
                # NOTE the different signature: d_ref is 4th positional, there
                # is no rng in the loop position, and the params dict is the
                # ROS one -- fire.PARAMS here raises KeyError on lb_cap.
                res = spread.simulate_ros(m, attrs, wind, d_ref,
                                          seed_xy=xy, params=params_ros)
            secs.append(time.time() - t0)
            am = res.arrival_min
            # NOTE: cell_area lives on the mesh, not Attributes -- confirmed
            # via the dataclass fields of both before writing this call
            # (attributes.py has no cell_area attribute; mesh.py does).
            areas.append(float(np.nansum(m.cell_area[~np.isnan(am)]) / 1e6))
            for n, node_xy in node_sets.items():
                times[n].append(_detection_minutes(m, am, node_xy, PROBE_DETECT_M))

        by_nodes = {}
        for n in PROBE_NODE_COUNTS:
            finite_n = [t for t in times[n] if np.isfinite(t)]
            by_nodes[str(n)] = {
                "nodes": len(node_sets[n]),
                "detectionMinutes": times[n],
                "censored": int(len(times[n]) - len(finite_n)),
                "p10": float(np.percentile(finite_n, 10)) if finite_n else None,
                "p90": float(np.percentile(finite_n, 90)) if finite_n else None,
                "spread": (float(np.percentile(finite_n, 90)
                                 - np.percentile(finite_n, 10))
                           if finite_n else None),
            }

        # The headline node count is the one the Lab actually ships.
        times_headline = times[PROBE_NODE_COUNTS[-1]]
        finite = [t for t in times_headline if np.isfinite(t)]
        out["rules"][name] = {
            "byNodeCount": by_nodes,
            "headlineNodeCount": PROBE_NODE_COUNTS[-1],
            "detectionMinutes": times_headline,
            "censored": int(len(times_headline) - len(finite)),
            "p10": float(np.percentile(finite, 10)) if finite else None,
            "p90": float(np.percentile(finite, 90)) if finite else None,
            "spread": (float(np.percentile(finite, 90) - np.percentile(finite, 10))
                       if finite else None),
            "burntKm2": areas,
            "secondsPerRun": secs,
        }
    return out


def main(argv=None) -> int:
    print(json.dumps(probe(), indent=1, default=float))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
