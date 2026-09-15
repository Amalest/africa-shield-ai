"""Tests for the rules-based flood risk formula (app/models/risk_model.py)
— the primary, judge-facing score. Pure functions, no file I/O."""
from app.models.risk_model import (
    HIGH_THRESHOLD,
    MEDIUM_THRESHOLD,
    RAINFALL_CAP_MM,
    RIVER_LEVEL_CAP_M,
    compute_risk,
    risk_score_breakdown,
)


def test_zero_inputs_are_low_risk():
    level, score = compute_risk(0, 0)
    assert level == "low"
    assert score == 0.0


def test_maximum_inputs_are_high_risk():
    level, score = compute_risk(RAINFALL_CAP_MM, RIVER_LEVEL_CAP_M)
    assert level == "high"
    assert score == 1.0


def test_score_is_equal_weighted_average():
    # 50mm of 100mm cap = 0.5 normalized; 2m of 4m cap = 0.5 normalized.
    # Equal-weighted average of two 0.5s is exactly 0.5.
    _level, score = compute_risk(50, 2)
    assert score == 0.5


def test_negative_inputs_clamp_to_zero_not_negative_score():
    level, score = compute_risk(-10, -5)
    assert level == "low"
    assert score == 0.0


def test_inputs_above_the_cap_clamp_to_maximum_not_over_one():
    # Real sensors can read higher than the cap (e.g. an extreme flood);
    # the score must still stay within its documented 0.0-1.0 range.
    level, score = compute_risk(500, 40)
    assert level == "high"
    assert score == 1.0


def test_threshold_boundaries_are_inclusive():
    # risk_score >= HIGH_THRESHOLD is "high"; exactly at the boundary
    # must count as high, not fall just short of it.
    rainfall_for_exact_high = HIGH_THRESHOLD * RAINFALL_CAP_MM
    level, score = compute_risk(rainfall_for_exact_high, rainfall_for_exact_high / RAINFALL_CAP_MM * RIVER_LEVEL_CAP_M)
    assert score == HIGH_THRESHOLD
    assert level == "high"

    just_below = rainfall_for_exact_high - 0.5
    level, score = compute_risk(just_below, just_below / RAINFALL_CAP_MM * RIVER_LEVEL_CAP_M)
    assert score < HIGH_THRESHOLD
    assert level == "medium"


def test_medium_threshold_boundary():
    rainfall_for_exact_medium = MEDIUM_THRESHOLD * RAINFALL_CAP_MM
    level, score = compute_risk(rainfall_for_exact_medium, rainfall_for_exact_medium / RAINFALL_CAP_MM * RIVER_LEVEL_CAP_M)
    assert score == MEDIUM_THRESHOLD
    assert level == "medium"


def test_breakdown_exposes_the_same_numbers_the_score_was_built_from():
    breakdown = risk_score_breakdown(85, 3.2)
    expected_level, expected_score = compute_risk(85, 3.2)
    assert breakdown["risk_level"] == expected_level
    assert breakdown["risk_score"] == expected_score
    assert breakdown["normalized_rainfall"] == round(85 / RAINFALL_CAP_MM, 2)
    assert breakdown["normalized_river_level"] == round(3.2 / RIVER_LEVEL_CAP_M, 2)
