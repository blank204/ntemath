# Palette validation — the two data series

The Lab's charts carry exactly two series: the Pyra risk-driven placement and the
uniform-grid baseline. This file records what the `dataviz` validator says about
that pair, which checks are waived, why, and what the waiver obliges the charts to
do. It is the record referenced by `web/src/theme/palette.ts` and enforced by
`web/tests/chartModel.test.ts`.

The validator is vendored **byte for byte** at `web/scripts/validate_palette.js`
(sha256 `d662614ff26e80fd0b4e5d1f6b12cb29de5d7fa8b3e1c2dcf4a7ebb988dc4f18`). It is
not edited — a locally adjusted validator validates nothing.

## The command

```bash
cd web && npm run validate:palette
# → node scripts/validate_palette.js "#4DE1C1,#8A9691" --mode dark --surface "#0E1F16"
```

## The output, verbatim

```
Palette (dark, surface #0E1F16, categorical): 2 slots
  [FAIL] Lightness band         outside band: [["#4DE1C1",0.823]]
  [FAIL] Chroma floor           below floor (reads gray): [["#8A9691",0.016]]
  [PASS] CVD separation         worst adjacent #8A9691↔#4DE1C1 ΔE 15.9 (deutan) · tritan 20.9
  [PASS] Normal-vision floor    worst adjacent #8A9691↔#4DE1C1 ΔE 20.0 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1

  → FAILED — fix the marked checks  (CVD in the 6–8 floor band is legal ONLY with secondary encoding: direct labels, gaps, or texture)
  scope: categorical palettes only. For a lone status/text color check WCAG text contrast; for a sequential ramp, lightness monotonicity.
```

`npm run validate:palette` therefore **exits 1**. That is the recorded state, not a
regression, and it is deliberately not wired into CI: this file plus the chart
tests are the gate.

## Decision 1 — the chroma floor does not apply, and is waived

Check 3 exists so that a **categorical identity** hue does not read as grey. This
is not a categorical pair. It is the skill's **emphasis** form: one accent series
carrying the system, one de-emphasis grey carrying the thing it is being compared
against. The baseline reads grey *because* it is the thing being out-argued.

Replacing it with a chromatic hue would put two competing hues on screen, which the
design spec forbids in as many words: *"System versus nothing, never two competing
hues."*

## Decision 2 — the lightness band is waived, because satisfying it collapses the pair

Every teal step inside the dark band `L 0.48–0.67` loses the separation that makes
the two series distinguishable. Regenerated with the vendored validator, each
candidate paired against the baseline `#8A9691` on surface `#0E1F16`:

| teal step | OKLCH L | lightness band | worst CVD ΔE (deutan) | normal-vision ΔE |
|---|---:|---|---:|---:|
| `#4DE1C1` (shipped) | 0.823 | FAIL | **15.9** PASS | **20.0** PASS |
| `#35C4A8` | 0.739 | FAIL | 7.5 WARN | 13.4 FAIL |
| `#28BFA3` | 0.723 | FAIL | 5.9 FAIL | 12.7 FAIL |
| `#2BB39A` | 0.690 | FAIL | 2.6 FAIL | 10.7 FAIL |
| `#22A98F` | in band | **PASS** | 0.4 FAIL | 10.1 FAIL |

The validator prints an OKLCH L only for steps it rejects, so the in-band step's
exact L is not quoted here — all that is measured, and all that matters, is that
it sits inside `0.48–0.67`.

Reproduce any row with:

```bash
cd web && node scripts/validate_palette.js "#22A98F,#8A9691" --mode dark --surface "#0E1F16"
```

The baseline is achromatic, so **lightness difference is what carries the
separation**. The one step that satisfies check 2 (`#22A98F`) drops deutan
separation to ΔE 0.4 — indistinguishable — and fails the normal-vision floor at
10.1, which the skill calls a hard gate that secondary encoding does not excuse.

Keeping `#4DE1C1` is the only option that clears the two checks which decide
whether a reader can tell the series apart at all.

## Decision 3 — dark mode only, by design

The site is a deliberately single-surface dark product (`canvas #060706`,
`surface #0E1F16`). There is no light theme to select steps for, so the validator
is run against the dark surface only. This is a decision, not an omission; if a
light surface is ever added, the pair must be re-stepped and re-validated against
it rather than flipped automatically.

## The obligation this creates

Because checks 2 and 3 are waived, every chart using these two series **must**
carry a legend, direct labels on both series, and a table view.
`web/tests/chartModel.test.ts` enforces all three.
