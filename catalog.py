"""Fire selection: search CAL FIRE FRAP by year and name, and pick one.

The study fire used to be a hardcoded ``FIRE_NAME='LAKE' AND YEAR_=2024``
clause.  This module turns that into a query so any FRAP-mapped California
fire can be run, and adds the fuel-vintage rule that generalising the year
forces: LANDFIRE ships discrete vintages, and which one is correct depends on
when the fire burned.

Listing is deliberately split from loading.  A year of FRAP perimeters is a
large download, but the *attributes* are small, so searches run with
``returnGeometry=false`` and geometry is fetched only for the fire actually
chosen.
"""

from __future__ import annotations

import datetime as dt
import os
import sys

from dataclasses import dataclass, field

import numpy as np

FRAP_URL = (
    "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/"
    "California_Historic_Fire_Perimeters/FeatureServer/0/query"
)

CRS_UTM11N = "EPSG:32611"

#: LANDFIRE CONUS FBFM40 vintages that actually exist on the LFPS service.
#: Enumerated from the service directory, not assumed -- note the absence of
#: 2020, which the terrain layer does have.  Anything between 2017 and 2022
#: therefore falls back to LF2016.
FBFM40_VINTAGES = (2016, 2022, 2023, 2024, 2025)

#: Reported origins for fires where one is known, in (lon, lat).  FRAP maps
#: perimeters, not ignition points, so without an entry here the origin has to
#: fall back to the perimeter centroid -- which makes any "which way did it
#: spread" metric meaningless, since the answer is baked in as zero.
KNOWN_ORIGINS = {
    ("LAKE", 2024): (-119.9556, 34.7767),  # Zaca Lake
}


def _epoch_ms_to_date(v) -> dt.date | None:
    """FRAP date fields are epoch milliseconds, date-only at midnight UTC."""
    if v is None:
        return None
    try:
        return dt.datetime.fromtimestamp(float(v) / 1000.0, dt.timezone.utc).date()
    except (TypeError, ValueError, OSError, OverflowError):
        return None


@dataclass
class FireRecord:
    """One FRAP perimeter's attributes, without its geometry."""

    name: str
    year: int
    acres: float
    alarm: dt.date | None = None
    cont: dt.date | None = None
    props: dict = field(default_factory=dict)

    @property
    def label(self) -> str:
        return f"{self.name} {self.year}"

    @property
    def slug(self) -> str:
        return f"{self.name.lower().replace(' ', '_')}_{self.year}"

    @property
    def origin_lonlat(self):
        return KNOWN_ORIGINS.get((self.name.upper(), int(self.year)))

    @property
    def duration_days(self) -> int | None:
        if self.alarm and self.cont:
            return (self.cont - self.alarm).days
        return None

    def __str__(self) -> str:
        # ASCII only: this goes to the console, and the default Windows code
        # page (cp1252) cannot encode arrows or em dashes.
        a = self.alarm.isoformat() if self.alarm else "?"
        c = self.cont.isoformat() if self.cont else "?"
        return f"{self.name} {self.year} - {self.acres:,.0f} acres, {a} to {c}"


def fbfm_service_for_year(year: int) -> tuple[str, int, str]:
    """Newest FBFM40 vintage strictly *before* a fire year.

    Strictly before, because a vintage from the fire's own year or later has
    already absorbed the burn scar as changed fuel -- that is the landscape
    after the event, not the one it burned through.  Returns
    ``(service_path, vintage, warning)``; ``warning`` is empty when the vintage
    is close enough to trust.
    """
    year = int(year)
    earlier = [v for v in FBFM40_VINTAGES if v < year]

    if not earlier:
        oldest = min(FBFM40_VINTAGES)
        return (
            f"Landfire_LF{oldest}/LF{oldest}_FBFM40_CONUS",
            oldest,
            f"fire year {year} predates every LANDFIRE FBFM40 vintage "
            f"(earliest is {oldest}); using LF{oldest}, which describes fuel "
            f"{oldest - year} year(s) AFTER this fire. Fuel is not "
            f"contemporaneous and results should be read as indicative only.",
        )

    v = max(earlier)
    gap = year - v
    warn = ""
    if gap > 2:
        warn = (
            f"nearest usable fuel vintage is LF{v}, {gap} years before the "
            f"fire (no LANDFIRE FBFM40 exists for {v + 1}-{year - 1}); "
            f"vegetation may have changed materially in between."
        )
    return f"Landfire_LF{v}/LF{v}_FBFM40_CONUS", v, warn


def search_fires(year: int, name: str | None = None, min_acres: float = 0.0,
                 limit: int = 25, timeout: float = 120.0) -> list[FireRecord]:
    """FRAP fires for a year, largest first. Attributes only, no geometry."""
    import requests

    where = f"YEAR_={int(year)}"
    if name:
        where += f" AND FIRE_NAME='{name.upper().replace(chr(39), chr(39) * 2)}'"
    if min_acres > 0:
        where += f" AND GIS_ACRES>={float(min_acres)}"

    params = {
        "where": where,
        "outFields": "FIRE_NAME,YEAR_,GIS_ACRES,ALARM_DATE,CONT_DATE",
        "returnGeometry": "false",
        "orderByFields": "GIS_ACRES DESC",
        "resultRecordCount": int(limit),
        "f": "json",
    }
    r = requests.get(FRAP_URL, params=params, timeout=timeout)
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(f"FRAP service error: {j['error']}")

    out = []
    for feat in j.get("features", []):
        a = feat.get("attributes", {})
        nm = a.get("FIRE_NAME")
        if not nm:
            continue
        out.append(
            FireRecord(
                name=str(nm).strip(),
                year=int(a.get("YEAR_") or year),
                acres=float(a.get("GIS_ACRES") or 0.0),
                alarm=_epoch_ms_to_date(a.get("ALARM_DATE")),
                cont=_epoch_ms_to_date(a.get("CONT_DATE")),
                props=a,
            )
        )
    out.sort(key=lambda f: f.acres, reverse=True)
    return out


def format_table(records: list[FireRecord]) -> str:
    """Numbered listing, wide enough to tell same-named fires apart."""
    if not records:
        return "  (no matches)"
    lines = [f"  {'#':>2}  {'NAME':<24} {'ACRES':>10}  {'ALARM':<10}  {'CONTAINED':<10}  {'DAYS':>4}"]
    for i, r in enumerate(records, 1):
        a = r.alarm.isoformat() if r.alarm else "?"
        c = r.cont.isoformat() if r.cont else "?"
        d = r.duration_days
        lines.append(
            f"  {i:>2}  {r.name[:24]:<24} {r.acres:>10,.0f}  {a:<10}  {c:<10}  "
            f"{('-' if d is None else d):>4}"
        )
    return "\n".join(lines)


def _interactive() -> bool:
    """Only prompt when there is a human on the other end."""
    if os.environ.get("FIREMESH_NO_PROMPT"):
        return False
    try:
        return sys.stdin.isatty()
    except (AttributeError, ValueError):
        return False


def _ask(prompt: str, default: str = "") -> str:
    try:
        got = input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        return default
    return got or default


def choose_fire(year: int | None = None, name: str | None = None,
                min_acres: float = 0.0, interactive: bool | None = None,
                verbose: bool = True) -> FireRecord:
    """Resolve a fire, prompting only for what was not supplied.

    Fully specified and unambiguous -> returns immediately, so scripted runs
    and sweeps never block.  Ambiguous with no terminal -> takes the largest
    match and says so, rather than hanging a batch job on an input() call.
    """
    if interactive is None:
        interactive = _interactive()

    if year is None:
        if not interactive:
            raise ValueError("no --year given and no terminal to ask on")
        this_year = dt.date.today().year
        year = int(_ask(f"Year [{this_year}]: ", str(this_year)))

    if name is None and interactive:
        name = _ask("Fire name (blank = list the largest that year): ") or None

    records = search_fires(year, name, min_acres=min_acres)

    if not records and name:
        if verbose:
            print(f"\nNo FRAP fire named {name!r} in {year}. Largest that year:")
        records = search_fires(year, None, min_acres=min_acres)
        name = None
        if records and verbose:
            print(format_table(records[:10]))
        if not interactive and records:
            raise ValueError(
                f"no fire named {name!r} in {year}; rerun with one of the names above"
            )

    if not records:
        raise RuntimeError(f"FRAP has no mapped fires for {year}")

    if len(records) == 1:
        if verbose:
            print(f"\nSelected: {records[0]}")
        return records[0]

    if not interactive:
        if verbose:
            print(f"\n{len(records)} matches; taking the largest: {records[0]}")
        return records[0]

    print(f"\n{len(records)} match{'es' if len(records) > 1 else ''} in {year}:")
    print(format_table(records))
    while True:
        got = _ask(f"\nSelect [1-{len(records)}, default 1]: ", "1")
        try:
            i = int(got)
        except ValueError:
            print("  enter a number")
            continue
        if 1 <= i <= len(records):
            chosen = records[i - 1]
            print(f"Selected: {chosen}")
            return chosen
        print(f"  out of range (1-{len(records)})")


def utm_epsg_for_lon(lon: float) -> int:
    """The northern-hemisphere UTM zone a longitude belongs in.

    California straddles two zones: 10N west of 120°W (the north coast, the Bay
    Area, Sonoma) and 11N east of it (the Sierra, the south, Santa Barbara).
    The earlier code hardcoded 11N, which was right for the one fire it could
    load and would have silently distorted every perimeter on the other side of
    the line once fires became selectable.
    """
    zone = int((float(lon) + 180.0) // 6.0) + 1
    zone = int(np.clip(zone, 1, 60))
    return 32600 + zone


def fetch_geometry(record: FireRecord, refresh: bool = False,
                   cache_dir: str | None = None, prefer_lon: float | None = None):
    """The chosen fire's perimeter, projected into its own UTM zone.

    Fetched in WGS84 and reprojected locally, because the correct zone is not
    known until the geometry's longitude is: asking the server to project would
    require guessing first.  Returns ``(geom, props, epsg)``.

    Matched on name, year and acreage so that same-named fires in one year --
    2024 had three called LAKE -- cannot be confused for one another.
    """
    import json

    import geopandas as gpd

    cache_dir = cache_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "outputs", "realdata"
    )
    os.makedirs(cache_dir, exist_ok=True)
    # The filename carries the CRS: an earlier cache held UTM coordinates in a
    # file that declared none, and reading those as degrees would be silent.
    path = os.path.join(cache_dir, f"{record.slug}_perimeter_wgs84.geojson")

    if refresh or not os.path.exists(path):
        import requests

        nm = record.name.replace("'", "''")
        params = {
            "where": f"FIRE_NAME='{nm}' AND YEAR_={int(record.year)}",
            "outFields": "FIRE_NAME,YEAR_,GIS_ACRES,ALARM_DATE,CONT_DATE",
            "outSR": "4326",
            "f": "geojson",
        }
        r = requests.get(FRAP_URL, params=params, timeout=300)
        r.raise_for_status()
        gj = r.json()
        if "error" in gj:
            raise RuntimeError(f"FRAP service error: {gj['error']}")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(gj, f)

    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    gdf = gdf.to_crs("EPSG:4326")

    # Pick the row whose acreage matches the chosen record, not simply the
    # largest: the caller may deliberately have selected a smaller namesake.
    gdf = gdf.assign(_da=(gdf["GIS_ACRES"].astype(float) - record.acres).abs())
    gdf = gdf.sort_values("_da")

    # Zone comes from the reported origin when there is one, and otherwise from
    # the *main* polygon's centroid. Origin first because a fire can straddle a
    # zone boundary -- the 2024 Lake Fire's scar extends far enough west of
    # Zaca Lake that its burn centroid falls in zone 10 while the fire started
    # in zone 11 -- and where it started is the more stable anchor.
    #
    # Two rejected alternatives for the fallback: the bounding-box midpoint,
    # which a single far-western outlier among that fire's 80 polygons drags
    # across the line; and the full multipolygon centroid, which geopandas
    # rightly warns about when taken in degrees. Shapely on one polygon is
    # neither approximate nor noisy.
    if prefer_lon is not None:
        epsg = utm_epsg_for_lon(prefer_lon)
    else:
        geom0 = gdf.iloc[0].geometry
        main = (max(geom0.geoms, key=lambda g: g.area)
                if geom0.geom_type == "MultiPolygon" else geom0)
        epsg = utm_epsg_for_lon(main.centroid.x)
    row = gdf.to_crs(epsg=epsg).iloc[0]
    return row.geometry, dict(row.drop(["geometry", "_da"])), epsg
