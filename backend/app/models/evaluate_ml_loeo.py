"""Leave-one-event-out cross-validation for the real-data-trained ML
model — the statistically trustworthy version of
`check_split_leakage.py`'s one-off leak-free split.

With only 49 real DFO events total, any single train/test split is
noisy (a 6-event test sample, as `check_split_leakage.py` used, can
easily contain zero "high"-severity events by chance). This instead
trains 49 times, each time holding out exactly one event's days as the
test set (and a matching random slice of "low" rows), and pools the
predictions from all 49 folds before computing recall/FPR — so every
single event gets to be "the held-out one" exactly once, and the final
number isn't luck-of-the-draw from which events happened to land in one
particular test split.

Run it (needs `real_training_data_dfo.csv` to already exist):

    cd backend
    .venv/Scripts/python.exe -m app.models.evaluate_ml_loeo
"""
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.dfo_features import discharge_percentile_by_city, load_usable_rows
from app.models.ml_risk_model import predict_ml_risk
from app.models.risk_model import RIVER_LEVEL_CAP_M, compute_risk

DFO_EVENTS_FILE = Path(__file__).resolve().parent.parent / "data" / "dfo_flood_events.json"
RANDOM_SEED = 42
RISK_RANK = {"low": 0, "medium": 1, "high": 2}
THRESHOLDS = np.arange(0.05, 0.96, 0.05)


def _event_id_by_row(rows: list[dict]) -> list[str | None]:
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
    return [date_to_event.get((r["location_name"], r["date"])) for r in rows]


def _recall_and_fpr(y_true, y_pred) -> tuple[float, float]:
    elevated = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] > 0]
    low = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] == 0]
    recall = sum(1 for t, p in elevated if RISK_RANK[p] >= RISK_RANK[t]) / len(elevated) if elevated else float("nan")
    fpr = sum(1 for t, p in low if RISK_RANK[p] > 0) / len(low) if low else float("nan")
    return recall, fpr


def main() -> None:
    rows = load_usable_rows()
    percentiles = discharge_percentile_by_city(rows)
    event_ids = np.array(_event_id_by_row(rows))

    X = np.array(
        [[float(r["rainfall_mm_24h"]), percentiles[r["location_name"]][r["date"]] * RIVER_LEVEL_CAP_M] for r in rows]
    )
    y = np.array([r["risk_level"] for r in rows])

    all_events = sorted({e for e in event_ids if e is not None})
    print(f"Running leave-one-event-out CV across {len(all_events)} real events...")

    rng = np.random.default_rng(RANDOM_SEED)
    low_idx_all = np.where(event_ids == None)[0]  # noqa: E711

    # Pooled out-of-fold predictions across all 49 folds, at every
    # candidate threshold, plus the model's own default (argmax) call --
    # collected once and reused for both the sweep and the "default
    # cutoff" report instead of re-running anything.
    pooled_y_true: list[str] = []
    pooled_default_pred: list[str] = []
    pooled_p_medium: list[float] = []
    pooled_p_high: list[float] = []
    pooled_rules_pred: list[str] = []
    pooled_old_ml_pred: list[str] = []

    for fold, held_out_event in enumerate(all_events):
        test_elevated_mask = event_ids == held_out_event
        train_elevated_mask = (event_ids != None) & (~test_elevated_mask)  # noqa: E711

        # Give each fold a held-out slice of "low" rows too (same
        # fraction each time, deterministic per-fold via the fold index),
        # so the false-positive rate is measured on genuinely unseen
        # "low" rows in every fold, not just the elevated ones.
        fold_rng = np.random.default_rng(RANDOM_SEED + fold)
        n_low_test = max(1, len(low_idx_all) // len(all_events))
        shuffled_low = fold_rng.permutation(low_idx_all)
        low_test_idx = shuffled_low[:n_low_test]
        low_train_idx = shuffled_low[n_low_test:]

        train_idx = np.concatenate([np.where(train_elevated_mask)[0], low_train_idx])
        test_idx = np.concatenate([np.where(test_elevated_mask)[0], low_test_idx])

        pipeline = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
            ]
        )
        pipeline.fit(X[train_idx], y[train_idx])

        X_test_fold, y_test_fold = X[test_idx], y[test_idx]
        class_names = list(pipeline.classes_)
        class_index = {name: i for i, name in enumerate(class_names)}
        probas = pipeline.predict_proba(X_test_fold)

        pooled_y_true.extend(y_test_fold)
        pooled_default_pred.extend(pipeline.predict(X_test_fold))
        pooled_p_medium.extend(probas[:, class_index["medium"]])
        pooled_p_high.extend(probas[:, class_index["high"]])
        pooled_rules_pred.extend(compute_risk(r, l)[0] for r, l in X_test_fold)
        pooled_old_ml_pred.extend(predict_ml_risk(r, l)[0] for r, l in X_test_fold)

        if (fold + 1) % 10 == 0 or fold == len(all_events) - 1:
            print(f"  ...completed fold {fold + 1}/{len(all_events)}")

    print()
    print(f"Pooled out-of-fold predictions: {len(pooled_y_true)} rows across {len(all_events)} folds")
    unique, counts = np.unique(pooled_y_true, return_counts=True)
    print(f"Pooled class counts: {dict(zip(unique, counts))}")
    print()

    default_recall, default_fpr = _recall_and_fpr(pooled_y_true, pooled_default_pred)
    print(f"ML default cutoff (pooled LOEO-CV): recall {default_recall:.1%}, FPR {default_fpr:.2%}")
    print()

    p_medium = np.array(pooled_p_medium)
    p_high = np.array(pooled_p_high)
    p_elevated = p_medium + p_high

    print(f"{'threshold':>10s} {'recall':>8s} {'FPR':>8s} {'youden J':>10s}")
    best_j = (-1.0, None, None, None)
    for threshold in THRESHOLDS:
        pred = [
            "low" if pe < threshold else ("high" if ph >= pm else "medium")
            for pe, pm, ph in zip(p_elevated, p_medium, p_high)
        ]
        recall, fpr = _recall_and_fpr(pooled_y_true, pred)
        j = recall - fpr
        marker = ""
        if j > best_j[0]:
            best_j = (j, threshold, recall, fpr)
            marker = "  <- best so far"
        print(f"{threshold:10.2f} {recall:8.1%} {fpr:8.2%} {j:10.3f}{marker}")

    print()
    rules_recall, rules_fpr = _recall_and_fpr(pooled_y_true, pooled_rules_pred)
    old_ml_recall, old_ml_fpr = _recall_and_fpr(pooled_y_true, pooled_old_ml_pred)
    print(f"Rules-based (pooled, same rows):        recall {rules_recall:.1%}, FPR {rules_fpr:.2%}")
    print(f"Old ML synthetic (pooled, same rows):    recall {old_ml_recall:.1%}, FPR {old_ml_fpr:.2%}")
    print(f"Best Youden's J (LOEO-CV): threshold {best_j[1]:.2f} -> recall {best_j[2]:.1%}, FPR {best_j[3]:.2%}")

    under_rules_fpr = [
        (t, *_recall_and_fpr(pooled_y_true, [
            "low" if pe < t else ("high" if ph >= pm else "medium")
            for pe, pm, ph in zip(p_elevated, p_medium, p_high)
        ]))
        for t in THRESHOLDS
    ]
    under_cap = [c for c in under_rules_fpr if c[2] <= rules_fpr]
    if under_cap:
        best_under_cap = max(under_cap, key=lambda c: c[1])
        print(
            f"Best recall at/under rules-based's FPR ({rules_fpr:.2%}): threshold {best_under_cap[0]:.2f} "
            f"-> recall {best_under_cap[1]:.1%}, FPR {best_under_cap[2]:.2%}"
        )
    else:
        print(f"No threshold keeps FPR at/under rules-based's {rules_fpr:.2%} in this CV.")


if __name__ == "__main__":
    main()
