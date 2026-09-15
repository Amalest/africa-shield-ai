"""Trains the ML "second opinion" flood risk model and saves it to
ml_risk_model.pkl. Run this file directly to (re)train:

    cd backend
    .venv/Scripts/python.exe -m app.models.train_ml_model    (Windows)
    .venv/bin/python -m app.models.train_ml_model             (macOS/Linux)

**Trained on real historical data, as of 2026-09-14** — this replaces an
earlier version trained on synthetic data (see git history if you want
that version back). Getting here took three real attempts, documented
honestly in `docs/progress-log.md`'s 2026-09-14 entries because each one
taught something that mattered:

1. First real-data attempt: labeled a day "elevated" only if it fell
   inside a DFO-documented disaster's exact date range. This trains on
   real data, but DFO only catalogs headline, internationally-reported
   disasters — 49 of 50 real days combining heavy rainfall with a
   >90th-percentile river reading were labeled "low" purely because no
   reported disaster happened that specific day. The resulting model
   learned a genuinely backwards relationship (more rainfall predicting
   *lower* risk) exactly in the "obviously severe" corner of input
   space — unusable, caught before shipping.
2. Tried annual-maxima return periods next (`return_period_features.py`,
   kept as the record of why this didn't fit): benchmarking each day
   against its own year's single highest day turned out far stricter
   than what DFO's real disasters actually reach — only 4.2% of them
   crossed even a 2-year threshold computed this way.
3. **What actually worked**: relabel using a discharge-percentile cutoff
   calibrated to best match real DFO-confirmed days (Youden's J, not a
   guessed round number) instead of requiring an exact date match — see
   `calibrated_percentile_labels.py` for the full reasoning and the
   validated ceiling (this feature pair tops out around Youden's J~=0.49
   against real disasters; multi-day rainfall accumulation was tested
   and didn't move that ceiling — river discharge already integrates
   upstream rainfall better than a city's own point rainfall history
   can). Cross-validated honestly via leave-one-event-out CV with the
   threshold itself recalibrated inside every fold
   (`evaluate_calibrated_loeo.py`), this real-data model reaches ~76%
   recall against real confirmed disasters vs. the rules-based formula's
   41% — genuinely better at catching real floods, at a real, disclosed
   cost: ~36% false-positive rate vs. rules-based's 22%. **This is a
   recall/FPR trade, not a free win on both axes** — say so plainly
   whenever these numbers are cited.

Why logistic regression: it's a simple, well-understood classifier — the
whole model is just a learned linear boundary (after standardizing the
two inputs) between low/medium/high, which is easy to describe to a judge
in one sentence, unlike a deep net or an ensemble of trees.
"""

import pickle
from pathlib import Path

from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.calibrated_percentile_labels import HIGH_PERCENTILE_CUTOFF, MEDIUM_PERCENTILE_CUTOFF, label_by_calibrated_percentile
from app.models.dfo_features import discharge_percentile_by_city, load_usable_rows
from app.models.risk_model import RIVER_LEVEL_CAP_M

MODEL_FILE = Path(__file__).resolve().parent / "ml_risk_model.pkl"
RANDOM_SEED = 42


def build_training_data():
    """Real (rainfall, pseudo_river_level, risk_level) rows: 40,904 real
    (city, day) observations across 8 cities with usable GloFAS discharge
    history (1997-2010; Maputo and Mogadishu have zero discharge coverage
    and aren't represented here), relabeled via
    `calibrated_percentile_labels.label_by_calibrated_percentile()`
    instead of DFO day-matching. See this module's docstring for why."""
    rows = load_usable_rows()
    relabeled = label_by_calibrated_percentile(rows)
    percentiles = discharge_percentile_by_city(rows)

    X, y = [], []
    for row in relabeled:
        pct = percentiles[row["location_name"]][row["date"]]
        X.append([float(row["rainfall_mm_24h"]), pct * RIVER_LEVEL_CAP_M])
        y.append(row["risk_level"])
    return X, y


def train_and_save() -> None:
    X, y = build_training_data()

    pipeline = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
        ]
    )
    pipeline.fit(X, y)

    print(f"Trained on {len(X)} real (rainfall, river-discharge-percentile) observations.")
    print(f"Calibrated label cutoffs: medium >= {MEDIUM_PERCENTILE_CUTOFF} percentile, high >= {HIGH_PERCENTILE_CUTOFF} percentile.")
    print("Expected real-world performance (leave-one-event-out CV against real DFO disasters, see evaluate_calibrated_loeo.py):")
    print("  ~76% recall vs. rules-based's 41%, at ~36% false-positive rate vs. rules-based's 22% -- a real trade-off, not a free win.")

    with open(MODEL_FILE, "wb") as f:
        pickle.dump(pipeline, f)
    print(f"Saved model to {MODEL_FILE}")


if __name__ == "__main__":
    train_and_save()
