"""Shared real-data feature engineering for the Dartmouth Flood
Observatory (DFO) dataset — used by both `validate_against_dfo.py`
(evaluation) and `train_ml_model_real.py` (training), so both use the
exact same discharge-percentile approximation instead of two copies
drifting apart over time.

See `fetch_real_training_data_dfo.py`'s module docstring for where
`real_training_data_dfo.csv` comes from and its honest limitations
(GloFAS discharge is a genuinely different physical quantity from the
production model's `river_level_m`; the archive stops in 2010; Maputo
and Mogadishu have zero discharge coverage at all).
"""
import bisect
import csv
from collections import defaultdict
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "real_training_data_dfo.csv"


def load_usable_rows() -> list[dict]:
    """Real (city, date) rows with a non-missing GloFAS discharge value.
    Drops ~57% of rows — Maputo/Mogadishu are 100% missing, and the other
    8 cities are missing 1985-1996 — not a bug, Open-Meteo's GloFAS-backed
    API genuinely returns null for these (location, date) pairs."""
    with open(DATA_FILE, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [r for r in rows if r["river_discharge_m3s"] != ""]


def discharge_percentile_by_city(rows: list[dict]) -> dict[str, dict[str, float]]:
    """{location_name: {date: percentile_0_to_1}} — each city's discharge
    values ranked against that same city's own observed range only.
    Never compared across cities/rivers, since discharge scale varies
    enormously by river size and isn't the point; only "was this day
    unusually high for this particular river" is."""
    by_city: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for row in rows:
        by_city[row["location_name"]].append((row["date"], float(row["river_discharge_m3s"])))

    result: dict[str, dict[str, float]] = {}
    for city, entries in by_city.items():
        values = sorted(v for _, v in entries)
        n = len(values)

        def percentile_of(value: float, values=values, n=n) -> float:
            # simple rank-based percentile; ties broken by position, fine
            # for this purpose
            return bisect.bisect_left(values, value) / n

        result[city] = {date: percentile_of(v) for date, v in entries}
    return result


def build_pseudo_features(rows: list[dict], river_level_cap_m: float) -> list[tuple[float, float, str]]:
    """Returns (rainfall_mm_24h, pseudo_river_level_m, risk_level) tuples.
    The discharge percentile is scaled into the same 0..river_level_cap_m
    range the production model's real `river_level_m` input already
    uses — so a model trained on this feature takes a real sensor's
    `river_level_m` directly at inference, no percentile computation
    needed there. This is still an approximation (percentile-of-discharge
    standing in for actual river depth in meters), not a real unit
    conversion — state it that way wherever these numbers get cited."""
    percentiles = discharge_percentile_by_city(rows)
    result = []
    for row in rows:
        city = row["location_name"]
        pct = percentiles[city][row["date"]]
        pseudo_river_level = pct * river_level_cap_m
        result.append((float(row["rainfall_mm_24h"]), pseudo_river_level, row["risk_level"]))
    return result
