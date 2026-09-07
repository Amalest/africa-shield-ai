"""Rules-based incident triage/priority scoring — the AI-priority feature
of the admin Command Center.

Same design choice as `app/models/risk_model.py`: a simple, explainable
weighted sum rather than an opaque model, so the dashboard can show an
admin exactly *why* one report outranks another, factor by factor. Five
factors, weights summing to 1.0:

- needs_assistance (0.40) — the reporter explicitly asked for help.
- region_risk_level (0.30) — the flood risk of the region the report is
  in, via `app/models/risk_model.py`/`app/data/regions.json`. This is
  "severity" (how dangerous is the *situation*), separate from priority's
  other factors (how urgently should *this specific report* be handled).
- category (0.15) — keyword-matched urgency of the freeform `category`
  field (e.g. "trapped"/"injured" outranks "heavy rainfall").
- evidence (0.05) — a photo was attached, making the report easier to
  verify quickly.
- report_age (0.10) — hours since submission, capped at 24h — an old,
  still-unresolved report should eventually surface even without a new
  signal, so nothing silently rots at the bottom of the queue.
"""
from datetime import datetime, timezone

_HIGH_URGENCY_KEYWORDS = ("trap", "injur", "drown", "collapse", "medical", "stranded", "rescue", "unconscious")
_MEDIUM_URGENCY_KEYWORDS = ("flooded home", "flooded road", "flood", "rising")

REGION_RISK_WEIGHT = {"high": 0.30, "medium": 0.15, "low": 0.0}
CRITICAL_THRESHOLD = 0.70
HIGH_THRESHOLD = 0.45
MEDIUM_THRESHOLD = 0.20


def _category_weight(category: str) -> float:
    text = (category or "").lower()
    if any(keyword in text for keyword in _HIGH_URGENCY_KEYWORDS):
        return 0.15
    if any(keyword in text for keyword in _MEDIUM_URGENCY_KEYWORDS):
        return 0.08
    return 0.0


def _report_age_hours(submitted_at: str) -> float:
    submitted = datetime.strptime(submitted_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return max((datetime.now(timezone.utc) - submitted).total_seconds() / 3600, 0.0)


def compute_priority(report: dict, region_risk_level: str | None) -> dict:
    """Returns `{priority_score, priority_level, severity, factors}` for
    one hazard report. `region_risk_level` is `"high"`/`"medium"`/`"low"`
    if `report["location_name"]` matches a monitored region in
    `regions.json`, or `None` if it doesn't (e.g. free-text location from
    a channel that isn't one of the 10 sample cities) — treated as the
    lowest weight, not an error, since an unmatched location is common and
    shouldn't itself suppress a report's priority from its other factors.

    `severity` is just `region_risk_level` (or `"unknown"`) surfaced under
    the name the incident-map UI expects — it reflects the danger of the
    *situation*, while `priority_score` reflects how urgently *this
    report* should be handled, which is a different question with
    overlapping but not identical inputs."""
    factors = {}
    score = 0.0

    assistance_weight = 0.40 if report.get("needs_assistance") else 0.0
    score += assistance_weight
    factors["needs_assistance"] = (
        f"Reporter explicitly requested help (+{assistance_weight:.2f})"
        if report.get("needs_assistance")
        else f"No explicit help request (+{assistance_weight:.2f})"
    )

    risk_weight = REGION_RISK_WEIGHT.get(region_risk_level, 0.0)
    score += risk_weight
    factors["region_risk_level"] = f"Region flood risk: {region_risk_level or 'unknown'} (+{risk_weight:.2f})"

    category_weight = _category_weight(report.get("category", ""))
    score += category_weight
    factors["category"] = f"Category '{report.get('category')}' (+{category_weight:.2f})"

    evidence_weight = 0.05 if report.get("has_photo") else 0.0
    score += evidence_weight
    factors["evidence"] = (
        f"Photo attached (+{evidence_weight:.2f})" if report.get("has_photo") else f"No photo attached (+{evidence_weight:.2f})"
    )

    age_hours = _report_age_hours(report["submitted_at"])
    age_weight = min(age_hours / 24, 1.0) * 0.10
    score += age_weight
    factors["report_age"] = f"{age_hours:.1f}h since submission (+{age_weight:.2f})"

    score = round(min(score, 1.0), 2)
    if score >= CRITICAL_THRESHOLD:
        priority_level = "critical"
    elif score >= HIGH_THRESHOLD:
        priority_level = "high"
    elif score >= MEDIUM_THRESHOLD:
        priority_level = "medium"
    else:
        priority_level = "low"

    return {
        "priority_score": score,
        "priority_level": priority_level,
        "severity": region_risk_level or "unknown",
        "factors": factors,
    }
