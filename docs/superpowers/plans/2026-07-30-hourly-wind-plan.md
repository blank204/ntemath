# Hourly wind + fire/year selection — implementation plan

**Date:** 2026-07-30
**Status:** approved design, executing

## Why

Two root causes were confirmed by measurement before any code was written
(see "Evidence" below). This plan fixes the first and documents the second.

**Root cause A — wrong sampling window (in scope).**
`realdata.fetch_wind` reads a hardcoded day, `2024-07-08`, in UTC, and
collapses 24 hours into one scalar. The Lake Fire alarmed on `2024-07-05`
and made its run under a NE offshore flow. By 07-08 the flow had reversed
to the W onshore sea breeze. The resulting vector points **146° away** from
where the fire actually went, at a fifth of the speed.

**Root cause B — residence-time dilution (out of scope, document only).**
A burning cell gets `tau` chances (median 31 steps) to ignite each
neighbour, so a 19x per-step directional preference integrates to 3.6x.
The scar cannot elongate (aspect 1.0 vs an observed 2.79) regardless of
what wind is supplied. Fixing it means changing the transition rule and
recalibrating `p0`/`c2`; that is separate work.

## Evidence

Measured on the real mesh, d_min = 90 m, existing scoring protocol.
Observed scar push = 265° (W), aspect 2.79.

| case | direction | speed | IoU | push err | aspect |
|---|---|---|---|---|---|
| baseline (Jul-8 mean) | 128° | 2.1 | 0.278 | 146° | 1.05 |
| alarm window, gusts | 215° | 11.5 | 0.394 | 51° | 1.01 |
| alarm window, sustained | 215° | 4.0 | **0.406** | **41°** | 1.09 |

Gusts measured *worse* than sustained. The gain is entirely from
direction; speed is near-irrelevant under area-matched scoring because
root cause B has already saturated the head. **Default = sustained.**

Wiring probe (no simulation): `frac_clamped = 0.0%` at every wind speed,
so clipping at p=1 is not involved; edge slopes are live (median 8.9°,
max 48°), so the DEM reaches the edges.

## Constraints discovered

- Open-Meteo archive serves `wind_gusts_10m` and accepts
  `timezone=America/Los_Angeles`, returning local timestamps plus
  `utc_offset_seconds`.
- FRAP `ALARM_DATE`/`CONT_DATE` are epoch **milliseconds**, date-only
  (stored at midnight UTC). No time of day is available.
- LANDFIRE CONUS FBFM40 vintages are **2016, 2022, 2023, 2024, 2025**.
  There is no LF2020 FBFM40. Fires from 2017–2022 fall back to LF2016.
- `pytest` is not installed in `.venv`.

## Tasks

### 1. `weather.py` (new)
- `fetch_hourly_wind(lonlat, start_date, end_date, tz)` — one Open-Meteo
  archive request, cached per (lat, lon, start, end).
- `WindSeries` dataclass: `times`, `speed_ms`, `gust_ms`, `from_deg`,
  `utc_offset_s`, `source`, `start_index`.
  - `.at(minutes) -> Wind` — hour index `start_index + minutes // 60`,
    clamped at both ends.
  - `.source` in `{sustained, gust, midflame}`; midflame = 0.4 x sustained.
  - `.mean_wind` — speed-weighted vector mean, for the constant-wind
    comparison arm.
  - `.summary()` — one line for logs and RESULTS.md.
- Bearing handling goes through `Wind.from_meteorological`; never average
  bearings arithmetically (0/360 wrap).
- **Verify:** `.at()` boundaries and clamping; constant series round-trips.

### 2. `catalog.py` (new)
- `FireRecord`: name, year, acres, alarm, cont, props.
- `search_fires(year, name=None, min_acres=0)` — FRAP query with
  `returnGeometry=false` so listing a year is cheap; geometry is fetched
  only for the chosen fire.
- `choose_fire(year, name, interactive)` — numbered table, acres + dates.
  Non-tty falls back to the largest match rather than blocking.
- `fbfm_service_for_year(year)` — newest CONUS vintage strictly before the
  fire year, from `[2016, 2022, 2023, 2024, 2025]`. Warns loudly when the
  gap exceeds 2 years; warns harder below 2017.
- **Verify:** vintage rule (2024->2023, 2023->2022, 2020->2016, 2016->2016
  + warning); epoch-ms date parsing.

### 3. `fire.py` (edit)
- Split `edge_probabilities` into a reusable static part and a wind part,
  **preserving left-to-right multiplication order** so results stay
  bit-identical: `pre = (p0 * k_veg) * k_den`, then
  `p = clip(((pre * p_wind) * p_slope) * g_geom)`.
- `simulate()` accepts `Wind | WindSeries`. With a series, recompute only
  `p_wind` at each hour boundary; `p_edge` supplied explicitly alongside a
  series raises `ValueError`.
- RNG draws are unaffected by recomputation, so seeded runs stay aligned.
- Record the series in `res.meta` and keep `wind_speed`/`wind_dir` populated
  (mean) for the existing plotting code.
- **Verify:** constant-valued `WindSeries` reproduces the constant-`Wind`
  result exactly, same seed.

### 4. `realdata.py` (edit)
- `load_lake_fire()` -> `load_fire(record, ...)`; keep a thin
  `load_lake_fire()` alias so `diag_m7.py` keeps working.
- Wind comes from `weather.WindSeries` anchored to `ALARM_DATE` at local
  `--start-hour` (default 12; FRAP carries no time of day, and anchoring at
  local midnight would feed the model the calm overnight wind).
- Fuel service from `catalog.fbfm_service_for_year`.
- Ignition: `--ignition-lonlat` if given; else a known-origins table
  (LAKE/2024 -> Zaca Lake, preserving the existing result); else perimeter
  centroid **with a loud warning** that push/shape metrics lose meaning.
- Parameterize the RESULTS section by fire name/year. **Delete the
  hardcoded sensitivity table** (0.267/0.280/0.285) — it is disproven.
  `--sensitivity` regenerates it live.
- Correct the "wind is not the limiting factor" claim; add root cause B as
  a documented known limitation.

### 5. `run.py` (edit)
- `--fire`, `--year`, `--wind-source`, `--start-hour`, `--ignition-lonlat`,
  `--sensitivity`. No `--fire`/`--year` in `--mode real` -> interactive
  picker.

### 6. `tests/` (new)
- Install pytest into `.venv`.
- Pure functions only, no network: `WindSeries.at` boundaries/clamping,
  source selection, `from_meteorological` convention, vector-mean wrap,
  epoch-ms parsing, vintage rule, Open-Meteo parse against a cached
  fixture, and the bit-exact `edge_probabilities` regression.

### 7. Verify end to end
- Full test suite green.
- `--mode real --fire LAKE --year 2024` reproduces IoU in the ~0.40 band,
  not the old 0.278.
- Picker works for a second, unrelated fire/year.

## Out of scope

Calibration constants (`p0`, `c1`, `c2`, `a_slope`) are untouched. Faster,
better-aimed wind will move IoU; re-tuning constants in the same change
would make the improvement unattributable.

## Reversibility

No git repo in this project, so originals of every edited file are copied
to the session scratchpad before modification.
