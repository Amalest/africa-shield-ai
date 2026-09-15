"""Multi-day rainfall accumulation — real hydrology says a flood depends
on antecedent conditions (how saturated the ground already is, how full
the river already is), not just today's rainfall in isolation. The
single-day (rainfall, discharge) feature pair used everywhere else in
this project's real-data ML work has a real, measured ceiling: sweeping
every possible discharge-percentile cutoff against real DFO-confirmed
flood days tops out at Youden's J ~= 0.49 (85% recall costs a 36% false-
positive rate) — see `docs/progress-log.md`. That's a signal problem, not
a labeling problem: today's two features don't carry enough information
to cleanly separate real floods from ordinary elevated-flow days.

This adds what same-day readings structurally can't capture: how much
rain fell in the days *leading up to* today. `real_training_data_dfo.csv`
has a fully continuous daily rainfall series per city for all 26 years
(confirmed directly, zero gaps) even though discharge itself is missing
for stretches — so a rolling sum can be computed correctly across the
whole record and then joined onto just the discharge-usable rows.
"""
import csv
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "real_training_data_dfo.csv"

ACCUMULATION_WINDOWS_DAYS = (3, 7)


def rainfall_accumulation_by_city(window_days: int) -> dict[str, dict[str, float]]:
    """{location_name: {date: rolling_sum_of_rainfall_over_the_preceding_window_days_INCLUSIVE}}.
    Computed from the full continuous rainfall series (not the
    discharge-filtered subset), so every date the discharge-usable rows
    care about has a correctly-computed accumulation, including near the
    start of a discharge-coverage gap."""
    with open(DATA_FILE, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    by_city: dict[str, dict[str, float]] = defaultdict(dict)
    for row in rows:
        by_city[row["location_name"]][row["date"]] = float(row["rainfall_mm_24h"])

    result: dict[str, dict[str, float]] = {}
    for city, rainfall_by_date in by_city.items():
        result[city] = {}
        for date_str in rainfall_by_date:
            day = date.fromisoformat(date_str)
            total = 0.0
            missing_any = False
            for offset in range(window_days):
                lookup = (day - timedelta(days=offset)).isoformat()
                if lookup not in rainfall_by_date:
                    missing_any = True
                    break
                total += rainfall_by_date[lookup]
            result[city][date_str] = total if not missing_any else None
    return result
