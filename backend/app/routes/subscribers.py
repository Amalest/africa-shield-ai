import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

SUBSCRIBERS_FILE = Path(__file__).resolve().parent.parent / "data" / "subscribers.json"


class SubscriberRequest(BaseModel):
    phone_number: str
    location_name: str


def read_subscribers() -> list[dict]:
    if not SUBSCRIBERS_FILE.exists():
        return []
    return json.loads(SUBSCRIBERS_FILE.read_text(encoding="utf-8"))


def write_subscribers(subscribers: list[dict]) -> None:
    SUBSCRIBERS_FILE.write_text(json.dumps(subscribers, indent=2), encoding="utf-8")


@router.post("/api/subscribers", status_code=201)
def register_subscriber(payload: SubscriberRequest) -> dict:
    """Registers a phone number for SMS/voice flood alerts for a region —
    the smartphone-app equivalent of the USSD "Subscribe to alerts" menu
    (`app/routes/ussd.py`), for a user who enters their number during
    onboarding instead of dialing a USSD code. A number already
    registered elsewhere is moved to the new region rather than
    duplicated, same one-region-at-a-time rule `POST /api/push-tokens`
    uses — matches the mobile app's single "my region" concept
    (Settings > Location)."""
    subscribers = [s for s in read_subscribers() if s["phone_number"] != payload.phone_number]
    subscribers.append({"phone_number": payload.phone_number, "location_name": payload.location_name})
    write_subscribers(subscribers)
    return {"phone_number": payload.phone_number, "location_name": payload.location_name}


@router.delete("/api/subscribers/{phone_number}")
def unregister_subscriber(phone_number: str) -> dict:
    """Removes a phone number from SMS/voice alerts. Always returns 200
    whether or not it was registered, same as `DELETE /api/push-tokens/
    {token}` — the caller's desired end state is satisfied either way."""
    subscribers = read_subscribers()
    remaining = [s for s in subscribers if s["phone_number"] != phone_number]
    write_subscribers(remaining)
    return {"removed": len(remaining) < len(subscribers)}
