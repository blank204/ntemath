"""Hourly wind from the Open-Meteo historical archive, anchored to a fire's
alarm date.

The wind a fire runs under is a property of *when* it ran, not of the day
someone happened to pick.  The earlier code read one hardcoded day in UTC and
collapsed 24 hours into a single vector; for the 2024 Lake Fire that produced
2.1 m/s pointing 146 degrees away from where the fire actually went, because
the sampled day fell three days after the offshore flow that drove the run had
reversed to the onshore sea breeze.  Averaging is what destroyed it: the same
data resolved hourly, anchored to the alarm date, points within 41 degrees.

So this module keeps the hours.  :class:`WindSeries` holds the raw hourly
arrays and hands the simulation whichever hour it has reached, and the longer
the window you average over the worse the answer gets -- for that fire, a
31-day mean lands 163 degrees off, because the daily sea breeze cancels the one
offshore event that mattered.

Everything is worked in the fire's **local** time.  Open-Meteo is asked for a
named timezone rather than UTC so the diurnal cycle lands on the right hours;
mixing California afternoons with UTC midnight is the failure this replaces.

Wind speed source
-----------------
``sustained`` (the default) drives spread from ``wind_speed_10m``.  ``gust``
uses ``wind_gusts_10m``, which is roughly 3x larger and *measured slightly
worse* on the Lake Fire (IoU 0.394 against 0.406): under area-matched scoring
the extra speed cannot help, because the downwind ignition probability has
already saturated at ~0.9998 over a cell's residence time while the upwind
tail still rises.  It is kept as a sensitivity axis, not a default.
``midflame`` applies the conventional 0.4 reduction to sustained wind.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import numpy as np

from domain import Wind

OPEN_METEO = "https://archive-api.open-meteo.com/v1/archive"

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outputs", "realdata")

#: Multiplier applied to sustained 10 m wind for the ``midflame`` source.
MIDFLAME_FACTOR = 0.4

WIND_SOURCES = ("sustained", "gust", "midflame")

#: Hard cap on how many days of hourly wind are fetched for one fire.  Fires
#: burn for months; simulations run for hours, and the tail is dead weight.
MAX_FETCH_DAYS = 45


def _cache(name: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, name)


def fetch_hourly_wind(lonlat, start_date: str, end_date: str,
                      tz: str = "America/Los_Angeles",
                      refresh: bool = False) -> dict:
    """Raw hourly archive response for a point and an inclusive date range.

    Cached per (lat, lon, start, end) rather than per fire, so two fires in the
    same week and place share one download.  ``start_date``/``end_date`` are
    ``YYYY-MM-DD`` in the *local* zone named by ``tz``.
    """
    lon, lat = float(lonlat[0]), float(lonlat[1])
    path = _cache(f"wind_{lat:.4f}_{lon:.4f}_{start_date}_{end_date}.json")

    if refresh or not os.path.exists(path):
        import requests

        params = {
            "latitude": lat,
            "longitude": lon,
            "start_date": start_date,
            "end_date": end_date,
            "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
            "wind_speed_unit": "ms",
            "timezone": tz,
        }
        r = requests.get(OPEN_METEO, params=params, timeout=120)
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"Open-Meteo error: {j.get('reason', j['error'])}")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(j, f)

    with open(path, encoding="utf-8") as f:
        return json.load(f)


def vector_mean_direction(from_deg, weight) -> float:
    """Weighted mean of compass bearings, in degrees FROM.

    Bearings must be averaged as vectors: the arithmetic mean of 350 and 10 is
    180, the exact opposite of the right answer.  Weighting by speed keeps calm
    hours from dragging the mean around, since their direction is both noisy
    and irrelevant to spread.
    """
    d = np.asarray(from_deg, dtype=float)
    w = np.asarray(weight, dtype=float)
    ok = np.isfinite(d) & np.isfinite(w)
    if not ok.any() or w[ok].sum() <= 0:
        return float("nan")
    d, w = d[ok], w[ok]
    r = np.deg2rad(d)
    vx = float((w * np.sin(r)).sum())
    vy = float((w * np.cos(r)).sum())
    return float(np.rad2deg(np.arctan2(vx, vy)) % 360.0)


@dataclass
class WindSeries:
    """Hourly wind over a window, indexed by simulated minutes.

    ``start_index`` is the hour that simulated minute 0 corresponds to, so the
    series can hold a margin either side of the anchor without the simulation
    needing to know.  Requests outside the fetched window clamp to the nearest
    end rather than raising: a run configured longer than the archive window
    should degrade to holding the last known wind, not die.
    """

    times: np.ndarray  # local ISO timestamps, one per hour
    speed_ms: np.ndarray
    gust_ms: np.ndarray
    from_deg: np.ndarray
    utc_offset_s: int = 0
    source: str = "sustained"
    start_index: int = 0
    meta: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.source not in WIND_SOURCES:
            raise ValueError(
                f"wind source {self.source!r} not in {WIND_SOURCES}"
            )
        n = len(self.times)
        if not (len(self.speed_ms) == len(self.gust_ms) == len(self.from_deg) == n):
            raise ValueError("WindSeries arrays have mismatched lengths")
        if n == 0:
            raise ValueError("WindSeries is empty")
        self.start_index = int(np.clip(self.start_index, 0, n - 1))

    # -- speed selection ---------------------------------------------------
    @property
    def drive_speed(self) -> np.ndarray:
        """The hourly speed array the chosen source drives spread from."""
        if self.source == "gust":
            return self.gust_ms
        if self.source == "midflame":
            return self.speed_ms * MIDFLAME_FACTOR
        return self.speed_ms

    @property
    def n_hours(self) -> int:
        return len(self.times)

    # -- indexing ----------------------------------------------------------
    def index_at(self, minutes: float) -> int:
        """Hour index for a simulated time, clamped to the fetched window."""
        i = self.start_index + int(np.floor(float(minutes) / 60.0))
        return int(np.clip(i, 0, self.n_hours - 1))

    def at(self, minutes: float) -> Wind:
        """The wind blowing at a given simulated minute."""
        i = self.index_at(minutes)
        return Wind.from_meteorological(
            float(self.drive_speed[i]), float(self.from_deg[i])
        )

    def time_at(self, minutes: float) -> str:
        return str(self.times[self.index_at(minutes)])

    # -- summaries ---------------------------------------------------------
    def window(self, minutes: float | None = None) -> slice:
        """The hours a run of ``minutes`` actually touches."""
        if minutes is None:
            return slice(self.start_index, self.n_hours)
        return slice(self.start_index, self.index_at(minutes) + 1)

    def mean_wind(self, minutes: float | None = None) -> Wind:
        """Speed-weighted mean over the run window -- the constant-wind arm.

        This is what the old code produced, and it is kept only so the two can
        be compared honestly in the same report.
        """
        sl = self.window(minutes)
        spd = self.drive_speed[sl]
        frm = vector_mean_direction(self.from_deg[sl], spd)
        return Wind.from_meteorological(float(np.nanmean(spd)), frm)

    def summary(self, minutes: float | None = None) -> str:
        sl = self.window(minutes)
        spd = self.drive_speed[sl]
        mw = self.mean_wind(minutes)
        return (
            f"{self.times[sl.start]} -> {self.times[sl.stop - 1]} local "
            f"({len(spd)} h, source={self.source}): "
            f"mean {spd.mean():.1f} m/s, peak {spd.max():.1f} m/s, "
            f"speed-weighted mean direction blowing TOWARD {mw.dir_deg:.0f}deg"
        )


def constant_series(wind: Wind, hours: int = 24, source: str = "sustained") -> WindSeries:
    """A :class:`WindSeries` that never changes -- the regression baseline.

    Used to prove the time-varying path reduces exactly to the constant-wind
    path when the wind happens to be constant.
    """
    frm = (wind.dir_deg + 180.0) % 360.0
    spd = float(wind.speed_ms)
    raw = spd / MIDFLAME_FACTOR if source == "midflame" else spd
    return WindSeries(
        times=np.array([f"h{i:03d}" for i in range(hours)]),
        speed_ms=np.full(hours, raw, dtype=float),
        gust_ms=np.full(hours, raw, dtype=float),
        from_deg=np.full(hours, frm, dtype=float),
        source=source,
    )


def series_from_response(j: dict, source: str = "sustained",
                         start_time: str | None = None) -> WindSeries:
    """Build a :class:`WindSeries` from an Open-Meteo archive response.

    ``start_time`` is a local ISO timestamp (``YYYY-MM-DDTHH:MM``) marking
    simulated minute 0; the nearest hour at or before it is used.  Hours whose
    speed or direction is missing are dropped, so a gap in the archive shortens
    the series rather than injecting NaN into the spread probabilities.
    """
    h = j["hourly"]
    t = np.asarray(h["time"], dtype=object)
    spd = np.asarray(h["wind_speed_10m"], dtype=float)
    drc = np.asarray(h["wind_direction_10m"], dtype=float)
    gst = np.asarray(h.get("wind_gusts_10m", h["wind_speed_10m"]), dtype=float)

    ok = np.isfinite(spd) & np.isfinite(drc)
    if not ok.any():
        raise RuntimeError("Open-Meteo returned no usable wind hours")
    t, spd, drc, gst = t[ok], spd[ok], drc[ok], gst[ok]
    gst = np.where(np.isfinite(gst), gst, spd)

    start_index = 0
    if start_time is not None:
        before = np.flatnonzero(np.asarray([str(x) <= start_time for x in t]))
        start_index = int(before[-1]) if before.size else 0

    return WindSeries(
        times=t,
        speed_ms=spd,
        gust_ms=gst,
        from_deg=drc,
        utc_offset_s=int(j.get("utc_offset_seconds", 0)),
        source=source,
        start_index=start_index,
        meta={
            "timezone": j.get("timezone"),
            "latitude": j.get("latitude"),
            "longitude": j.get("longitude"),
        },
    )


def wind_series_for_fire(lonlat, alarm_date, cont_date=None,
                         source: str = "sustained", start_hour: int = 12,
                         pad_days: int = 1, tz: str = "America/Los_Angeles",
                         refresh: bool = False) -> WindSeries:
    """The hourly wind a fire burned under, anchored to its alarm date.

    FRAP stores ``ALARM_DATE`` as a date with no time of day, so an anchor hour
    has to be chosen.  ``start_hour`` defaults to local noon: midnight is an
    artifact of how the date is stored, and starting there would hand the model
    the calm overnight wind for the run's first hours -- exactly the averaging
    error this module exists to remove, in a smaller form.
    """
    import datetime as _dt

    if source not in WIND_SOURCES:
        raise ValueError(f"wind source {source!r} not in {WIND_SOURCES}")

    start = alarm_date - _dt.timedelta(days=pad_days)
    end = cont_date or (alarm_date + _dt.timedelta(days=7))
    if (end - alarm_date).days > MAX_FETCH_DAYS:
        end = alarm_date + _dt.timedelta(days=MAX_FETCH_DAYS)
    if end < start:
        end = start

    j = fetch_hourly_wind(
        lonlat, start.isoformat(), end.isoformat(), tz=tz, refresh=refresh
    )
    anchor = f"{alarm_date.isoformat()}T{int(start_hour):02d}:00"
    return series_from_response(j, source=source, start_time=anchor)
