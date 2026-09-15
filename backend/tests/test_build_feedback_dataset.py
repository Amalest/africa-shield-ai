"""Tests for turning resolved pending alerts into feedback training rows
(app/models/build_feedback_dataset.py)."""
from app.models.build_feedback_dataset import build_feedback_rows


def _alert(status, reject_reason=None, rainfall=80.0, river=3.5):
    return {
        "rainfall_mm_24h": rainfall,
        "river_level_m": river,
        "status": status,
        "reject_reason": reject_reason,
        "reviewed_at": "2026-09-14T00:00:00Z",
    }


def test_approved_alerts_become_confirmed_high_rows():
    rows = build_feedback_rows([_alert("approved")])
    assert rows[0]["risk_level"] == "high"


def test_auto_sent_alerts_become_confirmed_high_rows():
    rows = build_feedback_rows([_alert("auto_sent")])
    assert rows[0]["risk_level"] == "high"


def test_false_positive_rejection_becomes_a_confirmed_low_row():
    rows = build_feedback_rows([_alert("rejected", reject_reason="false_positive")])
    assert rows[0]["risk_level"] == "low"


def test_sensor_fault_rejection_becomes_a_confirmed_low_row():
    rows = build_feedback_rows([_alert("rejected", reject_reason="sensor_fault")])
    assert rows[0]["risk_level"] == "low"


def test_uninformative_rejection_reasons_are_excluded_not_mislabeled():
    # "already_resolved"/"duplicate"/"other" say nothing about whether the
    # underlying reading was actually low-risk -- must not be silently
    # relabeled "low" just because the alert was dismissed.
    for reason in ("already_resolved", "duplicate", "other"):
        rows = build_feedback_rows([_alert("rejected", reject_reason=reason)])
        assert rows == []


def test_still_pending_alerts_are_excluded():
    rows = build_feedback_rows([_alert("pending")])
    assert rows == []


def test_feature_values_pass_through_unchanged():
    rows = build_feedback_rows([_alert("approved", rainfall=77.5, river=3.3)])
    assert rows[0]["rainfall_mm_24h"] == 77.5
    assert rows[0]["river_level_m"] == 3.3


def test_reads_the_real_file_by_default(tmp_path, monkeypatch):
    import json

    import app.models.build_feedback_dataset as module

    fake_file = tmp_path / "pending_alerts.json"
    fake_file.write_text(json.dumps([_alert("approved")]))
    monkeypatch.setattr(module, "PENDING_ALERTS_FILE", fake_file)

    rows = module.build_feedback_rows()
    assert len(rows) == 1


def test_missing_file_returns_no_rows_not_an_error(tmp_path, monkeypatch):
    import app.models.build_feedback_dataset as module

    monkeypatch.setattr(module, "PENDING_ALERTS_FILE", tmp_path / "does_not_exist.json")
    assert module.build_feedback_rows() == []
