import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter()

HAZARD_REPORTS_FILE = Path(__file__).resolve().parent.parent / "data" / "hazard_reports.json"
HAZARD_REPORT_PHOTOS_DIR = Path(__file__).resolve().parent.parent / "data" / "hazard_report_photos"

MAX_PHOTO_BYTES = 8 * 1024 * 1024
ALLOWED_PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _sniff_image_extension(data: bytes) -> str | None:
    """Identifies a file's real type from its magic bytes, ignoring
    whatever `Content-Type` the client claimed — that header is
    caller-controlled and easy to spoof (e.g. upload an HTML/script file
    labeled `image/jpeg`). Returns `None` if the bytes don't match any of
    the 3 allowed image signatures, regardless of the claimed type."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


class HazardReportRequest(BaseModel):
    category: str
    description: str | None = None
    location_name: str
    needs_assistance: bool = False
    latitude: float | None = Field(default=None, allow_inf_nan=False)
    longitude: float | None = Field(default=None, allow_inf_nan=False)


class HazardReportResponse(BaseModel):
    id: str
    category: str
    description: str | None
    location_name: str
    needs_assistance: bool
    latitude: float | None
    longitude: float | None
    submitted_at: str
    has_photo: bool = False


def read_hazard_reports() -> list[dict]:
    if not HAZARD_REPORTS_FILE.exists():
        return []
    return json.loads(HAZARD_REPORTS_FILE.read_text(encoding="utf-8"))


def write_hazard_reports(reports: list[dict]) -> None:
    HAZARD_REPORTS_FILE.write_text(json.dumps(reports, indent=2), encoding="utf-8")


# Back-compat aliases for the rest of this file, written before this
# module's read/write helpers were made public for app/routes/admin_reports.py.
_read_reports = read_hazard_reports
_write_reports = write_hazard_reports


def _append_report(entry: dict) -> None:
    reports = _read_reports()
    reports.append(entry)
    _write_reports(reports)


@router.get("/api/hazard-reports")
def get_hazard_reports() -> list[dict]:
    """Citizen-submitted hazard/help reports, oldest first — same
    append-and-return-as-stored convention as `GET /api/alerts`. Empty
    list (not a 404) when nobody has reported anything yet.

    Each entry also carries the admin Command Center's incident-management
    fields (`status`, `status_history`, `verified`, `assigned_to`,
    `responses`, ...) — see `app/routes/admin_reports.py` for the
    endpoints that read/update them. Additive only; nothing here changes
    the original fields this endpoint has always returned."""
    return _read_reports()


@router.get("/api/hazard-reports/{report_id}")
def get_hazard_report(report_id: str) -> dict:
    """A single hazard report by id, full detail (including the
    incident-management fields `GET /api/hazard-reports` also returns).
    Unauthenticated, same as the list — no admin token required. 404 if
    `report_id` doesn't exist."""
    report = next((r for r in read_hazard_reports() if r["id"] == report_id), None)
    if report is None:
        raise HTTPException(status_code=404, detail=f"Unknown hazard report id: {report_id}")
    return report


@router.post("/api/hazard-reports", response_model=HazardReportResponse, status_code=201)
def create_hazard_report(payload: HazardReportRequest) -> HazardReportResponse:
    """A citizen reporting a hazard they're seeing, or flagging that they
    need help — matches the mobile app's "Reports" tab (`category`,
    `description`, `location_name`; `category` is freeform rather than a
    server-enforced enum since the mobile UI's category list — see
    `mobile-app/lib/data/hazard_report.dart`'s `hazardCategories` — is a
    suggestion, not the only valid set, and other channels (USSD, web)
    may want to send their own).

    `needs_assistance` distinguishes "I need help now" from a routine
    condition report ("water is rising on my street") — both are the
    same shape, just with different urgency, rather than two separate
    endpoints.

    `latitude`/`longitude` are optional — real when the caller has a GPS
    fix (the mobile app's onboarding and Reports screen both wire this up
    via `geolocator`), `null` otherwise. No reverse geocoding happens
    here or on the mobile side.

    No routing to a responder or dispatch of any kind happens here yet —
    this only persists the report to `app/data/hazard_reports.json` so it
    can be listed (`GET /api/hazard-reports`) and eventually shown on the
    admin dashboard. Deciding what happens with a `needs_assistance`
    report (who sees it, how fast) is a separate, not-yet-built piece.

    A photo can be attached afterward via
    `POST /api/hazard-reports/{id}/photo` — this endpoint never accepts
    one directly, since it's plain JSON, not multipart.

    Every report also starts with the admin Command Center's
    incident-management fields at their defaults — `status: "new"`,
    `verified: null`, `assigned_to: null`, `responses: []`. `citizen`
    callers (this endpoint's own response, per `HazardReportResponse`)
    never see these — they're additive fields for
    `app/routes/admin_reports.py`, not part of this endpoint's original
    contract."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entry = {
        "id": uuid.uuid4().hex,
        "category": payload.category,
        "description": payload.description,
        "location_name": payload.location_name,
        "needs_assistance": payload.needs_assistance,
        "latitude": payload.latitude,
        "longitude": payload.longitude,
        "submitted_at": now,
        "has_photo": False,
        # Incident-management fields — see app/routes/admin_reports.py.
        "status": "new",
        "status_history": [{"status": "new", "changed_at": now, "changed_by": None}],
        "verified": None,
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "assigned_to": None,
        "assigned_by": None,
        "responses": [],
    }
    _append_report(entry)
    return HazardReportResponse(**entry)


@router.post("/api/hazard-reports/{report_id}/photo", response_model=HazardReportResponse)
async def upload_hazard_report_photo(report_id: str, photo: UploadFile = File(...)) -> HazardReportResponse:
    """Attaches a photo to an already-created report — a separate step
    from `POST /api/hazard-reports` because that endpoint is plain JSON,
    not multipart. 404s if `report_id` doesn't exist; 415 if the file's
    actual bytes aren't one of JPEG, PNG, or WebP (checked by magic-byte
    signature, not by trusting the client's `Content-Type` header — that
    header is easy to spoof and previously was the only check); 413 if
    the file is over 8MB. Stored as a plain file on local disk
    (`app/data/hazard_report_photos/{report_id}.{ext}`) — matching this
    backend's existing "lightweight JSON-file + local storage" approach,
    not object storage. A second upload for the same `report_id`
    overwrites the first, keeping only the latest photo."""
    reports = _read_reports()
    report = next((r for r in reports if r["id"] == report_id), None)
    if report is None:
        raise HTTPException(status_code=404, detail=f"Unknown hazard report id: {report_id}")

    data = await photo.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo is too large (max 8MB).")

    extension = _sniff_image_extension(data)
    if extension is None:
        raise HTTPException(
            status_code=415,
            detail="File doesn't look like a JPEG, PNG, or WebP image (checked by content, not just its declared type).",
        )

    HAZARD_REPORT_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    for existing in HAZARD_REPORT_PHOTOS_DIR.glob(f"{report_id}.*"):
        existing.unlink()
    (HAZARD_REPORT_PHOTOS_DIR / f"{report_id}{extension}").write_bytes(data)

    report["has_photo"] = True
    _write_reports(reports)
    return HazardReportResponse(**report)


@router.get("/api/hazard-reports/{report_id}/photo")
def get_hazard_report_photo(report_id: str) -> FileResponse:
    """Serves the photo attached to a report, if any. 404 if the report
    doesn't exist or has no photo attached."""
    reports = _read_reports()
    report = next((r for r in reports if r["id"] == report_id), None)
    if report is None or not report.get("has_photo"):
        raise HTTPException(status_code=404, detail=f"No photo for hazard report id: {report_id}")

    matches = list(HAZARD_REPORT_PHOTOS_DIR.glob(f"{report_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"No photo file found for hazard report id: {report_id}")
    return FileResponse(matches[0])
