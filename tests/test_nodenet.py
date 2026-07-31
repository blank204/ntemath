"""Node siting: geometry, the FWI chain, blue noise, and minimisation.

No network. The data layers are exercised by the CLI against live sources;
what is pinned here is the maths that decides where hardware goes, including
the two failures that made the first working version wrong -- a candidate pool
too sparse to cover, and a moisture chain that silently returned complex
numbers.
"""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nodenet.geo import (  # noqa: E402
    BBox,
    haversine_km,
    m_per_deg_lon,
    subdivide,
    tile_name,
)
from nodenet.hazard import bui, dc, dmc, ffmc, fwi, fwi_series, isi  # noqa: E402
from nodenet.place import (  # noqa: E402
    LocalFrame,
    coverage_of,
    demand_points,
    greedy_minimise,
    variable_poisson_disk,
)
from nodenet.plan import normalise_fwi, risk_field  # noqa: E402


# -- geography -------------------------------------------------------------

def test_longitude_shrinks_toward_the_poles():
    """A network sized in km must not get 3x denser in the boreal forest."""
    assert m_per_deg_lon(0) == pytest.approx(111320, rel=1e-3)
    assert m_per_deg_lon(60) == pytest.approx(111320 / 2, rel=1e-2)
    assert m_per_deg_lon(70) < 40_000


def test_tile_names_use_the_south_west_corner():
    assert tile_name(-119.95, 34.77) == "N33W120"
    assert tile_name(0.5, 0.5) == "N00E000"
    assert tile_name(-0.5, -0.5) == "S03W003"


def test_tile_names_floor_onto_the_grid_not_the_value():
    """-119.4 sits in the tile starting at -120, not -119."""
    assert tile_name(-119.4, 34.0) == "N33W120"
    assert tile_name(-120.3, 34.0) == "N33W123"


def test_a_box_spanning_a_seam_reports_both_tiles():
    b = BBox(-120.3, 34.4, -119.4, 35.0)
    assert set(b.tiles()) == {"N33W123", "N33W120"}


def test_degenerate_and_out_of_range_boxes_are_rejected():
    with pytest.raises(ValueError):
        BBox(10, 10, 10, 20)
    with pytest.raises(ValueError):
        BBox(0, -95, 1, 10)


def test_box_dimensions_are_in_kilometres():
    b = BBox(-120.3, 34.4, -119.4, 35.0)
    assert 70 < b.width_km < 95
    assert 60 < b.height_km < 72


def test_subdivide_covers_the_parent_exactly():
    b = BBox(0, 0, 2, 1)
    parts = subdivide(b, max_deg=0.5)
    assert len(parts) == 8
    # Not exact: each sub-box measures its width at its own centre latitude and
    # cos(lat) is nonlinear, so the pieces never sum to the parent precisely.
    assert sum(p.area_km2 for p in parts) == pytest.approx(b.area_km2, rel=1e-3)


def test_haversine_matches_a_known_separation():
    # London to Paris, ~343 km
    assert haversine_km(-0.1276, 51.5072, 2.3522, 48.8566) == pytest.approx(343, abs=6)


# -- the FWI chain ---------------------------------------------------------

def test_moisture_codes_stay_finite_and_real():
    """Regression: BUI could go negative, and fwi() then raised a negative base
    to a fractional power -- which Python answers with a *complex* number
    rather than an error, failing far downstream with a meaningless type."""
    for d in (0.0, 0.5, 3.0, 60.0, 300.0):
        for c in (0.0, 15.0, 400.0, 900.0):
            u = bui(d, c)
            assert isinstance(u, float) and u >= 0.0 and np.isfinite(u)
            f = fwi(isi(85.0, 20.0), u)
            assert isinstance(f, float) and np.isfinite(f) and f >= 0.0


def test_fwi_of_nothing_is_nothing():
    assert fwi(0.0, 0.0) == pytest.approx(0.0)


def test_fwi_rises_with_wind():
    lo = fwi(isi(90.0, 5.0), 60.0)
    hi = fwi(isi(90.0, 40.0), 60.0)
    assert hi > lo * 2


def test_ffmc_is_bounded():
    for t, h, w, r in [(30, 5, 40, 0), (0, 100, 0, 50), (-10, 50, 10, 0)]:
        v = ffmc(t, h, w, r)
        assert 0.0 <= v <= 101.0


def test_rain_dries_nothing_and_wets_everything():
    """Heavy rain must lower the fine fuel code, not raise it."""
    dry = ffmc(25, 30, 15, 0.0, prev=90.0)
    wet = ffmc(25, 30, 15, 20.0, prev=90.0)
    assert wet < dry


def test_drought_code_accumulates_over_a_dry_spell():
    c = 15.0
    for _ in range(30):
        c = dc(30.0, 0.0, 7, 40.0, c)
    assert c > 100.0


def test_duff_code_responds_to_humidity():
    wet = dmc(25.0, 95.0, 0.0, 7, 45.0, 6.0)
    dry = dmc(25.0, 15.0, 0.0, 7, 45.0, 6.0)
    assert dry > wet


def test_the_chain_carries_state_between_days():
    """Evaluating a day in isolation is the usual way this index is misused."""
    n = 60
    dates = [f"2024-07-{(i % 28) + 1:02d}" for i in range(n)]
    hot = fwi_series([32] * n, [15] * n, [25] * n, [0] * n, dates, 40.0)
    wet = fwi_series([32] * n, [15] * n, [25] * n, [8] * n, dates, 40.0)
    assert hot[-1] > hot[5], "a dry spell must build"
    assert hot[-1] > wet[-1] * 2, "rain must suppress"


def test_southern_hemisphere_day_lengths_are_mirrored():
    north = dmc(20.0, 40.0, 0.0, 1, 45.0, 6.0)
    south = dmc(20.0, 40.0, 0.0, 1, -45.0, 6.0)
    assert south > north, "January is summer south of the equator"


def test_non_finite_weather_does_not_poison_the_series():
    dates = [f"2024-07-{i+1:02d}" for i in range(5)]
    s = fwi_series([20, np.nan, 20, 20, 20], [40] * 5, [10] * 5, [0] * 5,
                   dates, 40.0)
    assert np.isfinite(s).all()


# -- risk ------------------------------------------------------------------

def test_flammability_gates_risk_multiplicatively():
    """No fire weather may put a sensor in a lake."""
    classes = np.array([[80, 80], [10, 10]])          # water over tree cover
    r = risk_field(classes, np.zeros((2, 2)), 1.0)
    assert r[0].max() == 0.0
    assert r[1].min() > 0.0


def test_risk_survives_with_no_detections():
    """A one-week feed showing nothing is very weak evidence of safety."""
    classes = np.full((4, 4), 10)
    r = risk_field(classes, np.zeros((4, 4)), 0.9)
    assert r.max() > 0.0


def test_fwi_normalisation_is_clamped():
    assert normalise_fwi(-5) == 0.0
    assert normalise_fwi(1000) == 1.0
    assert 0.0 < normalise_fwi(20) < 0.5


def test_fwi_scale_still_discriminates_at_the_dangerous_end():
    """Regression: normalising at 40 clamped 27% of forested cells worldwide to
    maximum risk, so fire weather stopped ranking exactly the quarter it
    exists to rank. The scale must separate a severe cell from an extreme one."""
    from nodenet.plan import FWI_FULL_SCALE
    assert FWI_FULL_SCALE >= 70
    assert normalise_fwi(45) < normalise_fwi(75) < normalise_fwi(110)


def test_node_budget_responds_to_risk_and_size():
    """Regression: a divisor tuned for 5,500 km2 regions pinned 447 of 491
    cells at the floor, making the budget a constant."""
    from nodenet.plan import auto_budget
    small_safe = auto_budget(600, 0.25)
    big_dangerous = auto_budget(2200, 0.85)
    assert small_safe < big_dangerous
    assert 3 <= small_safe <= 6
    assert 10 <= big_dangerous <= 20


def test_node_budget_is_clamped_at_both_ends():
    from nodenet.plan import auto_budget
    assert auto_budget(0.0, 0.0) == 3
    assert auto_budget(1e9, 1.0) == 40


# -- blue noise ------------------------------------------------------------

@pytest.fixture
def rng():
    return np.random.default_rng(3)


def test_spacing_is_never_violated(rng):
    risk = np.zeros((40, 40))
    pts = variable_poisson_disk(rng, risk, 30.0, 30.0, 2.0, 2.0)
    assert len(pts) > 20
    from scipy.spatial import cKDTree
    d, _ = cKDTree(pts).query(pts, k=2)
    assert d[:, 1].min() >= 2.0 - 1e-9


def test_high_risk_areas_get_denser_nodes(rng):
    """The whole point: spacing must follow the risk field."""
    risk = np.zeros((40, 40))
    risk[:, 20:] = 1.0                      # right half is dangerous
    pts = variable_poisson_disk(rng, risk, 40.0, 40.0, 1.0, 4.0)
    left = (pts[:, 0] < 20).sum()
    right = (pts[:, 0] >= 20).sum()
    assert right > left * 2, f"left {left}, right {right}"


def test_the_mask_is_respected(rng):
    risk = np.ones((40, 40))
    mask = np.zeros((40, 40), dtype=bool)
    mask[:, :20] = True
    pts = variable_poisson_disk(rng, risk, 40.0, 40.0, 1.5, 2.0, mask=mask)
    assert len(pts) > 10
    assert pts[:, 0].max() < 21.0


def test_an_impossible_mask_yields_nothing(rng):
    risk = np.ones((10, 10))
    pts = variable_poisson_disk(rng, risk, 10.0, 10.0, 1.0, 2.0,
                                mask=np.zeros((10, 10), dtype=bool))
    assert len(pts) == 0


def test_bad_radii_are_rejected(rng):
    with pytest.raises(ValueError):
        variable_poisson_disk(rng, np.zeros((4, 4)), 10, 10, 3.0, 1.0)


# -- minimisation ----------------------------------------------------------

def test_greedy_removes_redundant_nodes():
    cand = np.array([[0.0, 0.0], [0.1, 0.0], [0.2, 0.0], [10.0, 0.0]])
    demand = np.array([[0.0, 0.0], [10.0, 0.0]])
    w = np.ones(2)
    cov = greedy_minimise(cand, demand, w, radius_km=1.0, target=1.0)
    assert cov.n == 2, "three co-located candidates should collapse to one"
    assert cov.covered_fraction == pytest.approx(1.0)


def test_greedy_prefers_the_heaviest_demand_first():
    cand = np.array([[0.0, 0.0], [10.0, 0.0]])
    demand = np.array([[0.0, 0.0], [10.0, 0.0]])
    cov = greedy_minimise(cand, demand, np.array([1.0, 9.0]), 1.0, target=0.5)
    assert cov.chosen.tolist() == [1], "should take the high-risk node first"


def test_greedy_stops_at_the_target():
    cand = np.array([[float(i), 0.0] for i in range(20)])
    demand = np.array([[float(i), 0.0] for i in range(20)])
    cov = greedy_minimise(cand, demand, np.ones(20), 0.5, target=0.5)
    assert cov.covered_fraction >= 0.5
    assert cov.n < 20


def test_greedy_matches_brute_force_on_a_small_case():
    """Sanity-check the lazy heap against exhaustive search."""
    import itertools
    rs = np.random.default_rng(0)
    cand = rs.random((8, 2)) * 5
    demand = rs.random((30, 2)) * 5
    w = rs.random(30)
    cov = greedy_minimise(cand, demand, w, 1.2, target=1.01, max_nodes=3)
    best = 0.0
    for combo in itertools.combinations(range(8), 3):
        got, _ = coverage_of(cand[list(combo)], demand, w, 1.2)
        best = max(best, got)
    assert cov.covered_fraction >= (1 - 1 / np.e) * best


def test_empty_inputs_are_handled():
    assert greedy_minimise(np.empty((0, 2)), np.ones((3, 2)), np.ones(3), 1.0).n == 0
    assert greedy_minimise(np.ones((3, 2)), np.empty((0, 2)), np.empty(0), 1.0).n == 0


def test_a_pool_sparser_than_hex_spacing_cannot_cover():
    """Regression: the first working version placed candidates up to 3x the
    detection radius apart and stalled at 59% coverage while removing nothing,
    because a minimiser can only delete nodes -- discs of radius R only tile
    the plane at spacing R*sqrt(3)."""
    rs = np.random.default_rng(1)
    risk = np.zeros((60, 60))
    demand, w = demand_points(np.ones((60, 60)), np.ones((60, 60), bool),
                              40.0, 40.0, stride=2)

    sparse = variable_poisson_disk(rs, risk, 40.0, 40.0, 6.0, 6.0)
    dense = variable_poisson_disk(rs, risk, 40.0, 40.0, 1.6, 1.6)
    r = 2.0
    assert coverage_of(sparse, demand, w, r)[0] < 0.7
    assert coverage_of(dense, demand, w, r)[0] > 0.95


# -- frame -----------------------------------------------------------------

def test_local_frame_round_trips():
    box = BBox(-120.3, 34.4, -119.4, 35.0)
    f = LocalFrame(box)
    lon, lat = -119.8, 34.7
    x, y = f.to_km(lon, lat)
    b_lon, b_lat = f.to_lonlat(x, y)
    assert b_lon == pytest.approx(lon, abs=1e-9)
    assert b_lat == pytest.approx(lat, abs=1e-9)


def test_frame_extent_matches_the_box():
    box = BBox(-120.3, 34.4, -119.4, 35.0)
    w, h = LocalFrame(box).extent_km
    assert w == pytest.approx(box.width_km, rel=1e-6)
    assert h == pytest.approx(box.height_km, rel=1e-6)


def test_demand_points_only_sample_burnable_ground():
    risk = np.ones((20, 20))
    mask = np.zeros((20, 20), dtype=bool)
    mask[:10] = True
    xy, w = demand_points(risk, mask, 10.0, 10.0, stride=2)
    assert len(xy) > 0
    assert xy[:, 1].max() <= 5.5
