# nodenet

Forest-fire sensor node siting: real global open data in, sited nodes out.

```python
from nodenet.plan import REGIONS, plan_region
plan = plan_region(REGIONS["los-padres"], "los-padres", detect_km=2.0)
```

```
python -m nodenet --region los-padres
python -m nodenet --bbox -120.3,34.4,-119.4,35.0 --name my-forest
python -m nodenet --cost            # what "every forest on Earth" implies
```

Any lon/lat box on Earth is a valid target. The named regions are a
convenience set spanning different fire regimes, not special cases, and
every layer the pipeline reads is keyless open data.

## Layout

| path | what |
|---|---|
| `nodenet/geo.py` | spherical geometry, tiling, longitude convergence |
| `nodenet/forest.py` | ESA WorldCover, read per footprint over HTTP range requests |
| `nodenet/hazard.py` | Canadian FWI chain (FFMC/DMC/DC/ISI/BUI/FWI) |
| `nodenet/place.py` | variable-density Poisson-disk candidates, greedy minimisation |
| `nodenet/plan.py` | per-region planning |
| `nodenet/world.py` | resumable global sweep |
| `nodenet/build_globe.py` | self-contained globe page |
| `tests/` | 38 tests, no network |

## Global sweep

Complete at 5°×4°: **743** land cells examined, **491** forested, **252**
with no forest, **0** failed, **2,895** nodes. Recording "we checked and
there is nothing there" separately from "we did not look" is the point of
the no-forest count.

Two things make a global run affordable: fire weather is batched (many
coordinates per Open-Meteo request), and forest is read in windows, so no
WorldCover tile is ever downloaded whole. Progress is written after every
cell, so an interrupted run resumes.

## Tests

```
python -m pytest tests -q
```

## Related

The fire-spread model this network is sized against lives in
[ntefire](https://github.com/blank204/ntefire).
