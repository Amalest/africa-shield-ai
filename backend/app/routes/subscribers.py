import json
import secrets
from datetime import datetime, timedelta, timezone
from hmac import compare_digest
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.sms_gateway import is_configured as is_sms_configured, send_sms

router = APIRouter()

SUBSCRIBERS_FILE = Path(__file__).resolve().parent.parent / "data" / "subscribers.json"
PENDING_VERIFICATIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "pending_subscriber_verifications.json"

CODE_LIFETIME = timedelta(minutes=10)


class RequestCodeRequest(BaseModel):
    phone_number: str


class SubscriberRequest(BaseModel):
    phone_number: str
    location_name: str
    code: str


def read_subscribers() -> list[dict]:
    if not SUBSCRIBERS_FILE.exists():
        return []
    return json.loads(SUBSCRIBERS_FILE.read_text(encoding="utf-8"))


def write_subscribers(subscribers: list[dict]) -> None:
    SUBSCRIBERS_FILE.write_text(json.dumps(subscribers, indent=2), encoding="utf-8")


def _read_pending() -> dict:
    if not PENDING_VERIFICATIONS_FILE.exists():
        return {}
    return json.loads(PENDING_VERIFICATIONS_FILE.read_text(encoding="utf-8"))


def _write_pending(pending: dict) -> None:
    PENDING_VERIFICATIONS_FILE.write_text(json.dumps(pending, indent=2), encoding="utf-8")


def _consume_valid_code(phone_number: str, code: str) -> bool:
    """Checks `code` against the pending verification for `phone_number`,
    deleting it either way (single-use — a code can't be replayed whether
    it succeeded or failed) except when it doesn't exist or is expired,
    where there's nothing to delete."""
    pending = _read_pending()
    entry = pending.get(phone_number)
    if entry is None:
        return False
    if entry["expires_at"] < datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"):
        del pending[phone_number]
        _write_pending(pending)
        return False
    matches = compare_digest(code, entry["code"])
    del pending[phone_number]
    _write_pending(pending)
    return matches


@router.post("/api/subscribers/verify/request", status_code=202)
def request_verification_code(payload: RequestCodeRequest) -> dict:
    """Step 1 of subscribing/unsubscribing a phone number: sends a 6-digit
    code to prove the caller actually controls `phone_number`, closing the
    gap where anyone could previously subscribe or — worse — unsubscribe
    *any* phone number just by knowing it, with zero proof of ownership.

    The code expires after 10 minutes and is single-use (consumed by
    `POST /api/subscribers` or `DELETE /api/subscribers/{phone_number}`
    below, whichever the caller is trying to do). Real SMS via the same
    `sms_gateway` every alert uses, when Africa's Talking is configured.

    **When SMS isn't configured, this returns the code directly in the
    response** (`"simulated": true`) instead of pretending one was sent —
    the same "never fake a success" pattern the rest of this backend
    follows, and the only way to test this flow at all without a real
    Africa's Talking account."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = (datetime.now(timezone.utc) + CODE_LIFETIME).strftime("%Y-%m-%dT%H:%M:%SZ")
    pending = _read_pending()
    pending[payload.phone_number] = {"code": code, "expires_at": expires_at}
    _write_pending(pending)

    if is_sms_configured():
        try:
            send_sms([payload.phone_number], f"Your AfriShield verification code is {code}. It expires in 10 minutes.")
        except Exception as exc:
            # e.g. the africastalking SDK rejects a malformed phone_number
            # client-side before ever calling the API. The code is still
            # stored (harmless — it just expires unused in 10 minutes);
            # report the real failure rather than claiming it was sent.
            raise HTTPException(status_code=502, detail=f"Failed to send verification SMS: {exc}")
        return {"sent": True, "simulated": False}
    return {
        "sent": False,
        "simulated": True,
        "code": code,
        "note": "SMS is not configured on this server — code shown here for testing only, never in a real deployment.",
    }


@router.post("/api/subscribers", status_code=201)
def register_subscriber(payload: SubscriberRequest) -> dict:
    """Registers a phone number for SMS/voice flood alerts for a region —
    the smartphone-app equivalent of the USSD "Subscribe to alerts" menu
    (`app/routes/ussd.py`), for a user who enters their number during
    onboarding instead of dialing a USSD code. A number already
    registered elsewhere is moved to the new region rather than
    duplicated, same one-region-at-a-time rule `POST /api/push-tokens`
    uses — matches the mobile app's single "my region" concept
    (Settings > Location).

    **Requires `code`** from `POST /api/subscribers/verify/request` for
    this same `phone_number`, matching and not yet expired (400
    otherwise) — see that endpoint's docstring for why."""
    if not _consume_valid_code(payload.phone_number, payload.code):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code — request a new one first")
    subscribers = [s for s in read_subscribers() if s["phone_number"] != payload.phone_number]
    subscribers.append({"phone_number": payload.phone_number, "location_name": payload.location_name})
    write_subscribers(subscribers)
    return {"phone_number": payload.phone_number, "location_name": payload.location_name}


@router.delete("/api/subscribers/{phone_number}")
def unregister_subscriber(phone_number: str, code: str) -> dict:
    """Removes a phone number from SMS/voice alerts. **Requires `code`**
    (query parameter) from `POST /api/subscribers/verify/request` for this
    same `phone_number` — previously anyone could unsubscribe *any* real
    phone number from real flood warnings just by knowing it, which is
    the single worst possible outcome for a life-safety alerting system.
    400 if the code is missing, wrong, or expired.

    Still always returns 200 (not 404) for an unregistered number once
    the code checks out, same as `DELETE /api/push-tokens/{token}` — the
    caller's desired end state is satisfied either way."""
    if not _consume_valid_code(phone_number, code):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code — request a new one first")
    subscribers = read_subscribers()
    remaining = [s for s in subscribers if s["phone_number"] != phone_number]
    write_subscribers(remaining)
    return {"removed": len(remaining) < len(subscribers)}
