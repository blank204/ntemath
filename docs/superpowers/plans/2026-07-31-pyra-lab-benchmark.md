# Pyra Site — Plan 2: The Lab, Benchmark A

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Lab exposes the siting model's real parameters — `w_weather`, `w_activity`, `detectKm`, `rMinKm`/`rMaxKm`, coverage `target` and budget mode — as live browser controls over a risk field recombined from separately-baked components, and reports a head-to-head coverage benchmark against a uniform grid as proper data visualisation.

**Architecture:** The bake stops shipping one pre-combined `risk.bin` and starts shipping its *components*: WorldCover class codes (`classes.bin`, uint8) and the FIRMS activity field (`activity.bin`, float32), plus the scalar `fwiNorm`. The browser recombines them with `risk = flammability(class) * (w_base + w_weather*fwiNorm + w_activity*activity)`, divided by its own peak, exactly as `plan.risk_field` does — and a test asserts the result is bit-for-bit identical to the committed `risk.bin` at the default weights. Because the risk field can now change in the browser, the blue-noise seed pixel is resolved in the browser too, by an explicit total order that the baked `seedFlatIndex` cross-checks. Benchmark A rides free on the greedy set-cover's prefix property: one placement run yields the whole coverage-versus-budget curve for both arms.

**Tech Stack:** Vite · React 18 · TypeScript · Vitest · MapLibre GL JS · deck.gl · Zustand · Python 3 (numpy, rasterio, requests) for the offline bake. No new runtime dependencies — the charts are hand-written SVG.

---

## Read this before Task 1: three measured findings that shape the plan

These were measured while writing this plan, by running the committed code against the committed rasters. They change what the spec assumed. Each has a task that acts on it.

**1. On Los Padres, the uniform grid *beats* the risk-driven placement at the default saturation budget.**

Measured with `runPlacement` (seed 7, `detectKm` 2.0, `rMinKm` 1.1, `rMaxKm` 2.6, `target` 0.95, `demandStride` 4) against the committed `risk.bin`/`mask.bin`, both arms capped with `capToCommonCount`, scored by `coverageOf` on the same 31,045 demand points at a 0.366 km stride:

| Node budget | realised, both arms | risk-driven | uniform grid | Δ |
|---:|---:|---:|---:|---:|
| 50 | 45 | 12.69% | 10.96% | **+1.74 pp** |
| 100 | 92 | 25.29% | 22.25% | **+3.04 pp** |
| 170 | 157 | 41.40% | 37.79% | **+3.61 pp** (best) |
| 250 | 222 | 55.54% | 54.26% | **+1.28 pp** |
| 270 | 244 | 59.90% | 60.34% | −0.44 pp (crossover) |
| 400 | 364 | 78.74% | 83.93% | −5.19 pp |
| 572 (saturation) | 526 | 92.76% | 96.93% | −4.17 pp |

The spec's Benchmark A is phrased as "the risk-driven placement covers **X%** … a uniform grid covers **Y%**", with X > Y assumed. On this region at this budget, it is false. **The plan does not report a single pair at saturation.** It reports the whole curve, names the crossover, and says plainly which regime each strategy wins. That is a stronger result than a cherry-picked pair, and it removes the only alternative — quietly weakening the baseline — which Plan 1's ledger already caught the project drifting toward once (Task 9, the undershooting grid).

**2. The reason is measurable, and it is the reason `w_activity` needs to be live.** Over the 498,021 burnable pixels of the committed `risk.bin`: median 0.5756, 90th percentile 0.5756, 99th percentile 0.5851, and **0.05%** of pixels exceed 0.80. There are effectively two plateaus — 0.5756 (tree/shrub) and 0.4317 (grassland) — which are just `FLAMMABILITY` class weights rescaled. `fwiNorm` is a single regional **scalar**, so it has no spatial structure at all, and the FIRMS activity term is one Gaussian bump from two out-of-box detections. So the variable radius spans only 1.74–1.95 km out of a possible 1.1–2.6 km: the blue noise is very nearly *uniform-density* blue noise, and Poisson-disk packing covers discs less efficiently than a lattice. Risk-driven siting can only beat a grid where risk is genuinely heterogeneous, or where the budget is too small to blanket the ground.

**3. `w_weather` cannot change the shape of the field — only its ratio to `w_activity`.** Because `fwiNorm` is a scalar, write `s = w_base + w_weather·fwiNorm`. With `w_base = 1 − w_weather − w_activity` this is `s = 1 − w_activity − w_weather·(1 − fwiNorm)`. Then

```
risk_i = flam_i · (s + w_activity·act_i) / max_j( flam_j · (s + w_activity·act_j) )
```

which depends on `(w_weather, w_activity)` **only through the ratio `w_activity / s`**. Two different weight pairs with the same ratio produce the same normalised field. That is a property of the model as written, not a bug, and Task 5 pins it with a test. The Lab must say so on screen rather than implying two sliders do two independent things.

**Also measured, and contradicting a line in the spec:** `plan.auto_budget` does **not** clamp to 40 on Los Padres. `plan_region` calls it with `budget_lo=6, budget_hi=40` and `burn_km2 = 5073.90`, `mean_risk = 0.50623`, giving `raw = 18.347` and a budget of **18** — the `hi=40` clamp is not active. The defect is the `KM2_PER_NODE = 140.0` scaling, not the clamp. Task 6 ports this faithfully and labels it.

---

## Global Constraints

- **Branch:** all work on `pyra-site` in `blank204/ntemath`. Never commit to `main`.
- **No repo-root Python may be modified.** `place.py`, `plan.py`, `forest.py`, `hazard.py`, `geo.py`, `world.py` and every M1–M7 module are read-only. This plan is additive; everything new lives in `tools/bake/` or `web/`.
- **No `sys.path` mutation anywhere in `tools/`.** Import repo-root modules through the existing `tools/bake/_repo_import.py:repo_modules(...)`, which registers the repo root as `sys.modules["_ntemath_repo"]` via `spec_from_file_location`. Adding a `sys.path.insert` re-introduces the shadowing hazard Plan 1's Task 4 removed.
- **Verify every repo-root Python signature with `inspect.signature` before writing a call site.** Plan 1 shipped three wrong ones. Confirmed for this plan (run the check in Task 1 Step 1 anyway):
  `forest.read_landcover(box, max_px=1400)` returns a **3-tuple**; `forest.flammability_field(classes)`; `forest.burnable_mask(classes)`; `hazard.detections_in(box, dets, pad_deg=0.25)` — **box first**; `hazard.activity_field(box, dets, shape, sigma_km=8.0, min_conf=40.0)` — **box first**; `hazard.peak_fwi_for_points(points, start, end, refresh=False, percentile=90.0)` takes a **list of (lon, lat)** and returns an array; `plan.risk_field(classes, activity, fwi_norm, w_weather=0.45, w_activity=0.35, w_base=0.2)`; `plan.auto_budget(area_km2, mean_risk, lo=3, hi=40)`; `plan.normalise_fwi(fwi_value, full_scale=80.0)`.
- **Never invent a constant the source already defines.** Read `forest.FLAMMABILITY`, `forest.BURNABLE`, `plan.FWI_FULL_SCALE`, `plan.KM2_PER_NODE` and `plan.risk_field`'s weight defaults out of the modules at bake time and publish them in `meta.json`; the browser reads them from there. Spacing derivations come from `plan_region` verbatim: saturation is `detect_km * 0.55` / `detect_km * 1.30`; budgeted is `spread * 0.45` / `spread * 1.10` where `spread = sqrt(max(burn_km2, 1.0) / max(n_budget, 1))`; `budget_lo = 6`, `budget_hi = 40`.
- **Float32 before use, always.** The browser holds float32. Every value the browser will consume must be snapped to float32 *before* any Python-side consumer reads it — this is the standing precedent from Plan 1 Tasks 6 and 10, and Task 1 extends it to the activity field. `web/src/lib/field.ts:radiusAt` mirrors `place.py`'s NEP-50 narrowing with `Math.fround`; do not touch it.
- **Colour rule — absolute:** green and black are surfaces; saturated orange is reserved for fire, heat and alert states only. Data series are mesh teal `#4DE1C1`; baselines are neutral grey `#8A9691`. Canvas `#060706`, surface `#0E1F16`, surface-raised `#1B3B29`, ink `#F2EFE6`. Brand orange `#FF6B1A` appears only in the Pyra wordmark. **Import every colour from `web/src/theme/palette.ts`. Never write a hex literal outside that file** (the vendored validator script and its recorded report are the only exceptions).
- **Dataviz rules, binding on top of the colour rule:** never a dual axis — one y-scale per chart, always; a legend is present whenever there are two or more series; colour is assigned by the job it does (Pyra = accent, baseline = de-emphasis grey), never by rank; sequential ramps are one hue, never a rainbow; text wears text tokens, never a series colour; a hover layer on every plotted mark; a table view exists for every chart; label selectively, never a number on every point.
- **Honesty rules:** every coverage number displayed must state that it is **risk-weighted** and report the **scoring stride in km**. Nothing may imply the fire model is validated outside California — this plan ships no fire model at all, and no copy it introduces may suggest one exists here.
- **Saturation is the default budget mode.** `auto` is available and is labelled with what it actually produces.
- **All distances in kilometres** in a `LocalFrame`, never in degrees.
- **The regression bar:** 138 tests pass today. Every task ends with `cd web && npm test` green and `cd web && npm run build` succeeding. Node.js ≥ 20, Python ≥ 3.11.
- **Out of scope, by design:** the detection-time benchmark (Benchmark B) is Plan 3. It needs the M1–M7 fire model, is Los Padres-only, and the spec is explicit that the cheap global benchmark must ship first so the Lab is never left with no comparison. Nothing in this plan may depend on it.

---

## File Structure

```
tools/bake/
  bake_region.py        MODIFY — emit classes.bin + activity.bin + richer meta + manifest
  verify_parity.py      NEW    — independent Python reference run over the committed rasters
  export_fixtures.py    MODIFY — add the recombination fixture

web/
  scripts/
    validate_palette.mjs        NEW — vendored from the dataviz skill, unmodified
  public/data/
    manifest.json               NEW (generated) — which regions are baked
    los-padres/
      classes.bin               NEW (generated) — nx*ny uint8 WorldCover class codes
      activity.bin              NEW (generated) — nx*ny little-endian float32
      risk.bin, mask.bin        REGENERATED — kept as committed goldens, no longer fetched
      meta.json                 REGENERATED — gains the model's own constants
  src/
    lib/
      risk.ts            NEW — recombineRisk, the weight model, the flammability LUT
      seed.ts            NEW — resolveSeedIndex, the total-order seed rule
      budget.ts          NEW — saturation / auto / fixed, ported from plan_region
      benchmark.ts       NEW — Benchmark A: the coverage-versus-budget sweep
      regions.ts         NEW — the eight regions and which are baked
      loadRegion.ts      MODIFY — fetch components, derive the mask
      pipeline.ts        MODIFY — recombine, resolve the seed, then place
      types.ts           MODIFY — add ClassField
    state/useModelStore.ts   MODIFY — weights, budget mode, benchmark result
    workers/place.worker.ts  MODIFY — return risk + benchmark
    theme/palette.ts         MODIFY — named series slots
    ui/
      copy.ts            NEW — the honesty strings, in one testable place
      StatTile.tsx       NEW — stat tile + KPI row + hero figure
      chartModel.ts      NEW — pure geometry for the comparison chart (unit-testable)
      CoverageBudgetChart.tsx  NEW — the SVG chart, legend, hover, table view
      BenchmarkPanel.tsx NEW — assembles tiles + chart + captions
      RunPanel.tsx       MODIFY — the full control set, region degradation
  tests/
    bakeArtifacts.test.ts  NEW    risk.test.ts   NEW    seed.test.ts       NEW
    budget.test.ts         NEW    benchmark.test.ts NEW regions.test.ts    NEW
    copy.test.ts           NEW    chartModel.test.ts NEW
    palette.test.ts        MODIFY loadRegion.test.ts MODIFY pipeline.test.ts MODIFY
    fixtures/recombine.json NEW (generated)

docs/
  palette-validation.md   NEW — verbatim validator output and the recorded waiver
```

**Why `classes.bin` rather than a baked flammability field.** Flammability is a lookup from eleven class codes to eleven float64 weights. Shipping the *codes* and applying the lookup in the browser reproduces the Python's float64 flammability values **exactly**, because both sides read the same decimal literals. Shipping a float32 flammability raster would not: `float32(0.55) ≠ float64(0.55)`, and that error would propagate into the recombined risk and break the bit-for-bit anchor. Codes are also 4× smaller.

**Why the mask stops being fetched.** `mask.bin` is `np.isin(classes, forest.BURNABLE)` — entirely derivable from `classes.bin`. Deriving it in the browser keeps one source of truth, keeps the download at 2.70 MB (0.54 MB classes + 2.16 MB activity, replacing 2.16 MB risk + 0.54 MB mask), and makes the class decode load-bearing so a decode bug cannot hide. `risk.bin` and `mask.bin` stay committed as goldens that Node-side tests read directly from disk.

---

### Task 1: Bake the risk components

**Files:**
- Modify: `tools/bake/bake_region.py`
- Create (generated): `web/public/data/los-padres/classes.bin`, `web/public/data/los-padres/activity.bin`, `web/public/data/manifest.json`
- Regenerate: `web/public/data/los-padres/{risk.bin,mask.bin,meta.json}`
- Test: `web/tests/bakeArtifacts.test.ts`

**Interfaces:**
- Consumes: `tools/bake/_repo_import.py:repo_modules(*names)`.
- Produces the on-disk contract every later task reads:
  - `classes.bin` — `nx*ny` uint8 ESA WorldCover class codes, row 0 at the **south** edge
  - `activity.bin` — `nx*ny` little-endian float32, same orientation, the FIRMS activity field
  - `manifest.json` — `{ "baked": string[], "generated": string }`
  - `meta.json` gains: `areaKm2: number`, `riskPeak: number`, `seedTiesAtMax: number`, `flammability: Record<string, number>`, `burnableClasses: number[]`, `weightDefaults: { wBase, wWeather, wActivity }`, `fwiFullScale: number`, `km2PerNode: number`, `budgetLo: number`, `budgetHi: number`

**Why the activity field is snapped to float32 *before* `risk_field` sees it.** The browser will hold `activity.bin` as a `Float32Array`. If the bake computed risk from the float64 activity and only narrowed on write, the browser's recombination would start from a value ~6e-8 different from the one Python used, `risk_field` divides by the field's own peak (so the error is global, not local), and the bit-for-bit anchor in Task 3 would be a coin flip per pixel rather than a guarantee. This is exactly the ruling Plan 1's Task 6 review made for the risk field itself — "the reference must compute on the values the consumer will hold" — applied one layer up.

**This re-bake will rewrite every byte of `risk.bin`.** That is unavoidable: the components do not exist yet and cannot be reconstructed from a float32 raster. Task 2 re-measures the figures that were pinned against the old raster and re-pins them.

- [ ] **Step 1: Confirm the signatures before writing any call**

```bash
cd "C:/Pyra NTE"
python -c "
import inspect, sys, os
sys.path.insert(0, os.path.abspath('tools'))
from bake._repo_import import repo_modules
forest, hazard, plan = repo_modules('forest','hazard','plan')
print(inspect.signature(forest.read_landcover))
print(inspect.signature(forest.flammability_field))
print(inspect.signature(hazard.activity_field))
print(inspect.signature(plan.risk_field))
print(inspect.signature(plan.auto_budget))
print('FLAMMABILITY', forest.FLAMMABILITY)
print('BURNABLE', forest.BURNABLE)
print('FWI_FULL_SCALE', plan.FWI_FULL_SCALE, 'KM2_PER_NODE', plan.KM2_PER_NODE)
"
```

Expected: `activity_field(box, dets, shape, sigma_km=8.0, min_conf=40.0)` with **box first**; `risk_field(classes, activity, fwi_norm, w_weather=0.45, w_activity=0.35, w_base=0.2)`; `FLAMMABILITY {10: 1.0, 20: 1.0, 30: 0.75, 100: 0.55, 40: 0.3, 90: 0.15, 95: 0.1, 50: 0.0, 60: 0.0, 70: 0.0, 80: 0.0}`; `BURNABLE (10, 20, 30, 100, 40)`; `FWI_FULL_SCALE 80.0`; `KM2_PER_NODE 140.0`. If any differ, fix the call site below rather than working around it. (The `sys.path.insert` here is a throwaway one-liner for a shell probe, not code being added to `tools/`.)

- [ ] **Step 2: Record the pre-bake hashes so the change is visible, not silent**

```bash
cd "C:/Pyra NTE"
python -c "
import hashlib, os
d='web/public/data/los-padres'
for f in ('risk.bin','mask.bin'):
    p=os.path.join(d,f)
    print(f, hashlib.sha256(open(p,'rb').read()).hexdigest()[:16], os.path.getsize(p))
"
```

Put both hashes in the Step 8 commit message. If `risk.bin`'s hash is unchanged after the re-bake, nothing downstream moves and Task 2 is a confirmation; if it changed, Task 2 re-pins.

- [ ] **Step 3: Add the component emission to the bake**

In `tools/bake/bake_region.py`, replace the single line

```python
    activity = hazard.activity_field(box, dets, classes.shape)
```

with

```python
    # Snap the activity field to float32 BEFORE risk_field consumes it. The
    # browser will hold activity.bin as a Float32Array and recombine risk from
    # those exact bits; computing risk from the float64 original and narrowing
    # only on write would leave the browser starting ~6e-8 away from what
    # Python used, and risk_field divides by the field's own peak, so that
    # error is global rather than local. Same ruling as the risk field itself
    # (Plan 1, Task 6): the reference computes on the values the consumer holds.
    activity64 = hazard.activity_field(box, dets, classes.shape)
    activity32 = np.ascontiguousarray(activity64, dtype="<f4")
    activity = activity32.astype(np.float64)
```

Immediately after the existing `risk = risk_field(classes, activity, fwi_norm)` line, add the peak recovery and the self-check:

```python
    # risk_field returns the already-normalised field and keeps `peak` to
    # itself, but the browser has to reproduce that division, so recover it by
    # recomputing the pre-normalisation product with the same weights. The
    # assertion is the point: if this arithmetic ever drifts from
    # plan.risk_field's, the bake fails here rather than shipping a raster the
    # browser cannot reproduce.
    _sig = inspect.signature(risk_field).parameters
    W_BASE = float(_sig["w_base"].default)
    W_WEATHER = float(_sig["w_weather"].default)
    W_ACTIVITY = float(_sig["w_activity"].default)
    flam = forest.flammability_field(classes)
    drive = W_BASE + W_WEATHER * float(np.clip(fwi_norm, 0, 1)) + W_ACTIVITY * activity
    unnormalised = flam * drive
    risk_peak = float(unnormalised.max())
    check = unnormalised / risk_peak if risk_peak > 0 else unnormalised
    if not np.array_equal(check, risk):
        raise RuntimeError(
            "the bake's recombination no longer matches plan.risk_field -- "
            "refusing to ship components the browser cannot reproduce"
        )
```

Add the two new rasters next to the existing `risk32.tofile(...)` write:

```python
    # WorldCover codes top out at 100 (moss/lichen), so uint8 is exact. Assert
    # it rather than assume it: a silent wraparound would remap fuel classes.
    if int(classes.max()) > 255 or int(classes.min()) < 0:
        raise RuntimeError(f"class codes out of uint8 range for {name}")
    classes8 = np.ascontiguousarray(classes.astype(np.uint8))
    classes8.tofile(os.path.join(out_dir, "classes.bin"))
    activity32.tofile(os.path.join(out_dir, "activity.bin"))
```

Add to the `meta` dict, directly after `"seedFlatIndex": seed_flat_index,`:

```python
        "areaKm2": float(box.area_km2),
        "riskPeak": risk_peak,
        "seedTiesAtMax": ties_at_max,
        # Published so the browser never hardcodes a constant the model owns.
        "flammability": {str(int(k)): float(v)
                         for k, v in forest.FLAMMABILITY.items()},
        "burnableClasses": [int(c) for c in forest.BURNABLE],
        "weightDefaults": {"wBase": W_BASE, "wWeather": W_WEATHER,
                           "wActivity": W_ACTIVITY},
        "fwiFullScale": float(plan.FWI_FULL_SCALE),
        "km2PerNode": float(plan.KM2_PER_NODE),
        # plan_region's own budget clamps -- NOT auto_budget's (3, 40) defaults.
        "budgetLo": int(inspect.signature(plan.plan_region)
                        .parameters["budget_lo"].default),
        "budgetHi": int(inspect.signature(plan.plan_region)
                        .parameters["budget_hi"].default),
```

`bake_region.py` already binds `forest, hazard, plan = repo_modules("forest", "hazard", "plan")` at module scope and already imports `inspect` and `numpy as np`, so nothing new needs importing.

- [ ] **Step 4: Emit the manifest**

Add to `tools/bake/bake_region.py`, above `main`:

```python
def write_manifest() -> str:
    """List the regions that actually have baked data on disk.

    The web app must degrade honestly on an unbaked region -- say so in the
    picker rather than fetching a 404 and showing an error. Scanning the
    directory rather than restating a list means the manifest cannot claim a
    region that was never baked.
    """
    baked = sorted(
        name for name in os.listdir(OUT_ROOT)
        if os.path.isfile(os.path.join(OUT_ROOT, name, "meta.json"))
    )
    path = os.path.join(OUT_ROOT, "manifest.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({
            "baked": baked,
            "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        }, fh, indent=1)
    print(f"manifest: {len(baked)} baked region(s) -> {baked}")
    return path
```

and call it at the end of `main`, immediately before `return 0`:

```python
    write_manifest()
```

- [ ] **Step 5: Re-bake Los Padres**

```bash
cd "C:/Pyra NTE"
python -m tools.bake.bake_region --region los-padres
```

Expected: the land-cover, FIRMS and FWI lines as before, a `seed flat index …` line, `wrote …/los-padres (900x600)` and `manifest: 1 baked region(s) -> ['los-padres']`. If the self-check in Step 3 raises, stop — do not weaken the assertion.

- [ ] **Step 6: Write the failing artifact-contract test**

Create `web/tests/bakeArtifacts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', 'public', 'data')
const DIR = join(ROOT, 'los-padres')

/**
 * Node's readFileSync returns a Buffer that may be a view into a pooled
 * allocation, so `buf.buffer` alone would read the wrong bytes. Slice by the
 * view's own offset and length — the trap Plan 1's Task 11 handled.
 */
function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8'))

describe('baked component artifacts', () => {
  it('publishes the model constants instead of leaving them to be guessed', () => {
    expect(meta.flammability['10']).toBe(1)
    expect(meta.flammability['30']).toBe(0.75)
    expect(meta.flammability['100']).toBe(0.55)
    expect(meta.flammability['40']).toBe(0.3)
    expect(meta.flammability['80']).toBe(0)
    expect(meta.burnableClasses.slice().sort((a: number, b: number) => a - b))
      .toEqual([10, 20, 30, 40, 100])
    expect(meta.weightDefaults).toEqual({ wBase: 0.2, wWeather: 0.45, wActivity: 0.35 })
    expect(meta.fwiFullScale).toBe(80)
    expect(meta.km2PerNode).toBe(140)
    expect(meta.budgetLo).toBe(6)
    expect(meta.budgetHi).toBe(40)
    expect(meta.riskPeak).toBeGreaterThan(0)
    expect(meta.areaKm2).toBeGreaterThan(1000)
  })

  it('sizes classes.bin and activity.bin to the declared grid', () => {
    const n = meta.nx * meta.ny
    expect(bytes('classes.bin').length).toBe(n)
    expect(bytes('activity.bin').length).toBe(n * 4)
    expect(bytes('risk.bin').length).toBe(n * 4)
    expect(bytes('mask.bin').length).toBe(n)
  })

  it('only emits class codes the flammability table knows about', () => {
    const known = new Set(Object.keys(meta.flammability).map(Number))
    const seen = new Set<number>()
    for (const c of bytes('classes.bin')) seen.add(c)
    for (const c of seen) expect(known.has(c) || c === 0).toBe(true)
    expect(seen.size).toBeGreaterThan(3)
  })

  it('derives mask.bin exactly from classes.bin', () => {
    const classes = bytes('classes.bin')
    const mask = bytes('mask.bin')
    const burnable = new Set<number>(meta.burnableClasses)
    let mismatches = 0
    let firstBad = -1
    for (let i = 0; i < classes.length; i++) {
      const want = burnable.has(classes[i]) ? 1 : 0
      if (mask[i] !== want) { if (firstBad < 0) firstBad = i; mismatches++ }
    }
    expect({ mismatches, firstBad }).toEqual({ mismatches: 0, firstBad: -1 })
  })

  it('keeps the activity field finite, non-negative, and peaked at 1', () => {
    const a = bytes('activity.bin')
    const f = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4)
    let max = -Infinity
    let bad = 0
    for (let i = 0; i < f.length; i++) {
      if (!Number.isFinite(f[i]) || f[i] < 0) bad++
      if (f[i] > max) max = f[i]
    }
    expect(bad).toBe(0)
    // hazard.activity_field normalises to its own peak inside the box.
    expect(max).toBeCloseTo(1, 6)
  })

  it('reports a seed index that is in range and on a burnable pixel', () => {
    const classes = bytes('classes.bin')
    const burnable = new Set<number>(meta.burnableClasses)
    expect(Number.isInteger(meta.seedFlatIndex)).toBe(true)
    expect(meta.seedFlatIndex).toBeGreaterThanOrEqual(0)
    expect(meta.seedFlatIndex).toBeLessThan(meta.nx * meta.ny)
    expect(burnable.has(classes[meta.seedFlatIndex])).toBe(true)
    expect(meta.seedTiesAtMax).toBeGreaterThanOrEqual(1)
  })
})

describe('data manifest', () => {
  it('lists exactly the region directories that hold a meta.json', () => {
    const onDisk = readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, 'meta.json')))
      .map((d) => d.name)
      .sort()
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'))
    expect(manifest.baked.slice().sort()).toEqual(onDisk)
    expect(onDisk).toContain('los-padres')
  })
})
```

**The mutation each test catches.** *Constants:* a bake that stops reading `forest.FLAMMABILITY` and restates a table, or a later TS file hardcoding a weight. *Sizes:* emitting `activity.bin` as float64 (`n*8`) or dropping the `<f4` byte-order tag. *Known codes:* writing the flammability raster into `classes.bin`, or an int16→uint8 truncation. *Mask derivation:* a wrong `BURNABLE` set, or a vertical flip applied to one raster and not the other. *Activity range:* dropping `min_conf` or writing the un-normalised kernel. *Seed:* resolving the seed against the unmasked grid — a non-burnable seed makes `variablePoissonDisk` return empty, which Plan 1's Task 12 guard turns into a hard error.

- [ ] **Step 7: Run the tests**

```bash
cd web && npm test -- bakeArtifacts
```

Expected: PASS, 7 tests. Then `npm test` (expect 145 passing) and `npm run build`.

- [ ] **Step 8: Commit**

```bash
cd "C:/Pyra NTE"
git add tools/bake/bake_region.py web/public/data web/tests/bakeArtifacts.test.ts
git commit -m "feat(bake): emit risk components (classes, activity) and a region manifest

The browser can now recombine the risk field itself, so w_weather and
w_activity become live controls. Activity is snapped to float32 before
risk_field consumes it, so the browser's recombination starts from the
exact bits Python used.

pre-bake  sha256(risk.bin)[:16] = <hash from Step 2>
post-bake sha256(risk.bin)[:16] = <hash now>"
```

---

### Task 2: An independent Python reference, and re-pinned figures

**Files:**
- Create: `tools/bake/verify_parity.py`
- Modify: `web/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `repo_modules("place")`, `tools/bake/refrng.py:RefRNG`, the committed `web/public/data/los-padres/*`.
- Produces: `tools/bake/verify_parity.py:run(region="los-padres", **over) -> dict` and `main()`, printing JSON with `candidateCount`, `nodeCount`, `coveredFraction`, `areaFraction`, `reductionPct`, `chosenSha256`, `demandCount`. No TypeScript module.

**Why this exists.** Plan 1's headline claim — the TypeScript reproduces `place.py` exactly on real data — was established once, by a reviewer, in a throwaway script. Task 1 just rewrote the raster that claim was measured against. A claim that can only be re-checked by hand is a claim that quietly rots. This makes the reference run a committed, repeatable command, while the TS assertions stay **hand-transcribed literals** so the test is two independent implementations agreeing rather than a program agreeing with its own output.

- [ ] **Step 1: Write the reference runner**

Create `tools/bake/verify_parity.py`:

```python
"""Run place.py over the committed rasters and print what it gets.

    python -m tools.bake.verify_parity

This is the Python half of the parity claim. The TypeScript suite asserts
the same numbers as hand-written literals; if the two ever disagree, one of
them changed and the site is misreporting the team's own model. Do not
"fix" a disagreement by copying this output into the test -- find the cause.
"""

from __future__ import annotations

import hashlib
import json
import os

import numpy as np

from ._repo_import import repo_modules
from .refrng import RefRNG

place, = repo_modules("place")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "..", "web", "public", "data"))

#: The Lab's defaults. plan_region's saturation regime gives the spacing:
#: detect_km * 0.55 and detect_km * 1.30. demand_stride 4 matches
#: web/src/state/useModelStore.ts:DEFAULT_PARAMS.
DEFAULTS = dict(seed=7, detect_km=2.0, r_min_km=1.1, r_max_km=2.6,
                target=0.95, demand_stride=4)


def run(region: str = "los-padres", **over) -> dict:
    p = dict(DEFAULTS, **over)
    d = os.path.join(DATA, region)
    with open(os.path.join(d, "meta.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    ny, nx = meta["ny"], meta["nx"]
    risk = np.fromfile(os.path.join(d, "risk.bin"), dtype="<f4").reshape(ny, nx)
    mask = np.fromfile(os.path.join(d, "mask.bin"),
                       dtype=np.uint8).reshape(ny, nx).astype(bool)
    w_km, h_km = meta["widthKm"], meta["heightKm"]

    cand = place.variable_poisson_disk(
        RefRNG(p["seed"]), risk, w_km, h_km, p["r_min_km"], p["r_max_km"],
        mask=mask, k=24,
    )
    dem_xy, dem_w = place.demand_points(risk, mask, w_km, h_km,
                                        stride=p["demand_stride"])
    cov = place.greedy_minimise(cand, dem_xy, dem_w, p["detect_km"],
                                target=p["target"])
    chosen = [int(i) for i in cov.chosen]
    n_cand = int(len(cand))
    return {
        "region": region,
        "params": p,
        "seedFlatIndex": meta["seedFlatIndex"],
        "demandCount": int(len(dem_w)),
        "candidateCount": n_cand,
        "nodeCount": len(chosen),
        "coveredFraction": repr(float(cov.covered_fraction)),
        "areaFraction": repr(float(cov.area_fraction)),
        "reductionPct": repr(100.0 * (1.0 - len(chosen) / n_cand)),
        "chosenSha256": hashlib.sha256(
            ",".join(str(i) for i in chosen).encode()).hexdigest(),
        "firstTenChosen": chosen[:10],
    }


def main(argv=None) -> int:
    print(json.dumps(run(), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

`place.variable_poisson_disk` takes its generator first and calls only `rng.integers(n)` and `rng.random(k)`, which is why `RefRNG` is a drop-in and `place.py` needs no change.

- [ ] **Step 2: Run it and read the numbers**

```bash
cd "C:/Pyra NTE"
python -m tools.bake.verify_parity
```

Record `candidateCount`, `nodeCount`, `coveredFraction`, `areaFraction`, `reductionPct`, `demandCount` and `chosenSha256`. Measured against the **pre-Task-1** rasters these were `927`, `572`, `0.950127412638781`, `0.948204219681108`, `38.29557713052859`, `31045`. If Task 1's re-bake left `risk.bin`'s hash unchanged they will be identical; if not, the Step 2 output is the new truth and everything downstream uses it.

- [ ] **Step 3: Re-pin the TypeScript literals**

In `web/tests/pipeline.test.ts`, replace the existing real-data assertions with a single block pinned to Step 2, and add the chosen-sequence digest so the test pins the whole selection rather than its length:

```ts
import { createHash } from 'node:crypto'

// Hand-transcribed from `python -m tools.bake.verify_parity`. NOT generated
// into this file: this test is worth having only because a Python run and a
// TypeScript run, written independently, arrive at the same numbers. If it
// fails, find the divergence — never re-baseline it from the TS output.
const PARITY = {
  demandCount: 31045,
  candidateCount: 927,
  nodeCount: 572,
  coveredFraction: 0.950127412638781,
  areaFraction: 0.948204219681108,
  chosenSha256: '<paste from Step 2>',
}

it('reproduces the Python reference run on the committed rasters', () => {
  const r = runPlacement(losPadres(), DEFAULT_PARAMS)
  expect(r.candidateCount).toBe(PARITY.candidateCount)
  expect(r.nodeCount).toBe(PARITY.nodeCount)
  expect(r.coveredFraction).toBe(PARITY.coveredFraction)
  expect(r.areaFraction).toBe(PARITY.areaFraction)
  expect(createHash('sha256').update(r.chosen.join(',')).digest('hex'))
    .toBe(PARITY.chosenSha256)
})
```

**The mutation this catches.** Any change to the placement chain that alters *which* candidates are selected while leaving the count intact — a reordered heap tiebreak, a lost `pairwiseSum`, a one-cell shift in `sampleField`. Plan 1's ledger recorded exactly this gap: a count assertion did not notice `pairwiseSum` being replaced by a naive loop.

- [ ] **Step 4: Run the tests**

```bash
cd web && npm test -- pipeline
```

Expected: PASS. Then `npm test` (expect 146 passing) and `npm run build`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add tools/bake/verify_parity.py web/tests/pipeline.test.ts
git commit -m "test: committed Python parity reference, and pin the chosen sequence

verify_parity.py runs place.py over the committed rasters so the parity
claim can be re-checked with one command. The TS test now pins a sha256 of
the whole chosen sequence, not just its length."
```

---

### Task 3: Recombine the risk field in the browser — the bit-for-bit anchor

**Files:**
- Create: `web/src/lib/risk.ts`
- Modify: `web/src/lib/types.ts`
- Modify: `tools/bake/export_fixtures.py` (add `recombine_fixture`)
- Create (generated): `web/tests/fixtures/recombine.json`
- Test: `web/tests/risk.test.ts`

**Interfaces:**
- Consumes: `Field` from `types.ts`.
- Produces:
  - `interface ClassField { data: Uint8Array; nx: number; ny: number }` (added to `types.ts`)
  - `interface Weights { wWeather: number; wActivity: number }`
  - `const WEIGHT_SUM_MAX = 1`
  - `function wBaseFor(w: Weights): number` — `1 - wWeather - wActivity`
  - `function clampWeights(w: Weights): Weights` — scales `wActivity` down so the pair sums to at most 1
  - `function flammabilityLut(table: Record<string, number>): Float64Array` — 256 entries, unknown codes 0
  - `interface RiskInputs { classes: ClassField; activity: Float32Array; fwiNorm: number; lut: Float64Array }`
  - `interface RiskResult { risk: Field; peak: number }`
  - `function recombineRisk(inp: RiskInputs, w: Weights): RiskResult`
  - `function burnableMaskOf(classes: ClassField, burnable: number[]): Field`
  - `function meanOverMask(risk: Field, mask: Field): number`

**The arithmetic, matched statement for statement against `plan.py:112-128`.** Python evaluates

```python
drive = w_base + w_weather * float(np.clip(fwi_norm, 0, 1)) + w_activity * activity
r     = flam * drive
peak  = float(r.max())
return r / peak if peak > 0 else r
```

Left-associativity makes `drive` per pixel equal to `(w_base + w_weather*fwiClamped) + w_activity*activity_i`, with the parenthesised part a **scalar computed once**. The TypeScript must compute that scalar once too and then do exactly one multiply and one add per pixel; folding the terms differently (for instance `w_base + (w_weather*fwi + w_activity*act_i)`) is a different rounding and breaks the anchor. Every operand is a float64 on both sides — `flam` from the same decimal literals via `meta.flammability`, `activity` widened from the same float32 bits — and IEEE-754 double multiply, add, max and divide are deterministic, so the float64 intermediate is identical. Narrowing to float32 then matches, because writing a double into a `Float32Array` and `np.ascontiguousarray(..., dtype="<f4")` are both round-to-nearest-even.

- [ ] **Step 1: Add the fixture generator**

In `tools/bake/export_fixtures.py`, add this function and call it from `__main__`:

```python
def recombine_fixture() -> None:
    """Small, hand-built cases pinning the recombination at several weights.

    Deliberately not real data: the real-data case is the bit-for-bit test in
    web/tests/risk.test.ts, which reads the committed rasters directly. These
    cases exist to exercise weight settings the shipped raster cannot -- zero
    activity weight, zero base weight, a nonzero fwiNorm, and a peak that lands
    on a grassland pixel rather than a tree pixel.
    """
    import numpy as np

    forest, plan = repo_modules("forest", "plan")

    # Codes chosen to span the flammability table: tree, shrub, grass, crop,
    # moss, water (flammability 0), built (flammability 0).
    classes = np.array([
        [10, 20, 30, 40],
        [100, 80, 50, 10],
        [30, 30, 10, 20],
    ], dtype=np.uint8)
    ny, nx = classes.shape
    activity32 = np.ascontiguousarray(
        (np.arange(ny * nx, dtype=np.float64).reshape(ny, nx) / (ny * nx - 1)),
        dtype="<f4",
    )
    activity = activity32.astype(np.float64)

    cases = []
    for fwi_norm, w_weather, w_activity in [
        (0.6103508388605902, 0.45, 0.35),   # the shipped default
        (0.6103508388605902, 0.45, 0.00),   # activity off: a huge plateau
        (0.0, 0.00, 1.00),                  # base off: pure activity
        (1.0, 1.00, 0.00),                  # weather saturated
        (0.25, 0.10, 0.60),                 # an off-centre pair
    ]:
        w_base = 1.0 - w_weather - w_activity
        r = plan.risk_field(classes, activity, fwi_norm,
                            w_weather=w_weather, w_activity=w_activity,
                            w_base=w_base)
        flam = forest.flammability_field(classes)
        drive = (w_base + w_weather * float(np.clip(fwi_norm, 0, 1))
                 + w_activity * activity)
        peak = float((flam * drive).max())
        cases.append({
            "fwiNorm": fwi_norm,
            "wWeather": w_weather, "wActivity": w_activity, "wBase": w_base,
            "peak": peak,
            # float32 exactly as the browser will hold it
            "risk32": [float(x) for x in
                       np.ascontiguousarray(r, dtype="<f4").ravel()],
        })

    _write("recombine.json", {
        "nx": int(nx), "ny": int(ny),
        "classes": [int(c) for c in classes.ravel()],
        "activity32": [float(a) for a in activity32.ravel()],
        "flammability": {str(int(k)): float(v)
                         for k, v in forest.FLAMMABILITY.items()},
        "burnableClasses": [int(c) for c in forest.BURNABLE],
        "cases": cases,
    })
```

`export_fixtures.py` already imports `repo_modules` and defines `_write`. Add `recombine_fixture()` to the `__main__` block alongside the existing generators.

- [ ] **Step 2: Generate it**

```bash
cd "C:/Pyra NTE"
python -m tools.bake.export_fixtures
python -c "
import json;d=json.load(open('web/tests/fixtures/recombine.json'))
print(len(d['cases']),'cases', d['nx'],'x',d['ny'])
for c in d['cases']:
    print(' wW',c['wWeather'],'wA',c['wActivity'],'peak',round(c['peak'],6),'max',max(c['risk32']))
"
```

Expected: 5 cases on a 4x3 grid, every `max` exactly `1.0` (the field is normalised to its own peak), and the four `peak` values differing between cases. If every `peak` is the same, the weights are not reaching `risk_field`.

- [ ] **Step 3: Write the failing test**

Create `web/tests/risk.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  recombineRisk, flammabilityLut, burnableMaskOf, wBaseFor, clampWeights,
  meanOverMask,
} from '../src/lib/risk'
import fixture from './fixtures/recombine.json'

const f = fixture as any
const DIR = join(__dirname, '..', 'public', 'data', 'los-padres')

function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

describe('wBaseFor / clampWeights', () => {
  it('makes the base weight the remainder', () => {
    expect(wBaseFor({ wWeather: 0.45, wActivity: 0.35 })).toBeCloseTo(0.2, 12)
    expect(wBaseFor({ wWeather: 0, wActivity: 0 })).toBe(1)
  })

  it('never lets the pair sum above one, and never returns a negative base', () => {
    const c = clampWeights({ wWeather: 0.9, wActivity: 0.8 })
    expect(c.wWeather).toBe(0.9)
    expect(c.wActivity).toBeCloseTo(0.1, 12)
    expect(wBaseFor(c)).toBeGreaterThanOrEqual(0)
  })

  it('leaves an already-legal pair untouched', () => {
    expect(clampWeights({ wWeather: 0.45, wActivity: 0.35 }))
      .toEqual({ wWeather: 0.45, wActivity: 0.35 })
  })
})

describe('flammabilityLut', () => {
  it('maps every published code and leaves the rest at zero', () => {
    const lut = flammabilityLut(f.flammability)
    expect(lut.length).toBe(256)
    expect(lut[10]).toBe(1)
    expect(lut[30]).toBe(0.75)
    expect(lut[100]).toBe(0.55)
    expect(lut[80]).toBe(0)
    expect(lut[0]).toBe(0)
    expect(lut[255]).toBe(0)
  })
})

describe('recombineRisk reproduces plan.risk_field', () => {
  const classes = { nx: f.nx, ny: f.ny, data: Uint8Array.from(f.classes) }
  const activity = Float32Array.from(f.activity32)
  const lut = flammabilityLut(f.flammability)

  for (const c of f.cases as any[]) {
    it(`matches float32-for-float32 at wWeather=${c.wWeather} wActivity=${c.wActivity}`, () => {
      const out = recombineRisk(
        { classes, activity, fwiNorm: c.fwiNorm, lut },
        { wWeather: c.wWeather, wActivity: c.wActivity },
      )
      expect(out.risk.data.length).toBe(c.risk32.length)
      for (let i = 0; i < c.risk32.length; i++) {
        // Exact equality, not a tolerance. Both sides are float32 values
        // produced by the same float64 arithmetic and the same rounding.
        expect(out.risk.data[i]).toBe(c.risk32[i])
      }
      expect(out.peak).toBe(c.peak)
    })
  }
})

describe('recombineRisk on the real region', () => {
  const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8'))

  function inputs() {
    const cb = bytes('classes.bin')
    const ab = bytes('activity.bin')
    return {
      classes: { nx: meta.nx, ny: meta.ny, data: cb },
      activity: new Float32Array(ab.buffer, ab.byteOffset, ab.byteLength / 4),
      fwiNorm: meta.fwiNorm as number,
      lut: flammabilityLut(meta.flammability),
    }
  }

  it('reproduces the committed risk.bin bit for bit at the default weights', () => {
    const rb = bytes('risk.bin')
    const baked = new Float32Array(rb.buffer, rb.byteOffset, rb.byteLength / 4)
    const out = recombineRisk(inputs(), {
      wWeather: meta.weightDefaults.wWeather,
      wActivity: meta.weightDefaults.wActivity,
    })
    let diffs = 0
    let firstBad = -1
    for (let i = 0; i < baked.length; i++) {
      if (out.risk.data[i] !== baked[i]) { if (firstBad < 0) firstBad = i; diffs++ }
    }
    expect({ diffs, firstBad }).toEqual({ diffs: 0, firstBad: -1 })
    expect(out.peak).toBe(meta.riskPeak)
  })

  it('changes the field when the weights change', () => {
    const a = recombineRisk(inputs(), { wWeather: 0.45, wActivity: 0.35 })
    const b = recombineRisk(inputs(), { wWeather: 0.45, wActivity: 0 })
    let diffs = 0
    for (let i = 0; i < a.risk.data.length; i++) {
      if (a.risk.data[i] !== b.risk.data[i]) diffs++
    }
    expect(diffs).toBeGreaterThan(1000)
  })

  it('derives the burnable mask that mask.bin recorded', () => {
    const m = burnableMaskOf(inputs().classes, meta.burnableClasses)
    const baked = bytes('mask.bin')
    let diffs = 0
    for (let i = 0; i < baked.length; i++) {
      if (m.data[i] !== baked[i]) diffs++
    }
    expect(diffs).toBe(0)
  })

  it('reports the mean risk over burnable ground that auto-budget uses', () => {
    const inp = inputs()
    const m = burnableMaskOf(inp.classes, meta.burnableClasses)
    const r = recombineRisk(inp, {
      wWeather: meta.weightDefaults.wWeather,
      wActivity: meta.weightDefaults.wActivity,
    })
    // Measured against the committed rasters with numpy: risk[mask].mean().
    expect(meanOverMask(r.risk, m)).toBeCloseTo(0.5062295198440552, 6)
  })
})
```

**The mutation each test catches.** *Fixture cases:* re-associating the drive terms; dropping the `/peak` normalisation (every `max` stops being 1.0); clipping `fwiNorm` in the wrong place; applying flammability additively. *Bit-for-bit real-data case:* the single most valuable assertion in this plan — a float32 activity read as float64, a wrong LUT literal, a transposed raster, or a `Math.round` where round-to-nearest-even is required all fail it. *Weights-change case:* an implementation that ignores the weights and returns the baked field would pass the bit-for-bit test and fail this one. *Mask derivation:* a wrong burnable set. *Mean risk:* a mean taken over the whole grid instead of the mask (that value is ≈0.4668, not 0.5062, so the assertion bites).

- [ ] **Step 4: Run it and watch it fail**

```bash
cd web && npm test -- risk
```

Expected: FAIL — cannot resolve `../src/lib/risk`.

- [ ] **Step 5: Add `ClassField` to `types.ts`**

Append to `web/src/lib/types.ts`:

```ts
/**
 * A 2D field of ESA WorldCover class codes, row-major, row 0 at the SOUTH
 * edge — the same orientation as `Field`. Codes are shipped rather than a
 * pre-computed flammability raster so the browser can apply the model's own
 * float64 lookup table and reproduce Python exactly; a float32 flammability
 * raster could not (float32(0.55) is not float64(0.55)).
 */
export interface ClassField {
  data: Uint8Array
  nx: number
  ny: number
}
```

- [ ] **Step 6: Implement the recombination**

Create `web/src/lib/risk.ts`:

```ts
import type { ClassField, Field } from './types'

/** The two drive weights the Lab exposes. `w_base` is their remainder. */
export interface Weights {
  wWeather: number
  wActivity: number
}

/** The drive weights are a partition of 1, so the pair can never exceed it. */
export const WEIGHT_SUM_MAX = 1

/**
 * `w_base` is not an independent control — it is whatever the other two leave.
 * The Lab shows it and never lets it go negative, because a negative base
 * would make unburnt, unwatched ground score below zero and invert the
 * spacing rule that reads the field.
 */
export function wBaseFor(w: Weights): number {
  return WEIGHT_SUM_MAX - w.wWeather - w.wActivity
}

/**
 * Force a legal pair by giving way on the activity weight. The UI drives both
 * sliders through this, so dragging one never silently pushes `w_base`
 * negative behind the reader's back.
 */
export function clampWeights(w: Weights): Weights {
  const wWeather = Math.min(Math.max(w.wWeather, 0), WEIGHT_SUM_MAX)
  const room = WEIGHT_SUM_MAX - wWeather
  return { wWeather, wActivity: Math.min(Math.max(w.wActivity, 0), room) }
}

/**
 * A 256-entry lookup from WorldCover class code to flammability weight.
 *
 * The table comes from `meta.flammability`, which the bake reads straight out
 * of `forest.FLAMMABILITY` — never restate it here. Codes absent from the
 * table weigh 0, which is what `forest.flammability_field` does: it starts
 * from `np.zeros` and only writes the entries whose weight is above zero.
 */
export function flammabilityLut(table: Record<string, number>): Float64Array {
  const lut = new Float64Array(256)
  for (const [code, weight] of Object.entries(table)) {
    const c = Number(code)
    if (Number.isInteger(c) && c >= 0 && c < 256) lut[c] = weight
  }
  return lut
}

export interface RiskInputs {
  classes: ClassField
  /** The baked FIRMS activity field, already float32. */
  activity: Float32Array
  /** The region's single fire-weather scalar. */
  fwiNorm: number
  lut: Float64Array
}

export interface RiskResult {
  risk: Field
  /** The pre-normalisation maximum, i.e. what the field was divided by. */
  peak: number
}

/**
 * `risk = flammability(landcover) * (w_base + w_weather*fwiNorm +
 * w_activity*activity)`, then divided by its own maximum so the peak is
 * exactly 1.0. A port of `plan.risk_field`, statement for statement.
 *
 * Two things are load-bearing and must not be "tidied":
 *
 *  1. `drive` is `(w_base + w_weather*fwi) + w_activity*act_i`. Python's
 *     left-associative expression computes the parenthesised part ONCE as a
 *     scalar; folding the three terms in any other order is a different
 *     rounding, and this function's whole job is to land on the same float32
 *     bits as the committed risk.bin.
 *  2. Flammability MULTIPLIES. No amount of fire weather makes open water
 *     flammable, and a purely additive model sites sensors in lakes.
 *
 * The `/peak` step is why risk values are comparable only within one region:
 * a 1.0 here and a 1.0 elsewhere are not the same absolute danger.
 */
export function recombineRisk(inp: RiskInputs, w: Weights): RiskResult {
  const { classes, activity, lut } = inp
  const n = classes.nx * classes.ny
  const { wWeather, wActivity } = clampWeights(w)
  const wBase = wBaseFor({ wWeather, wActivity })

  const fwi = inp.fwiNorm < 0 ? 0 : inp.fwiNorm > 1 ? 1 : inp.fwiNorm
  const s = wBase + wWeather * fwi          // the scalar half of `drive`

  const raw = new Float64Array(n)
  let peak = 0
  for (let i = 0; i < n; i++) {
    const v = lut[classes.data[i]] * (s + wActivity * activity[i])
    raw[i] = v
    if (v > peak) peak = v
  }

  const out = new Float32Array(n)
  if (peak > 0) {
    // Assigning a double into a Float32Array rounds to nearest-even, the same
    // rule numpy's astype('<f4') uses. Math.fround is written out so the
    // narrowing is visible rather than incidental.
    for (let i = 0; i < n; i++) out[i] = Math.fround(raw[i] / peak)
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.fround(raw[i])
  }

  return { risk: { nx: classes.nx, ny: classes.ny, data: out }, peak }
}

/**
 * The burnable mask, as `forest.burnable_mask` computes it: membership of
 * `forest.BURNABLE`. Kept as a `Field` of 0/1 because every consumer
 * (`allowedAt`, `demandPoints`) already takes one.
 */
export function burnableMaskOf(classes: ClassField, burnable: number[]): Field {
  const allow = new Uint8Array(256)
  for (const c of burnable) if (c >= 0 && c < 256) allow[c] = 1
  const n = classes.nx * classes.ny
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = allow[classes.data[i]]
  return { nx: classes.nx, ny: classes.ny, data }
}

/**
 * Mean of `risk` over the pixels the mask allows.
 *
 * `plan_region` feeds exactly this to `auto_budget` (`risk[burn].mean()`), so
 * it has to be the masked mean and not the grid mean — on Los Padres those
 * are 0.5062 and 0.4668, which is a different budget.
 */
export function meanOverMask(risk: Field, mask: Field): number {
  let sum = 0
  let count = 0
  for (let i = 0; i < risk.data.length; i++) {
    if (mask.data[i] > 0.5) { sum += risk.data[i]; count++ }
  }
  return count > 0 ? sum / count : 0
}
```

- [ ] **Step 7: Run the tests**

```bash
cd web && npm test -- risk
```

Expected: PASS, 13 tests. If the bit-for-bit case fails, do **not** loosen it to a tolerance — print the first differing index and compare that pixel's class code, activity value and both float64 intermediates against a Python probe. A tolerance here would let the site claim a parity it does not have.

Then `npm test` (expect 159 passing) and `npm run build`.

- [ ] **Step 8: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/risk.ts web/src/lib/types.ts web/tests/risk.test.ts \
        web/tests/fixtures/recombine.json tools/bake/export_fixtures.py
git commit -m "feat(web): recombine the risk field from baked components

Reproduces the committed risk.bin bit for bit at the default weights, so
w_weather and w_activity can move without the field ceasing to be the
model's own output."
```

---

### Task 4: Resolve the blue-noise seed in the browser

**Files:**
- Create: `web/src/lib/seed.ts`
- Test: `web/tests/seed.test.ts`

**Interfaces:**
- Consumes: `Field` from `types.ts`.
- Produces:
  - `interface SeedResolution { index: number; tiesAtMax: number; allowedCount: number; maxRisk: number }`
  - `function resolveSeedIndex(risk: Field, mask: Field): SeedResolution`

**The decision this task encodes, and why.**

`place.variable_poisson_disk` seeds its sampler at the highest-risk allowed pixel, found by scanning `np.argsort(risk, axis=None)[::-1]`. numpy's default `argsort` is an unstable introsort, so when several pixels tie at the maximum, *which* one it returns is a property of quicksort's partitioning. Plan 1 resolved that by computing the index in Python and shipping it in `meta.json` — correct then, because the risk field was frozen at bake time. It is not correct now: once `w_weather` and `w_activity` move, the field moves, and the argmax genuinely relocates. Concretely, at the shipped weights a grassland pixel at full activity scores `0.75 × (0.4747 + 0.35) = 0.618` and beats a tree pixel with no activity at `1.00 × 0.4747 = 0.475`; set `w_activity` to 0 and the tree pixel wins. A frozen seed would put the sampler on a pixel that is not the maximum at all.

**The rule this plan commits to: the seed is the mask-allowed pixel with the greatest recombined risk, ties broken by the lowest flat index — recomputed in the browser on every run. The baked `seedFlatIndex` stops being a runtime input and becomes a cross-check.**

Three reasons.

1. *It is a refinement of the algorithm, not a deviation from it.* `place.py`'s rule is "the highest-risk allowed pixel". When pixels tie, the rule does not say which — numpy's answer is an artifact of its sort, not a specification. Choosing the lowest flat index completes an underspecified rule with a total order both languages can evaluate. Freezing a stale index, by contrast, would violate the rule itself the moment the argmax moves, and the Lab's entire claim is that it runs the real model.
2. *It costs nothing on the shipped data.* Measured over the committed rasters: the burnable maximum is 1.0, **exactly one** pixel attains it, and the lowest-flat-index argmax over allowed pixels is **539100** — identical to the baked `seedFlatIndex`, and `meta.seedTiesAtMax` is 1. So the parity chain established in Plan 1 is untouched at the default weights, and a test says so.
3. *Where it can diverge, it says so out loud.* When the current weights produce `tiesAtMax > 1` — which `w_activity = 0` does, since the activity term is then the only thing separating same-class pixels — the browser's tie-break is *a* valid seed but not necessarily numpy's. `SeedResolution.tiesAtMax` carries that fact up to the UI, which labels the run (Task 11). An honest label beats a hidden branch.

Rejected: *freeze the baked index for every weight setting* — silently stops being the maximum, so the browser is no longer running the algorithm. Rejected: *bake a seed per point on a weight grid* — still wrong between grid points, and unbounded in the region×weight product. Rejected: *keep numpy's unstable order* — not reproducible by any second sort implementation, which is the exact defect Plan 1 spent a fix round removing.

- [ ] **Step 1: Write the failing test**

Create `web/tests/seed.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSeedIndex } from '../src/lib/seed'
import { recombineRisk, flammabilityLut, burnableMaskOf } from '../src/lib/risk'
import type { Field } from '../src/lib/types'

const DIR = join(__dirname, '..', 'public', 'data', 'los-padres')
const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8'))

function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

const field = (nx: number, ny: number, v: number[]): Field =>
  ({ nx, ny, data: Float32Array.from(v) })

describe('resolveSeedIndex', () => {
  it('picks the greatest allowed value', () => {
    const risk = field(3, 1, [0.1, 0.9, 0.4])
    const mask = field(3, 1, [1, 1, 1])
    expect(resolveSeedIndex(risk, mask).index).toBe(1)
  })

  it('ignores pixels the mask disallows even when they are the global max', () => {
    const risk = field(3, 1, [0.1, 0.9, 0.4])
    const mask = field(3, 1, [1, 0, 1])
    const r = resolveSeedIndex(risk, mask)
    expect(r.index).toBe(2)
    expect(r.maxRisk).toBeCloseTo(0.4, 6)
    expect(r.allowedCount).toBe(2)
  })

  it('breaks ties on the lowest flat index and counts them', () => {
    const risk = field(4, 1, [0.5, 0.5, 0.2, 0.5])
    const mask = field(4, 1, [1, 1, 1, 1])
    const r = resolveSeedIndex(risk, mask)
    expect(r.index).toBe(0)
    expect(r.tiesAtMax).toBe(3)
  })

  it('counts ties only among allowed pixels', () => {
    const risk = field(4, 1, [0.5, 0.5, 0.5, 0.5])
    const mask = field(4, 1, [0, 1, 0, 1])
    const r = resolveSeedIndex(risk, mask)
    expect(r.index).toBe(1)
    expect(r.tiesAtMax).toBe(2)
    expect(r.allowedCount).toBe(2)
  })

  it('reports index -1 when nothing is allowed', () => {
    const r = resolveSeedIndex(field(2, 1, [1, 1]), field(2, 1, [0, 0]))
    expect(r.index).toBe(-1)
    expect(r.allowedCount).toBe(0)
  })

  it('uses the same 0.5 mask threshold place.py does', () => {
    const risk = field(2, 1, [0.2, 0.9])
    expect(resolveSeedIndex(risk, field(2, 1, [1, 0.5])).index).toBe(0)
    expect(resolveSeedIndex(risk, field(2, 1, [1, 0.51])).index).toBe(1)
  })
})

describe('resolveSeedIndex against the baked seed', () => {
  function real() {
    const cb = bytes('classes.bin')
    const ab = bytes('activity.bin')
    const classes = { nx: meta.nx, ny: meta.ny, data: cb }
    const inp = {
      classes,
      activity: new Float32Array(ab.buffer, ab.byteOffset, ab.byteLength / 4),
      fwiNorm: meta.fwiNorm as number,
      lut: flammabilityLut(meta.flammability),
    }
    const mask = burnableMaskOf(classes, meta.burnableClasses)
    return { inp, mask }
  }

  it('agrees with numpy on the shipped raster, which has a unique maximum', () => {
    const { inp, mask } = real()
    const r = recombineRisk(inp, {
      wWeather: meta.weightDefaults.wWeather,
      wActivity: meta.weightDefaults.wActivity,
    })
    const s = resolveSeedIndex(r.risk, mask)
    expect(s.tiesAtMax).toBe(1)
    expect(meta.seedTiesAtMax).toBe(1)
    expect(s.index).toBe(meta.seedFlatIndex)
    expect(s.index).toBe(539100)
  })

  it('reports a large tie count once the activity term is switched off', () => {
    const { inp, mask } = real()
    const r = recombineRisk(inp, { wWeather: 0.45, wActivity: 0 })
    const s = resolveSeedIndex(r.risk, mask)
    // With w_activity at 0 the field collapses onto the flammability classes,
    // so every tree/shrub pixel ties at 1.0. This is the case the UI must
    // label, and the reason the seed cannot simply be frozen.
    expect(s.tiesAtMax).toBeGreaterThan(10000)
  })
})
```

**The mutation each test catches.** *Greatest allowed value / mask cases:* resolving the seed over the whole grid rather than the mask, which is precisely the bug Plan 1's Task 10 fix round removed — a non-burnable seed makes `variablePoissonDisk` return zero candidates. *Tie-break:* using `>` instead of `>=` when scanning (or a last-wins scan) returns the highest index and fails. *Tie count:* counting over the grid rather than the mask. *Threshold:* a `>= 0.5` mask test. *Baked-seed agreement:* the single assertion that keeps Plan 1's whole parity chain valid — if a re-bake ever makes the maximum non-unique, this fails and forces a decision instead of silently forking. *Tie count with activity off:* an implementation that always returns 1 for `tiesAtMax` would pass every small case and fail this one.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npm test -- seed
```

Expected: FAIL — cannot resolve `../src/lib/seed`.

- [ ] **Step 3: Implement**

Create `web/src/lib/seed.ts`:

```ts
import type { Field } from './types'

export interface SeedResolution {
  /** Flat index of the seed pixel, or -1 when the mask allows nothing. */
  index: number
  /** How many allowed pixels share the maximum. 1 means numpy would agree. */
  tiesAtMax: number
  allowedCount: number
  maxRisk: number
}

/**
 * The pixel `variablePoissonDisk` should start from: the mask-allowed pixel
 * with the greatest risk, ties broken by the lowest flat index.
 *
 * `place.py` expresses the same rule as a scan down `np.argsort(risk,
 * axis=None)[::-1]`. numpy's argsort is an unstable introsort, so when values
 * tie its answer is a property of quicksort's partitioning rather than of the
 * algorithm — not something a second sort implementation can reproduce. Plan 1
 * worked around that by resolving the index in Python and shipping it, which
 * was right while the risk field was frozen at bake time. It is not right once
 * `w_weather` and `w_activity` are live: the argmax genuinely moves when the
 * weights move, so a shipped index stops being the maximum.
 *
 * This completes the underspecified half of the rule with a total order, which
 * both languages can evaluate identically. Where ties exist the choice is
 * *a* valid seed rather than numpy's, so `tiesAtMax` is returned and the UI
 * says so — see ui/copy.ts. On the shipped Los Padres raster at the default
 * weights the maximum is unique and this returns 539100, the same index the
 * bake resolved, which is what keeps the Plan 1 parity chain intact.
 */
export function resolveSeedIndex(risk: Field, mask: Field): SeedResolution {
  const n = risk.data.length
  let index = -1
  let maxRisk = -Infinity
  let tiesAtMax = 0
  let allowedCount = 0

  for (let i = 0; i < n; i++) {
    // The same 0.5 threshold place.allowed() uses. Baked masks hold exactly
    // 0 or 1, so the threshold only matters for synthetic fields.
    if (!(mask.data[i] > 0.5)) continue
    allowedCount++
    const v = risk.data[i]
    if (v > maxRisk) {
      maxRisk = v
      index = i          // strictly greater, so the FIRST maximum is kept
      tiesAtMax = 1
    } else if (v === maxRisk) {
      tiesAtMax++
    }
  }

  if (index < 0) return { index: -1, tiesAtMax: 0, allowedCount: 0, maxRisk: 0 }
  return { index, tiesAtMax, allowedCount, maxRisk }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd web && npm test -- seed
```

Expected: PASS, 8 tests. Then `npm test` (expect 167 passing) and `npm run build`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/seed.ts web/tests/seed.test.ts
git commit -m "feat(web): resolve the blue-noise seed in the browser

The risk field can now change under the reader's hands, so a baked seed
index stops being the argmax. Resolve it live with a total order (max risk,
lowest flat index) and keep meta.seedFlatIndex as the cross-check: on the
shipped raster the maximum is unique and both agree on 539100."
```

---

### Task 5: Load components and place on a live risk field

**Files:**
- Modify: `web/src/lib/loadRegion.ts`
- Modify: `web/src/lib/pipeline.ts`
- Modify: `web/tests/loadRegion.test.ts`
- Modify: `web/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `recombineRisk`, `flammabilityLut`, `burnableMaskOf`, `meanOverMask`, `clampWeights`, `wBaseFor` (`risk.ts`); `resolveSeedIndex` (`seed.ts`); `ClassField`, `Field` (`types.ts`).
- Produces:
  - `RegionMeta` gains `areaKm2: number`, `riskPeak: number`, `seedTiesAtMax: number`, `flammability: Record<string, number>`, `burnableClasses: number[]`, `weightDefaults: { wBase: number; wWeather: number; wActivity: number }`, `fwiFullScale: number`, `km2PerNode: number`, `budgetLo: number`, `budgetHi: number`
  - `interface RegionData { meta: RegionMeta; classes: ClassField; activity: Float32Array; mask: Field; bbox: BBox }` — `risk` is **no longer** a member; it is produced per run
  - `loadRegion(name: string, fetchImpl?: typeof fetch): Promise<RegionData>` — fetches `meta.json`, `classes.bin`, `activity.bin`
  - `loadManifest(fetchImpl?: typeof fetch): Promise<{ baked: string[]; generated: string }>`
  - `PlaceParams` gains `wWeather: number` and `wActivity: number`
  - `PlaceResult` gains `risk: Field`, `seedFlatIndex: number`, `seedTiesAtMax: number`, `meanRiskBurnable: number`, `wBase: number`

- [ ] **Step 1: Write the failing tests**

Replace the fetch-shape tests in `web/tests/loadRegion.test.ts` with these (keep the file's existing real-data test, updating it to read `classes.bin`/`activity.bin`):

```ts
const meta = {
  name: 'test', box: [-1, 2, 0, 3], nx: 2, ny: 2,
  widthKm: 10, heightKm: 20, forestFraction: 0.5, fwiP90: 40,
  fwiNorm: 0.5, firmsCount: 3, firmsPadDeg: 0.25, classMix: { '10': 0.5 },
  seedFlatIndex: 0, seedTiesAtMax: 1, areaKm2: 200, riskPeak: 0.7,
  flammability: { '10': 1, '30': 0.75, '80': 0 },
  burnableClasses: [10, 30],
  weightDefaults: { wBase: 0.2, wWeather: 0.45, wActivity: 0.35 },
  fwiFullScale: 80, km2PerNode: 140, budgetLo: 6, budgetHi: 40,
  generated: '2026-07-31T00:00:00Z',
  sourceNotes: { notModelled: ['elevation/slope', 'camper traffic'] },
}

function fakeFetch(classes: Uint8Array, activity: Float32Array): typeof fetch {
  return (async (url: string) => {
    if (url.endsWith('meta.json')) return { ok: true, json: async () => meta } as any
    if (url.endsWith('classes.bin')) return { ok: true, arrayBuffer: async () => classes.buffer } as any
    if (url.endsWith('activity.bin')) return { ok: true, arrayBuffer: async () => activity.buffer } as any
    return { ok: false, status: 404 } as any
  }) as any
}

describe('loadRegion', () => {
  it('decodes the components and derives the burnable mask', async () => {
    const r = await loadRegion('test', fakeFetch(
      Uint8Array.from([10, 30, 80, 10]),
      Float32Array.from([0, 0.25, 0.5, 1]),
    ))
    expect(r.meta.name).toBe('test')
    expect(Array.from(r.classes.data)).toEqual([10, 30, 80, 10])
    expect(Array.from(r.activity)).toEqual([0, 0.25, 0.5, 1])
    expect(Array.from(r.mask.data)).toEqual([1, 1, 0, 1])
    expect(r.bbox).toEqual({ west: -1, south: 2, east: 0, north: 3 })
  })

  it('rejects when classes.bin disagrees with the metadata', async () => {
    await expect(loadRegion('test', fakeFetch(
      Uint8Array.from([10, 30]), Float32Array.from([0, 0, 0, 0]),
    ))).rejects.toThrow(/classes\.bin/)
  })

  it('rejects when activity.bin disagrees with the metadata', async () => {
    await expect(loadRegion('test', fakeFetch(
      Uint8Array.from([10, 30, 80, 10]), Float32Array.from([0, 1]),
    ))).rejects.toThrow(/activity\.bin/)
  })

  it('rejects metadata that is missing a constant the model needs', async () => {
    const stripped = { ...meta } as any
    delete stripped.flammability
    const f = (async (url: string) =>
      url.endsWith('meta.json')
        ? { ok: true, json: async () => stripped }
        : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) as any
    await expect(loadRegion('test', f)).rejects.toThrow(/flammability/)
  })

  it('rejects a failed fetch', async () => {
    const bad = (async () => ({ ok: false, status: 500 })) as any
    await expect(loadRegion('test', bad)).rejects.toThrow(/500/)
  })
})
```

Add to `web/tests/pipeline.test.ts`:

```ts
describe('live weights', () => {
  it('moves the network when the activity weight moves', () => {
    const region = losPadres()
    const a = runPlacement(region, DEFAULT_PARAMS)
    const b = runPlacement(region, { ...DEFAULT_PARAMS, wActivity: 0 })
    expect(b.candidateCount).not.toBe(a.candidateCount)
  })

  it('is invariant to weight pairs with the same activity-to-base ratio', () => {
    // fwiNorm is a single regional SCALAR, so w_weather has no spatial
    // structure: with s = w_base + w_weather*fwiNorm, the normalised field
    // depends on (w_weather, w_activity) only through w_activity / s. Two
    // pairs with the same ratio must therefore produce the same field — and
    // the same network. This is a property of the model as written, and the
    // Lab says so on screen rather than implying two independent controls.
    const region = losPadres()
    const fwi = region.meta.fwiNorm
    const sOf = (ww: number, wa: number) => 1 - ww - wa + ww * fwi

    const p1 = { wWeather: 0.45, wActivity: 0.35 }
    const ratio = p1.wActivity / sOf(p1.wWeather, p1.wActivity)
    // Solve for the w_activity that reproduces `ratio` at a different
    // w_weather: wa = ratio*(1 - ww*(1 - fwi)) / (1 + ratio).
    const ww2 = 0.2
    const wa2 = (ratio * (1 - ww2 * (1 - fwi))) / (1 + ratio)

    const a = runPlacement(region, { ...DEFAULT_PARAMS, ...p1 })
    const b = runPlacement(region, { ...DEFAULT_PARAMS, wWeather: ww2, wActivity: wa2 })

    let worst = 0
    for (let i = 0; i < a.risk.data.length; i++) {
      worst = Math.max(worst, Math.abs(a.risk.data[i] - b.risk.data[i]))
    }
    // Not exact: the two paths reach the same real number by different
    // float64 roundings, so allow a couple of float32 ulps at 1.0.
    expect(worst).toBeLessThan(2.4e-7)
    expect(b.candidateCount).toBe(a.candidateCount)
  })

  it('reports the seed it actually used and how contested it was', () => {
    const r = runPlacement(losPadres(), DEFAULT_PARAMS)
    expect(r.seedFlatIndex).toBe(539100)
    expect(r.seedTiesAtMax).toBe(1)
    expect(r.wBase).toBeCloseTo(0.2, 12)
  })
})
```

**The mutation each test catches.** *Mask derivation on load:* dropping `burnableClasses` and defaulting to "everything is burnable". *Size checks:* a `classes.bin` fetched from a stale bake — the exact failure mode Plan 1's `loadRegion` size guard was written for, now covering two rasters. *Missing-constant rejection:* the `as RegionMeta` compile-time cast Plan 1's ledger flagged as unguarded, now a runtime check. *Weights move the network:* a pipeline that recombines but then places on a cached field. *Ratio invariance:* an implementation that applies the weights to the already-normalised field, or that forgets `/peak`, breaks the invariance and fails. *Seed reporting:* a pipeline still reading `meta.seedFlatIndex` instead of resolving it would pass at the default and diverge the moment a weight moves; asserting `seedTiesAtMax` from the resolver's own output is what ties the two together.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && npm test -- loadRegion pipeline
```

Expected: FAIL — `r.classes` is undefined, `wActivity` is not a `PlaceParams` key.

- [ ] **Step 3: Rewrite the loader**

Replace the body of `web/src/lib/loadRegion.ts` below the `get()` helper with:

```ts
import type { BBox, ClassField, Field } from './types'
import { burnableMaskOf } from './risk'

export interface RegionMeta {
  name: string
  box: [number, number, number, number]
  nx: number
  ny: number
  widthKm: number
  heightKm: number
  areaKm2: number
  forestFraction: number
  fwiP90: number
  fwiNorm: number
  firmsCount: number
  firmsPadDeg: number
  classMix: Record<string, number>
  seedFlatIndex: number
  seedTiesAtMax: number
  riskPeak: number
  /** WorldCover class code -> flammability weight, from forest.FLAMMABILITY. */
  flammability: Record<string, number>
  burnableClasses: number[]
  weightDefaults: { wBase: number; wWeather: number; wActivity: number }
  fwiFullScale: number
  km2PerNode: number
  budgetLo: number
  budgetHi: number
  generated: string
  sourceNotes: Record<string, unknown>
}

export interface RegionData {
  meta: RegionMeta
  classes: ClassField
  /** The baked FIRMS activity field, float32, same orientation as `classes`. */
  activity: Float32Array
  /** Derived from `classes` and `meta.burnableClasses`, never fetched. */
  mask: Field
  bbox: BBox
}

export interface DataManifest {
  baked: string[]
  generated: string
}

/**
 * Fetched JSON is asserted, not parsed, so a stale meta.json would satisfy the
 * type and be `undefined` at runtime — the hole Plan 1's ledger flagged. Check
 * the fields the model cannot run without, by name, and say which is missing.
 */
function requireMeta(meta: RegionMeta, name: string): void {
  const required: Array<[string, unknown]> = [
    ['nx', meta.nx], ['ny', meta.ny], ['widthKm', meta.widthKm],
    ['heightKm', meta.heightKm], ['areaKm2', meta.areaKm2],
    ['fwiNorm', meta.fwiNorm], ['flammability', meta.flammability],
    ['burnableClasses', meta.burnableClasses],
    ['weightDefaults', meta.weightDefaults], ['km2PerNode', meta.km2PerNode],
    ['budgetLo', meta.budgetLo], ['budgetHi', meta.budgetHi],
  ]
  for (const [key, value] of required) {
    if (value === undefined || value === null) {
      throw new Error(
        `region "${name}" meta.json is missing "${key}" — re-bake it with ` +
        'tools/bake/bake_region.py',
      )
    }
  }
}

export async function loadManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<DataManifest> {
  return (await (await get(fetchImpl, '/data/manifest.json')).json()) as DataManifest
}

/**
 * Fetch and decode a baked region's *components*.
 *
 * risk.bin is deliberately not fetched: the browser recombines the risk field
 * from classes + activity so the weights can move. risk.bin stays committed as
 * the golden that web/tests/risk.test.ts checks the recombination against.
 *
 * Both rasters are row-major with **row 0 at the south edge**, matching
 * place.py. Getting that backwards mirrors every placement vertically, which
 * looks plausible and is completely wrong.
 */
export async function loadRegion(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegionData> {
  const base = `/data/${name}`
  const meta = (await (await get(fetchImpl, `${base}/meta.json`)).json()) as RegionMeta
  requireMeta(meta, name)
  const expected = meta.nx * meta.ny

  const classBuf = await (await get(fetchImpl, `${base}/classes.bin`)).arrayBuffer()
  const classData = new Uint8Array(classBuf)
  if (classData.length !== expected) {
    throw new Error(
      `classes.bin has ${classData.length} values, meta says ` +
      `${meta.nx}x${meta.ny}=${expected}`,
    )
  }

  const actBuf = await (await get(fetchImpl, `${base}/activity.bin`)).arrayBuffer()
  const activity = new Float32Array(actBuf)
  if (activity.length !== expected) {
    throw new Error(
      `activity.bin has ${activity.length} values, meta says ${expected}`,
    )
  }

  const classes: ClassField = { nx: meta.nx, ny: meta.ny, data: classData }
  const [west, south, east, north] = meta.box
  return {
    meta,
    classes,
    activity,
    mask: burnableMaskOf(classes, meta.burnableClasses),
    bbox: { west, south, east, north },
  }
}
```

- [ ] **Step 4: Recombine inside the pipeline**

In `web/src/lib/pipeline.ts`, add `wWeather` and `wActivity` to `PlaceParams`, add `risk`, `seedFlatIndex`, `seedTiesAtMax`, `meanRiskBurnable` and `wBase` to `PlaceResult`, and replace the head of `runPlacement` (the `seedFlatIndex` validation block and the `variablePoissonDisk` call) with:

```ts
  const { widthKm, heightKm, name } = region.meta

  // Rebuild the risk field from the baked components at the caller's weights.
  // This is the whole point of Plan 2: the field the sampler reads is computed
  // here, on this run, not fetched pre-combined.
  const { risk } = recombineRisk(
    {
      classes: region.classes,
      activity: region.activity,
      fwiNorm: region.meta.fwiNorm,
      lut: flammabilityLut(region.meta.flammability),
    },
    { wWeather: p.wWeather, wActivity: p.wActivity },
  )

  // Resolve the seed against THIS field, not the baked one — see seed.ts for
  // why a shipped index stops being the argmax once the weights move.
  const seed = resolveSeedIndex(risk, region.mask)
  if (seed.index < 0) {
    throw new Error(
      `region "${name}" has no burnable pixel to seed placement from; the ` +
      'mask allows nothing.',
    )
  }

  const candidates = variablePoissonDisk(
    new RefRNG(p.seed), risk, widthKm, heightKm,
    p.rMinKm, p.rMaxKm, region.mask, 24, 200_000, seed.index,
  )

  if (candidates.length === 0) {
    throw new Error(
      `region "${name}" produced zero placement candidates from seed pixel ` +
      `${seed.index}. This should be unreachable: the seed is chosen from the ` +
      'mask-allowed pixels.',
    )
  }
```

Every later reference to `region.risk` inside `runPlacement` becomes `risk`, and the returned object gains:

```ts
    risk,
    seedFlatIndex: seed.index,
    seedTiesAtMax: seed.tiesAtMax,
    meanRiskBurnable: meanOverMask(risk, region.mask),
    wBase: wBaseFor(clampWeights({ wWeather: p.wWeather, wActivity: p.wActivity })),
```

Add the imports `recombineRisk, flammabilityLut, meanOverMask, wBaseFor, clampWeights` from `./risk` and `resolveSeedIndex` from `./seed`.

- [ ] **Step 5: Run the tests**

```bash
cd web && npm test -- loadRegion pipeline risk seed
```

Expected: PASS, including the re-pinned parity test from Task 2 — the recombination path must reach the same 927/572 as the baked-raster path, because at the default weights the recombined field is bit-identical. If parity breaks here, the fault is in this task, not in Task 3.

Then `npm test` (expect 175 passing) and `npm run build`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/loadRegion.ts web/src/lib/pipeline.ts \
        web/tests/loadRegion.test.ts web/tests/pipeline.test.ts
git commit -m "feat(web): place on a risk field recombined per run

loadRegion now fetches classes + activity and derives the mask; the
pipeline recombines risk at the caller's weights and resolves the seed
against that field. Parity with the Python reference is unchanged at the
default weights."
```

---

### Task 6: Budget modes — saturation, auto, fixed

**Files:**
- Create: `web/src/lib/budget.ts`
- Modify: `web/src/lib/pipeline.ts`
- Test: `web/tests/budget.test.ts`

**Interfaces:**
- Consumes: nothing outside `budget.ts` except the values passed in.
- Produces:
  - `type BudgetMode = 'saturation' | 'auto' | 'fixed'`
  - `function roundHalfToEven(x: number): number`
  - `function autoBudget(areaKm2: number, meanRisk: number, km2PerNode: number, lo: number, hi: number): number`
  - `function saturationSpacing(detectKm: number): { rMinKm: number; rMaxKm: number }`
  - `function budgetSpacing(burnKm2: number, nodes: number): { rMinKm: number; rMaxKm: number }`
  - `interface BudgetPlan { mode: BudgetMode; maxNodes: number | null; greedyTarget: number; rMinKm: number; rMaxKm: number; derived: boolean }`
  - `function resolveBudget(args: { mode: BudgetMode; fixedNodes: number; detectKm: number; target: number; burnKm2: number; meanRiskBurnable: number; km2PerNode: number; budgetLo: number; budgetHi: number; override: { rMinKm: number; rMaxKm: number } | null }): BudgetPlan`
- `PlaceParams` gains `budgetMode: BudgetMode`, `fixedNodes: number`, `spacingOverride: { rMinKm: number; rMaxKm: number } | null`, and loses nothing.

**Ported verbatim from `plan.plan_region` — do not substitute other values.**

| Regime | Node cap | Greedy target | `r_min_km` | `r_max_km` |
|---|---|---|---|---|
| saturation (`budget is None`) | none | `target` | `detect_km * 0.55` | `detect_km * 1.30` |
| auto | `auto_budget(burn_km2, risk[burn].mean(), 6, 40)` | `1.01` | `spread * 0.45` | `spread * 1.10` |
| fixed | the integer given | `1.01` | `spread * 0.45` | `spread * 1.10` |

with `spread = sqrt(max(burn_km2, 1.0) / max(n_budget, 1))` and `auto_budget(a, m, lo, hi) = int(clip(round(a * clip(m, 0, 1) / 140.0), lo, hi))`.

The `1.01` target is not a typo. With a budget the objective flips from "fewest nodes for this coverage" to "most risk watched with this many nodes", so `plan_region` sets an unreachable target and lets `max_nodes` be the binding constraint.

`np.round` is **round-half-to-even**; `Math.round` is half-up. They differ at exactly `.5`, which `auto_budget` can hit, so `roundHalfToEven` is required rather than decorative.

- [ ] **Step 1: Write the failing test**

Create `web/tests/budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  roundHalfToEven, autoBudget, saturationSpacing, budgetSpacing, resolveBudget,
} from '../src/lib/budget'

describe('roundHalfToEven', () => {
  it('rounds halves to the even neighbour, as numpy does', () => {
    expect(roundHalfToEven(0.5)).toBe(0)
    expect(roundHalfToEven(1.5)).toBe(2)
    expect(roundHalfToEven(2.5)).toBe(2)
    expect(roundHalfToEven(3.5)).toBe(4)
    expect(roundHalfToEven(-0.5)).toBe(-0)
    expect(roundHalfToEven(-1.5)).toBe(-2)
  })

  it('agrees with ordinary rounding away from halves', () => {
    expect(roundHalfToEven(2.4)).toBe(2)
    expect(roundHalfToEven(2.6)).toBe(3)
    expect(roundHalfToEven(18.346845156542415)).toBe(18)
  })
})

describe('autoBudget', () => {
  it('reproduces plan.auto_budget on the real Los Padres inputs', () => {
    // Measured: burn_km2 5073.900713469231, risk[burn].mean() 0.5062295198440552,
    // KM2_PER_NODE 140, plan_region's clamps (6, 40) -> raw 18.346845, budget 18.
    expect(autoBudget(5073.900713469231, 0.5062295198440552, 140, 6, 40)).toBe(18)
  })

  it('clamps at both ends', () => {
    expect(autoBudget(10, 0.01, 140, 6, 40)).toBe(6)
    expect(autoBudget(1e7, 1, 140, 6, 40)).toBe(40)
  })

  it('clamps the mean risk into [0, 1] before scaling', () => {
    expect(autoBudget(140 * 20, 5, 140, 6, 40)).toBe(20)
    expect(autoBudget(140 * 20, -3, 140, 6, 40)).toBe(6)
  })

  it('uses banker\'s rounding on the raw count', () => {
    // raw exactly 18.5 -> 18 under round-half-to-even, 19 under Math.round.
    expect(autoBudget(140 * 18.5, 1, 140, 6, 40)).toBe(18)
    // raw exactly 19.5 -> 20 either way, so this pins the direction too.
    expect(autoBudget(140 * 19.5, 1, 140, 6, 40)).toBe(20)
  })
})

describe('spacing derivations', () => {
  it('uses plan_region\'s saturation multipliers', () => {
    expect(saturationSpacing(2)).toEqual({ rMinKm: 1.1, rMaxKm: 2.6 })
    const s = saturationSpacing(0.5)
    expect(s.rMinKm).toBeCloseTo(0.275, 12)
    expect(s.rMaxKm).toBeCloseTo(0.65, 12)
  })

  it('uses plan_region\'s budgeted spread on the real region', () => {
    // spread = sqrt(5073.900713469231 / 18) = 16.78938274536955
    const s = budgetSpacing(5073.900713469231, 18)
    expect(s.rMinKm).toBeCloseTo(7.555222235416298, 9)
    expect(s.rMaxKm).toBeCloseTo(18.468321019906508, 9)
  })

  it('never divides by zero nodes or a zero area', () => {
    const s = budgetSpacing(0, 0)
    expect(Number.isFinite(s.rMinKm)).toBe(true)
    expect(s.rMinKm).toBeGreaterThan(0)
  })
})

describe('resolveBudget', () => {
  const common = {
    detectKm: 2, target: 0.95, burnKm2: 5073.900713469231,
    meanRiskBurnable: 0.5062295198440552, km2PerNode: 140,
    budgetLo: 6, budgetHi: 40, override: null,
  }

  it('saturation leaves the node count open and keeps the reader\'s target', () => {
    const b = resolveBudget({ ...common, mode: 'saturation', fixedNodes: 100 })
    expect(b.maxNodes).toBeNull()
    expect(b.greedyTarget).toBe(0.95)
    expect(b.rMinKm).toBe(1.1)
    expect(b.rMaxKm).toBe(2.6)
  })

  it('auto resolves 18 nodes on Los Padres and makes the target unreachable', () => {
    const b = resolveBudget({ ...common, mode: 'auto', fixedNodes: 100 })
    expect(b.maxNodes).toBe(18)
    expect(b.greedyTarget).toBe(1.01)
    expect(b.rMinKm).toBeCloseTo(7.555222235416298, 9)
  })

  it('fixed uses the integer given and the same budgeted spacing', () => {
    const b = resolveBudget({ ...common, mode: 'fixed', fixedNodes: 200 })
    expect(b.maxNodes).toBe(200)
    expect(b.greedyTarget).toBe(1.01)
    expect(b.rMinKm).toBeCloseTo(Math.sqrt(common.burnKm2 / 200) * 0.45, 9)
  })

  it('an explicit spacing override wins over every derivation', () => {
    const b = resolveBudget({
      ...common, mode: 'saturation', fixedNodes: 1,
      override: { rMinKm: 3, rMaxKm: 9 },
    })
    expect(b.rMinKm).toBe(3)
    expect(b.rMaxKm).toBe(9)
    expect(b.derived).toBe(false)
  })

  it('refuses a fixed budget below one node', () => {
    expect(() => resolveBudget({ ...common, mode: 'fixed', fixedNodes: 0 }))
      .toThrow(/at least 1/)
  })
})
```

**The mutation each test catches.** *Half-to-even:* swapping in `Math.round` fails the `18.5` case — and `auto_budget` genuinely lands on halves because `KM2_PER_NODE` is 140. *Real-inputs auto:* inventing a `KM2_PER_NODE` or using `auto_budget`'s own `(3, 40)` defaults instead of `plan_region`'s `(6, 40)`. *Spacing multipliers:* substituting invented constants for `0.55/1.30` and `0.45/1.10` — the mistake Plan 1's lessons name explicitly. *Greedy target:* using `target` in the budgeted regimes, which makes greedy stop early and under-report what a fixed budget can watch. *Override:* a UI override silently discarded. *Zero guards:* `budgetSpacing(x, 0)` returning `Infinity`, which would make `variablePoissonDisk` place one node.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npm test -- budget
```

Expected: FAIL — cannot resolve `../src/lib/budget`.

- [ ] **Step 3: Implement**

Create `web/src/lib/budget.ts`:

```ts
/** Which rule decides how many nodes the run may place. */
export type BudgetMode = 'saturation' | 'auto' | 'fixed'

/** plan_region's saturation multipliers on the detection radius. */
const SAT_MIN = 0.55
const SAT_MAX = 1.3
/** plan_region's budgeted multipliers on the implied mean separation. */
const BUDGET_MIN = 0.45
const BUDGET_MAX = 1.1
/**
 * With a budget, plan_region sets an unreachable coverage target so that the
 * node cap is what binds: the objective flips from "fewest nodes for this
 * coverage" to "most risk watched with this many nodes".
 */
const UNREACHABLE_TARGET = 1.01

/**
 * numpy's `round` is round-half-to-even; JavaScript's `Math.round` is
 * half-up. `auto_budget` rounds a quotient by 140, which lands exactly on a
 * half often enough to matter, so the difference is a whole node.
 */
export function roundHalfToEven(x: number): number {
  const r = Math.round(x)
  // Math.round(-0.5) is -0 and Math.round(0.5) is 1; only exact halves differ.
  if (Math.abs(x % 1) !== 0.5) return r
  return r % 2 === 0 ? r : r - Math.sign(x)
}

/**
 * A defensible node count when none is given. Port of `plan.auto_budget`.
 *
 * Scales with risk-weighted burnable area, then clamps. Note what this
 * actually produces: on Los Padres (5,074 km2 burnable, mean risk 0.506) it
 * returns 18 nodes — about 5% coverage on a region that needs ~572 for 95%.
 * The `hi` clamp is not even reached. The Lab offers this mode because it is
 * the library's own default and says plainly what it yields.
 */
export function autoBudget(
  areaKm2: number, meanRisk: number, km2PerNode: number,
  lo: number, hi: number,
): number {
  const m = meanRisk < 0 ? 0 : meanRisk > 1 ? 1 : meanRisk
  const raw = (areaKm2 * m) / km2PerNode
  const n = roundHalfToEven(raw)
  return Math.min(Math.max(n, lo), hi)
}

/**
 * Saturation spacing: `detect_km * 0.55` to `detect_km * 1.30`, from
 * plan_region. The pool must be DENSER than the answer, because the minimiser
 * can only delete, and discs of radius R tile the plane only at hexagonal
 * spacing R*sqrt(3) — a sparser pool leaves gaps no pruning can close.
 */
export function saturationSpacing(detectKm: number) {
  return { rMinKm: detectKm * SAT_MIN, rMaxKm: detectKm * SAT_MAX }
}

/**
 * Budgeted spacing, from plan_region: the pool is sized by the budget, not by
 * the detection radius. With a handful of nodes there is no overlap between
 * discs, so greedy has no diminishing-returns pressure to spread out and would
 * stack the whole budget in one hot valley; spacing the pool at roughly the
 * mean separation the budget implies forces geographic spread.
 */
export function budgetSpacing(burnKm2: number, nodes: number) {
  const spread = Math.sqrt(Math.max(burnKm2, 1) / Math.max(nodes, 1))
  return { rMinKm: spread * BUDGET_MIN, rMaxKm: spread * BUDGET_MAX }
}

export interface BudgetPlan {
  mode: BudgetMode
  /** null means saturation: place whatever the coverage target requires. */
  maxNodes: number | null
  greedyTarget: number
  rMinKm: number
  rMaxKm: number
  /** false when the reader overrode the spacing by hand. */
  derived: boolean
}

export function resolveBudget(args: {
  mode: BudgetMode
  fixedNodes: number
  detectKm: number
  target: number
  burnKm2: number
  meanRiskBurnable: number
  km2PerNode: number
  budgetLo: number
  budgetHi: number
  override: { rMinKm: number; rMaxKm: number } | null
}): BudgetPlan {
  let maxNodes: number | null = null
  let greedyTarget = args.target

  if (args.mode === 'auto') {
    maxNodes = autoBudget(args.burnKm2, args.meanRiskBurnable,
                          args.km2PerNode, args.budgetLo, args.budgetHi)
    greedyTarget = UNREACHABLE_TARGET
  } else if (args.mode === 'fixed') {
    if (!Number.isInteger(args.fixedNodes) || args.fixedNodes < 1) {
      throw new Error('a fixed budget needs at least 1 node')
    }
    maxNodes = args.fixedNodes
    greedyTarget = UNREACHABLE_TARGET
  }

  const spacing = args.override
    ? args.override
    : maxNodes === null
      ? saturationSpacing(args.detectKm)
      : budgetSpacing(args.burnKm2, maxNodes)

  return {
    mode: args.mode,
    maxNodes,
    greedyTarget,
    rMinKm: spacing.rMinKm,
    rMaxKm: spacing.rMaxKm,
    derived: args.override === null,
  }
}
```

- [ ] **Step 4: Wire the budget into the pipeline**

In `web/src/lib/pipeline.ts`, add `budgetMode`, `fixedNodes` and `spacingOverride` to `PlaceParams`, add `budget: BudgetPlan` and `burnKm2: number` to `PlaceResult`, and replace the fixed `p.rMinKm`/`p.rMaxKm`/`p.target`/`p.maxNodes` uses. Because the auto budget depends on the mean risk, which depends on the weights, the budget must be resolved *after* the recombination and *before* the sampler:

```ts
  // The budget depends on mean risk over burnable ground, which depends on the
  // weights — so it is resolved from THIS run's field, not from the bake.
  const meanRiskBurnable = meanOverMask(risk, region.mask)
  let burnable = 0
  for (let i = 0; i < region.mask.data.length; i++) {
    if (region.mask.data[i] > 0.5) burnable++
  }
  const burnKm2 = (burnable / region.mask.data.length) * region.meta.areaKm2

  const budget = resolveBudget({
    mode: p.budgetMode,
    fixedNodes: p.fixedNodes,
    detectKm: p.detectKm,
    target: p.target,
    burnKm2,
    meanRiskBurnable,
    km2PerNode: region.meta.km2PerNode,
    budgetLo: region.meta.budgetLo,
    budgetHi: region.meta.budgetHi,
    override: p.spacingOverride,
  })
```

then `variablePoissonDisk(..., budget.rMinKm, budget.rMaxKm, ...)` and
`greedyMinimise(candidates, demand.xy, demand.w, p.detectKm, budget.greedyTarget, budget.maxNodes)`.

`PlaceParams.rMinKm`/`rMaxKm` are removed — spacing now comes from `budget`, with `spacingOverride` as the manual escape hatch. Update `DEFAULT_PARAMS` in Task 8 accordingly.

- [ ] **Step 5: Run the tests**

```bash
cd web && npm test -- budget pipeline
```

Expected: PASS. The parity test still reports 927/572, because saturation mode with `detectKm = 2.0` derives exactly `rMinKm = 1.1`, `rMaxKm = 2.6`. If it does not, the spacing derivation is wrong — fix it rather than re-pinning.

Then `npm test` (expect 192 passing) and `npm run build`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/budget.ts web/src/lib/pipeline.ts web/tests/budget.test.ts
git commit -m "feat(web): budget modes ported verbatim from plan_region

saturation / auto / fixed, with plan_region's own spacing derivations and
its unreachable-target trick for the budgeted regimes. auto returns 18
nodes on Los Padres — the library's default, reported rather than hidden."
```

---

### Task 7: Benchmark A — the coverage-versus-budget head-to-head

**Files:**
- Create: `web/src/lib/benchmark.ts`
- Test: `web/tests/benchmark.test.ts`
- Modify: `web/tests/fairness.test.ts`

**Interfaces:**
- Consumes: `uniformGrid`, `capToCommonCount` (`grid.ts`); `coverageOf`, `demandPoints` (`cover.ts`); `strideKm` (`pipeline.ts`); `Field` (`types.ts`).
- Produces:
  - `interface BenchmarkPoint { requested: number; scored: number; pyra: number; uniform: number; deltaPP: number }`
  - `interface BenchmarkResult { points: BenchmarkPoint[]; atBudget: BenchmarkPoint; bestMargin: BenchmarkPoint; crossoverNodes: number | null; strideKm: number; demandCount: number; detectKm: number }`
  - `function benchmarkBudgets(maxNodes: number, steps?: number): number[]`
  - `function runBenchmark(args: { risk: Field; mask: Field; widthKm: number; heightKm: number; nodes: Float64Array; detectKm: number; demandStride: number; strideKm: number }): BenchmarkResult`

**Why the sweep is free, and why it is a sweep at all.**

`greedyMinimise` selects in descending marginal gain and never revisits, so its `chosen` sequence is *prefix-consistent*: the first N entries of a saturation run are exactly the run you get by asking for N nodes. Plan 1's Task 8 fix round verified this on a fixture (`chosen_low === chosen[:30]`, an exact prefix), and it was re-verified on the real Los Padres data while writing this plan. So one placement run yields every budget on the curve — no re-running the sampler, no re-running greedy. The uniform arm costs one `uniformGrid` call per budget, which is arithmetic over a few hundred points.

The sweep is not decoration. Measured on the committed rasters (see the findings section at the top), the risk-driven arm leads by up to **+3.61 pp at a budget of 170** and trails by **4.17 pp at the saturation budget of 572**, crossing over at about **270**. A single pair of numbers at either end would be a cherry-pick; the curve is the honest object, and the crossover is the finding.

**Fairness, stated exactly.** Neither arm reliably realises the count it is asked for: `uniformGrid` drops nodes that fall outside the burnable mask, and the risk-driven arm stops at the target or when marginal gain runs out. Plan 1's ledger carried this forward explicitly — the site's wording must be "**both arms capped to the same realised count**", not "identical node count". `capToCommonCount` does the capping and `BenchmarkPoint.scored` reports what was actually scored.

**The baseline is the masked grid, deliberately.** An unmasked grid puts nodes in the Pacific and scores worse — measured: 98.42% versus 96.93% at 572 requested, so masking *helps* the baseline here. Giving the baseline the burnable mask is giving it part of the model's own input, which makes it a stronger control. Plan 1's Task 9 lost four fix rounds to a grid that was accidentally weakened; the rule going forward is that any ambiguity is resolved in the baseline's favour.

- [ ] **Step 1: Write the failing test**

Create `web/tests/benchmark.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { benchmarkBudgets, runBenchmark } from '../src/lib/benchmark'
import { runPlacement, strideKm } from '../src/lib/pipeline'
import { uniformGrid, capToCommonCount } from '../src/lib/grid'
import { coverageOf, demandPoints } from '../src/lib/cover'
import { loadLosPadres, DEFAULT_TEST_PARAMS } from './helpers/losPadres'

describe('benchmarkBudgets', () => {
  it('is strictly increasing, starts small, and ends at the full count', () => {
    const b = benchmarkBudgets(572, 12)
    expect(b[0]).toBeGreaterThanOrEqual(1)
    expect(b[b.length - 1]).toBe(572)
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1])
    expect(b.length).toBeLessThanOrEqual(12)
  })

  it('degenerates gracefully for tiny networks', () => {
    expect(benchmarkBudgets(1, 12)).toEqual([1])
    expect(benchmarkBudgets(0, 12)).toEqual([])
    expect(benchmarkBudgets(3, 12)).toEqual([1, 2, 3])
  })
})

describe('runBenchmark on the real region', () => {
  const region = loadLosPadres()
  const placed = runPlacement(region, DEFAULT_TEST_PARAMS)
  const d = demandPoints(
    placed.risk, region.mask, region.meta.widthKm, region.meta.heightKm,
    DEFAULT_TEST_PARAMS.demandStride,
  )
  const result = runBenchmark({
    risk: placed.risk, mask: region.mask,
    widthKm: region.meta.widthKm, heightKm: region.meta.heightKm,
    nodes: placed.nodes, detectKm: DEFAULT_TEST_PARAMS.detectKm,
    demandStride: DEFAULT_TEST_PARAMS.demandStride,
    strideKm: strideKm(region.meta, DEFAULT_TEST_PARAMS.demandStride),
  })

  it('scores both arms on exactly the same number of nodes at every budget', () => {
    for (const p of result.points) {
      expect(p.scored).toBeGreaterThan(0)
      expect(p.scored).toBeLessThanOrEqual(p.requested)
    }
  })

  it('reports a case where the two arms would NOT have matched without capping', () => {
    // The cap has to be doing work, or the fairness guarantee is a tautology
    // about array lengths — the defect Plan 1's Task 9 review found twice.
    const n = placed.nodeCount
    const grid = uniformGrid(region.meta.widthKm, region.meta.heightKm, n, region.mask)
    expect(grid.length / 2).not.toBe(n)                   // the arms differ raw
    const [a, b] = capToCommonCount(placed.nodes, grid)
    expect(a.length).toBe(b.length)                       // and match after capping
    expect(a.length / 2).toBe(Math.min(n, grid.length / 2))
  })

  it('agrees with a directly computed head-to-head at the full budget', () => {
    const grid = uniformGrid(
      region.meta.widthKm, region.meta.heightKm, placed.nodeCount, region.mask,
    )
    const [ca, cb] = capToCommonCount(placed.nodes, grid)
    const [pw] = coverageOf(ca, d.xy, d.w, DEFAULT_TEST_PARAMS.detectKm)
    const [gw] = coverageOf(cb, d.xy, d.w, DEFAULT_TEST_PARAMS.detectKm)
    expect(result.atBudget.pyra).toBeCloseTo(pw, 12)
    expect(result.atBudget.uniform).toBeCloseTo(gw, 12)
  })

  it('reproduces the measured curve, including the crossover', () => {
    // Measured against the committed rasters: the risk-driven arm leads at
    // small budgets, the uniform grid leads at saturation, and they cross at
    // roughly 270 nodes. If these move, the site's headline claim moved with
    // them — re-measure and rewrite the copy, do not adjust the assertion.
    expect(result.bestMargin.deltaPP).toBeGreaterThan(2)
    expect(result.bestMargin.requested).toBeLessThan(300)
    expect(result.crossoverNodes).not.toBeNull()
    expect(result.crossoverNodes!).toBeGreaterThan(150)
    expect(result.crossoverNodes!).toBeLessThan(400)
    expect(result.atBudget.deltaPP).toBeLessThan(0)
  })

  it('carries the stride and the demand count so the copy can state them', () => {
    expect(result.strideKm).toBeCloseTo(0.36608429859016334, 9)
    expect(result.demandCount).toBe(d.xy.length / 2)
    expect(result.detectKm).toBe(DEFAULT_TEST_PARAMS.detectKm)
  })
})

describe('runBenchmark degenerate inputs', () => {
  it('returns an empty curve when nothing was placed', () => {
    const region = loadLosPadres()
    const r = runBenchmark({
      risk: { nx: 2, ny: 2, data: Float32Array.from([1, 1, 1, 1]) },
      mask: { nx: 2, ny: 2, data: Float32Array.from([1, 1, 1, 1]) },
      widthKm: 10, heightKm: 10, nodes: new Float64Array(0),
      detectKm: 2, demandStride: 1, strideKm: 5,
    })
    expect(r.points).toEqual([])
    expect(r.crossoverNodes).toBeNull()
    expect(region.meta.name).toBe('los-padres')   // helper sanity
  })
})
```

Create the shared helper `web/tests/helpers/losPadres.ts` so `pipeline.test.ts`, `benchmark.test.ts` and `risk.test.ts` stop each hand-rolling the same loader:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RegionData, RegionMeta } from '../../src/lib/loadRegion'
import { burnableMaskOf } from '../../src/lib/risk'

const DIR = join(__dirname, '..', '..', 'public', 'data', 'los-padres')

function bytes(name: string): Uint8Array {
  const b = readFileSync(join(DIR, name))
  return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

export function loadLosPadres(): RegionData {
  const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf-8')) as RegionMeta
  const cb = bytes('classes.bin')
  const ab = bytes('activity.bin')
  const classes = { nx: meta.nx, ny: meta.ny, data: cb }
  const [west, south, east, north] = meta.box
  return {
    meta,
    classes,
    activity: new Float32Array(ab.buffer, ab.byteOffset, ab.byteLength / 4),
    mask: burnableMaskOf(classes, meta.burnableClasses),
    bbox: { west, south, east, north },
  }
}

/** The Lab's shipped defaults, as the tests need them. */
export const DEFAULT_TEST_PARAMS = {
  seed: 7,
  detectKm: 2.0,
  target: 0.95,
  demandStride: 4,
  wWeather: 0.45,
  wActivity: 0.35,
  budgetMode: 'saturation' as const,
  fixedNodes: 100,
  spacingOverride: null,
}
```

**The mutation each test catches.** *Budget ladder:* a ladder that repeats a value or overshoots the node count (the last point must be the real budget or `atBudget` is a lie). *Equal-scored counts:* removing `capToCommonCount`. *The "would not have matched" test:* this is the one Plan 1's ledger demanded — it asserts the raw counts genuinely differ *before* asserting they match after, so the guarantee cannot pass by construction the way the old fairness test did. *Direct recomputation:* a sweep that scores the arms against different demand sets, or that forgets to re-score the capped arrays. *Curve shape:* an implementation that swaps the two series (delta sign flips everywhere), or that takes the *last* N nodes instead of the first N (the prefix property is what makes the sweep legitimate). *Stride and count:* a copy layer that has no stride to report — the honesty rule requires it.

Also rewrite `web/tests/fairness.test.ts` so its "benchmark fairness" case calls `runBenchmark` rather than constructing a stand-in model arm from the grid's own length. Plan 1's ledger records that the original version could not fail, twice.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npm test -- benchmark
```

Expected: FAIL — cannot resolve `../src/lib/benchmark`.

- [ ] **Step 3: Implement**

Create `web/src/lib/benchmark.ts`:

```ts
import type { Field } from './types'
import { uniformGrid, capToCommonCount } from './grid'
import { coverageOf, demandPoints } from './cover'

export interface BenchmarkPoint {
  /** The node budget asked for. */
  requested: number
  /** What both arms were actually scored on, after capping to the common count. */
  scored: number
  /** Risk-weighted coverage, risk-driven placement. */
  pyra: number
  /** Risk-weighted coverage, uniform grid. */
  uniform: number
  /** pyra - uniform, in percentage points. */
  deltaPP: number
}

export interface BenchmarkResult {
  points: BenchmarkPoint[]
  /** The point at the run's own node count — the headline pair. */
  atBudget: BenchmarkPoint
  /** Where the risk-driven arm leads by the most. */
  bestMargin: BenchmarkPoint
  /** The smallest budget at which the uniform grid takes the lead, if any. */
  crossoverNodes: number | null
  /** Scoring stride in km. Every coverage number shown must state this. */
  strideKm: number
  demandCount: number
  detectKm: number
}

const EMPTY: BenchmarkPoint = {
  requested: 0, scored: 0, pyra: 0, uniform: 0, deltaPP: 0,
}

/**
 * The node budgets to score. Roughly geometric so the small-budget end — where
 * the two strategies actually differ — is not swamped by the saturated end,
 * and always ending exactly at `maxNodes` so `atBudget` is a real measurement
 * rather than an interpolation.
 */
export function benchmarkBudgets(maxNodes: number, steps = 14): number[] {
  const n = Math.floor(maxNodes)
  if (n <= 0) return []
  if (n <= steps) return Array.from({ length: n }, (_, i) => i + 1)

  const out: number[] = []
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    const v = Math.round(Math.exp(Math.log(1) + t * Math.log(n)))
    const clamped = Math.min(Math.max(v, 1), n)
    if (out.length === 0 || clamped > out[out.length - 1]) out.push(clamped)
  }
  if (out[out.length - 1] !== n) out.push(n)
  return out
}

/**
 * Benchmark A: at the same realised node count, over the same region and the
 * same demand points, how much risk-weighted burnable demand does the
 * risk-driven placement cover, and how much does a uniform grid cover?
 *
 * Swept across node budgets rather than reported at one, because the answer
 * changes sign. Measured on Los Padres at detect 2 km: the risk-driven arm
 * leads by up to 3.6 pp around 170 nodes and trails by 4.2 pp at the 572-node
 * saturation budget, crossing near 270. Reporting either end alone would be a
 * cherry-pick.
 *
 * The sweep costs one extra `uniformGrid` per budget and nothing at all for
 * the risk-driven arm: `greedyMinimise` selects in descending marginal gain
 * and never revisits, so its first N nodes ARE the N-node solution.
 *
 * The uniform arm is given the burnable mask on purpose. That hands the
 * baseline part of the model's own input and makes it stronger — measured, it
 * scores 96.9% versus an unmasked grid's 98.4% at 572 requested, because the
 * unmasked grid wastes nodes on the Pacific. Any ambiguity is resolved in the
 * baseline's favour; a flattered baseline is worse than no benchmark.
 */
export function runBenchmark(args: {
  risk: Field
  mask: Field
  widthKm: number
  heightKm: number
  nodes: Float64Array
  detectKm: number
  demandStride: number
  strideKm: number
}): BenchmarkResult {
  const { risk, mask, widthKm, heightKm, nodes, detectKm } = args
  const total = nodes.length / 2
  const demand = demandPoints(risk, mask, widthKm, heightKm, args.demandStride)
  const demandCount = demand.xy.length / 2

  const base = {
    strideKm: args.strideKm,
    demandCount,
    detectKm,
  }
  if (total === 0 || demandCount === 0) {
    return { points: [], atBudget: EMPTY, bestMargin: EMPTY,
             crossoverNodes: null, ...base }
  }

  const points: BenchmarkPoint[] = []
  for (const requested of benchmarkBudgets(total)) {
    // The first `requested` nodes are the `requested`-node greedy solution.
    const pyraArm = nodes.slice(0, 2 * requested)
    const gridArm = uniformGrid(widthKm, heightKm, requested, mask)
    // Neither arm reliably realises the count it was asked for, so cap both to
    // the common realised count before scoring. The site says "capped to the
    // same realised count", which is what this does — not "identical count".
    const [a, b] = capToCommonCount(pyraArm, gridArm)
    const scored = a.length / 2
    if (scored === 0) continue
    const [pyra] = coverageOf(a, demand.xy, demand.w, detectKm)
    const [uniform] = coverageOf(b, demand.xy, demand.w, detectKm)
    points.push({
      requested, scored, pyra, uniform,
      deltaPP: 100 * (pyra - uniform),
    })
  }

  if (points.length === 0) {
    return { points: [], atBudget: EMPTY, bestMargin: EMPTY,
             crossoverNodes: null, ...base }
  }

  const atBudget = points[points.length - 1]
  const bestMargin = points.reduce((best, p) => (p.deltaPP > best.deltaPP ? p : best))
  const crossing = points.find((p) => p.deltaPP < 0)
  return {
    points,
    atBudget,
    bestMargin,
    crossoverNodes: crossing ? crossing.requested : null,
    ...base,
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd web && npm test -- benchmark fairness
```

Expected: PASS, 9 tests in `benchmark`, the rewritten fairness case green. Then `npm test` (expect 200 passing) and `npm run build`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/benchmark.ts web/tests/benchmark.test.ts \
        web/tests/helpers/losPadres.ts web/tests/fairness.test.ts
git commit -m "feat(web): Benchmark A as a coverage-versus-budget sweep

At equal realised node count the risk-driven placement leads at
constrained budgets and the uniform grid leads at saturation — measured,
they cross near 270 nodes on Los Padres. Reporting the whole curve rather
than one end, with both arms capped by capToCommonCount."
```

---

### Task 8: Worker protocol and store

**Files:**
- Modify: `web/src/workers/place.worker.ts`
- Modify: `web/src/state/useModelStore.ts`
- Test: `web/tests/pipeline.test.ts` (add the store defaults case)

**Interfaces:**
- Consumes: `PlaceParams`, `PlaceResult`, `runPlacement`, `strideKm` (`pipeline.ts`); `runBenchmark`, `BenchmarkResult` (`benchmark.ts`); `RegionData` (`loadRegion.ts`).
- Produces:
  - `interface RunMessage { type: 'run'; runId: number; region: RegionData; params: PlaceParams }`
  - `interface DoneMessage { type: 'done'; runId: number; result: PlaceResult; benchmark: BenchmarkResult }`
  - `interface ErrorMessage { type: 'error'; runId: number; message: string }`
  - `DEFAULT_PARAMS: PlaceParams` with `{ seed: 7, detectKm: 2.0, target: 0.95, demandStride: 4, wWeather: 0.45, wActivity: 0.35, budgetMode: 'saturation', fixedNodes: 100, spacingOverride: null }`
  - Store gains `benchmark: BenchmarkResult | null`, `setBenchmark`, `availableRegions: string[]`, `setAvailableRegions`, and `setWeights(w: Weights)` which routes through `clampWeights`

- [ ] **Step 1: Write the failing test**

Add to `web/tests/pipeline.test.ts`:

```ts
import { DEFAULT_PARAMS, useModelStore } from '../src/state/useModelStore'

describe('store defaults and weight coupling', () => {
  it('defaults to saturation and the model\'s own published weights', () => {
    expect(DEFAULT_PARAMS.budgetMode).toBe('saturation')
    expect(DEFAULT_PARAMS.wWeather).toBe(0.45)
    expect(DEFAULT_PARAMS.wActivity).toBe(0.35)
    expect(DEFAULT_PARAMS.demandStride).toBe(4)
    expect(DEFAULT_PARAMS.spacingOverride).toBeNull()
  })

  it('never lets the two drive weights sum above one', () => {
    const s = useModelStore.getState()
    s.setWeights({ wWeather: 0.9, wActivity: 0.9 })
    const p = useModelStore.getState().params
    expect(p.wWeather + p.wActivity).toBeLessThanOrEqual(1 + 1e-12)
    expect(p.wWeather).toBe(0.9)
    expect(p.wActivity).toBeCloseTo(0.1, 12)
    s.setParams(DEFAULT_PARAMS)
  })

  it('clears the previous benchmark when the region changes', () => {
    const s = useModelStore.getState()
    s.setBenchmark({ points: [], atBudget: null as any, bestMargin: null as any,
                     crossoverNodes: null, strideKm: 1, demandCount: 0, detectKm: 2 })
    useModelStore.getState().setRegionName('congo-basin')
    expect(useModelStore.getState().benchmark).toBeNull()
    useModelStore.getState().setRegionName('los-padres')
  })
})
```

**The mutation each test catches.** *Defaults:* a default that quietly drifts to `auto`, which on Los Padres would show 18 nodes and ~5% coverage as if that were the model's answer. *Weight coupling:* a slider pair that lets `w_base` go negative — which inverts the spacing rule, because `radiusAt` reads the field directly. *Benchmark clearing:* a stale curve from one region rendered under another region's name, which is the kind of error a judge would catch on stage.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npm test -- pipeline
```

Expected: FAIL — `setWeights` is not a function.

- [ ] **Step 3: Update the worker**

Replace `web/src/workers/place.worker.ts`:

```ts
import { runPlacement, strideKm, type PlaceParams, type PlaceResult } from '../lib/pipeline'
import { runBenchmark, type BenchmarkResult } from '../lib/benchmark'
import type { RegionData } from '../lib/loadRegion'

/**
 * Runs the siting pipeline and Benchmark A off the main thread.
 *
 * Placement on a real region is hundreds of milliseconds of tight numeric
 * work; the benchmark adds one uniformGrid and two coverageOf calls per budget
 * on top. On the main thread that would stall the map and, later, the scroll.
 *
 * `runId` correlates a response with the run that asked for it, so a
 * superseded run finishing late cannot overwrite a newer result — a slider
 * dragged twice quickly produces two runs and only the newer one may land.
 */
export interface RunMessage {
  type: 'run'
  runId: number
  region: RegionData
  params: PlaceParams
}

export interface DoneMessage {
  type: 'done'
  runId: number
  result: PlaceResult
  benchmark: BenchmarkResult
}

export interface ErrorMessage {
  type: 'error'
  runId: number
  message: string
}

self.onmessage = (e: MessageEvent<RunMessage>) => {
  const runId = e.data?.runId ?? 0
  if (e.data?.type !== 'run') return
  try {
    const { region, params } = e.data
    const result = runPlacement(region, params)
    const benchmark = runBenchmark({
      risk: result.risk,
      mask: region.mask,
      widthKm: region.meta.widthKm,
      heightKm: region.meta.heightKm,
      nodes: result.nodes,
      detectKm: params.detectKm,
      demandStride: params.demandStride,
      strideKm: strideKm(region.meta, params.demandStride),
    })
    const msg: DoneMessage = { type: 'done', runId, result, benchmark }
    // Transfer the big buffers rather than structured-cloning them. `risk` is
    // transferred too — MapRoot re-renders the raster from it, so the reader
    // sees the field change when a weight moves.
    ;(self as unknown as Worker).postMessage(msg, [
      result.candidates.buffer, result.nodes.buffer, result.risk.data.buffer,
    ] as unknown as Transferable[])
  } catch (err) {
    const msg: ErrorMessage = {
      type: 'error',
      runId,
      message: err instanceof Error
        ? `${err.message}\n${err.stack ?? ''}`.trim()
        : String(err),
    }
    ;(self as unknown as Worker).postMessage(msg)
  }
}
```

- [ ] **Step 4: Update the store**

In `web/src/state/useModelStore.ts`, replace `DEFAULT_PARAMS`, drop `spacingFor` (superseded by `budget.ts`), and add the new state:

```ts
import { create } from 'zustand'
import type { RegionData } from '../lib/loadRegion'
import type { PlaceParams, PlaceResult } from '../lib/pipeline'
import type { BenchmarkResult } from '../lib/benchmark'
import { clampWeights, type Weights } from '../lib/risk'

/**
 * The Lab's defaults.
 *
 * Saturation, not `auto`: `plan.auto_budget` returns 18 nodes on Los Padres
 * (about 5% coverage on a region that needs ~572 for 95%), which is the
 * library's own default and is offered as a mode — but starting there would
 * show a reader the clamp rather than the model.
 *
 * The weights are the published defaults from `plan.risk_field`, read out of
 * the bake's meta.json rather than restated; these literals exist only so the
 * store has something before a region loads, and a test pins them to the
 * baked values.
 */
export const DEFAULT_PARAMS: PlaceParams = {
  seed: 7,
  detectKm: 2.0,
  target: 0.95,
  demandStride: 4,
  wWeather: 0.45,
  wActivity: 0.35,
  budgetMode: 'saturation',
  fixedNodes: 100,
  spacingOverride: null,
}

interface ModelState {
  regionName: string
  region: RegionData | null
  availableRegions: string[]
  params: PlaceParams
  result: PlaceResult | null
  benchmark: BenchmarkResult | null
  running: boolean
  error: string | null

  setRegionName: (n: string) => void
  setRegion: (r: RegionData) => void
  setAvailableRegions: (r: string[]) => void
  setParam: <K extends keyof PlaceParams>(k: K, v: PlaceParams[K]) => void
  setParams: (p: PlaceParams) => void
  /** Both drive weights move together so `w_base` can never go negative. */
  setWeights: (w: Weights) => void
  setRunning: (b: boolean) => void
  setResult: (r: PlaceResult | null) => void
  setBenchmark: (b: BenchmarkResult | null) => void
  setError: (m: string | null) => void
}

export const useModelStore = create<ModelState>((set) => ({
  regionName: 'los-padres',
  region: null,
  availableRegions: [],
  params: DEFAULT_PARAMS,
  result: null,
  benchmark: null,
  running: false,
  error: null,

  setRegionName: (n) => set({
    regionName: n, region: null, result: null, benchmark: null, error: null,
  }),
  setRegion: (r) => set({ region: r }),
  setAvailableRegions: (r) => set({ availableRegions: r }),
  setParam: (k, v) => set((s) => ({ params: { ...s.params, [k]: v } })),
  setParams: (p) => set({ params: p }),
  setWeights: (w) => set((s) => ({ params: { ...s.params, ...clampWeights(w) } })),
  setRunning: (b) => set({ running: b }),
  setResult: (r) => set({ result: r }),
  setBenchmark: (b) => set({ benchmark: b }),
  setError: (m) => set({ error: m }),
}))
```

`RunPanel.tsx` currently imports `spacingFor` and sets `rMinKm`/`rMaxKm` from the detect-radius slider; delete that handler body for now and set only `detectKm` — Task 11 rebuilds the panel properly. `MapRoot.tsx` reads `region.risk` for the raster image; change it to read `result?.risk` and skip the raster until the first run completes.

- [ ] **Step 5: Run the tests**

```bash
cd web && npm test
```

Expected: 203 passing. Then `npm run build`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/workers/place.worker.ts web/src/state/useModelStore.ts \
        web/src/ui/RunPanel.tsx web/src/map/MapRoot.tsx web/tests/pipeline.test.ts
git commit -m "feat(web): worker returns the benchmark and the recombined field

The store carries the weights as a coupled pair so w_base can never go
negative, and clears the benchmark when the region changes."
```

---

### Task 9: Validate the series palette and name the slots

**Files:**
- Create: `web/scripts/validate_palette.mjs` (vendored, unmodified)
- Create: `docs/palette-validation.md`
- Modify: `web/src/theme/palette.ts`
- Modify: `web/package.json` (one script entry)
- Modify: `web/tests/palette.test.ts`

**Interfaces:**
- Produces: `PALETTE.series` — `{ pyra: string; baseline: string }` — plus `PALETTE.chart` — `{ surface: string; grid: string; axis: string; inkMuted: string }`. `PALETTE.series.pyra === PALETTE.meshTeal` and `PALETTE.series.baseline === PALETTE.baselineGray`; the named slots exist so chart code asks for a *job*, never a hue.
- Adds npm script: `"validate:palette": "node scripts/validate_palette.mjs \"#4DE1C1,#8A9691\" --mode dark --surface \"#0E1F16\""`

**What the validator actually says — measured, not assumed.** Run against the two-series pair on the panel surface:

```
Palette (dark, surface #0E1F16, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#4DE1C1",0.823]]
  [FAIL] Chroma floor           below floor (reads gray): [["#8A9691",0.016]]
  [PASS] CVD separation         worst adjacent #8A9691↔#4DE1C1 ΔE 15.9 (deutan) · tritan 20.9
  [PASS] Normal-vision floor    worst adjacent #8A9691↔#4DE1C1 ΔE 20.0 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
```

Both FAILs are real and both are the right trade, and the plan says why rather than muting them.

*Chroma floor.* Check 3 exists so a **categorical identity** hue does not read as grey. This is not a categorical pair — it is the skill's **emphasis** form: one accent series plus the de-emphasis grey. The baseline is grey *because* it is the thing being out-argued. The check does not apply, and swapping it for a chromatic hue would put two competing hues on screen, which the spec forbids in as many words: "System versus nothing, never two competing hues."

*Lightness band.* Re-stepping the teal into the dark band collapses the pair. Measured, five candidate steps against `#8A9691`:

| teal step | OKLCH L | worst CVD ΔE | normal-vision ΔE |
|---|---:|---:|---:|
| `#4DE1C1` (shipped) | 0.823 | **15.9** | **20.0** |
| `#35C4A8` | 0.739 | 7.5 (WARN) | 13.4 (FAIL) |
| `#28BFA3` | 0.723 | 5.9 (FAIL) | 12.7 (FAIL) |
| `#2BB39A` | 0.690 | 2.6 (FAIL) | 10.7 (FAIL) |
| `#22A98F` | in band | 0.4 (FAIL) | 10.1 (FAIL) |

The lightness difference is what carries the separation from an achromatic baseline, so every step that satisfies check 2 fails checks 4 and 4b — including the normal-vision floor, which the skill calls a hard gate. Keeping `#4DE1C1` is the only option that clears the gates that decide whether two readers can tell the series apart.

*The obligation this creates.* The skill's rule is that a relaxed colour check must be paid for with secondary encoding. Task 10 therefore ships, non-optionally: a legend (two series), direct labels on both line ends, and a table view. None of those is a nice-to-have here — they are the price of the waiver.

*Single mode.* The site is a deliberately single-surface dark product (`canvas #060706`, `surface #0E1F16`); there is no light theme to select steps for. The validator is run against the dark surface only, and `docs/palette-validation.md` records that as a decision rather than an omission.

- [ ] **Step 1: Vendor the validator**

Copy `scripts/validate_palette.js` from the `dataviz` skill's base directory (shown at the top of the skill prompt) to `web/scripts/validate_palette.mjs`, **byte for byte**. Do not edit it — a locally-adjusted validator validates nothing. The `.mjs` extension avoids the `MODULE_TYPELESS_PACKAGE_JSON` warning the `.js` form produces.

Add to `web/package.json` `"scripts"`:

```json
"validate:palette": "node scripts/validate_palette.mjs \"#4DE1C1,#8A9691\" --mode dark --surface \"#0E1F16\""
```

- [ ] **Step 2: Run it and record the output verbatim**

```bash
cd web && npm run validate:palette
```

Create `docs/palette-validation.md` containing: the exact command, the verbatim output block, the five-step table above (regenerate it by running the validator on each candidate — do not copy it on trust), and the three decisions above stated as decisions with their reasons. End the file with the obligation:

> Because checks 2 and 3 are waived, every chart using these two series **must** carry a legend, direct labels on both series, and a table view. `web/tests/chartModel.test.ts` enforces all three.

- [ ] **Step 3: Write the failing palette test**

Add to `web/tests/palette.test.ts`:

```ts
describe('series slots', () => {
  it('names the two series by the job they do, not by hue', () => {
    expect(PALETTE.series.pyra).toBe(PALETTE.meshTeal)
    expect(PALETTE.series.baseline).toBe(PALETTE.baselineGray)
  })

  it('keeps the reserved heat ramp out of the series slots', () => {
    const heat = PALETTE.heat.map((c) => c.toLowerCase())
    expect(heat).not.toContain(PALETTE.series.pyra.toLowerCase())
    expect(heat).not.toContain(PALETTE.series.baseline.toLowerCase())
    expect(heat).not.toContain(PALETTE.chart.grid.toLowerCase())
    expect(heat).not.toContain(PALETTE.chart.axis.toLowerCase())
  })

  it('keeps the brand orange out of every chart token', () => {
    const chartTokens = [
      PALETTE.series.pyra, PALETTE.series.baseline,
      ...Object.values(PALETTE.chart),
    ].map((c) => c.toLowerCase())
    expect(chartTokens).not.toContain(PALETTE.brandOrange.toLowerCase())
  })

  it('gives chart chrome its own recessive tokens', () => {
    const HEX = /^#[0-9A-Fa-f]{6}$/
    for (const v of Object.values(PALETTE.chart)) expect(v).toMatch(HEX)
    // Grid and axis must not be the ink colour — recessive means recessive.
    expect(PALETTE.chart.grid).not.toBe(PALETTE.ink)
    expect(PALETTE.chart.axis).not.toBe(PALETTE.ink)
  })
})
```

**The mutation each test catches.** A later chart file reaching for `PALETTE.heat[2]` because it looks good on a dark background — which would spend the fire signal on a data series and break the one rule the whole design rests on. A chart drawing gridlines in `ink`, which makes the chrome compete with the data.

- [ ] **Step 4: Run it and watch it fail**

```bash
cd web && npm test -- palette
```

Expected: FAIL — `PALETTE.series` is undefined.

- [ ] **Step 5: Add the slots**

Append to the `PALETTE` object in `web/src/theme/palette.ts`, before the closing `} as const`:

```ts
  /**
   * Data-series slots, addressed by the job each one does.
   *
   * This is the skill's EMPHASIS form, not a categorical palette: one accent
   * carrying the system, one de-emphasis grey carrying the thing it is being
   * compared against. Chart code asks for `series.pyra`, never for a hue, so
   * a series can never be recoloured by its rank or by which filter is active.
   *
   * The pair is validated in docs/palette-validation.md. It passes CVD
   * separation (deutan ΔE 15.9), the normal-vision floor (20.0) and contrast;
   * it is waived on the dark lightness band and the chroma floor, and every
   * step that would satisfy those two collapses the separation to ΔE 0.4–7.5.
   * The waiver is paid for with a legend, direct labels and a table view.
   */
  series: {
    pyra: '#4DE1C1',        // === meshTeal
    baseline: '#8A9691',    // === baselineGray
  },

  /** Chart chrome. Recessive by construction: one step off the surface. */
  chart: {
    surface: '#0E1F16',     // === surface
    grid: '#1B3B29',        // === surfaceRaised
    axis: '#2C5540',
    inkMuted: '#9FB3A8',
  },
```

- [ ] **Step 6: Run the tests**

```bash
cd web && npm test -- palette && npm run validate:palette
```

Expected: palette tests PASS. `validate:palette` exits **1** with the two documented FAILs — that is the recorded state, not a regression. Do not add it to the CI gate; the gate is `docs/palette-validation.md` plus the tests in Task 10.

Then `npm test` (expect 207 passing) and `npm run build`.

- [ ] **Step 7: Commit**

```bash
cd "C:/Pyra NTE"
git add web/scripts/validate_palette.mjs web/package.json \
        web/src/theme/palette.ts web/tests/palette.test.ts docs/palette-validation.md
git commit -m "feat(web): validated series slots, with the waiver written down

Ran the dataviz validator on the mesh-teal / baseline-grey pair. It clears
CVD separation, the normal-vision floor and contrast; it is waived on the
dark lightness band and the chroma floor, because every teal step inside
the band drops CVD separation to 0.4-7.5 dE against an achromatic
baseline. Paid for with a legend, direct labels and a table view."
```

---

### Task 10: Stat tiles and the comparison chart

**Files:**
- Create: `web/src/ui/chartModel.ts`
- Create: `web/src/ui/StatTile.tsx`
- Create: `web/src/ui/CoverageBudgetChart.tsx`
- Test: `web/tests/chartModel.test.ts`

**Interfaces:**
- Consumes: `BenchmarkPoint`, `BenchmarkResult` (`benchmark.ts`); `PALETTE` (`palette.ts`).
- Produces:
  - `interface ChartSeries { key: 'pyra' | 'uniform'; label: string; color: string; path: string; points: Array<{ x: number; y: number; datum: BenchmarkPoint }>; endLabel: { x: number; y: number; text: string } }`
  - `interface ChartAxis { orientation: 'x' | 'y'; ticks: Array<{ value: number; pos: number; label: string }> }`
  - `interface ChartAnnotation { x: number; y: number; text: string; leader: { x1: number; y1: number; x2: number; y2: number } }`
  - `interface ChartModel { width: number; height: number; pad: { top: number; right: number; bottom: number; left: number }; series: ChartSeries[]; axes: ChartAxis[]; legend: Array<{ label: string; color: string }>; annotations: ChartAnnotation[]; table: Array<{ nodes: number; pyra: string; uniform: string; delta: string }>; xOf(nodes: number): number; yOf(fraction: number): number }`
  - `function buildChartModel(result: BenchmarkResult, width?: number, height?: number): ChartModel`
  - `function StatTile(props: { label: string; value: string; note?: string })`
  - `function HeroFigure(props: { label: string; value: string; note: string })`
  - `function KpiRow(props: { children: React.ReactNode })`
  - `function CoverageBudgetChart(props: { result: BenchmarkResult })`

**Form selection, per the skill's procedure — form first, colour last.**

| The data's job | Form | Why not the alternative |
|---|---|---|
| Headline margin, one number | **Hero figure** (≥48px), exactly one per view | A one-bar bar chart says nothing a number does not |
| Node count, coverage, set-cover reduction, area covered | **KPI row of stat tiles** | A grouped bar chart of four unrelated units would need a dual axis, which is banned |
| Coverage of two strategies across an ordered budget axis | **Two-line chart, one y-axis** | A grouped bar at 14 budgets is 28 bars and buries the crossing, which is the entire finding |

Colour comes last and is assigned by job: `series.pyra` for the risk-driven line, `series.baseline` for the uniform grid. Not by rank, not by which is winning — the risk-driven line stays teal on the half of the chart where it loses.

Mark specs, from the skill: 2px lines with round joins and caps; ≥8px end markers (r ≥ 4) each carrying a 2px ring in the chart surface colour so they stay legible where the lines cross; hairline solid gridlines one step off the surface, never dashed; direct labels on the two line ends only, never a value on every point; y-axis ticks at round numbers. Text wears `PALETTE.ink` and `PALETTE.chart.inkMuted`, never a series colour — the legend swatch beside the text carries identity.

- [ ] **Step 1: Write the failing test**

Create `web/tests/chartModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildChartModel } from '../src/ui/chartModel'
import { PALETTE } from '../src/theme/palette'
import type { BenchmarkResult } from '../src/lib/benchmark'

function fakeResult(): BenchmarkResult {
  const points = [
    { requested: 10, scored: 9, pyra: 0.026, uniform: 0.023, deltaPP: 0.3 },
    { requested: 100, scored: 92, pyra: 0.253, uniform: 0.223, deltaPP: 3.0 },
    { requested: 170, scored: 157, pyra: 0.414, uniform: 0.378, deltaPP: 3.6 },
    { requested: 300, scored: 274, pyra: 0.655, uniform: 0.672, deltaPP: -1.7 },
    { requested: 572, scored: 526, pyra: 0.928, uniform: 0.969, deltaPP: -4.2 },
  ]
  return {
    points,
    atBudget: points[4],
    bestMargin: points[2],
    crossoverNodes: 300,
    strideKm: 0.36608429859016334,
    demandCount: 31045,
    detectKm: 2,
  }
}

describe('buildChartModel', () => {
  const m = buildChartModel(fakeResult(), 640, 320)

  it('has exactly one y-axis and one x-axis — never a dual axis', () => {
    expect(m.axes.filter((a) => a.orientation === 'y')).toHaveLength(1)
    expect(m.axes.filter((a) => a.orientation === 'x')).toHaveLength(1)
  })

  it('assigns colour by the job each series does', () => {
    const pyra = m.series.find((s) => s.key === 'pyra')!
    const uniform = m.series.find((s) => s.key === 'uniform')!
    expect(pyra.color).toBe(PALETTE.series.pyra)
    expect(uniform.color).toBe(PALETTE.series.baseline)
  })

  it('keeps the risk-driven series teal even where it is losing', () => {
    // Colour follows the entity, never its rank. A model that recoloured the
    // leader would repaint the chart halfway along the x-axis.
    const pyra = m.series.find((s) => s.key === 'pyra')!
    expect(pyra.color).toBe(PALETTE.series.pyra)
    expect(pyra.points[pyra.points.length - 1].datum.deltaPP).toBeLessThan(0)
  })

  it('carries a legend for both series — the waived colour checks require it', () => {
    expect(m.legend).toHaveLength(2)
    expect(m.legend.map((l) => l.color).sort())
      .toEqual([PALETTE.series.baseline, PALETTE.series.pyra].sort())
    for (const l of m.legend) expect(l.label.length).toBeGreaterThan(3)
  })

  it('direct-labels both line ends and nothing else', () => {
    for (const s of m.series) {
      expect(s.endLabel.text).toMatch(/%$/)
      expect(s.endLabel.x).toBeCloseTo(s.points[s.points.length - 1].x, 6)
    }
  })

  it('maps coverage monotonically down the y-axis and pins the ends', () => {
    expect(m.yOf(0)).toBeGreaterThan(m.yOf(1))
    expect(m.yOf(1)).toBeCloseTo(m.pad.top, 6)
    expect(m.yOf(0)).toBeCloseTo(m.height - m.pad.bottom, 6)
  })

  it('maps the node budget monotonically across the x-axis', () => {
    expect(m.xOf(10)).toBeLessThan(m.xOf(572))
    expect(m.xOf(10)).toBeCloseTo(m.pad.left, 6)
    expect(m.xOf(572)).toBeCloseTo(m.width - m.pad.right, 6)
  })

  it('emits one point per benchmark point per series, in budget order', () => {
    for (const s of m.series) {
      expect(s.points).toHaveLength(5)
      for (let i = 1; i < s.points.length; i++) {
        expect(s.points[i].x).toBeGreaterThan(s.points[i - 1].x)
      }
      expect(s.path.startsWith('M')).toBe(true)
      expect((s.path.match(/L/g) ?? []).length).toBe(4)
    }
  })

  it('annotates the crossover with a leader line, not a stacked label', () => {
    expect(m.annotations).toHaveLength(1)
    const a = m.annotations[0]
    expect(a.text.toLowerCase()).toContain('cross')
    expect(a.text).toContain('300')
    expect(a.leader.x1).not.toBe(a.leader.x2)
  })

  it('omits the crossover annotation when the arms never cross', () => {
    const r = fakeResult()
    const m2 = buildChartModel({ ...r, crossoverNodes: null }, 640, 320)
    expect(m2.annotations).toHaveLength(0)
  })

  it('carries a table view of every plotted value', () => {
    expect(m.table).toHaveLength(5)
    expect(m.table[0]).toEqual({
      nodes: 9, pyra: '2.6%', uniform: '2.3%', delta: '+0.3 pp',
    })
    expect(m.table[4].delta).toBe('-4.2 pp')
  })

  it('reports the realised node count in the table, not the requested one', () => {
    // "Both arms capped to the same realised count" is the claim; the table
    // has to show the number that was actually scored.
    expect(m.table.map((r) => r.nodes)).toEqual([9, 92, 157, 274, 526])
  })

  it('uses round y ticks and no more than six of them', () => {
    const y = m.axes.find((a) => a.orientation === 'y')!
    expect(y.ticks.length).toBeGreaterThan(2)
    expect(y.ticks.length).toBeLessThanOrEqual(6)
    for (const t of y.ticks) expect(t.label).toMatch(/^\d{1,3}%$/)
  })
})
```

**The mutation each test catches.** *One axis:* a second y-scale added to fit the delta series — the skill's number-one mistake and an outright ban. *Colour by job / colour where losing:* a "highlight the winner" implementation that repaints the leader, which would make the chart lie about identity. *Legend length 2:* deleting the legend, which is exactly the secondary encoding the Task 9 waiver is paid with. *End labels:* labelling every point, which the skill calls chaos and which would collide at 14 budgets. *y-mapping:* an inverted axis, which would show the grid winning at low budgets. *Point count and path shape:* dropping points to "smooth" the curve. *Crossover annotation:* hardcoding a crossover that may not exist — regions where the arms never cross must not claim one. *Table:* no table view (the second half of the waiver), or a table reporting `requested` instead of `scored`, which would contradict the fairness wording.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && npm test -- chartModel
```

Expected: FAIL — cannot resolve `../src/ui/chartModel`.

- [ ] **Step 3: Implement the chart model**

Create `web/src/ui/chartModel.ts`:

```ts
import { PALETTE } from '../theme/palette'
import type { BenchmarkPoint, BenchmarkResult } from '../lib/benchmark'

export interface ChartSeries {
  key: 'pyra' | 'uniform'
  label: string
  color: string
  path: string
  points: Array<{ x: number; y: number; datum: BenchmarkPoint }>
  endLabel: { x: number; y: number; text: string }
}

export interface ChartAxis {
  orientation: 'x' | 'y'
  ticks: Array<{ value: number; pos: number; label: string }>
}

export interface ChartAnnotation {
  x: number
  y: number
  text: string
  leader: { x1: number; y1: number; x2: number; y2: number }
}

export interface ChartModel {
  width: number
  height: number
  pad: { top: number; right: number; bottom: number; left: number }
  series: ChartSeries[]
  axes: ChartAxis[]
  legend: Array<{ label: string; color: string }>
  annotations: ChartAnnotation[]
  table: Array<{ nodes: number; pyra: string; uniform: string; delta: string }>
  xOf: (nodes: number) => number
  yOf: (fraction: number) => number
}

const PAD = { top: 18, right: 72, bottom: 34, left: 46 }
const pct = (f: number) => `${(100 * f).toFixed(1)}%`
const signedPP = (pp: number) => `${pp >= 0 ? '+' : '-'}${Math.abs(pp).toFixed(1)} pp`

/**
 * Pure geometry for the coverage-versus-budget comparison chart.
 *
 * Split out of the component so the rules that matter are unit-testable
 * without a DOM: one y-axis (never two), colour assigned by the job each
 * series does rather than by which one is ahead, a legend for both series, and
 * a table view. The last two are not decoration — Task 9 waived two of the
 * palette's colour checks, and secondary encoding is what pays for that.
 *
 * The x-axis is log-scaled in node count. The interesting half of this chart
 * is the small-budget end, where the two strategies genuinely differ; a linear
 * axis spends two-thirds of its width on the saturated tail where both arms
 * are flat and converging.
 */
export function buildChartModel(
  result: BenchmarkResult, width = 640, height = 320,
): ChartModel {
  const pts = result.points
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  const nMin = pts.length ? pts[0].requested : 1
  const nMax = pts.length ? pts[pts.length - 1].requested : 1
  const lo = Math.log(Math.max(nMin, 1))
  const hi = Math.log(Math.max(nMax, Math.max(nMin, 1) + 1))

  const xOf = (nodes: number) =>
    PAD.left + ((Math.log(Math.max(nodes, 1)) - lo) / (hi - lo)) * plotW
  // Coverage is a fraction in [0, 1] on a single axis anchored at zero. Not
  // auto-scaled to the data: a y-axis starting at 0.9 would turn a 4-point
  // difference into a visual chasm.
  const yOf = (f: number) => PAD.top + (1 - Math.min(Math.max(f, 0), 1)) * plotH

  const build = (
    key: 'pyra' | 'uniform', label: string, color: string,
    pick: (p: BenchmarkPoint) => number,
  ): ChartSeries => {
    const points = pts.map((p) => ({ x: xOf(p.requested), y: yOf(pick(p)), datum: p }))
    const path = points
      .map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`)
      .join(' ')
    const last = points[points.length - 1]
    return {
      key, label, color, path, points,
      endLabel: last
        ? { x: last.x, y: last.y, text: pct(pick(last.datum)) }
        : { x: PAD.left, y: PAD.top, text: '0.0%' },
    }
  }

  const series: ChartSeries[] = pts.length
    ? [
        build('pyra', 'Risk-driven placement', PALETTE.series.pyra, (p) => p.pyra),
        build('uniform', 'Uniform grid', PALETTE.series.baseline, (p) => p.uniform),
      ]
    : []

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) => ({
    value: v, pos: yOf(v), label: `${Math.round(v * 100)}%`,
  }))
  const xTickValues = pts.length
    ? Array.from(new Set([nMin, ...pts.map((p) => p.requested)]))
        .filter((_, i, a) => i === 0 || i === a.length - 1 || i % 3 === 0)
    : []
  const axes: ChartAxis[] = [
    { orientation: 'y', ticks: yTicks },
    {
      orientation: 'x',
      ticks: xTickValues.map((v) => ({
        value: v, pos: xOf(v), label: String(v),
      })),
    },
  ]

  const annotations: ChartAnnotation[] = []
  const cross = result.crossoverNodes
  if (cross != null) {
    const at = pts.find((p) => p.requested === cross) ?? pts[pts.length - 1]
    const x = xOf(cross)
    const y = yOf(at.uniform)
    annotations.push({
      x: x + 10,
      y: y - 26,
      text: `uniform grid takes the lead at ~${cross} nodes`,
      // A leader line, not a nudged label: the two lines converge here, and
      // stacking labels detaches them from the marks they describe.
      leader: { x1: x, y1: y, x2: x + 8, y2: y - 20 },
    })
  }

  return {
    width, height, pad: PAD, series, axes,
    legend: series.map((s) => ({ label: s.label, color: s.color })),
    annotations,
    table: pts.map((p) => ({
      nodes: p.scored,
      pyra: pct(p.pyra),
      uniform: pct(p.uniform),
      delta: signedPP(p.deltaPP),
    })),
    xOf, yOf,
  }
}
```

- [ ] **Step 4: Run the model tests**

```bash
cd web && npm test -- chartModel
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Implement the tiles**

Create `web/src/ui/StatTile.tsx`:

```tsx
import type { ReactNode } from 'react'
import { PALETTE } from '../theme/palette'

/**
 * Stat tile: label, value, optional note. Per the dataviz skill's figure
 * contract — a handful of headline numbers is a KPI row, not a chart, and a
 * single number is never a one-bar bar chart.
 *
 * Values use the font's default proportional figures. `tabular-nums` is for
 * columns that must align vertically (the chart's table view), not for large
 * standalone numbers, where it makes short values look loose.
 */
export function StatTile({ label, value, note }: {
  label: string; value: string; note?: string
}) {
  return (
    <div style={{
      background: PALETTE.surface, border: `1px solid ${PALETTE.surfaceRaised}`,
      borderRadius: 8, padding: '10px 12px', minWidth: 108,
    }}>
      <div style={{ color: PALETTE.chart.inkMuted, fontSize: 11, letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ color: PALETTE.ink, fontSize: 22, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
      {note && (
        <div style={{ color: PALETTE.chart.inkMuted, fontSize: 10, marginTop: 3, lineHeight: 1.4 }}>
          {note}
        </div>
      )}
    </div>
  )
}

/**
 * The one number the view leads with. Exactly one per view, >= 48px, in the
 * same sans as everything else — a display face here reads as decoration.
 */
export function HeroFigure({ label, value, note }: {
  label: string; value: string; note: string
}) {
  return (
    <div style={{ padding: '4px 0 10px' }}>
      <div style={{ color: PALETTE.chart.inkMuted, fontSize: 11, letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ color: PALETTE.ink, fontSize: 48, fontWeight: 600, lineHeight: 1.05 }}>
        {value}
      </div>
      <div style={{ color: PALETTE.chart.inkMuted, fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
        {note}
      </div>
    </div>
  )
}

export function KpiRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      {children}
    </div>
  )
}
```

- [ ] **Step 6: Implement the chart component**

Create `web/src/ui/CoverageBudgetChart.tsx`:

```tsx
import { useState } from 'react'
import { PALETTE } from '../theme/palette'
import { buildChartModel } from './chartModel'
import type { BenchmarkResult } from '../lib/benchmark'

/**
 * Two lines, one y-axis, a legend, direct end labels, a hover layer, and a
 * table view behind a toggle. Every one of those is required rather than
 * chosen: the legend and the table are what pay for the two waived palette
 * checks recorded in docs/palette-validation.md.
 */
export function CoverageBudgetChart({ result }: { result: BenchmarkResult }) {
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const m = buildChartModel(result)
  if (m.series.length === 0) return null

  const yAxis = m.axes.find((a) => a.orientation === 'y')!
  const xAxis = m.axes.find((a) => a.orientation === 'x')!
  const hovered = hover === null ? null : m.series[0].points[hover]?.datum ?? null

  return (
    <div>
      {/* Legend first: identity is never carried by colour alone. */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 4 }}>
        {m.legend.map((l) => (
          <span key={l.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: PALETTE.chart.inkMuted, fontSize: 11,
          }}>
            <span style={{
              width: 14, height: 2, borderRadius: 1, background: l.color,
            }} />
            {l.label}
          </span>
        ))}
      </div>

      <svg
        width="100%" viewBox={`0 0 ${m.width} ${m.height}`}
        role="img"
        aria-label={
          `Risk-weighted coverage against node budget, for risk-driven ` +
          `placement and a uniform grid, over ${result.demandCount.toLocaleString()} ` +
          `demand points at a ${result.strideKm.toFixed(2)} km stride.`
        }
        onMouseLeave={() => setHover(null)}
      >
        {yAxis.ticks.map((t) => (
          <g key={t.value}>
            <line
              x1={m.pad.left} x2={m.width - m.pad.right} y1={t.pos} y2={t.pos}
              stroke={PALETTE.chart.grid} strokeWidth={1}
            />
            <text
              x={m.pad.left - 8} y={t.pos + 3} textAnchor="end"
              fill={PALETTE.chart.inkMuted} fontSize={10}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >{t.label}</text>
          </g>
        ))}
        {xAxis.ticks.map((t) => (
          <text
            key={t.value} x={t.pos} y={m.height - m.pad.bottom + 14}
            textAnchor="middle" fill={PALETTE.chart.inkMuted} fontSize={10}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >{t.label}</text>
        ))}
        <text
          x={(m.pad.left + m.width - m.pad.right) / 2} y={m.height - 4}
          textAnchor="middle" fill={PALETTE.chart.inkMuted} fontSize={10}
        >nodes (both arms, realised)</text>

        {m.series.map((s) => (
          <path
            key={s.key} d={s.path} fill="none" stroke={s.color}
            strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          />
        ))}

        {/* End markers carry a 2px surface ring so they stay legible where
            the two lines cross. */}
        {m.series.map((s) => {
          const last = s.points[s.points.length - 1]
          return (
            <g key={`${s.key}-end`}>
              <circle
                cx={last.x} cy={last.y} r={4} fill={s.color}
                stroke={PALETTE.chart.surface} strokeWidth={2}
              />
              <text
                x={last.x + 8} y={last.y + 3} fill={PALETTE.ink} fontSize={11}
              >{s.endLabel.text}</text>
            </g>
          )
        })}

        {m.annotations.map((a) => (
          <g key={a.text}>
            <line
              x1={a.leader.x1} y1={a.leader.y1} x2={a.leader.x2} y2={a.leader.y2}
              stroke={PALETTE.chart.axis} strokeWidth={1}
            />
            <text x={a.x} y={a.y} fill={PALETTE.chart.inkMuted} fontSize={10}>
              {a.text}
            </text>
          </g>
        ))}

        {/* Hover layer: a full-height band per budget, so the hit target is far
            bigger than the 8px marks. */}
        {m.series[0].points.map((p, i) => (
          <rect
            key={p.datum.requested}
            x={p.x - 14} y={m.pad.top} width={28} height={m.height - m.pad.top - m.pad.bottom}
            fill="transparent" onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null && (
          <line
            x1={m.series[0].points[hover].x} x2={m.series[0].points[hover].x}
            y1={m.pad.top} y2={m.height - m.pad.bottom}
            stroke={PALETTE.chart.axis} strokeWidth={1}
          />
        )}
      </svg>

      {hovered && (
        <div style={{ color: PALETTE.ink, fontSize: 11, marginTop: 2 }}>
          {hovered.scored} nodes · risk-driven {(100 * hovered.pyra).toFixed(1)}%
          {' · '}uniform {(100 * hovered.uniform).toFixed(1)}%
          {' · '}Δ {hovered.deltaPP >= 0 ? '+' : ''}{hovered.deltaPP.toFixed(1)} pp
        </div>
      )}

      <button
        onClick={() => setShowTable((v) => !v)}
        style={{
          marginTop: 6, background: 'transparent', color: PALETTE.chart.inkMuted,
          border: 0, font: 'inherit', fontSize: 11, cursor: 'pointer', padding: 0,
        }}
      >
        {showTable ? '▾' : '▸'} Table view
      </button>
      {showTable && (
        <table style={{
          marginTop: 4, borderCollapse: 'collapse', fontSize: 11,
          color: PALETTE.ink, fontVariantNumeric: 'tabular-nums',
        }}>
          <thead>
            <tr style={{ color: PALETTE.chart.inkMuted, textAlign: 'right' }}>
              <th style={{ padding: '2px 8px' }}>nodes</th>
              <th style={{ padding: '2px 8px' }}>risk-driven</th>
              <th style={{ padding: '2px 8px' }}>uniform grid</th>
              <th style={{ padding: '2px 8px' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {m.table.map((r) => (
              <tr key={r.nodes} style={{ textAlign: 'right' }}>
                <td style={{ padding: '2px 8px' }}>{r.nodes}</td>
                <td style={{ padding: '2px 8px' }}>{r.pyra}</td>
                <td style={{ padding: '2px 8px' }}>{r.uniform}</td>
                <td style={{ padding: '2px 8px' }}>{r.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run everything**

```bash
cd web && npm test && npm run build
```

Expected: 220 passing, build succeeds.

- [ ] **Step 8: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/ui/chartModel.ts web/src/ui/StatTile.tsx \
        web/src/ui/CoverageBudgetChart.tsx web/tests/chartModel.test.ts
git commit -m "feat(web): stat tiles and the coverage-versus-budget comparison chart

Two series on one axis, legend present, direct end labels, hover band and
a table view. Geometry lives in a pure module so the rules that matter —
single axis, colour by job, legend, table — are unit-tested."
```

---

### Task 11: Region honesty, the control set, and the assembled Lab

**Files:**
- Create: `web/src/lib/regions.ts`
- Create: `web/src/ui/copy.ts`
- Create: `web/src/ui/BenchmarkPanel.tsx`
- Modify: `web/src/ui/RunPanel.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/tests/regions.test.ts`, `web/tests/copy.test.ts`

**Interfaces:**
- Consumes: `loadManifest` (`loadRegion.ts`); `BenchmarkResult` (`benchmark.ts`); `PlaceResult` (`pipeline.ts`); `StatTile`, `HeroFigure`, `KpiRow`; `CoverageBudgetChart`; `useModelStore`; `PALETTE`.
- Produces:
  - `interface RegionEntry { key: string; label: string; country: string; regime: string }`
  - `const REGIONS: RegionEntry[]` — the eight from `plan.py:REGIONS`, in that order
  - `function regionOptions(baked: string[]): Array<RegionEntry & { baked: boolean }>`
  - `function coverageSentence(a: { coveredFraction: number; strideKm: number; demandCount: number; detectKm: number }): string`
  - `function benchmarkSentence(r: BenchmarkResult): string`
  - `function seedSentence(tiesAtMax: number): string | null`
  - `function weightSentence(a: { wWeather: number; wActivity: number; wBase: number; fwiNorm: number }): string`
  - `function budgetSentence(a: { mode: BudgetMode; maxNodes: number | null; nodeCount: number }): string`
  - `function unbakedNotice(label: string): string`
  - `function BenchmarkPanel(): JSX.Element | null`

**The honesty obligations this task discharges.** Every coverage number states that it is risk-weighted and reports the stride in km. The benchmark caption states the fairness rule as "both arms capped to the same realised count" rather than "identical node count", because neither arm reliably realises its request. The benchmark caption also states which arm leads *at the budget on screen*, so the reader is never shown a losing comparison dressed as a win. The region picker names the seven unbaked regions and says they are unbaked, rather than offering them and failing. Nothing anywhere claims a fire model exists here.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/regions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGIONS, regionOptions } from '../src/lib/regions'

describe('REGIONS', () => {
  it('lists exactly the eight regions plan.py defines, in its order', () => {
    expect(REGIONS.map((r) => r.key)).toEqual([
      'los-padres', 'amazon-rondonia', 'siberia-baikal', 'portugal-centro',
      'victoria-alpine', 'congo-basin', 'sweden-norrland', 'greece-peloponnese',
    ])
  })

  it('gives every region a country and a fire regime', () => {
    for (const r of REGIONS) {
      expect(r.label.length).toBeGreaterThan(3)
      expect(r.country.length).toBeGreaterThan(2)
      expect(r.regime.length).toBeGreaterThan(3)
    }
  })
})

describe('regionOptions', () => {
  it('marks only the regions the manifest says are baked', () => {
    const opts = regionOptions(['los-padres'])
    expect(opts).toHaveLength(8)
    expect(opts.filter((o) => o.baked).map((o) => o.key)).toEqual(['los-padres'])
  })

  it('marks nothing baked when the manifest is empty', () => {
    expect(regionOptions([]).some((o) => o.baked)).toBe(false)
  })

  it('ignores a manifest entry that is not a known region', () => {
    const opts = regionOptions(['los-padres', 'atlantis'])
    expect(opts).toHaveLength(8)
    expect(opts.filter((o) => o.baked)).toHaveLength(1)
  })

  it('agrees with the manifest actually committed to the repo', () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, '..', 'public', 'data', 'manifest.json'), 'utf-8'))
    const opts = regionOptions(manifest.baked)
    expect(opts.filter((o) => o.baked).map((o) => o.key)).toEqual(['los-padres'])
  })
})
```

Create `web/tests/copy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  coverageSentence, benchmarkSentence, seedSentence, weightSentence,
  budgetSentence, unbakedNotice,
} from '../src/ui/copy'
import type { BenchmarkResult } from '../src/lib/benchmark'

const result: BenchmarkResult = {
  points: [
    { requested: 170, scored: 157, pyra: 0.414, uniform: 0.378, deltaPP: 3.614 },
    { requested: 572, scored: 526, pyra: 0.9276, uniform: 0.9693, deltaPP: -4.175 },
  ],
  atBudget: { requested: 572, scored: 526, pyra: 0.9276, uniform: 0.9693, deltaPP: -4.175 },
  bestMargin: { requested: 170, scored: 157, pyra: 0.414, uniform: 0.378, deltaPP: 3.614 },
  crossoverNodes: 270,
  strideKm: 0.36608429859016334,
  demandCount: 31045,
  detectKm: 2,
}

describe('coverageSentence', () => {
  const s = coverageSentence({
    coveredFraction: 0.950127412638781, strideKm: 0.36608429859016334,
    demandCount: 31045, detectKm: 2,
  })

  it('says the coverage is risk-weighted', () => {
    expect(s.toLowerCase()).toContain('risk-weighted')
  })

  it('reports the scoring stride in km', () => {
    expect(s).toContain('0.37 km')
  })

  it('reports the detection radius the number was scored at', () => {
    expect(s).toContain('2 km')
  })

  it('reports the number itself', () => {
    expect(s).toContain('95.0%')
  })
})

describe('benchmarkSentence', () => {
  const s = benchmarkSentence(result)

  it('states the fairness rule as a realised count, not an identical one', () => {
    expect(s).toContain('same realised count')
    expect(s).not.toContain('identical node count')
  })

  it('names the arm that leads at the budget on screen, even when it is the grid', () => {
    expect(s.toLowerCase()).toContain('uniform grid')
    expect(s).toContain('4.2')
  })

  it('names the crossover and the best margin', () => {
    expect(s).toContain('270')
    expect(s).toContain('3.6')
  })

  it('says the risk-driven arm leads when it does', () => {
    const flipped = benchmarkSentence({ ...result, atBudget: result.bestMargin })
    expect(flipped.toLowerCase()).toContain('risk-driven')
    expect(flipped).toContain('3.6')
  })

  it('does not claim a crossover when there is none', () => {
    const s2 = benchmarkSentence({ ...result, crossoverNodes: null })
    expect(s2).not.toContain('270')
    expect(s2.toLowerCase()).toContain('never')
  })
})

describe('seedSentence', () => {
  it('says nothing when the maximum is unique', () => {
    expect(seedSentence(1)).toBeNull()
  })

  it('warns, with the count, when the seed had to be tie-broken', () => {
    const s = seedSentence(112155)!
    expect(s).toContain('112,155')
    expect(s.toLowerCase()).toContain('tie')
  })
})

describe('weightSentence', () => {
  it('states that fire weather is a single regional scalar', () => {
    const s = weightSentence({ wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.61 })
    expect(s.toLowerCase()).toContain('single')
    expect(s).toContain('0.20')
  })
})

describe('budgetSentence', () => {
  it('states what saturation means', () => {
    const s = budgetSentence({ mode: 'saturation', maxNodes: null, nodeCount: 572 })
    expect(s.toLowerCase()).toContain('saturation')
    expect(s).toContain('572')
  })

  it('states that auto is the library default and what it produced', () => {
    const s = budgetSentence({ mode: 'auto', maxNodes: 18, nodeCount: 18 })
    expect(s).toContain('18')
    expect(s.toLowerCase()).toContain('default')
  })
})

describe('unbakedNotice', () => {
  it('names the region and says the data is not baked', () => {
    const s = unbakedNotice('Congo Basin')
    expect(s).toContain('Congo Basin')
    expect(s.toLowerCase()).toContain('not baked')
  })
})

describe('no copy overclaims the fire model', () => {
  it('never mentions fire simulation or validation', () => {
    const all = [
      coverageSentence({ coveredFraction: 0.9, strideKm: 0.37, demandCount: 10, detectKm: 2 }),
      benchmarkSentence(result),
      seedSentence(9)!,
      weightSentence({ wWeather: 0.45, wActivity: 0.35, wBase: 0.2, fwiNorm: 0.61 }),
      budgetSentence({ mode: 'saturation', maxNodes: null, nodeCount: 572 }),
      unbakedNotice('Congo Basin'),
    ].join(' ').toLowerCase()
    for (const banned of ['fire spread', 'fire model', 'detection time',
                          'validated', 'simulated fire']) {
      expect(all).not.toContain(banned)
    }
  })
})
```

**The mutation each test catches.** *Region list:* a hand-typed list that drifts from `plan.py:REGIONS`, or a picker that silently offers only the baked one and hides the other seven — the spec wants the eight visible, because the region picker is what resolves the "your nation" framing out loud. *`regionOptions` against the committed manifest:* a manifest that claims a region with no data. *Coverage sentence:* dropping the stride or the words "risk-weighted", which is a Global Constraint. *Benchmark sentence naming the leader:* the single most important honesty test in this plan — an implementation that always writes "the risk-driven placement covers more" fails the first case and passes the flipped one, so it cannot be faked. *No crossover:* claiming one on a region where the arms never cross. *Seed sentence:* suppressing the tie warning. *Banned words:* any copy that implies a fire model runs here.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && npm test -- regions copy
```

Expected: FAIL — cannot resolve `../src/lib/regions`.

- [ ] **Step 3: Implement the region list**

Create `web/src/lib/regions.ts`:

```ts
export interface RegionEntry {
  key: string
  label: string
  country: string
  regime: string
}

/**
 * The eight regions `plan.py:REGIONS` defines, in its order.
 *
 * All eight are shown even though one is baked. The picker is what makes the
 * "same code path runs anywhere on Earth" claim checkable — hiding the seven
 * would turn a global model into a single demo, and offering them without
 * saying they are unbaked would fail with a 404 in front of a judge.
 */
export const REGIONS: RegionEntry[] = [
  { key: 'los-padres', label: 'Los Padres', country: 'California, USA', regime: 'chaparral' },
  { key: 'amazon-rondonia', label: 'Rondônia', country: 'Brazil', regime: 'tropical moist' },
  { key: 'siberia-baikal', label: 'Baikal', country: 'Russia', regime: 'boreal larch' },
  { key: 'portugal-centro', label: 'Centro', country: 'Portugal', regime: 'Mediterranean pine' },
  { key: 'victoria-alpine', label: 'Victorian Alps', country: 'Australia', regime: 'eucalypt' },
  { key: 'congo-basin', label: 'Congo Basin', country: 'DR Congo', regime: 'tropical moist' },
  { key: 'sweden-norrland', label: 'Norrland', country: 'Sweden', regime: 'boreal spruce' },
  { key: 'greece-peloponnese', label: 'Peloponnese', country: 'Greece', regime: 'Mediterranean' },
]

/** Every region, flagged with whether the manifest says its data exists. */
export function regionOptions(baked: string[]): Array<RegionEntry & { baked: boolean }> {
  const set = new Set(baked)
  return REGIONS.map((r) => ({ ...r, baked: set.has(r.key) }))
}
```

- [ ] **Step 4: Implement the copy**

Create `web/src/ui/copy.ts`:

```ts
import type { BenchmarkResult } from '../lib/benchmark'
import type { BudgetMode } from '../lib/budget'

const pct1 = (f: number) => `${(100 * f).toFixed(1)}%`
const pp1 = (x: number) => Math.abs(x).toFixed(1)

/**
 * Every coverage number the site shows goes through here.
 *
 * A coverage figure without its weighting and its stride is not a result. The
 * same network scored at a 0.37 km stride and at a 4 km stride gives different
 * numbers, so the stride is part of the claim, not a footnote.
 */
export function coverageSentence(a: {
  coveredFraction: number; strideKm: number; demandCount: number; detectKm: number
}): string {
  return (
    `${pct1(a.coveredFraction)} risk-weighted coverage — the share of ` +
    `burnable-area demand weight within ${a.detectKm} km of a node, scored ` +
    `over ${a.demandCount.toLocaleString()} demand points on a ` +
    `${a.strideKm.toFixed(2)} km stride.`
  )
}

/**
 * The benchmark caption, including which arm is ahead at the budget on screen.
 *
 * It is allowed to say the uniform grid wins, and on Los Padres at saturation
 * it does. A caption that always announced a Pyra win would be a caption that
 * had stopped reading its own data.
 */
export function benchmarkSentence(r: BenchmarkResult): string {
  const at = r.atBudget
  const leader = at.deltaPP >= 0 ? 'the risk-driven placement' : 'the uniform grid'
  const head =
    `At ${at.scored.toLocaleString()} nodes — both arms capped to the same ` +
    `realised count, same region, same demand points — ${leader} leads by ` +
    `${pp1(at.deltaPP)} percentage points ` +
    `(${pct1(at.pyra)} risk-driven vs ${pct1(at.uniform)} uniform grid).`

  const best =
    ` The risk-driven placement's best margin is ${pp1(r.bestMargin.deltaPP)} pp ` +
    `at ${r.bestMargin.scored.toLocaleString()} nodes.`

  const cross = r.crossoverNodes == null
    ? ' The uniform grid never takes the lead across this budget range.'
    : ` The uniform grid takes the lead from about ${r.crossoverNodes.toLocaleString()} ` +
      'nodes: risk-driven siting pays when the budget is too small to blanket ' +
      'the ground, and a lattice packs discs better once it is not.'

  return head + best + cross
}

/**
 * Shown only when the current weights leave the highest-risk pixel contested.
 *
 * The blue-noise sampler starts at the highest-risk allowed pixel. When several
 * tie, this browser picks the lowest flat index; numpy's unstable argsort would
 * pick some other one. Both are valid seeds under the algorithm as written, but
 * the reader is told rather than left to assume bit-parity that is not there.
 */
export function seedSentence(tiesAtMax: number): string | null {
  if (tiesAtMax <= 1) return null
  return (
    `${tiesAtMax.toLocaleString()} pixels tie at the maximum risk, so the ` +
    'placement seed was tie-broken by position. The run is a valid run of the ' +
    'algorithm; it is not the same tie-break the Python reference would make.'
  )
}

/** Why the two weight sliders are not two independent controls. */
export function weightSentence(a: {
  wWeather: number; wActivity: number; wBase: number; fwiNorm: number
}): string {
  return (
    `Base weight ${a.wBase.toFixed(2)} is the remainder of the other two. ` +
    'Fire weather enters as a single regional value, not a map, so the ' +
    'weather weight shifts the whole field evenly and changes the placement ' +
    'only through its ratio to the activity weight. The spatial structure ' +
    'comes from fuel flammability, which multiplies, and from observed ' +
    'activity, which adds.'
  )
}

export function budgetSentence(a: {
  mode: BudgetMode; maxNodes: number | null; nodeCount: number
}): string {
  if (a.mode === 'saturation') {
    return (
      `Saturation: the node count is whatever reaching the coverage target ` +
      `requires — ${a.nodeCount.toLocaleString()} here.`
    )
  }
  if (a.mode === 'auto') {
    return (
      `Auto: the library's own default budget rule scales with risk-weighted ` +
      `burnable area and clamps, giving ${a.maxNodes} nodes here. That is far ` +
      'below what the coverage target needs, which is why the Lab does not ' +
      'start in this mode.'
    )
  }
  return `Fixed: ${a.maxNodes} nodes requested, ${a.nodeCount.toLocaleString()} placed.`
}

export function unbakedNotice(label: string): string {
  return (
    `${label} is not baked yet — only Los Padres has committed model inputs ` +
    'in this build. The siting model itself runs on any box on Earth; what ' +
    'is missing is the offline data bake, not the algorithm.'
  )
}
```

- [ ] **Step 5: Assemble the benchmark panel**

Create `web/src/ui/BenchmarkPanel.tsx`:

```tsx
import { PALETTE } from '../theme/palette'
import { useModelStore } from '../state/useModelStore'
import { CoverageBudgetChart } from './CoverageBudgetChart'
import { HeroFigure, KpiRow, StatTile } from './StatTile'
import { benchmarkSentence, coverageSentence, seedSentence } from './copy'

/**
 * Benchmark A, presented as data rather than prose.
 *
 * One hero figure (the head-to-head margin at the budget on screen), a KPI row
 * of the numbers that are single values rather than distributions, and one
 * comparison chart. `areaFraction` and the set-cover reduction were both
 * computed by the model from the first run of Plan 1 and shown to nobody;
 * they are stat tiles now.
 */
export function BenchmarkPanel() {
  const { result, benchmark } = useModelStore()
  if (!result || !benchmark || benchmark.points.length === 0) return null

  const at = benchmark.atBudget
  const seedNote = seedSentence(result.seedTiesAtMax)

  return (
    <section style={{
      position: 'absolute', right: 16, top: 16, width: 420, padding: 16,
      background: PALETTE.surface, color: PALETTE.ink,
      border: `1px solid ${PALETTE.surfaceRaised}`, borderRadius: 8,
      font: '13px/1.5 system-ui, sans-serif', zIndex: 10,
      maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
    }}>
      <HeroFigure
        label="Head to head, at the same realised node count"
        value={`${at.deltaPP >= 0 ? '+' : '−'}${Math.abs(at.deltaPP).toFixed(1)} pp`}
        note={benchmarkSentence(benchmark)}
      />

      <KpiRow>
        <StatTile label="Nodes" value={result.nodeCount.toLocaleString()}
          note={`from ${result.candidateCount.toLocaleString()} blue-noise candidates`} />
        <StatTile label="Set-cover saving" value={`${result.reductionPct.toFixed(0)}%`}
          note="hardware removed by the minimisation stage alone" />
        <StatTile label="Risk-weighted coverage"
          value={`${(100 * result.coveredFraction).toFixed(1)}%`}
          note={`${benchmark.strideKm.toFixed(2)} km stride`} />
        <StatTile label="Area covered"
          value={`${(100 * result.areaFraction).toFixed(1)}%`}
          note="same demand points, counted unweighted" />
      </KpiRow>

      <h3 style={{ margin: '16px 0 2px', fontSize: 12, fontWeight: 600,
                   color: PALETTE.chart.inkMuted, letterSpacing: 0.4 }}>
        Risk-weighted coverage against node budget
      </h3>
      <CoverageBudgetChart result={benchmark} />

      <p style={{ color: PALETTE.chart.inkMuted, fontSize: 11, marginTop: 10 }}>
        {coverageSentence({
          coveredFraction: result.coveredFraction,
          strideKm: benchmark.strideKm,
          demandCount: benchmark.demandCount,
          detectKm: benchmark.detectKm,
        })}
      </p>
      {seedNote && (
        <p style={{ color: PALETTE.chart.inkMuted, fontSize: 11 }}>{seedNote}</p>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Rebuild the control set**

In `web/src/ui/RunPanel.tsx`: replace the hardcoded `REGIONS` array with `regionOptions(availableRegions)`; on mount, call `loadManifest()` and `setAvailableRegions(m.baked)`; render unbaked options as `disabled` with a `— not baked` suffix and show `unbakedNotice(label)` when one is selected; and replace the two existing sliders with the full control set:

| Control | Param | Range / step | Note under it |
|---|---|---|---|
| Region | `regionName` | picker, unbaked disabled | `unbakedNotice` when unbaked |
| Fire-weather weight | `wWeather` | 0–1, step 0.01 | via `setWeights` |
| Observed-activity weight | `wActivity` | 0–1, step 0.01, max `1 − wWeather` | via `setWeights` |
| Base weight | derived | read-only readout of `result.wBase` | `weightSentence(...)` |
| Detection radius | `detectKm` | 0.5–5, step 0.1 | — |
| Coverage target | `target` | 0.5–0.99, step 0.01 | disabled unless `budgetMode === 'saturation'` |
| Budget mode | `budgetMode` | saturation / auto / fixed | `budgetSentence(...)` |
| Fixed nodes | `fixedNodes` | 1–2000, integer | shown only when `budgetMode === 'fixed'` |
| Spacing bounds | `spacingOverride` | two number inputs, empty = derived | shows the derived values from `result.budget` as placeholders |

Style every range input with `accentColor: PALETTE.meshTeal`; Plan 1's ledger recorded the sliders rendering in default browser blue, which is not in the palette at all. Keep the existing `runId` correlation and `Provenance` block untouched, and store `benchmark` from the `done` message alongside `result`.

In `web/src/App.tsx`, mount `<BenchmarkPanel />` beside `<MapRoot />` and `<RunPanel />`.

- [ ] **Step 7: Run the tests**

```bash
cd web && npm test && npm run build
```

Expected: 240 passing, build succeeds.

- [ ] **Step 8: Look at it in a browser**

```bash
cd web && npm run dev
```

Verify, in order:
1. The risk raster appears only after the first **Run** — it is now a per-run product, not a fetched file.
2. Dragging **Observed-activity weight** to 0 and re-running visibly changes the raster and the node positions, and the seed-tie notice appears.
3. Dragging **Fire-weather weight** alone changes the numbers far less than the activity weight does — that is the scalar-FWI property, and `weightSentence` says so on screen.
4. Switching **Budget mode** to `auto` produces 18 nodes and a coverage figure around 5%, with `budgetSentence` explaining it.
5. The comparison chart shows the teal line above the grey one at the left and below it at the right, with the crossover annotated.
6. Selecting **Congo Basin** disables the Run button and shows the not-baked notice — no 404, no error state.
7. Nothing on screen is orange except the PYRA wordmark. Range sliders are teal, not browser-blue.

- [ ] **Step 9: Commit**

```bash
cd "C:/Pyra NTE"
git add web/src/lib/regions.ts web/src/ui/copy.ts web/src/ui/BenchmarkPanel.tsx \
        web/src/ui/RunPanel.tsx web/src/App.tsx \
        web/tests/regions.test.ts web/tests/copy.test.ts
git commit -m "feat(web): the full control set, honest region degradation, Benchmark A on screen

All eight regions are listed with the seven unbaked ones disabled and
explained. Every coverage sentence states that it is risk-weighted and
reports its stride, and the benchmark caption names whichever arm is
actually ahead."
```

---

## Self-Review

**1. Spec coverage.** Walking §5 of the design spec, control by control:

| Spec requirement | Task |
|---|---|
| Region picker over the eight `REGIONS` | 11 |
| `w_weather` 0–1, default 0.45 | 1, 3, 5, 11 |
| `w_activity` 0–1, default 0.35 | 1, 3, 5, 11 |
| `w_base` shown, not directly editable | 3 (`wBaseFor`), 11 (readout) |
| `detect_km` 0.5–5, default 2.0 | 11 (already wired in Plan 1) |
| `r_min_km`/`r_max_km` derived, overridable | 6 (`resolveBudget`), 11 |
| `target` 0.5–0.99, default 0.95 | 11 |
| Budget mode auto / saturation / fixed, defaulting to saturation | 6, 8, 11 |
| "Flammability multiplies rather than adds — say why" | 3 (docstring), 11 (`weightSentence`) |
| Fairness stated on screen | 7, 11 (`benchmarkSentence`) |
| Benchmark A, equal node count, both arms `capToCommonCount` | 7 |
| Benchmark A valid in all eight regions | 7 (no region-specific code), 11 (data availability is the only limit, and it is stated) |
| Stat tiles for the headline numbers | 10, 11 |
| Comparison chart for the two arms | 10 |
| `areaFraction` surfaced | 11 (KPI row) |
| Set-cover reduction as its own stat tile | 11 |
| Coverage numbers state risk-weighted + stride | 11 (`coverageSentence`), enforced by test |
| Region handling degrades honestly | 1 (manifest), 11 (picker) |
| Never a dual axis; legend for ≥2 series | 10, enforced by `chartModel.test.ts` |
| Palette validated by the script before shipping | 9 |

**Two spec items are deliberately not met as written, and both are recorded above rather than quietly dropped.**

- §5's Benchmark A is phrased as a single "X% versus Y%" with the risk-driven arm winning. Measured, it loses at the default saturation budget on the only baked region. The plan ships the whole curve and names the crossover instead. This needs the user's sign-off on the framing, and the spec text should be amended to match.
- §12's open item "fix `auto_budget` clamp (hi=40 makes the target unreachable)" describes a mechanism that does not apply here: `auto_budget` returns 18 on Los Padres and never reaches the clamp. Task 6 ports the rule faithfully and Task 11 labels what it actually produces; the upstream fix stays out of scope, because no repo-root Python may change.

Explicitly out of scope and left to later plans: Benchmark B (Plan 3), the Rail (§4), the rod and the fusion truth table (§7), the camper app (§8), `/assumptions` (§6), service-worker tile caching and the degradation matrix (§9), and visual regression (§10 item 5).

**2. Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". Three places deliberately require the implementer to *measure* rather than transcribe, and each says what to measure and what to do with it: Task 1 Step 2 and Task 2 Step 2 (the re-bake's effect on the pinned figures — the numbers cannot be known before the bake runs, and inventing them is precisely the failure this plan is trying to avoid), Task 9 Step 2 (the validator's verbatim output), and Task 11 Step 8 (browser verification, which no unit test replaces). Every code step contains complete, runnable code.

**3. Type consistency.** `Field` and `BBox` (`types.ts`) are unchanged from Plan 1; `ClassField` is added in Task 3 and used identically in `risk.ts`, `loadRegion.ts` and `seed.ts`. `RegionData` loses `risk` in Task 5 and gains `classes`/`activity`; every consumer (`pipeline.ts`, `place.worker.ts`, `MapRoot.tsx`, the test helper) is updated in that same task. `PlaceParams` gains `wWeather`, `wActivity`, `budgetMode`, `fixedNodes`, `spacingOverride` and loses `rMinKm`/`rMaxKm`/`maxNodes` across Tasks 5 and 6, and `DEFAULT_PARAMS` is rewritten to match in Task 8. `PlaceResult` gains `risk`, `seedFlatIndex`, `seedTiesAtMax`, `meanRiskBurnable`, `wBase`, `burnKm2` and `budget`. `BenchmarkPoint`/`BenchmarkResult` are defined once in Task 7 and consumed unchanged by Tasks 8, 10 and 11. `Weights` is defined in `risk.ts` and used by `useModelStore.setWeights`. `BudgetMode` is defined in `budget.ts` and imported by `pipeline.ts`, `useModelStore.ts` and `copy.ts`. Point arrays remain flat `Float64Array` of `[x, y]` pairs everywhere.

**4. Test quality.** Every task states, per test, the mutation a wrong implementation would have to survive. Three assertions are load-bearing beyond their own task and should not be weakened under time pressure: the bit-for-bit recombination against the committed `risk.bin` (Task 3), the parity digest over the whole chosen sequence (Task 2), and the benchmark's "the arms would not have matched without capping" case (Task 7) — which exists specifically because Plan 1 shipped that same guarantee twice as a tautology.

**5. One risk worth stating plainly.** Task 1's re-bake refetches live FIRMS and Open-Meteo data. If those feeds have moved since 2026-07-31, `risk.bin` changes, and 927 / 572 / 0.9501 / 38% — figures that already appear in the design spec, in Plan 1, and in the ledger — move with them. Task 2 exists to catch that in one place and re-pin it. What must **not** happen is the reverse: adjusting a test's tolerance so an old number survives a new raster. If the numbers move, the documents move.
