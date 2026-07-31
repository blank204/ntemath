"""Forest-fire sensor node siting: real global data in, sited nodes out.

    from nodenet.plan import REGIONS, plan_region
    plan = plan_region(REGIONS["los-padres"], "los-padres", detect_km=2.0)

The pipeline is region-agnostic -- any lon/lat box on Earth runs the same
code path -- and every layer it reads is keyless open data.
"""

from .geo import BBox  # noqa: F401

__all__ = ["BBox"]
