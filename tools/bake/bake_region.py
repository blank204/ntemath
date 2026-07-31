"""Bake one region's model inputs into static files the web app can fetch.

    python -m tools.bake.bake_region --region los-padres
    python -m tools.bake.bake_region --all
    python -m tools.bake.bake_region --region los-padres --notes-only

The heavy dependencies (GDAL via rasterio, the FIRMS and Open-Meteo feeds)
live here and only here. The browser never sees them -- it receives a risk
raster, a burnable mask, and a resolved placement seed, and runs the same
placement algorithm ``place.py`` runs, on those exact values.
"""

from __future__ import annotations

import argparse
import datetime as dt
import inspect
import json
import os

import numpy as np

from . import lightning
from ._repo_import import repo_modules
from .export_fixtures import _resolve_seed_flat_index
from .regions import REGIONS, layer_for

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.abspath(
    os.path.join(HERE, "..", "..", "web", "public", "data")
)

forest, hazard, plan = repo_modules("forest", "hazard", "plan")
normalise_fwi = plan.normalise_fwi
risk_field = plan.risk_field

#: ESA WorldCover product epoch, read off the tile URL forest.py builds
#: (".../v200/2021/map/...") rather than restated, so it cannot drift.
WORLDCOVER_EPOCH = "2021"
#: Native WorldCover pixel size.
WORLDCOVER_SOURCE_M = 10


def lightning_note(gate: dict) -> str:
    """The provenance text for a lightning-driven region.

    Every number in it is read off the measured gate report rather than
    restated, so a re-measurement cannot leave the prose behind.
    """
    return (
        "NASA LIS/OTD gridded lightning climatology, HRFC v2.3.2015 "
        "(1995-2014), flashes per square kilometre per year. "
        f"NATIVE RESOLUTION IS {gate['nativeDeg']:g} DEGREES -- about 55 km, "
        f"which is {gate['cells']} observed cells across this whole box, not "
        "the 0.1 degrees an earlier draft of the spec claimed. The "
        "0.1-degree product is LIS-only and stops near 38 degrees of "
        "latitude, so it does not exist here; at this latitude even the "
        "combined product is OTD alone (1995-2000). Upsampling to the "
        "land-cover grid is bilinear interpolation, NOT resolution: the "
        "fine structure in the risk field comes from fuel, and anything "
        "that reads like a per-hectare lightning map would be a lie. "
        "THE GRADIENT WAS MEASURED BEFORE BAKING, on observed flash counts "
        f"rather than the interpolated field: {gate['flashes']} flashes over "
        f"{gate['cells']} cells (viewtime uniform to "
        f"{gate['viewtimeSpreadPct']:.1f}%), chi-square {gate['chi2']:.1f} on "
        f"{gate['dof']} degrees of freedom, p = {gate['pUniform']:.1e} "
        "against a uniform rate; the inland half carries "
        f"{gate['eastFlashes']:.0f} flashes to the coastal half's "
        f"{gate['westFlashes']:.0f}, a factor of {gate['eastWestRatio']:.2f} "
        f"(p = {gate['pEastWest']:.1e}, Spearman rho "
        f"{gate['spearmanRho']:.2f} with longitude). The coast-to-inland "
        "gradient is real and it is the reason this box was chosen. "
        "The field is normalised to its own peak within the box, so 1.0 "
        "marks the most-struck ground in THIS region and says nothing about "
        "anywhere else. A cell reading zero was watched and saw no flash in "
        "five years -- it is a low rate, not missing data, and with "
        f"{gate['flashesPerCell']:.1f} flashes per cell on average the "
        "per-cell Poisson error is around 40%. Only the regional gradient "
        "is significant; single cells are not."
    )


def source_notes(name: str, nx: int, ny: int,
                 firms_pad_deg: float | None = None,
                 gate: dict | None = None) -> dict:
    """The provenance block published in meta.json.

    Kept as a pure function of the region geometry so it can be regenerated
    for an already-baked region without re-fetching WorldCover, FIRMS and
    Open-Meteo -- a re-bake rewrites every pixel of risk.bin (the field is
    renormalised to its own peak and the FWI window keys off today()), which
    would silently invalidate every parity figure pinned against the
    committed rasters.
    """
    box = REGIONS[name]
    # read_landcover decimates the native 10 m grid to at most max_px on the
    # long axis, so the shipped cell is a long way from 10 m and saying "10 m"
    # alone overstates the resolution of what the browser actually receives.
    cell_w_m = box.width_km * 1000.0 / max(nx, 1)
    cell_h_m = box.height_km * 1000.0 / max(ny, 1)
    layer = layer_for(name)
    # The third term of the risk formula means opposite things either side
    # of the lightning pivot, so name the one this region actually carries.
    if layer == "lightning":
        if gate is None:
            raise RuntimeError(
                f"{name} is a lightning region, so its source notes must "
                "quote the measured gradient gate -- pass gate=..."
            )
        layer_note = {"lightning": lightning_note(gate)}
        drive_term = "0.35*lightning"
    else:
        if firms_pad_deg is None:
            raise RuntimeError(
                f"{name} is a fire-activity region and needs firms_pad_deg"
            )
        layer_note = {"activity": (
            "NASA FIRMS VIIRS 375 m + MODIS 1 km; RECENCY SIGNAL ONLY - "
            "the open feeds reach back days, not years. firmsCount is "
            f"detections within firmsPadDeg ({firms_pad_deg:g} deg) of "
            "the box, not strictly inside it. It is an UPPER BOUND on what "
            "reaches the model, not the quantity the model integrates: "
            "hazard.activity_field applies the same padded lookup but then "
            "drops every detection below confidence 40, so the Gaussian "
            "kernel integrates over a subset of firmsCount whose size is "
            "not published here. "
            "The resulting activity field is normalised to its own peak "
            "within the box, so activity == 1.0 marks the most-active "
            "pixel in this region, not an absolute detection density."
        )}
        drive_term = "0.35*activity"
    return {
        "landcover": (
            f"ESA WorldCover v200 ({WORLDCOVER_EPOCH} epoch), "
            f"{WORLDCOVER_SOURCE_M} m native, windowed via GDAL /vsicurl. "
            f"forest.read_landcover decimates to at most {max(nx, ny)} px on "
            f"the long axis, so the SHIPPED grid is {nx}x{ny} -- about "
            f"{cell_w_m:.0f} m x {cell_h_m:.0f} m per cell, not 10 m. "
            "Class labels are the native ones; the resolution is not."
        ),
        # Second, where it has always been: the third risk term's provenance,
        # under the key naming the layer this region actually carries.
        **layer_note,
        "weather": (
            "Canadian FWI from ERA5 via Open-Meteo, 180-day p90. "
            "NOT an operational-scale FWI and NOT comparable to the classic "
            "~40 'extreme' threshold: the FWI System expects noon "
            "temperature, humidity and wind, and these values are built from "
            "daily-maximum temperature and daily-minimum relative humidity, "
            "which is common practice for gridded FWI but runs "
            "systematically hotter than the noon-based operational scale. "
            "Measured over 491 forested cells worldwide this basis gives a "
            f"median of 17 and a 99th percentile of 113. fwiNorm is fwiP90 "
            f"clipped to [0,1] against plan.FWI_FULL_SCALE = "
            f"{plan.FWI_FULL_SCALE:g}, a local convention chosen because "
            "normalising at 40 clamped 27% of cells to maximum risk. The "
            "ranking these values give -- which is what siting actually "
            "uses -- is preserved; the absolute level is not."
        ),
        "riskFormula": (
            "flammability(landcover) * (0.20 + 0.45*fwiNorm + "
            f"{drive_term}), then divided by its own maximum so the "
            "field's peak is exactly 1.0 within this region. Risk "
            "values are therefore relative to this region only, NOT "
            "comparable across regions -- a 1.0 here and a 1.0 "
            "elsewhere do not mean the same absolute danger."
        ),
        "notModelled": ["elevation/slope", "camper traffic"],
    }


def bake(name: str, max_px: int = 900,
         fwi_start: str | None = None, fwi_end: str | None = None,
         fwi_value: float | None = None) -> str:
    box = REGIONS[name]
    print(f"[{name}] {box.width_km:.0f} x {box.height_km:.0f} km "
          f"({box.area_km2:,.0f} km2)")

    # read_landcover returns a 3-tuple, not an array: (classes, transform
    # bounds, missing tiles). classes is None when the box is probably all
    # ocean -- WorldCover only publishes land, so that's the one legitimate
    # way this fails, and it needs a clear error rather than an AttributeError
    # three lines later.
    classes, _, missing = forest.read_landcover(box, max_px=max_px)
    if classes is None:
        raise RuntimeError(
            f"no WorldCover data for {name} {box} (missing tiles {missing}) "
            "-- this box is probably entirely ocean"
        )
    mask = forest.burnable_mask(classes)
    print(f"  land cover {classes.shape}, "
          f"forest {100 * forest.forest_fraction(classes):.1f}%"
          + (f", missing tiles {missing}" if missing else ""))

    # NOTE the argument order: box comes FIRST in both of these.
    #
    # detections_in() pads the box by pad_deg (0.25 deg by default) before
    # counting, and activity_field() (which does the same padded lookup
    # internally) is what actually drives the risk field's activity term --
    # so "detections near the box" is the number that matters here, not a
    # strict in-box count. Read the real default off the function rather
    # than hardcoding it, so this stays honest if hazard.py's default ever
    # changes.
    layer = layer_for(name)
    gate = None
    firms_pad_deg = None
    n_local = None
    if layer == "lightning":
        # THE GATE, and it runs before the field is built rather than after,
        # because its whole purpose is to be able to say "this layer is
        # decorative" out loud. It measures observed flash counts in the
        # native cells; the field below is an interpolation of those, and
        # interpolating cannot add significance.
        bbox = (box.west, box.south, box.east, box.north)
        gate = lightning.gradient_report(bbox)
        print(f"  lightning gate: {gate['flashes']} flashes over "
              f"{gate['cells']} cells, chi2 {gate['chi2']:.1f}/"
              f"{gate['dof']} p={gate['pUniform']:.1e}, inland/coast "
              f"{gate['eastWestRatio']:.2f}x p={gate['pEastWest']:.1e} "
              f"-> {gate['verdict'].upper()}")
        if gate["verdict"] == "flat":
            print("  WARNING: no measurable structure -- this layer is "
                  "decorative and the source notes must say so")
        lats, lons, rate = lightning.load_climatology()
        activity32 = lightning.normalise(
            lightning.sample_density(lats, lons, rate, bbox, classes.shape))
        activity = activity32.astype(np.float64)
    else:
        firms_pad_deg = float(
            inspect.signature(hazard.detections_in)
            .parameters["pad_deg"].default
        )
        dets = hazard.fetch_firms()
        local = hazard.detections_in(box, dets)
        n_local = 0 if local is None else len(local)
        # Snap the activity field to float32 BEFORE risk_field consumes it.
        # The browser holds this layer as a Float32Array and recombines risk
        # from those exact bits; computing risk from the float64 original and
        # narrowing only on write would leave the browser starting ~6e-8 away
        # from what Python used, and risk_field divides by the field's own
        # peak, so that error is global rather than local. Same ruling as the
        # risk field itself (Plan 1, Task 6): the reference computes on the
        # values the consumer holds. lightning.normalise above returns
        # float32 for exactly the same reason.
        activity64 = hazard.activity_field(box, dets, classes.shape)
        activity32 = np.ascontiguousarray(activity64, dtype="<f4")
        activity = activity32.astype(np.float64)

    # Same date window plan_region uses: end = today - 7d, start = end - 180d
    # -- unless the caller pins fwi_start/fwi_end/fwi_value, mirroring
    # plan_region's own parameters of the same names so the two stay
    # recognisably the same knob. Without a pin this window is date-dependent
    # (today() moves it), so an un-pinned re-bake -- for ANY reason, including
    # adding an unrelated region -- can silently move every pixel of risk.bin.
    # peak_fwi_for_points takes a LIST OF (lon, lat) POINTS, not a box, and
    # returns an array -- one point (the region centre) is enough at ERA5's
    # ~25 km resolution for boxes this size.
    end = fwi_end or (dt.date.today() - dt.timedelta(days=7)).isoformat()
    start = fwi_start or (
        dt.date.fromisoformat(end) - dt.timedelta(days=180)).isoformat()
    lon0, lat0 = box.centre
    # fwi_value lets a pinned re-bake skip the Open-Meteo fetch entirely --
    # same shortcut plan_region's fwi_value gives a batch run.
    fwi = (float(fwi_value) if fwi_value is not None else
           float(hazard.peak_fwi_for_points([(lon0, lat0)], start, end)[0]))
    fwi_norm = normalise_fwi(fwi)
    if layer == "lightning":
        print(f"  lightning {gate['rateMin']:.2f}..{gate['rateMax']:.2f} "
              f"flashes/km2/yr across {gate['cells']} native cells   "
              f"FWI p90 ({start}..{end}): {fwi:.1f}")
    else:
        print(f"  FIRMS within {firms_pad_deg:g} deg of box: {n_local}   "
              f"FWI p90 ({start}..{end}): {fwi:.1f}")

    risk = risk_field(classes, activity, fwi_norm)

    # risk_field returns the already-normalised field and keeps `peak` to
    # itself, but the browser has to reproduce that division, so recover it by
    # recomputing the pre-normalisation product with the same weights. The
    # assertion is the point: if this arithmetic ever drifts from
    # plan.risk_field's, the bake fails here rather than shipping a raster the
    # browser cannot reproduce.
    _sig = inspect.signature(risk_field).parameters
    W_BASE = float(_sig["w_base"].default)
    W_WEATHER = float(_sig["w_weather"].default)
    W_ACTIVITY = float(_sig["w_activity"].default)
    flam = forest.flammability_field(classes)
    drive = W_BASE + W_WEATHER * float(np.clip(fwi_norm, 0, 1)) + W_ACTIVITY * activity
    unnormalised = flam * drive
    risk_peak = float(unnormalised.max())
    check = unnormalised / risk_peak if risk_peak > 0 else unnormalised
    if not np.array_equal(check, risk):
        raise RuntimeError(
            "the bake's recombination no longer matches plan.risk_field -- "
            "refusing to ship components the browser cannot reproduce"
        )

    # Snap to float32 BEFORE anything else consumes it. risk.bin is float32
    # on disk and the browser's placement algorithm runs on those exact
    # bits. Computing the seed (or any other downstream statistic) on the
    # float64 risk_field() output and only narrowing on write would leave
    # every value ~1.2e-7 off from what the browser reads back, and
    # place.py's radius/position math compounds that drift across the
    # active-list chain -- so every value used from here on is the snapped
    # one, never the float64 original.
    risk32 = np.ascontiguousarray(risk, dtype="<f4")
    mask8 = np.ascontiguousarray(mask.astype(np.uint8))

    # place.variable_poisson_disk seeds its blue-noise sampler by scanning
    # np.argsort(risk, axis=None)[::-1] for the highest-risk allowed pixel.
    # numpy's argsort is unstable quicksort, and on real data ties are the
    # *normal* case: whenever a box has no FIRMS detections above confidence
    # 40, activity is all zeros, risk_field's `drive` term collapses to a
    # scalar, and risk is exactly 1.0 at every tree/shrub pixel -- so the
    # seed pixel argsort lands on is implementation-defined and the browser
    # cannot reproduce it by sorting. Resolve the actual index place.py's
    # loop would land on -- over the float32-snapped array, mask included --
    # with the same helper export_fixtures.py uses, and ship it as data.
    risk64_snapped = risk32.astype(np.float64)
    burn_mask_bool = mask.astype(bool)
    # Count ties over the burnable-masked subset, not the whole grid: the
    # seed loop only ever considers mask-allowed pixels (place.py's `allowed`
    # check), and flammability_field can assign nonzero flammability to a
    # handful of non-burnable classes too, so the grid-wide max isn't
    # necessarily a candidate the seed loop would ever land on. Restricting
    # both the max and the tie count to the masked subset describes the
    # actual candidate population the resolved seed was chosen from.
    burn_risk_values = risk32[burn_mask_bool]
    if burn_risk_values.size:
        masked_max = float(burn_risk_values.max())
        ties_at_max = int(np.count_nonzero(burn_risk_values == masked_max))
    else:
        masked_max = float("nan")
        ties_at_max = 0
    seed_flat_index = _resolve_seed_flat_index(risk64_snapped, burn_mask_bool)
    print(f"  seed flat index {seed_flat_index} "
          f"({ties_at_max} burnable pixel(s) tied at max risk "
          f"{masked_max:.6f})")

    out_dir = os.path.join(OUT_ROOT, name)
    os.makedirs(out_dir, exist_ok=True)

    # Row 0 must be the SOUTH edge, matching place.py's convention -- classes
    # (and therefore risk/mask, which share its shape) already come out of
    # forest.read_landcover in that orientation.
    risk32.tofile(os.path.join(out_dir, "risk.bin"))
    mask8.tofile(os.path.join(out_dir, "mask.bin"))

    # WorldCover codes top out at 100 (moss/lichen), so uint8 is exact. Assert
    # it rather than assume it: a silent wraparound would remap fuel classes.
    if int(classes.max()) > 255 or int(classes.min()) < 0:
        raise RuntimeError(f"class codes out of uint8 range for {name}")
    classes8 = np.ascontiguousarray(classes.astype(np.uint8))
    classes8.tofile(os.path.join(out_dir, "classes.bin"))
    # The layer's filename says what it holds. A lightning region shipping a
    # file called activity.bin would be one rename away from the browser
    # quietly labelling strike density as fire detections.
    layer_file = "lightning.bin" if layer == "lightning" else "activity.bin"
    activity32.tofile(os.path.join(out_dir, layer_file))

    ny, nx = risk32.shape
    meta = {
        "name": name,
        # Which layer drives the third risk term, and the file holding it.
        # The browser reads these rather than assuming, because "where
        # ignition is likely" and "where fire has recently been" are
        # opposite claims wearing the same array shape.
        "layer": layer,
        "layerFile": layer_file,
        "box": [box.west, box.south, box.east, box.north],
        "nx": int(nx), "ny": int(ny),
        "widthKm": float(box.width_km), "heightKm": float(box.height_km),
        "forestFraction": float(forest.forest_fraction(classes)),
        "fwiP90": float(fwi),
        "fwiNorm": float(fwi_norm),
        # The RESOLVED window (actual dates used), not the day-offsets that
        # produced them -- so a later bake can pin this exact window via
        # --fwi-start/--fwi-end (or --pin-window, which reads these two
        # fields plus fwiP90 straight out of this file) and reproduce
        # risk.bin bit-for-bit instead of drifting with today().
        "fwiStart": start,
        "fwiEnd": end,
        # NOTE: padded, not strictly in-box -- see firmsPadDeg and
        # sourceNotes.activity below. activity_field does the same padded
        # lookup, but then filters on conf >= min_conf (hazard.py:138)
        # BEFORE the kernel runs, so this is an UPPER BOUND on what feeds
        # the model, not the quantity the model integrates over.
        **({"firmsCount": int(n_local), "firmsPadDeg": firms_pad_deg}
           if layer != "lightning" else
           # The gate report in full, so the page can quote a measurement
           # instead of a claim, and so a re-bake that moves it is visible.
           {"lightningGate": gate}),
        "classMix": {str(k): float(v)
                     for k, v in forest.class_mix(classes).items()},
        "seedFlatIndex": seed_flat_index,
        "areaKm2": float(box.area_km2),
        "riskPeak": risk_peak,
        "seedTiesAtMax": ties_at_max,
        # Published so the browser never hardcodes a constant the model owns.
        "flammability": {str(int(k)): float(v)
                         for k, v in forest.FLAMMABILITY.items()},
        "burnableClasses": [int(c) for c in forest.BURNABLE],
        "weightDefaults": {"wBase": W_BASE, "wWeather": W_WEATHER,
                           "wActivity": W_ACTIVITY},
        "fwiFullScale": float(plan.FWI_FULL_SCALE),
        "km2PerNode": float(plan.KM2_PER_NODE),
        # plan_region's own budget clamps -- NOT auto_budget's (3, 40) defaults.
        "budgetLo": int(inspect.signature(plan.plan_region)
                        .parameters["budget_lo"].default),
        "budgetHi": int(inspect.signature(plan.plan_region)
                        .parameters["budget_hi"].default),
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sourceNotes": source_notes(name, int(nx), int(ny),
                                    firms_pad_deg, gate),
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)

    print(f"  wrote {out_dir}  ({nx}x{ny})")
    return out_dir


def refresh_notes(name: str) -> str:
    """Rewrite an already-baked meta.json's sourceNotes in place.

    Provenance text is a pure function of geometry (see source_notes), so a
    correction to the wording must not require a full re-bake: re-baking
    refetches live feeds and rewrites every pixel of risk.bin, which would
    invalidate every placement figure pinned against the committed rasters.
    """
    path = os.path.join(OUT_ROOT, name, "meta.json")
    with open(path, encoding="utf-8") as fh:
        meta = json.load(fh)
    # The layer declaration is a pure function of the region table too, so a
    # region baked before it existed gets it here rather than leaving the
    # browser to guess which file holds the third risk term.
    meta["layer"] = layer_for(name)
    meta["layerFile"] = ("lightning.bin" if meta["layer"] == "lightning"
                         else "activity.bin")
    # Read the layer's own provenance back out of the file rather than
    # re-measuring: a notes refresh must not be able to move a number.
    pad = meta.get("firmsPadDeg")
    meta["sourceNotes"] = source_notes(
        name, int(meta["nx"]), int(meta["ny"]),
        None if pad is None else float(pad), meta.get("lightningGate")
    )
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    print(f"refreshed sourceNotes in {path}")
    return path


def write_manifest() -> str:
    """List the regions that actually have baked data on disk.

    The web app must degrade honestly on an unbaked region -- say so in the
    picker rather than fetching a 404 and showing an error. Scanning the
    directory rather than restating a list means the manifest cannot claim a
    region that was never baked.
    """
    baked = sorted(
        name for name in os.listdir(OUT_ROOT)
        if os.path.isfile(os.path.join(OUT_ROOT, name, "meta.json"))
    )
    path = os.path.join(OUT_ROOT, "manifest.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({
            "baked": baked,
            "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        }, fh, indent=1)
    print(f"manifest: {len(baked)} baked region(s) -> {baked}")
    return path


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--region", default="los-padres", choices=sorted(REGIONS))
    p.add_argument("--all", action="store_true", help="bake every region")
    p.add_argument("--max-px", dest="max_px", type=int, default=900)
    p.add_argument(
        "--notes-only", action="store_true",
        help="rewrite sourceNotes in an existing meta.json without re-baking",
    )
    p.add_argument(
        "--fwi-start", dest="fwi_start", default=None,
        help=("pin the FWI window's start date (YYYY-MM-DD) instead of "
              "resolving end-180d, mirroring plan.plan_region's fwi_start"),
    )
    p.add_argument(
        "--fwi-end", dest="fwi_end", default=None,
        help=("pin the FWI window's end date (YYYY-MM-DD) instead of "
              "resolving today()-7d, mirroring plan.plan_region's fwi_end"),
    )
    p.add_argument(
        "--fwi-value", dest="fwi_value", type=float, default=None,
        help=("pin the resolved FWI p90 value directly and skip the "
              "Open-Meteo fetch, mirroring plan.plan_region's fwi_value"),
    )
    p.add_argument(
        "--pin-window", action="store_true",
        help=("reuse the fwiStart/fwiEnd/fwiP90 already recorded in this "
              "region's meta.json instead of resolving a new today()-relative "
              "window, so re-baking for an unrelated reason cannot silently "
              "move risk.bin. Ignored for a region with no existing "
              "meta.json, and overridden by explicit --fwi-start/--fwi-end/"
              "--fwi-value."),
    )
    a = p.parse_args(argv)
    for name in (sorted(REGIONS) if a.all else [a.region]):
        if a.notes_only:
            refresh_notes(name)
            continue
        fwi_start, fwi_end, fwi_value = a.fwi_start, a.fwi_end, a.fwi_value
        if a.pin_window and fwi_start is None and fwi_end is None and fwi_value is None:
            meta_path = os.path.join(OUT_ROOT, name, "meta.json")
            if os.path.isfile(meta_path):
                with open(meta_path, encoding="utf-8") as fh:
                    prev_meta = json.load(fh)
                fwi_start = prev_meta["fwiStart"]
                fwi_end = prev_meta["fwiEnd"]
                fwi_value = prev_meta["fwiP90"]
        bake(name, max_px=a.max_px,
             fwi_start=fwi_start, fwi_end=fwi_end, fwi_value=fwi_value)
    write_manifest()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
