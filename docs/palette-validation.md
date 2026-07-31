# Palette validation — the two data series

The Lab's charts carry exactly two series: the Pyra risk-driven placement and the
uniform-grid baseline. This file records what the `dataviz` validator says about
that pair. It is the record referenced by `web/src/theme/palette.ts` and pinned by
`web/tests/palette.test.ts`.

**This version records the retirement of a waiver, not the granting of one.** The
storm-blue rebuild of 2026-08-01 replaced the green-and-teal world, and the new
pair clears every computable check with nothing waived. What follows is the
evidence, and then the reasoning about why the old waiver existed at all — which
matters, because the conclusion the old note drew from it was too strong.

The validator is vendored **byte for byte** at `web/scripts/validate_palette.js`
(sha256 `d662614ff26e80fd0b4e5d1f6b12cb29de5d7fa8b3e1c2dcf4a7ebb988dc4f18`,
unchanged by this rebuild). It is not edited — a locally adjusted validator
validates nothing.

---

## 1. The pair, and the command

| slot | hex | what it carries |
|---|---|---|
| `series.pyra` | `#2696E4` | the risk-driven placement the model produces |
| `series.baseline` | `#AB437B` | the uniform grid it is measured against |

Chart surface is `#111C3E`.

```bash
cd web && npm run validate:palette
# → node scripts/validate_palette.js "#2696E4,#AB437B" --mode dark --surface "#111C3E"
```

## 2. The output, verbatim

```
Palette (dark, surface #111C3E, categorical): 2 slots
  [PASS] Lightness band         all 2 inside L 0.48–0.67
  [PASS] Chroma floor           all 2 >= 0.1
  [PASS] CVD separation         worst adjacent #AB437B↔#2696E4 ΔE 16.1 (deutan) · tritan 29.6
  [PASS] Normal-vision floor    worst adjacent #AB437B↔#2696E4 ΔE 26.2 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1

  → ALL CHECKS PASS  (CVD in the 6–8 floor band is legal ONLY with secondary encoding: direct labels, gaps, or texture)
```

Five checks, five passes. CVD separation at ΔE 16.1 is twice the 8.0 target and
nowhere near the 6.0 floor, so the pair no longer depends on secondary encoding to
be legal. The direct labels, the legend and the table view all stay — they are
good practice and the charts were built around them — but they have stopped being
load-bearing for accessibility.

## 3. The risk raster's ramp

The raster is a sequential magnitude field, so it takes the ordinal checks rather
than the categorical ones. A correct one-hue ramp fails the categorical checks by
design: it spans the lightness band and its pale steps drop under the chroma
floor.

```bash
cd web && npm run validate:risk-ramp
# → node scripts/validate_palette.js "#644E38,#896745,#B08153,#D0A071,#E7C3A2" \
#     --mode dark --surface "#111C3E" --ordinal
```

```
Palette (dark, surface #111C3E, ordinal ramp): 5 slots
  [PASS] Lightness monotone     steps read light→dark
  [PASS] Adjacent ΔL            all gaps >= 0.06
  [PASS] Light-end contrast     #644E38 at 2.13:1 vs surface
  [PASS] Single hue             hue spread 2°

  → ALL CHECKS PASS  (ordinal: one hue, monotone L, visible step gaps, light end clears surface)
```

One note worth keeping, because it cost a rebuild of the ramp: in `--mode dark`
the light-end check measures the **darkest** step against the surface, not the
lightest. A ramp starting below about OKLCH L 0.42 disappears into the field and
fails at around 1.2:1. This ramp starts at L 0.44.

## 4. Why the old waiver existed, and why it was not inevitable

The retired pair was `#4DE1C1` (teal) against `#8A9691` (grey), waived on two
checks: the teal sat at L 0.823, well above the dark band's 0.67 ceiling, and the
grey at chroma 0.016, far under the 0.10 floor. The old note recorded that "every
step that would satisfy those two collapses the separation to ΔE 0.4–7.5" — which
was true of the steps it tried — and concluded the waiver was forced.

That conclusion was too strong, and it is worth writing down why, because the same
reasoning will come up the next time this palette moves.

A sweep of OKLCH space inside the dark band — L 0.50–0.66, chroma 0.10–0.29, all
hues, excluding the 15–95° arc the `heat` ramp reserves for fire — found **over
two million** ordered pairs that clear all five checks against `#111C3E`. The
constraint was never tight. What made the old pair fail was the *form* it was
drawn in: the dataviz emphasis form, one saturated accent against a neutral grey.
Grey has no chroma by definition, so that form can never clear a chroma floor. The
waiver was a consequence of choosing emphasis-plus-grey, not of the checks being
hard to satisfy.

The lesson for next time: when a check fails, test whether the *form* is forced
before recording that the *check* is unsatisfiable.

## 5. Why the new pair is deliberately not an emphasis pair

Given a free choice, this palette does **not** use emphasis form, and that is a
claim about the science rather than a style preference.

The uniform grid is not a strawman. It takes the lead over the optimiser at 88
towers on single coverage, and at the shipped budget of 111 it is 1.4 points
*ahead*; the risk-driven placement wins on the two-tower rule, at +3.9 points.
Both columns ship, and this project's stated posture is that they ship because
only one of them improved.

A comparison series that can beat the system it is compared against should not be
drawn as a de-emphasised grey. So the two slots carry equal chroma (0.15 each) and
near-equal visual weight: two peers, ΔE 26.2 apart under normal vision and 16.1
under the worst simulated dichromacy. A reader can tell which line is which, and
nothing in the drawing tells them in advance which one is supposed to win.

## 6. Dark surface only, by design

The site is a deliberately single-surface dark product (`canvas #070E24`,
`surface #111C3E`, over a lit indigo field). There is no light theme to select
steps for, so the validator is run against the dark surface only. This is a
decision, not an omission; if a light surface is ever added, the pair must be
re-stepped and re-validated against it rather than flipped automatically.

## 7. What still has to be true

The waiver is gone, but the obligations it created survive on their own merits and
the charts keep them:

- **Direct labels on both series**, so a reader never has to hold a legend in
  their head to know which line is which.
- **A legend and a table view**, so the numbers are reachable without reading a
  chart at all. `web/tests/chartModel.test.ts` enforces these.

And one that is new, and absolute:

- **`heat` stays out of the series slots.** Ember means fire on this site — that
  is the entire reason it can mean anything at all — so the hue arc it occupies
  was excluded from series selection by construction rather than by remembering
  to avoid it. `web/tests/palette.test.ts` asserts the disjointness, and now also
  asserts that no hex outside `palette.ts` survives a palette change: `index.html`
  and `favicon.svg` both sat on the retired world's colours through this rebuild,
  and the `index.html` one was an opaque full-height `#root` that covered the new
  field entirely while every test passed.
