"""Read-only visibility into registered ESP32 flood sensors and their
recent readings — the "operators see data from sensors, not just the
derived 10-city regions.json numbers" view.

`app/data/devices.json` is the device-to-region registry (seeded by hand,
same pattern as `subscribers.json`); `app/data/sensor_readings.json` is a
capped log of the last `sensors.MAX_LOGGED_READINGS` readings across all
devices, written by `POST /api/sensor-reading`.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends

from app.auth import get_current_admin

router = APIRouter()

DEVICES_FILE = Path(__file__).resolve().parent.parent / "data" / "devices.json"
SENSOR_READINGS_FILE = Path(__file__).resolve().parent.parent / "data" / "sensor_readings.json"

# A device with no reading in this window is shown as "offline" rather
# than "online" — long enough to tolerate a normal reporting interval
# (the Wokwi demo reports every ~15s) without flapping between the two on
# every request.
ONLINE_WINDOW_MINUTES = 10


def _read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/api/admin/devices")
def list_devices(current_admin: dict = Depends(get_current_admin)) -> list[dict]:
    """Every registered sensor, each with its most recent reading (if
    any) and a simple online/offline status based on how long ago that
    reading came in. A device that has never reported has `last_reading:
    null` and `status: "never_reported"` rather than a guessed value."""
    devices = _read_json(DEVICES_FILE, [])
    readings = _read_json(SENSOR_READINGS_FILE, [])

    latest_by_device: dict[str, dict] = {}
    for reading in readings:
        device_id = reading["device_id"]
        if device_id not in latest_by_device or reading["received_at"] > latest_by_device[device_id]["received_at"]:
            latest_by_device[device_id] = reading

    now = datetime.now(timezone.utc)
    result = []
    for device in devices:
        latest = latest_by_device.get(device["device_id"])
        if latest is None:
            status = "never_reported"
        else:
            received_at = datetime.strptime(latest["received_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            status = "online" if now - received_at <= timedelta(minutes=ONLINE_WINDOW_MINUTES) else "offline"

        result.append(
            {
                "device_id": device["device_id"],
                "location_name": device["location_name"],
                "latitude": device["latitude"],
                "longitude": device["longitude"],
                "status": status,
                "last_reading": latest,
            }
        )
    return result
