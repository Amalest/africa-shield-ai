"""Validates the existing risk model (both the rules-based formula and
the trained ML model) against real historical flood data — built
2026-08-29, using `real_training_data_dfo.csv` (see
`fetch_real_training_data_dfo.py`).

**Why this is validation, not retraining.** The production model takes
`river_level_m` (meters). The only real historical river data available
here is GloFAS river *discharge* in m³/s (via Open-Meteo) — a genuinely
different physical quantity, not directly convertible to meters without
a river-specific rating curve this project doesn't have (see
`fetch_real_training_data.py`'s module docstring, which hit the exact
same wall). Faking that conversion to force real data into the
production model would be worse than not using it. So instead of
retraining, this script asks a narrower, still-genuinely-useful
question: **for each city, using that city's own relative discharge
level (a percentile within its own 1985–2010 range, not an absolute
meters value) as a stand-in for "how high is the river right now,"
would the existing model have flagged real DFO-confirmed flood days as
elevated risk?**

This is a real evaluation against 561 real, independently-sourced
(non-leaked) flood-days across all 10 cities — not a synthetic sanity
check — but it is an approximation (relative discharge percentile
standing in for river_level_m), not a claim that the production model
was tested against real river-level readings. State it exactly that way
if this gets cited anywhere.

Run it (needs `real_training_data_dfo.csv` to already exist — run
`fetch_real_training_data_dfo.py` first):

    cd backend
    .venv/Scripts/python.exe -m app.models.validate_against_dfo
"""

from collections import defaultdict

from app.models.dfo_features import discharge_percentile_by_city, load_usable_rows
from app.models.ml_risk_model import predict_ml_risk
from app.models.risk_model import risk_score_breakdown

RISK_RANK = {"low": 0, "medium": 1, "high": 2}


def main() -> None:
    rows = load_usable_rows()
    percentiles = discharge_percentile_by_city(rows)

    # RIVER_LEVEL_CAP_M-scale stand-in: a discharge percentile of 1.0
    # (this river's historical maximum in the 26-year window) is treated
    # as "river_level_m == RIVER_LEVEL_CAP_M" for evaluation purposes
    # only — see module docstring for why this is an approximation, not
    # a real unit conversion.
    from app.models.risk_model import RIVER_LEVEL_CAP_M

    total_elevated = 0
    caught_rules = 0
    caught_ml = 0
    total_low_confirmed = 0
    false_positive_rules = 0
    false_positive_ml = 0

    per_city_summary: dict[str, dict[str, int]] = defaultdict(lambda: {"elevated": 0, "caught_rules": 0, "caught_ml": 0})

    for row in rows:
        city = row["location_name"]
        rainfall = float(row["rainfall_mm_24h"])
        pct = percentiles[city][row["date"]]
        pseudo_river_level = pct * RIVER_LEVEL_CAP_M

        rules_level = risk_score_breakdown(rainfall, pseudo_river_level)["risk_level"]
        ml_level, _ml_score = predict_ml_risk(rainfall, pseudo_river_level)

        is_dfo_elevated = row["label_source"] == "dfo_event"
        dfo_level = row["risk_level"]

        if is_dfo_elevated:
            total_elevated += 1
            per_city_summary[city]["elevated"] += 1
            # "Caught" = model's predicted level is at least as elevated
            # as what DFO itself recorded for that day (e.g. DFO says
            # "medium", model saying "medium" or "high" both count).
            if RISK_RANK[rules_level] >= RISK_RANK[dfo_level]:
                caught_rules += 1
                per_city_summary[city]["caught_rules"] += 1
            if RISK_RANK[ml_level] >= RISK_RANK[dfo_level]:
                caught_ml += 1
                per_city_summary[city]["caught_ml"] += 1
        else:
            total_low_confirmed += 1
            if rules_level != "low":
                false_positive_rules += 1
            if ml_level != "low":
                false_positive_ml += 1

    print(f"Evaluated {len(rows)} real (city, date) rows from real_training_data_dfo.csv")
    print(f"Real DFO-confirmed elevated-risk days: {total_elevated}")
    print()
    print("Recall on real DFO-confirmed flood days (model's level >= DFO's recorded level):")
    print(f"  Rules-based: {caught_rules}/{total_elevated} ({caught_rules / total_elevated:.1%})")
    print(f"  Trained ML:  {caught_ml}/{total_elevated} ({caught_ml / total_elevated:.1%})")
    print()
    print("False-positive rate on days with NO confirmed DFO event (model said medium/high anyway):")
    print(f"  Rules-based: {false_positive_rules}/{total_low_confirmed} ({false_positive_rules / total_low_confirmed:.2%})")
    print(f"  Trained ML:  {false_positive_ml}/{total_low_confirmed} ({false_positive_ml / total_low_confirmed:.2%})")
    print()
    print("Per-city breakdown (elevated days caught by rules-based model):")
    for city, s in sorted(per_city_summary.items()):
        if s["elevated"] == 0:
            continue
        print(f"  {city}: {s['caught_rules']}/{s['elevated']} rules, {s['caught_ml']}/{s['elevated']} ML")

    print()
    print(
        "Reminder: 'river level' here is a per-city discharge PERCENTILE, "
        "not a real meters reading — see module docstring before citing "
        "this anywhere as if the model was tested against real river-level data."
    )


if __name__ == "__main__":
    main()
