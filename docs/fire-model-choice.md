# Which fire-spread rule — and can Benchmark B discriminate at all?

Plan 3 (`docs/superpowers/plans/2026-07-31-pyra-lab-benchmark-b.md`, Task 2)
set out to choose between this repo's two fire-spread rules by measuring both
on the real Los Padres landscape. The measurement answered a different and more
important question first, so this file records that before the rule choice.

**Status: the plan's Task 2 escalation clause has been triggered. Benchmark B
as specified cannot discriminate between two placements at the node count the
Lab ships. A human decision is required before Task 3 begins.**

## The command

```bash
cd "C:/Pyra NTE"
python -m tools.bake.spread_probe
```

One mesh over the real box (442,372 cells, ~200 s), then five ignitions under
each rule, each scored against three provisional uniform grids at a 2 km
detection radius. The arrival field does not depend on the network, so sweeping
the node count costs a KD-tree query rather than another simulation.

## The measurement

Burnt area after 120 minutes, and detection time in minutes per ignition
(`inf` = never detected inside the window):

| rule | burnt km² (5 ignitions) | s/run |
|---|---|---:|
| `fire.simulate` (Bernoulli) | 27.0, 30.4, 29.2, 30.0, 26.8 | 2.3 |
| `spread.simulate_ros` (ROS) | 0.52, 0.70, 0.67, 0.54, 0.42 | 3.0 |

| rule | nodes requested | nodes placed | detection minutes | censored | P90−P10 |
|---|---:|---:|---|---:|---:|
| Bernoulli | 24 | 20 | inf, 58, inf, inf, inf | 4/5 | 0.0 |
| Bernoulli | 100 | 99 | 0, 60, 14, 19, 0 | 0/5 | **43.6** |
| Bernoulli | 572 | 572 | 0, 0, 0, 0, 0 | 0/5 | **0.0** |
| ROS | 24 | 20 | inf ×5 | 5/5 | n/a |
| ROS | 100 | 99 | 0, inf, 48, inf, 0 | 2/5 | **38.4** |
| ROS | 572 | 572 | 0, 0, 0, 0, 0 | 0/5 | **0.0** |

## The finding, which is not about the spread rule

**At 572 nodes — the count the Lab ships at its default saturation budget —
every ignition is detected at minute zero under both rules.**

The arithmetic is not subtle. 572 nodes each watching a 2 km radius cover
572 × π × 2² ≈ 7,200 km² against a 5,800 km² box. The network is saturated, so
*some* node is always within 2 km of wherever the fire starts, and the ignition
cell's own arrival time is 0. Detection is instantaneous by construction, for
any placement, however good or bad.

So a detection-time benchmark at the shipped budget would report
**"0 minutes versus 0 minutes"** — and it would do so no matter which spread
rule, which placement strategy, or which fire model were underneath. That is a
degenerate metric, not a close result.

The discriminating band is roughly 50–200 nodes. At 100 nodes both rules give a
real spread (43.6 and 38.4 minutes) and the two rules differ in how selective
they are (ROS censors 2 of 5, Bernoulli 0 of 5).

## Applying the plan's decision rule

The rule, fixed before the numbers were seen:

> If one rule produces a detection-time spread (P90 − P10 over the five
> ignitions, using a provisional uniform grid) that is less than 5 minutes,
> that rule cannot support a distribution benchmark and is rejected.
> […] If both are rejected, do not proceed to Task 3.

At the shipped node count both rules produce a spread of exactly 0.0, so **both
are rejected and the plan stops here.** That is the designed outcome and it has
been honoured rather than tuned around.

**A correction to the probe, disclosed.** The probe as the plan specified it
used a single provisional grid of 24 nodes, which produced 4/5 and 5/5
censoring — also a rejection, but for a reason that has nothing to do with fire
behaviour: 20 placed nodes watch 4% of the box. That instrument could not have
told a bad spread rule from a sparse network. The node count was swept rather
than fixed so the two causes could be separated, and both the original 24-node
column and the shipped 572-node column are reported above. This changed the
probe's coverage, not its parameters: `t_end_min`, `d_min` and the detection
radius are exactly as the plan specified.

## What the rule choice would have been

Had the benchmark been viable, the measurement favours `spread.simulate_ros`:

- It is **fully deterministic** — no RNG in the spread path at all — which
  matters to a project whose central published claim is bit-for-bit
  reproducibility.
- It is **more selective**: at 100 nodes it censors 2 of 5 ignitions where
  Bernoulli censors none, so its detections carry more information about where
  the nodes are.
- Its scars are far smaller (0.4–0.7 km² against 27–30 km² in the same two
  hours), which is the difference the team's own
  `docs/repo-issues.md` §3 describes: the Bernoulli rule's directionality is
  diluted and its scars are near-circular, against an observed aspect of 2.79.

This is recorded for whoever picks the question up. It is not a decision to
proceed.

## Two defects in repo-root code found while measuring

Neither is fixed here — repo-root Python is read-only under this plan's
constraints — but both cost real time and belong in `docs/repo-issues.md`:

1. **`fire.PARAMS` and `spread.PARAMS_ROS` are not interchangeable.**
   `fire.PARAMS` carries `p0`/`c1`/`c2`; `spread.PARAMS_ROS` carries
   `ros0_m_min`/`wind_gain`/`lb_cap`. Handing `simulate_ros` the Bernoulli dict
   raises `KeyError: 'lb_cap'` from `spread.py:140`. Only `a_slope`, `dt_s`,
   `max_steps` and `t_end_min` are common.
2. **`calibrate.reference_d_ref()` cannot be called on this machine.** It calls
   `mesh.build_mesh` internally without `clip_guard=False`, and the guard is a
   universal false positive whose only remedy imports `shapely`, which is not
   installed. The probe reproduces its three public building blocks directly
   with the flag set.

## The obligation, if Benchmark B is ever revived

Every detection-time number the site displays must name the spread rule that
produced it, the detection radius, and the node count it was measured at —
because the last of those, as this file shows, can decide the answer on its own.
