"""Searches for real NASA SWOT satellite river-height measurements near
each of the 10 demo cities in `app/data/regions.json` — the "does a real,
non-proxy river_level_m measurement exist for these rivers at all"
question, before spending any more effort on it.

**Why this exists**: `docs/progress-log.md`'s 2026-09-14 entry found that
the real-data ML model isn't deployable because its training labels
(DFO's disaster catalog) are too sparse to trust, not because of a scale
mismatch. SWOT is a genuinely different kind of real measurement — actual
river water-surface elevation from satellite altimetry, in meters, not a
discharge proxy — and was flagged as the most promising real-data lead.
This script is the first real step: find out which of the 10 demo rivers
SWOT can even see (it only resolves rivers wider than ~100m, and revisits
a given spot roughly every 11-21 days, not daily), before building
anything further on top of it.

**Two phases, split because they have different dependencies**:

1. Search + list what's available (needs only `earthaccess` + a valid
   `EARTHDATA_TOKEN` in `backend/.env` — generate one at
   https://urs.earthdata.nasa.gov, log in, "Generate Token"). Always
   runs if a token is present.
2. Actually extract a water-surface-elevation number from a found
   granule needs `geopandas` (SWOT river data ships as ESRI shapefiles)
   — a heavier geospatial dependency this project doesn't otherwise
   need, so it's not auto-installed. Phase 2 only runs if `geopandas` is
   already importable; otherwise this prints exactly what to install
   and stops there rather than guessing whether you want a new,
   GDAL-dependent package added to the venv this close to a deadline.

Run it:

    cd backend
    .venv/Scripts/python.exe -m app.models.fetch_swot_river_levels
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.config import EARTHDATA_TOKEN

REGIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "regions.json"
DOWNLOAD_DIR = Path(__file__).resolve().parent.parent / "data" / "swot_cache"

# Half-width of the search box around each city, in degrees -- roughly
# 25km, generous enough to catch the nearest river reach without pulling
# in unrelated rivers from a whole country away.
SEARCH_BOX_DEGREES = 0.25

# How far a reach's centroid may be from the target city and still count
# as "the river near this city" rather than a coincidental match at the
# edge of the search box.
MAX_REACH_DISTANCE_DEGREES = 0.35

SHORT_NAME = "SWOT_L2_HR_RiverSP_D"

# SWOT's fill value for missing/invalid measurements is an enormous
# sentinel magnitude (documented as ~3.4e38 or ~-999999999999.0
# depending on product version) -- anything absurdly large in either
# direction is invalid, not a real elevation in meters.
FILL_VALUE_MAGNITUDE = 1e6


def _search_near(earthaccess, latitude: float, longitude: float, candidates: int = 20):
    west, east = longitude - SEARCH_BOX_DEGREES, longitude + SEARCH_BOX_DEGREES
    south, north = latitude - SEARCH_BOX_DEGREES, latitude + SEARCH_BOX_DEGREES
    return earthaccess.search_data(
        short_name=SHORT_NAME,
        bounding_box=(west, south, east, north),
        granule_name="*Reach*",
        count=candidates,
    )


def _granule_start_time(granule) -> datetime:
    range_dt = granule["umm"]["TemporalExtent"]["RangeDateTime"]
    return datetime.fromisoformat(range_dt["BeginningDateTime"].replace("Z", "+00:00"))


def _pass_number(granule) -> str:
    """`SWOT_L2_HR_RiverSP_Reach_491_003_AF_...` -> "003" (the orbital
    pass number). This collection's CMR metadata only gives a coarse
    bounding box spanning the granule's ENTIRE multi-thousand-km
    continental swath (confirmed directly: one granule's box ran from the
    equator to 66N) — it says nothing about whether a river reach exists
    anywhere near a specific city. But two granules sharing the same pass
    number retrace almost the same ground track, so trying one file per
    *distinct* pass number covers meaningfully different ground tracks
    without wasting downloads on near-duplicates of a track already
    tried."""
    return granule["meta"]["native-id"].split("_")[5]


def _distinct_passes(results, limit: int):
    seen_passes = set()
    chosen = []
    for granule in sorted(results, key=_granule_start_time, reverse=True):
        pass_number = _pass_number(granule)
        if pass_number in seen_passes:
            continue
        seen_passes.add(pass_number)
        chosen.append(granule)
        if len(chosen) >= limit:
            break
    return chosen


def main() -> None:
    if not EARTHDATA_TOKEN:
        print(
            "EARTHDATA_TOKEN is not set in backend/.env — nothing to do yet.\n"
            "Generate one at https://urs.earthdata.nasa.gov (log in, then "
            "\"Generate Token\"), then add EARTHDATA_TOKEN=<token> to backend/.env."
        )
        sys.exit(1)

    import earthaccess

    print("Authenticating with NASA Earthdata...")
    auth = earthaccess.login(strategy="environment")
    if not auth.authenticated:
        print("Authentication failed -- check that EARTHDATA_TOKEN in backend/.env is current (tokens expire after 60 days).")
        sys.exit(1)
    print("Authenticated.\n")

    demo_cities = json.loads(REGIONS_FILE.read_text(encoding="utf-8"))

    try:
        import geopandas  # noqa: F401

        have_geopandas = True
    except ImportError:
        have_geopandas = False
        print(
            "Note: geopandas is not installed, so this run will only report which "
            "cities have SWOT coverage at all -- it won't extract an actual water-"
            "surface-elevation number yet. Run `pip install geopandas` first if you "
            "want that (it pulls in GDAL and can be slow/finicky to install on "
            "Windows -- worth doing deliberately, not as a surprise mid-run).\n"
        )

    # Tried per city, in order, until one actually has a nearby reach with
    # a valid reading -- see _distinct_passes()'s docstring for why
    # "most recent" alone isn't a useful ordering here.
    PASSES_TO_TRY = 6

    found_for = []
    extracted = {}
    for city in demo_cities:
        name = city["location_name"]
        results = _search_near(earthaccess, city["latitude"], city["longitude"], candidates=50)
        if not results:
            print(f"{name:<26s} -> no SWOT river-reach granules found nearby (river may be < 100m wide, or outside coverage)")
            continue

        found_for.append(name)
        candidates = _distinct_passes(results, PASSES_TO_TRY)
        print(f"{name:<26s} -> {len(results)} granule(s) across {len(candidates)} distinct pass(es) to check")

        if not have_geopandas:
            continue

        folder = DOWNLOAD_DIR / name.replace(", ", "_").replace(" ", "_")
        best_measurement = None  # (wse_m, distance_deg, river_name, when)
        for granule in candidates:
            files = earthaccess.download([granule], str(folder))
            measurement = _extract_water_surface_elevation(files[0], city["latitude"], city["longitude"])
            if measurement is None:
                continue
            wse_m, distance_deg, river_name = measurement
            when = _granule_start_time(granule).date()
            if best_measurement is None or distance_deg < best_measurement[1]:
                best_measurement = (wse_m, distance_deg, river_name, when)
            if distance_deg <= MAX_REACH_DISTANCE_DEGREES:
                break  # close enough -- no need to keep downloading more passes

        if best_measurement is None:
            print(f"  no valid reading found near this city across {len(candidates)} passes tried")
        else:
            wse_m, distance_deg, river_name, when = best_measurement
            quality = "within range" if distance_deg <= MAX_REACH_DISTANCE_DEGREES else "FAR from city, treat as unreliable"
            print(f"  closest real SWOT reading ({quality}): {wse_m:.2f}m, river={river_name or 'unnamed'}, ~{distance_deg*111:.0f}km away, from {when}")
            extracted[name] = {
                "wse_m": round(wse_m, 2),
                "date": str(when),
                "river_name": river_name,
                "distance_km": round(distance_deg * 111, 1),
                "regions_json_river_level_m": city["river_level_m"],
            }

    print()
    print(f"SWOT coverage found for {len(found_for)}/{len(demo_cities)} demo cities: {found_for}")
    if not have_geopandas:
        print("Install geopandas and re-run to extract real water-surface-elevation values from the downloaded shapefiles.")
    elif extracted:
        print(f"\nReal water-surface-elevation extracted for {len(extracted)}/{len(found_for)} cities:")
        print(f"{'city':<26s} {'real WSE (m)':>13s} {'regions.json river_m':>22s} {'km away':>9s} {'date':>12s}  river")
        for name, m in extracted.items():
            flag = "" if m["distance_km"] <= MAX_REACH_DISTANCE_DEGREES * 111 else "  <- FAR, unreliable"
            print(f"{name:<26s} {m['wse_m']:>13.2f} {m['regions_json_river_level_m']:>22} {m['distance_km']:>9.1f} {m['date']:>12s}  {m['river_name'] or ''}{flag}")


def _extract_water_surface_elevation(shapefile_path: str, latitude: float, longitude: float):
    """Opens a downloaded SWOT reach shapefile (usually zipped) and
    returns `(wse_meters, distance_degrees, river_name)` for whichever
    reach with a real (non-fill-value) reading is closest to the target
    point — regardless of how close that actually is. The caller decides
    what counts as "close enough to trust" (see `MAX_REACH_DISTANCE_DEGREES`
    and how `main()` uses it); this function just reports the truth about
    what's in the file. Returns `None` only if the file has zero reaches
    with any valid reading at all."""
    import geopandas
    from shapely.geometry import Point

    path = shapefile_path if str(shapefile_path).startswith("zip://") else f"zip://{shapefile_path}"
    try:
        gdf = geopandas.read_file(path)
    except Exception as exc:
        print(f"  could not read {shapefile_path}: {exc}")
        return None

    wse_column = next((c for c in gdf.columns if c.lower() == "wse"), None)
    if wse_column is None:
        print(f"  no 'wse' column in this file -- columns present: {list(gdf.columns)}")
        return None
    name_column = next((c for c in gdf.columns if c.lower() in ("river_name", "riv_name", "name")), None)

    target = Point(longitude, latitude)
    gdf["_distance"] = gdf.geometry.distance(target)
    gdf = gdf[gdf[wse_column].abs() < FILL_VALUE_MAGNITUDE]
    if gdf.empty:
        return None

    nearest = gdf.loc[gdf["_distance"].idxmin()]
    river_name = str(nearest[name_column]) if name_column else None
    return float(nearest[wse_column]), float(nearest["_distance"]), river_name


if __name__ == "__main__":
    main()
