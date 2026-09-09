"""Trains the ML risk model on REAL historical flood data instead of
synthetic data — an attempt at genuinely improving on
`train_ml_model.py`'s synthetic-data model, not just validating the
existing one (see `validate_against_dfo.py` for that).

Uses `app/models/dfo_features.py`'s discharge-percentile approximation
(scaled into the same 0..RIVER_LEVEL_CAP_M range the production model's
real `river_level_m` input already uses) as a stand-in for river level —
see that module's docstring for exactly what this approximates and why.
Because the training feature is scaled into the same range as the real
`river_level_m` input, this model takes a real sensor reading directly at
inference — no percentile computation needed there, unlike the earlier
"this can't be retrained because inference has no history to compute a
percentile from" concern in `docs/progress-log.md`'s 2026-08-29 entry.
That concern was about computing a percentile from a *live* reading, not
about consuming one; this model consumes a plain `river_level_m` number
exactly like the synthetic-trained one does.

**Real class imbalance**: 40,904 usable real (city, date) rows, only 239
of them (0.58%) DFO-confirmed elevated risk. Both candidate classifiers
use `class_weight="balanced"` so the model doesn't just learn to always
predict "low" and call it 99%+ accurate.

**Honest methodology note**: evaluated on a held-out 20% split of this
same real dataset (stratified by risk_level, same `train_test_split`
approach `train_ml_model.py` already uses) — not re-using the full
239-row set `validate_against_dfo.py` reports on, since training on part
of that same data and then "validating" on all of it would be leakage.
The rules-based model and the OLD synthetic-trained model are also scored
on this exact held-out set for a fair three-way comparison — their
41%/28% figures elsewhere were computed on the full 239 rows, not this
smaller held-out slice, so don't expect an exact match to those numbers.

Run it (needs `real_training_data_dfo.csv` to already exist — run
`fetch_real_training_data_dfo.py` first if it doesn't):

    cd backend
    .venv/Scripts/python.exe -m app.models.train_ml_model_real
"""
import pickle
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.dfo_features import build_pseudo_features, load_usable_rows
from app.models.ml_risk_model import predict_ml_risk
from app.models.risk_model import RIVER_LEVEL_CAP_M, compute_risk

MODEL_FILE = Path(__file__).resolve().parent / "ml_risk_model_real.pkl"
RANDOM_SEED = 42
RISK_RANK = {"low": 0, "medium": 1, "high": 2}


def _recall_and_fpr(y_true, y_pred) -> tuple[float, float]:
    """Same metric definitions as validate_against_dfo.py: recall = did
    the model's level meet or exceed the true elevated level; FPR = did
    the model call a truly-"low" day medium/high anyway."""
    elevated = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] > 0]
    low = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] == 0]
    recall = sum(1 for t, p in elevated if RISK_RANK[p] >= RISK_RANK[t]) / len(elevated) if elevated else float("nan")
    fpr = sum(1 for t, p in low if RISK_RANK[p] > 0) / len(low) if low else float("nan")
    return recall, fpr


def main() -> None:
    rows = load_usable_rows()
    features = build_pseudo_features(rows, RIVER_LEVEL_CAP_M)
    X = np.array([[rainfall, level] for rainfall, level, _label in features])
    y = np.array([label for _rainfall, _level, label in features])

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_SEED, stratify=y
    )

    unique, counts = np.unique(y_test, return_counts=True)
    print(f"Training on {len(X_train)} real rows, testing on {len(X_test)} held-out real rows")
    print(f"Held-out test set class counts: {dict(zip(unique, counts))}")
    print()

    candidates = {
        "logistic_regression": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
            ]
        ),
        "random_forest": Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "classifier",
                    RandomForestClassifier(
                        n_estimators=200, class_weight="balanced", random_state=RANDOM_SEED, max_depth=8
                    ),
                ),
            ]
        ),
    }

    results = {}
    for name, pipeline in candidates.items():
        pipeline.fit(X_train, y_train)
        y_pred = pipeline.predict(X_test)
        recall, fpr = _recall_and_fpr(y_test, y_pred)
        acc = pipeline.score(X_test, y_test)
        results[name] = (pipeline, recall, fpr, acc)
        print(f"{name:20s}: held-out accuracy {acc:.1%}, recall on elevated {recall:.1%}, false-positive rate {fpr:.2%}")

    rules_pred = [compute_risk(r, l)[0] for r, l in X_test]
    old_ml_pred = [predict_ml_risk(r, l)[0] for r, l in X_test]
    rules_recall, rules_fpr = _recall_and_fpr(y_test, rules_pred)
    old_ml_recall, old_ml_fpr = _recall_and_fpr(y_test, old_ml_pred)

    print()
    print("For comparison, on this SAME held-out set:")
    print(f"  {'rules_based':20s}: recall {rules_recall:.1%}, false-positive rate {rules_fpr:.2%}")
    print(f"  {'old_ml_synthetic':20s}: recall {old_ml_recall:.1%}, false-positive rate {old_ml_fpr:.2%}")

    best_name = max(results, key=lambda n: results[n][1])
    best_pipeline, best_recall, best_fpr, best_acc = results[best_name]
    print()
    print(f"Best real-data candidate by recall: {best_name} ({best_recall:.1%} recall, {best_fpr:.2%} FPR)")

    with open(MODEL_FILE, "wb") as f:
        pickle.dump(best_pipeline, f)
    print(f"Saved to {MODEL_FILE}")
    print("NOT yet wired into ml_risk_model.py — review these numbers before swapping it in.")


if __name__ == "__main__":
    main()
