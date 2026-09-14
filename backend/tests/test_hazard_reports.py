"""Tests for citizen hazard reporting and the reporter-notification loop
(app/routes/hazard_reports.py) — added this session to close the gap where
someone reporting "I'm trapped" had no way to know anyone ever saw it.
"""
import pytest

import app.routes.hazard_reports as hazard_reports
from app.routes.hazard_reports import HazardReportRequest, create_hazard_report, notify_reporter


@pytest.fixture(autouse=True)
def isolated_hazard_reports(tmp_path, monkeypatch):
    monkeypatch.setattr(hazard_reports, "HAZARD_REPORTS_FILE", tmp_path / "hazard_reports.json")


def test_report_without_a_phone_number_sends_no_notification():
    response = create_hazard_report(HazardReportRequest(category="Road flooding", location_name="Nairobi, Kenya"))
    stored = hazard_reports.read_hazard_reports()[0]
    assert stored["phone_number"] is None
    assert stored["reporter_notifications"] == []
    # the citizen's own HTTP response never carries these internal fields
    assert not hasattr(response, "reporter_notifications")


def test_report_with_a_phone_number_gets_a_confirmation_logged():
    create_hazard_report(
        HazardReportRequest(category="Road flooding", location_name="Nairobi, Kenya", phone_number="+254700000000")
    )
    stored = hazard_reports.read_hazard_reports()[0]
    assert len(stored["reporter_notifications"]) == 1
    assert stored["reporter_notifications"][0]["status"] == "simulated"  # SMS forced unconfigured by conftest
    assert "Nairobi, Kenya" in stored["reporter_notifications"][0]["message"]


def test_needs_assistance_report_gets_an_urgent_confirmation_message():
    create_hazard_report(
        HazardReportRequest(
            category="Trapped", location_name="Lagos, Nigeria", needs_assistance=True, phone_number="+2348000000000"
        )
    )
    stored = hazard_reports.read_hazard_reports()[0]
    message = stored["reporter_notifications"][0]["message"]
    assert "help" in message.lower() or "responder" in message.lower()


def test_notify_reporter_does_no_file_io_itself(tmp_path, monkeypatch):
    # notify_reporter() must be safe for a caller to invoke in the middle
    # of its own read-modify-write cycle without a second, competing write
    # happening underneath it -- see its docstring. Proof: point
    # HAZARD_REPORTS_FILE at a file that doesn't exist, and confirm
    # calling it doesn't create one.
    missing_file = tmp_path / "should_not_be_created.json"
    monkeypatch.setattr(hazard_reports, "HAZARD_REPORTS_FILE", missing_file)

    result = notify_reporter("+254700000000", "test message")

    assert result["status"] == "simulated"
    assert not missing_file.exists()


def test_notify_reporter_reports_failed_status_if_the_gateway_raises(monkeypatch):
    monkeypatch.setattr(hazard_reports, "is_sms_configured", lambda: True)

    def _boom(numbers, message):
        raise RuntimeError("gateway rejected the number")

    monkeypatch.setattr(hazard_reports, "send_sms", _boom)

    result = notify_reporter("+254700000000", "test message")
    assert result["status"] == "failed"


def test_notify_reporter_reports_sent_status_on_a_successful_send(monkeypatch):
    monkeypatch.setattr(hazard_reports, "is_sms_configured", lambda: True)
    sent = []
    monkeypatch.setattr(hazard_reports, "send_sms", lambda numbers, message: sent.append((numbers, message)))

    result = notify_reporter("+254700000000", "test message")

    assert result["status"] == "sent"
    assert sent == [(["+254700000000"], "test message")]
