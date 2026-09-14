"""Admin Command Center: incident management, AI triage, assistance
dispatch, dashboard stats, and the incident map — everything the web
dashboard needs beyond the citizen-facing
`GET`/`POST /api/hazard-reports` (+ photo) endpoints, which stay exactly
as they were (see `app/routes/hazard_reports.py`).

Every route here requires a real admin session — see
`Depends(get_current_admin)` on each one, backed by `app/auth.py`.
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth import get_current_admin
from app.models.priority_model import compute_priority
from app.models.risk_model import compute_risk
from app.models.sms_gateway import is_configured as is_sms_configured, send_sms
from app.models.voice_gateway import is_configured as is_voice_configured, place_call
from app.routes.hazard_reports import notify_reporter, read_hazard_reports, write_hazard_reports
from app.routes.pending_alerts import _read_pending as _read_pending_alerts
from app.routes.subscribers import read_subscribers

router = APIRouter()

REGIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "regions.json"

ReportStatus = Literal["new", "verifying", "prioritized", "assigned", "responding", "resolved"]
ResponseChannel = Literal["sms", "voice", "radio", "community_leader"]


class UpdateStatusRequest(BaseModel):
    status: ReportStatus


class VerifyReportRequest(BaseModel):
    verified: bool
    notes: str | None = None


class AssignRequest(BaseModel):
    assigned_to: str
    team: str | None = None
    notes: str | None = None


class SendResponseRequest(BaseModel):
    channel: ResponseChannel
    message: str
    # Only meaningful for radio/community_leader (station names, leader
    # contacts — freeform, not dialed via a paid API). Ignored for
    # sms/voice: see send_incident_response()'s docstring for why letting
    # an admin pick arbitrary phone numbers here was a real vulnerability.
    recipients: list[str] | None = None


def _read_regions() -> list[dict]:
    if not REGIONS_FILE.exists():
        return []
    return json.loads(REGIONS_FILE.read_text(encoding="utf-8"))


def _region_risk_level(location_name: str) -> str | None:
    """Best-effort match of a hazard report's freeform `location_name`
    against a monitored region in `regions.json`, so its "severity" can
    reflect real regional flood risk instead of always being "unknown".
    Tries an exact match first, then a substring match either direction
    (e.g. a report saying "Lagos" should still match the region
    "Lagos, Nigeria"). Returns `None` — not an error — if nothing matches,
    since most channels don't guarantee a report's location text lines up
    with one of the 10 sample cities."""
    target = (location_name or "").strip().lower()
    if not target:
        return None
    for region in _read_regions():
        region_name = region["location_name"].lower()
        if region_name == target or target in region_name or region_name.split(",")[0].strip() == target:
            risk_level, _score = compute_risk(region["rainfall_mm_24h"], region["river_level_m"])
            return risk_level
    return None


def _get_report_or_404(reports: list[dict], report_id: str) -> dict:
    report = next((r for r in reports if r["id"] == report_id), None)
    if report is None:
        raise HTTPException(status_code=404, detail=f"Unknown hazard report id: {report_id}")
    return report


def _with_priority(report: dict) -> dict:
    priority = compute_priority(report, _region_risk_level(report["location_name"]))
    return {**report, **priority}


@router.get("/api/admin/dashboard/stats")
def dashboard_stats(current_admin: dict = Depends(get_current_admin)) -> dict:
    """Aggregate counts for the dashboard's top summary tiles. Computed
    live from `hazard_reports.json` on every call — no caching, since the
    file is small and this is read far less often than reports are
    written."""
    reports = read_hazard_reports()
    priority_levels = [compute_priority(r, _region_risk_level(r["location_name"]))["priority_level"] for r in reports]

    by_status: dict[str, int] = {}
    for report in reports:
        status = report.get("status", "new")
        by_status[status] = by_status.get(status, 0) + 1

    pending_alerts_count = sum(1 for p in _read_pending_alerts() if p["status"] == "pending")

    return {
        "total_reports": len(reports),
        "critical_or_high_priority": sum(1 for level in priority_levels if level in ("critical", "high")),
        "assistance_needed": sum(1 for r in reports if r.get("needs_assistance")),
        "resolved": by_status.get("resolved", 0),
        "pending_alerts": pending_alerts_count,
        "by_status": by_status,
    }


@router.get("/api/admin/incidents/prioritized")
def prioritized_incidents(
    include_resolved: bool = Query(default=False),
    current_admin: dict = Depends(get_current_admin),
) -> list[dict]:
    """Every hazard report, ranked by `priority_score` (highest first),
    each with `priority_score`, `priority_level`, `severity`, and
    `factors` (the explainable breakdown — see
    `app/models/priority_model.py`) merged in. Resolved incidents are
    excluded by default (`?include_resolved=true` to include them) since
    a resolved report no longer needs triage attention."""
    reports = read_hazard_reports()
    if not include_resolved:
        reports = [r for r in reports if r.get("status") != "resolved"]
    enriched = [_with_priority(r) for r in reports]
    enriched.sort(key=lambda r: r["priority_score"], reverse=True)
    return enriched


@router.get("/api/admin/incidents/map")
def incidents_map(current_admin: dict = Depends(get_current_admin)) -> list[dict]:
    """Map-ready incident pins: `id`, `location_name`, `latitude`,
    `longitude`, `severity`, `priority_score`, `priority_level`, `status`.
    Skips reports with no GPS fix (`latitude`/`longitude` both `null`) —
    there's nothing to plot for those."""
    pins = []
    for report in read_hazard_reports():
        if report.get("latitude") is None or report.get("longitude") is None:
            continue
        priority = compute_priority(report, _region_risk_level(report["location_name"]))
        pins.append(
            {
                "id": report["id"],
                "location_name": report["location_name"],
                "latitude": report["latitude"],
                "longitude": report["longitude"],
                "severity": priority["severity"],
                "priority_score": priority["priority_score"],
                "priority_level": priority["priority_level"],
                "status": report.get("status", "new"),
                "needs_assistance": report.get("needs_assistance", False),
                "category": report.get("category"),
            }
        )
    return pins


@router.patch("/api/admin/incidents/{report_id}/status")
def update_incident_status(
    report_id: str,
    payload: UpdateStatusRequest,
    current_admin: dict = Depends(get_current_admin),
) -> dict:
    """Moves a report through New → Verifying → Prioritized → Assigned →
    Responding → Resolved. Any of the 6 statuses is accepted regardless of
    the current one (including moving backward, e.g. Assigned → Verifying
    if evidence turns out to need another look) — this endpoint records
    what happened, it doesn't enforce a strict state machine. Every change
    is appended to `status_history` with who made it and when, so the full
    timeline is always reconstructable.

    Also texts the original reporter when the new status is `"resolved"`
    and they left a phone number — closing the loop back to the specific
    person who reported, not just the region's subscriber list (see
    `notify_reporter()` in `app/routes/hazard_reports.py`)."""
    reports = read_hazard_reports()
    report = _get_report_or_404(reports, report_id)

    report["status"] = payload.status
    report.setdefault("status_history", []).append(
        {
            "status": payload.status,
            "changed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "changed_by": current_admin["email"],
        }
    )
    if payload.status == "resolved" and report.get("phone_number"):
        message = f"AfriShield: Your report near {report['location_name']} has been marked resolved. Thank you for reporting it."
        report.setdefault("reporter_notifications", []).append(notify_reporter(report["phone_number"], message))

    write_hazard_reports(reports)
    return report


@router.post("/api/admin/incidents/{report_id}/verify")
def verify_incident(
    report_id: str,
    payload: VerifyReportRequest,
    current_admin: dict = Depends(get_current_admin),
) -> dict:
    """Flags a report's evidence as verified (`verified: true`) or
    rejected as unreliable (`verified: false`) — a human judgment call an
    admin makes after reviewing the description/photo, not something this
    backend infers on its own. If the report is still at its default
    `"new"` status, this also advances it to `"verifying"`'s next stage,
    `"verifying"` → recorded in `status_history` — since reviewing
    evidence *is* the verifying step. Calling this again (e.g. to correct
    an earlier verification) always updates `verified`/`verified_by`/
    `verified_at`/`verification_notes`, but only nudges `status` forward
    the first time."""
    reports = read_hazard_reports()
    report = _get_report_or_404(reports, report_id)

    report["verified"] = payload.verified
    report["verified_by"] = current_admin["email"]
    report["verified_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report["verification_notes"] = payload.notes

    if report.get("status", "new") == "new":
        report["status"] = "verifying"
        report.setdefault("status_history", []).append(
            {"status": "verifying", "changed_at": report["verified_at"], "changed_by": current_admin["email"]}
        )

    write_hazard_reports(reports)
    return report


@router.get("/api/admin/assistance-requests")
def assistance_requests(current_admin: dict = Depends(get_current_admin)) -> list[dict]:
    """Reports with `needs_assistance: true`, enriched with the same
    priority breakdown as `GET /api/admin/incidents/prioritized`, ranked
    highest-priority first — the "who needs help right now, in what
    order" view."""
    reports = [r for r in read_hazard_reports() if r.get("needs_assistance")]
    enriched = [_with_priority(r) for r in reports]
    enriched.sort(key=lambda r: r["priority_score"], reverse=True)
    return enriched


@router.post("/api/admin/assistance-requests/{report_id}/assign")
def assign_incident(
    report_id: str,
    payload: AssignRequest,
    current_admin: dict = Depends(get_current_admin),
) -> dict:
    """Assigns a responder/team to a report (works for any report, not
    only ones with `needs_assistance: true` — the path lives under
    `assistance-requests` because that's its primary use case). Sets
    `status` to `"assigned"` and records the change in `status_history`,
    same as `PATCH .../status` would, so assigning is a one-call action
    rather than assign-then-separately-update-status.

    Also texts the original reporter, if they left a phone number, that
    help is on the way — the other half of closing the loop back to the
    specific person who reported (see `notify_reporter()` in
    `app/routes/hazard_reports.py`; `PATCH .../status` handles the
    "resolved" half)."""
    reports = read_hazard_reports()
    report = _get_report_or_404(reports, report_id)

    report["assigned_to"] = payload.assigned_to
    report["assigned_by"] = current_admin["email"]
    report["status"] = "assigned"
    report.setdefault("status_history", []).append(
        {
            "status": "assigned",
            "changed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "changed_by": current_admin["email"],
            "notes": f"Assigned to {payload.assigned_to}" + (f" ({payload.team})" if payload.team else "") + (f" — {payload.notes}" if payload.notes else ""),
        }
    )
    if report.get("phone_number"):
        message = f"AfriShield: Help has been assigned to your report near {report['location_name']} and is on the way."
        report.setdefault("reporter_notifications", []).append(notify_reporter(report["phone_number"], message))

    write_hazard_reports(reports)
    return report


@router.post("/api/admin/incidents/{report_id}/response", status_code=201)
def send_incident_response(
    report_id: str,
    payload: SendResponseRequest,
    current_admin: dict = Depends(get_current_admin),
) -> dict:
    """Sends a response about this incident via `sms`, `voice`, `radio`,
    or `community_leader`, and appends it to the report's response
    history (`GET .../responses`).

    **`sms`/`voice` recipients are always resolved from
    `subscribers.json` for the report's own region — never from a
    caller-supplied list.** Earlier this endpoint let an admin pass an
    arbitrary `recipients` array, which (combined with self-registerable
    admin accounts) turned this into an open SMS/voice relay against the
    org's paid Africa's Talking account, able to message any phone number
    at all, not just people actually affected by this incident. Real send
    if the region has subscribers and Africa's Talking is configured, a
    clearly labeled `"simulated"` send otherwise (`"no_recipients"` if the
    region genuinely has none registered).

    `radio` and `community_leader` still take `recipients` as freeform
    text (station names, leader contacts) — there's no paid per-message
    API behind either, so there's no abuse surface to close there. Both
    have no real dispatch integration at all (no radio station API or
    community-leader contact system has ever been built for this
    project) — every response on either channel is always `"simulated"`,
    logged honestly rather than pretending a real broadcast/call happened.

    Also advances `status` to `"responding"` if the report is still
    earlier in the workflow (New/Verifying/Prioritized/Assigned) — sending
    a response IS starting to respond. Never moves a `"resolved"` report
    backward."""
    reports = read_hazard_reports()
    report = _get_report_or_404(reports, report_id)

    if payload.channel in ("sms", "voice"):
        recipients = [s["phone_number"] for s in read_subscribers() if s["location_name"] == report["location_name"]]
        is_configured = is_sms_configured() if payload.channel == "sms" else is_voice_configured()
        if not recipients:
            send_status = "no_recipients"
        elif not is_configured:
            send_status = "simulated"
        else:
            try:
                if payload.channel == "sms":
                    send_sms(recipients, payload.message)
                else:
                    place_call(recipients, payload.message)
                send_status = "sent"
            except Exception:
                # e.g. the africastalking SDK rejects a malformed phone
                # number client-side before ever calling the API — never
                # let one bad number crash the whole response send.
                send_status = "failed"
    else:
        # radio / community_leader: no real dispatch integration exists;
        # payload.recipients here is freeform text, not phone numbers.
        recipients = payload.recipients or []
        send_status = "simulated"

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    response_entry = {
        "id": uuid.uuid4().hex,
        "channel": payload.channel,
        "message": payload.message,
        "recipients": recipients,
        "status": send_status,
        "sent_at": now,
        "sent_by": current_admin["email"],
    }
    report.setdefault("responses", []).append(response_entry)

    if report.get("status", "new") in ("new", "verifying", "prioritized", "assigned"):
        report["status"] = "responding"
        report.setdefault("status_history", []).append({"status": "responding", "changed_at": now, "changed_by": current_admin["email"]})

    write_hazard_reports(reports)
    return response_entry


@router.get("/api/admin/incidents/{report_id}/responses")
def incident_response_history(report_id: str, current_admin: dict = Depends(get_current_admin)) -> list[dict]:
    """Full response history for one report, oldest first — everything
    ever sent via `POST .../response`."""
    reports = read_hazard_reports()
    report = _get_report_or_404(reports, report_id)
    return report.get("responses", [])
