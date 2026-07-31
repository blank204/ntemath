# The benchmark does not say what we assumed — and this needs a decision

Measured 2026-07-31 on the committed Los Padres data. Reproduced twice, independently.

---

## The result

Both arms capped to the same node count, scored over the same demand points, same region, same detection radius (2.0 km):

| Nodes | Risk-driven placement | Uniform grid | Difference |
|---:|---:|---:|---:|
| 170 | 43.9% | 38.6% | **+5.3 pp** |
| 270 | 64.7% | 62.6% | **+2.2 pp** |
| 400 | 82.5% | 86.8% | **−4.4 pp** |
| 572 *(the shipped default)* | 94.8% | 98.3% | **−3.5 pp** |

**At the default budget, a naive uniform grid covers more than the risk-driven placement.** The crossover sits somewhere between 270 and 400 nodes.

This is not a bug in the port. The TypeScript reproduces `place.py` bit-for-bit; both were measured through the real Python. It is what the algorithm actually does on this region.

---

## Why

**The risk field is almost flat.** Over burnable pixels on Los Padres:

- median **0.576**
- 99th percentile **0.585**
- fraction above 0.80: **0.047%**

Nearly every burnable pixel has essentially the same risk. Follow it through `plan.risk_field`:

```
risk = flammability(landcover) × (w_base + w_weather·fwiNorm + w_activity·activity)
```

- `fwiNorm` is a **scalar** — it cannot vary across space at all.
- `activity` is ~zero everywhere, because Los Padres had **2 FIRMS detections**, both outside the box.
- So `drive` collapses to a constant ≈ 0.475.
- Which leaves `risk ∝ flammability(landcover)` — and `forest.FLAMMABILITY` gives tree cover and shrubland both exactly **1.00**.

After the `/peak` renormalisation, the "risk field" is the land-cover map rescaled. There is almost no spatial signal for the optimiser to exploit.

And once demand is near-uniform, a uniform grid is close to *optimal* for disc coverage. Blue noise's irregularity costs a little overlap. So at high density the naive baseline wins on the only axis being measured.

---

## Why this is not fatal — and is arguably a better story

The result has a clean, defensible reading:

> **Risk-driven placement pays off when hardware is scarce. Once you can afford to blanket the region, geometry beats prioritisation — and we measured where the crossover is.**

That is a more credible claim than "ours always wins", and it is the kind of statement that survives a judging panel poking at it. Every optimisation has a regime where it helps; knowing yours and being able to point at the number is a strength, not a concession.

There is a second, sharper reading available too:

> **The method's advantage scales with how much the risk field actually varies.** On a region with two detections in a seven-day feed, the field is flat and there is nothing to optimise. Give it a real fire season — or a longer activity archive — and the structure returns.

That is a testable prediction, not an excuse. It also points at a concrete improvement rather than a defence.

---

## What this means for the site

The spec's Benchmark A was written as "X% versus Y%, Pyra winning". **That framing is false on this region** and cannot ship.

The honest replacement is to show the **curve, not a single number** — coverage against node count for both arms, with the crossover marked. It is more informative, it is more visually interesting, and it is true. Plan 2 is written against that reframe.

---

## Decisions needed from the team

1. **Which claim do you want to make?** Budget-constrained advantage (defensible, measured, narrower) or something else? This affects the video, the display advertisement and the Phase 3 presentation, not just the website.
2. **Should the default budget change?** Presenting at 572 nodes shows the regime where the method loses. Presenting at ~200 shows where it wins. Either is honest if stated; picking one silently is not.
3. **Is a coverage-maximising target even the right objective?** The method's real argument may be *detection time* rather than *area covered* — a risk-weighted network should see high-risk ignitions sooner even if it covers less ground overall. That is Benchmark B, and this result raises its importance considerably: it may be where the advantage actually lives.

---

## Related upstream issues

See `docs/repo-issues.md`:

- **§1.2** — the same all-zero-activity condition that flattens the risk field also makes `place.py`'s seeding non-deterministic.
- **§1.1** — `auto_budget` returns 18 nodes here, not the 40 the clamp allows: the raw risk-weighted estimate is simply small.
