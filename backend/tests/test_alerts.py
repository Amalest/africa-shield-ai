"""Tests for the real alert-send pipeline and the sensor auto-trigger
transition logic (app/routes/alerts.py). `maybe_auto_trigger` is the exact
function that used to fire a real SMS with zero human review — now it
should only ever hand off to the pending-alert queue.
"""
import json

import pytest

import app.routes.alerts as alerts
import app.routes.pending_alerts as pending_alerts


@pytest.fixture(autouse=True)
def isolated_alert_files(tmp_path, monkeypatch):
    monkeypatch.setattr(alerts, "REGIONS_FILE", tmp_path / "regions.json")
    monkeypatch.setattr(alerts, "SUBSCRIBERS_FILE", tmp_path / "subscribers.json")
    monkeypatch.setattr(alerts, "ALERT_LOG_FILE", tmp_path / "alert_log.json")
    monkeypatch.setattr(alerts, "ALERT_STATE_FILE", tmp_path / "region_alert_state.json")

    (tmp_path / "regions.json").write_text(
        json.dumps([{"location_name": "Testville, Testland", "rainfall_mm_24h": 90, "river_level_m": 3.5}])
    )
    (tmp_path / "subscribers.json").write_text(json.dumps([{"location_name": "Testville, Testland", "phone_number": "+10000000000"}]))


def test_send_alert_for_region_logs_a_real_entry_with_a_unique_id():
    entry = alerts.send_alert_for_region("Testville, Testland")
    assert entry["id"]
    log = json.loads(alerts.ALERT_LOG_FILE.read_text())
    assert log == [entry]


def test_send_alert_for_region_raises_lookup_error_for_an_unknown_region():
    with pytest.raises(LookupError):
        alerts.send_alert_for_region("Nowhere, Nowhereland")


def test_send_alert_reports_no_recipients_when_the_region_has_no_subscribers():
    alerts.SUBSCRIBERS_FILE.write_text(json.dumps([]))
    entry = alerts.send_alert_for_region("Testville, Testland")
    assert entry["sms_status"] == "no_recipients"
    assert entry["voice_status"] == "no_recipients"
    assert entry["recipients"] == 0


def test_send_alert_reports_simulated_when_sms_is_not_configured():
    # is_sms_configured is forced False by the autouse conftest fixture,
    # and this region does have a subscriber -- so "simulated", not
    # "no_recipients" or "sent".
    entry = alerts.send_alert_for_region("Testville, Testland")
    assert entry["sms_status"] == "simulated"


def test_message_override_replaces_the_auto_generated_message():
    custom_message = "Operator-edited: move to higher ground now."
    entry = alerts.send_alert_for_region("Testville, Testland", message_override=custom_message)
    assert entry["message_sent"] == custom_message


def test_trigger_is_recorded_faithfully():
    manual = alerts.send_alert_for_region("Testville, Testland", trigger="manual")
    automatic = alerts.send_alert_for_region("Testville, Testland", trigger="automatic")
    assert manual["trigger"] == "manual"
    assert automatic["trigger"] == "automatic"


def test_maybe_auto_trigger_creates_a_pending_alert_instead_of_sending(monkeypatch):
    created = []
    monkeypatch.setattr(
        pending_alerts,
        "create_pending_alert",
        lambda location_name, risk_level, risk_score, rainfall_mm_24h, river_level_m: created.append(location_name) or {"id": "p1"},
    )

    result = alerts.maybe_auto_trigger("Testville, Testland", "high", 90.0, 3.5, 0.9)

    assert created == ["Testville, Testland"]
    assert result == {"id": "p1"}
    # and critically: no real alert was logged anywhere
    assert not alerts.ALERT_LOG_FILE.exists()


def test_maybe_auto_trigger_only_fires_on_the_transition_into_high(monkeypatch):
    created = []
    monkeypatch.setattr(
        pending_alerts,
        "create_pending_alert",
        lambda location_name, risk_level, risk_score, rainfall_mm_24h, river_level_m: created.append(location_name) or {"id": "p1"},
    )

    first = alerts.maybe_auto_trigger("Testville, Testland", "high", 90.0, 3.5, 0.9)
    second = alerts.maybe_auto_trigger("Testville, Testland", "high", 91.0, 3.6, 0.91)  # still high -- no new pending alert

    assert first is not None
    assert second is None
    assert created == ["Testville, Testland"]  # only once


def test_maybe_auto_trigger_does_nothing_for_medium_or_low_risk(monkeypatch):
    monkeypatch.setattr(pending_alerts, "create_pending_alert", lambda *a, **k: pytest.fail("should not be called"))

    assert alerts.maybe_auto_trigger("Testville, Testland", "medium", 50.0, 2.0, 0.5) is None
    assert alerts.maybe_auto_trigger("Testville, Testland", "low", 5.0, 0.5, 0.1) is None


def test_maybe_auto_trigger_fires_again_after_dropping_back_down(monkeypatch):
    created = []
    monkeypatch.setattr(
        pending_alerts,
        "create_pending_alert",
        lambda location_name, risk_level, risk_score, rainfall_mm_24h, river_level_m: created.append(location_name) or {"id": "p1"},
    )

    alerts.maybe_auto_trigger("Testville, Testland", "high", 90.0, 3.5, 0.9)
    alerts.maybe_auto_trigger("Testville, Testland", "low", 5.0, 0.5, 0.1)  # drops back down
    alerts.maybe_auto_trigger("Testville, Testland", "high", 92.0, 3.7, 0.92)  # crosses into high again

    assert created == ["Testville, Testland", "Testville, Testland"]
