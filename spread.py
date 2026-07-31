"""An arrival-time transition rule, as an alternative to the Bernoulli one.

Why this exists
---------------
The Bernoulli rule in :mod:`fire` draws against every unburnt neighbour on
every step a cell stays BURNING.  Integrated over a residence time of tau
steps the per-neighbour probability is ``1 - (1 - p)**tau``, and that destroys
the directional signal: measured on the real mesh, a 19x per-step head/back
ratio collapses to 3.6x over the median tau of 31 steps, because downwind
ignition saturates at 0.9998 while the upwind tail keeps climbing to 0.34.
The scar comes out circular whatever the wind does, and raising wind speed
makes it worse rather than better.

The fix is structural, not a retune.  Anisotropy is moved out of a repeated
probability and into a *rate*: each edge accumulates the fraction of itself
the fire has crossed,

    P_ij(t + dt) = P_ij(t) + R_ij * dt / d_ij,     ignite j when P_ij >= 1

with ``R_ij`` the rate of spread along that edge and ``d_ij`` the distance
between the two cell sites.  A head/back *rate* ratio of X stays X no matter
how many steps elapse, because it is carried by arrival time.  There is no
repeated trial left to saturate.  This follows the formulation used for
wildfire spread on an irregular Voronoi mesh in NHESS 25:2909 (2025), which is
the same geometry this project meshes on, and is the same family as Finney's
minimum-travel-time method, Cell2Fire and ELMFIRE's level set.

Directional rate
----------------
``R_ij`` is an ellipse with the ignition point at a focus -- the standard
elliptical form the FBP and FARSITE families use:

    R(theta) = R_head * (1 - e) / (1 - e * cos(theta))

``theta`` is measured from the head direction, so ``cos(theta)`` is exactly the
``e_bear @ wind`` dot product the Bernoulli rule already computes.  At the head
this returns ``R_head``; at the back, ``R_head * (1-e)/(1+e)``.

The eccentricity comes from the length-to-breadth ratio, and L/B comes from
wind speed via Alexander (1985), ``L/B = 1 + 0.00120 * W**2.154`` with W the
10 m open wind in km/h -- chosen over Anderson (1983) because this project
already carries 10 m wind from Open-Meteo, while Anderson's relation is in
midflame wind and would need a wind-adjustment factor invented to use it.  The
two agree to a factor of 0.24, which is a plausible adjustment factor, so
either could be substituted.

What this buys, honestly
------------------------
L/B is now a *prediction from wind speed*, not something the model has to
discover.  At the Lake Fire's applied wind of 4.0 m/s, Alexander gives an
expected L/B of 1.38 -- so 1.38 is the target the scar should be scored
against, not the 2.79 measured on the mapped perimeter.  Reaching 2.79 would
need roughly 8.3 m/s, which sits between that fire's sustained (4.0) and gust
(11.5) wind; the rest is terrain channelling this model still barely feels.

Magnitude versus shape
----------------------
This rule sets the *shape* from published relations and leaves the *magnitude*
(``ros0_m_min``, ``wind_gain``) as the only things needing calibration.  That
separation is the point: the shape is no longer emergent from constants that
were tuned for something else.  Spread is also deterministic here -- there is
no draw -- so replicate spread across seeds comes only from the mesh, which is
a real difference from the Bernoulli rule and is why both are kept.
"""

from __future__ import annotations

import numpy as np

from attributes import BURNING, BURNT, UNBURNT, Attributes
from fire import FireResult, pick_seed_cell
from mesh import Mesh

#: Constants for the arrival-time rule. Shape comes from published relations;
#: only the two magnitude terms are free.
PARAMS_ROS = {
    # Head rate of spread in reference fuel at zero wind, metres per minute.
    # Sized so the front crosses a typical 90-120 m edge in minutes rather than
    # hours: at 4 m/s in shrub this gives a head ROS near 12 m/min, which is
    # within the range reported for chaparral. This is the one magnitude
    # constant that needs calibrating; the *shape* is fixed by published
    # relations and is not free.
    "ros0_m_min": 5.6,
    # Multiplicative head-ROS gain per m/s of wind.
    "wind_gain": 0.42,
    # Reused from the Bernoulli rule so the two see identical terrain.
    "a_slope": 0.078,
    "dt_s": 60.0,
    "t_end_min": None,
    "max_steps": 6000,
    # Guard: L/B is truncated as in FARSITE/ELMFIRE, which cap Anderson at 8.
    "lb_cap": 8.0,
}


# --------------------------------------------------------------------------
# ellipse geometry
# --------------------------------------------------------------------------


def alexander_lb(v_ms: float, cap: float = 8.0) -> float:
    """Length-to-breadth ratio from 10 m open wind speed, Alexander (1985).

    ``L/B = 1 + 0.00120 * W**2.154`` with W in km/h.  Pinned at 1.0 in the
    zero-wind limit, which is the statement that a circular scar is correct
    only when there is no wind.
    """
    w_kmh = max(float(v_ms), 0.0) * 3.6
    return float(min(1.0 + 0.00120 * w_kmh**2.154, cap))


def head_back_ratio(lb: float) -> float:
    """Head/back rate ratio implied by a length-to-breadth ratio."""
    lb = max(float(lb), 1.0)
    if lb <= 1.0:
        return 1.0
    r = np.sqrt(lb * lb - 1.0)
    return float((lb + r) / (lb - r))


def ellipse_eccentricity(lb: float) -> float:
    """Eccentricity of the spread ellipse for a length-to-breadth ratio."""
    lb = max(float(lb), 1.0)
    if lb <= 1.0:
        return 0.0
    return float(np.sqrt(lb * lb - 1.0) / lb)


def directional_ros(attrs: Attributes, wind, params: dict | None = None):
    """Rate of spread along every directed edge, metres per minute.

    Returns ``(R, info)``.  The wind enters twice and differently: it sets the
    head magnitude through ``wind_gain``, and independently sets the *shape*
    through L/B.  Keeping those separate is what allows the magnitude to be
    calibrated without disturbing the anisotropy.
    """
    P = dict(PARAMS_ROS if params is None else params)
    V = float(wind.speed_ms)

    lb = alexander_lb(V, P["lb_cap"])
    eps = ellipse_eccentricity(lb)

    # cos(theta) between the edge bearing and the downwind direction -- the
    # same dot product the Bernoulli rule uses for its wind factor.
    cos_theta = attrs.e_bear @ wind.vector

    r_head = (
        P["ros0_m_min"]
        * (1.0 + P["wind_gain"] * V)
        * attrs.k_veg[attrs.dst]
        * attrs.k_den[attrs.dst]
        * np.exp(P["a_slope"] * attrs.e_slope)
    )
    shape = (1.0 - eps) / np.maximum(1.0 - eps * cos_theta, 1e-9)
    R = r_head * shape

    # Unburnable destinations never take fire, whatever the rate says.
    R = np.where(attrs.k_veg[attrs.dst] > 0.0, R, 0.0)
    return R, {"lb": lb, "eps": eps, "head_back": head_back_ratio(lb)}


# --------------------------------------------------------------------------
# the rule
# --------------------------------------------------------------------------


def simulate_ros(
    mesh: Mesh,
    attrs: Attributes,
    wind,
    d_ref: float = 0.0,
    seed_xy=None,
    seed_cell: int | None = None,
    params: dict | None = None,
    rng: np.random.Generator | None = None,
) -> FireResult:
    """Run the arrival-time rule to extinction (or the step cap).

    ``d_ref`` and ``rng`` are accepted and ignored so this is a drop-in for
    :func:`fire.simulate`; spread here is deterministic.  ``wind`` may be a
    constant :class:`~domain.Wind` or a :class:`~weather.WindSeries`, in which
    case the rate field is rebuilt at each hour boundary.
    """
    P = dict(PARAMS_ROS if params is None else params)
    dt_min = P["dt_s"] / 60.0

    series = wind if hasattr(wind, "at") else None

    n = attrs.n
    state = attrs.state0.copy()
    timer = np.zeros(n, dtype=np.int32)
    arrival = np.full(n, -1, dtype=np.int32)

    if seed_cell is None:
        if seed_xy is None:
            seed_xy = (mesh.width / 2.0, mesh.height / 2.0)
        seed_cell = pick_seed_cell(mesh, attrs, seed_xy)

    state[seed_cell] = BURNING
    arrival[seed_cell] = 0

    src, dst = attrs.src, attrs.dst
    dist = np.maximum(attrs.e_dist, 1e-9)
    area = mesh.cell_area

    # Fraction of each edge the fire has crossed so far.
    crossed = np.zeros(len(src), dtype=float)

    R = None
    cur_hour = -1
    info = {}
    wind_log: list = []
    if series is None:
        R, info = directional_ros(attrs, wind, P)

    burned_hist = [1]
    area_hist = [float(area[seed_cell])]

    step = 0
    hit_cap = False
    step_limit = int(P["max_steps"])
    if P.get("t_end_min") is not None:
        step_limit = min(step_limit, int(round(P["t_end_min"] * 60.0 / P["dt_s"])))

    while True:
        # An edge keeps advancing once its source has *ever* ignited, not only
        # while that source is still flaming. This is the deliberate departure
        # from the Bernoulli rule and it is required, not cosmetic: gating on
        # BURNING makes tau a hard directional cutoff, since any direction
        # whose crossing time exceeds tau can never propagate at all. At 9 m/s
        # the backing direction needs ~1750 min to cross a 98 m edge against a
        # tau of 6, so backing spread would be impossible and the ellipse would
        # be truncated into a wedge. Separating propagation (a rate) from flame
        # duration (tau) is how the elliptical-front models treat it: in
        # FARSITE, MTT and level-set formulations residence time governs
        # intensity and consumption, never whether the front advances.
        started = arrival >= 0
        active = started[src] & (state[dst] == UNBURNT)
        if not active.any():
            break
        if step >= step_limit:
            hit_cap = step >= int(P["max_steps"])
            break
        burning = state == BURNING

        if series is not None:
            minutes = step * dt_min
            h = series.index_at(minutes)
            if h != cur_hour:
                cur_hour = h
                w_now = series.at(minutes)
                R, info = directional_ros(attrs, w_now, P)
                wind_log.append((float(minutes), series.time_at(minutes),
                                 float(w_now.speed_ms), float(w_now.dir_deg)))

        # 1. advance the front along every edge the fire has entered
        crossed[active] += R[active] * dt_min / dist[active]

        # 2. age the cells that were burning at the start of the step
        timer[burning] += 1
        done = burning & (timer >= attrs.tau)
        state[done] = BURNT

        # 3. ignite every cell some edge has now reached
        step += 1
        reached = active & (crossed >= 1.0)
        newly = np.unique(dst[reached]) if reached.any() else np.empty(0, dtype=np.int64)
        newly = newly[state[newly] == UNBURNT] if newly.size else newly
        if newly.size:
            state[newly] = BURNING
            timer[newly] = 0
            arrival[newly] = step

        ever = arrival >= 0
        burned_hist.append(int(ever.sum()))
        area_hist.append(float(area[ever].sum()))

    meta = {
        "rule": "ros",
        "d_ref": d_ref,
        "lb": info.get("lb"),
        "head_back": info.get("head_back"),
    }
    if series is None:
        meta.update(wind_speed=wind.speed_ms, wind_dir=wind.dir_deg)
    else:
        mw = series.mean_wind(step * dt_min)
        meta.update(
            wind_speed=mw.speed_ms, wind_dir=mw.dir_deg, wind_series=True,
            wind_source=series.source, wind_hours=len(wind_log),
            wind_log=wind_log, wind_summary=series.summary(step * dt_min),
            lb=alexander_lb(mw.speed_ms, P["lb_cap"]),
        )

    return FireResult(
        state=state,
        arrival_step=arrival,
        burned_per_step=np.asarray(burned_hist),
        area_per_step=np.asarray(area_hist),
        steps=step,
        dt_s=P["dt_s"],
        seed_cell=int(seed_cell),
        hit_cap=hit_cap,
        meta=meta,
    )
