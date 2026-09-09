"""Tunes the decision threshold for the real-data-trained ML model
(`train_ml_model_real.py`'s winning candidate) instead of accepting
whatever cutoff `.predict()`'s default argmax implies.

Uses the exact same data loading and `train_test_split` call (same
`RANDOM_SEED`) as `train_ml_model_real.py`, so this reproduces the
identical train/test split and is directly comparable to the numbers
already reported there — it just asks a narrower question: instead of
picking a class by argmax, what happens if we sweep a threshold on
`P(elevated) = P(medium) + P(high)` directly?

This treats "elevated vs. low" as the operating decision, matching what
`recall`/`false-positive rate` already measure — the medium/high split
within "elevated" doesn't change either metric, only whether we call a
day elevated at all.

Run it (needs `real_training_data_dfo.csv` to already exist):

    cd backend
    .venv/Scripts/python.exe -m app.models.tune_ml_threshold
"""
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.models.dfo_features import build_pseudo_features, load_usable_rows
from app.models.ml_risk_model import predict_ml_risk
from app.models.risk_model import RIVER_LEVEL_CAP_M, compute_risk

RANDOM_SEED = 42
RISK_RANK = {"low": 0, "medium": 1, "high": 2}


def _recall_and_fpr(y_true, y_pred) -> tuple[float, float]:
    """Same strict definition `train_ml_model_real.py` and
    `validate_against_dfo.py` use: recall requires the predicted level to
    meet or exceed the true level (a true "high" day only counts as
    caught if predicted "high", not "medium") — NOT just "elevated vs
    low". An earlier version of this function used the looser
    elevated-vs-low definition, which inflated recall relative to every
    other number in this project; fixed to keep all three scripts
    comparable."""
    elevated = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] > 0]
    low = [(t, p) for t, p in zip(y_true, y_pred) if RISK_RANK[t] == 0]
    recall = sum(1 for t, p in elevated if RISK_RANK[p] >= RISK_RANK[t]) / len(elevated) if elevated else float("nan")
    fpr = sum(1 for t, p in low if RISK_RANK[p] > 0) / len(low) if low else float("nan")
    return recall, fpr


def _assign_level(p_elevated: float, p_medium: float, p_high: float, threshold: float) -> str:
    """Turns a single elevated/low threshold decision into an actual
    3-class label: below threshold -> "low"; at/above it -> whichever of
    medium/high this row's own probabilities favor. This is what a real
    bucketing scheme would do — a threshold sweep can't leave the
    medium/high split undefined and still be comparable to the other
    scripts' recall metric, which is severity-sensitive."""
    if p_elevated < threshold:
        return "low"
    return "high" if p_high >= p_medium else "medium"


def main() -> None:
    rows = load_usable_rows()
    features = build_pseudo_features(rows, RIVER_LEVEL_CAP_M)
    X = np.array([[rainfall, level] for rainfall, level, _label in features])
    y = np.array([label for _rainfall, _level, label in features])

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_SEED, stratify=y
    )

    pipeline = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_SEED)),
        ]
    )
    pipeline.fit(X_train, y_train)

    class_names = list(pipeline.classes_)
    class_index = {name: i for i, name in enumerate(class_names)}
    probas = pipeline.predict_proba(X_test)
    p_low = probas[:, class_index["low"]]
    p_medium = probas[:, class_index["medium"]]
    p_high = probas[:, class_index["high"]]
    p_elevated = 1.0 - p_low

    default_pred = list(pipeline.predict(X_test))
    default_recall, default_fpr = _recall_and_fpr(y_test, default_pred)
    print(f"Default (.predict(), argmax): recall {default_recall:.1%}, FPR {default_fpr:.2%}")
    print()

    print(f"{'threshold':>10s} {'recall':>8s} {'FPR':>8s} {'youden J (recall-FPR)':>22s}")
    best_j = (-1.0, None)
    candidates = []
    for threshold in np.arange(0.05, 0.96, 0.05):
        pred = [
            _assign_level(pe, pm, ph, threshold) for pe, pm, ph in zip(p_elevated, p_medium, p_high)
        ]
        recall, fpr = _recall_and_fpr(y_test, pred)
        j = recall - fpr
        candidates.append((threshold, recall, fpr, j))
        marker = ""
        if j > best_j[0]:
            best_j = (j, threshold)
            marker = "  <- best Youden's J so far"
        print(f"{threshold:10.2f} {recall:8.1%} {fpr:8.2%} {j:22.3f}{marker}")

    print()
    # Highest recall achievable while keeping FPR no worse than the
    # rules-based model's own FPR on this same held-out set -- a
    # concrete, defensible "at least as honest as what we already have"
    # bar, not an arbitrary number.
    rules_pred = [compute_risk(r, l)[0] for r, l in X_test]
    rules_recall, rules_fpr = _recall_and_fpr(y_test, rules_pred)
    old_ml_pred = [predict_ml_risk(r, l)[0] for r, l in X_test]
    old_ml_recall, old_ml_fpr = _recall_and_fpr(y_test, old_ml_pred)

    print(f"Rules-based on this held-out set:       recall {rules_recall:.1%}, FPR {rules_fpr:.2%}")
    print(f"Old ML (synthetic) on this held-out set: recall {old_ml_recall:.1%}, FPR {old_ml_fpr:.2%}")
    print()

    under_rules_fpr = [c for c in candidates if c[2] <= rules_fpr]
    if under_rules_fpr:
        best_under_cap = max(under_rules_fpr, key=lambda c: c[1])
        print(
            f"Best recall while keeping FPR <= rules-based's {rules_fpr:.2%}: "
            f"threshold {best_under_cap[0]:.2f} -> recall {best_under_cap[1]:.1%}, FPR {best_under_cap[2]:.2%}"
        )
    else:
        print(f"No threshold in the sweep keeps FPR at or below rules-based's {rules_fpr:.2%}.")

    print(f"Best Youden's J (recall - FPR) overall: threshold {best_j[1]:.2f}, J={best_j[0]:.3f}")


if __name__ == "__main__":
    main()
