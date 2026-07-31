"""The bake-side region table: the repo's regions, plus the ones the pivot
needed.

`plan.REGIONS` is read-only. The repo-root model is the team's shared code
and every pinned placement figure in this project was measured against it, so
regions are added BESIDE it and never into it -- shadowing one of its boxes
would move numbers nobody re-derived.

Each region also declares which layer drives the third term of the risk
formula. That term used to be FIRMS fire detections ("where fire has recently
been") and after the lightning pivot it is strike density ("where ignition is
likely"). The two mean opposite things, and a region that did not say which
one it carried would let the site describe a fire map as a lightning map.
"""

from __future__ import annotations

from ._repo_import import repo_modules

plan, = repo_modules("plan")
BBox = plan.BBox

#: Regions added after the lightning pivot.
#:
#: James Bay coast, Quebec -- about 314 x 244 km, chosen over six
#: alternatives (spec section 3): lightning dominates ignition in the Quebec
#: boreal, LIS/OTD reaches the latitude, nobody is already running an
#: operational lightning-ignition model there, and it is remote enough that
#: "nobody is watching" is credible. The west edge is the shoreline, which
#: is the point: land-water convective contrast is a physical mechanism for
#: real spatial structure in strike density, and lightning.gradient_report
#: is what checks whether that structure actually shows up.
EXTRA = {
    "james-bay": BBox(-80.8, 51.0, -76.2, 53.2),
}

REGIONS = {**plan.REGIONS, **EXTRA}

#: Regions whose risk field's third term is lightning strike density. Every
#: other region keeps the FIRMS activity layer it was baked with.
LIGHTNING_REGIONS = frozenset(EXTRA)


def layer_for(name: str) -> str:
    """Which layer drives `name`'s risk field: lightning or fire-activity."""
    if name not in REGIONS:
        raise KeyError(f"unknown region {name!r}")
    return "lightning" if name in LIGHTNING_REGIONS else "fire-activity"
