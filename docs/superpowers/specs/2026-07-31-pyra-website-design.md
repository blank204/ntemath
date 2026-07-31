# Pyra — Website Design Spec

**Date:** 2026-07-31
**Project:** Pyra — wildfire detection rod network + camper app (FIRST Global Challenge 2026 NTE, category: Detect)
**Scope of this spec:** the public website only. Not the hardware, not the app, not the NTE video or display advertisement.

---

## 1. Purpose

A public website that presents the Pyra system and — critically — makes its one genuinely-existing component, the rod placement model, playable and verifiable in a browser.

The site serves four jobs, in priority order:

1. **Prove the models work.** No hardware exists yet. The two Python systems — the validated fire-spread model and the node-siting pipeline — are the only real, running artifacts the project has. The site must make that fact an asset rather than a weakness.
2. **Explain the system** — sensor fusion, Bluetooth mesh, camper-as-sensor — to a non-specialist in a few minutes.
3. **Be presentable live** at the 2026 FIRST Global Challenge in Incheon, from a podium, on venue wifi.
4. **Serve as the call-to-action destination** for the NTE display advertisement and as awareness-building evidence for Phase 3.

Not a goal: being a real monitoring product, collecting real camper reports, or serving live fire data to actual authorities.

### Constraints established with the user
- No fixed deadline; not gated on an NTE submission milestone.
- The user directs; Claude writes the code.
- Static hosting (Vercel or Netlify), live map tiles at runtime.
- **No physical prototype exists.** Everything hardware-related is a design, not a build.
- Code lives in the team repo **`blank204/ntemath`**. The website ships on a **new branch**, not `main`.

### Upstream reality (verified 2026-07-31 by running the code)

The team repo contains two substantial Python systems, both real and both working:

**1. Fire-spread model (M1–M7, ~5,700 lines).** Stochastic cellular automaton on an irregular Voronoi mesh, calibrated, with a resolution-convergence sweep and validation against two real fires (SILVERADO 2020, LAKE 2024) using CAL FIRE FRAP perimeters, LANDFIRE FBFM40 fuels and Open-Meteo hourly wind. Documented limitations, honestly reported: simulated aspect ratio ~1.0 against 2.79 observed (residence-time dilution), a ~19% `g_geom` head-ROS drift across 8× spacing, and no suppression, spotting or diurnal cycle.

**2. Node-siting pipeline (`nodenet`, ~2,400 lines).** Keyless global open data in, sited nodes out:
- `forest.py` — ESA WorldCover 10 m, windowed via GDAL `/vsicurl/` range requests (never downloads tiles)
- `hazard.py` — NASA FIRMS active-fire detections + full Canadian FWI (FFMC/DMC/DC/ISI/BUI/FWI) from ERA5
- `place.py` — variable-radius Poisson-disk blue noise, `r(x) = r_max − (r_max − r_min)·risk`, then greedy set cover
- `plan.py` / `world.py` — bbox → plan; global sweep with cost estimate

Verified run, Los Padres, `detect_km = 2.0`, saturation mode: 928 blue-noise candidates → **561 nodes at 0.950 risk-weighted coverage**, a 40% cut. ~102 nodes/1000 km². *(That is `plan_region` with numpy's PCG64. The site runs the identical algorithm through a portable shared generator and gets **927 → 572 at 0.9501** — a different valid draw, verified bit-identical between Python and TypeScript. Use the site's figures on the site.)*

**Known defect (upstream, not the website's):** default `budget="auto"` clamps to 40 nodes, so the default run reports 4.5% coverage on a region needing ~529 nodes. The algorithm is correct; the default is a demo clamp. The site must run saturation mode, not the default.

---

## 2. Brand and colour

### The rule that governs everything
**Green and black are the world. Orange means fire.**

Dark forest green and black are the site's surfaces, terrain and chrome. Saturated orange is spent almost nowhere except the Pyra wordmark, and is otherwise reserved entirely for fire, heat and alert states. Consequence: when something ignites, the page visibly changes temperature.

### Palette slots

| Slot | Role | Value (starting point) |
|---|---|---|
| Canvas | page background | `#060706` |
| Surface | panels, cards | `#0E1F16` |
| Surface raised | elevated panels, terrain base | `#1B3B29` |
| Ink | primary text | `#F2EFE6` |
| Brand orange | Pyra wordmark only | `#FF6B1A` |
| **Heat ramp** | fire, heat, alert — reserved, nothing else | `#7A1B00` → `#E03A00` → `#FF8A00` → `#FFD166` → `#FFF3D6` |
| **Mesh teal** | network links, telemetry, system-nominal, Pyra data series | `#4DE1C1` |
| Baseline gray | uniform-grid comparison series | `#8A9691` (validate before shipping) |
| Risk/fuel ramp | sequential magnitude raster | low-chroma sand → dark brown |

### Rationale for the two additions
Orange cannot be both the brand colour and the danger signal — if the logo, headlines, buttons and the fire are all orange, an ignition produces no perceptual change. Hence the reserved heat ramp.

The mesh must read as *cool* against *hot*. A teal alert visibly escaping an orange fire is the core visual idea of the entire site; an orange alert relaying across an orange fire is invisible.

### Data-visualisation colour rules
Derived from the `dataviz` skill; these are binding.

- Pyra series = mesh teal. Uniform-grid baseline = neutral gray. System versus nothing, never two competing hues.
- Risk and fuel rasters use **one** low-chroma sequential ramp (sand → brown), deliberately dull so live fire always dominates the frame. Never a rainbow.
- Heat-ramp colours are status colours. They are never reused as a data series.
- Text wears text tokens, never series colours.
- The categorical palette must pass `scripts/validate_palette.js` (CVD separation, chroma floor, contrast) for both light and dark surfaces **before it ships**. Run the script; do not eyeball it.

---

## 3. Architecture

### Stack
| Concern | Choice | Why |
|---|---|---|
| Framework | Vite + React + TypeScript | Static output, fast dev loop |
| Map engine | **MapLibre GL JS** | Open-source, no vendor lock or billing cliff; native terrain-RGB, pitch/bearing, and a `flyTo`/`easeTo` camera API that gives the 2D→3D tilt natively |
| Tiles | **MapTiler** (satellite + terrain-RGB) | Free tier covers imagery and elevation |
| Sim rendering | **deck.gl** over MapLibre, shared camera | Rods, coverage, mesh arcs and fire front are GPU layers; hundreds of animated arcs would stutter as DOM/SVG |
| 3D rod | **react-three-fiber**, own canvas, mounted only in view | Isolated from the map; no asset pipeline |
| Scroll | Smooth-scroll controller + per-beat progress | Drives camera keyframes |
| State | **Zustand** — three stores: story beat, simulation, model parameters | Rail and Lab read the same simulation state without prop-drilling through the scroll system |
| Compute | **Web Workers** — placement model, fire-spread CA | The two things that could jank the scroll never touch the main thread |
| Hosting | Vercel or Netlify, static | No server to fail on stage |

### Two-tier compute: bake offline, run live

This resolves the "you cannot put numpy/scipy/GDAL in a browser" problem without faking anything.

**Offline (Python, run once per region, committed as data):**
- `forest.py` + `hazard.py` + `plan.py:risk_field` produce a **risk raster per region**, plus the fuel-class mix, FIRMS detection points and the FWI value used.
- The fire-spread model produces **pre-computed fire runs** — arrival-time fields for a set of ignition points per region.
- Output: compact typed arrays + metadata per region, checked into the repo.

**Live (TypeScript, in the browser):**
- **Only `place.py` is ported** — `variable_poisson_disk`, `greedy_minimise`, `coverage_of`, `demand_points`, and the `LocalFrame` km projection. This is pure numeric code with no I/O and no geospatial dependencies; it ports faithfully and is small enough to golden-test line for line.
- The visitor's placement runs are therefore **the real algorithm on real risk data**, computed live, not a recording.

The split is honest and it is the natural seam: data acquisition is offline because it needs GDAL and the network; the differentiator is live because it's 300 lines of arithmetic.

### The one non-negotiable structural rule
**A single MapLibre instance, created once, never unmounted.** The Rail and the Lab are two *states* of the same living world, not two pages. Switching modes is a camera move plus a UI swap.

This rule is load-bearing for two effects: the handoff from film to sandbox feels like taking the controls rather than loading a new toy, and a camper report filed in the phone mock appears as a live pin on the same map the visitor has been watching since the first beat.

### Sitemap
```
/                 Rail (7 beats) → launches Lab (full-screen mode)
                  ↳ exiting Lab returns to the closing run:
                    impact · "Built in Qatar. Deployed where it burns."
                    · build status · roadmap · team · CTA
/assumptions      Sources, proxies, simplifications, attribution
```
That is the entire site. Resist adding routes.

---

## 4. The Rail

Full-bleed map. Text panels ride over it on the left. Camera choreographed against scroll progress. Seven beats.

| # | Beat | Content | Camera |
|---|---|---|---|
| 1 | **Cold open** | Black. One ember — the only orange that has existed on the page. *Pyra.* | Static |
| 2 | **Ignition** | Terrain resolves in dark green, from above, at night. A spark. Fire spreads unchecked while a clock runs. Lands on a real number: how long a fire in this region typically burns before it is reported. | Top-down, slow push |
| 3 | **The gap** | Why detection fails — satellite revisit intervals, sparse lookout towers, cell coverage stopping at the treeline. | Pull back to reveal unwatched land |
| 4 | **The rod** | Three senses: infrared, acoustic, gas. The fusion argument — any single sensor lies (sun-warmed rock, wind, a barbecue); three agreeing do not. **The rod splits apart as you scroll**, component by component (§7), then the fusion truth table. | Descend and tilt to ground level; orbits the rod through the explode range |
| 5 | **The network** | The alert has nowhere to go — no cell signal. It hops rod to rod over **LoRa** in cool teal against the orange, reaches a gateway, exits to the authority. *No tower. No subscription.* Includes the range-vs-spacing beat that justifies the radio choice. | Low, following the relay |
| 6 | **The camper** | Coverage thins. A phone joins the nearest node over **Bluetooth**; a photo and a position enter the network and ride the LoRa backbone out. People become sensors. | Mid-tilt |
| 7 | **The question** | A naive uniform grid drops over the terrain — evenly spaced, blind to the ridge, wasteful in the valley. *So where do you actually put them?* Hands off to the Lab. | Lift to near-top-down |

Camera arc across the rail is the "2D that tilts into 3D" decision made concrete: beats 1–3 near-top-down, 4–6 tilted and low, 7 back up to legibility before the visitor takes control.

### Required controls
- **Persistent "Skip to the Lab."** A judge with four minutes must not have to scroll through a film to reach the proof.
- **Presenter mode.** Arrow keys advance beats instead of scrolling, so the rail can be driven from a podium with a clicker in Incheon without touching a trackpad.

---

## 5. The Lab

Full-screen sandbox. The centrepiece of the site.

### Flow
1. Pick a region.
2. Run the drone survey — the model's input rasters resolve on screen.
3. Set the model's weights and coverage target (see the control table below). Budget defaults to **saturation** — node count is whatever reaching the coverage target requires — with `auto` and a fixed integer available.
4. **Run placement.**
5. Ignite a fire by clicking anywhere.
6. Watch detection and mesh relay.
7. Read the result.

### Left panel

Controls are the model's **actual** parameters, not the ones in the original pitch:

| Control | Maps to | Range |
|---|---|---|
| Region | one of the eight `REGIONS` | picker |
| Fire-weather weight | `w_weather` | 0–1 (default 0.45) |
| Observed-activity weight | `w_activity` | 0–1 (default 0.35) |
| Detection radius | `detect_km` | 0.5–5 km (default 2.0) |
| Spacing bounds | `r_min_km` / `r_max_km` | derived, overridable |
| Coverage target | `target` | 0.5–0.99 (default 0.95) |
| Budget mode | `auto` / saturation / fixed integer | **defaults to saturation** |

`w_base` is the remainder, shown but not directly editable. Flammability multiplies rather than adds — the site should say why: no amount of fire weather makes open water a fire risk, and a model that lets weather alone drive risk sites sensors in a lake.

**Fairness is stated on screen:** identical node count, identical region, identical ignition set. An unfair benchmark is worse than no benchmark.

### The benchmark
A single ignition producing "4 min vs 19 min" is an anecdote, and any judge with a science background will ask whether the click was lucky.

**Primary result: `Run 100 ignitions`.** The same 100 ignition points — drawn from real FIRMS historical detections for that region — are fed to both strategies and rendered as **two dot strips with median markers**, one row per strategy. A distribution, not a story. Runs in a worker with results streaming in progressively — the page never freezes.

**A second comparison the code already computes for free:** blue noise alone versus blue noise + greedy set cover. On Los Padres that's **927 → 572 nodes** for the same 95% coverage — a **38% hardware saving** from the minimisation stage alone, verified bit-identical between the Python and the browser. That is a clean, quantified engineering result and it should be surfaced as its own stat tile.

**Secondary, live single-run readouts:** a KPI row showing detection time per strategy plus the delta, and an event log in plain language:

```
14:02  rod A7 — IR rise + gas concordance, acoustic negative → alert raised
14:03  relay A7 → A5 → A2 → gateway
14:03  authority notified
```

The event log is what makes sensor fusion legible instead of merely claimed.

### Chart forms
Per the `dataviz` procedure — form chosen by the data's job, colour assigned last:
- Detection-time delta → **stat tiles / hero number**, not a chart.
- Two strategies × 100 runs → **dot strips with median markers**, two rows, legend present, medians directly labelled.
- Never a dual axis. Never a rainbow ramp. Hover layer on every plotted mark.

---

## 6. Data and the honesty layer

The original draft of this spec assumed weak proxies. The actual pipeline uses better data than proposed, and the honesty layer should say so.

### Real, and used by the model
| Layer | Source | Notes |
|---|---|---|
| Fuel / land cover | **ESA WorldCover 10 m**, windowed via GDAL `/vsicurl/` | Drives the flammability field. Real, 10 m, global |
| Observed fire activity | **NASA FIRMS** VIIRS 375 m + MODIS 1 km, weighted by fire radiative power | Keyless global feeds; **recency signal only** — the open feeds reach back days, not years |
| Fire weather | **Canadian FWI** (FFMC/DMC/DC/ISI/BUI/FWI) computed from ERA5 via Open-Meteo | Full index system, not a proxy |
| Satellite imagery, elevation | MapTiler, live tiles | Presentation only — not a model input |
| Historical ignition points | NASA FIRMS detections, pre-baked per region | Seeds the 100-run benchmark |

### The risk field, stated exactly as the code computes it
```
risk = flammability(landcover) × (w_base + w_weather·FWI_norm + w_activity·activity)
```
Flammability **multiplies**; the drive terms **add**. The site should explain why, because it's a good argument: no amount of fire weather makes open water flammable, and a purely additive model sites sensors in lakes.

### What the model does NOT use — declared, not hidden
**Elevation and camper traffic are in the project pitch but are not terms in the risk field.** Per the user's decision, the site ships what is real and marks the rest:

| Input | Status |
|---|---|
| Fuel / flammability | Implemented |
| Fire weather (FWI) | Implemented |
| Observed activity (FIRMS) | Implemented |
| Elevation / slope | **Roadmap — not implemented** |
| Camper traffic | **Roadmap — not implemented** |

These appear in the build-status strip as declared roadmap items. Nothing on the site may claim the model weighs elevation or camper traffic until it does.

### The fire model — upgraded claim
The earlier draft called this "a simplified CA, must be labelled as such." That undersold it. It is calibrated, convergence-tested, and validated against two real fires. The site may say so, provided it also carries the limitations the authors themselves documented: simulated aspect ratio ~1.0 against 2.79 observed; ~19% `g_geom` head-ROS drift across 8× spacing; no suppression, spotting or diurnal cycle. Reporting those *strengthens* the claim — they are the marks of a model whose authors measured it rather than sold it.

### Known caveats to surface
- **`detect_km = 2.0` is currently an unjustified free parameter.** 2 km is optimistic for IR/acoustic/gas detection of a small fire under canopy. The site must not present it as measured until it is sourced. Flagged as an open item.
- FIRMS activity is a days-deep recency signal, not a fire history. The code already treats it as such; the site must too.

### Regions — already defined upstream in `plan.py:REGIONS`
| Key | Area | Fire regime |
|---|---|---|
| `los-padres` | California | chaparral |
| `amazon-rondonia` | Brazil | tropical moist |
| `siberia-baikal` | Russia | boreal larch |
| `portugal-centro` | Portugal | Mediterranean pine |
| `victoria-alpine` | Australia | eucalypt |
| `congo-basin` | DRC | tropical moist |
| `sweden-norrland` | Sweden | boreal spruce |
| `greece-peloponnese` | Greece | Mediterranean |

Eight distinct fire regimes, which is a stronger IMPACT argument than four hotspots: the same code path runs anywhere on Earth. `estimate_global_cost` — 40.6 M km² of forest, ~4.06 M nodes at 2 km detection — belongs on the impact section, including its own caveat that node count scales as 1/r².

Framing: **Qatar-built, world-deployed.** Qatar's contribution is gas-sensing expertise and rugged, low-cost, exportable hardware — Qatar is the exporter of the solution, not the victim of the problem. The region picker is the mechanism that resolves the "your nation" framing out loud rather than hoping nobody notices it.

### The honesty layer
**Persistent build-status strip:**
> Siting model: implemented, running live in your browser · Fire model: implemented, validated on 2 real fires · Hardware: specified, not built · Field data: none yet · Network: simulated · Elevation & camper-traffic inputs: roadmap

**`/assumptions` page:** every proxy, every simplification, the provenance of every number on the site, and the licence attribution required by MapTiler, OpenStreetMap and ESA.

Rationale: with no hardware built, a photorealistic forest render lets a judge assume hardware exists, and that assumption collapses in Phase 3 Q&A. Declaring the line converts the project's biggest vulnerability into visible engineering maturity, and makes the working simulator read as evidence rather than decoration.

---

## 7. The rod

**Built in code, not modelled** — procedural geometry from primitives in react-three-fiber: pole, solar panel, sensor housings, stake. Two reasons: no CAD or asset-pipeline dependency, and a stylized schematic object is *honest* in a way a photorealistic render of non-existent hardware is not.

### Interaction: scroll drives the explosion

**Primary interaction is scroll, not click.** Scroll progress through beat 4 maps directly to an explode parameter `t ∈ [0,1]`: the rod starts as one sealed object and pulls apart along its axis as the visitor scrolls, each component separating in sequence with its label fading in as it clears the body. Scrolling back reassembles it. The camera orbits slightly across the same range so the object is never seen from a dead-on static angle.

Components separate in a deliberate order — **outermost and most legible first**: housing → solar panel → IR sensor → microphone → gas sensor → LoRa radio → BLE radio → MCU → battery → stake. Each gets a scroll sub-range, so the sequence reads as disassembly rather than everything flying apart at once.

**Secondary interactions, live once the sequence completes:** drag to rotate freely, and click any component to isolate it with its role and rough unit cost.

Implementation notes: one `explodeT` value in the story store, driven by the beat's scroll progress and consumed by every component's transform. Component offsets are authored as unit vectors × a per-part distance, so the whole sequence is tunable from one table. `prefers-reduced-motion` snaps to three discrete states (assembled / half / exploded) instead of interpolating.

### The radio decision, and why the site should show its working

The measured output of the siting model is **7.5–18.5 km blue-noise spacing, ~3.1 km mean spacing at saturation**. Bluetooth mesh — including BLE Coded PHY — reaches a few hundred metres to about 1 km line-of-sight, and less under canopy. **A Bluetooth backbone at those spacings cannot form a mesh at all.**

The backbone is therefore **LoRa** (2–15 km, the standard choice for deployed wildfire sensor networks). **BLE is retained for the camper leg only**, phone to nearest node, which is exactly the range it suits.

The site should present this as a decision with a reason rather than quietly shipping the right answer — "our own siting model produced 3 km spacing, which ruled out the radio we started with" is a stronger engineering story than never having had the problem. One short beat, one diagram: radio range plotted against the spacing the model actually produces.

**The sensor-fusion truth table** — the most important interactive element in this section. Three toggles, one per sensor, against a row of scenarios: real fire, sun-heated rock, a barbecue, wind in the canopy, a passing vehicle. Flipping sensors on and off shows which combinations false-alarm on which scenario. The project's core technical claim, made checkable in about ten seconds.

**Bill of materials** with rough unit cost, adjacent. "Rugged, low-cost, exportable" is a claim; a BOM totalling a number is an argument. Requires the user's actual component picks, or clearly-marked placeholder estimates.

---

## 8. The camper app

An in-page phone mock the visitor taps through:

spot smoke → photo → GPS attaches → **no signal** → phone discovers a nearby rod over **Bluetooth** → report joins the **LoRa** backbone → hops → gateway → authority acknowledges.

**The payoff of the single-map-instance rule:** the report filed in the phone appears as a live pin on the same map the visitor has been watching since beat 2, and relays across it.

Labelled throughout as a simulation of the app, not the app.

---

## 9. Performance, resilience, degradation

### Budgets
- Interactive within ~3s on a mid-range laptop.
- 60fps on the rail; the Lab simulation may drop to 30fps.
- Lab code-split and loaded on demand. The three.js canvas mounts only when its beat is in view. deck.gl layers are created once and updated, never recreated per frame.

### The failure mode that actually matters
**Venue wifi in Incheon.** Live tiles mean a bad connection shows a judge a blank grey rectangle.

- A **service worker caches all regions' tiles** on first load.
- A **bundled low-resolution basemap per region** acts as a hard floor.
- **The site must never be able to render an empty map.**
- An **offline self-check** so the presenter can confirm readiness before going on stage.

### Other degradations — all graceful, none a wall
| Condition | Behaviour |
|---|---|
| No WebGL / weak GPU | Static beat imagery; Lab replaced by a pre-rendered video of a run |
| Worker failure | Main-thread compute with a progress indicator |
| `prefers-reduced-motion` | Rail becomes click-through, no camera movement |
| Mobile | Full rail at reduced terrain exaggeration; Lab capped to fewer rods and 25 runs, with a notice. Never "desktop only" |

### Security
MapTiler keys are public by necessity — restrict by referrer domain.

---

## 10. Testing

In priority order.

1. **Golden tests for the `place.py` port — non-negotiable.** `variable_poisson_disk`, `greedy_minimise`, `coverage_of`, `demand_points` and `LocalFrame` are rewritten in TypeScript. If that port drifts from the Python, the site misrepresents the team's own work to judges.

   Concretely: a Python harness emits fixture files — seeded RNG stream, risk field, and the exact candidate and selected-node arrays — for several `(region, detect_km, target, seed)` combinations. The TypeScript suite must reproduce them. **The RNG must be ported too**, not substituted, or nothing is comparable; `numpy.random.default_rng` is PCG64, which is implementable in TS.
2. **Benchmark fairness test.** Assert both placement strategies receive identical ignition sets and identical rod counts. This claim is load-bearing for the site's central result.
3. **Deterministic fire model.** Seeded snapshot tests.
4. **Palette validation in CI.** `validate_palette.js` must pass for both surfaces.
5. **Visual regression.** Playwright screenshots of each rail beat.
6. **Performance budget in CI.**

---

## 11. Implementation phasing

This spec is one coherent product but too large for a single implementation pass. It decomposes into four milestones, each independently useful and demoable:

0. **Bake pipeline** — a Python script in the repo that runs `plan.py`/`hazard.py`/`forest.py` per region and emits the risk raster, fuel mix, FIRMS points and metadata as committed data, plus the golden-test fixtures. Nothing web-facing; everything downstream depends on it.
1. **Foundation** — Vite/React/TS, MapLibre + MapTiler, single-instance map rule, Zustand stores, palette validated, deploy pipeline. Ends with: one region rendering, camera controllable.
2. **The Lab** — `place.py` port + golden tests + PCG64 port, pre-computed fire runs wired in, placement/uniform toggle, 100-run benchmark and its charts, event log. Built *before* the rail, because it is the site's proof and everything else is framing for it.
3. **The Rail** — seven beats, camera choreography, skip control, presenter mode, reduced-motion path.
4. **The set pieces and hardening** — 3D rod and fusion truth table, camper phone mock, `/assumptions`, closing run, service-worker tile caching, degradation paths, visual regression.

Milestone 2 precedes milestone 3 deliberately: if the model port reveals problems, that must surface before any effort goes into the cinematic wrapper.

---

## 12. Open items

| Item | Owner | Blocks |
|---|---|---|
| ~~Placement model~~ | ~~User~~ | **Resolved** — `nodenet` in `blank204/ntemath`, verified working |
| ~~Region list~~ | ~~User~~ | **Resolved** — eight regions in `plan.py:REGIONS` |
| **Justify `detect_km`** — what detection radius is defensible for IR/acoustic/gas under canopy? | Team | Credibility of every coverage number on the site |
| **Fix `auto_budget` clamp** (hi=40 makes the target unreachable) or default to saturation | Team (upstream) | Whether the site can use the library's defaults |
| Rod component picks and costs, incl. LoRa module | Team | BOM; falls back to marked estimates |
| Elevation + camper-traffic terms in `risk_field` | Team (upstream) | Whether they graduate from roadmap to implemented |
| Review `build_globe.py` / `globe_template.html` prior art | Claude | Avoiding duplicate work; possible asset reuse |
| Domain name | User | Deployment, display-ad CTA |
| Team / credits content | User | Closing section |
| Branch name for the website in `blank204/ntemath` | User | First push |

---

## 13. Decisions log

| Decision | Chosen | Rejected |
|---|---|---|
| Deadline | None fixed; design for quality | Phase 1 rush build |
| Site type | Cinematic story + interactive simulator | Either alone; live product dashboard |
| Composition | **Story rail, then Lab** | One continuous world; chaptered multi-route app |
| Terrain | Real data, multiple selectable regions | Procedural; single region; stylized-render-only |
| Rendering | 2D that tilts into 3D | Pure 2D; pure 3D; abstract non-map |
| Hosting | Static + live map tiles | Fully pre-baked; backend app |
| Palette | Green-dominant, orange = fire only | Orange brand + white-hot fire; amber/orange split |
| Region framing | Qatar-built, world-deployed | Korea-first; Qatar-and-neighbours-first |
| Interaction | Sandbox + head-to-head benchmark | Sandbox only; guided cinematic only |
| Benchmark | 100 ignitions, distribution | Single ignition |
| Hardware/app depiction | Both fully interactive | Diagrams only; photos (none exist) |
| Rod asset | Procedural stylized geometry | Photorealistic render; CAD import |
| Build ownership | Claude writes, user directs | Pairing; user-maintained code |
| Node-to-node radio | **LoRa** backbone, BLE for the camper leg | Bluetooth backbone (physically impossible at 3–18 km spacing); BLE + gateway tiers; densifying to sub-km |
| Model inputs | Ship the three real terms; elevation + camper traffic declared as roadmap | Pretending the pitch's inputs exist; waiting for them to be built |
| Compute split | Bake data offline in Python, port only `place.py` to run live | Full port; Pyodide; pre-recorded runs only |
