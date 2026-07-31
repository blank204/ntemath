# Pyra — Lightning Pivot: design spec

Supersedes the detection-focused framing in `2026-07-31-pyra-website-design.md`.
That document's brand rules, architecture, honesty layer and Lab design stand
unchanged; what changes is **what the system senses and what the risk field
means**.

---

## 1. What the product is now

An AI watchtower that identifies lightning strikes likely to start fires, and
scores them against terrain and fuel **before** ignition — rather than
detecting smoke after it.

Three functions, in order:

1. **Detection and triangulation.** Cameras see the flash; a three-axis
   microphone array gives bearing from time-difference-of-arrival, and
   flash-to-bang gives range (`distance ≈ 343 m/s × Δt`). Range plus bearing is
   a single-station fix.
2. **Ignition-risk verification.** Acoustic analysis of the thunder signature
   estimates whether the stroke carried **long continuing current** — the
   thing that actually sets fuel alight.
3. **Risk analysis and alert.** The strike coordinate is scored against fuel
   type, dryness and terrain, and emergency authorities receive a ranked
   watchlist of ground to check.

**NTE category: Prevent.** Not Detect. The team's own research predicted Detect
would be the most duplicated category across 190+ teams, and that prediction
was confirmed by a collision with another team's submission. Prevent is what
the guide itself calls the most cost-effective phase, and the least obvious.

**Framing: Qatar-built, world-deployed.** Carried forward verbatim from the
previous spec, and stronger here. Qatar has no wildfire problem; it has 50 °C
summers, dust, salt air and an engineering base. Hardware that survives a
Qatari August survives anywhere. Qatar is the exporter of the solution, not the
victim of the problem, and the region picker is what resolves the "your nation"
framing out loud instead of hoping nobody notices.

---

## 2. What the science permits us to say

Established by research on 2026-07-31; sources in `docs/lightning-research.md`
(to be written by the first task that needs them). These are **binding copy
constraints**, in the same class as the existing honesty rules.

**We may claim:**

- Ignition probability per cloud-to-ground strike is real and quantified —
  roughly 1 fire per 105 flashes in Montane Cordillera to 1 per 836 in Boreal
  Plains, i.e. an order of magnitude of regional variation.
- The dominant predictor is **fuel and duff moisture**, not fuel type.
- **Dry lightning is over-represented in ignitions by about 2×** — it is ~20 %
  of strikes but ~40 % of fire counts (Peterson et al. 2010). *An earlier draft
  of this spec said "30–50 % more often per strike"; that figure is not in the
  source and must not be used.*
- **Holdover is real** — the interval from strike to detectable fire spans
  minutes to weeks, gamma-distributed across 152,375 recorded lightning fires.
  **That dataset is global, across 13 countries — not Canadian.** Do not
  attribute it to the demo region.
- Acoustic bearing and flash-to-bang ranging are real physics, useful as a
  **local confirmation layer** out to roughly 15–20 km.

**We may not claim:**

- That cloud-to-ground versus cloud-to-cloud is the discriminator. **It is
  continuing-current duration** — the >40 ms threshold is well attested; a
  return stroke lasts microseconds and cannot ignite fuel however large its
  peak current.
- **Do not quote a current magnitude for continuing current.** An earlier
  draft said "100–200 A". No primary source was found for it and secondary
  paraphrases disagree (200–800 A, or simply "tens to hundreds of amperes").
  Closing this needs Fuquay (1972) or Rakov & Uman (2003) read directly.
- **Do not claim positive strokes are the igniters.** An earlier draft said
  ~80 % of positive versus ~10 % of negative strokes carry long continuing
  current. Unverified: the best-supported figure is ~20–50 % for negative
  (Schultz et al. 2019), with positive only qualitatively higher. And it cuts
  the other way in practice — in the largest dataset matching strokes to real
  ignitions, **90 % of fire-starting strokes were negative**, because negative
  strokes so vastly outnumber positive ones. Polarity is a weak, unquantified
  correlate, not an 8:1 proxy. The mechanism is continuing current; polarity is
  not a usable stand-in for it.
- A fixed "hours before smoke" lead time. The distribution is too wide and too
  skewed. Report the distribution.
- Novelty of the ignition science. Wotton & Martell's model has been
  operational in Ontario and Saskatchewan for two decades, and the US Forest
  Service publishes Potential Lightning Ignition maps. We claim the
  deployment, not the discovery.
- That acoustics beats electromagnetic lightning networks. NLDN and GLD360 are
  sub-kilometre and range-unlimited; audible thunder tops out near 20 km with
  ~10 % distance error, and terrain and temperature gradients create shadow
  zones.

**What is genuinely ours.** No operational system couples live strike data,
continuing-current estimation and fuel moisture into a first-responder triage
product, and none does local acoustic strike confirmation for wildfire. And
nobody publishes **where to build the towers, optimally, with proof it beats
the obvious layout.** That last one is the site's centrepiece and is already
built.

---

## 3. Data

| Layer | Source | Status |
|---|---|---|
| Fuel / land cover | ESA WorldCover v200, 10 m | already baked, global |
| Fire weather | Canadian FWI from ERA5 via Open-Meteo | already baked, global |
| **Lightning density** | **NASA LIS/OTD 0.1° gridded climatology** | **new — replaces the FIRMS activity layer** |
| Live strikes (aspirational) | NOAA GOES-GLM, keyless on public S3 | not shipped; cited |
| Fuel moisture (aspirational) | KBDI via Earth Engine, ERA5 soil moisture | not shipped; cited |

**Blitzortung is prohibited.** Its terms bar commercial use and redistribution
and restrict the raw feed to network participants. Cite, never embed.

**Region: James Bay coast, Quebec — `(-80.8, 51.0, -76.2, 53.2)`.** About
314 × 244 km, ~46 × 22 native LIS/OTD cells.

Sized for the towers, not the old sensors: at a 15 km detection radius a
66 km box holds about four towers, which is neither an interesting
optimisation nor enough lightning samples to matter. At 51–53 °N one degree of
longitude is only ~65 km, so 300 km east–west needs ~4.5° of longitude, not the
~3° a mercator intuition suggests.

Chosen over six alternatives on four hard constraints:

- **Lightning must dominate.** Rules out the Mediterranean (~5 % of fires
  lightning-caused, >95 % human) and Indonesia (land-clearing and peat).
- **Satellite coverage.** LIS/OTD reaches high latitudes, but the live-strike
  upgrade path does not: GOES-GLM is Western Hemisphere only and fades in the
  low 50s °N. That disqualifies Wood Buffalo (58–60 °N), Alaska interior
  (66–68 °N), Siberia (60–67 °N) and Australia outright. **This box tops out at
  53.2 °N, which is at the edge of that limit** — sources disagree between
  ~52 °N and ~54 °N. It does not affect the shipped climatology; it is a
  caveat on the live-strike layer only, and the northern strip is the part at
  risk.
- **Nobody already doing it.** Alberta's Rocky Mountain foothills have the
  best-documented lightning gradient in the literature — and Alberta Wildfire
  runs an operational lightning-ignition model *and* AltaML's deployed AI
  wildfire-occurrence predictor. Going there invites the question "why do they
  need you?" with a good answer already on the table.
- **Remote enough that "nobody is watching" is credible.** Alberta's corridor
  is settled with highway cell coverage. James Bay has villages only —
  Eastmain, Wemindji, Chisasibi — in Eeyou Istchee Cree territory.

It keeps every strength of the Abitibi box — same Quebec boreal system that
produced the 2023 smoke over New York — while trading climatologically flat
inland forest for a coast, where land–water convective contrast gives a
physical mechanism for real spatial structure in strike density.

**That gradient is a hypothesis, not a measured fact.** No literature
quantifies it for this coast the way Alberta's foothills gradient is
quantified. **Gate:** once the climatology is in hand, measure the strike
density range across this box before baking. If it is flat, the lightning
layer is decorative and the honest response is to say so in the source notes —
not to pick a flattering region afterwards. Abitibi remains the fallback and
loses nothing but the gradient.

---

## 4. The one-layer swap

The existing bake ships *components* — `classes.bin` (WorldCover codes) and
`activity.bin` (a float32 field) — and the browser recombines them into risk:

```
risk = flammability(class) × (w_base + w_weather·fwiNorm + w_activity·activity)
```

`activity` was FIRMS fire detections. **It becomes lightning strike density.**
Same raster shape, same recombination arithmetic, same bit-for-bit parity test
against the Python. The risk field stops meaning "where fire has been" and
starts meaning "where lightning ignition is likely" — which is the whole
pivot, delivered by swapping one raster.

The separation of the bake into recombinable components was the most
over-engineered decision of the previous week. It is what makes this cheap.

**Detection radius moves from 2 km to ~15 km**, matching camera and thunder
range. Tower counts fall into the tens, which is the regime where the measured
Benchmark A curve shows risk-driven siting beating a uniform grid by its widest
margin (+3.55 pp at 132 nodes, crossing over only at 285).

---

## 5. What is deleted

- **Benchmark B and the entire fire-spread path.** It measures time-to-detection
  *after* ignition, which is the opposite of this product's claim. It is also
  CONUS-only and costs twelve minutes per bake. `tools/bake/bake_fire.py`,
  `_fire_grid.py`, `ignitions.py`, `spread_probe.py`, `fire_domain.py`,
  `_region_frame.py` and the web-side `arrivals.ts` / `detection.ts` /
  `loadFire.ts` and their tests all go.
- **LoRa mesh, the rod, the camper app.** Towers are fixed infrastructure with
  power and backhaul.

Deleted work is not wasted work: `docs/fire-model-choice.md` and the
repo-defect findings stay as evidence of engineering process, which the NTE
rubric scores under TECHNICAL and QUALITY.

---

## 6. Build order

Chronological, dependency-first. No timeline, nothing deferred.

1. **Write `docs/lightning-research.md`** — the two research briefs, with
   citations, as a committed document. Everything downstream quotes it, and the
   video script needs it.
2. **Acquire the LIS/OTD climatology** and resample it to the region grid.
3. **Add the Quebec Abitibi box** to the bake's region table.
4. **Bake the region** — WorldCover + FWI + lightning density, emitting
   `classes.bin`, `lightning.bin`, `meta.json`.
5. **Swap `activity` → `lightning`** through `loadRegion`, `risk.ts`,
   `pipeline.ts` and the parity tests. Keep the bit-for-bit anchor.
6. **Re-point defaults** — region, `detectKm` 15, budget mode, node counts.
7. **Delete the fire-spread path** from `tools/` and `web/`, and the tests.
8. **Rewrite the region list** to lightning-relevant regions, keeping the
   honest unbaked degradation.
9. **Copy pass** — towers, strikes, Prevent, and the §2 constraints enforced by
   `copy.test.ts` the way the existing honesty strings are.
10. **Flash-to-bang interactive** — flash, silence, a running timer, the boom,
    a range ring. Real physics the reader feels rather than reads.
11. **Two-tower triangulation coverage.** Coverage stops being "within range of
    a tower" and becomes "within range of at least two", which is where a
    uniform grid does worst and the optimiser does best. Adds a second
    benchmark: localisation error in metres across the region.
12. **The Rail** — seven beats: cold open flash · the strike and the clock ·
    the gap · the tower explodes · flash and bang · two towers · the question.
13. **The exploding 3D tower** — camera head, microphone booms, solar, compute,
    backhaul.
14. **Presenter mode and skip-to-Lab.**
15. **`/assumptions`** — sources, proxies, simplifications, attribution.

---

## 7. Constraints carried forward unchanged

Brand and colour rules, the dataviz rules, the honesty layer, the two-tier
bake-offline/run-live architecture, the single-map-instance rule, the palette
validation and its recorded waiver, and the test culture — every claim backed
by a test that can fail. See `2026-07-31-pyra-website-design.md` §2, §3, §6 and
§10, which are unaffected by this pivot.
