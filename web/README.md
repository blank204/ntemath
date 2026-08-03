# LightningWatch — web

The browser side of LightningWatch: an interactive map that runs the wildfire-sensor
siting model **in the browser**, on real baked data, and reproduces the Python
reference (`place.py`) bit for bit.

Pick a region, set a detection radius and a coverage target, hit **Run
placement**. A Web Worker generates a variable-radius blue-noise candidate
pool, then prunes it with a lazy-greedy (CELF) set cover until the coverage
target is met. On the committed Los Padres data at the shipped defaults that
is **927 candidates → 572 nodes at 95.0 % risk-weighted coverage** — the same
numbers `place.py` produces from the same rasters and the same reference RNG.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # tsc -b && vite build
npm run test           # vitest run
npm run lint           # oxlint
```

The satellite basemap needs a MapTiler key. Put it in `web/.env.local`
(gitignored, never committed):

```
VITE_MAPTILER_KEY=your-key-here
```

Without a key the app still runs — the map falls back to a flat canvas-colour
background and every model number is unchanged.

## Re-baking region data

`public/data/<region>/` holds five files per region, all row-major with **row 0
at the south edge**: `classes.bin` (uint8 WorldCover class codes),
`activity.bin` (float32 FIRMS activity), `meta.json` (geometry, provenance, the
model's constants and the seed index the bake resolved), plus `risk.bin`
(float32) and `mask.bin` (uint8). The app fetches only the first three and
recombines the risk field and burnable mask itself, so the drive weights can
move; `risk.bin` and `mask.bin` stay committed as the goldens the Node-side
tests check that recombination against. They are produced from the repo-root
Python model:

```bash
cd ..                                                   # repo root
python -m tools.bake.bake_region --region los-padres    # full re-bake
python -m tools.bake.bake_region --all
python -m tools.bake.bake_region --region los-padres --notes-only
```

A full re-bake refetches ESA WorldCover, NASA FIRMS and Open-Meteo, and
because the risk field is renormalised to its own peak it rewrites **every
pixel** — so it invalidates the parity figures pinned in the test suite. Use
`--notes-only` when you only need to correct provenance text.

Golden fixtures for the TypeScript/Python parity tests come from a separate
generator:

```bash
python -m tools.bake.export_fixtures     # writes web/tests/fixtures/*.json
```

## Where things live

| Path | What it is |
| --- | --- |
| `src/lib/` | The model port: RNG, pairwise summation, projection, field sampling, Poisson-disk, spatial index, set cover, pipeline |
| `src/map/` | The single MapLibre instance and the deck.gl layers |
| `src/ui/` | The run panel, readouts and provenance disclosure |
| `src/theme/palette.ts` | The only source of colour. Never hardcode a hex |
| `src/workers/` | Off-thread placement runner |
| `tests/` | Vitest suite, including `tests/fixtures/*.json` golden data from Python |
| `public/data/` | Baked region rasters and metadata |

## Tests

`npm run test` runs everything. The load-bearing ones:

- `tests/pipeline.test.ts` — end-to-end parity against `place.py` on the real
  committed Los Padres rasters, at the default detection radius and at a
  non-default one.
- `tests/poisson.test.ts`, `tests/cover.test.ts` — golden fixtures generated
  by `tools/bake/export_fixtures.py`, asserted exactly.
- `tests/layers.test.ts` — the raster vertical flip and the SW-corner to
  box-centre coordinate conversion, the last hop before anything is drawn.
- `tests/sum.test.ts`, `tests/refrng.test.ts`, `tests/frame.test.ts` — the
  numeric primitives the parity rests on.

## Colour rule

Green and black are surfaces. Saturated orange is reserved for fire, heat and
alert states. Nodes and LightningWatch data series are mesh teal; comparison baselines
are grey. Import from `src/theme/palette.ts`.
