"""Inference for the ML "second opinion" flood risk model.

Loads the pipeline trained by train_ml_model.py (a StandardScaler +
LogisticRegression pipeline, saved to ml_risk_model.pkl) once at import
time, so the server doesn't retrain on every request or every restart.

This runs ALONGSIDE risk_model.py's rules-based compute_risk(), not
instead of it — see docs/architecture.md for why the team kept both.
The rules-based score stays the primary, explainable one; this is a
comparison/second opinion. As of 2026-09-14, trained on real historical
data (see train_ml_model.py's docstring for the full story, including
two earlier real-data attempts that didn't work and why) — genuinely
better at catching real confirmed disasters than the rules-based formula
(~76% recall vs. 41%, leave-one-event-out cross-validated), at a real,
disclosed cost of a higher false-positive rate (~36% vs. 22%). That
trade-off is why this stays a labeled "second opinion" alongside the
rules-based score, not a replacement for it.
"""

import pickle
from pathlib import Path

from app.models.risk_model import HIGH_THRESHOLD, MEDIUM_THRESHOLD

MODEL_FILE = Path(__file__).resolve().parent / "ml_risk_model.pkl"

# Typical severity of each class, used to blend the model's per-class
# probabilities into a single 0.0-1.0 score comparable to the rules-based
# risk_score. These are just the midpoints of the rules-based bands
# (low: 0-0.4, medium: 0.4-0.7, high: 0.7-1.0) — not learned by the model.
SEVERITY_WEIGHTS = {"low": 0.2, "medium": 0.55, "high": 0.85}

with open(MODEL_FILE, "rb") as f:
    _pipeline = pickle.load(f)


def predict_ml_risk(rainfall_mm_24h: float, river_level_m: float) -> tuple[str, float]:
    """Return (ml_risk_level, ml_risk_score) for the given inputs.

    ml_risk_score is computed by taking the model's predicted probability
    for each of low/medium/high, and blending them using SEVERITY_WEIGHTS
    above — e.g. a prediction of 70% "high" + 30% "medium" becomes
    0.7*0.85 + 0.3*0.55 = 0.76. That keeps the score on the same 0.0-1.0
    scale as the rules-based risk_score, so the two can be shown side by
    side. ml_risk_level then buckets that same score using the identical
    thresholds as the rules-based model, so the label and the score never
    visually contradict each other.
    """
    probabilities = _pipeline.predict_proba([[rainfall_mm_24h, river_level_m]])[0]
    class_names = _pipeline.classes_

    ml_risk_score = sum(
        proba * SEVERITY_WEIGHTS[class_name] for proba, class_name in zip(probabilities, class_names)
    )
    ml_risk_score = round(float(ml_risk_score), 2)

    if ml_risk_score >= HIGH_THRESHOLD:
        ml_risk_level = "high"
    elif ml_risk_score >= MEDIUM_THRESHOLD:
        ml_risk_level = "medium"
    else:
        ml_risk_level = "low"

    return ml_risk_level, ml_risk_score
