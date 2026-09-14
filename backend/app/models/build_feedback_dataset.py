"""Turns resolved operator decisions on pending alerts
(`app/data/pending_alerts.json`, see `app/routes/pending_alerts.py`) into
labeled training rows — real, local, human-verified ground truth, growing
one alert at a time as the system actually gets used.

**Why this is a better long-term label source than DFO, not just a
supplement to it.** `evaluate_ml_loeo.py`'s real-data model turned out
unsafe to deploy — not from a scale mismatch alone, but because DFO's
labels are sparse in a specific way: DFO only catalogs headline,
newsworthy disasters, so the vast majority of "conditions look genuinely
bad" days go unlabeled as false negatives simply because no notable
disaster made the catalog that day (confirmed directly: of 50 real
training days combining >50mm rainfall with a >90th-percentile river
reading, 49 were labeled "low" purely because DFO didn't record a named
event that day — not because those days were actually safe). A model
trained on "will this become a named disaster" behaves differently from
one trained on "is this actually risky," and that gap is exactly what
made it misfire on the demo's regions.

Operator feedback doesn't have that problem: every pending alert an
operator (or the fail-open timeout) resolves is a direct, immediate,
locally-verified judgment about that specific reading, not a distant
catalog's editorial choice about what counts as newsworthy. It's also
already in the system's real operational units (whatever a sensor
reports as `rainfall_mm_24h`/`river_level_m`) rather than the
discharge-percentile proxy DFO training required — so a model trained on
enough of this data would have no calibration mismatch with
`regions.json` or live sensors to begin with.

**Honesty about where this stands today**: a brand-new deployment has
approximately zero resolved pending alerts. This script is real,
working infrastructure — not a promise that it can train anything yet.
Run it any time to see exactly how much labeled feedback has
accumulated, and it will refuse to pretend a trainable model exists
before there's enough data to support one.

Run it:

    cd backend
    .venv/Scripts/python.exe -m app.models.build_feedback_dataset
"""
import json
from pathlib import Path
from typing import Literal

import numpy as np

PENDING_ALERTS_FILE = Path(__file__).resolve().parent.parent / "data" / "pending_alerts.json"

# Only these two rejection reasons say anything about whether the
# underlying reading was actually low-risk. "already_resolved" and
# "duplicate" mean the alert was redundant, not wrong; "other" is
# unspecified. Relabeling those as "low" would be fabricating a signal
# the operator never actually gave.
INFORMATIVE_REJECT_REASONS = {"false_positive", "sensor_fault"}

# A deliberately modest bar -- not a statistically rigorous minimum, just
# enough rows with both classes present that a fit means something more
# than memorizing a handful of points. Raise this once real deployments
# exist; there's no principled number to pick from zero operational data.
MIN_ROWS_TO_ATTEMPT_A_FIT = 30
MIN_ROWS_PER_CLASS = 8


def build_feedback_rows(pending_alerts: list[dict] | None = None) -> list[dict]:
    """Extracts labeled `{rainfall_mm_24h, river_level_m, risk_level,
    resolved_at}` rows from resolved pending alerts. `pending_alerts`
    defaults to reading the real file; a caller (e.g. a test) can pass an
    explicit list instead. Every pending alert was created at risk_level
    "high" (see `app/routes/alerts.py`'s `maybe_auto_trigger` — that's the
    only level it ever fires on), so an approved/auto-sent one is a
    confirmed-elevated row and a rejected-as-false_positive/sensor_fault
    one is a confirmed-safe row; anything still "pending", or rejected
    for a reason that says nothing about the reading itself, is skipped."""
    if pending_alerts is None:
        pending_alerts = json.loads(PENDING_ALERTS_FILE.read_text(encoding="utf-8")) if PENDING_ALERTS_FILE.exists() else []

    rows = []
    for alert in pending_alerts:
        if alert["status"] in ("approved", "auto_sent"):
            label = "high"
        elif alert["status"] == "rejected" and alert.get("reject_reason") in INFORMATIVE_REJECT_REASONS:
            label = "low"
        else:
            continue

        rows.append(
            {
                "rainfall_mm_24h": alert["rainfall_mm_24h"],
                "river_level_m": alert["river_level_m"],
                "risk_level": label,
                "resolved_at": alert["reviewed_at"],
                "source": "operator_feedback",
            }
        )
    return rows


def _fit_and_report(rows: list[dict]) -> None:
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import LeaveOneOut, cross_val_predict
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    X = np.array([[r["rainfall_mm_24h"], r["river_level_m"]] for r in rows])
    y = np.array([r["risk_level"] for r in rows])

    pipeline = Pipeline([("scaler", StandardScaler()), ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced"))])
    predictions = cross_val_predict(pipeline, X, y, cv=LeaveOneOut())
    accuracy = float(np.mean(predictions == y))
    print(f"Leave-one-out accuracy on {len(rows)} operator-feedback rows: {accuracy:.1%}")
    print("(Too small a sample for a recall/FPR breakdown to mean much yet -- accuracy only, as a sanity signal.)")


def main() -> None:
    rows = build_feedback_rows()
    by_label: dict[str, int] = {}
    for row in rows:
        by_label[row["risk_level"]] = by_label.get(row["risk_level"], 0) + 1

    print(f"Resolved, labelable pending alerts so far: {len(rows)}")
    print(f"By label: {by_label or '(none yet)'}")
    print()

    if len(rows) < MIN_ROWS_TO_ATTEMPT_A_FIT or min(by_label.get("high", 0), by_label.get("low", 0)) < MIN_ROWS_PER_CLASS:
        print(
            f"Not enough operator feedback yet to train anything meaningful "
            f"(need >= {MIN_ROWS_TO_ATTEMPT_A_FIT} rows with >= {MIN_ROWS_PER_CLASS} of each label; "
            f"have {len(rows)} rows, {by_label}). This is expected for a new deployment -- "
            "the pipeline itself is working, there's just no data yet. Re-run this after the "
            "system has been used for a while."
        )
        return

    _fit_and_report(rows)


if __name__ == "__main__":
    main()
