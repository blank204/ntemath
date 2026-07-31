# Handoff — 2026-07-31, 20:45

For the next agent. Read this first, then
`docs/superpowers/specs/2026-07-31-pyra-lightning-pivot.md`.

---

## 1. Where things stand

Branch `pyra-site`, HEAD `0be3aef`. **269 tests pass, `npm run build` clean.**
Nothing is half-finished in the working tree.

The project pivoted **today** and the pivot is committed. It is not a
speculative direction — it is the current design.

**What happened:** another FIRST Global team submitted the same
smoke-detection concept. The project moved upstream of ignition: AI
watchtowers that locate **lightning strikes** and score which are likely to
start fires, before anything burns. NTE category changed from Detect to
**Prevent**.

**Why that is a promotion, not a retreat:** the team's own research
(`docs/NTE-2026-research.md`) predicted Detect would be the most duplicated
category across 190+ teams. The collision confirmed it. Prevent is what the
official guide calls the most cost-effective phase and what that research
names the best differentiation-per-effort.

**What survived, unchanged and working:** the siting model (blue-noise +
greedy set cover, bit-for-bit parity with the team's Python), Benchmark A
(risk-driven placement versus a uniform grid), the Lab UI, the palette and its
validated waiver, the honesty layer, the whole test culture.

**What was deleted** (commit `1257435`): the entire fire-spread path —
Benchmark B, `bake_fire`, `_fire_grid`, `ignitions`, `spread_probe`,
`fire_domain`, and the browser-side `arrivals`/`detection`/`loadFire`. It
measured time-to-detection *after* ignition, which is the opposite of the new
claim. `docs/fire-model-choice.md` was kept deliberately: the measurement that
killed it is evidence of engineering process, which the NTE rubric scores.

---

## 2. The one thing blocked on the human

**NASA Earthdata Login.** The LIS/OTD lightning climatology needs a free
account; the anonymous endpoint returns `401` (verified). Aarav was mid-signup
at 20:45 and had to leave.

**Do not attempt to create the account, log in, or handle the password.**
Account creation and credential entry are off-limits. When the file appears,
it belongs in `outputs/lightning/`.

Blocked on that file, and only that: the climatology **loader**, the **bake**,
and the **gradient gate** (§4 below).

Everything in §3 is unblocked. Do that.

---

## 3. Work that needs no human — in order

The full build order is §6 of the spec. These are the items with no dependency
on the lightning file or on Aarav.

1. **The flash-to-bang interactive.** Highest value per hour on this list and
   entirely self-contained: flash fires, screen goes white, **silence with a
   timer running**, then the boom and a range ring snaps out at
   `343 m/s × Δt`. The reader *feels* the measurement instead of reading it.
   Pure front-end, real physics, no data. It is also the single best B-roll
   shot for the 2-minute video, which is the actual graded deliverable.
2. **Two-tower triangulation coverage.** Coverage stops being "within range of
   a tower" and becomes "within range of **at least two**". A uniform grid does
   badly at double coverage — it spaces for single — while the optimiser can
   deliberately overlap. Expect the margin over the grid to be *wider* than
   Benchmark A's +3.55 pp. The algorithm and its tests can be built against
   synthetic fields today; only the final numbers need the bake. Adds a second
   honest benchmark: localisation error in metres.
3. **Copy pass** — rods → towers, fires → strikes, Detect → Prevent. Enforce
   the §2 constraints of the spec in `web/tests/copy.test.ts` exactly the way
   the existing honesty strings are enforced.
4. **Region list** (`web/src/lib/regions.ts`) — replace the eight fire regions
   with lightning-relevant ones, keeping the honest unbaked degradation.
5. **Web defaults** — `detectKm` 2 → 15 (camera and thunder range), region
   name, node counts. This drops tower counts into the tens, which is the
   regime where Benchmark A's measured curve favours risk-driven siting most.
6. **Add the James Bay box** to a bake-side region table. `plan.REGIONS` is
   **read-only**; add regions in `tools/bake/`, never upstream.
7. **The Rail**, seven beats: cold-open flash · the strike and the clock · the
   gap · the tower explodes · flash and bang · two towers · the question.
8. **The exploding 3D tower** — camera head, microphone booms, solar, compute,
   backhaul. Ask Aarav whether a model exists before building one.
9. **Presenter mode and skip-to-Lab**, then `/assumptions`.

---

## 4. The gradient gate — do not skip this

The demo region is **James Bay coast, Quebec `(-80.8, 51.0, -76.2, 53.2)`**,
~314 × 244 km. It was chosen over six alternatives (see the spec) partly
because a coast gives a *physical mechanism* — land–water convective contrast —
for real spatial structure in strike density.

**That is a hypothesis. No literature quantifies it for this coast.**

When the climatology lands: measure the strike-density range across the box
**before** baking. If it is flat, the lightning layer is decorative, and the
honest response is to record that in the source notes — **not** to go shopping
for a region that flatters the result. Abitibi `(-78.9, 49.0, -78.0, 49.6)` is
the fallback and loses only the gradient.

`tools/bake/lightning.py` is written and proven against synthetic
climatologies. `sample_density` is tested for row-0-is-south (both directions
plus an analytic check), invariance to north-up vs south-up sources,
edge-clamping instead of NaN holes, exact constant preservation, and a hard
failure on axis/grid mismatch. **The loader is deliberately absent** — writing
a reader against an unseen schema is how you ship plausible-but-wrong data.

---

## 5. Science constraints — binding on all copy

`docs/lightning-research.md` is the evidence base. Section 2 of the spec is the
binding version. Three claims were asserted, then **disproved by research the
same day**, and they nearly reached a competition video:

- **No amperage for continuing current.** "100–200 A" has no primary source;
  paraphrases disagree (200–800 A, or "tens to hundreds"). The **>40 ms
  duration** threshold stands and is the correct mechanism.
- **Polarity is not a proxy.** "~80 % of positive vs ~10 % of negative strokes
  carry long continuing current" is unverified and points the wrong way: in the
  largest dataset matching strokes to real ignitions, **90 % of fire-starting
  strokes were negative**, because negative strokes vastly outnumber positive.
- **Dry lightning: 2× over-representation**, not "30–50 % more per strike" —
  ~20 % of strikes producing ~40 % of fires.

Also: cloud-to-ground vs cloud-to-cloud is **not** the discriminator —
continuing current is. Holdover's 152,375-fire dataset is **global across 13
countries**, not Canadian. Never claim novelty (Wotton & Martell has been
operational 20 years) or any advantage over EM lightning networks (sub-km,
range-unlimited; audible thunder tops out near 20 km). **Blitzortung is
prohibited** — its terms bar commercial use and redistribution.

---

## 6. Traps this codebase has already paid for

- **Row 0 is the SOUTH edge** in every raster. Getting it backwards mirrors the
  field, looks entirely plausible on a map, and is completely wrong.
- **Two coordinate frames exist.** `place.LocalFrame` is equirectangular km
  about the box centre; anything projected is not the same frame. Over an 80 km
  box they differ by ~1.7 km, which cost a Critical review finding today.
- **Never a hex colour outside `web/src/theme/palette.ts`.** Absolute.
- **Every test must be able to fail.** This repo has shipped tautologies three
  times and each was caught by review. Two tests written for other reasons
  caught a grid-resolution bug today — that is the culture working.
- **Use `git commit -F <file>`.** PowerShell here-strings mangle apostrophes;
  six commit messages carry doubled `''` because of it.
- **Verify repo-root Python signatures with `inspect.signature` first.** Seven
  wrong call sites have been caught across three plans.
- **Repo-root Python is read-only.** Additive work only, in `tools/` or `web/`.
- **Subagents stall on long-running jobs.** Three separate agents burned ~260k
  tokens polling for background processes that died with them. Split "write the
  code" from "run the 12-minute job", and run heavy compute in the controller
  session with a `Monitor` watching for both progress *and* failure signatures.

---

## 7. Context Aarav will want on return

- **He noticed the collision.** He owns the website and the scripts; the video
  and the display ad are his team's.
- **Phase 1 closes 3 August, 11:59 PM UTC** — and the graded artifacts are a
  ≤2-minute video and a 2480×3508 portrait ad. **The website is not a scored
  deliverable.** It earns points as proof of action, as the demo vehicle, and
  as the ad's call-to-action. Anything built here should serve those.
- Framing is **"Qatar-built, world-deployed"** — Qatar has no wildfires; it has
  50 °C summers, dust, salt air and an engineering base. Exporter of the
  solution, not victim of the problem. Already in the older spec at §309.
- Open question he has not answered: **is there a 3D model of the tower**, or
  do we build from primitives?
