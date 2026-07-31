# Known issues in `ntemath` — outside the website's scope

Compiled 2026-07-31 while building the site. **Nothing here has been changed** — the website work is additive and no repo-root Python file has been modified.

Each item says how it was established:
- **[measured]** — I ran it and observed the result
- **[theirs]** — the team already documented it; listed so it isn't lost
- **[inferred]** — reasoned from the code, not empirically confirmed

Ordered by how much damage it does if left alone.

---

## 1. Blocking / high impact

### 1.1 `auto_budget` makes the default run report 4.5% coverage — [measured]
**Where:** `plan.py: auto_budget`, `budget_hi = 40`

The default `budget="auto"` clamps node count to 40. Los Padres at `detect_km=2.0` needs ~529 nodes for full coverage, so the default run sites 18 and honestly reports **4.5% risk-weighted coverage**.

The algorithm is correct — this is a demo-scale clamp, not a bug in the maths. But it means the out-of-the-box invocation makes the project look broken. Saturation mode (`budget=None`) reaches **0.950 coverage with 561 nodes from 928 candidates**.

**Suggested fix:** default to saturation, or make the clamp loud (`print` a warning when the budget caps below what the target requires). Also reconsider `KM2_PER_NODE` and the `lo`/`hi` bounds — a "sentinel network" mode is a legitimate idea, but it should be opt-in and clearly labelled as *not* attempting coverage.

### 1.2 `place.py`'s seeding is not reproducible — [measured]
**Where:** `place.py: variable_poisson_disk`, the `np.argsort(risk, axis=None)[::-1]` seed scan

`np.argsort` defaults to quicksort, which is **unstable** — among equal values the order is implementation-defined and can differ across numpy versions, platforms and builds.

That would be harmless if ties were rare. They are the normal case:

- `hazard.activity_field` returns an **all-zero array** whenever a box has no FIRMS detections above confidence 40. The open feed is only ~7 days deep, so this is routine.
- With activity zero, `drive = w_base + w_weather*fwi_norm` is a **scalar**.
- `forest.FLAMMABILITY` gives TREE and SHRUB both exactly **1.00**.
- So `risk == 1.0` at every tree/shrub pixel, and after `r / peak` normalisation they stay tied.

Measured on a synthetic WorldCover mosaic through the real `risk_field`: **112,155 of 160,000 pixels tied at the maximum.** The seed pixel determines the entire subsequent point sequence, so two runs that disagree on the seed produce completely different networks.

Your Los Padres run reported **2 FIRMS detections** — this is live, not hypothetical.

**Suggested fix:** make the seed deterministic. Either sort on the total order `(-risk, flat_index)`, or resolve and record the seed index explicitly. The website already does the latter, so the two agree — but `place.py` on its own is currently non-deterministic across environments, which matters for anything you publish as a reproducible result.

### 1.3 The Bluetooth mesh cannot span the spacing the model produces — [measured]
**Where:** system concept, not a specific file

Measured blue-noise spacing on Los Padres: **7.56–18.49 km**, and ~**3.1 km mean at saturation** (102 nodes/1000 km²). Bluetooth mesh, including BLE Coded PHY, reaches a few hundred metres to about 1 km line-of-sight, and less under canopy.

At those distances the nodes cannot hear each other and there is no mesh.

**Decision already taken for the site:** LoRa for the node-to-node backbone (2–15 km, the standard choice for deployed wildfire sensor networks), BLE retained for the phone-to-node camper leg where its range genuinely fits. The video, the display advertisement and the Phase 3 presentation all need the same correction.

### 1.4 `detect_km = 2.0` is an undefended free parameter — [inferred]
**Where:** `plan.py: plan_region(detect_km=2.0)`

Every coverage number, node count and global cost estimate inherits this. Nothing in the repo justifies it, and 2 km is optimistic for IR, acoustic or gas detection of a *small* fire under canopy:

- IR needs line of sight; canopy blocks it.
- Acoustic detection of flame is short-range and noisy.
- Gas/smoke plume transport is wind-dependent and directional, not a disc.

Node count scales as 1/r², so halving this quadruples the hardware and the global cost figure.

**Suggested fix:** source it, or measure it, or present it explicitly as a design assumption with a sensitivity range. This is the number a technical judge is most likely to push on.

---

## 2. Correctness and honesty

### 2.1 `risk_field` has no elevation and no camper-traffic term — [measured]
**Where:** `plan.py: risk_field`

The actual formula is:

```
risk = flammability(landcover) × (w_base + w_weather·FWI_norm + w_activity·activity)
```

The project pitch describes elevation and camper traffic as model inputs. They are not in the code. **Decision taken for the site:** ship the three real inputs and mark the other two as roadmap in the build-status strip.

### 2.2 FIRMS activity is a recency signal, not a fire history — [theirs]
`hazard.py`'s docstring already says this plainly. Worth repeating because it is easy to over-claim in a presentation: the open feeds reach back days, so "no detections" means "nothing seen this week", not "this area does not burn".

### 2.3 A silent all-zero activity field — [inferred]
When no detections land in the box, `activity_field` returns zeros with no warning. Combined with 1.2 above this is the trigger for the tie problem, and it also means the `w_activity` term silently contributes nothing. A one-line log (`no FIRMS detections in box — activity term inactive`) would make the degraded mode visible.

### 2.4 Detection modelled as a hard disc — [inferred]
`greedy_minimise` and `coverage_of` treat detection as a circle of radius `detect_km`. Real detection is anisotropic (wind-borne plume), terrain-occluded (IR line of sight), and probabilistic rather than binary. Fine as a first model; worth stating as a simplification rather than leaving implicit.

---

## 3. Fire model (M1–M7) — already documented by the team

Listed so they stay visible; the team reported all of these honestly, which is a strength.

- **[theirs] Residence-time dilution.** Simulated aspect ratio ~1.0 against an observed 2.79. A 19× per-step directional preference collapses to 3.6× when integrated over the median 31-step residence time. Fixing it means changing the transition rule and recalibrating `p0` and `c2`.
- **[theirs] `g_geom` invariance caveat.** Head ROS drifts ~19% across an 8× change in `d_min`, coarse meshes spreading faster. Reported as a real bias rather than tuned away.
- **[theirs] Weak terrain channelling.** `a_slope = 0.078`/radian gives only ~14% uphill/downhill difference; real chaparral fires are steered hard by topography.
- **[theirs] No suppression, spotting, or diurnal cycle.** Left alone the model burns 145 km², nearly the whole study area.
- **[theirs] M6 knees are unresolved.** Both land on the finest spacing swept (40 m), which is *also* the reference level — so it returns the noise floor by construction rather than by measurement. Bracketing it needs a finer reference and correspondingly finer levels below it.
- **[theirs] SILVERADO 2020 ignition assumed at the perimeter centroid** (FRAP maps no origin), so spread-direction metrics for that fire are meaningless — the answer is built in. `--ignition-lonlat` fixes it if an origin can be found.
- **[theirs] LANDFIRE fuel vintage gap.** LF2016 used for a 2020 fire because no FBFM40 exists for 2017–2019; vegetation may have changed materially.

---

## 4. Packaging and hygiene

### 4.1 The package name is inconsistent and the documented entry point doesn't work — [measured]
`__init__.py`'s docstring says `from nodenet.plan import REGIONS, plan_region` and `__main__.py` documents `python -m nodenet`. But the package is not named `nodenet` — it is whatever the checkout directory is called. This checkout is `Pyra NTE`, **with a space**, which is not a valid Python identifier, so `import` cannot reach it by name at all.

`place.py` uses a relative `from .geo import ...`, so it can only be loaded as a package submodule — the directory name is load-bearing.

**Suggested fix:** move the modules into a real `nodenet/` subpackage inside the repo, so the import path stops depending on what the clone is called. That makes the README's own commands work for anyone who clones it.

*(The website's bake tooling works around this by registering the repo under a synthetic name in `sys.modules` via `importlib.util.spec_from_file_location`. That is a workaround for the site, not a fix for the repo.)*

### 4.2 No `.gitignore` — **fixed on `pyra-site`** — [measured]
The repo had none, so `outputs/` (planner GeoJSON, the FWI cache, sweep PNGs) was one `git add .` away from being committed, along with `__pycache__`. I added one on the `pyra-site` branch covering `outputs/`, caches, `node_modules/`, and rasters. **Worth cherry-picking to `main` independently of the website work.**

### 4.3 `README.md` is one line — [measured]
Currently just `# ntemath`. Given how much is in `RESULTS.md`, a short README pointing at it, listing the two subsystems, and giving the working install/run commands would cost little.

### 4.4 `estimate_global_cost` hardcodes `mean_nodes_per_1000km2 = 100.0` — [measured]
The measured Los Padres figure was 102/1000 km², so the default is close — but it is a single-region extrapolation to the whole planet. Worth labelling as such wherever the 4.06 M node figure is quoted.

---

## 5. Not yet examined

- **`build_globe.py` and `globe_template.html`** (~535 lines, D3 + canvas, written around Claude Artifact CSP limits). I flagged this as prior art to review before duplicating effort on the site, and have not read it yet.
- **`world.py`'s global sweep** — read only at the docstring level. The batching and land-grid logic look sound but are unverified.
- **`sweep.py` and `calibrate.py`** — read at the docstring and results level, not line by line.
