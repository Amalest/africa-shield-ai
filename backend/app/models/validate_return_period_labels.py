"""Sanity-checks the new return-period labels against DFO before trusting
them for anything: do real, human-confirmed disaster days actually cross
the 2-year/5-year return-period thresholds? If they mostly don't, the
new labeling scheme is measuring the wrong thing and shouldn't be used
regardless of how much denser it looks — this is the check that decides
whether `return_period_features.py` is actually usable, not just a
plausible idea.

Run it:

    cd backend
    .venv/Scripts/python.exe -m app.models.validate_return_period_labels
"""
from collections import Counter

from app.models.dfo_features import load_usable_rows
from app.models.return_period_features import label_by_return_period


def main() -> None:
    rows = load_usable_rows()
    dfo_confirmed = [r for r in rows if r["label_source"] == "dfo_event"]
    print(f"Real DFO-confirmed elevated days in the usable dataset: {len(dfo_confirmed)}")
    print(f"DFO-confirmed severity breakdown (original labels): {Counter(r['risk_level'] for r in dfo_confirmed)}")
    print()

    relabeled = label_by_return_period(rows)
    relabeled_by_key = {(r["location_name"], r["date"]): r["risk_level"] for r in relabeled}

    new_labels_for_dfo_days = Counter(relabeled_by_key[(r["location_name"], r["date"])] for r in dfo_confirmed)
    print("What the return-period method calls those SAME real DFO-confirmed days:")
    print(f"  {dict(new_labels_for_dfo_days)}")
    caught = new_labels_for_dfo_days.get("medium", 0) + new_labels_for_dfo_days.get("high", 0)
    print(f"  -> {caught}/{len(dfo_confirmed)} ({caught/len(dfo_confirmed):.1%}) of real confirmed disasters cross a return-period threshold")
    print()

    overall_new = Counter(r["risk_level"] for r in relabeled)
    print(f"Overall label density -- old (DFO-day-matching): {len(dfo_confirmed)}/{len(rows)} ({len(dfo_confirmed)/len(rows):.2%}) elevated")
    elevated_new = overall_new.get("medium", 0) + overall_new.get("high", 0)
    print(f"Overall label density -- new (return-period):    {elevated_new}/{len(rows)} ({elevated_new/len(rows):.2%}) elevated, breakdown {dict(overall_new)}")
    print()

    # The specific failure mode that broke the old model: heavy rainfall
    # + a high river reading being mislabeled "low" purely for lack of a
    # reported disaster. Re-check that exact corner under the new labels.
    from app.models.dfo_features import discharge_percentile_by_city

    percentiles = discharge_percentile_by_city(rows)
    corner = [
        r for r in rows if float(r["rainfall_mm_24h"]) > 50 and percentiles[r["location_name"]][r["date"]] > 0.9
    ]
    corner_new_labels = Counter(relabeled_by_key[(r["location_name"], r["date"])] for r in corner)
    print(f"The exact corner that broke the old model (heavy rain + >90th percentile river, n={len(corner)}):")
    print(f"  old labels:  {Counter(r['risk_level'] for r in corner)}")
    print(f"  new labels:  {dict(corner_new_labels)}")


if __name__ == "__main__":
    main()
