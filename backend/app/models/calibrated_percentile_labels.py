"""The actual fix for the label-sparsity problem — after two earlier
attempts that didn't pan out (see the honest record in
`return_period_features.py` and `docs/progress-log.md`'s 2026-09-14
entries): relabel training days using a discharge-percentile threshold
calibrated to best match real DFO-confirmed disasters, instead of
requiring a day to fall inside a DFO event's exact date range.

**Why day-matching broke the model**: DFO's confirmed disaster days sit
at a median of only the *84th* percentile of all-time discharge for
their city — real floods here aren't extreme outliers, they're
moderately elevated conditions that happened to get reported. Requiring
an exact day-match to a rare, sparse disaster catalog (239 days out of
40,904) meant almost every "conditions look genuinely bad" day got
labeled "low" purely because no headline disaster happened that specific
day (confirmed: 49/50 real days combining heavy rain with a >90th-
percentile river reading were labeled "low" for exactly this reason).

**Why annual-maxima return periods (the first fix attempted) also
failed**: benchmarking each day against its own YEAR's single highest
day is a much stricter bar than DFO disasters actually clear — only
10/239 (4.2%) of real confirmed disasters crossed even a 2-year
return-period threshold computed this way. Kept as
`return_period_features.py`, not deleted, as the record of why that
approach doesn't fit this data.

**Why more features (3-day/7-day rainfall accumulation, tested in
`accumulation_features.py`) didn't help either**: cross-validated AUC
stayed flat at ~0.81 regardless of which combination of same-day
rainfall, discharge percentile, and multi-day rainfall accumulation was
used. River discharge already integrates upstream rainfall over the
whole basin better than one city's own point rainfall history can
reconstruct it — the ceiling is real, not a fixable feature gap.

**The actual fix**: instead of an arbitrary percentile cutoff (90th? 95th?
picked by feel), find the cutoff that empirically best separates real
DFO-confirmed days from ordinary days — Youden's J (recall - false
positive rate) swept across every candidate percentile, using DFO's own
day-matching as the (noisy, but genuinely real) ground truth to calibrate
against. This keeps DFO as the source of truth for what "real" means,
while fixing the specific way its sparseness broke training.

Two tiers, each independently calibrated:
- MEDIUM_PERCENTILE_CUTOFF (0.615): best separates "any DFO-confirmed
  day" from ordinary days (Youden's J = 0.495 — 85.4% recall, 35.9% FPR
  against all non-DFO days). This is an honestly real ceiling, not a
  tuning failure — see this module's own validation script.
- HIGH_PERCENTILE_CUTOFF (0.807): best separates DFO's own high-severity
  days from its medium-severity days, computed only among days already
  past the medium cutoff (Youden's J = 0.206 — much weaker separation;
  severity likely depends on exposure/damage factors this dataset
  doesn't capture, not just discharge magnitude).
"""
from app.models.dfo_features import discharge_percentile_by_city, load_usable_rows  # noqa: F401  (re-exported)

MEDIUM_PERCENTILE_CUTOFF = 0.615
HIGH_PERCENTILE_CUTOFF = 0.807


def label_by_calibrated_percentile(rows: list[dict]) -> list[dict]:
    """Returns new row dicts (originals untouched) with `risk_level`
    replaced: "high" at/above HIGH_PERCENTILE_CUTOFF, "medium" at/above
    MEDIUM_PERCENTILE_CUTOFF, "low" otherwise — using each city's own
    discharge-percentile ranking (see `discharge_percentile_by_city`),
    never DFO day-matching."""
    percentiles = discharge_percentile_by_city(rows)
    relabeled = []
    for row in rows:
        pct = percentiles[row["location_name"]][row["date"]]
        if pct >= HIGH_PERCENTILE_CUTOFF:
            level = "high"
        elif pct >= MEDIUM_PERCENTILE_CUTOFF:
            level = "medium"
        else:
            level = "low"
        relabeled.append({**row, "risk_level": level})
    return relabeled
