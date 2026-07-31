# Bake pipeline

Turns the real geospatial pipeline (`forest.py`, `hazard.py`, `plan.py` at the
repo root) into static files the website can fetch. Heavy dependencies live
here and nowhere else — the browser never needs GDAL, scipy, or network
access to a data provider.

## Requirements

    pip install numpy scipy rasterio requests

`rasterio` (GDAL) is required for `forest.read_landcover`'s `/vsicurl` reads
against ESA WorldCover. `bake_region.py` also reaches NASA FIRMS and
Open-Meteo over the network — expect the bake to take minutes, not seconds,
and to fail loudly (not silently) if one of those feeds is unreachable.

## Bake a region

    python -m tools.bake.bake_region --region los-padres
    python -m tools.bake.bake_region --all

Writes `web/public/data/<region>/`:

| File | Format |
|---|---|
| `risk.bin` | `nx*ny` little-endian float32, **row 0 = south edge** |
| `mask.bin` | `nx*ny` uint8, 1 = burnable |
| `meta.json` | box, dimensions, extents, class mix, resolved placement seed, and provenance for what is (and is not) modelled |

`meta.json`'s `seedFlatIndex` is not cosmetic — see "Why an explicit seed"
below. Without it, `web/src/lib/poisson.ts` falls back to its own tie-break
scan, which is not guaranteed to agree with `place.py`'s on real data.

## Regenerate the golden fixtures

    python -m tools.bake.export_fixtures

Writes `web/tests/fixtures/*.json`. These pin the TypeScript port to the
Python. **If a fixture changes, the port's behaviour changed** — investigate
before committing, never just re-baseline.

## How this imports the repo root

The repo root (this checkout: `Pyra NTE`, not `nodenet`) is itself a Python
package, and modules like `place.py` and `plan.py` use relative imports
(`from .geo import ...`, `from . import forest, hazard`) that only resolve
when loaded as submodules of that package. Because this checkout's directory
name contains a space, `import ntemath`-style imports can't work, and pushing
the repo root's parent onto `sys.path` would shadow the stdlib for the rest
of the process.

`tools/bake/_repo_import.py` solves this once, for every script under
`tools/bake/`: it registers the repo root under a private, fixed name
directly in `sys.modules` via `importlib.util.spec_from_file_location`, with
`submodule_search_locations` pointing at the repo root. That gives any
repo-root module a real package context to resolve its relative imports
against, without ever touching `sys.path` and without modifying a single
repo-root file. Both `export_fixtures.py` and `bake_region.py` call
`repo_modules(...)` to get at `geo`, `place`, `forest`, `hazard`, and `plan`.

## Why an explicit seed

`place.variable_poisson_disk` seeds its blue-noise sampler by scanning
`np.argsort(risk, axis=None)[::-1]` for the highest-risk allowed pixel.
`numpy`'s `argsort` is unstable quicksort, and on real data ties at the
maximum are the *normal* case, not an edge case: whenever a box has no FIRMS
detections above confidence 40 in the last 7 days (routine — the open feed is
short), `hazard.activity_field` is all zeros, `risk_field`'s `drive` term
collapses to a scalar, and every burnable tree/shrub pixel ties at risk
`1.0`. Which tied pixel `argsort` returns is then an implementation detail of
numpy's sort, not something a second (TypeScript) sort implementation can be
expected to reproduce.

`bake_region.py` resolves the actual flat index `place.py`'s seed loop would
land on — over the **float32-snapped** risk array and the burnable mask, mask
check included — using the same `_resolve_seed_flat_index` helper
`export_fixtures.py` uses for its Poisson-disk fixtures, and ships it in
`meta.json` as `seedFlatIndex`. `web/src/lib/poisson.ts` accepts it and skips
its own argsort-order scan entirely when present.

## Why float32 first

`risk.bin` is float32 on disk, and `web/src/lib/types.ts` stores a loaded
`Field`'s data as a `Float32Array` — the browser's placement algorithm runs
on those exact bits. `bake_region.py` snaps `risk_field()`'s float64 output
to float32 *before* computing anything else from it (the seed index, any
summary statistic), rather than computing on float64 and only narrowing on
write. Doing it the other way round leaves every value roughly `1.2e-7`
relative off from what the browser reads back, and `place.py`'s radius and
candidate-position math compounds that drift across the active-list chain —
enough to make the browser's placement diverge from a real Python run over
the same region.

## Why a reference RNG

`place.variable_poisson_disk` takes its generator as an argument and uses only
`.random(k)` and `.integers(high)`. `refrng.RefRNG` (xoshiro256**) is passed in
its place so the browser reproduces the Python stream exactly, with no changes
to `place.py` and no need to port numpy's PCG64 or SeedSequence.
