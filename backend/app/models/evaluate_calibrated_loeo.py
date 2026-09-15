"""Leave-one-event-out cross-validation for the calibrated-percentile-
label model (`calibrated_percentile_labels.py`) — same rigorous
methodology as `evaluate_ml_loeo.py`, extended with one more safeguard:
the percentile thresholds used to build TRAINING labels are recalibrated
inside every single fold, using only that fold's training rows, never
the held-out event. Calibrating the threshold on the same data used to
evaluate it would be a real leak — the same category of mistake this
project already caught and fixed once this session (the original
train/test split leakage in `check_split_leakage.py`) — so this closes
that door for the threshold too, not just the row split.

Ground truth for scoring is always the ORIGINAL real DFO-based
risk_level (actual confirmed severity), never the recalibrated label —
the recalibrated label is only ever used to build what the model trains
on, so this measures "does it predict real disasters," the same question
`evaluate_ml_loeo.py` answers for the old approach, for a fair comparison.

Run it (needs `real_training_data_dfo.csv` to already exist):

    cd backend
    .venv/Scripts/python.exe -m app.models.evaluate_calibrated_loeo
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
CUTOFF_CANDIDATES = np.arange(0.30, 0.95, 0.01)


def _event_id_by_row(rows: list[dict]) -> np.ndarray:
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
    return np.array([date_to_event.get((r["location_name"], r["date"])) for r in rows])


def _recall_and_fpr(y_true, y_pred) -> tuple[float, float]:
    elevated = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] > 0]
    low = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] == 0]
    recall = sum(1 for t, p in elevated if RISK_RANK[p] >= RISK_RANK[t]) / len(elevated) if elevated else float("nan")
    fpr = sum(1 for t, p in low if RISK_RANK[p] > 0) / len(low) if low else float("nan")
    return recall, fpr


def _fit_medium_cutoff(train_percentiles: np.ndarray, train_is_dfo: np.ndarray) -> float:
    best = (-1.0, None)
    for cut in CUTOFF_CANDIDATES:
        pred = train_percentiles >= cut
        recall = (pred & train_is_dfo).sum() / max(train_is_dfo.sum(), 1)
        fpr = (pred & ~train_is_dfo).sum() / max((~train_is_dfo).sum(), 1)
        j = recall - fpr
        if j > best[0]:
            best = (j, cut)
    return best[1]


def _fit_high_cutoff(train_percentiles: np.ndarray, train_is_dfo_high: np.ndarray, medium_cutoff: float) -> float:
    elevated_mask = train_percentiles >= medium_cutoff
    best = (-1.0, medium_cutoff)  # fall back to the medium cutoff itself if nothing separates further
    for cut in CUTOFF_CANDIDATES:
        if cut < medium_cutoff:
            continue
        pred_high = train_percentiles >= cut
        not_high_but_elevated = elevated_mask & ~train_is_dfo_high
        recall = (pred_high & train_is_dfo_high).sum() / max(train_is_dfo_high.sum(), 1)
        fpr = (pred_high & not_high_but_elevated).sum() / max(not_high_but_elevated.sum(), 1)
        j = recall - fpr
        if j > best[0]:
            best = (j, cut)
    return best[1]


def main() -> None:
    rows = load_usable_rows()
    percentiles_by_city = discharge_percentile_by_city(rows)
    percentiles = np.array([percentiles_by_city[r["location_name"]][r["date"]] for r in rows])
    is_dfo = np.array([r["label_source"] == "dfo_event" for r in rows])
    is_dfo_high = np.array([r["label_source"] == "dfo_event" and r["risk_level"] == "high" for r in rows])
    event_ids = _event_id_by_row(rows)

    X = np.array([[float(r["rainfall_mm_24h"]), percentiles[i] * RIVER_LEVEL_CAP_M] for i, r in enumerate(rows)])
    y_true_real = np.array([r["risk_level"] for r in rows])  # untouched real DFO-based ground truth, used only for scoring

    all_events = sorted({e for e in event_ids if e is not None})
    print(f"Running leave-one-event-out CV across {len(all_events)} real events, with per-fold threshold calibration...")

    low_idx_all = np.where(event_ids == None)[0]  # noqa: E711

    pooled_y_true: list[str] = []
    pooled_default_pred: list[str] = []
    pooled_p_medium: list[float] = []
    pooled_p_high: list[float] = []
    pooled_rules_pred: list[str] = []
    pooled_old_ml_pred: list[str] = []
    fold_cutoffs: list[tuple[float, float]] = []

    for fold, held_out_event in enumerate(all_events):
        test_elevated_mask = event_ids == held_out_event
        train_elevated_mask = (event_ids != None) & (~test_elevated_mask)  # noqa: E711

        fold_rng = np.random.default_rng(RANDOM_SEED + fold)
        n_low_test = max(1, len(low_idx_all) // len(all_events))
        shuffled_low = fold_rng.permutation(low_idx_all)
        low_test_idx = shuffled_low[:n_low_test]
        low_train_idx = shuffled_low[n_low_test:]

        train_idx = np.concatenate([np.where(train_elevated_mask)[0], low_train_idx])
        test_idx = np.concatenate([np.where(test_elevated_mask)[0], low_test_idx])

        # Calibrate this fold's thresholds using ONLY training rows --
        # the held-out event's days never influence what "medium"/"high"
        # means for this fold's training labels.
        medium_cutoff = _fit_medium_cutoff(percentiles[train_idx], is_dfo[train_idx])
        high_cutoff = _fit_high_cutoff(percentiles[train_idx], is_dfo_high[train_idx], medium_cutoff)
        fold_cutoffs.append((medium_cutoff, high_cutoff))

        y_train_calibrated = np.where(
            percentiles[train_idx] >= high_cutoff, "high", np.where(percentiles[train_idx] >= medium_cutoff, "medium", "low")
        )

        pipeline = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
            ]
        )
        pipeline.fit(X[train_idx], y_train_calibrated)

        X_test_fold = X[test_idx]
        y_test_fold_real = y_true_real[test_idx]  # score against REAL DFO labels, not the calibrated training labels
        class_names = list(pipeline.classes_)
        class_index = {name: i for i, name in enumerate(class_names)}
        probas = pipeline.predict_proba(X_test_fold)

        pooled_y_true.extend(y_test_fold_real)
        pooled_default_pred.extend(pipeline.predict(X_test_fold))
        pooled_p_medium.extend(probas[:, class_index["medium"]] if "medium" in class_index else [0.0] * len(X_test_fold))
        pooled_p_high.extend(probas[:, class_index["high"]] if "high" in class_index else [0.0] * len(X_test_fold))
        pooled_rules_pred.extend(compute_risk(r, l)[0] for r, l in X_test_fold)
        pooled_old_ml_pred.extend(predict_ml_risk(r, l)[0] for r, l in X_test_fold)

        if (fold + 1) % 10 == 0 or fold == len(all_events) - 1:
            print(f"  ...completed fold {fold + 1}/{len(all_events)}")

    print()
    print(f"Per-fold calibrated cutoffs -- medium: {np.mean([c[0] for c in fold_cutoffs]):.3f} +/- {np.std([c[0] for c in fold_cutoffs]):.3f}, "
          f"high: {np.mean([c[1] for c in fold_cutoffs]):.3f} +/- {np.std([c[1] for c in fold_cutoffs]):.3f} (stability check across folds)")
    print()
    print(f"Pooled out-of-fold predictions: {len(pooled_y_true)} rows across {len(all_events)} folds")
    unique, counts = np.unique(pooled_y_true, return_counts=True)
    print(f"Pooled class counts (real DFO-based ground truth): {dict(zip(unique, counts))}")
    print()

    default_recall, default_fpr = _recall_and_fpr(pooled_y_true, pooled_default_pred)
    print(f"Calibrated-label model, default cutoff (pooled LOEO-CV): recall {default_recall:.1%}, FPR {default_fpr:.2%}")
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
    print(f"Best Youden's J (calibrated-label LOEO-CV): threshold {best_j[1]:.2f} -> recall {best_j[2]:.1%}, FPR {best_j[3]:.2%}")


if __name__ == "__main__":
    main()
