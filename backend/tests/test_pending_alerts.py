"""Tests for the operator-review workflow (app/routes/pending_alerts.py) —
the safety mechanism that replaced the old "sensor crosses into high risk
-> real SMS goes out immediately, no human involved" behavior. This is the
highest-stakes logic added this session, so it gets the most coverage:
every state transition, every guard against acting twice, and the
fail-open auto-send path.
"""
from fastapi import HTTPException

import pytest

import app.routes.pending_alerts as pending_alerts


class _FakeTimer:
    """Stands in for threading.Timer so tests never actually spawn a
    15-minute background thread — records what it was armed with instead."""

    instances = []

    def __init__(self, interval, function, args=None):
        self.interval = interval
        self.function = function
        self.args = args or []
        self.started = False
        _FakeTimer.instances.append(self)

    def start(self):
        self.started = True

    def fire(self):
        """Test helper: actually run the timer's callback, simulating the
        real auto-send timer reaching its deadline."""
        self.function(*self.args)


@pytest.fixture(autouse=True)
def isolated_pending_alerts(tmp_path, monkeypatch):
    monkeypatch.setattr(pending_alerts, "PENDING_ALERTS_FILE", tmp_path / "pending_alerts.json")
    monkeypatch.setattr(pending_alerts, "threading", type("_M", (), {"Timer": _FakeTimer}))
    _FakeTimer.instances.clear()
    yield


@pytest.fixture
def fake_send(monkeypatch):
    """Stands in for alerts.send_alert_for_region so these tests never
    touch regions.json/subscribers.json/alert_log.json — returns a fixed
    log entry with an id, exactly like the real function's return shape."""
    calls = []

    def _fake(location_name, trigger="manual", message_override=None):
        calls.append({"location_name": location_name, "trigger": trigger, "message_override": message_override})
        return {"id": "fake-log-id", "location_name": location_name, "trigger": trigger}

    monkeypatch.setattr(pending_alerts, "send_alert_for_region", _fake)
    return calls


@pytest.fixture
def no_admin_phones(monkeypatch):
    """No admins have a phone on file — the notification step should be a
    silent no-op, not an error."""
    monkeypatch.setattr(pending_alerts, "list_admins", lambda: [{"phone_number": None}])


def _create(fake_send, no_admin_phones, **overrides):
    defaults = dict(location_name="Lagos, Nigeria", risk_level="high", risk_score=0.9, rainfall_mm_24h=90.0, river_level_m=3.5)
    defaults.update(overrides)
    return pending_alerts.create_pending_alert(**defaults)


def test_create_pending_alert_does_not_send_anything_immediately(fake_send, no_admin_phones):
    pending = _create(fake_send, no_admin_phones)
    assert pending["status"] == "pending"
    assert pending["alert_log_id"] is None
    assert fake_send == []  # the real alert was never sent


def test_create_pending_alert_arms_an_auto_send_timer(fake_send, no_admin_phones):
    _create(fake_send, no_admin_phones)
    assert len(_FakeTimer.instances) == 1
    timer = _FakeTimer.instances[0]
    assert timer.interval == pending_alerts.PENDING_ALERT_TIMEOUT_MINUTES * 60
    assert timer.started


def test_pending_list_only_shows_pending_status(fake_send, no_admin_phones):
    p1 = _create(fake_send, no_admin_phones, location_name="Lagos, Nigeria")
    _create(fake_send, no_admin_phones, location_name="Kampala, Uganda")
    pending_alerts.approve_pending_alert(p1["id"], pending_alerts.ReviewNotesRequest(notes=None), current_admin={"email": "a@a.com"})

    still_pending = pending_alerts.list_pending_alerts(current_admin={"email": "a@a.com"})
    assert len(still_pending) == 1
    assert still_pending[0]["location_name"] == "Kampala, Uganda"


def test_approve_sends_the_real_alert_and_records_who(fake_send, no_admin_phones):
    pending = _create(fake_send, no_admin_phones)
    result = pending_alerts.approve_pending_alert(
        pending["id"], pending_alerts.ReviewNotesRequest(notes="confirmed by phone"), current_admin={"email": "ops@afrishield.org"}
    )
    assert result["status"] == "approved"
    assert result["reviewed_by"] == "ops@afrishield.org"
    assert result["review_notes"] == "confirmed by phone"
    assert result["alert_log_id"] == "fake-log-id"
    assert fake_send[0]["trigger"] == "manual"  # an operator-approved send is "manual", not "automatic"


def test_approve_twice_is_rejected_with_409(fake_send, no_admin_phones):
    pending = _create(fake_send, no_admin_phones)
    pending_alerts.approve_pending_alert(pending["id"], pending_alerts.ReviewNotesRequest(notes=None), current_admin={"email": "a@a.com"})

    with pytest.raises(HTTPException) as exc_info:
        pending_alerts.approve_pending_alert(pending["id"], pending_alerts.ReviewNotesRequest(notes=None), current_admin={"email": "a@a.com"})
    assert exc_info.value.status_code == 409


def test_reject_never_sends_the_alert(fake_send, no_admin_phones):
    pending = _create(fake_send, no_admin_phones)
    result = pending_alerts.reject_pending_alert(
        pending["id"],
        pending_alerts.RejectRequest(reason="sensor_fault", notes="splashed during testing"),
        current_admin={"email": "ops@afrishield.org"},
    )
    assert result["status"] == "rejected"
    assert result["reject_reason"] == "sensor_fault"
    assert fake_send == []


def test_reject_requires_a_recognized_reason():
    with pytest.raises(ValueError):
        pending_alerts.RejectRequest(reason="just a bad vibe", notes=None)


def test_edit_and_send_uses_the_operators_own_wording(fake_send, no_admin_phones):
    pending = _create(fake_send, no_admin_phones)
    custom_message = "URGENT: verified by a field team, evacuate now."
    result = pending_alerts.edit_and_send_pending_alert(
        pending["id"],
        pending_alerts.EditAndSendRequest(message=custom_message, notes=None),
        current_admin={"email": "ops@afrishield.org"},
    )
    assert result["status"] == "approved"
    assert fake_send[0]["message_override"] == custom_message


def test_unknown_pending_alert_id_is_404(fake_send, no_admin_phones):
    with pytest.raises(HTTPException) as exc_info:
        pending_alerts.approve_pending_alert("does-not-exist", pending_alerts.ReviewNotesRequest(notes=None), current_admin={"email": "a@a.com"})
    assert exc_info.value.status_code == 404


def test_auto_send_fires_when_the_timer_reaches_its_deadline_and_nobody_acted(fake_send, no_admin_phones):
    _create(fake_send, no_admin_phones)
    timer = _FakeTimer.instances[0]

    timer.fire()  # simulate 15 minutes passing with no operator action

    history = pending_alerts.pending_alert_history(current_admin={"email": "a@a.com"})
    assert history[0]["status"] == "auto_sent"
    assert fake_send[0]["trigger"] == "automatic"
    assert pending_alerts.list_pending_alerts(current_admin={"email": "a@a.com"}) == []


def test_auto_send_does_nothing_if_an_operator_already_approved_it(fake_send, no_admin_phones):
    pending = _create(fake_send, no_admin_phones)
    timer = _FakeTimer.instances[0]

    pending_alerts.approve_pending_alert(pending["id"], pending_alerts.ReviewNotesRequest(notes=None), current_admin={"email": "ops@afrishield.org"})
    assert len(fake_send) == 1  # the approval's send

    timer.fire()  # the timer still fires afterward -- it must be a no-op now

    assert len(fake_send) == 1  # no second send happened
    history = pending_alerts.pending_alert_history(current_admin={"email": "a@a.com"})
    assert history[0]["status"] == "approved"  # not overwritten back to auto_sent


def test_auto_send_does_nothing_if_an_operator_already_rejected_it(fake_send, no_admin_phones):
    pending = _create(fake_send, no_admin_phones)
    timer = _FakeTimer.instances[0]

    pending_alerts.reject_pending_alert(
        pending["id"], pending_alerts.RejectRequest(reason="false_positive", notes=None), current_admin={"email": "ops@afrishield.org"}
    )
    timer.fire()

    assert fake_send == []  # never sent, rejection stands
    history = pending_alerts.pending_alert_history(current_admin={"email": "a@a.com"})
    assert history[0]["status"] == "rejected"


def test_notify_operators_is_skipped_silently_when_no_admin_has_a_phone(fake_send, no_admin_phones):
    # Should not raise even though is_sms_configured() is patched False by
    # the autouse conftest fixture AND no admin has a phone number at all.
    _create(fake_send, no_admin_phones)


def test_notify_operators_sends_to_every_admin_with_a_phone_on_file(fake_send, monkeypatch):
    monkeypatch.setattr(
        pending_alerts,
        "list_admins",
        lambda: [{"phone_number": "+254700000001"}, {"phone_number": None}, {"phone_number": "+254700000002"}],
    )
    sent_to = []
    monkeypatch.setattr(pending_alerts, "is_sms_configured", lambda: True)
    monkeypatch.setattr(pending_alerts, "send_sms", lambda numbers, message: sent_to.extend(numbers))

    _create(fake_send, None, location_name="Nairobi, Kenya")

    assert sorted(sent_to) == ["+254700000001", "+254700000002"]
