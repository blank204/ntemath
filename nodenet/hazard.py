"""How likely fire is: observed activity plus fire weather.

Two independent signals, deliberately kept separate so a weak one cannot be
mistaken for a strong one:

**Observed activity** -- NASA FIRMS active-fire detections (VIIRS 375 m and
MODIS 1 km), the keyless global feeds.  These are thermal anomalies actually
seen from orbit, weighted by fire radiative power.  They say where fire *has*
been, which is the best single predictor of where it will be again, but the
open feeds only reach back days, so this is a recency signal and is treated
as one.

**Fire weather** -- the Canadian Forest Fire Weather Index System (Van Wagner
1987) computed from ERA5 reanalysis via Open-Meteo.  This is the operational
danger index used across Canada, Europe and much of the world, and unlike the
detection feed it can be evaluated for any place and any past season.  It
carries the seasonal and climatic part of the answer.

The FWI System is a chain of moisture codes with memory: FFMC (fine fuels,
hours), DMC (loose duff, days), DC (deep duff, months).  They must be run
sequentially over consecutive days -- evaluating one day in isolation gives a
number with no physical meaning, which is the usual way this index is misused.
"""

from __future__ import annotations

import datetime as dt
import io
import math
import os

import numpy as np

from .geo import BBox, haversine_km

FIRMS_FEEDS = {
    "viirs_snpp": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
                  "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_{span}.csv",
    "modis": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
             "modis-c6.1/csv/MODIS_C6_1_Global_{span}.csv",
}

OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"

CACHE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "outputs", "nodenet"
)


def _cache(name: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, name)


# --------------------------------------------------------------------------
# observed fire activity
# --------------------------------------------------------------------------


def fetch_firms(span: str = "7d", feeds=("viirs_snpp", "modis"),
                refresh: bool = False, timeout: float = 180.0):
    """Global active-fire detections. Returns a structured array.

    Cached per (feed, span, day): these feeds are rewritten continuously, so
    keying the cache on the date keeps a run reproducible within a day without
    pinning it to stale data forever.
    """
    import requests

    today = dt.date.today().isoformat()
    rows = []
    for feed in feeds:
        path = _cache(f"firms_{feed}_{span}_{today}.csv")
        if refresh or not os.path.exists(path):
            r = requests.get(FIRMS_FEEDS[feed].format(span=span), timeout=timeout)
            r.raise_for_status()
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(r.text)
        with open(path, encoding="utf-8") as f:
            rows.append(_parse_firms(f.read(), feed))

    keep = [r for r in rows if r is not None and len(r)]
    if not keep:
        return np.empty(0, dtype=[("lon", "f8"), ("lat", "f8"),
                                  ("frp", "f8"), ("conf", "f8")])
    return np.concatenate(keep)


def _parse_firms(text: str, feed: str):
    import csv

    dtype = [("lon", "f8"), ("lat", "f8"), ("frp", "f8"), ("conf", "f8")]
    out = []
    rd = csv.DictReader(io.StringIO(text))
    for row in rd:
        try:
            lon = float(row["longitude"])
            lat = float(row["latitude"])
            frp = float(row.get("frp") or 0.0)
        except (TypeError, ValueError, KeyError):
            continue
        # VIIRS reports confidence as l/n/h, MODIS as 0-100.
        c = str(row.get("confidence", "")).strip()
        conf = {"l": 25.0, "n": 60.0, "h": 90.0}.get(c.lower(), None)
        if conf is None:
            try:
                conf = float(c)
            except ValueError:
                conf = 50.0
        out.append((lon, lat, frp, conf))
    return np.array(out, dtype=dtype) if out else None


def detections_in(box: BBox, dets, pad_deg: float = 0.25):
    """Detections inside a box, padded so fires just outside still count."""
    if dets is None or len(dets) == 0:
        return dets
    m = (
        (dets["lon"] >= box.west - pad_deg) & (dets["lon"] <= box.east + pad_deg)
        & (dets["lat"] >= box.south - pad_deg) & (dets["lat"] <= box.north + pad_deg)
    )
    return dets[m]


def activity_field(box: BBox, dets, shape, sigma_km: float = 8.0,
                   min_conf: float = 40.0) -> np.ndarray:
    """Kernel density of detections over a box, normalised to [0, 1].

    Weighted by fire radiative power, because one 300 MW detection means
    something very different from one 2 MW detection, and by confidence so
    low-confidence thermal anomalies (gas flares, hot roofs) count less.
    """
    field = np.zeros(shape, dtype=float)
    sel = detections_in(box, dets)
    if sel is None or len(sel) == 0:
        return field

    sel = sel[sel["conf"] >= min_conf]
    if len(sel) == 0:
        return field

    ny, nx = shape
    lons = np.linspace(box.west, box.east, nx)
    lats = np.linspace(box.south, box.north, ny)
    glon, glat = np.meshgrid(lons, lats)

    w = np.log1p(np.maximum(sel["frp"], 0.0)) * (sel["conf"] / 100.0)
    for lon, lat, wi in zip(sel["lon"], sel["lat"], w):
        d = haversine_km(lon, lat, glon, glat)
        field += wi * np.exp(-0.5 * (d / sigma_km) ** 2)

    peak = field.max()
    return field / peak if peak > 0 else field


# --------------------------------------------------------------------------
# Canadian Fire Weather Index System (Van Wagner 1987)
# --------------------------------------------------------------------------

#: Day-length factors for DMC (Le) and DC (Lf), northern hemisphere by month.
_LE_NORTH = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0]
_LF_NORTH = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6]


def _day_lengths(month: int, lat: float):
    """Day-length factors, mirrored by six months in the southern hemisphere."""
    i = month - 1
    if lat < 0:
        i = (i + 6) % 12
    return _LE_NORTH[i], _LF_NORTH[i]


def ffmc(temp, rh, wind_kmh, rain, prev=85.0) -> float:
    """Fine Fuel Moisture Code -- surface litter, responds within hours."""
    rh = min(float(rh), 100.0)
    mo = 147.2 * (101.0 - prev) / (59.5 + prev)

    if rain > 0.5:
        rf = rain - 0.5
        if mo > 150.0:
            mo += (42.5 * rf * math.exp(-100.0 / (251.0 - mo))
                   * (1.0 - math.exp(-6.93 / rf))) + \
                  0.0015 * (mo - 150.0) ** 2 * math.sqrt(rf)
        else:
            mo += 42.5 * rf * math.exp(-100.0 / (251.0 - mo)) * \
                  (1.0 - math.exp(-6.93 / rf))
        mo = min(mo, 250.0)

    ed = (0.942 * rh ** 0.679 + 11.0 * math.exp((rh - 100.0) / 10.0)
          + 0.18 * (21.1 - temp) * (1.0 - math.exp(-0.115 * rh)))
    if mo > ed:
        ko = 0.424 * (1.0 - (rh / 100.0) ** 1.7) + \
             0.0694 * math.sqrt(wind_kmh) * (1.0 - (rh / 100.0) ** 8)
        kd = ko * 0.581 * math.exp(0.0365 * temp)
        m = ed + (mo - ed) * 10.0 ** (-kd)
    else:
        ew = (0.618 * rh ** 0.753 + 10.0 * math.exp((rh - 100.0) / 10.0)
              + 0.18 * (21.1 - temp) * (1.0 - math.exp(-0.115 * rh)))
        if mo < ew:
            kl = 0.424 * (1.0 - ((100.0 - rh) / 100.0) ** 1.7) + \
                 0.0694 * math.sqrt(wind_kmh) * (1.0 - ((100.0 - rh) / 100.0) ** 8)
            kw = kl * 0.581 * math.exp(0.0365 * temp)
            m = ew - (ew - mo) * 10.0 ** (-kw)
        else:
            m = mo
    return max(0.0, min(101.0, 59.5 * (250.0 - m) / (147.2 + m)))


def dmc(temp, rh, rain, month, lat, prev=6.0) -> float:
    """Duff Moisture Code -- loosely compacted organic layers, days to weeks."""
    t = max(temp, -1.1)
    p = prev
    if rain > 1.5:
        re = 0.92 * rain - 1.27
        mo = 20.0 + math.exp(5.6348 - prev / 43.43)
        if prev <= 33.0:
            b = 100.0 / (0.5 + 0.3 * prev)
        elif prev <= 65.0:
            b = 14.0 - 1.3 * math.log(prev)
        else:
            b = 6.2 * math.log(prev) - 17.2
        mr = mo + 1000.0 * re / (48.77 + b * re)
        p = max(0.0, 244.72 - 43.43 * math.log(mr - 20.0))
    le, _ = _day_lengths(month, lat)
    k = 1.894 * (t + 1.1) * (100.0 - rh) * le * 1e-6
    return max(0.0, p + 100.0 * k)


def dc(temp, rain, month, lat, prev=15.0) -> float:
    """Drought Code -- deep compact organic matter, seasonal memory."""
    t = max(temp, -2.8)
    p = prev
    if rain > 2.8:
        rd = 0.83 * rain - 1.27
        smi = 800.0 * math.exp(-prev / 400.0)
        p = max(0.0, prev - 400.0 * math.log(1.0 + 3.937 * rd / smi))
    _, lf = _day_lengths(month, lat)
    v = 0.36 * (t + 2.8) + lf
    return max(0.0, p + 0.5 * max(v, 0.0))


def isi(ffmc_val, wind_kmh) -> float:
    """Initial Spread Index -- wind and fine fuel moisture together."""
    m = 147.2 * (101.0 - ffmc_val) / (59.5 + ffmc_val)
    ff = 19.115 * math.exp(-0.1386 * m) * (1.0 + m ** 5.31 / 4.93e7)
    return ff * math.exp(0.05039 * wind_kmh)


def bui(dmc_val, dc_val) -> float:
    """Buildup Index -- total fuel available to the fire.

    Clamped at zero: the second branch can go negative for small DMC, and a
    negative BUI propagates into ``fwi`` as a negative base raised to a
    fractional power, which in Python silently returns a *complex* number
    rather than raising.  That then fails far downstream with a type error
    that says nothing about moisture codes.
    """
    if dmc_val <= 0.0:
        return 0.0
    if dmc_val <= 0.4 * dc_val:
        u = 0.8 * dmc_val * dc_val / max(dmc_val + 0.4 * dc_val, 1e-9)
    else:
        u = dmc_val - (1.0 - 0.8 * dc_val / max(dmc_val + 0.4 * dc_val, 1e-9)) * \
            (0.92 + (0.0114 * dmc_val) ** 1.7)
    return max(0.0, u)


def fwi(isi_val, bui_val) -> float:
    """Fire Weather Index -- the headline number."""
    b_val = max(float(bui_val), 0.0)
    i_val = max(float(isi_val), 0.0)
    if b_val <= 80.0:
        fd = 0.626 * b_val ** 0.809 + 2.0
    else:
        fd = 1000.0 / (25.0 + 108.64 * math.exp(-0.023 * b_val))
    b = 0.1 * i_val * fd
    if b <= 1.0:
        return b
    return math.exp(2.72 * (0.434 * math.log(b)) ** 0.647)


def fwi_series(temp, rh, wind_kmh, rain, dates, lat: float) -> np.ndarray:
    """Run the whole FWI chain over consecutive days.

    The moisture codes carry state, so this must be evaluated as a sequence;
    the first days are effectively spin-up from the standard starting values
    and should not be trusted on their own.
    """
    f, d, c = 85.0, 6.0, 15.0
    out = np.zeros(len(dates), dtype=float)
    for i, day in enumerate(dates):
        t = float(temp[i]); h = float(rh[i])
        w = float(wind_kmh[i]); r = float(rain[i])
        if not all(np.isfinite([t, h, w, r])):
            out[i] = out[i - 1] if i else 0.0
            continue
        month = int(str(day)[5:7])
        f = ffmc(t, h, w, r, f)
        d = dmc(t, h, r, month, lat, d)
        c = dc(t, r, month, lat, c)
        out[i] = fwi(isi(f, w), bui(d, c))
    return out


def fetch_fire_weather(points, start: str, end: str, refresh: bool = False,
                       timeout: float = 180.0) -> list:
    """Daily FWI-driving variables for up to a few hundred points at once.

    Open-Meteo accepts comma-separated coordinates, so a whole region's
    sampling grid costs one request rather than one per point.
    """
    import json

    import requests

    pts = [(round(float(lo), 4), round(float(la), 4)) for lo, la in points]
    key = f"fw_{start}_{end}_{abs(hash(tuple(pts))) % (10**12)}.json"
    path = _cache(key)

    if refresh or not os.path.exists(path):
        params = {
            "latitude": ",".join(str(la) for _, la in pts),
            "longitude": ",".join(str(lo) for lo, _ in pts),
            "start_date": start,
            "end_date": end,
            "daily": ("temperature_2m_max,relative_humidity_2m_min,"
                      "wind_speed_10m_max,precipitation_sum"),
            "wind_speed_unit": "kmh",
            "timezone": "GMT",
        }
        r = requests.get(OPEN_METEO_ARCHIVE, params=params, timeout=timeout)
        r.raise_for_status()
        j = r.json()
        if isinstance(j, dict) and "error" in j:
            raise RuntimeError(f"Open-Meteo error: {j.get('reason', j['error'])}")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(j, f)

    with open(path, encoding="utf-8") as f:
        j = json.load(f)
    return j if isinstance(j, list) else [j]


def peak_fwi_for_points(points, start: str, end: str, refresh: bool = False,
                        percentile: float = 90.0) -> np.ndarray:
    """A high-percentile FWI per point over a window.

    The percentile rather than the mean, because a network is sized for the
    days that matter: a forest with a benign average and a savage fortnight
    every summer needs the density its worst fortnight demands.
    """
    resp = fetch_fire_weather(points, start, end, refresh=refresh)
    out = []
    for k, block in enumerate(resp):
        d = block.get("daily", {})
        dates = d.get("time", [])
        if not dates:
            out.append(0.0)
            continue
        lat = float(block.get("latitude", points[k][1]))
        series = fwi_series(
            d.get("temperature_2m_max", []),
            d.get("relative_humidity_2m_min", []),
            d.get("wind_speed_10m_max", []),
            d.get("precipitation_sum", []),
            dates, lat,
        )
        # Drop the spin-up fortnight before taking the percentile.
        usable = series[14:] if len(series) > 30 else series
        out.append(float(np.percentile(usable, percentile)) if len(usable) else 0.0)
    return np.asarray(out, dtype=float)
