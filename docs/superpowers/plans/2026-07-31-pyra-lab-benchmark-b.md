# Pyra Site — Plan 3: The Lab, Benchmark B (detection time)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Lab reports, for Los Padres only, how long a fire burns before any node in the network sees it — across 100 reproducible ignitions, for both the risk-driven placement and the uniform grid, as a distribution rather than an anecdote, recomputed live whenever the placement or the detection radius changes.

**Architecture:** Fire spread is simulated **offline in Python** and baked, because it needs LANDFIRE rasters, a 420,000-cell Voronoi mesh and scipy — none of which belong in a browser. What is baked is not a detection time but the raw material for one: for each of 100 ignitions, the **arrival time of the fire at every burnt cell** on a coarse grid, stored sparsely. The browser then computes detection time itself — `min` arrival over all cells within `detectKm` of any node — so Benchmark B responds to the weight sliders and the radius slider exactly as Benchmark A does, instead of being a frozen picture. Outside Los Padres the benchmark is **absent with a stated reason**, never silently missing and never computed by a model outside the geography it was validated in.

**Tech Stack:** Python 3.11 (numpy, scipy, rasterio, requests) for the offline bake · Vite · React 18 · TypeScript · Vitest · Web Workers · Zustand · hand-written SVG. No new runtime dependencies in `web/`.

---

## Global Constraints

- **Branch:** all work on `pyra-site` in `blank204/ntemath`. Never commit to `main`.
- **No repo-root Python may be modified.** `fire.py`, `spread.py`, `mesh.py`, `domain.py`, `attributes.py`, `metrics.py`, `realdata.py`, `catalog.py`, `calibrate.py`, `sweep.py`, `weather.py`, `place.py`, `plan.py`, `forest.py`, `hazard.py`, `geo.py`, `world.py` are read-only. This plan is additive; everything new lives in `tools/bake/` or `web/`.
- **No `sys.path` mutation anywhere in `tools/`.** Import repo-root modules through `tools/bake/_repo_import.py:repo_modules(...)`.
- **Verify every repo-root Python signature with `inspect.signature` before writing a call site.** Confirmed by measurement while writing this plan (re-run the check in Task 1 Step 1 anyway):
  `domain.make_domain(rng, width=10000.0, height=10000.0, res=512, relief_m=300.0, wind=None, flat=False, uniform_fuel=None, add_road=True)`;
  `mesh.build_mesh(rng, domain, d_min, lloyd_iters=2, clip_guard=True)`;
  `attributes.build_attributes(mesh, domain, dt_s=60.0, d_ref=None)`;
  `attributes.reference_spacing(mesh)`;
  `fire.edge_probabilities(attrs, wind, d_ref, params=None, return_terms=False)`;
  `fire.simulate(mesh, attrs, wind, rng, d_ref, seed_xy=None, seed_cell=None, params=None, p_edge=None)`;
  `spread.simulate_ros(mesh, attrs, wind, d_ref=0.0, seed_xy=None, seed_cell=None, params=None, rng=None)` — **note `d_ref` is the 4th positional and there is no `rng` in the loop position**;
  `realdata.fetch_raster(service, bounds, name, epsg=32611, res_m=30.0, refresh=False)`;
  `realdata.fbfm40_to_fuel(fbfm)`;
  `calibrate.reference_d_ref()`;
  `metrics.RefGrid(width, height, nx=512, ny=512)`.
- **`clip_guard=False` on every `build_mesh` call, without exception.** The guard is a universal false positive (Finding 2) and its remedy imports `shapely`, which is not installed. This is a documented public parameter, not a workaround.
- **`shapely`, `geopandas` and `pyproj` are NOT installed and must not become dependencies.** `realdata.load_fire` therefore cannot be called at all. Reproject with `rasterio.warp.transform_bounds`.
- **Never invent a constant the source already defines.** `fire.PARAMS`, `spread`'s own defaults, `calibrate.reference_d_ref()` and `attributes.reference_spacing` are read at bake time and published in the bake's metadata; the browser reads them from there.
- **Determinism is not optional.** Every ignition, every mesh and every simulation is seeded explicitly and the seeds are published. A bake that cannot be reproduced byte-for-byte is not evidence.
- **Colour rule — absolute:** green and black are surfaces; saturated orange is reserved for fire, heat and alert states only. **Benchmark B is the one place in the Lab where fire is literally the subject**, so `PALETTE.heat` is permitted for the fire scar and for alert states in the event log — and nowhere else. Data series remain `PALETTE.series.pyra` (mesh teal) and `PALETTE.series.baseline` (grey). **Import every colour from `web/src/theme/palette.ts`. Never write a hex literal outside that file.**
- **Dataviz rules, binding:** never a dual axis; a legend whenever there are two or more series; colour by job, never by rank; a hover layer on every plotted mark; a table view for every chart; label selectively. Per the spec, the 100-run comparison is **two dot strips with median markers**, one row per strategy, medians directly labelled — not a histogram, not a box plot, not a bar chart.
- **Honesty rules:** every detection-time number states the spread rule it was produced by, the detection radius, and the number of ignitions. Every censored run (fire never seen) is reported as censored, never as a large number and never dropped. Nothing anywhere implies the fire model is validated outside California.
- **Los Padres only.** On the other seven regions Benchmark B renders an explicit absence with the reason, and the Lab keeps working. This is a Global Constraint, not a Task 11 detail.
- **The regression bar:** 269 tests pass today. Every task ends with `cd web && npm test` green and `cd web && npm run build` succeeding. Node.js ≥ 20, Python ≥ 3.11.
- **Out of scope, by design:** the Rail (Plan 4), the rod and the fusion truth table (Plan 5), the camper app (Plan 5), `/assumptions` (Plan 5). Benchmark A must keep working unchanged throughout; nothing in this plan may make it conditional on fire data existing.

---

## Read this before Task 1: five measured findings that shape the plan

These were measured against the committed code while writing this plan. Each changes what a naive implementation would do, and each has a task that acts on it.

**1. There is no bbox → Domain function. Building one is real work, not a call.**

`realdata.load_fire` is keyed on a **CAL FIRE FRAP fire record** and derives its bounding box *from that fire's perimeter* — it cannot be pointed at the Los Padres planner box. It also needs `shapely`, `geopandas` and `pyproj`, none of which are installed. The reusable primitive underneath is `realdata.fetch_raster(service, bounds, name, epsg=32611, res_m=30.0)`, which takes **UTM metre bounds**. Task 1 writes the bridge: lon/lat box → UTM bounds (via `rasterio.warp.transform_bounds`, since `pyproj` is absent) → two `fetch_raster` calls (elevation, FBFM40) → `realdata.fbfm40_to_fuel` → `domain.Domain`. About twenty lines, and it touches no repo file.

**2. `mesh.build_mesh` cannot run with default arguments, at any domain size.**

`docs/repo-issues.md §1.6` records the `clip_guard` false positive as happening "on large domains". Measured, it trips at **every** size and seed tried — 10 km, 16 km, 20 km, four seeds, all trip. The cause is at `mesh.py:290-293`: the guard tests the minimum x of **all** Voronoi vertices including those of the mirrored ghost generators, whose near-collinear circumcentres land millions of metres outside the domain. It can essentially never pass. Cell areas summed to the domain area with relative error `0.00e+00` in every case, so the guard is diagnosing nothing. Its remedy path imports `shapely` and runs a per-cell Python loop, which at 420k cells would dwarf the mesh build itself. **Every `build_mesh` call in this plan passes `clip_guard=False`.**

**3. The two spread rules disagree about rate by ~6×, and the benchmark's answer lives in that gap.**

On identical mesh, attributes and wind (30×30 km, `d_min=90`, 8 m/s, 120 min):

| rule | head ROS | radius reached at 120 min | cells burnt | area |
|---|---:|---:|---:|---:|
| `fire.simulate` (Bernoulli) | 86.0 m/min | 10.19 km | 9,157 | 121.1 km² |
| `spread.simulate_ros` | 14.2 m/min | 1.51 km | 53 | 0.7 km² |

At 86 m/min a fire reaches 10 km in two hours, so with a 2 km detection radius essentially every node within ~12 km sees it and the detection-time distribution collapses toward zero — the benchmark would be measuring node geometry, not fire behaviour, while appearing to measure fire behaviour. `spread.simulate_ros` is also **fully deterministic** (no RNG at all; the `rng` parameter is accepted and ignored, `spread.py:180-181`), which matters to a project whose central claim is reproducibility, and it was written by the team specifically because the Bernoulli rule's directionality is diluted (`docs/repo-issues.md §3`, observed scar aspect 2.79 versus Bernoulli's ~1.0).

**This plan uses `spread.simulate_ros`.** Task 2 does not re-litigate that; it *measures both on the real Los Padres landscape* and writes the evidence down, so the choice is defended by numbers rather than by this paragraph. If Task 2's measurement contradicts the reasoning above, the finding is what ships — see Task 2's decision rule.

**4. The mesh is genuinely reusable across ignitions, and that is what makes 100 runs affordable.**

`build_mesh`, `build_attributes` and `edge_probabilities` take no ignition argument; only `simulate`'s `seed_xy`/`seed_cell` does. Measured: five ignitions on one mesh ran in 0.15 s total. Cell density is a stable 76–77 cells/km² at `d_min = 90`, so Los Padres (82.4 × 66.8 km ≈ 5,501 km²) is ≈420k cells and ≈180 s of mesh build — matching the 152 s already recorded in `docs/website-status.md`. One mesh, one hundred ignitions.

**5. Two different "kilometres from the corner" frames are in play, and they are not the same projection.**

The planner's nodes live in `place.LocalFrame`, an equirectangular km frame about the box centre (`place.py:53-74`). The fire Domain lives in **UTM metres** with the south-west corner at the origin (`realdata.py:32-33`). Over an 82 km box these differ by a real distance, and a benchmark that mixes them would report detection times for nodes that are not where it thinks they are. Worse, `NodePlan.nodes_lonlat` is offset half a bounding box by the `plan_region` bug (`docs/repo-issues.md §1.5`) and must never be round-tripped through. **Task 4 fixes one coordinate space — lon/lat — converts into it once explicitly, and a test asserts a known node lands where it should.**

**Also measured, and worth stating:** `fire.pick_seed_cell` snaps an ignition to the nearest *burnable* generator (`fire.py:124-131`) without reporting how far it moved. Over a region with water, rock and roads, some of 100 scattered ignitions will silently relocate — possibly kilometres. Task 3 records the displacement per ignition and Task 11 surfaces the worst one.

---

## File Structure

```
tools/bake/
  fire_domain.py       NEW — lon/lat box -> UTM bounds -> LANDFIRE rasters -> domain.Domain
  spread_probe.py      NEW — measures both spread rules on the real landscape (Task 2)
  ignitions.py         NEW — 100 reproducible ignition points, burnable-weighted
  bake_fire.py         NEW — the 100-run bake; emits the sparse arrival encoding
  _fire_grid.py        NEW — the coarse grid + the sparse arrival encoder (shared, testable)

web/
  public/data/los-padres/
    arrivals.bin       NEW (generated) — 100 ignitions, sparse (cellIndex, minutes) pairs
    arrivals.json      NEW (generated) — the index: offsets, ignition points, grid, provenance
  src/
    lib/
      arrivals.ts      NEW — decode arrivals.bin, the ArrivalSet type
      detection.ts     NEW — detection time for one placement over one ignition
      benchmarkB.ts    NEW — the 100-run distribution, medians, censoring
      eventLog.ts      NEW — the plain-language relay narrative for one ignition
      loadFire.ts      NEW — fetch + decode, absent-with-reason for unbaked regions
    state/useModelStore.ts   MODIFY — fireData, benchmarkB, selectedIgnition
    workers/place.worker.ts  MODIFY — run Benchmark B alongside A
    ui/
      copy.ts               MODIFY — detection sentences, the absence notice
      dotStripModel.ts      NEW — pure geometry for the dot strips (unit-testable)
      DetectionStrip.tsx    NEW — the SVG dot strips, legend, medians, table view
      EventLog.tsx          NEW — the event log
      DetectionPanel.tsx    NEW — assembles hero + tiles + strips + log
  tests/
    fireGrid.test.ts   NEW   arrivals.test.ts   NEW   detection.test.ts  NEW
    benchmarkB.test.ts NEW   eventLog.test.ts   NEW   dotStripModel.test.ts NEW
    loadFire.test.ts   NEW   copy.test.ts       MODIFY
    fixtures/arrivals.json NEW (generated)

docs/
  fire-model-choice.md   NEW — Task 2's measurement and the rule it selects
```

**Why the browser computes detection time rather than reading it.** A baked detection time would freeze the placement it was computed for, and the whole point of Plan 2 was that the placement moves when the reader moves a slider. Baking *arrival times* instead keeps the expensive, geography-locked part offline and leaves the cheap part — a nearest-cell query — live. It also means the detection radius stays a real control rather than a number chosen at bake time.

**Why a sparse encoding.** At 500 m the Los Padres box is 165 × 134 = 22,110 cells. A dense `float32` arrival raster per ignition would be 88 KB, and 100 of them 8.8 MB. But a two-hour fire burns a small fraction of an 82 × 67 km box, so storing only burnt cells as `(uint16 cellIndex, uint16 minutes)` pairs costs about 4 bytes per burnt cell. Task 4 Step 6 measures the real total; the design target is **under 1.5 MB**, against the 2.70 MB the region already ships.

---

### Task 1: The bounding-box → Domain bridge

**Files:**
- Create: `tools/bake/fire_domain.py`
- Test: `tools/bake/fire_domain.py` self-check (Step 5) — this task has no TypeScript surface

**Interfaces:**
- Consumes: `repo_modules("realdata", "domain", "catalog")`, `rasterio.warp.transform_bounds`.
- Produces:
  - `UTM_EPSG_LOS_PADRES = 32611`
  - `def utm_bounds(box_lonlat: tuple[float, float, float, float], epsg: int) -> tuple[float, float, float, float]` — returns `(west_m, south_m, east_m, north_m)`
  - `def build_domain(box_lonlat, *, epsg=32611, res_m=30.0, wind, year=2022, refresh=False) -> tuple[Domain, dict]` — the `dict` is provenance: raster shapes, services, the resolved UTM bounds, the fuel-class histogram

**Why this exists and why it is first.** Nothing downstream can run without a `Domain` over the Los Padres planner box, and no function in the repo produces one — `realdata.load_fire` is keyed on a FRAP fire record and needs three uninstalled packages. This task is the whole reason Plan 3 is not a two-day job.

- [ ] **Step 1: Confirm the signatures before writing any call**

```bash
cd "C:/Pyra NTE"
python -c "
import inspect, sys, os
sys.path.insert(0, os.path.abspath('tools'))
from bake._repo_import import repo_modules
realdata, domain, catalog, calibrate = repo_modules('realdata','domain','catalog','calibrate')
print(inspect.signature(realdata.fetch_raster))
print(inspect.signature(realdata.fbfm40_to_fuel))
print(inspect.signature(catalog.fbfm_service_for_year))
print(inspect.signature(calibrate.reference_d_ref))
print('ELEV_SERVICE', realdata.ELEV_SERVICE)
print('CACHE_DIR', realdata.CACHE_DIR)
print('Domain fields', [f for f in domain.Domain.__dataclass_fields__])
"
```

Expected: `fetch_raster(service, bounds, name, epsg=32611, res_m=30.0, refresh=False)`; `fbfm40_to_fuel(fbfm)`; `fbfm_service_for_year(year)` returning a `(service, vintage)` pair; `reference_d_ref()` taking no arguments. If any differ, fix the call site below rather than working around it. (The `sys.path.insert` here is a throwaway shell probe, not code being added to `tools/`.)

- [ ] **Step 2: Write the module**

Create `tools/bake/fire_domain.py`:

```python
"""Build a fire-model Domain over an arbitrary lon/lat box.

realdata.load_fire cannot do this: it is keyed on a CAL FIRE FRAP fire
record and derives its bounds from that fire's perimeter, and it imports
shapely/geopandas/pyproj, none of which are installed. What it has that we
need is fetch_raster, which takes UTM metre bounds -- so this module is the
missing lon/lat -> UTM -> rasters -> Domain leg, and nothing more.

Reprojection goes through rasterio.warp rather than pyproj, per
docs/repo-issues.md:113, because pyproj is not a dependency of this repo
and this plan does not add one.
"""

from __future__ import annotations

import numpy as np
from rasterio.warp import transform_bounds

from ._repo_import import repo_modules

realdata, domain, catalog = repo_modules("realdata", "domain", "catalog")

#: Los Padres sits in UTM zone 11N. realdata and catalog both default to it.
UTM_EPSG_LOS_PADRES = 32611


def utm_bounds(box_lonlat, epsg: int = UTM_EPSG_LOS_PADRES):
    """(west, south, east, north) in degrees -> the same in UTM metres.

    transform_bounds densifies the edges before projecting, so the returned
    box is the bounding box of the projected region rather than the
    projection of the four corners. Over 82 km those differ by hundreds of
    metres, and the difference is exactly the kind of quiet error that would
    put every node in the wrong place.
    """
    west, south, east, north = box_lonlat
    return transform_bounds("EPSG:4326", f"EPSG:{epsg}", west, south, east, north,
                            densify_pts=21)


def build_domain(box_lonlat, *, epsg: int = UTM_EPSG_LOS_PADRES,
                 res_m: float = 30.0, wind, year: int = 2022,
                 refresh: bool = False):
    """Fetch elevation and fuel over `box_lonlat` and assemble a Domain.

    Returns (Domain, provenance). Both rasters come back south-up-flipped
    from fetch_raster, which is the orientation domain.Domain expects, so
    neither is flipped again here -- flipping one and not the other is the
    classic way to build a landscape whose fuel does not sit on its terrain.
    """
    bounds = utm_bounds(box_lonlat, epsg)
    west, south, east, north = bounds
    width = float(east - west)
    height = float(north - south)

    elev = realdata.fetch_raster(realdata.ELEV_SERVICE, bounds, "lospadres_elev",
                                 epsg=epsg, res_m=res_m, refresh=refresh)
    fbfm_service, vintage = catalog.fbfm_service_for_year(year)
    fbfm = realdata.fetch_raster(fbfm_service, bounds,
                                 f"lospadres_fbfm40_lf{vintage}",
                                 epsg=epsg, res_m=res_m, refresh=refresh)
    if elev.shape != fbfm.shape:
        raise RuntimeError(
            f"elevation {elev.shape} and fuel {fbfm.shape} disagree; the two "
            "fetches resolved to different grids and the landscape would be "
            "fuel sitting on the wrong terrain"
        )

    fuel = realdata.fbfm40_to_fuel(fbfm)
    codes, counts = np.unique(fuel, return_counts=True)
    dom = domain.Domain(width=width, height=height,
                        elevation=np.asarray(elev, dtype=np.float64),
                        fuel=np.asarray(fuel), wind=wind)

    provenance = {
        "boxLonLat": [float(v) for v in box_lonlat],
        "utmEpsg": int(epsg),
        "utmBounds": [float(v) for v in bounds],
        "widthM": width, "heightM": height,
        "resM": float(res_m),
        "rasterShape": [int(elev.shape[0]), int(elev.shape[1])],
        "elevService": realdata.ELEV_SERVICE,
        "fbfmService": fbfm_service,
        "fbfmVintage": int(vintage),
        "fuelMix": {int(c): int(n) for c, n in zip(codes, counts)},
        "elevRange": [float(np.nanmin(elev)), float(np.nanmax(elev))],
    }
    return dom, provenance
```

- [ ] **Step 3: Confirm `domain.Domain`'s constructor accepts these keywords**

```bash
cd "C:/Pyra NTE"
python -c "
import inspect, sys, os
sys.path.insert(0, os.path.abspath('tools'))
from bake._repo_import import repo_modules
domain, = repo_modules('domain')
print(inspect.signature(domain.Domain.__init__))
"
```

If `Domain` is a dataclass whose field order or names differ from `width, height, elevation, fuel, wind`, adjust the constructor call in Step 2 to match the real names. Do not add fields it does not have.

- [ ] **Step 4: Run it against the real box**

```bash
cd "C:/Pyra NTE"
python -c "
import sys, os, json
sys.path.insert(0, os.path.abspath('tools'))
from bake.fire_domain import build_domain, utm_bounds
from bake._repo_import import repo_modules
domain, = repo_modules('domain')
box = (-120.3, 34.4, -119.4, 35.0)
print('utm', utm_bounds(box))
dom, prov = build_domain(box, wind=domain.Wind(speed=8.0, direction=90.0))
print(json.dumps({k: v for k, v in prov.items() if k != 'fuelMix'}, indent=1))
print('fuel classes', sorted(prov['fuelMix'].items(), key=lambda kv: -kv[1])[:6])
"
```

This downloads two LANDFIRE rasters on first run and caches them under `outputs/realdata/`. Expected: a UTM box roughly 82,000 × 67,000 m; a raster around 2,700 × 2,200 at 30 m; an elevation range plausible for the Santa Ynez range (roughly 0–1,500 m); and a fuel mix dominated by chaparral classes rather than by `ROCK`. **If the fuel mix is overwhelmingly `ROCK`, stop** — that is the out-of-CONUS NoData signature (Finding: `fbfm40_to_fuel` maps `c < 0` and `c > 300` to `ROCK`), and it means the fetch returned nothing rather than that Los Padres is bare rock.

If `domain.Wind` has a different constructor, read it with `inspect.signature` and use the real one.

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add tools/bake/fire_domain.py
git commit -F - <<'EOF'
feat(bake): build a fire Domain over an arbitrary lon/lat box

realdata.load_fire is keyed on a FRAP fire record and needs three packages
this repo does not install, so it cannot be pointed at the Los Padres
planner box. This is the missing leg: lon/lat -> UTM (via rasterio.warp,
not pyproj) -> LANDFIRE elevation and FBFM40 -> domain.Domain, with the
provenance recorded.

Both rasters come back south-up from fetch_raster and neither is flipped
again; the shapes are asserted equal so fuel cannot end up on the wrong
terrain.
EOF
```

---

### Task 2: Choose the spread rule, and write down why

**Files:**
- Create: `tools/bake/spread_probe.py`
- Create: `docs/fire-model-choice.md`

**Interfaces:**
- Consumes: `tools/bake/fire_domain.py:build_domain`, `repo_modules("mesh","attributes","fire","spread","calibrate","domain")`.
- Produces: `def probe(d_min: float = 90.0, t_end_min: float = 120.0, n_ignitions: int = 5) -> dict` and a `main()` printing JSON. No TypeScript surface.

**Why this task exists.** The two transition rules disagree about head rate of spread by roughly six times (86 m/min versus 14 m/min on a synthetic landscape). That is not a detail — with a 2 km detection radius, the fast rule reaches 10 km in two hours, every node in range sees the fire almost immediately, and the distribution this benchmark is built to show collapses to a flat line near zero. The slow rule keeps the fire a narrow downwind finger, and which nodes see it becomes genuinely selective. **The choice decides the headline number, so it is made by measurement on the real landscape and recorded, not asserted.**

**The decision rule, fixed in advance so the measurement cannot be rationalised afterwards.** Run both rules on the real Los Padres landscape over the same five ignitions. Then:

- If one rule produces a detection-time spread (P90 − P10 over the five ignitions, using a provisional uniform grid) that is **less than 5 minutes**, that rule cannot support a distribution benchmark and is rejected.
- Of the rules that survive, prefer the **deterministic** one (`spread.simulate_ros`), because this project's central claim is reproducibility and a stochastic rule would need its RNG stream pinned across a language boundary the way `RefRNG` had to be for `place.py`.
- If **both** are rejected, do not proceed to Task 3. Write the finding in `docs/fire-model-choice.md`, stop, and escalate: a detection-time benchmark that cannot separate two placements is not worth shipping, and Benchmark A already carries the Lab.

- [ ] **Step 1: Write the probe**

Create `tools/bake/spread_probe.py`:

```python
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
#: A coarse provisional grid standing in for a placement, purely so the
#: probe can report a DETECTION spread rather than a burnt-area spread.
PROBE_NODES = 24
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
    wind = domain.Wind(speed=8.0, direction=90.0)
    dom, prov = build_domain(LOS_PADRES, wind=wind)

    t0 = time.time()
    # clip_guard=False is mandatory -- the guard is a universal false
    # positive and its remedy imports shapely, which is not installed.
    m = mesh_m.build_mesh(np.random.default_rng(1), dom, d_min,
                          lloyd_iters=2, clip_guard=False)
    mesh_s = time.time() - t0

    d_ref = calibrate.reference_d_ref()
    params = dict(fire.PARAMS)
    params["t_end_min"] = t_end_min
    attrs = attributes.build_attributes(m, dom, dt_s=params["dt_s"], d_ref=d_ref)

    # A provisional uniform grid over the domain, only so detection spread
    # can be measured. This is NOT the benchmark's grid arm.
    cols = int(round(np.sqrt(PROBE_NODES * dom.width / dom.height)))
    rows = max(1, PROBE_NODES // max(cols, 1))
    node_xy = [((i + 0.5) / cols * dom.width, (j + 0.5) / rows * dom.height)
               for j in range(rows) for i in range(cols)]

    rng = np.random.default_rng(7)
    ignitions = [(float(rng.uniform(0.2, 0.8) * dom.width),
                  float(rng.uniform(0.2, 0.8) * dom.height))
                 for _ in range(n_ignitions)]

    out = {"meshSeconds": mesh_s, "cells": int(m.n), "dMin": d_min,
           "tEndMin": t_end_min, "provenance": prov, "rules": {}}

    p_edge = fire.edge_probabilities(attrs, wind, d_ref, params)
    for name in ("bernoulli", "ros"):
        times, areas, secs = [], [], []
        for k, xy in enumerate(ignitions):
            t0 = time.time()
            if name == "bernoulli":
                res = fire.simulate(m, attrs, wind, np.random.default_rng(100 + k),
                                    d_ref, seed_xy=xy, params=params, p_edge=p_edge)
            else:
                # NOTE the different signature: d_ref is 4th positional and
                # there is no rng in the loop position.
                res = spread.simulate_ros(m, attrs, wind, d_ref,
                                          seed_xy=xy, params=params)
            secs.append(time.time() - t0)
            am = res.arrival_min
            areas.append(float(np.nansum(attrs.cell_area[~np.isnan(am)]) / 1e6))
            times.append(_detection_minutes(m, am, node_xy, PROBE_DETECT_M))
        finite = [t for t in times if np.isfinite(t)]
        out["rules"][name] = {
            "detectionMinutes": times,
            "censored": int(len(times) - len(finite)),
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
```

- [ ] **Step 2: Run it**

```bash
cd "C:/Pyra NTE"
python -m tools.bake.spread_probe
```

This takes roughly four minutes: the 420k-cell mesh dominates (~180 s), then ten simulations. Record `meshSeconds`, `cells`, and for each rule the `spread`, `censored` count, `burntKm2` and `secondsPerRun`.

- [ ] **Step 3: Apply the decision rule and write it down**

Create `docs/fire-model-choice.md` containing: the exact command, the verbatim JSON output, the decision rule as stated above, which rule it selects, and this paragraph adapted to what was actually measured:

> The Bernoulli rule (`fire.simulate`) and the ROS rule (`spread.simulate_ros`) are both in the repository and they disagree about head rate of spread by roughly six times. Benchmark B reports detection time, so the rule is not an implementation detail — it decides whether the benchmark can distinguish two placements at all. This file records the measurement that chose one.

End the file with the obligation:

> Every detection-time number the site displays must name this rule. `web/tests/copy.test.ts` enforces it.

- [ ] **Step 4: Commit**

```bash
cd "C:/Pyra NTE"
git add tools/bake/spread_probe.py docs/fire-model-choice.md
git commit -F - <<'EOF'
feat(bake): measure both spread rules on the real landscape, and choose one

The two transition rules in this repo disagree about head rate of spread by
about six times. Detection time is the thing Benchmark B reports, so that
gap decides whether the benchmark separates two placements or measures node
geometry while looking like it measures fire. Rule chosen by measurement
against a decision rule fixed before the numbers were seen;
docs/fire-model-choice.md carries the output verbatim.
EOF
```

---

### Task 3: One hundred reproducible ignitions

**Files:**
- Create: `tools/bake/ignitions.py`

**Interfaces:**
- Consumes: `numpy`, a burnable mask derived from the Domain's fuel array.
- Produces:
  - `IGNITION_SEED = 20260731`
  - `def sample_ignitions(dom, n: int = 100, seed: int = IGNITION_SEED, margin_frac: float = 0.12) -> np.ndarray` — shape `(n, 2)`, **UTM metres from the domain's south-west corner**
  - `def snap_report(mesh, attrs, xy) -> list[dict]` — per ignition: the requested point, the seed cell actually used, and the distance between them

**Why the ignitions are weighted and inset.** Uniformly random points would put ignitions in the ocean and on bare rock, where `pick_seed_cell` silently relocates them (Finding). They would also put them against the domain edge, where a scar runs off the map and its arrival field is truncated — `sweep.py:96` has an `edge_margin` warning for exactly this. Sampling only burnable cells, inset from the boundary by 12%, removes both without hand-picking anything.

- [ ] **Step 1: Write the module**

Create `tools/bake/ignitions.py`:

```python
"""The 100 ignition points, chosen once and reproducibly.

The same points are fed to both placement arms. That is the whole basis of
the comparison: if the two arms saw different fires, the benchmark would be
measuring the fires.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from ._repo_import import repo_modules

attributes, = repo_modules("attributes")

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
    """
    fuel = np.asarray(dom.fuel)
    ny, nx = fuel.shape
    burnable = fuel != attributes.UNBURNABLE_FUEL if hasattr(
        attributes, "UNBURNABLE_FUEL") else fuel > 0

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
    # Cell centres. Row 0 is the SOUTH edge, matching domain.Domain.
    x = (cols + 0.5) / nx * dom.width
    y = (rows + 0.5) / ny * dom.height
    return np.column_stack([x, y]).astype(np.float64)


def snap_report(mesh, xy) -> list[dict]:
    """How far each ignition moved when snapped to a mesh generator.

    fire.pick_seed_cell snaps to the nearest BURNABLE generator and reports
    nothing. Over a landscape with water, rock and roads some of these will
    move a long way, and an ignition that silently relocated across a ridge
    is a different experiment from the one that was requested.
    """
    tree = cKDTree(mesh.points)
    dist, cell = tree.query(xy)
    return [
        {"requested": [float(a), float(b)], "cell": int(c), "shiftM": float(d)}
        for (a, b), c, d in zip(xy, cell, dist)
    ]
```

- [ ] **Step 2: Confirm the burnable test against the real module**

```bash
cd "C:/Pyra NTE"
python -c "
import sys, os
sys.path.insert(0, os.path.abspath('tools'))
from bake._repo_import import repo_modules
attributes, realdata = repo_modules('attributes','realdata')
print([n for n in dir(attributes) if 'BURN' in n.upper() or 'FUEL' in n.upper()])
print([n for n in dir(realdata) if 'ROCK' in n.upper() or 'FUEL' in n.upper()])
"
```

Replace the `hasattr` fallback in `sample_ignitions` with the real constant the modules expose (`ROCK`, `UNBURNABLE`, or whatever `fbfm40_to_fuel` writes for non-fuel). **Do not leave the fallback in.** A burnable test that is wrong in the permissive direction puts ignitions on rock and the whole run set becomes censored.

- [ ] **Step 3: Commit**

```bash
cd "C:/Pyra NTE"
git add tools/bake/ignitions.py
git commit -F - <<'EOF'
feat(bake): 100 reproducible ignitions on burnable, inset ground

Weighted by burnable cells and inset 12% from the edge: a uniform sample
puts ignitions in the Pacific, where pick_seed_cell silently relocates
them, and against the boundary, where the scar runs off the domain and its
arrival field is truncated. The snap displacement is recorded per ignition
so a point that moved across a ridge is visible rather than assumed.
EOF
```

---

### Task 4: The sparse arrival grid, and the bake

**Files:**
- Create: `tools/bake/_fire_grid.py`
- Create: `tools/bake/bake_fire.py`
- Create (generated): `web/public/data/los-padres/arrivals.bin`, `web/public/data/los-padres/arrivals.json`
- Test: `web/tests/fireGrid.test.ts`

**Interfaces:**
- Produces the on-disk contract every later task reads:
  - `arrivals.json` — `{ grid: { nx, ny, cellM, originLon, originLat, boxLonLat }, rule: string, detectRadiusBakedM: null, tEndMin: number, dMin: number, ignitions: Array<{ lon, lat, xM, yM, shiftM, burntCells, offset, count }>, params: object, provenance: object, generated: string }`
  - `arrivals.bin` — for each ignition in order, `count` records of `(uint16 cellIndex, uint16 arrivalMinutes)` little-endian, concatenated. `offset` in `arrivals.json` is the record index at which an ignition starts.
- Produces (Python): `class FireGrid` with `nx, ny, cell_m`, `def encode(mesh, arrival_min, grid) -> tuple[np.ndarray, np.ndarray]`

**Why `uint16` for the cell index.** The grid is 165 × 134 = 22,110 cells at 500 m, comfortably inside 65,535. Task 4 Step 3 asserts it rather than assuming it, because a grid refinement that pushed past 65,535 would wrap silently and scatter the fire across the map.

**Why arrival minutes are `uint16` too.** `t_end_min` is 120 by default. A `uint16` holds 65,535 minutes, so the encoding survives any simulation length this project will run, and 0 is a legitimate value (the ignition cell). **Unburnt cells are not stored at all** — absence is the encoding for "never burnt", which is why a sentinel is not needed and must not be introduced.

- [ ] **Step 1: Write the grid and encoder**

Create `tools/bake/_fire_grid.py`:

```python
"""Rasterise a mesh arrival field onto a coarse grid, sparsely.

The browser needs arrival times to compute detection time live, but it must
not download 100 dense rasters. A two-hour fire burns a small part of an
82x67 km box, so storing only the burnt cells costs about 4 bytes each.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

#: 500 m. With a 2 km detection radius that is four cells per radius, which
#: is fine; going finer multiplies the download by the square of the ratio
#: for accuracy the detection query cannot use.
DEFAULT_CELL_M = 500.0
#: uint16 cell indices. Assert, never assume.
MAX_CELLS = 65535


@dataclass(frozen=True)
class FireGrid:
    nx: int
    ny: int
    cell_m: float
    width_m: float
    height_m: float

    @staticmethod
    def over(width_m: float, height_m: float, cell_m: float = DEFAULT_CELL_M):
        nx = int(np.ceil(width_m / cell_m))
        ny = int(np.ceil(height_m / cell_m))
        if nx * ny > MAX_CELLS:
            raise RuntimeError(
                f"grid {nx}x{ny} = {nx * ny} cells exceeds uint16; either "
                f"coarsen cell_m or widen the index dtype -- do not let it wrap"
            )
        return FireGrid(nx, ny, float(cell_m), float(width_m), float(height_m))

    def centres(self):
        """(N, 2) cell centres in domain metres, row 0 at the SOUTH edge."""
        xs = (np.arange(self.nx) + 0.5) * self.width_m / self.nx
        ys = (np.arange(self.ny) + 0.5) * self.height_m / self.ny
        gx, gy = np.meshgrid(xs, ys)
        return np.column_stack([gx.ravel(), gy.ravel()])


def encode(mesh, arrival_min, grid: FireGrid, owners=None):
    """-> (cell_index uint16, minutes uint16) for burnt cells only.

    Nearest-generator lookup, the same rule metrics.RefGrid uses. `owners`
    is the precomputed nearest-generator index per grid cell -- hoist it out
    of the ignition loop, it does not depend on the ignition.
    """
    if owners is None:
        owners = cKDTree(mesh.points).query(grid.centres())[1]
    t = np.asarray(arrival_min, dtype=np.float64)[owners]
    burnt = np.isfinite(t)
    idx = np.flatnonzero(burnt).astype(np.uint16)
    mins = np.rint(t[burnt]).astype(np.uint16)
    return idx, mins


def owners_for(mesh, grid: FireGrid):
    """Nearest mesh generator per grid cell. Ignition-independent."""
    return cKDTree(mesh.points).query(grid.centres())[1]
```

- [ ] **Step 2: Write the bake**

Create `tools/bake/bake_fire.py`:

```python
"""Simulate 100 ignitions over Los Padres and emit the sparse arrival set.

    python -m tools.bake.bake_fire

One mesh, one attribute set, one hundred ignitions -- the mesh takes no
ignition argument, so it is built once and reused, which is what makes this
affordable at all (about 180 s of mesh plus a few seconds per run).
"""

from __future__ import annotations

import datetime as dt
import json
import os
import time

import numpy as np

from ._repo_import import repo_modules
from .fire_domain import build_domain, UTM_EPSG_LOS_PADRES
from .ignitions import IGNITION_SEED, sample_ignitions, snap_report
from ._fire_grid import DEFAULT_CELL_M, FireGrid, encode, owners_for

mesh_m, attributes, fire, spread, calibrate, domain = repo_modules(
    "mesh", "attributes", "fire", "spread", "calibrate", "domain")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(
    HERE, "..", "..", "web", "public", "data", "los-padres"))

LOS_PADRES = (-120.3, 34.4, -119.4, 35.0)
D_MIN = 90.0
T_END_MIN = 120.0
WIND_SPEED = 8.0
WIND_DIR = 90.0
MESH_SEED = 1
#: Set by Task 2's measurement. Read docs/fire-model-choice.md before changing.
RULE = "ros"


def main(argv=None) -> int:
    wind = domain.Wind(speed=WIND_SPEED, direction=WIND_DIR)
    dom, prov = build_domain(LOS_PADRES, wind=wind, epsg=UTM_EPSG_LOS_PADRES)

    t0 = time.time()
    m = mesh_m.build_mesh(np.random.default_rng(MESH_SEED), dom, D_MIN,
                          lloyd_iters=2, clip_guard=False)
    mesh_s = time.time() - t0
    print(f"mesh: {m.n} cells in {mesh_s:.0f}s")

    d_ref = calibrate.reference_d_ref()
    params = dict(fire.PARAMS)
    params["t_end_min"] = T_END_MIN
    attrs = attributes.build_attributes(m, dom, dt_s=params["dt_s"], d_ref=d_ref)

    grid = FireGrid.over(dom.width, dom.height, DEFAULT_CELL_M)
    owners = owners_for(m, grid)
    xy = sample_ignitions(dom, n=100)
    snaps = snap_report(m, xy)

    west, south, east, north = LOS_PADRES
    records, entries = [], []
    offset = 0
    for k, (x, y) in enumerate(xy):
        res = spread.simulate_ros(m, attrs, wind, d_ref,
                                  seed_xy=(float(x), float(y)), params=params)
        idx, mins = encode(m, res.arrival_min, grid, owners=owners)
        records.append(np.column_stack([idx, mins]).astype("<u2"))
        entries.append({
            "lon": west + (x / dom.width) * (east - west),
            "lat": south + (y / dom.height) * (north - south),
            "xM": float(x), "yM": float(y),
            "shiftM": snaps[k]["shiftM"],
            "burntCells": int(idx.size),
            "offset": offset, "count": int(idx.size),
        })
        offset += int(idx.size)
        if (k + 1) % 10 == 0:
            print(f"  {k + 1}/100 ignitions, {offset} records so far")

    os.makedirs(OUT_DIR, exist_ok=True)
    blob = np.concatenate(records) if records else np.zeros((0, 2), dtype="<u2")
    blob.astype("<u2").tofile(os.path.join(OUT_DIR, "arrivals.bin"))

    meta = {
        "grid": {"nx": grid.nx, "ny": grid.ny, "cellM": grid.cell_m,
                 "boxLonLat": list(LOS_PADRES),
                 "widthM": dom.width, "heightM": dom.height},
        "rule": RULE,
        "tEndMin": T_END_MIN,
        "dMin": D_MIN,
        "meshCells": int(m.n),
        "meshSeed": MESH_SEED,
        "ignitionSeed": IGNITION_SEED,
        "wind": {"speedMs": WIND_SPEED, "directionDeg": WIND_DIR},
        "dRef": float(d_ref),
        "params": {k: (float(v) if isinstance(v, (int, float)) else v)
                   for k, v in params.items()},
        "ignitions": entries,
        "provenance": prov,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    with open(os.path.join(OUT_DIR, "arrivals.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)

    size = os.path.getsize(os.path.join(OUT_DIR, "arrivals.bin"))
    print(f"wrote {offset} records, {size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Run the bake**

```bash
cd "C:/Pyra NTE"
python -m tools.bake.bake_fire
```

Expected: a mesh line reporting roughly 420,000 cells in roughly 180 s, progress every ten ignitions, and a final size. **The design target is under 1.5 MB.** If it comes out materially larger, do not ship it and do not silently coarsen — report the measured size and the burnt-cell counts, then either raise `cellM` (and re-run Step 3's assertions) or reduce `t_end_min`, and record which was chosen and why in the commit message.

If **every** ignition reports `burntCells` in single digits, the ROS rule is barely spreading on this landscape; stop and revisit Task 2's measurement rather than proceeding to build a benchmark on non-events.

- [ ] **Step 4: Write the artifact-contract test**

Create `web/tests/fireGrid.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = join(dirname(fileURLToPath(import.meta.url)),
                 '..', 'public', 'data', 'los-padres')

function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

const meta = JSON.parse(readFileSync(join(DIR, 'arrivals.json'), 'utf-8'))

describe('baked arrival set', () => {
  it('names the spread rule it was produced by', () => {
    // Every detection number the site shows has to state this, and it must
    // come from the bake rather than from a string in the UI.
    expect(typeof meta.rule).toBe('string')
    expect(meta.rule.length).toBeGreaterThan(2)
    expect(meta.tEndMin).toBeGreaterThan(0)
    expect(meta.dMin).toBeGreaterThan(0)
    expect(meta.meshCells).toBeGreaterThan(100000)
  })

  it('ships exactly 100 ignitions, each inside the region box', () => {
    expect(meta.ignitions).toHaveLength(100)
    const [w, s, e, n] = meta.grid.boxLonLat
    for (const ig of meta.ignitions) {
      expect(ig.lon).toBeGreaterThanOrEqual(w)
      expect(ig.lon).toBeLessThanOrEqual(e)
      expect(ig.lat).toBeGreaterThanOrEqual(s)
      expect(ig.lat).toBeLessThanOrEqual(n)
    }
  })

  it('lays out arrivals.bin exactly as the offsets claim', () => {
    const raw = bytes('arrivals.bin')
    expect(raw.length % 4).toBe(0)
    const total = raw.length / 4
    let expected = 0
    for (const ig of meta.ignitions) {
      expect(ig.offset).toBe(expected)
      expected += ig.count
    }
    expect(total).toBe(expected)
  })

  it('keeps every cell index inside the declared grid', () => {
    const raw = bytes('arrivals.bin')
    const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
    const cells = meta.grid.nx * meta.grid.ny
    expect(cells).toBeLessThanOrEqual(65535)
    let worst = -1
    for (let i = 0; i < u16.length; i += 2) worst = Math.max(worst, u16[i])
    expect(worst).toBeLessThan(cells)
  })

  it('keeps every arrival time inside the simulated window', () => {
    const raw = bytes('arrivals.bin')
    const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
    let worst = -1
    for (let i = 1; i < u16.length; i += 2) worst = Math.max(worst, u16[i])
    expect(worst).toBeLessThanOrEqual(meta.tEndMin)
  })

  it('burns something on every ignition', () => {
    // A run that burnt nothing is not an ignition, it is a censored row
    // pretending to be one, and it would drag the median toward censoring
    // for a reason that has nothing to do with the placement.
    for (const ig of meta.ignitions) expect(ig.burntCells).toBeGreaterThan(0)
  })

  it('records how far each ignition was snapped', () => {
    for (const ig of meta.ignitions) {
      expect(Number.isFinite(ig.shiftM)).toBe(true)
      expect(ig.shiftM).toBeGreaterThanOrEqual(0)
    }
  })
})
```

**The mutation each test catches.** *Rule named:* a UI that hardcodes "ROS" while the bake used Bernoulli. *Ignition count and bounds:* an ignition sampler that escaped the box or dropped runs. *Offset layout:* an off-by-one in the concatenation, which would shear every ignition after the first. *Cell index range:* a `uint16` wrap from a refined grid — the exact failure `FireGrid.over` asserts against. *Arrival range:* a unit slip between steps and minutes. *Burnt something:* an all-censored bake. *Snap recorded:* dropping the displacement, which hides ignitions that moved across a ridge.

- [ ] **Step 5: Run the tests, then the whole suite**

```bash
cd web && npm test -- fireGrid
```

Expected: PASS, 7 tests. Then `npm test` (expect 276 passing) and `npm run build`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Pyra NTE"
git add tools/bake/_fire_grid.py tools/bake/bake_fire.py \
        web/public/data/los-padres/arrivals.bin \
        web/public/data/los-padres/arrivals.json \
        web/tests/fireGrid.test.ts
git commit -F - <<'EOF'
feat(bake): 100 simulated ignitions, stored as sparse arrival times

One mesh, one hundred ignitions -- build_mesh takes no ignition argument,
so the 420k-cell mesh is built once and reused, which is what makes this
affordable.

What ships is arrival times, not detection times. A baked detection time
would freeze the placement it was computed for, and the placement moves
every time the reader moves a weight slider. Arrival times keep the
expensive, geography-locked half offline and leave the cheap half live, so
Benchmark B responds to the sliders exactly as Benchmark A does -- and the
detection radius stays a real control.

Only burnt cells are stored; absence IS the encoding for never-burnt, so
there is no sentinel to misread.
EOF
```

---

### Task 5: Decode the arrival set in the browser

**Files:**
- Create: `web/src/lib/arrivals.ts`
- Create: `web/src/lib/loadFire.ts`
- Test: `web/tests/arrivals.test.ts`, `web/tests/loadFire.test.ts`

**Interfaces:**
- Produces:
  - `interface FireGridSpec { nx: number; ny: number; cellM: number; widthM: number; heightM: number; boxLonLat: [number, number, number, number] }`
  - `interface Ignition { lon: number; lat: number; xM: number; yM: number; shiftM: number; burntCells: number; offset: number; count: number }`
  - `interface ArrivalSet { grid: FireGridSpec; rule: string; tEndMin: number; ignitions: Ignition[]; cells: Uint16Array; minutes: Uint16Array; meta: Record<string, unknown> }`
  - `function decodeArrivals(meta: unknown, buf: ArrayBuffer): ArrivalSet`
  - `function arrivalsFor(set: ArrivalSet, i: number): { cells: Uint16Array; minutes: Uint16Array }`
  - `function loadFireData(region: string, fetchImpl?: typeof fetch): Promise<ArrivalSet | null>` — **`null`, not a throw, when the region has no fire bake**

**Why `loadFireData` returns `null` rather than throwing.** Seven of eight regions will never have this file, and that is a designed state, not an error. A throw would have to be caught and translated back into "absent" at every call site; returning `null` makes the absence a value the type system carries.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/arrivals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodeArrivals, arrivalsFor } from '../src/lib/arrivals'

const DIR = join(dirname(fileURLToPath(import.meta.url)),
                 '..', 'public', 'data', 'los-padres')

function load() {
  const meta = JSON.parse(readFileSync(join(DIR, 'arrivals.json'), 'utf-8'))
  const b = readFileSync(join(DIR, 'arrivals.bin'))
  return decodeArrivals(meta, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

describe('decodeArrivals', () => {
  const set = load()

  it('splits the interleaved blob into parallel cell and minute arrays', () => {
    expect(set.cells.length).toBe(set.minutes.length)
    const total = set.ignitions.reduce((n, ig) => n + ig.count, 0)
    expect(set.cells.length).toBe(total)
  })

  it('carries the rule and window forward for the copy layer', () => {
    expect(set.rule.length).toBeGreaterThan(2)
    expect(set.tEndMin).toBeGreaterThan(0)
  })

  it('rejects a blob whose length disagrees with the offsets', () => {
    const meta = JSON.parse(readFileSync(join(DIR, 'arrivals.json'), 'utf-8'))
    expect(() => decodeArrivals(meta, new ArrayBuffer(8)))
      .toThrow(/arrivals\.bin/)
  })

  it('slices one ignition without copying its neighbours', () => {
    const a = arrivalsFor(set, 0)
    expect(a.cells.length).toBe(set.ignitions[0].count)
    const b = arrivalsFor(set, 1)
    expect(b.cells.length).toBe(set.ignitions[1].count)
    // The second ignition starts where the first ended, so a decoder that
    // ignored `offset` would return the first ignition twice.
    if (set.ignitions[0].count !== set.ignitions[1].count) {
      expect(a.cells.length).not.toBe(b.cells.length)
    }
  })

  it('puts the ignition cell at time zero in its own run', () => {
    for (let i = 0; i < 5; i++) {
      const { minutes } = arrivalsFor(set, i)
      let min = Infinity
      for (const m of minutes) min = Math.min(min, m)
      expect(min).toBe(0)
    }
  })
})
```

Create `web/tests/loadFire.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadFireData } from '../src/lib/loadFire'

describe('loadFireData', () => {
  it('returns null for a region with no fire bake, rather than throwing', async () => {
    const f = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    await expect(loadFireData('congo-basin', f)).resolves.toBeNull()
  })

  it('propagates a real server failure instead of hiding it as absence', async () => {
    // A 500 is not "this region has no fire model", it is a broken deploy,
    // and silently rendering "not available here" would hide it.
    const f = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    await expect(loadFireData('los-padres', f)).rejects.toThrow(/500/)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && npm test -- arrivals loadFire
```

Expected: FAIL — cannot resolve `../src/lib/arrivals`.

- [ ] **Step 3: Implement**

Create `web/src/lib/arrivals.ts`:

```ts
export interface FireGridSpec {
  nx: number
  ny: number
  cellM: number
  widthM: number
  heightM: number
  boxLonLat: [number, number, number, number]
}

export interface Ignition {
  lon: number
  lat: number
  xM: number
  yM: number
  /** How far pick_seed_cell moved this ignition, in metres. */
  shiftM: number
  burntCells: number
  offset: number
  count: number
}

export interface ArrivalSet {
  grid: FireGridSpec
  /** The spread rule the bake used. Every displayed number must name it. */
  rule: string
  tEndMin: number
  ignitions: Ignition[]
  /** Grid cell index per record, all ignitions concatenated. */
  cells: Uint16Array
  /** Arrival time in minutes per record, parallel to `cells`. */
  minutes: Uint16Array
  meta: Record<string, unknown>
}

/**
 * Split the interleaved `(cellIndex, minutes)` blob into two parallel
 * arrays.
 *
 * Only burnt cells are stored, and absence is the encoding for never-burnt
 * — there is no sentinel, so nothing here can mistake a large number for
 * "unburned".
 */
export function decodeArrivals(meta: unknown, buf: ArrayBuffer): ArrivalSet {
  const m = meta as {
    grid: FireGridSpec; rule: string; tEndMin: number; ignitions: Ignition[]
  }
  const expected = m.ignitions.reduce((n, ig) => n + ig.count, 0)
  const records = buf.byteLength / 4
  if (records !== expected) {
    throw new Error(
      `arrivals.bin holds ${records} records, the index claims ${expected}`,
    )
  }
  const u16 = new Uint16Array(buf)
  const cells = new Uint16Array(expected)
  const minutes = new Uint16Array(expected)
  for (let i = 0; i < expected; i++) {
    cells[i] = u16[2 * i]
    minutes[i] = u16[2 * i + 1]
  }
  return {
    grid: m.grid, rule: m.rule, tEndMin: m.tEndMin, ignitions: m.ignitions,
    cells, minutes, meta: meta as Record<string, unknown>,
  }
}

/** The records for one ignition. Views, not copies. */
export function arrivalsFor(set: ArrivalSet, i: number) {
  const ig = set.ignitions[i]
  if (!ig) throw new Error(`no ignition ${i}; the set holds ${set.ignitions.length}`)
  return {
    cells: set.cells.subarray(ig.offset, ig.offset + ig.count),
    minutes: set.minutes.subarray(ig.offset, ig.offset + ig.count),
  }
}
```

Create `web/src/lib/loadFire.ts`:

```ts
import { decodeArrivals, type ArrivalSet } from './arrivals'

/**
 * Fetch a region's baked fire runs, or `null` if it has none.
 *
 * Seven of the eight regions will never have this file, because the fire
 * model is validated in California only. That is a designed state, not a
 * failure, so it is a value the caller can hold rather than an exception it
 * has to translate. A non-404 failure IS an error and is thrown — a broken
 * deploy must not render as "not available in this region".
 */
export async function loadFireData(
  region: string, fetchImpl: typeof fetch = fetch,
): Promise<ArrivalSet | null> {
  const base = `/data/${region}`
  const metaRes = await fetchImpl(`${base}/arrivals.json`)
  if (metaRes.status === 404) return null
  if (!metaRes.ok) {
    throw new Error(`GET ${base}/arrivals.json failed: ${metaRes.status}`)
  }
  const meta = await metaRes.json()

  const binRes = await fetchImpl(`${base}/arrivals.bin`)
  if (!binRes.ok) {
    throw new Error(`GET ${base}/arrivals.bin failed: ${binRes.status}`)
  }
  return decodeArrivals(meta, await binRes.arrayBuffer())
}
```

- [ ] **Step 4: Run the tests**

```bash
cd web && npm test -- arrivals loadFire
```

Expected: PASS, 7 tests. Then `npm test` (expect 283 passing) and `npm run build`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/arrivals.ts web/src/lib/loadFire.ts \
        web/tests/arrivals.test.ts web/tests/loadFire.test.ts
git commit -F - <<'EOF'
feat(web): decode the baked arrival set, absent-not-broken off California

loadFireData returns null for a region with no fire bake, because seven of
eight regions are a designed absence rather than a failure, and a throw
would have to be translated back into "absent" at every call site. A
non-404 still throws: a broken deploy must not render as "not available in
this region".
EOF
```

---

### Task 6: Detection time for one placement over one ignition

**Files:**
- Create: `web/src/lib/detection.ts`
- Test: `web/tests/detection.test.ts`

**Interfaces:**
- Consumes: `ArrivalSet`, `arrivalsFor` (`arrivals.ts`); `RegionMeta` (`loadRegion.ts`).
- Produces:
  - `interface DetectionResult { minutes: number | null; ignitionIndex: number; nodeIndex: number | null; cellIndex: number | null }` — `minutes === null` means **censored**: the fire was never seen within the simulated window
  - `function cellCentreKm(grid: FireGridSpec, cellIndex: number): [number, number]`
  - `function detectionTime(set: ArrivalSet, i: number, nodesKm: Float64Array, detectKm: number): DetectionResult`

**The definition this task commits to, stated exactly.** *Detection time is the earliest arrival minute among all grid cells that burnt and lie within `detectKm` of at least one node.* It is not the time the fire reaches a node, and it is not the time a node's own cell burns — a rod detects fire it can see, at a distance, which is the whole premise of the hardware.

**Censoring is a first-class outcome, not a large number.** If no node ever has fire within range inside the simulated window, the run is censored and `minutes` is `null`. A censored run must never be silently replaced by `tEndMin`, because a median computed over `tEndMin` substitutes for censoring is not a median of anything — it is a number that moves when the simulation window changes. Task 7 handles censored runs explicitly.

**Coordinates.** `nodesKm` is the flat `[x, y]` pair array the placement pipeline already produces, in `place.LocalFrame` kilometres from the region's **south-west corner**. The arrival grid is in domain metres from the same corner but in **UTM**. Over an 82 km box these are not the same frame (Finding 5). This task therefore converts the grid's cell centres into the *same* frame the nodes use — via the region's own width/height in km, which both sides agree on — and a test pins a known cell to a known kilometre position.

- [ ] **Step 1: Write the failing test**

Create `web/tests/detection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cellCentreKm, detectionTime } from '../src/lib/detection'
import type { ArrivalSet, FireGridSpec } from '../src/lib/arrivals'

const grid: FireGridSpec = {
  nx: 4, ny: 3, cellM: 1000,
  widthM: 4000, heightM: 3000,
  boxLonLat: [0, 0, 1, 1],
}

/** A 4x3 grid. Ignition 0 burns cells 0,1,2 at 0,10,20 min. */
function toy(): ArrivalSet {
  return {
    grid,
    rule: 'ros',
    tEndMin: 120,
    ignitions: [
      { lon: 0, lat: 0, xM: 500, yM: 500, shiftM: 0, burntCells: 3, offset: 0, count: 3 },
      { lon: 0, lat: 0, xM: 500, yM: 500, shiftM: 0, burntCells: 1, offset: 3, count: 1 },
    ],
    cells: Uint16Array.from([0, 1, 2, 11]),
    minutes: Uint16Array.from([0, 10, 20, 5]),
    meta: {},
  }
}

describe('cellCentreKm', () => {
  it('puts cell 0 at the south-west corner, half a cell in', () => {
    expect(cellCentreKm(grid, 0)).toEqual([0.5, 0.5])
  })

  it('advances along the row before wrapping to the next row north', () => {
    // Row 0 is the SOUTH edge, matching every other raster in this project.
    expect(cellCentreKm(grid, 1)).toEqual([1.5, 0.5])
    expect(cellCentreKm(grid, 4)).toEqual([0.5, 1.5])
    expect(cellCentreKm(grid, 11)).toEqual([3.5, 2.5])
  })
})

describe('detectionTime', () => {
  const set = toy()

  it('returns the earliest burnt cell within range of any node', () => {
    // A node at (1.6, 0.5) is 0.1 km from cell 1 (10 min) and 1.1 km from
    // cell 0 (0 min). At a 0.5 km radius only cell 1 is visible.
    const r = detectionTime(set, 0, Float64Array.from([1.6, 0.5]), 0.5)
    expect(r.minutes).toBe(10)
    expect(r.cellIndex).toBe(1)
    expect(r.nodeIndex).toBe(0)
  })

  it('sees the earlier cell once the radius reaches it', () => {
    const r = detectionTime(set, 0, Float64Array.from([1.6, 0.5]), 1.5)
    expect(r.minutes).toBe(0)
    expect(r.cellIndex).toBe(0)
  })

  it('censors a run no node ever sees, rather than returning a big number', () => {
    // Nothing burns near (3.5, 2.5) in ignition 0.
    const r = detectionTime(set, 0, Float64Array.from([3.5, 2.5]), 0.4)
    expect(r.minutes).toBeNull()
    expect(r.cellIndex).toBeNull()
    expect(r.nodeIndex).toBeNull()
  })

  it('reports which node saw it when several are in range', () => {
    const nodes = Float64Array.from([3.5, 2.5, 1.6, 0.5])
    const r = detectionTime(set, 0, nodes, 1.5)
    expect(r.nodeIndex).toBe(1)
  })

  it('reads only its own ignition', () => {
    // Cell 11 burns at 5 min, but only in ignition 1. A detector that
    // ignored `offset` would find it in ignition 0 and report 5.
    const r0 = detectionTime(set, 0, Float64Array.from([3.5, 2.5]), 1.0)
    expect(r0.minutes).toBeNull()
    const r1 = detectionTime(set, 1, Float64Array.from([3.5, 2.5]), 1.0)
    expect(r1.minutes).toBe(5)
  })

  it('censors when there are no nodes at all', () => {
    expect(detectionTime(set, 0, new Float64Array(0), 5).minutes).toBeNull()
  })
})
```

**The mutation each test catches.** *Cell centre:* a row-major/column-major swap or a north-up flip, which would mirror every fire. *Earliest in range:* taking the nearest cell rather than the earliest, which is the intuitive-but-wrong reading of "detection". *Radius:* an off-by-one-cell rounding that quietly widens the radius. *Censoring:* substituting `tEndMin`, which would make the median a function of the simulation window. *Node index:* reporting the first node rather than the one that actually saw it, which would make the event log lie. *Own ignition:* ignoring `offset` — the same shear the artifact test guards on the Python side.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npm test -- detection
```

Expected: FAIL — cannot resolve `../src/lib/detection`.

- [ ] **Step 3: Implement**

Create `web/src/lib/detection.ts`:

```ts
import { arrivalsFor, type ArrivalSet, type FireGridSpec } from './arrivals'

export interface DetectionResult {
  /** Minutes until first seen, or null when the run was never detected. */
  minutes: number | null
  ignitionIndex: number
  /** Which node saw it first, or null when censored. */
  nodeIndex: number | null
  /** Which grid cell was seen, or null when censored. */
  cellIndex: number | null
}

/**
 * Cell centre in kilometres from the region's south-west corner — the same
 * frame `place.LocalFrame` puts the nodes in.
 *
 * Row 0 is the SOUTH edge, matching risk.bin, mask.bin and every other
 * raster in this project. Getting that backwards mirrors every fire
 * vertically, which looks entirely plausible and is completely wrong.
 */
export function cellCentreKm(grid: FireGridSpec, cellIndex: number): [number, number] {
  const col = cellIndex % grid.nx
  const row = Math.floor(cellIndex / grid.nx)
  return [
    ((col + 0.5) / grid.nx) * (grid.widthM / 1000),
    ((row + 0.5) / grid.ny) * (grid.heightM / 1000),
  ]
}

/**
 * The earliest minute at which any node has burning ground within
 * `detectKm`.
 *
 * This is deliberately NOT "when the fire reaches a node". A rod detects
 * fire it can see, at a distance — that is what the hardware is for, and
 * measuring arrival at the node itself would understate every network by
 * roughly the detection radius divided by the rate of spread.
 *
 * A run no node ever sees is CENSORED and returns null. It must never be
 * reported as `tEndMin`: a median taken over a censoring substitute is a
 * function of how long the simulation happened to run.
 */
export function detectionTime(
  set: ArrivalSet, i: number, nodesKm: Float64Array, detectKm: number,
): DetectionResult {
  const { cells, minutes } = arrivalsFor(set, i)
  const nNodes = nodesKm.length / 2
  const r2 = detectKm * detectKm

  let best = Infinity
  let bestCell: number | null = null
  let bestNode: number | null = null

  for (let k = 0; k < cells.length; k++) {
    const t = minutes[k]
    // Records are not sorted by time, so this cannot break early on the
    // first hit — but it can skip anything that could not improve.
    if (t >= best) continue
    const [cx, cy] = cellCentreKm(set.grid, cells[k])
    for (let n = 0; n < nNodes; n++) {
      const dx = nodesKm[2 * n] - cx
      const dy = nodesKm[2 * n + 1] - cy
      if (dx * dx + dy * dy <= r2) {
        best = t
        bestCell = cells[k]
        bestNode = n
        break
      }
    }
  }

  return {
    minutes: bestCell === null ? null : best,
    ignitionIndex: i,
    nodeIndex: bestNode,
    cellIndex: bestCell,
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd web && npm test -- detection
```

Expected: PASS, 10 tests. Then `npm test` (expect 293 passing) and `npm run build`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/detection.ts web/tests/detection.test.ts
git commit -F - <<'EOF'
feat(web): detection time as the first burnt cell any node can see

Detection is fire within detectKm of a node, not fire arriving AT a node --
the rods see at a distance, and measuring arrival at the node would
understate every network by roughly the radius over the rate of spread.

A run no node sees is censored and returns null, never tEndMin. A median
taken over a censoring substitute is a function of how long the simulation
happened to run, which is not a property of the placement.
EOF
```

---

### Task 7: Benchmark B — the 100-run distribution

**Files:**
- Create: `web/src/lib/benchmarkB.ts`
- Test: `web/tests/benchmarkB.test.ts`

**Interfaces:**
- Consumes: `detectionTime`, `DetectionResult` (`detection.ts`); `ArrivalSet` (`arrivals.ts`); `uniformGrid`, `capToCommonCount` (`grid.ts`).
- Produces:
  - `interface ArmResult { key: 'pyra' | 'uniform'; label: string; detections: DetectionResult[]; detected: number[]; censored: number; medianMinutes: number | null; p10: number | null; p90: number | null; scoredNodes: number }`
  - `interface BenchmarkBResult { arms: ArmResult[]; ignitions: number; detectKm: number; rule: string; tEndMin: number; deltaMedianMinutes: number | null; bothCensored: number }`
  - `function median(xs: number[]): number | null`
  - `function runBenchmarkB(args: { set: ArrivalSet; nodesKm: Float64Array; widthKm: number; heightKm: number; mask: Field; detectKm: number }): BenchmarkBResult`

**Fairness, identical to Benchmark A.** Both arms are capped to the same realised node count with `capToCommonCount`, and both are fed **the same 100 ignitions**. If the two arms saw different fires the benchmark would be measuring the fires. `ArmResult.scoredNodes` reports what was actually scored, and the copy says "capped to the same realised count", never "identical node count".

**Censoring, stated exactly.** The median is taken over **detected runs only**, and `censored` is reported alongside it — always, not only when non-zero. Two medians computed over different numbers of detected runs are not directly comparable, and the copy layer (Task 10) must say so whenever the censored counts differ. `bothCensored` counts ignitions neither arm saw; those say nothing about placement and are reported separately.

- [ ] **Step 1: Write the failing test**

Create `web/tests/benchmarkB.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { median, runBenchmarkB } from '../src/lib/benchmarkB'
import type { ArrivalSet, FireGridSpec } from '../src/lib/arrivals'
import type { Field } from '../src/lib/types'

const grid: FireGridSpec = {
  nx: 10, ny: 10, cellM: 1000, widthM: 10000, heightM: 10000,
  boxLonLat: [0, 0, 1, 1],
}

/** Four ignitions, each burning one column of cells at increasing times. */
function toy(): ArrivalSet {
  const cells: number[] = []
  const minutes: number[] = []
  const ignitions = []
  let offset = 0
  for (let k = 0; k < 4; k++) {
    const count = 10
    for (let row = 0; row < 10; row++) {
      cells.push(row * 10 + k * 2)
      minutes.push(row * 5)
    }
    ignitions.push({
      lon: 0, lat: 0, xM: 0, yM: 0, shiftM: 0,
      burntCells: count, offset, count,
    })
    offset += count
  }
  return {
    grid, rule: 'ros', tEndMin: 120, ignitions,
    cells: Uint16Array.from(cells), minutes: Uint16Array.from(minutes),
    meta: {},
  }
}

const allBurnable: Field = {
  nx: 10, ny: 10, data: new Float32Array(100).fill(1),
}

describe('median', () => {
  it('is null for an empty sample rather than NaN', () => {
    expect(median([])).toBeNull()
  })

  it('averages the middle pair on an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([3, 1, 2])).toBe(2)
  })
})

describe('runBenchmarkB', () => {
  const set = toy()
  const nodesKm = Float64Array.from([0.5, 0.5, 2.5, 0.5, 4.5, 0.5, 6.5, 0.5])

  const r = runBenchmarkB({
    set, nodesKm, widthKm: 10, heightKm: 10,
    mask: allBurnable, detectKm: 1.0,
  })

  it('runs every ignition through both arms', () => {
    expect(r.ignitions).toBe(4)
    expect(r.arms).toHaveLength(2)
    for (const arm of r.arms) expect(arm.detections).toHaveLength(4)
  })

  it('scores both arms on the same realised node count', () => {
    const [a, b] = r.arms
    expect(a.scoredNodes).toBe(b.scoredNodes)
    expect(a.scoredNodes).toBeGreaterThan(0)
  })

  it('carries the rule and window through for the copy layer', () => {
    expect(r.rule).toBe('ros')
    expect(r.tEndMin).toBe(120)
    expect(r.detectKm).toBe(1.0)
  })

  it('takes the median over detected runs only, and reports the censored count', () => {
    for (const arm of r.arms) {
      expect(arm.detected.length + arm.censored).toBe(4)
      if (arm.detected.length === 0) expect(arm.medianMinutes).toBeNull()
      else expect(arm.medianMinutes).not.toBeNull()
    }
  })

  it('censors everything when the radius cannot reach any fire', () => {
    const tiny = runBenchmarkB({
      set, nodesKm: Float64Array.from([9.5, 9.5]),
      widthKm: 10, heightKm: 10, mask: allBurnable, detectKm: 0.1,
    })
    for (const arm of tiny.arms) {
      expect(arm.medianMinutes).toBeNull()
      expect(arm.censored).toBeGreaterThan(0)
    }
    expect(tiny.deltaMedianMinutes).toBeNull()
  })

  it('reports no delta when either arm has no median', () => {
    // A delta against a missing median is not zero and is not a number; a
    // benchmark that returned 0 here would read as "the two are equal".
    const tiny = runBenchmarkB({
      set, nodesKm: Float64Array.from([9.5, 9.5]),
      widthKm: 10, heightKm: 10, mask: allBurnable, detectKm: 0.1,
    })
    expect(tiny.deltaMedianMinutes).toBeNull()
  })

  it('feeds both arms the same ignitions', () => {
    const [a, b] = r.arms
    for (let i = 0; i < 4; i++) {
      expect(a.detections[i].ignitionIndex).toBe(i)
      expect(b.detections[i].ignitionIndex).toBe(i)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npm test -- benchmarkB
```

Expected: FAIL — cannot resolve `../src/lib/benchmarkB`.

- [ ] **Step 3: Implement**

Create `web/src/lib/benchmarkB.ts`:

```ts
import type { Field } from './types'
import type { ArrivalSet } from './arrivals'
import { detectionTime, type DetectionResult } from './detection'
import { uniformGrid, capToCommonCount } from './grid'

export interface ArmResult {
  key: 'pyra' | 'uniform'
  label: string
  detections: DetectionResult[]
  /** Detected runs only, in minutes, ascending. */
  detected: number[]
  censored: number
  medianMinutes: number | null
  p10: number | null
  p90: number | null
  scoredNodes: number
}

export interface BenchmarkBResult {
  arms: ArmResult[]
  ignitions: number
  detectKm: number
  /** The spread rule the bake used. Every displayed number names it. */
  rule: string
  tEndMin: number
  /** uniform median - pyra median, in minutes. null if either is missing. */
  deltaMedianMinutes: number | null
  /** Ignitions neither arm ever saw. These say nothing about placement. */
  bothCensored: number
}

/** Median, or null for an empty sample — never NaN, which would render. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

function arm(
  key: 'pyra' | 'uniform', label: string, set: ArrivalSet,
  nodesKm: Float64Array, detectKm: number,
): ArmResult {
  const detections: DetectionResult[] = []
  const detected: number[] = []
  for (let i = 0; i < set.ignitions.length; i++) {
    const d = detectionTime(set, i, nodesKm, detectKm)
    detections.push(d)
    if (d.minutes !== null) detected.push(d.minutes)
  }
  const sorted = [...detected].sort((a, b) => a - b)
  return {
    key, label, detections, detected: sorted,
    censored: detections.length - detected.length,
    medianMinutes: median(detected),
    p10: percentile(sorted, 0.1),
    p90: percentile(sorted, 0.9),
    scoredNodes: nodesKm.length / 2,
  }
}

/**
 * Benchmark B: across the same 100 ignitions, at the same realised node
 * count, how long does each strategy take to see the fire?
 *
 * Both arms are fed the SAME ignitions. If they saw different fires the
 * benchmark would be measuring the fires, not the placements.
 *
 * The median is taken over detected runs only and `censored` is always
 * reported next to it. Substituting `tEndMin` for a censored run would make
 * the median a function of how long the simulation happened to run; dropping
 * censored runs silently would flatter whichever arm misses more fires,
 * because the fires it misses are exactly the ones that were hardest to see.
 */
export function runBenchmarkB(args: {
  set: ArrivalSet
  nodesKm: Float64Array
  widthKm: number
  heightKm: number
  mask: Field
  detectKm: number
}): BenchmarkBResult {
  const { set, nodesKm, widthKm, heightKm, mask, detectKm } = args
  const requested = nodesKm.length / 2
  const gridArm = uniformGrid(widthKm, heightKm, requested, mask)
  const [pyraNodes, gridNodes] = capToCommonCount(nodesKm, gridArm)

  const arms = [
    arm('pyra', 'Risk-driven placement', set, pyraNodes, detectKm),
    arm('uniform', 'Uniform grid', set, gridNodes, detectKm),
  ]

  let bothCensored = 0
  for (let i = 0; i < set.ignitions.length; i++) {
    if (arms.every((a) => a.detections[i]?.minutes === null)) bothCensored++
  }

  const [p, u] = arms
  return {
    arms,
    ignitions: set.ignitions.length,
    detectKm,
    rule: set.rule,
    tEndMin: set.tEndMin,
    deltaMedianMinutes:
      p.medianMinutes === null || u.medianMinutes === null
        ? null
        : u.medianMinutes - p.medianMinutes,
    bothCensored,
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd web && npm test -- benchmarkB
```

Expected: PASS, 10 tests. Then `npm test` (expect 303 passing) and `npm run build`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/benchmarkB.ts web/tests/benchmarkB.test.ts
git commit -F - <<'EOF'
feat(web): Benchmark B as a 100-run detection-time distribution

Both arms see the same 100 ignitions and are capped to the same realised
node count, exactly as Benchmark A. The median is over detected runs only
and the censored count travels beside it: substituting tEndMin would make
the median a function of the simulation window, and dropping censored runs
would flatter whichever arm misses more fires -- since the fires it misses
are the hardest ones to see.

A delta against a missing median is null, not zero. Zero would read as
"the two strategies are equal".
EOF
```

---

### Task 8: The relay event log

**Files:**
- Create: `web/src/lib/eventLog.ts`
- Test: `web/tests/eventLog.test.ts`

**Interfaces:**
- Consumes: `DetectionResult` (`detection.ts`); `ArrivalSet` (`arrivals.ts`).
- Produces:
  - `interface LogEntry { atMinutes: number; kind: 'detect' | 'relay' | 'notify'; text: string }`
  - `const LORA_RANGE_KM = 5`
  - `function nodeLabel(index: number): string` — `A0`, `A1`, … `B0` after `A25`
  - `function relayPath(nodesKm: Float64Array, from: number, gateway: number, rangeKm?: number): number[] | null`
  - `function buildEventLog(d: DetectionResult, nodesKm: Float64Array, gateway: number): LogEntry[]`

**Why the log exists.** The spec is explicit: *"The event log is what makes sensor fusion legible instead of merely claimed."* A detection time is a number; the log is what shows a judge that the number came from a chain of physical events.

**Why the hop count is honest and the fusion line is not invented.** The relay path is a real shortest path over a graph of nodes within `LORA_RANGE_KM` of each other, so the hop count is a property of the placement being shown — a sparse network really does take more hops. The *sensor fusion* line ("IR rise + gas concordance, acoustic negative") is **narrative**, not simulated: nothing in this repo models three sensors. Task 10's copy must therefore present the fusion line as an illustration of the rule, never as a measurement, and `copy.test.ts` pins the wording.

- [ ] **Step 1: Write the failing test**

Create `web/tests/eventLog.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LORA_RANGE_KM, buildEventLog, nodeLabel, relayPath } from '../src/lib/eventLog'
import type { DetectionResult } from '../src/lib/detection'

describe('nodeLabel', () => {
  it('labels within a letter block, then rolls over', () => {
    expect(nodeLabel(0)).toBe('A0')
    expect(nodeLabel(7)).toBe('A7')
    expect(nodeLabel(25)).toBe('A25')
    expect(nodeLabel(26)).toBe('B0')
  })
})

describe('relayPath', () => {
  // Four nodes in a line, 4 km apart: 0 --4-- 1 --4-- 2 --4-- 3
  const line = Float64Array.from([0, 0, 4, 0, 8, 0, 12, 0])

  it('hops node to node rather than jumping straight to the gateway', () => {
    expect(relayPath(line, 0, 3, LORA_RANGE_KM)).toEqual([0, 1, 2, 3])
  })

  it('takes the fewest hops when a shortcut exists', () => {
    // Add a node bridging 0 and 3 directly.
    const withBridge = Float64Array.from([0, 0, 4, 0, 8, 0, 12, 0, 6, 0])
    const path = relayPath(withBridge, 0, 3, 7)!
    expect(path[0]).toBe(0)
    expect(path[path.length - 1]).toBe(3)
    expect(path.length).toBeLessThanOrEqual(3)
  })

  it('returns null when the network is partitioned', () => {
    // 20 km gap, far beyond LoRa range.
    const split = Float64Array.from([0, 0, 20, 0])
    expect(relayPath(split, 0, 1, LORA_RANGE_KM)).toBeNull()
  })

  it('returns a single-element path when the detector IS the gateway', () => {
    expect(relayPath(line, 2, 2, LORA_RANGE_KM)).toEqual([2])
  })
})

describe('buildEventLog', () => {
  const line = Float64Array.from([0, 0, 4, 0, 8, 0, 12, 0])
  const d: DetectionResult = {
    minutes: 14, ignitionIndex: 3, nodeIndex: 0, cellIndex: 42,
  }

  it('opens with the detection, at the detection time', () => {
    const log = buildEventLog(d, line, 3)
    expect(log[0].kind).toBe('detect')
    expect(log[0].atMinutes).toBe(14)
    expect(log[0].text).toContain('A0')
  })

  it('names every hop in order and ends at the authority', () => {
    const log = buildEventLog(d, line, 3)
    const relay = log.find((e) => e.kind === 'relay')!
    expect(relay.text).toContain('A0')
    expect(relay.text).toContain('A1')
    expect(relay.text).toContain('A3')
    expect(log[log.length - 1].kind).toBe('notify')
  })

  it('never goes backwards in time', () => {
    const log = buildEventLog(d, line, 3)
    for (let i = 1; i < log.length; i++) {
      expect(log[i].atMinutes).toBeGreaterThanOrEqual(log[i - 1].atMinutes)
    }
  })

  it('says so when the network cannot reach a gateway', () => {
    const split = Float64Array.from([0, 0, 20, 0])
    const log = buildEventLog({ ...d, nodeIndex: 0 }, split, 1)
    expect(log.some((e) => /no route|cannot reach/i.test(e.text))).toBe(true)
    expect(log.some((e) => e.kind === 'notify')).toBe(false)
  })

  it('is empty for a censored run', () => {
    // Nothing was detected, so nothing happened. A log that narrated a
    // relay for an undetected fire would be fiction.
    expect(buildEventLog({ ...d, minutes: null, nodeIndex: null }, line, 3))
      .toEqual([])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npm test -- eventLog
```

Expected: FAIL — cannot resolve `../src/lib/eventLog`.

- [ ] **Step 3: Implement**

Create `web/src/lib/eventLog.ts`:

```ts
import type { DetectionResult } from './detection'

/**
 * LoRa hop range, in km. A single figure standing in for a link budget the
 * site does not model; the Rail's radio beat is where that argument is made
 * properly. It is here so hop COUNT is a property of the placement on
 * screen — a sparse network really does take more hops — rather than a
 * number chosen to look good.
 */
export const LORA_RANGE_KM = 5

/** A0..A25, then B0.. — short enough to read in a log line. */
export function nodeLabel(index: number): string {
  const block = Math.floor(index / 26)
  return `${String.fromCharCode(65 + block)}${index % 26}`
}

/**
 * Fewest LoRa hops from `from` to `gateway`, or null if the network is
 * partitioned. Breadth-first, because every hop costs the same.
 */
export function relayPath(
  nodesKm: Float64Array, from: number, gateway: number,
  rangeKm: number = LORA_RANGE_KM,
): number[] | null {
  const n = nodesKm.length / 2
  if (from < 0 || from >= n || gateway < 0 || gateway >= n) return null
  if (from === gateway) return [from]

  const r2 = rangeKm * rangeKm
  const prev = new Int32Array(n).fill(-1)
  const seen = new Uint8Array(n)
  seen[from] = 1
  let frontier = [from]

  while (frontier.length) {
    const next: number[] = []
    for (const a of frontier) {
      for (let b = 0; b < n; b++) {
        if (seen[b]) continue
        const dx = nodesKm[2 * a] - nodesKm[2 * b]
        const dy = nodesKm[2 * a + 1] - nodesKm[2 * b + 1]
        if (dx * dx + dy * dy > r2) continue
        seen[b] = 1
        prev[b] = a
        if (b === gateway) {
          const path = [b]
          for (let c = a; c !== -1; c = prev[c]) path.push(c)
          return path.reverse()
        }
        next.push(b)
      }
    }
    frontier = next
  }
  return null
}

/**
 * The detection, the relay and the hand-off, in plain language.
 *
 * Everything here is derived from the run being shown: the time is the
 * measured detection time, the detecting node is the one that actually saw
 * it, and the hop count is a real shortest path over the placement on
 * screen. Nothing is narrated for a run that was never detected — a log
 * describing a relay for a fire nobody saw would be fiction.
 */
export function buildEventLog(
  d: DetectionResult, nodesKm: Float64Array, gateway: number,
): LogEntry[] {
  if (d.minutes === null || d.nodeIndex === null) return []

  const at = d.minutes
  const from = nodeLabel(d.nodeIndex)
  const log: LogEntry[] = [{
    atMinutes: at,
    kind: 'detect',
    text: `rod ${from} — infrared rise with gas concordance, acoustic negative → alert raised`,
  }]

  const path = relayPath(nodesKm, d.nodeIndex, gateway)
  if (path === null) {
    log.push({
      atMinutes: at,
      kind: 'relay',
      text: `rod ${from} has no route to a gateway — the mesh is partitioned at this spacing`,
    })
    return log
  }

  log.push({
    atMinutes: at,
    kind: 'relay',
    text: `relay ${path.map(nodeLabel).join(' → ')} → gateway (${path.length - 1} hops)`,
  })
  log.push({
    atMinutes: at,
    kind: 'notify',
    text: 'authority notified',
  })
  return log
}

export interface LogEntry {
  atMinutes: number
  kind: 'detect' | 'relay' | 'notify'
  text: string
}
```

- [ ] **Step 4: Run the tests**

```bash
cd web && npm test -- eventLog
```

Expected: PASS, 11 tests. Then `npm test` (expect 314 passing) and `npm run build`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/eventLog.ts web/tests/eventLog.test.ts
git commit -F - <<'EOF'
feat(web): the relay event log, derived rather than narrated

The detecting node, the time and the hop count all come from the run on
screen -- the relay is a real breadth-first shortest path over the
placement, so a sparse network genuinely takes more hops. A partitioned
mesh says so instead of inventing a route, and a censored run produces no
log at all, because narrating a relay for a fire nobody saw would be
fiction.

The sensor-fusion wording is illustration, not simulation: nothing in this
repo models three sensors, and Task 10's copy has to say so.
EOF
```

---

### Task 9: The dot strips

**Files:**
- Create: `web/src/ui/dotStripModel.ts`
- Create: `web/src/ui/DetectionStrip.tsx`
- Test: `web/tests/dotStripModel.test.ts`, `web/tests/detectionRender.test.tsx`

**Interfaces:**
- Consumes: `BenchmarkBResult`, `ArmResult` (`benchmarkB.ts`); `PALETTE`.
- Produces:
  - `interface StripDot { x: number; y: number; minutes: number; ignitionIndex: number }`
  - `interface StripRow { key: 'pyra' | 'uniform'; label: string; color: string; dots: StripDot[]; median: { x: number; text: string } | null; censoredText: string }`
  - `interface StripModel { width: number; height: number; pad: {...}; rows: StripRow[]; axis: ChartAxis; legend: Array<{label, color}>; table: Array<{ arm: string; median: string; p10: string; p90: string; detected: number; censored: number }>; xOf(minutes: number): number }`
  - `function buildStripModel(r: BenchmarkBResult, width?: number, height?: number): StripModel`
  - `function DetectionStrip(props: { result: BenchmarkBResult; width?: number; height?: number })`

**Form, per the dataviz procedure — form first, colour last.** The spec names this one: *"two dot strips with median markers, one row per strategy"*. One hundred values per strategy is a distribution, and a distribution of this size is a strip of dots — a box plot hides the shape, a histogram needs binning decisions that become arguments, and a bar of two medians throws away 198 of the 200 numbers. Colour is assigned by job afterwards: `series.pyra` for the risk-driven row, `series.baseline` for the grid row, on **one shared x-axis in minutes**, never two.

**Jitter, and why it is deterministic.** Dots at the same minute overlap. Rows are jittered vertically by a hash of the ignition index, not by `Math.random`, so the picture is identical on every render and a screenshot taken twice is the same screenshot.

- [ ] **Step 1: Write the failing test**

Create `web/tests/dotStripModel.test.ts` with cases pinning: one x-axis and no second scale; `rows` length 2 with colours assigned by job; a dot per detected run and none for censored runs; the median marker at `xOf(median)` and directly labelled; `censoredText` present and naming the count **even when it is zero**; ticks in minutes at round values; a table row per arm carrying median, p10, p90, detected and censored; an empty result producing empty rows rather than a chart of nothing; and the jitter being identical across two builds of the same result.

```ts
it('is deterministic — two builds of the same result are identical', () => {
  const a = buildStripModel(fake(), 520, 200)
  const b = buildStripModel(fake(), 520, 200)
  expect(a.rows[0].dots.map((d) => d.y)).toEqual(b.rows[0].dots.map((d) => d.y))
})

it('states the censored count even when it is zero', () => {
  // "0 of 100 censored" is information. An absent line reads as "censoring
  // did not apply", which is a different claim.
  for (const row of buildStripModel(fake(), 520, 200).rows) {
    expect(row.censoredText).toMatch(/\d+ of \d+/)
  }
})
```

Create `web/tests/detectionRender.test.tsx` rendering `DetectionStrip` with `renderToStaticMarkup` and asserting: both legend labels appear, both median values appear as text, the censored counts appear, the axis is labelled in minutes, and the table toggle is present with `aria-expanded`. **This is the same gap the Plan 2 review found** — model tests do not prove the component renders what the model carries.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && npm test -- dotStrip detectionRender
```

- [ ] **Step 3: Implement `dotStripModel.ts`, then `DetectionStrip.tsx`**

Follow `chartModel.ts` / `CoverageBudgetChart.tsx` exactly as the house pattern: pure geometry in the model, SVG in the component, every colour from `PALETTE`, 2px marks with a surface ring where they overlap, a legend, direct median labels, a hover layer with a per-dot tooltip naming the ignition, and a table view behind a toggle. Dot radius 3 with a 1px `PALETTE.chart.surface` ring; median marker a 2px vertical rule in the row's own colour, labelled with the value in `PALETTE.ink`.

- [ ] **Step 4: Run everything**

```bash
cd web && npm test && npm run build
```

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/ui/dotStripModel.ts web/src/ui/DetectionStrip.tsx \
        web/tests/dotStripModel.test.ts web/tests/detectionRender.test.tsx
git commit -F - <<'EOF'
feat(web): detection times as two dot strips with median markers

One hundred values per strategy is a distribution: a box plot hides its
shape, a histogram turns binning into an argument, and two bars throw away
198 of the 200 numbers. One shared x-axis in minutes, never two. Jitter is
hashed from the ignition index rather than drawn, so the same result always
renders the same picture.

The censored count is stated even when it is zero -- an absent line reads
as "censoring did not apply", which is a different claim.
EOF
```

---

### Task 10: The copy, and the absence

**Files:**
- Modify: `web/src/ui/copy.ts`
- Modify: `web/tests/copy.test.ts`

**Interfaces:**
- Produces:
  - `function detectionSentence(r: BenchmarkBResult): string`
  - `function censoringSentence(r: BenchmarkBResult): string | null`
  - `function fusionCaveat(): string`
  - `function fireModelAbsence(regionLabel: string): string`

**What each must say, and the tests that force it.**

`detectionSentence` names the arm that is actually faster — including when it is the grid — reports both medians and the delta, states the **number of ignitions**, the **detection radius**, and the **spread rule by name**. The test asserts a flipped result produces the other arm's name, so an implementation that always announces a Pyra win fails.

`censoringSentence` returns `null` only when neither arm censored anything. Otherwise it names both counts, and when they differ it says plainly that the two medians are taken over different numbers of runs and are therefore not directly comparable.

`fusionCaveat` states that the fusion line in the event log illustrates the decision rule and is not a simulated sensor reading. The banned-words test from Plan 2 already forbids "validated" and "fire model"; extend it so `fusionCaveat` and `detectionSentence` are included in the joined string, and add `'sensor reading'` and `'measured by the rods'` to the banned list.

`fireModelAbsence` names the region and states that the fire model is validated in California only, that the siting model still runs there, and that Benchmark A is unaffected — so a reader on Rondônia sees a reason, not a gap.

- [ ] **Step 1: Write the failing tests** — mirror Plan 2's `copy.test.ts` structure exactly, including the "no copy overclaims" case extended with the new strings.
- [ ] **Step 2: Run and watch fail.** `cd web && npm test -- copy`
- [ ] **Step 3: Implement in `copy.ts`.**
- [ ] **Step 4: Run the suite and build.**
- [ ] **Step 5: Commit.**

```bash
git commit -F - <<'EOF'
feat(web): detection copy that names the winner, the rule and the censoring

The caption names whichever arm is actually faster, states the ignition
count, the detection radius and the spread rule by name, and refuses to
compare two medians taken over different numbers of detected runs without
saying so. Outside California the benchmark states its own absence and why.
EOF
```

---

### Task 11: Wire it up — worker, store, panel, and the browser check

**Files:**
- Modify: `web/src/workers/place.worker.ts`, `web/src/state/useModelStore.ts`, `web/src/ui/RunPanel.tsx`, `web/src/App.tsx`
- Create: `web/src/ui/EventLog.tsx`, `web/src/ui/DetectionPanel.tsx`

**Interfaces:**
- `RunMessage` gains `fire: ArrivalSet | null`; `DoneMessage` gains `benchmarkB: BenchmarkBResult | null`.
- Store gains `fireData: ArrivalSet | null`, `benchmarkB: BenchmarkBResult | null`, `selectedIgnition: number`, and their setters. `setRegionName` clears **all three**.

**The three things this task must not get wrong.**

1. **Benchmark A must keep working when `fire` is null.** The worker computes B only when `fire !== null`, and `DoneMessage.benchmarkB` is `null` otherwise. A region without fire data is a Lab with one benchmark, never a broken Lab.
2. **The stale-run guard from Plan 2 applies here too.** `benchmarkB` is cleared on region change alongside `result` and `benchmark`, and the in-flight run is invalidated by the existing `regionName` effect. A Los Padres detection distribution rendered under Rondônia is exactly the failure that guard exists for.
3. **`buildDone`'s transfer list must not gain the arrival buffers.** `ArrivalSet.cells` and `.minutes` are owned by the **main thread** and are sent *into* the worker; transferring them back would detach the copy the next run needs. Extend `worker.test.ts`'s buffer assertions to prove the transfer list still holds exactly the three placement buffers.

- [ ] **Step 1: Extend the worker test first**, asserting `benchmarkB` is present when `fire` is supplied, `null` when it is not, and that the transfer list is unchanged at three distinct buffers.
- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Wire the worker, then the store, then `RunPanel` (load fire data on region change via `loadFireData`, tolerate `null`), then `DetectionPanel` + `EventLog`, then mount in `App.tsx`.**
- [ ] **Step 4: Run the suite and build.** Expect the whole suite green.
- [ ] **Step 5: Look at it in a browser.**

```bash
cd web && npm run dev
```

Verify, in order:
1. Los Padres: after **Run placement**, a detection panel appears with two dot strips, both medians labelled, and the censored counts stated.
2. Dragging **Detection radius** and re-running visibly moves both strips — Benchmark B is live, not a picture.
3. Clicking a dot selects that ignition and the event log narrates *that* run, with a hop count that matches the network on screen.
4. Switching **Budget mode** to `auto` (18 nodes) drives the censored count sharply up, and the copy says so rather than showing a confident median over three runs.
5. Selecting **Congo Basin**: Benchmark A still renders; Benchmark B is replaced by the absence notice naming California; no 404 in the console; no error state.
6. Nothing is orange except the PYRA wordmark, the fire scar and alert states in the log.

- [ ] **Step 6: Update `docs/website-status.md`** with the measured medians, the censored counts, the spread rule chosen in Task 2, and Plan 3 marked complete.
- [ ] **Step 7: Commit.**

---

## Self-Review

**1. Spec coverage.** Walking §5's Benchmark B requirements:

| Spec requirement | Task |
|---|---|
| `Run 100 ignitions`, same points to both strategies | 3, 7 |
| Two dot strips with median markers, one row per strategy | 9 |
| Runs in a worker, page never freezes | 11 |
| Los Padres only; absent with a stated reason elsewhere | 5 (`null`), 10 (`fireModelAbsence`), 11 |
| Blue noise vs blue noise + set cover as its own stat tile | **already shipped in Plan 2** (`Set-cover saving`, 38%) |
| KPI row: detection time per strategy plus delta | 11 (`DetectionPanel`) |
| Event log in plain language, relay hops named | 8, 11 |
| Detection-time delta → stat tile / hero number, not a chart | 11 |
| Never a dual axis; legend; hover on every mark; table view | 9, enforced by `dotStripModel.test.ts` and `detectionRender.test.tsx` |

**Deliberately not met as written, and recorded rather than dropped:** the spec's example log line implies three simulated sensors. Nothing in this repo models sensors at all — the fire model produces arrival times, not IR/acoustic/gas readings. Task 8 derives everything it *can* derive (who detected, when, how many hops) and Task 10's `fusionCaveat` states that the fusion wording illustrates the decision rule rather than reporting a reading. Presenting it as a measurement would be precisely the overclaim the honesty layer exists to prevent.

**2. Placeholder scan.** No "TBD", no "similar to Task N", no "handle errors appropriately". Tasks 9, 10 and 11 describe their tests by the assertions required rather than transcribing every line, because they follow patterns already established and committed in Plan 2 (`chartModel.ts`/`CoverageBudgetChart.tsx`, `copy.ts`, `place.worker.ts`) — the implementer has working examples in the repo, not a description of one. Four steps deliberately require **measuring** rather than transcribing, and each says what to measure and what to do with the answer: Task 2 Step 2 (the spread-rule probe), Task 3 Step 2 (the real burnable constant), Task 4 Step 3 (the bake size), and Task 11 Step 5 (the browser).

**3. Type consistency.** `ArrivalSet`, `Ignition` and `FireGridSpec` are defined once in Task 5 and consumed unchanged by Tasks 6, 7, 9 and 11. `DetectionResult` is defined in Task 6 and consumed by 7 and 8. `BenchmarkBResult` is defined in Task 7 and consumed by 9, 10 and 11. `Field` and `Float64Array` node arrays keep the shapes Plan 1 and Plan 2 established — flat `[x, y]` pairs in `LocalFrame` kilometres from the south-west corner. `uniformGrid` and `capToCommonCount` are used exactly as Benchmark A uses them, so the fairness rule is literally the same code.

**4. The risk worth stating plainly.** Task 2 may find that neither rule separates the two placements — that at 86 m/min everything is detected almost immediately, and at 14 m/min almost nothing is detected at all. That is a real possible outcome, and the decision rule in Task 2 says to stop and escalate rather than to tune parameters until a difference appears. **Benchmark A already carries the Lab.** A Benchmark B that had to be coaxed into showing a result would be worth less than no Benchmark B, and this plan is structured so that discovering it early costs two tasks rather than eleven.
