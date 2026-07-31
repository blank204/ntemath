# Handoff — 2026-07-31, 23:20

For the next agent. Read this first, then
`docs/superpowers/specs/2026-07-31-pyra-lightning-pivot.md`.

---

## 1. Where things stand

Branch `pyra-site`. **393 tests pass** (`cd web && npm test`), plus **33 Python
tests** (`python -m unittest tools.bake.test_lightning tools.bake.test_regions`).
`npm run build` and `npx tsc -b` are clean. Nothing is half-finished in the
working tree.

The lightning pivot is no longer a plan. It is baked, loaded, benchmarked and
on screen.

**The blocker is gone.** The NASA Earthdata download went through: LIS/OTD
HRFC v2.3.2015, 14.4 MB, cached in `outputs/lightning/` (gitignored, like every
other source layer). Re-fetch it from
`https://data.ghrc.earthdata.nasa.gov/ghrcw-protected/lohrfc__2.3.2015/LISOTD_HRFC_V2.3.2015.nc`
with an Earthdata Login if the cache is ever lost — `tools/bake/lightning.py`
raises with that URL in the message.

**The spec was wrong about the resolution and the data said so.** LIS/OTD HRFC
is **0.5°**, about 55 km — not the 0.1° the spec's data table claimed. The 0.1°
product is VHRFC, which is LIS-only; TRMM flew a 35° inclination, so it stops
near ±38° of latitude and does not exist for any boreal region. At James Bay
even the combined product's LIS half is exactly zero: this is OTD alone,
1995–2000. Forty native cells for a 314 × 244 km box. The spec is corrected and
the limit is in the source notes, the page, and a test.

**The gate passed, with statistics.** Measured on observed flash counts before
anything was baked: 218 flashes over 40 cells (viewtime uniform to 3.1%),
χ² = 118.1 on 39 dof against a uniform rate (p = 6.8 × 10⁻¹⁰), inland half
143 flashes to the coastal half's 75 — **1.91×, p = 4.8 × 10⁻⁶** — and Spearman
ρ = 0.469 with longitude. Structure, along the axis the region was chosen for.
It is `meta.lightningGate`, it is quoted on the page, and it is pinned by a test
that fails if the box, the variable or the statistic moves.

**Measured, at the shipped defaults, on James Bay (77,037 km², 36% of it water):**

| | one tower in range | two towers in range |
|---|---|---|
| risk-driven, 111 towers | 77.3% | 10.9% |
| uniform grid, same count | 78.8% | 7.0% |
| margin at the budget | −1.4 pp | **+3.9 pp** |
| best margin | +5.56 pp at 37 | +3.93 pp at 111, still climbing |
| grid takes the lead at | 88 towers | never, in this range |

Those two-tower figures are at the capped count of 64 — the most the grid can
realise when asked for 111. At the full 111 towers the shipped placement
triangulates **43.7%**, and the same towers re-chosen for the two-tower rule
reach **54.6%** — **+10.8 pp, paid for with −7.1 pp of single coverage**
(95.1% → 88.1%). Both columns are on screen; it is a trade, not a win.

Saturation to the 95% target takes **111 towers** and reaches 95.1%
risk-weighted coverage. FWI p90 here is 12.3 against Los Padres' 48.8 — this is
a wet boreal coast, and with `fwiNorm` at 0.15 the lightning layer accounts for
most of what varies in the drive term.

---

## 2. What was built today (after the pivot commit)

- `tools/bake/lightning.py` — loader, native-cell selection, χ² gate,
  `gradient_report`, CLI (`python -m tools.bake.lightning --region james-bay`).
- `tools/bake/regions.py` — bake-side region table. `plan.REGIONS` stays
  read-only; regions are added beside it, and a test asserts the repo table is
  carried through by identity.
- `tools/bake/test_lightning.py`, `test_regions.py` — 33 stdlib-unittest tests,
  including the `sample_density` checks that were run interactively when it was
  written and never committed.
- `bake_region.py` — the lightning path, `lightning.bin`, `layer`/`layerFile`
  in meta, gate-aware source notes. Los Padres keeps `activity.bin`
  deliberately: it is the bit-for-bit Python parity anchor.
- Web: `loadRegion` reads the layer off the region; `regions.ts` states what
  starts the fires in each of the nine regions; defaults moved to james-bay and
  15 km; copy pass to towers/strikes; `gateSentence`, `ignitionCaveat`,
  `triangulationSentence`.
- **Flash to bang** (`src/lib/flashToBang.ts`, `src/ui/FlashToBang.tsx`) — real
  time, real physics, temperature-dependent speed of sound, the silence left in.
- **Benchmark C** — `coverageOfK`, `runBenchmark({minTowers})`, both curves from
  one worker run, on screen in the benchmark panel.
- **`greedyMinimiseK`** — selection that optimises k-coverage directly. "At
  least k" is **not submodular** for k ≥ 2 (the first tower to reach a point
  buys nothing, the second buys all of it), so CELF's lazy bound does not
  apply and this greedy recomputes gains each round. The objective is progress
  towards k, with completion weight as a tie-break; demand that no combination
  of candidates could ever see twice is excluded rather than chased.
- **The Rail** (`src/rail/`) — seven beats as DATA so the §2 science
  constraints run over them, a stage that is a pure function of (beat,
  progress), and the Lab as a section below rather than the whole page.
  Skip-to-Lab is the first link in the header.
- The spec's §2 science constraints are now **tests over every string the site
  can produce** (`web/tests/copy.test.ts`, `web/tests/beats.test.ts`).

---

## 3. What is left, in order

1. **The exploding 3D tower** — camera head, microphone booms, solar, compute,
   backhaul. **Aarav answered: no model exists, build from primitives — and he
   expects something exceptional, and is happy for an agent to go online and
   look for a 3D model that fits.** Beat four of the Rail currently holds an
   exploded SVG schematic in its place, which is honest but is not that.
2. **Localisation error in metres** (GDOP ≈ σ/sin θ). **Aarav chose the
   assumption: 6%, the defensible one** — the systematic error from assuming
   warm-air sound speed, whose derivation can be shown. NOT the widely-quoted
   ~10%, which `docs/lightning-research.md` records as unverified as a formal
   measurement. It goes on screen labelled an assumption, and into
   `/assumptions`.
3. **Presenter mode**, then **`/assumptions`**. (Skip-to-Lab is built — it is
   the first link in the Rail's header.)
4. Optional: re-bake Los Padres onto the lightning layer, or drop it from the
   picker. It is currently the only region whose risk means "where fire has
   been", which is defensible — it is the parity anchor — but it is also the
   one place the site shows two different meanings under one word.

---

## 4. Traps this codebase has already paid for

- **Row 0 is the SOUTH edge** in every raster. Getting it backwards mirrors the
  field, looks entirely plausible on a map, and is completely wrong.
- **Two coordinate frames exist.** `place.LocalFrame` is equirectangular km
  about the box centre; anything projected is not the same frame.
- **Never a hex colour outside `web/src/theme/palette.ts`.** Absolute.
- **Scroll behaviour is only ever found by scrolling.** Two Rail bugs shipped
  past a green suite: the active beat was anchored on the section's top edge
  (the text is centred, so the stage sat a beat behind), and the scroll handler
  used a "skip if a frame is pending" flag that wedges permanently when a frame
  is dropped — which happens under a devtools screenshot. Cancel and
  reschedule; never gate on a pending flag.
- **Every test must be able to fail.** Today the flash-to-bang clock printed
  `7.49 s × 340.4 m/s = 2.00 km` — false arithmetic, on screen, past a green
  suite. It was caught by looking at it in a browser. Look at things.
- **Los Padres figures are measurements at detectKm 2**, not defaults. They run
  through `DEFAULT_TEST_PARAMS`, which pins that radius and spreads every other
  shipped default so changing one still breaks them loudly.
- **Use `git commit -F <file>`.** PowerShell here-strings mangle apostrophes.
- **Verify repo-root Python signatures with `inspect.signature` first.**
- **Repo-root Python is read-only.** Additive work only, in `tools/` or `web/`.
- **Subagents stall on long-running jobs.** Split "write the code" from "run the
  job", and run heavy compute in the controller session.

---

## 5. Context Aarav will want on return

- **Phase 1 closes 3 August, 11:59 PM UTC.** The graded artifacts are a
  ≤2-minute video and a 2480×3508 portrait ad. **The website is not a scored
  deliverable** — it earns points as proof of action, as the demo vehicle, and
  as the ad's call-to-action.
- **The video has three measured beats now, none of which need narration to be
  true**: the flash-to-bang interactive (real physics, real silence), the
  gradient gate (218 flashes, 1.91× inland, p = 4.8 × 10⁻⁶), and the
  two-tower benchmark where the margin flips sign in the optimiser's favour.
- Framing stays **"Qatar-built, world-deployed"**.
- Answered today: **no 3D tower model exists — build from primitives.**
