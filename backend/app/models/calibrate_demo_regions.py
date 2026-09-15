"""Finds new `river_level_m` values for the 10 demo cities in
`app/data/regions.json` that both models can agree on — the actual fix for
the calibration mismatch found in `find_deployable_threshold.py`.

**The problem, restated**: the real-data model learned that "elevated"
river conditions means being near a river's own historical crest (95th+
percentile of 26 years of discharge) — because that's genuinely how rare
real floods are. The demo's `river_level_m` values were picked by hand to
look sane against the simple 50/50 rules-based formula, landing at only
~65-90% of the 0-4m scale even for "high" cities — nowhere near what the
model learned "elevated" actually looks like on that same 0-4m axis.

**The fix**: keep each city's intended label (high/medium/low, matching
`risk_model.py`'s documented 3/4/3 split) and each city's `rainfall_mm_24h`
as-is, but search for a `river_level_m` that lands both models on that
same intended label — grounding the demo's "current sensor reading" in
the model's real, learned scale instead of an arbitrary one.

Run it (needs real_training_data_dfo.csv to already exist):

    cd backend
    .venv/Scripts/python.exe -m app.models.calibrate_demo_regions
"""
import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.dfo_features import discharge_percentile_by_city, load_usable_rows
from app.models.risk_model import RIVER_LEVEL_CAP_M, compute_risk

REGIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "regions.json"
RANDOM_SEED = 42
THRESHOLD = 0.80  # the LOEO-CV-chosen operating point, see evaluate_ml_loeo.py

# The intended label per city, matching risk_model.py's documented
# sanity check (3 high / 4 medium / 3 low) -- this search preserves the
# demo's existing narrative, it doesn't invent a new one.
INTENDED_LEVEL = {
    "Lagos, Nigeria": "high",
    "Kampala, Uganda": "high",
    "Dar es Salaam, Tanzania": "high",
    "Cairo, Egypt": "medium",
    "Accra, Ghana": "medium",
    "Mogadishu, Somalia": "medium",
    "Addis Ababa, Ethiopia": "medium",
    "Nairobi, Kenya": "low",
    "Maputo, Mozambique": "low",
    "Kinshasa, DRC": "low",
}

CANDIDATE_RIVER_LEVELS = np.arange(0.10, 3.96, 0.05)


def _assign_level(p_medium: float, p_high: float, threshold: float) -> str:
    p_elevated = p_medium + p_high
    if p_elevated < threshold:
        return "low"
    return "high" if p_high >= p_medium else "medium"


def main() -> None:
    rows = load_usable_rows()
    percentiles = discharge_percentile_by_city(rows)
    X = np.array(
        [[float(r["rainfall_mm_24h"]), percentiles[r["location_name"]][r["date"]] * RIVER_LEVEL_CAP_M] for r in rows]
    )
    y = np.array([r["risk_level"] for r in rows])

    pipeline = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
        ]
    )
    pipeline.fit(X, y)
    class_index = {name: i for i, name in enumerate(pipeline.classes_)}

    demo_cities = json.loads(REGIONS_FILE.read_text(encoding="utf-8"))

    print(f"{'city':<26s} {'target':>7s} {'old river_m':>12s} {'new river_m':>12s} {'rules':>7s} {'ml':>7s}")
    results = {}
    for city in demo_cities:
        name = city["location_name"]
        target = INTENDED_LEVEL[name]
        rainfall = city["rainfall_mm_24h"]

        found = None
        for river_level in CANDIDATE_RIVER_LEVELS:
            rules_level, _rules_score = compute_risk(rainfall, river_level)
            probas = pipeline.predict_proba([[rainfall, river_level]])[0]
            ml_level = _assign_level(probas[class_index["medium"]], probas[class_index["high"]], THRESHOLD)

            if rules_level == target and ml_level == target:
                found = river_level
                break

        if found is not None:
            results[name] = round(float(found), 2)
            print(f"{name:<26s} {target:>7s} {city['river_level_m']:>12.2f} {found:>12.2f} {target:>7s} {target:>7s}")
        else:
            # No single value satisfies both exactly -- report the closest
            # miss so this is a visible decision point, not a silent gap.
            best = None
            for river_level in CANDIDATE_RIVER_LEVELS:
                rules_level, _ = compute_risk(rainfall, river_level)
                probas = pipeline.predict_proba([[rainfall, river_level]])[0]
                ml_level = _assign_level(probas[class_index["medium"]], probas[class_index["high"]], THRESHOLD)
                if rules_level == target:
                    best = (river_level, rules_level, ml_level)
                    break
            print(f"{name:<26s} {target:>7s} {city['river_level_m']:>12.2f} {'NO MATCH':>12s} " + (f"{best[1]:>7s} {best[2]:>7s}" if best else "?"))

    print()
    if len(results) == len(demo_cities):
        print("All 10 cities: found a river_level_m where rules-based AND the real-data ML model agree on the intended label.")
        print(json.dumps(results, indent=2))
    else:
        print(f"Only {len(results)}/10 cities have a fully agreeing value -- see NO MATCH rows above.")


if __name__ == "__main__":
    main()
