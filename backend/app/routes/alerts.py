import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.risk_model import risk_score_breakdown
from app.models.sms_gateway import is_configured as is_sms_configured, send_sms
from app.models.translations import build_alert_messages
from app.models.voice_gateway import is_configured as is_voice_configured, place_call
from app.models.push_gateway import is_configured as is_push_configured, send_push
from app.routes.push_tokens import read_push_tokens

router = APIRouter()

MOCK_DATA_FILE = Path(__file__).resolve().parents[3] / "docs" / "mock-data.json"
REGIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "regions.json"
SUBSCRIBERS_FILE = Path(__file__).resolve().parent.parent / "data" / "subscribers.json"
ALERT_LOG_FILE = Path(__file__).resolve().parent.parent / "data" / "alert_log.json"
ALERT_STATE_FILE = Path(__file__).resolve().parent.parent / "data" / "region_alert_state.json"


class SendAlertRequest(BaseModel):
    location_name: str


class SendAlertResponse(BaseModel):
    location_name: str
    risk_level: str
    message_sent: str
    sms_status: str
    voice_status: str
    recipients: int
    timestamp: str
    trigger: str
    push_status: str


def _read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _append_alert_log(entry: dict) -> None:
    log = _read_json(ALERT_LOG_FILE, [])
    log.append(entry)
    ALERT_LOG_FILE.write_text(json.dumps(log, indent=2), encoding="utf-8")


@router.get("/api/alerts")
def get_alerts() -> list[dict]:
    """Real send history, once at least one alert has gone through
    `POST /api/alerts/send` (logged to `app/data/alert_log.json`). Falls
    back to the original hardcoded `docs/mock-data.json` list on a fresh
    clone/demo where nothing has been sent yet, so the dashboard's alert
    history is never empty."""
    log = _read_json(ALERT_LOG_FILE, [])
    if log:
        return log
    mock_data = json.loads(MOCK_DATA_FILE.read_text(encoding="utf-8"))
    return mock_data["alerts"]


def _send_channel(is_configured: bool, phone_numbers: list[str], send_fn) -> str:
    """Shared status logic for SMS/voice, mirroring push's exact
    vocabulary (`"sent"` / `"simulated"` / `"failed"` / `"no_recipients"`)
    so all three channels report status the same way. `send_fn` is called
    with no arguments (a closure over the actual gateway call) so this
    helper doesn't need to know which gateway it's driving."""
    if not phone_numbers:
        return "no_recipients"
    if not is_configured:
        return "simulated"
    try:
        send_fn()
        return "sent"
    except Exception:
        # e.g. the africastalking SDK rejects a malformed phone number
        # client-side before ever calling the API — never let a single
        # bad number crash the whole alert send.
        return "failed"


def send_alert_for_region(location_name: str, trigger: str = "manual") -> dict:
    """The actual work behind `POST /api/alerts/send`, factored out so
    other code paths — specifically the automatic threshold trigger in
    `app/routes/sensors.py` — can send a real alert the exact same way a
    manual button-press does, without duplicating this logic.

    **Every subscriber gets both SMS and a voice call, always** — voice
    isn't a channel an admin has to remember to pick. Voice exists in
    this project specifically for people a text channel doesn't reach
    (can't read, don't read the local script, are visually impaired);
    making it opt-in per send meant that accessibility only worked when
    someone remembered to choose it. This mirrors how push already
    behaves: additive, not a channel choice.

    `trigger` is recorded in the log entry ("manual" or "automatic") so
    `GET /api/alerts` can honestly show which alerts a person sent versus
    which fired on their own — this matters for judging/demo trust, not
    just bookkeeping.

    Raises `LookupError` (not `HTTPException` — this function has no HTTP
    context) if `location_name` isn't in `app/data/regions.json`."""
    regions = _read_json(REGIONS_FILE, [])
    region = next((r for r in regions if r["location_name"] == location_name), None)
    if region is None:
        raise LookupError(f"Unknown region: {location_name}")

    breakdown = risk_score_breakdown(region["rainfall_mm_24h"], region["river_level_m"])
    risk_level = breakdown["risk_level"]
    _message_en, message_local, _local_language = build_alert_messages(location_name, risk_level)

    subscribers = _read_json(SUBSCRIBERS_FILE, [])
    phone_numbers = [s["phone_number"] for s in subscribers if s["location_name"] == location_name]

    sms_status = _send_channel(is_sms_configured(), phone_numbers, lambda: send_sms(phone_numbers, message_local))
    voice_status = _send_channel(is_voice_configured(), phone_numbers, lambda: place_call(phone_numbers, message_local))

    # Push is additive too, for devices that opted in via
    # POST /api/push-tokens (mobile app's Settings > Alert Channels >
    # "Mobile App" toggle). A failure here never breaks the alert itself;
    # SMS/voice already carries the message.
    push_tokens = [t["token"] for t in read_push_tokens() if t["location_name"] == location_name]
    if not push_tokens:
        push_status = "no_recipients"
    elif not is_push_configured():
        push_status = "simulated"
    else:
        try:
            send_push(push_tokens, f"{risk_level.upper()} flood risk: {location_name}", message_local)
            push_status = "sent"
        except Exception:
            push_status = "failed"

    entry = {
        "location_name": location_name,
        "risk_level": risk_level,
        "message_sent": message_local,
        "sms_status": sms_status,
        "voice_status": voice_status,
        "recipients": len(phone_numbers),
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "trigger": trigger,
        "push_status": push_status,
    }
    _append_alert_log(entry)
    return entry


def maybe_auto_trigger(location_name: str, risk_level: str) -> dict | None:
    """Automatically sends an SMS + voice alert the first time a region's
    risk crosses INTO "high" — not on every reading while it stays high,
    so a sensor reporting every 15 seconds (see
    `hardware/wokwi-flood-sensor/`) doesn't spam its subscribers with a
    duplicate alert each time.

    Tracks each region's last-seen risk_level in
    `app/data/region_alert_state.json` specifically to detect that
    transition — "still high" and "just became high" would look
    identical without remembering the previous reading.

    Returns the alert log entry if one was actually sent, or `None` if
    nothing fired (already high last time, or not high now).

    Called from `POST /api/sensor-reading` only — deliberately NOT wired
    into `POST /api/risk-check`, which is also used for a judge/dashboard
    "what-if" slider demo (see `docs/frontend-feature-spec.md`) that must
    stay side-effect-free; auto-firing a real SMS every time someone
    drags a demo slider into the red would be a bad surprise, not a
    feature."""
    state = _read_json(ALERT_STATE_FILE, {})
    previous_level = state.get(location_name)

    state[location_name] = risk_level
    ALERT_STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")

    if risk_level == "high" and previous_level != "high":
        return send_alert_for_region(location_name, trigger="automatic")
    return None


@router.post("/api/alerts/send", response_model=SendAlertResponse)
def send_alert(payload: SendAlertRequest) -> SendAlertResponse:
    """Sends a real alert via Africa's Talking for one of the monitored
    regions in `app/data/regions.json`, to every subscriber registered for
    that region in `app/data/subscribers.json` (subscribers are added via
    `POST /api/subscribers` or `POST /api/ussd`, or seeded by hand for
    testing).

    **Every subscriber gets both a text message and a phone call reading
    the alert aloud, always** — not a channel an admin has to pick. Voice
    exists in this project specifically for people a text-only channel
    doesn't reach (can't read, don't read the local script, are visually
    impaired); making it opt-in per send meant that accessibility only
    happened when someone remembered to choose it, so this doesn't ask.
    `sms_status`/`voice_status` in the response are each independently
    `"sent"`, `"simulated"` (Africa's Talking not configured), `"failed"`
    (a real send was attempted and errored), or `"no_recipients"` — so a
    voice outage, say, never hides whether the SMS half worked.

    Also pushes a real notification (Firebase Cloud Messaging) to every
    device registered for this region via `POST /api/push-tokens`,
    additive alongside SMS/voice the same way. `push_status` uses the
    identical vocabulary — `"sent"`, `"simulated"` (no Firebase project
    configured — see `app/models/push_gateway.py`), `"failed"`, or
    `"no_recipients"`.

    This is always `trigger: "manual"` in the log — see
    `POST /api/sensor-reading` for the automatic counterpart."""
    try:
        entry = send_alert_for_region(payload.location_name, trigger="manual")
    except LookupError:
        raise HTTPException(status_code=404, detail=f"Unknown region: {payload.location_name}")
    return SendAlertResponse(**entry)
