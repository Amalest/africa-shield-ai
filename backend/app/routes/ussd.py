import json
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.config import USSD_WEBHOOK_PASSWORD, USSD_WEBHOOK_USERNAME
from app.models.risk_model import risk_score_breakdown
from app.models.translations import build_alert_messages
from app.routes.subscribers import read_subscribers as _read_subscribers
from app.routes.subscribers import write_subscribers as _write_subscribers

router = APIRouter()

REGIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "regions.json"

_basic_auth = HTTPBasic(auto_error=False)


def _verify_webhook_caller(credentials: HTTPBasicCredentials | None = Depends(_basic_auth)) -> None:
    """Optional HTTP Basic Auth on this webhook — Africa's Talking lets
    you embed `user:pass@` directly in the callback URL you configure in
    their dashboard, so this needs no special client support, just a URL
    change. Without `USSD_WEBHOOK_USERNAME`/`PASSWORD` set, this is a
    no-op — matches this repo's documented local-testing workflow of
    posting raw form-encoded requests directly with curl. Set both before
    pointing a real USSD channel at a publicly reachable URL, or anyone
    on the internet can call this endpoint pretending to be any phone
    number, including to add/remove real subscribers via the menu below."""
    if not (USSD_WEBHOOK_USERNAME and USSD_WEBHOOK_PASSWORD):
        return
    valid = credentials is not None and secrets.compare_digest(
        credentials.username, USSD_WEBHOOK_USERNAME
    ) and secrets.compare_digest(credentials.password, USSD_WEBHOOK_PASSWORD)
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid USSD webhook credentials", headers={"WWW-Authenticate": "Basic"})


def _regions() -> list[dict]:
    return json.loads(REGIONS_FILE.read_text(encoding="utf-8"))


def _short_name(location_name: str) -> str:
    return location_name.split(",")[0]


def _region_menu(regions: list[dict]) -> str:
    return "\n".join(f"{i + 1}. {_short_name(r['location_name'])}" for i, r in enumerate(regions))


def _pick_region(regions: list[dict], choice: str) -> dict | None:
    try:
        index = int(choice) - 1
    except ValueError:
        return None
    if 0 <= index < len(regions):
        return regions[index]
    return None


@router.post("/api/ussd", dependencies=[Depends(_verify_webhook_caller)])
def ussd_callback(
    sessionId: str = Form(...),
    serviceCode: str = Form(...),
    phoneNumber: str = Form(...),
    text: str = Form(""),
) -> PlainTextResponse:
    """Africa's Talking USSD webhook — point a sandbox USSD channel's
    callback URL at this endpoint. `sessionId`/`serviceCode` are required
    by Africa's Talking's contract but unused here (no multi-step state is
    kept server-side; `text` alone encodes the whole session so far).

    `text` accumulates every choice made this session, `*`-separated (e.g.
    "1*3" = picked menu 1, then region 3) — that's Africa's Talking's
    session model, not ours. A response must start with `CON ` to keep the
    session open for another screen, or `END ` to close it. Content-type
    must be text/plain, hence `PlainTextResponse` rather than a normal
    FastAPI JSON model.

    Menu: 1) check flood risk for a region, 2) subscribe this phone number
    to SMS alerts for a region (writes to `app/data/subscribers.json`,
    read by `POST /api/alerts/send`), 3) unsubscribe from all regions.
    """
    choices = text.split("*") if text else []
    regions = _regions()

    if not choices:
        response = (
            "CON Welcome to Africa Shield AI\n"
            "1. Check flood risk\n"
            "2. Subscribe to alerts\n"
            "3. Unsubscribe from alerts"
        )
    elif choices[0] == "1":
        if len(choices) == 1:
            response = "CON Select a region:\n" + _region_menu(regions)
        else:
            region = _pick_region(regions, choices[1])
            if region is None:
                response = "END Invalid selection."
            else:
                breakdown = risk_score_breakdown(
                    region["rainfall_mm_24h"], region["river_level_m"]
                )
                _message_en, message_local, _local_language = build_alert_messages(
                    region["location_name"], breakdown["risk_level"]
                )
                response = (
                    f"END Flood risk in {_short_name(region['location_name'])} is "
                    f"{breakdown['risk_level'].upper()} (score {breakdown['risk_score']}).\n"
                    f"{message_local}"
                )
    elif choices[0] == "2":
        if len(choices) == 1:
            response = "CON Select region to receive alerts for:\n" + _region_menu(regions)
        else:
            region = _pick_region(regions, choices[1])
            if region is None:
                response = "END Invalid selection."
            else:
                subscribers = _read_subscribers()
                already = any(
                    s["phone_number"] == phoneNumber
                    and s["location_name"] == region["location_name"]
                    for s in subscribers
                )
                if not already:
                    subscribers.append(
                        {"phone_number": phoneNumber, "location_name": region["location_name"]}
                    )
                    _write_subscribers(subscribers)
                response = (
                    f"END You are now subscribed to flood alerts for "
                    f"{region['location_name']}."
                )
    elif choices[0] == "3":
        subscribers = [s for s in _read_subscribers() if s["phone_number"] != phoneNumber]
        _write_subscribers(subscribers)
        response = "END You have been unsubscribed from all flood alerts."
    else:
        response = "END Invalid selection."

    return PlainTextResponse(response)
