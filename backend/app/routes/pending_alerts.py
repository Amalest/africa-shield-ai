"""Operator review queue for sensor-triggered community alerts.

Before this module existed, `app/routes/alerts.py`'s `maybe_auto_trigger()`
sent a real SMS + voice alert to every subscriber the instant a sensor
reading crossed into "high" risk — no human ever saw it coming. A single
noisy reading (a sensor glitch, a momentary spike, a spoofed device_key
guess) could fire a real alert with no way to stop it.

The policy here, as decided by the team: an automatic trigger creates a
**pending alert** instead of sending immediately, and notifies every admin
with a phone number on file by SMS. An operator can approve (send now),
edit the wording and send, or reject it (with a reason) from the Command
Center. If nobody responds within `PENDING_ALERT_TIMEOUT_MINUTES`, it sends
on its own anyway — this is deliberately fail-open: an occasional false
alarm is judged a better outcome than silently missing a real flood because
no one was watching the dashboard.

**Known limitation, stated honestly**: the auto-send timer
(`threading.Timer`) lives in-process. If the backend restarts while a
pending alert is armed, that timer is lost — the alert stays "pending"
until an operator manually approves/rejects it, rather than auto-sending
on schedule. Fine for a single-process hackathon deployment; a real
production version would need a persistent scheduler (e.g. a cron sweep
over `pending_alerts.json` checking `auto_send_at`) instead.
"""
import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_admin, list_admins
from app.models.sms_gateway import is_configured as is_sms_configured, send_sms
from app.routes.alerts import send_alert_for_region

router = APIRouter()

PENDING_ALERTS_FILE = Path(__file__).resolve().parent.parent / "data" / "pending_alerts.json"

# How long an operator has to approve/reject before the alert sends on its
# own. Short enough that a real flood warning doesn't sit unsent for hours;
# long enough for someone to actually notice the SMS nudge and open the
# dashboard. A judgment call, not a physical constant — change freely.
PENDING_ALERT_TIMEOUT_MINUTES = 15

RejectReason = Literal["false_positive", "sensor_fault", "already_resolved", "duplicate", "other"]


def _read_pending() -> list[dict]:
    if not PENDING_ALERTS_FILE.exists():
        return []
    return json.loads(PENDING_ALERTS_FILE.read_text(encoding="utf-8"))


def _write_pending(items: list[dict]) -> None:
    PENDING_ALERTS_FILE.write_text(json.dumps(items, indent=2), encoding="utf-8")


def _get_pending_or_404(items: list[dict], pending_id: str) -> dict:
    pending = next((p for p in items if p["id"] == pending_id), None)
    if pending is None:
        raise HTTPException(status_code=404, detail=f"Unknown pending alert id: {pending_id}")
    return pending


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _notify_operators(pending: dict) -> None:
    """Best-effort SMS nudge to every admin with a phone number on file.
    This is a notification only — operators still act from the Command
    Center (`POST .../approve` etc.), not by replying to the text. A
    failure here (SMS not configured, gateway error) never blocks the
    pending alert itself from being created or from auto-sending later."""
    if not is_sms_configured():
        return
    phone_numbers = [a["phone_number"] for a in list_admins() if a.get("phone_number")]
    if not phone_numbers:
        return
    message = (
        f"AfriShield: {pending['risk_level'].upper()} flood risk detected in "
        f"{pending['location_name']}. Review in the Admin Command Center within "
        f"{PENDING_ALERT_TIMEOUT_MINUTES} min or the community alert sends automatically."
    )
    try:
        send_sms(phone_numbers, message)
    except Exception:
        pass


def _auto_send_if_still_pending(pending_id: str) -> None:
    """Fires on a background timer armed when the pending alert was
    created. Sends the real community alert only if no operator has
    approved/rejected it by the deadline — the fail-open half of the
    policy (see module docstring)."""
    items = _read_pending()
    pending = next((p for p in items if p["id"] == pending_id), None)
    if pending is None or pending["status"] != "pending":
        return  # already approved/rejected — an operator got there first

    try:
        log_entry = send_alert_for_region(pending["location_name"], trigger="automatic")
    except LookupError:
        log_entry = None

    pending["status"] = "auto_sent"
    pending["reviewed_by"] = None
    pending["reviewed_at"] = _now_str()
    pending["alert_log_id"] = log_entry["id"] if log_entry else None
    _write_pending(items)


def create_pending_alert(
    location_name: str, risk_level: str, risk_score: float, rainfall_mm_24h: float, river_level_m: float
) -> dict:
    """Called from `maybe_auto_trigger()` instead of sending immediately.
    Creates the pending-review record, nudges operators by SMS, and arms
    the auto-send timer."""
    now = datetime.now(timezone.utc)
    pending = {
        "id": uuid.uuid4().hex,
        "location_name": location_name,
        "risk_level": risk_level,
        "risk_score": risk_score,
        "rainfall_mm_24h": rainfall_mm_24h,
        "river_level_m": river_level_m,
        "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "auto_send_at": (now + timedelta(minutes=PENDING_ALERT_TIMEOUT_MINUTES)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "pending",
        "reviewed_by": None,
        "reviewed_at": None,
        "review_notes": None,
        "reject_reason": None,
        "alert_log_id": None,
    }
    items = _read_pending()
    items.append(pending)
    _write_pending(items)

    _notify_operators(pending)

    timer = threading.Timer(PENDING_ALERT_TIMEOUT_MINUTES * 60, _auto_send_if_still_pending, args=[pending["id"]])
    timer.daemon = True
    timer.start()

    return pending


@router.get("/api/admin/alerts/pending")
def list_pending_alerts(current_admin: dict = Depends(get_current_admin)) -> list[dict]:
    """Sensor-triggered alerts currently awaiting operator review, oldest
    first. Resolved ones (approved/rejected/auto-sent) drop off this list
    — see `GET /api/admin/alerts/pending/history` for those."""
    items = [p for p in _read_pending() if p["status"] == "pending"]
    items.sort(key=lambda p: p["created_at"])
    return items


@router.get("/api/admin/alerts/pending/history")
def pending_alert_history(current_admin: dict = Depends(get_current_admin)) -> list[dict]:
    """Every pending alert ever created, regardless of outcome, newest
    first — the audit trail: who approved/rejected what, when, and why.
    Useful for noticing "this sensor throws a lot of false positives"
    patterns over time."""
    items = _read_pending()
    items.sort(key=lambda p: p["created_at"], reverse=True)
    return items


class ReviewNotesRequest(BaseModel):
    notes: str | None = None


@router.post("/api/admin/alerts/{pending_id}/approve")
def approve_pending_alert(
    pending_id: str, payload: ReviewNotesRequest, current_admin: dict = Depends(get_current_admin)
) -> dict:
    """Sends the alert right now instead of waiting out the auto-send
    timer — an operator who already reviewed it shouldn't have to wait
    out the full timeout."""
    items = _read_pending()
    pending = _get_pending_or_404(items, pending_id)
    if pending["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"This alert is already {pending['status']}, not pending")

    try:
        log_entry = send_alert_for_region(pending["location_name"], trigger="manual")
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    pending["status"] = "approved"
    pending["reviewed_by"] = current_admin["email"]
    pending["reviewed_at"] = _now_str()
    pending["review_notes"] = payload.notes
    pending["alert_log_id"] = log_entry["id"]
    _write_pending(items)
    return pending


class EditAndSendRequest(BaseModel):
    message: str
    notes: str | None = None


@router.post("/api/admin/alerts/{pending_id}/edit-and-send")
def edit_and_send_pending_alert(
    pending_id: str, payload: EditAndSendRequest, current_admin: dict = Depends(get_current_admin)
) -> dict:
    """Same as approve, but with the operator's own wording instead of
    the auto-generated message — e.g. to soften alarming phrasing or add
    context specific to what they can see that the sensor can't."""
    items = _read_pending()
    pending = _get_pending_or_404(items, pending_id)
    if pending["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"This alert is already {pending['status']}, not pending")

    try:
        log_entry = send_alert_for_region(pending["location_name"], trigger="manual", message_override=payload.message)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    pending["status"] = "approved"
    pending["reviewed_by"] = current_admin["email"]
    pending["reviewed_at"] = _now_str()
    pending["review_notes"] = payload.notes
    pending["alert_log_id"] = log_entry["id"]
    _write_pending(items)
    return pending


class RejectRequest(BaseModel):
    reason: RejectReason
    notes: str | None = None


@router.post("/api/admin/alerts/{pending_id}/reject")
def reject_pending_alert(
    pending_id: str, payload: RejectRequest, current_admin: dict = Depends(get_current_admin)
) -> dict:
    """Dismisses the pending alert — it never sends. Requires a reason so
    the history in `GET .../pending/history` can show real patterns (e.g.
    one device throwing repeated false positives) instead of just a pile
    of unexplained rejections."""
    items = _read_pending()
    pending = _get_pending_or_404(items, pending_id)
    if pending["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"This alert is already {pending['status']}, not pending")

    pending["status"] = "rejected"
    pending["reviewed_by"] = current_admin["email"]
    pending["reviewed_at"] = _now_str()
    pending["review_notes"] = payload.notes
    pending["reject_reason"] = payload.reason
    _write_pending(items)
    return pending
