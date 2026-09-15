"""Tests for the AI-priority triage weighting (app/models/priority_model.py)
— the "why does this report outrank that one" logic behind the admin
dashboard's Priority Queue. Pure function, no file I/O."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.priority_model import compute_priority


def _report(**overrides) -> dict:
    base = {
        "needs_assistance": False,
        "category": "General flooding",
        "has_photo": False,
        "submitted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    base.update(overrides)
    return base


def test_bare_minimum_report_is_low_priority():
    result = compute_priority(_report(), region_risk_level=None)
    assert result["priority_level"] == "low"
    assert result["severity"] == "unknown"


def test_needs_assistance_alone_is_the_single_biggest_factor():
    with_help = compute_priority(_report(needs_assistance=True), region_risk_level=None)
    without_help = compute_priority(_report(needs_assistance=False), region_risk_level=None)
    assert with_help["priority_score"] > without_help["priority_score"]
    assert with_help["priority_score"] - without_help["priority_score"] == pytest.approx(0.40)


def test_high_region_risk_raises_the_score_more_than_medium_or_low():
    high = compute_priority(_report(), region_risk_level="high")["priority_score"]
    medium = compute_priority(_report(), region_risk_level="medium")["priority_score"]
    low = compute_priority(_report(), region_risk_level="low")["priority_score"]
    assert high > medium > low


def test_unmatched_region_is_not_penalized_like_an_error():
    # A location that doesn't match any of the 10 sample cities (e.g. a
    # freeform USSD location) should score the same as an explicit "low"
    # region, not be treated as worse than "low".
    unmatched = compute_priority(_report(), region_risk_level=None)["priority_score"]
    low = compute_priority(_report(), region_risk_level="low")["priority_score"]
    assert unmatched == low


def test_high_urgency_keyword_outranks_medium_urgency_keyword():
    trapped = compute_priority(_report(category="Trapped - Flooded Home"), region_risk_level=None)
    flooded_road = compute_priority(_report(category="Flooded road"), region_risk_level=None)
    assert trapped["priority_score"] > flooded_road["priority_score"]


def test_photo_evidence_adds_a_small_boost():
    with_photo = compute_priority(_report(has_photo=True), region_risk_level=None)["priority_score"]
    without_photo = compute_priority(_report(has_photo=False), region_risk_level=None)["priority_score"]
    assert with_photo - without_photo == pytest.approx(0.05)


def test_older_unresolved_report_scores_higher_than_a_brand_new_one():
    old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    old_report = compute_priority(_report(submitted_at=old_timestamp), region_risk_level=None)
    new_report = compute_priority(_report(), region_risk_level=None)
    assert old_report["priority_score"] > new_report["priority_score"]


def test_report_age_contribution_caps_at_24_hours():
    # A 30h-old report and a 100h-old report should score identically —
    # age stops mattering past the 24h cap, per the module's own docstring.
    at_30h = (datetime.now(timezone.utc) - timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    at_100h = (datetime.now(timezone.utc) - timedelta(hours=100)).strftime("%Y-%m-%dT%H:%M:%SZ")
    score_30h = compute_priority(_report(submitted_at=at_30h), region_risk_level=None)["priority_score"]
    score_100h = compute_priority(_report(submitted_at=at_100h), region_risk_level=None)["priority_score"]
    assert score_30h == score_100h


def test_score_never_exceeds_one_even_with_every_factor_maxed():
    worst_case = compute_priority(
        _report(
            needs_assistance=True,
            category="Trapped, injured, unconscious, drowning, collapse",
            has_photo=True,
            submitted_at=(datetime.now(timezone.utc) - timedelta(hours=1000)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        ),
        region_risk_level="high",
    )
    assert worst_case["priority_score"] <= 1.0
    assert worst_case["priority_level"] == "critical"


def test_factors_dict_explains_every_score_component():
    result = compute_priority(_report(needs_assistance=True), region_risk_level="high")
    assert set(result["factors"]) == {"needs_assistance", "region_risk_level", "category", "evidence", "report_age"}
