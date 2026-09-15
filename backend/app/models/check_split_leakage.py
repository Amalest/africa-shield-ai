"""Checks whether `train_ml_model_real.py`'s random row-level train/test
split leaks information across the train/test boundary, and if so,
retrains + re-evaluates with a leak-free split instead.

**The concern**: DFO events span multiple consecutive days (see
`app/data/dfo_flood_events.json` — a typical event is 2-7 days), and
`fetch_real_training_data_dfo.py` labels every day in that range
"medium"/"high". A random *row-level* split can put some days of the
SAME event in training and other days of that SAME event in the test
set. Those days share nearly identical rainfall/discharge (it's the same
flood), so the model could "recognize" that specific event rather than
generalizing to a genuinely new one — inflating the reported recall.

**The fix**: split by EVENT instead of by row for the elevated rows —
every day of a given event goes entirely into train or entirely into
test, never split. Low (non-event) rows are still split randomly/
stratified, since they aren't tied to a specific event.

Run it (needs `real_training_data_dfo.csv` to already exist):

    cd backend
    .venv/Scripts/python.exe -m app.models.check_split_leakage
"""
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.dfo_features import discharge_percentile_by_city, load_usable_rows
from app.models.ml_risk_model import predict_ml_risk
from app.models.risk_model import RIVER_LEVEL_CAP_M, compute_risk

DFO_EVENTS_FILE = Path(__file__).resolve().parent.parent / "data" / "dfo_flood_events.json"
RANDOM_SEED = 42
RISK_RANK = {"low": 0, "medium": 1, "high": 2}


def _recall_and_fpr(y_true, y_pred) -> tuple[float, float]:
    elevated = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] > 0]
    low = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] == 0]
    recall = sum(1 for t, p in elevated if RISK_RANK[p] >= RISK_RANK[t]) / len(elevated) if elevated else float("nan")
    fpr = sum(1 for t, p in low if RISK_RANK[p] > 0) / len(low) if low else float("nan")
    return recall, fpr


def _event_id_by_row(rows: list[dict]) -> dict[int, str | None]:
    """Maps each row's index (in `rows`) to the DFO event id it belongs
    to, or None for a "low"/non-event row. Two events for the same city
    with overlapping date ranges would collide in
    `fetch_real_training_data_dfo.py`'s own `elevated_dates` dict (last
    one wins) -- same behavior reproduced here for consistency, not a
    new bug introduced by this check."""
    events = json.loads(DFO_EVENTS_FILE.read_text(encoding="utf-8"))
    date_to_event: dict[tuple[str, str], str] = {}
    for event in events:
        event_id = f"{event['location_name']}|{event['began']}|{event['ended']}"
        began = date.fromisoformat(event["began"])
        ended = date.fromisoformat(event["ended"])
        day = began
        while day <= ended:
            date_to_event[(event["location_name"], day.isoformat())] = event_id
            day += timedelta(days=1)

    result: dict[int, str | None] = {}
    for i, row in enumerate(rows):
        result[i] = date_to_event.get((row["location_name"], row["date"]))
    return result


def main() -> None:
    rows = load_usable_rows()
    percentiles = discharge_percentile_by_city(rows)
    event_id_by_row = _event_id_by_row(rows)

    X = np.array(
        [[float(r["rainfall_mm_24h"]), percentiles[r["location_name"]][r["date"]] * RIVER_LEVEL_CAP_M] for r in rows]
    )
    y = np.array([r["risk_level"] for r in rows])
    event_ids = np.array([event_id_by_row[i] for i in range(len(rows))])

    # ---- Step 1: quantify leakage in the ORIGINAL row-level split ----
    _, _, _, _, idx_train, idx_test = train_test_split(
        X, y, np.arange(len(rows)), test_size=0.2, random_state=RANDOM_SEED, stratify=y
    )
    train_events = {event_ids[i] for i in idx_train if event_ids[i] is not None}
    test_events = {event_ids[i] for i in idx_test if event_ids[i] is not None}
    leaked_events = train_events & test_events
    print(f"Original row-level random split: {len(train_events)} events touch train, {len(test_events)} touch test")
    print(f"Events with days on BOTH sides of the split (leakage): {len(leaked_events)} of {len(train_events | test_events)}")
    print()

    # ---- Step 2: build a leak-free, event-aware split ----
    all_event_ids = sorted({e for e in event_ids if e is not None})
    rng = np.random.default_rng(RANDOM_SEED)
    shuffled = rng.permutation(all_event_ids)
    n_test_events = max(1, round(len(shuffled) * 0.2))
    test_event_set = set(shuffled[:n_test_events])
    print(f"Leak-free split: {len(all_event_ids) - len(test_event_set)} events -> train, {len(test_event_set)} events -> test")

    elevated_mask = event_ids != None  # noqa: E711 (numpy object array, `is not None` doesn't vectorize)
    is_test_event_row = np.array([e in test_event_set for e in event_ids])

    # Elevated rows: assigned by their event's train/test membership.
    # Low rows: split randomly/stratified, same as before (they aren't
    # tied to any single event).
    low_idx = np.where(~elevated_mask)[0]
    low_train_idx, low_test_idx = train_test_split(low_idx, test_size=0.2, random_state=RANDOM_SEED)

    elevated_idx = np.where(elevated_mask)[0]
    elevated_train_idx = elevated_idx[~is_test_event_row[elevated_idx]]
    elevated_test_idx = elevated_idx[is_test_event_row[elevated_idx]]

    train_idx = np.concatenate([low_train_idx, elevated_train_idx])
    test_idx = np.concatenate([low_test_idx, elevated_test_idx])

    X_train, y_train = X[train_idx], y[train_idx]
    X_test, y_test = X[test_idx], y[test_idx]

    unique, counts = np.unique(y_test, return_counts=True)
    print(f"Leak-free test set: {len(X_test)} rows, class counts {dict(zip(unique, counts))}")
    print()

    pipeline = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
        ]
    )
    pipeline.fit(X_train, y_train)
    default_pred = list(pipeline.predict(X_test))
    default_recall, default_fpr = _recall_and_fpr(y_test, default_pred)
    print(f"Leak-free, default cutoff: recall {default_recall:.1%}, FPR {default_fpr:.2%}")

    # Same threshold sweep as tune_ml_threshold.py, on this leak-free split.
    class_names = list(pipeline.classes_)
    class_index = {name: i for i, name in enumerate(class_names)}
    probas = pipeline.predict_proba(X_test)
    p_medium = probas[:, class_index["medium"]]
    p_high = probas[:, class_index["high"]]
    p_elevated = p_medium + p_high

    print()
    print(f"{'threshold':>10s} {'recall':>8s} {'FPR':>8s} {'youden J':>10s}")
    best_j = (-1.0, None, None, None)
    for threshold in np.arange(0.05, 0.96, 0.05):
        pred = [
            "low" if pe < threshold else ("high" if ph >= pm else "medium")
            for pe, pm, ph in zip(p_elevated, p_medium, p_high)
        ]
        recall, fpr = _recall_and_fpr(y_test, pred)
        j = recall - fpr
        marker = ""
        if j > best_j[0]:
            best_j = (j, threshold, recall, fpr)
            marker = "  <- best so far"
        print(f"{threshold:10.2f} {recall:8.1%} {fpr:8.2%} {j:10.3f}{marker}")

    print()
    rules_pred = [compute_risk(r, l)[0] for r, l in X_test]
    rules_recall, rules_fpr = _recall_and_fpr(y_test, rules_pred)
    old_ml_pred = [predict_ml_risk(r, l)[0] for r, l in X_test]
    old_ml_recall, old_ml_fpr = _recall_and_fpr(y_test, old_ml_pred)
    print(f"Rules-based on this leak-free test set:  recall {rules_recall:.1%}, FPR {rules_fpr:.2%}")
    print(f"Old ML (synthetic) on this leak-free set: recall {old_ml_recall:.1%}, FPR {old_ml_fpr:.2%}")
    print(f"Best Youden's J (leak-free): threshold {best_j[1]:.2f} -> recall {best_j[2]:.1%}, FPR {best_j[3]:.2%}")


if __name__ == "__main__":
    main()
