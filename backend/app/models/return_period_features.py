"""Return-period-based labeling — the fix for the root problem found in
`docs/progress-log.md`'s 2026-09-14 entry: DFO's labels are too sparse to
train on, because DFO only catalogs headline, internationally-reported
disasters. A day with genuinely severe river conditions but no reported
disaster gets labeled identically to a calm day — 49 of 50 real training
days combining heavy rainfall with a >90th-percentile river reading were
labeled "low" for exactly this reason, and that's what made the model
unreliable in the "obviously severe" corner of input space.

**The fix**: stop asking "did DFO report a disaster on this exact day"
and start asking "did this river's discharge cross a real, objective,
statistically-defined flood threshold" — a *return period*. A T-year
return period is the discharge level exceeded on average once every T
years; it's a standard hydrological concept (the same kind of threshold
GloFAS's own forecasts are built around), computed directly from the
discharge history we already have, with zero dependency on whether any
disaster made a catalog. This can only be denser than DFO's labels, and
it's grounded in the same real 26 years of data, not a new assumption.

**Method**: the Weibull plotting-position formula, not a fitted
parametric distribution (e.g. Gumbel) — with only ~14 usable years per
city (discharge is missing before 1997, see `dfo_features.py`), that's
too few annual maxima to trust a fitted distribution's tail beyond the
observed range, and we only need 2-year and 5-year thresholds, both well
within a 14-year record where the empirical method is on solid ground.
The formula: rank a city's annual maxima largest-to-smallest (rank 1 =
biggest year on record), and its empirical return period is
`(n + 1) / rank`. A discharge threshold for a specific return period is
then a linear interpolation over these (return_period, discharge) pairs.

Feature mapping: rather than the old discharge-percentile-of-all-days
proxy, each day's discharge is expressed as a ratio against that city's
own 5-year threshold (`discharge / threshold_5yr`) — a ratio of 1.0 means
"exactly at the historical 5-year flood level," not an arbitrary
percentile rank. That ratio is then mapped onto the same 0..4m scale
`river_level_m` already uses, so a ratio of 1.0 (the 5-year flood level)
lands at 2.0m and a ratio of 2.0+ (double the 5-year flood level) caps at
4.0m — an explainable, hydrologically-grounded scale instead of "97th
percentile of all days ever recorded."
"""
from collections import defaultdict

from app.models.dfo_features import DATA_FILE, load_usable_rows  # noqa: F401  (re-exported for callers that only need the file path)

RETURN_PERIOD_HIGH_YEARS = 5.0
RETURN_PERIOD_MEDIUM_YEARS = 2.0


def annual_maxima_by_city(rows: list[dict]) -> dict[str, dict[int, float]]:
    """{location_name: {year: max_discharge_that_year}} — one maximum per
    calendar year, the standard unit for return-period analysis (using
    every daily value directly, instead of just the yearly peak, would
    violate the "independent events" assumption most extreme-value
    methods — including this one — rely on)."""
    by_city_year: dict[str, dict[int, float]] = defaultdict(dict)
    for row in rows:
        city = row["location_name"]
        year = int(row["date"][:4])
        discharge = float(row["river_discharge_m3s"])
        by_city_year[city][year] = max(by_city_year[city].get(year, discharge), discharge)
    return dict(by_city_year)


def return_period_thresholds(annual_maxima: dict[int, float], target_years: tuple[float, ...]) -> dict[float, float]:
    """Weibull plotting-position empirical return-period thresholds for
    one city. `annual_maxima` is {year: max_discharge}; returns
    {target_return_period_years: discharge_threshold}. Interpolates
    between the empirical (return_period, discharge) pairs; a
    target_years above the longest empirical return period in the record
    (n+1 years, e.g. ~15 for a 14-year record) is extrapolated using the
    two most extreme points rather than refused outright, since 5 years
    is normally well inside even a short record."""
    values = sorted(annual_maxima.values(), reverse=True)
    n = len(values)
    empirical_return_periods = [(n + 1) / rank for rank in range(1, n + 1)]  # descending, matches `values`' order

    thresholds = {}
    for target in target_years:
        # empirical_return_periods is descending; find the bracket.
        if target >= empirical_return_periods[0]:
            # At or beyond the single longest-observed return period --
            # extrapolate linearly using the two most extreme points.
            (t1, v1), (t2, v2) = zip(empirical_return_periods[:2], values[:2])
            thresholds[target] = _interpolate(target, t1, v1, t2, v2)
            continue
        if target <= empirical_return_periods[-1]:
            (t1, v1), (t2, v2) = zip(empirical_return_periods[-2:], values[-2:])
            thresholds[target] = _interpolate(target, t1, v1, t2, v2)
            continue

        for i in range(n - 1):
            t_hi, t_lo = empirical_return_periods[i], empirical_return_periods[i + 1]
            if t_lo <= target <= t_hi:
                thresholds[target] = _interpolate(target, t_hi, values[i], t_lo, values[i + 1])
                break
    return thresholds


def _interpolate(target: float, t1: float, v1: float, t2: float, v2: float) -> float:
    if t1 == t2:
        return (v1 + v2) / 2
    fraction = (target - t1) / (t2 - t1)
    return v1 + fraction * (v2 - v1)


def label_by_return_period(rows: list[dict]) -> list[dict]:
    """Returns new row dicts (originals untouched) with `risk_level`
    replaced by a return-period-based label: "high" at/above the 5-year
    threshold, "medium" at/above the 2-year threshold, "low" otherwise —
    computed per city, against that city's own discharge history only."""
    maxima_by_city = annual_maxima_by_city(rows)
    thresholds_by_city = {
        city: return_period_thresholds(maxima, (RETURN_PERIOD_MEDIUM_YEARS, RETURN_PERIOD_HIGH_YEARS))
        for city, maxima in maxima_by_city.items()
    }

    relabeled = []
    for row in rows:
        thresholds = thresholds_by_city[row["location_name"]]
        discharge = float(row["river_discharge_m3s"])
        if discharge >= thresholds[RETURN_PERIOD_HIGH_YEARS]:
            level = "high"
        elif discharge >= thresholds[RETURN_PERIOD_MEDIUM_YEARS]:
            level = "medium"
        else:
            level = "low"
        relabeled.append({**row, "risk_level": level})
    return relabeled


def build_return_period_features(rows: list[dict], river_level_cap_m: float) -> list[tuple[float, float, str]]:
    """Returns (rainfall_mm_24h, mapped_river_level_m, risk_level) tuples,
    using the return-period ratio mapping described in this module's
    docstring. `rows` should already be relabeled via
    `label_by_return_period()` — this function reads `risk_level` from
    each row as-is rather than relabeling again, so a caller can inspect/
    validate the labels (e.g. against DFO) before committing to them."""
    maxima_by_city = annual_maxima_by_city(rows)
    thresholds_by_city = {city: return_period_thresholds(maxima, (RETURN_PERIOD_HIGH_YEARS,)) for city, maxima in maxima_by_city.items()}

    result = []
    for row in rows:
        threshold_high = thresholds_by_city[row["location_name"]][RETURN_PERIOD_HIGH_YEARS]
        discharge = float(row["river_discharge_m3s"])
        ratio = discharge / threshold_high if threshold_high > 0 else 0.0
        mapped_river_level = min(ratio, 2.0) * (river_level_cap_m / 2.0)
        result.append((float(row["rainfall_mm_24h"]), mapped_river_level, row["risk_level"]))
    return result
