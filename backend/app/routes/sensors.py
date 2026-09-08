import hmac
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.routes.alerts import maybe_auto_trigger
from app.routes.risk import RiskCheckResponse, build_risk_check_response

router = APIRouter()

DEVICES_FILE = Path(__file__).resolve().parent.parent / "data" / "devices.json"


class SensorReadingRequest(BaseModel):
    device_id: str
    device_key: str
    rainfall_mm_24h: float = Field(allow_inf_nan=False)
    river_level_m: float = Field(allow_inf_nan=False)
    timestamp: str


@router.post("/api/sensor-reading", response_model=RiskCheckResponse)
def sensor_reading(payload: SensorReadingRequest) -> RiskCheckResponse:
    """Ingests a live reading from a physical (or, for now, Wokwi-simulated)
    ESP32 flood sensor and scores it exactly the way `POST /api/risk-check`
    already does — see `build_risk_check_response()` in `app/routes/risk.py`,
    which this delegates to rather than re-implementing.

    A device only knows its own `device_id`, not a human-readable
    `location_name`/lat/lon — those are resolved here from
    `app/data/devices.json`, a small device-to-region registry (the same
    pattern as `subscribers.json`: seed by hand, since there's no device
    provisioning flow yet). 404s if `device_id` isn't registered, rather
    than guessing a location.

    **Requires `device_key`** matching that device's `device_key` in
    `devices.json` (401 if it doesn't match). Without this, `device_id`
    alone was enough to submit a reading — and the demo device's id
    (`esp32-demo-01`) is published in this repo's own README, so anyone
    could have spoofed a reading and triggered a real automatic alert.
    The key is a long random string, not a password an operator needs to
    remember — generate one with `python -c "import secrets;
    print(secrets.token_hex(16))"` for each new device.

    `rainfall_mm_24h`/`river_level_m` reuse the exact same
    `allow_inf_nan=False` field constraint `RiskCheckRequest` uses, so a
    NaN/Infinity reading is rejected the same way and hits the same
    `RequestValidationError` handler in `app/main.py` (the one that fixes
    the crash-on-non-finite-float bug) — no separate validation logic to
    keep in sync.

    `payload.timestamp` (the device's own clock, e.g. from Wokwi's
    simulated NTP sync) is accepted and validated but not surfaced in the
    response — the response shape is deliberately identical to
    `POST /api/risk-check`'s, so the frontend can render a device-
    originated reading with zero special-casing. Its `timestamp` field
    is the time this score was computed, same meaning as everywhere else
    that field appears.

    If this reading pushes the device's region into "high" risk for the
    first time (not just "still high" from the last reading), this also
    automatically sends a real SMS to that region's subscribers — see
    `maybe_auto_trigger()` in `app/routes/alerts.py` for the exact
    once-per-transition logic and why `/api/risk-check` doesn't do this
    too. A failure here never breaks the sensor-reading response itself;
    the reading is still scored and returned either way."""
    devices = json.loads(DEVICES_FILE.read_text(encoding="utf-8")) if DEVICES_FILE.exists() else []
    device = next((d for d in devices if d["device_id"] == payload.device_id), None)
    if device is None:
        raise HTTPException(status_code=404, detail=f"Unknown device_id: {payload.device_id}")
    if not hmac.compare_digest(payload.device_key, device.get("device_key", "")):
        raise HTTPException(status_code=401, detail="Invalid device_key for this device_id")

    response = build_risk_check_response(
        device["location_name"],
        device["latitude"],
        device["longitude"],
        payload.rainfall_mm_24h,
        payload.river_level_m,
    )
    maybe_auto_trigger(device["location_name"], response.risk_level)
    return response
