"""Finds a decision threshold for the real-data-trained model that is both
statistically sound (per leave-one-event-out CV, see evaluate_ml_loeo.py)
AND produces sensible labels on the actual demo cities in
app/data/regions.json — the thing threshold 0.80 was never checked against
before it was (briefly, and then reverted) wired into production.

For each candidate threshold this prints two independent views side by
side:
  1. LOEO-CV recall/FPR, pooled across all 29 real events (statistical
     soundness — same methodology as evaluate_ml_loeo.py).
  2. How a model trained on 100% of the real data would label each of the
     10 regions.json demo cities at that threshold, compared against the
     rules-based label those cities were originally sanity-checked
     against (see risk_model.py's compute_risk docstring).

A threshold only counts as "deployable" if it doesn't embarrassingly
contradict the demo (e.g. calling Lagos "low") AND still beats or matches
rules-based on the real historical data. If no threshold satisfies both,
that itself is the answer — it would mean the calibration mismatch isn't
just about picking a different threshold.

Run it (needs real_training_data_dfo.csv to already exist):

    cd backend
    .venv/Scripts/python.exe -m app.models.find_deployable_threshold
"""
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.dfo_features import discharge_percentile_by_city, load_usable_rows
from app.models.risk_model import RIVER_LEVEL_CAP_M, compute_risk

DFO_EVENTS_FILE = Path(__file__).resolve().parent.parent / "data" / "dfo_flood_events.json"
REGIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "regions.json"
RANDOM_SEED = 42
RISK_RANK = {"low": 0, "medium": 1, "high": 2}
THRESHOLDS = np.arange(0.10, 0.81, 0.05)


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


def _assign_level(p_medium: float, p_high: float, threshold: float) -> str:
    p_elevated = p_medium + p_high
    if p_elevated < threshold:
        return "low"
    return "high" if p_high >= p_medium else "medium"


def main() -> None:
    rows = load_usable_rows()
    percentiles = discharge_percentile_by_city(rows)
    event_ids = _event_id_by_row(rows)

    X = np.array(
        [[float(r["rainfall_mm_24h"]), percentiles[r["location_name"]][r["date"]] * RIVER_LEVEL_CAP_M] for r in rows]
    )
    y = np.array([r["risk_level"] for r in rows])

    all_events = sorted({e for e in event_ids if e is not None})
    low_idx_all = np.where(event_ids == None)[0]  # noqa: E711

    # ---- Pass 1: pooled LOEO-CV predictions, once, reused for every threshold ----
    pooled_y_true: list[str] = []
    pooled_p_medium: list[float] = []
    pooled_p_high: list[float] = []
    pooled_rules_pred: list[str] = []

    print("Running leave-one-event-out CV...")
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

        pipeline = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
            ]
        )
        pipeline.fit(X[train_idx], y[train_idx])

        X_test_fold, y_test_fold = X[test_idx], y[test_idx]
        class_index = {name: i for i, name in enumerate(pipeline.classes_)}
        probas = pipeline.predict_proba(X_test_fold)

        pooled_y_true.extend(y_test_fold)
        pooled_p_medium.extend(probas[:, class_index["medium"]])
        pooled_p_high.extend(probas[:, class_index["high"]])
        pooled_rules_pred.extend(compute_risk(r, l)[0] for r, l in X_test_fold)

    rules_recall, rules_fpr = _recall_and_fpr(pooled_y_true, pooled_rules_pred)
    print(f"Rules-based (pooled, same rows): recall {rules_recall:.1%}, FPR {rules_fpr:.2%}")
    print()

    # ---- Pass 2: final production-candidate model, trained on ALL real data ----
    final_pipeline = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
        ]
    )
    final_pipeline.fit(X, y)
    final_class_index = {name: i for i, name in enumerate(final_pipeline.classes_)}

    demo_cities = json.loads(REGIONS_FILE.read_text(encoding="utf-8"))
    demo_X = np.array([[c["rainfall_mm_24h"], c["river_level_m"]] for c in demo_cities])
    demo_probas = final_pipeline.predict_proba(demo_X)
    demo_p_medium = demo_probas[:, final_class_index["medium"]]
    demo_p_high = demo_probas[:, final_class_index["high"]]
    demo_rules_labels = [compute_risk(c["rainfall_mm_24h"], c["river_level_m"])[0] for c in demo_cities]

    p_medium_arr = np.array(pooled_p_medium)
    p_high_arr = np.array(pooled_p_high)

    print(f"{'threshold':>10s} {'LOEO recall':>12s} {'LOEO FPR':>10s} {'demo matches':>13s}  mismatched demo cities")
    results = []
    for threshold in THRESHOLDS:
        loeo_pred = [
            _assign_level(pm, ph, threshold) for pm, ph in zip(p_medium_arr, p_high_arr)
        ]
        recall, fpr = _recall_and_fpr(pooled_y_true, loeo_pred)

        demo_pred = [_assign_level(pm, ph, threshold) for pm, ph in zip(demo_p_medium, demo_p_high)]
        matches = sum(1 for a, b in zip(demo_pred, demo_rules_labels) if a == b)
        mismatched = [
            f"{c['location_name']}(rules={r},ml={p})"
            for c, r, p in zip(demo_cities, demo_rules_labels, demo_pred)
            if r != p
        ]

        results.append((threshold, recall, fpr, matches, mismatched, demo_pred))
        print(f"{threshold:10.2f} {recall:12.1%} {fpr:10.2%} {matches:11d}/10  {', '.join(mismatched) if mismatched else '(all match)'}")

    print()
    deployable = [r for r in results if r[3] == 10 and r[2] <= rules_fpr]
    if deployable:
        best = max(deployable, key=lambda r: r[1])
        print(
            f"BEST DEPLOYABLE THRESHOLD: {best[0]:.2f} -> LOEO recall {best[1]:.1%}, FPR {best[2]:.2%} "
            f"(rules-based: {rules_recall:.1%}/{rules_fpr:.2%}), all 10 demo cities agree with rules-based labels."
        )
    else:
        close = [r for r in results if r[3] >= 8]
        if close:
            best = max(close, key=lambda r: (r[3], r[1]))
            print(
                f"No threshold gets all 10 demo cities to agree with FPR <= rules-based's {rules_fpr:.2%}. "
                f"Closest: threshold {best[0]:.2f} -> {best[3]}/10 demo matches, LOEO recall {best[1]:.1%}, FPR {best[2]:.2%}. "
                f"Mismatched: {', '.join(best[4])}"
            )
        else:
            print("No threshold gets close to matching the demo cities — this is not a threshold problem.")


if __name__ == "__main__":
    main()
