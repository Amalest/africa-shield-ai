# API Contract — Africa Shield AI Backend

**Status (as of 2026-09-07, later same day): a security audit found and
fixed 5 high-severity gaps.** All are breaking changes to the affected
request shapes, not additive — see each endpoint's section for the exact
new required field:

- `POST /api/admin/signup` now requires `signup_code` (a shared invite
  code, `ADMIN_SIGNUP_CODE` in `.env`) — previously anyone could create a
  full admin account with no gate at all.
- `ADMIN_JWT_SECRET` no longer falls back to a fixed, publicly-known demo
  value — an unset one now generates a real random secret per process
  start instead (secure, but sessions don't survive a restart without a
  persistent value). New `POST /api/admin/logout` revokes a token
  immediately rather than leaving it valid until its natural 24h expiry.
- `POST /api/sensor-reading` now requires `device_key` (per-device, in
  `devices.json`) — previously `device_id` alone was enough, and the demo
  device's id is published in this repo's own README.
- `POST /api/subscribers` and `DELETE /api/subscribers/{phone_number}`
  now require `code` — proof of phone-number ownership via the new
  `POST /api/subscribers/verify/request`. Previously anyone could
  subscribe *or unsubscribe* any real phone number with zero proof,
  which for unsubscribing someone from real flood warnings was about as
  bad an outcome as this system could produce.
- `POST /api/ussd` gained optional HTTP Basic Auth
  (`USSD_WEBHOOK_USERNAME`/`PASSWORD`) — off by default (same local
  curl-testing workflow as before), but closes the gap where anyone
  could call this webhook directly, pretending to be any phone number.
- `POST /api/admin/incidents/{id}/response` no longer accepts caller-
  supplied `recipients` for `sms`/`voice` — they're now always resolved
  from the report's own region's real subscribers, closing what was
  effectively an open SMS/voice relay against the org's paid Africa's
  Talking account.
- `POST /api/hazard-reports/{id}/photo` now validates the uploaded file's
  actual magic bytes, not just its claimed `Content-Type` header.
- CORS is now restrictable via `CORS_ALLOWED_ORIGINS` (still defaults to
  `*` if unset).

**Status (as of 2026-09-07): the AfriShield Admin Command Center API is
real.** Admin signup/login (JWT bearer tokens), incident management
(status workflow, evidence verification), AI-explainable priority/triage
scoring, assistance-request assignment, multi-channel response sending
(sms/voice/radio/community_leader), response history, dashboard stats,
and an incident map — all built on top of the existing hazard-report
records. See the new "Admin Command Center API" section below. Fully
additive: `GET`/`POST /api/hazard-reports` and the photo endpoints are
**unchanged in their existing behavior** — every new field
(`status`, `verified`, `assigned_to`, `responses`, ...) is additive to
what a hazard report record carries, not a change to what those four
endpoints already returned. One new sibling endpoint,
`GET /api/hazard-reports/{report_id}` (a single report, unauthenticated
like its siblings), was added alongside them.

**Status (as of 2026-08-28): push notifications are real, additive to
every alert send.** Two new endpoints, `POST /api/push-tokens` and
`DELETE /api/push-tokens/{token}`, let a device register for/unregister
from real push notifications (Firebase Cloud Messaging). `POST
/api/alerts/send`'s response gained a new `push_status` field
(`"sent"` / `"simulated"` / `"failed"` / `"no_recipients"`) — additive,
no existing field changed. See those endpoints' sections below.

**Status (as of 2026-08-10): risk scoring and translation are real.**
`POST /api/risk-check` and `GET /api/regions` now compute live from the
rules-based model in `backend/app/models/risk_model.py` and the
translation dictionary in `backend/app/models/translations.py` — see
[`progress-log.md`](progress-log.md) for details.

**Status (as of 2026-08-17): SMS/USSD alerts are real.** Two new
endpoints, `POST /api/alerts/send` and `POST /api/ussd`, send real SMS via
Africa's Talking and serve a USSD self-service menu, respectively — see
their sections below and `docs/progress-log.md`'s 2026-08-17 entry. Both
are additive; no existing endpoint's shape changed. `GET /api/alerts` now
returns real send history once anything has gone through
`POST /api/alerts/send`, falling back to the original hardcoded list on a
fresh clone where nothing has been sent yet — see that endpoint's section.

**Status (as of 2026-08-17): device ingestion is real.** A new endpoint,
`POST /api/sensor-reading`, accepts a live reading from a registered
ESP32 flood sensor (currently a Wokwi simulation — see
`hardware/wokwi-flood-sensor/`) and scores it exactly the way
`POST /api/risk-check` does. Additive; no existing endpoint's shape
changed. See that endpoint's section below.

**Status (as of 2026-08-17): language coverage expanded to 7, and a
Mozambique bug fixed.** Portuguese and Amharic added (see
`local_language`'s field note below); DRC's French fix from earlier the
same day exposed the same bug in Mozambique's mapping, which was
silently returning English instead of Mozambique's actual official
language, Portuguese — now corrected. **This is a value change on an
existing live field for an existing region (Maputo), not just an
additive one** — flagged per standing instructions not to change
existing behavior without saying so; see `docs/progress-log.md`'s
2026-08-17 entry for the full reasoning. No field was renamed, removed,
or retyped.

**Status (as of 2026-08-18): alerts can fire automatically, not just on
demand.** `POST /api/sensor-reading` now auto-sends a real SMS the first
time a region's risk crosses into `"high"` (see that endpoint's
"Automatic alerting" section). `GET /api/alerts` gained a new `trigger`
field (`"manual"` / `"automatic"`) on real-send-log entries — additive,
no existing field changed. `POST /api/risk-check` is deliberately
unaffected — see the sensor-reading section for why.

**Status (as of 2026-08-28): citizen hazard/help reporting is real, with
GPS and photo attachment.** `POST /api/hazard-reports` and
`GET /api/hazard-reports` let a citizen report a hazard they're seeing
(or flag that they need help), optionally with a real GPS fix;
`POST /api/hazard-reports/{id}/photo` and
`GET /api/hazard-reports/{id}/photo` attach and serve a photo. See those
endpoints' sections below. Additive; no existing endpoint's shape
changed. No dispatch/routing to a responder exists yet — this only
persists and lists reports.

**Contract change (additive, non-breaking):** both `POST /api/risk-check`
and `GET /api/regions` gained a new `risk_score_breakdown` field (for a
"why this score" explainability view), and `GET /api/regions` gained
`population_estimate`. No existing field was renamed, removed, or
changed type — anything built against the previous shapes still works
unmodified; these are new fields to opt into. See
[`frontend-feature-spec.md`](frontend-feature-spec.md) for how to use them.

**Second contract change, also additive (2026-08-10): `ml_risk_level` and
`ml_risk_score`.** Both endpoints now also return a genuine trained-ML
"second opinion" alongside the existing rules-based `risk_level`/
`risk_score` — the rules-based fields are unchanged and remain primary;
the ML fields are new, optional-to-use additions. **Flagging this
explicitly, per standing instructions not to change the contract without
saying so** — this is intentional and requested (see
`docs/progress-log.md`'s 2026-08-10 "dual risk model" entry), not a
silent drift. See `backend/app/models/ml_risk_model.py` for how the score
is computed.

**Third contract change, also additive (2026-08-10): `country`,
`rainfall_mm_24h`/`river_level_m` promoted to top-level, and
`alert_message_en`/`alert_message_local`/`local_language` added to
`GET /api/regions`.** Prompted by a frontend teammate asking for the
exact schema and flagging four gaps — see `docs/progress-log.md`'s
2026-08-10 "API enrichment" entry for the full reasoning. Specifically:
- `country` (string) is now a field on both endpoints, parsed from
  `location_name`, so callers don't have to split the string themselves.
- `rainfall_mm_24h` and `river_level_m` are now top-level fields on both
  endpoints (previously only nested inside `risk_score_breakdown`). They
  remain in `risk_score_breakdown` too — this is a duplicate, additive
  copy for convenience, not a move.
- `latitude`/`longitude` are now echoed back in `POST /api/risk-check`'s
  response (previously only in the request).
- `GET /api/regions` now includes `alert_message_en`, `alert_message_local`,
  and `local_language` per region, computed the same way `/api/risk-check`
  does. Previously `GET /api/alerts` was the only source of alert text,
  and it's a separate 5-entry simulated stub, not one-per-region.
Again: no existing field was renamed, removed, or retyped.

Base URL (local dev): `http://localhost:8000`

---

## `POST /api/risk-check`

Score a location's flood risk from rainfall and river level, and get back
a ready-to-send alert message in English and one local language.

**Current status:** real — computes `risk_level`/`risk_score` from the
rules-based model and looks up the translated alert message. See
[`progress-log.md`](progress-log.md) for the thresholds and translation
mapping used.

### Request

```json
{
  "location_name": "Lagos, Nigeria",
  "latitude": 6.5244,
  "longitude": 3.3792,
  "rainfall_mm_24h": 85,
  "river_level_m": 3.2
}
```

| Field              | Type   | Notes                          |
|--------------------|--------|---------------------------------|
| `location_name`    | string | Human-readable "City, Country" |
| `latitude`          | float  |                                 |
| `longitude`         | float  |                                 |
| `rainfall_mm_24h`  | float  | Rainfall in the last 24 hours, mm |
| `river_level_m`    | float  | River level in meters           |

### Response

```json
{
  "location_name": "Cairo, Egypt",
  "country": "Egypt",
  "latitude": 30.0444,
  "longitude": 31.2357,
  "rainfall_mm_24h": 35.0,
  "river_level_m": 2.0,
  "risk_level": "medium",
  "risk_score": 0.42,
  "alert_message_en": "Flood risk is MEDIUM in Cairo. Stay alert and monitor local updates.",
  "alert_message_local": "خطر الفيضانات متوسط في القاهرة. توخَّ الحذر وتابع التحديثات المحلية.",
  "local_language": "Arabic",
  "timestamp": "2026-08-07T12:00:00Z",
  "risk_score_breakdown": {
    "rainfall_mm_24h": 35.0,
    "river_level_m": 2.0,
    "normalized_rainfall": 0.35,
    "normalized_river_level": 0.5,
    "rainfall_cap_mm": 100.0,
    "river_level_cap_m": 4.0,
    "high_threshold": 0.7,
    "medium_threshold": 0.4,
    "risk_level": "medium",
    "risk_score": 0.42
  },
  "ml_risk_level": "medium",
  "ml_risk_score": 0.43
}
```

| Field                  | Type   | Notes                                    |
|------------------------|--------|-------------------------------------------|
| `location_name`        | string | Echoed from the request                  |
| `country`              | string | **New.** Parsed from `location_name` (everything after the last comma). Empty string if `location_name` has no comma. |
| `latitude`             | float  | **New.** Echoed from the request.        |
| `longitude`            | float  | **New.** Echoed from the request.        |
| `rainfall_mm_24h`      | float  | **New.** Echoed from the request. Also present (same value) inside `risk_score_breakdown`. |
| `river_level_m`        | float  | **New.** Echoed from the request. Also present (same value) inside `risk_score_breakdown`. |
| `risk_level`           | string | `"low"` \| `"medium"` \| `"high"` — **rules-based, primary** |
| `risk_score`           | float  | 0.0–1.0 — **rules-based, primary**        |
| `alert_message_en`     | string | Human-readable alert, English            |
| `alert_message_local`  | string | Same alert, translated to `local_language`, **with the city name also localized** where the local name differs from English (e.g. "Cairo" → "القاهرة") — see `backend/app/models/translations.py`'s `LOCALIZED_CITY_NAMES`. **Right-to-left when `local_language` is `"Arabic"`** — the frontend must handle RTL display; this field is a plain string with no directionality markers. |
| `local_language`       | string | One of 7 languages: `"English"`, `"Swahili"`, `"Arabic"`, `"Somali"`, `"French"`, `"Portuguese"`, `"Amharic"`. 6 of these match the African Union's official languages (Amharic substituted for Spanish, per the organizer's guidance — Spanish isn't relevant to our flood-risk regions); Somali is kept as a 7th, predating that alignment. |
| `timestamp`            | string | ISO 8601, UTC                            |
| `risk_score_breakdown` | object | Explainability data for a "why this score" UI — see below. |
| `ml_risk_level`        | string | `"low"` \| `"medium"` \| `"high"` — the trained ML model's second opinion, bucketed with the same thresholds as the rules-based score (see `risk_score_breakdown.high_threshold`/`medium_threshold`). |
| `ml_risk_score`        | float  | 0.0–1.0, same scale as `risk_score`, from a logistic regression trained on synthetic data — see `docs/architecture.md`'s "Two risk scores, on purpose" section and `backend/app/models/train_ml_model.py`. Will often differ slightly from `risk_score`; that's expected, not a bug. |

`risk_score_breakdown` fields:

| Field                    | Type   | Notes                                          |
|--------------------------|--------|--------------------------------------------------|
| `rainfall_mm_24h`        | float  | Echoed input                                    |
| `river_level_m`          | float  | Echoed input                                    |
| `normalized_rainfall`    | float  | `rainfall_mm_24h / rainfall_cap_mm`, capped at 1.0 |
| `normalized_river_level` | float  | `river_level_m / river_level_cap_m`, capped at 1.0 |
| `rainfall_cap_mm`        | float  | Currently `100.0`                               |
| `river_level_cap_m`      | float  | Currently `4.0`                                 |
| `high_threshold`         | float  | Currently `0.7` — `risk_score` at/above this is `"high"` |
| `medium_threshold`       | float  | Currently `0.4` — `risk_score` at/above this is `"medium"` |
| `risk_level`             | string | Same value as the top-level `risk_level` (duplicated here for convenience) |
| `risk_score`             | float  | Same value as the top-level `risk_score` (duplicated here for convenience) |

---

## `POST /api/sensor-reading`

Ingests a live reading from a registered ESP32 flood sensor — currently a
Wokwi simulation (`hardware/wokwi-flood-sensor/`), since no real hardware
exists yet — and scores it exactly the way `POST /api/risk-check` does.
Internally, this is a thin wrapper: it resolves `device_id` to a region
via `backend/app/data/devices.json`, then calls the same scoring function
`/api/risk-check` uses (`build_risk_check_response()` in
`backend/app/routes/risk.py`) — not a reimplementation.

### Request

```json
{
  "device_id": "esp32-demo-01",
  "device_key": "4b6f310ce39fe80edc96aea8dce01438",
  "rainfall_mm_24h": 85.0,
  "river_level_m": 3.2,
  "timestamp": "2026-08-17T09:00:00Z"
}
```

| Field             | Type   | Notes                                                        |
|-------------------|--------|------------------------------------------------------------------|
| `device_id`       | string | Must match a `device_id` in `backend/app/data/devices.json` — 404 otherwise. |
| `device_key`      | string | **New, 2026-09-07.** Must match that device's `device_key` in `devices.json` — `401` otherwise. Closes a real gap: `device_id` alone used to be enough, and the demo device's id is published in this repo's own README, so anyone could have spoofed a reading and triggered a real automatic alert. Generate one per device with `python -c "import secrets; print(secrets.token_hex(16))"`. |
| `rainfall_mm_24h` | float  | Same `allow_inf_nan=False` constraint as `/api/risk-check` — a NaN/Infinity reading gets a clean 422, not a crash. |
| `river_level_m`   | float  | Same constraint as above.                                         |
| `timestamp`       | string | The device's own clock (e.g. Wokwi's simulated NTP time). Accepted and validated, but not echoed in the response — see below. |

### Response

**Identical shape to `POST /api/risk-check`'s response** (see above) —
`location_name`/`country`/`latitude`/`longitude` come from the device's
registry entry, not the request body; `timestamp` in the response is the
time this score was computed, not the device-reported `timestamp` from
the request (same meaning as everywhere else `timestamp` appears in this
API). This is deliberate: the frontend can render a device-originated
reading with the exact same code path as a manual risk-check, with zero
special-casing.

### Automatic alerting (new, 2026-08-18)

If this reading pushes the device's region into `"high"` risk **for the
first time** (not just "still high" from the last reading), this
endpoint also automatically sends a real SMS to every subscriber for
that region — logged to `GET /api/alerts` with `"trigger": "automatic"`.
Staying at `"high"` on subsequent readings does not re-send; dropping
back below `"high"` and rising into it again does. The last-seen level
per region is tracked in `backend/app/data/region_alert_state.json`.

**`POST /api/risk-check` deliberately does not do this** — it also backs
a judge/dashboard "what-if" slider demo (see
`docs/frontend-feature-spec.md`) that has to stay side-effect-free;
auto-sending a real SMS every time someone drags a demo slider into the
red would be a bad surprise, not a feature. Automatic alerting only
exists on the device-ingestion path.

### Device registry

`backend/app/data/devices.json` maps `device_id` → `{location_name,
latitude, longitude}`. Seeded with one demo entry
(`"esp32-demo-01"` → `"Lagos, Nigeria"`) for the Wokwi simulation. Add
entries by hand for additional simulated/real devices — there's no
device-provisioning flow yet.

---

## `GET /api/regions`

Static/mock list of monitored regions with their current risk levels, for
the dashboard's map/list view.

**Current status:** real — computes each region's `risk_level` live from
`backend/app/data/regions.json` via the same risk model used by
`/api/risk-check`.

### Response

```json
[
  {
    "location_name": "Lagos, Nigeria",
    "country": "Nigeria",
    "latitude": 6.5244,
    "longitude": 3.3792,
    "rainfall_mm_24h": 85,
    "river_level_m": 3.2,
    "risk_level": "high",
    "alert_message_en": "Flood risk is HIGH in Lagos. Move to higher ground and avoid riverbanks. Prioritize children, elderly people, and pregnant or nursing individuals when evacuating.",
    "alert_message_local": "Flood risk is HIGH in Lagos. Move to higher ground and avoid riverbanks. Prioritize children, elderly people, and pregnant or nursing individuals when evacuating.",
    "local_language": "English",
    "population_estimate": 15000000,
    "risk_score_breakdown": {
      "rainfall_mm_24h": 85,
      "river_level_m": 3.2,
      "normalized_rainfall": 0.85,
      "normalized_river_level": 0.8,
      "rainfall_cap_mm": 100.0,
      "river_level_cap_m": 4.0,
      "high_threshold": 0.7,
      "medium_threshold": 0.4,
      "risk_level": "high",
      "risk_score": 0.82
    },
    "ml_risk_level": "high",
    "ml_risk_score": 0.84
  }
]
```

An array of objects. `location_name`, `latitude`, `longitude`, and
`risk_level` are unchanged from before; everything else is additive:

| Field                    | Type   | Notes |
|--------------------------|--------|-------|
| `country`               | string | Parsed from `location_name`. |
| `rainfall_mm_24h`       | float  | This region's sample rainfall input. Also present (same value) inside `risk_score_breakdown`. |
| `river_level_m`         | float  | This region's sample river-level input. Also present (same value) inside `risk_score_breakdown`. |
| `alert_message_en` / `alert_message_local` / `local_language` | string | Computed the same way as `POST /api/risk-check`, from this region's `risk_level`. **This is the only place in `/api/regions` an alert message appears** — `GET /api/alerts` is a separate, unrelated 5-entry simulated stub, not one-per-region. |
| `population_estimate`   | int    | Rough public population figure for the city (e.g. commonly cited metro/city-proper estimates). **This is a general population figure, not a flood-exposure model** — it does not mean this many people are at risk of flooding, only that this many people live in the monitored area. See [`frontend-feature-spec.md`](frontend-feature-spec.md) for suggested UI copy that doesn't overstate this. |
| `risk_score_breakdown`  | object | Same shape as in `POST /api/risk-check`'s response, above — explainability data for a "why this score" UI. |
| `ml_risk_level`         | string | Same meaning as in `POST /api/risk-check` — the trained ML model's second opinion for this region's sample rainfall/river data. |
| `ml_risk_score`         | float  | Same meaning as in `POST /api/risk-check`. |

Currently 10 regions — see `backend/app/data/regions.json` for the
underlying sensor inputs and population figures.

---

## `GET /api/alerts`

Alert history, for the dashboard's alert history view.

**Current status:** real once something has been sent — returns
`backend/app/data/alert_log.json`, appended to by every call to
`POST /api/alerts/send` **and** every automatic send (see that endpoint's
section, and `POST /api/sensor-reading`, below). On a fresh clone/demo
where nothing has been sent yet, that log is empty, so this falls back to
the original hardcoded list from `mock-data.json` instead of returning
nothing.

### Response

```json
[
  {
    "location_name": "Lagos, Nigeria",
    "risk_level": "high",
    "message_sent": "Flood risk is HIGH in Lagos. Move to higher ground and avoid riverbanks. Prioritize children, elderly people, and pregnant or nursing individuals when evacuating.",
    "channel": "SMS (simulated)",
    "recipients": 1,
    "timestamp": "2026-08-17T07:47:30Z",
    "trigger": "manual",
    "push_status": "no_recipients"
  }
]
```

| Field            | Type   | Notes                                          |
|------------------|--------|--------------------------------------------------|
| `location_name`  | string |                                                  |
| `risk_level`     | string | `"low"` \| `"medium"` \| `"high"`              |
| `message_sent`   | string | The exact text that was (or would have been) sent/said, in the region's local language |
| `channel`        | string | `"SMS"` / `"Voice call"` when actually sent via Africa's Talking, `"SMS (simulated)"` / `"Voice call (simulated)"` when not (no credentials configured, or zero subscribers for that region) — see `POST /api/alerts/send` |
| `recipients`     | int    | **Only present on real-send-log entries.** Number of subscribers the message went to (0 for a simulated send). Absent on the older hardcoded `mock-data.json` entries returned as a fallback — don't assume it's always present. |
| `timestamp`      | string | ISO 8601, UTC                                   |
| `trigger`        | string | **New (2026-08-18).** `"manual"` (a person called `POST /api/alerts/send`) or `"automatic"` (a sensor reading pushed the region into `high` — see `POST /api/sensor-reading`). Only present on real-send-log entries, same caveat as `recipients`. |
| `push_status`    | string | **New (2026-08-28).** `"sent"` (real FCM push delivered), `"simulated"` (devices registered, but no Firebase project configured), `"failed"`, or `"no_recipients"` (no device registered for this region via `POST /api/push-tokens`). Push is additive to whichever `channel` was used, not a separate channel. Only present on real-send-log entries, same caveat as `recipients`. |

---

## `POST /api/alerts/send`

Sends a flood alert for one monitored region to every subscriber
registered for it, via Africa's Talking — SMS or a voice call that reads
the alert aloud (`channel: "voice"`; see `POST /api/voice/callback`
below), the latter for recipients a text-only channel doesn't reach
(can't read, or the local script, or are visually impaired). Real when
the matching credentials are configured (see `backend/.env.example`) and
the region has at least one subscriber; otherwise falls back to a clearly
labeled simulation so this is always safe to call.

Also pushes a real notification (Firebase Cloud Messaging) to every
device registered for this region via `POST /api/push-tokens`, regardless
of `channel` — push is additive, not a third channel choice, since a
device can want push *and* SMS at once. See `push_status` below.

### Request

```json
{
  "location_name": "Lagos, Nigeria",
  "channel": "sms"
}
```

| Field           | Type   | Notes                                                        |
|-----------------|--------|----------------------------------------------------------------|
| `location_name` | string | Must exactly match a `location_name` in `backend/app/data/regions.json` — 404 otherwise. |
| `channel`       | string | `"sms"` (default) or `"voice"`. |

### Response

Same shape as one entry of `GET /api/alerts`, above (includes `recipients`
and `trigger`). Calling this endpoint directly always logs
`"trigger": "manual"` — see `POST /api/sensor-reading` for the automatic
counterpart.

Recipients come from `backend/app/data/subscribers.json` — a list of
`{"phone_number": ..., "location_name": ...}` pairs, populated by
`POST /api/ussd`'s subscribe flow (or seeded by hand for testing).

---

## `POST /api/push-tokens`

Registers (or re-registers) a mobile device's FCM token against a
region, so `POST /api/alerts/send` can push a real notification to it.

### Request

```json
{
  "token": "fcm-device-token-abc123",
  "location_name": "Lagos, Nigeria"
}
```

| Field           | Type   | Notes                                                        |
|-----------------|--------|----------------------------------------------------------------|
| `token`         | string | The device's FCM registration token.                            |
| `location_name` | string | Freeform, same as `POST /api/hazard-reports` — not required to already exist in `regions.json`. |

### Response

`201 Created`, echoes the request body. A token already registered
elsewhere is moved to the new region rather than duplicated.

---

## `DELETE /api/push-tokens/{token}`

Unregisters a device token — called when push notifications are turned
off from the mobile app's Settings > Alert Channels.

### Response

```json
{ "removed": true }
```

Always `200`, whether or not `token` was actually registered — the
caller's desired end state ("this token gets no more pushes") is
satisfied either way.

---

## `POST /api/subscribers/verify/request`

**New, 2026-09-07.** Step 1 of subscribing or unsubscribing a phone
number: sends a 6-digit code to prove the caller actually controls it.
Closes a real gap — `POST`/`DELETE /api/subscribers` below used to have
no ownership check at all, so anyone could subscribe *or unsubscribe*
any real phone number just by knowing it.

### Request

```json
{ "phone_number": "+15551234567" }
```

### Response

```json
{ "sent": true, "simulated": false }
```

`202 Accepted`. Real SMS via the same `sms_gateway` `POST /api/alerts/send`
uses, when Africa's Talking is configured. **When it isn't**, the code
comes back directly in the response instead of pretending one was sent:

```json
{
  "sent": false,
  "simulated": true,
  "code": "485708",
  "note": "SMS is not configured on this server — code shown here for testing only, never in a real deployment."
}
```

The code expires after 10 minutes and is single-use — consumed by
`POST /api/subscribers` or `DELETE /api/subscribers/{phone_number}`
below, whichever the caller does next, and invalidated either way (a
wrong guess also burns it, so request a fresh one after a mistake).
`502` if Africa's Talking is configured but the send itself fails (e.g.
a malformed `phone_number` the SDK rejects client-side).

---

## `POST /api/subscribers`

Registers a phone number for SMS/voice flood alerts for a region — the
smartphone-app equivalent of the USSD "Subscribe to alerts" menu below,
for a user who enters their number during onboarding instead of dialing
a USSD code.

### Request

```json
{
  "phone_number": "+15551234567",
  "location_name": "Lagos, Nigeria",
  "code": "485708"
}
```

| Field           | Type   | Notes                                                        |
|-----------------|--------|------------------------------------------------------------------|
| `phone_number`  | string | A number already registered elsewhere is moved to this region rather than duplicated — one region at a time, matching `POST /api/push-tokens`. |
| `location_name` | string | Freeform — not required to already exist in `regions.json`.      |
| `code`          | string | **New, 2026-09-07.** From `POST /api/subscribers/verify/request` for this same `phone_number`, matching and not yet expired. `400` otherwise. |

### Response

`201 Created`, echoes `phone_number`/`location_name`.

---

## `DELETE /api/subscribers/{phone_number}`

Removes a phone number from SMS/voice alerts.

### Request

Query parameter `code` (required, **new 2026-09-07**) — same
verification code flow as `POST /api/subscribers` above. `400` if
missing, wrong, or expired. This is the more important half of the
fix: previously *removing* someone from real flood warnings needed no
proof at all, which is about as bad an outcome as this system could
produce.

### Response

```json
{ "removed": true }
```

Always `200` once the code checks out, whether or not the number was
actually registered — same end-state-satisfied contract as
`DELETE /api/push-tokens/{token}`.

---

## `POST /api/ussd`

Africa's Talking USSD webhook — point a sandbox USSD channel's callback
URL at this endpoint. Lets a subscriber, from any phone (no smartphone or
data connection needed), check a region's flood risk or subscribe/
unsubscribe to SMS alerts for it. This is the "last-mile" self-service
counterpart to `POST /api/alerts/send`'s push side.

**Optional HTTP Basic Auth, new 2026-09-07.** Set
`USSD_WEBHOOK_USERNAME`/`USSD_WEBHOOK_PASSWORD` in `.env` and embed them
in the callback URL you register with Africa's Talking
(`https://user:pass@yourdomain.com/api/ussd`) — `401` on a missing or
wrong credential once set. Off by default (matches this doc's own
"tested locally via raw curl" workflow), but closes a real gap: without
it, anyone on the internet could call this endpoint directly, supplying
any `phoneNumber` they like, and use the menu below to subscribe or
unsubscribe a real number they don't own. The subscribe/unsubscribe
menu itself deliberately does **not** also require the new
`POST /api/subscribers` verification code — a real USSD session's
`phoneNumber` is asserted by the telecom carrier through Africa's
Talking's actual infrastructure, not attacker-controlled, once this
webhook itself is protected.

### Request

Form-encoded (not JSON) — this is Africa's Talking's contract, not ours:

| Field         | Type   | Notes                                                              |
|---------------|--------|-----------------------------------------------------------------------|
| `sessionId`   | string | Required by Africa's Talking; unused by our handler.                 |
| `serviceCode` | string | Required by Africa's Talking; unused by our handler.                 |
| `phoneNumber` | string | The caller's phone number — used as the subscriber key.              |
| `text`        | string | `*`-separated choices accumulated over the session so far (e.g. `"2*1"`). Empty string on the first request. |

### Response

Plain text (not JSON), prefixed `CON ` to keep the session open for
another screen, or `END ` to close it:

```
CON Welcome to Africa Shield AI
1. Check flood risk
2. Subscribe to alerts
3. Unsubscribe from alerts
```

Menu tree: `1` → pick a region → risk level + score + local-language alert
text (same `alert_message_local` used by SMS, so Arabic regions reply in
Arabic, etc. — plain text, no RTL markup, same caveat as everywhere else
this field appears) (`END`). `2` → pick a region → subscribes
`phoneNumber` to that region in `subscribers.json` (`END`). `3` → removes
`phoneNumber` from every region it was subscribed to (`END`).

---

## `POST /api/voice/callback`

Africa's Talking Voice webhook — point a sandbox Voice number's callback
URL at this endpoint. Fires when a call placed by `POST /api/alerts/send`
(`channel: "voice"`) connects, and again when it ends. This endpoint is
never called directly by the frontend or a user — only by Africa's
Talking, as the second half of a voice alert.

### Request

Form-encoded (not JSON) — Africa's Talking's contract:

| Field               | Type   | Notes                                                          |
|---------------------|--------|--------------------------------------------------------------------|
| `sessionId`         | string | Required by Africa's Talking; unused by our handler.              |
| `isActive`          | string | `"1"` when the call just connected, `"0"` when it ended. We respond the same way regardless — Africa's Talking ignores the body once the call has ended. |
| `destinationNumber` | string | The number that was called — used to look up the message queued by `place_call()` right before the call was placed. |
| `callerNumber`      | string | Unused by our handler.                                             |

### Response

XML ("Voice Actions" format), not JSON:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="woman" playBeep="false">Flood risk is HIGH in Lagos. Move to higher ground and avoid riverbanks. Prioritize children, elderly people, and pregnant or nursing individuals when evacuating.</Say></Response>
```

If no message is queued for `destinationNumber` (e.g. a retried callback,
or an unrelated inbound call), reads a generic fallback line instead of
silently saying nothing.

**Caveat, not yet verified:** Africa's Talking's `<Say>` text-to-speech
language/accent support hasn't been tested against non-English alert
text (Arabic/Swahili/Somali/French) — confirm this works as expected
against the real sandbox before relying on it for a non-English region
in the demo.

---

## `POST /api/hazard-reports`

A citizen reports a hazard they're seeing ("water is rising on my
street"), or flags that they need help. Matches the mobile app's
"Reports" tab (see `mobile-app/lib/models/hazard_report.dart`), which
calls this for real.

**Current status:** real — persists to `backend/app/data/hazard_reports.json`
(gitignored, same runtime-state pattern as `alert_log.json`). No
dispatch/routing to a responder happens here; this only stores and lists
reports.

### Request

```json
{
  "category": "Water Rising",
  "description": "Trapped on roof, water still rising",
  "location_name": "Lagos, Nigeria",
  "needs_assistance": true,
  "latitude": 6.5244,
  "longitude": 3.3792
}
```

| Field              | Type    | Notes                                                        |
|--------------------|---------|-----------------------------------------------------------------|
| `category`         | string  | Freeform, not a server-enforced enum — the mobile UI's category list (`hazardCategories`) is a suggestion, not the only valid set. |
| `description`      | string? | Optional.                                                        |
| `location_name`    | string  | Freeform — not required to match a region in `regions.json`, unlike `POST /api/alerts/send`. |
| `needs_assistance` | bool    | Defaults to `false`. `true` distinguishes "I need help now" from a routine condition report — same shape either way, not two endpoints. |
| `latitude`         | float?  | Optional. Real GPS when the mobile app has a fix (onboarding and the Reports tab both wire this up via `geolocator`); `null` otherwise. No reverse geocoding — this is a raw coordinate, not an address. |
| `longitude`        | float?  | Optional, same caveat.                                           |

### Response

```json
{
  "id": "fe17044d53d645b088bc57b49448975c",
  "category": "Water Rising",
  "description": "Trapped on roof, water still rising",
  "location_name": "Lagos, Nigeria",
  "needs_assistance": true,
  "latitude": 6.5244,
  "longitude": 3.3792,
  "submitted_at": "2026-08-28T06:55:58Z",
  "has_photo": false
}
```

`201 Created`. `id` is a server-generated UUID4 hex string. `submitted_at`
is ISO 8601, UTC. `has_photo` is always `false` on creation — a photo can
only be attached afterward via `POST /api/hazard-reports/{id}/photo`,
below.

---

## `GET /api/hazard-reports`

Every report submitted so far, oldest first (same convention as
`GET /api/alerts`). Returns `[]`, not a 404, before anyone's reported
anything. Each entry is the same shape as `POST /api/hazard-reports`'s
response, above, **plus** the incident-management fields the Admin
Command Center API (below) reads and writes: `status`, `status_history`,
`verified`, `verified_by`, `verified_at`, `verification_notes`,
`assigned_to`, `assigned_by`, `responses`. See a full example under
`GET /api/hazard-reports/{report_id}` below.

---

## `GET /api/hazard-reports/{report_id}`

A single report by id, full detail. Unauthenticated, same as the list —
no admin token required. `404` if `report_id` doesn't exist.

### Response

```json
{
  "id": "693c9204318243e284dffcb114668d7a",
  "category": "Trapped - Flooded Home",
  "description": "Water rising fast, family stuck on roof",
  "location_name": "Lagos, Nigeria",
  "needs_assistance": true,
  "latitude": 6.5244,
  "longitude": 3.3792,
  "submitted_at": "2026-09-07T07:08:47Z",
  "has_photo": false,
  "status": "assigned",
  "status_history": [
    { "status": "new", "changed_at": "2026-09-07T07:08:47Z", "changed_by": null },
    { "status": "verifying", "changed_at": "2026-09-07T07:09:00Z", "changed_by": "habiba@afrishield-command.com" },
    { "status": "assigned", "changed_at": "2026-09-07T07:09:01Z", "changed_by": "habiba@afrishield-command.com", "notes": "Assigned to Lagos Rescue Team 2 (Water Rescue) — closest unit" }
  ],
  "verified": true,
  "verified_by": "habiba@afrishield-command.com",
  "verified_at": "2026-09-07T07:09:00Z",
  "verification_notes": "Photo matches location, credible",
  "assigned_to": "Lagos Rescue Team 2",
  "assigned_by": "habiba@afrishield-command.com",
  "responses": []
}
```

`status_history[].changed_by` is `null` for the initial `"new"` entry
(nobody "changed" it — it's the report's starting state) and an admin's
email for every subsequent change.

---

## `POST /api/hazard-reports/{report_id}/photo`

Attaches a photo to an already-created report. Separate from
`POST /api/hazard-reports` because this is multipart, not JSON.

### Request

Multipart form data, one field:

| Field   | Type | Notes                                                              |
|---------|------|-------------------------------------------------------------------|
| `photo` | file | JPEG, PNG, or WebP only (`415` otherwise); max 8MB (`413` otherwise). |

`404` if `report_id` doesn't match an existing report. **As of
2026-09-07, the JPEG/PNG/WebP check is done by reading the file's actual
magic bytes, not by trusting the `Content-Type` header the client
sends** — that header is easy to spoof (e.g. an HTML/script file
uploaded labeled `image/jpeg` used to pass this check).

### Response

Same shape as `POST /api/hazard-reports`'s response, with `has_photo:
true`. `200 OK`.

Stored as a plain file on local disk
(`backend/app/data/hazard_report_photos/{report_id}.{ext}`, gitignored)
— matches this backend's existing lightweight-storage approach, not
object storage. A second upload for the same `report_id` overwrites the
first; only the latest photo is kept.

---

## `GET /api/hazard-reports/{report_id}/photo`

Serves the photo attached to a report. `404` if the report doesn't exist
or has no photo. Response is the raw image file (`image/jpeg`,
`image/png`, or `image/webp`), not JSON.

### Response

Array of objects, same shape as `POST /api/hazard-reports`'s response,
above.

---

# Admin Command Center API

Everything the AfriShield Admin Command Center (`frontend-web/`) needs
beyond the citizen-facing hazard-report endpoints above: authentication,
incident management, AI-explainable triage, assistance dispatch, response
history, dashboard stats, and the incident map. All built on the same
`hazard_reports.json` records — an "incident" here always means a hazard
report.

**Authentication:** every route below except signup/login requires
`Authorization: Bearer <token>` on the request, where `<token>` is what
`POST /api/admin/signup` or `POST /api/admin/login` returned. Missing,
malformed, expired (24h lifetime), or otherwise invalid tokens get a
`401` with a `detail` message. There is no refresh-token flow — once a
token expires, log in again.

**Current status:** real, not a stub. Passwords are bcrypt-hashed before
ever touching disk; tokens are signed JWTs (HS256); admins persist to
`backend/app/data/admins.json` (gitignored, like `hazard_reports.json` —
holds password hashes, never committed). One real gap, flagged
explicitly: `ADMIN_JWT_SECRET` defaults to a fixed, publicly-known demo
value if unset in `.env`, so tokens are forgeable by anyone who reads this
repo's source until a real deployment sets its own secret — fine for the
hackathon demo, not for production. See `backend/.env.example`.

---

## `POST /api/admin/signup`

Creates a new admin account and logs them in immediately (no separate
login call needed right after signing up).

### Request

```json
{
  "name": "Habiba",
  "email": "habiba@afrishield-command.com",
  "password": "supersecret1",
  "signup_code": "the-shared-team-invite-code"
}
```

`password` must be at least 8 characters (`422` otherwise). `email` must
be a syntactically valid address (validated server-side); it's the unique
key for an admin account — signing up again with the same email is a
`409`. **`signup_code` is required as of 2026-09-07** — must match
`ADMIN_SIGNUP_CODE` in `backend/.env` (`403` if wrong). If the server has
no `ADMIN_SIGNUP_CODE` configured at all, signup is disabled outright
(`503`) rather than silently open to anyone. This closes a real gap:
signup previously had no gate at all, so any internet user could create
a full admin account.

### Response

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "admin": {
    "id": "a83f691ee83743f2a69a60b2b788f23b",
    "name": "Habiba",
    "email": "habiba@afrishield-command.com",
    "created_at": "2026-09-07T07:08:36Z"
  }
}
```

`201 Created`. `password`/`password_hash` never appear in any response.

---

## `POST /api/admin/login`

### Request

```json
{ "email": "habiba@afrishield-command.com", "password": "supersecret1" }
```

### Response

Same shape as signup's response, `200 OK`. `401` on a wrong email or
password — deliberately the same error either way, so this endpoint can't
be used to probe which emails are registered.

---

## `GET /api/admin/me`

Returns the profile of whoever the bearer token belongs to — for
verifying a stored token is still valid and showing "logged in as X"
without re-sending credentials.

### Response

```json
{
  "id": "a83f691ee83743f2a69a60b2b788f23b",
  "name": "Habiba",
  "email": "habiba@afrishield-command.com",
  "created_at": "2026-09-07T07:08:36Z"
}
```

---

## `POST /api/admin/logout`

**New, 2026-09-07.** Revokes the calling token immediately (adds its
`jti` claim to `app/data/revoked_jtis.json`), rather than leaving a
"logged out" token usable until its natural 24h expiry.

### Response

```json
{ "logged_out": true }
```

`200 OK`. Same `401`s as any other authenticated route for a missing/
invalid/expired/already-revoked token.

---

## `GET /api/admin/dashboard/stats`

Aggregate counts for the dashboard's summary tiles, computed live on
every call (no caching).

### Response

```json
{
  "total_reports": 2,
  "critical_or_high_priority": 1,
  "assistance_needed": 1,
  "resolved": 1,
  "by_status": { "resolved": 1, "new": 1 }
}
```

`critical_or_high_priority` counts reports whose `priority_level` (see
the triage section below) is `"critical"` or `"high"` — computed the same
way `GET /api/admin/incidents/prioritized` scores them, so the two stay
consistent.

---

## `GET /api/admin/incidents/prioritized`

Every hazard report — AI triage: ranked by `priority_score`, highest
first, each with an explainable factor breakdown. See
`backend/app/models/priority_model.py` for the full weighting.

**Query params:** `include_resolved` (bool, default `false`) — resolved
reports are excluded by default since they no longer need triage
attention.

### Response

```json
[
  {
    "id": "693c9204318243e284dffcb114668d7a",
    "category": "Trapped - Flooded Home",
    "location_name": "Lagos, Nigeria",
    "needs_assistance": true,
    "status": "new",
    "...": "...all the fields from GET /api/hazard-reports/{id}...",
    "priority_score": 0.85,
    "priority_level": "critical",
    "severity": "high",
    "factors": {
      "needs_assistance": "Reporter explicitly requested help (+0.40)",
      "region_risk_level": "Region flood risk: high (+0.30)",
      "category": "Category 'Trapped - Flooded Home' (+0.15)",
      "evidence": "No photo attached (+0.00)",
      "report_age": "0.0h since submission (+0.00)"
    }
  }
]
```

`priority_score` is 0.0–1.0, a weighted sum of five factors (weights sum
to 1.0): `needs_assistance` (0.40), `region_risk_level` (0.30, the
report's region's current flood risk from `regions.json`/
`risk_model.py`), `category` (0.15, keyword-matched urgency of the
freeform category text), `evidence` (0.05, a photo is attached), and
`report_age` (0.10, hours since submission, capped at 24h). `priority_level`
buckets the score: `critical` ≥0.70, `high` ≥0.45, `medium` ≥0.20,
else `low`. `severity` is the region's flood risk level (or `"unknown"`
if `location_name` doesn't match a monitored region) — a different
question from `priority_score` ("how dangerous is the situation" vs. "how
urgently should this specific report be handled"), included because the
incident map (below) needs both.

---

## `GET /api/admin/incidents/map`

Map-ready incident pins — only reports with a real GPS fix (both
`latitude` and `longitude` set); reports with neither are skipped, not
plotted with a guessed location.

### Response

```json
[
  {
    "id": "693c9204318243e284dffcb114668d7a",
    "location_name": "Lagos, Nigeria",
    "latitude": 6.5244,
    "longitude": 3.3792,
    "severity": "high",
    "priority_score": 0.85,
    "priority_level": "critical",
    "status": "resolved",
    "needs_assistance": true,
    "category": "Trapped - Flooded Home"
  }
]
```

---

## `PATCH /api/admin/incidents/{report_id}/status`

Moves a report through the workflow: `new` → `verifying` → `prioritized`
→ `assigned` → `responding` → `resolved`.

### Request

```json
{ "status": "resolved" }
```

`status` must be one of the six values above (`422` otherwise). Any
value is accepted regardless of the current status, including moving
backward (e.g. `assigned` → `verifying` if evidence needs a second look)
— this endpoint records what happened, it doesn't enforce a strict state
machine. `404` if `report_id` doesn't exist.

### Response

The full updated report (same shape as `GET /api/hazard-reports/{id}`),
`200 OK`, with a new entry appended to `status_history` recording the new
status, `changed_at`, and `changed_by` (the calling admin's email).

---

## `POST /api/admin/incidents/{report_id}/verify`

Flags a report's evidence as verified or rejected — a human judgment
call, not something inferred automatically.

### Request

```json
{ "verified": true, "notes": "Photo matches location, credible" }
```

`notes` is optional.

### Response

The full updated report, `200 OK`, with `verified`/`verified_by`/
`verified_at`/`verification_notes` set. If the report was still at its
default `"new"` status, this also advances it to `"verifying"` (recorded
in `status_history`) — reviewing evidence *is* the verifying step.
Calling this again (e.g. to correct an earlier call) always updates the
verification fields but only nudges `status` forward the first time.

---

## `GET /api/admin/assistance-requests`

Reports with `needs_assistance: true`, enriched with the same priority
breakdown as `GET /api/admin/incidents/prioritized`, ranked
highest-priority first — "who needs help right now, in what order."

### Response

Same shape as `GET /api/admin/incidents/prioritized`, filtered to
`needs_assistance: true` only.

---

## `POST /api/admin/assistance-requests/{report_id}/assign`

Assigns a responder/team to a report (works for any report id, not only
ones with `needs_assistance: true`).

### Request

```json
{
  "assigned_to": "Lagos Rescue Team 2",
  "team": "Water Rescue",
  "notes": "closest unit"
}
```

`team` and `notes` are optional.

### Response

The full updated report, `200 OK`. Sets `assigned_to`/`assigned_by`,
sets `status` to `"assigned"`, and appends a `status_history` entry — one
call does both, rather than assign-then-separately-update-status.

---

## `POST /api/admin/incidents/{report_id}/response`

Sends a response about this incident and logs it to the report's response
history.

### Request

```json
{
  "channel": "sms",
  "message": "Help is on the way, stay where you are",
  "recipients": ["Lagos FM"]
}
```

`channel` is one of `sms`, `voice`, `radio`, `community_leader`.
`recipients` is **only used for `radio`/`community_leader`** (freeform
station/leader names) — see below for why `sms`/`voice` ignore it.

### Response

```json
{
  "id": "a2a6db2f6adb401c9c395c9314522cc8",
  "channel": "sms",
  "message": "Help is on the way, stay where you are",
  "recipients": ["+258841234567"],
  "status": "sent",
  "sent_at": "2026-09-07T07:09:01Z",
  "sent_by": "habiba@afrishield-command.com"
}
```

`201 Created`. **As of 2026-09-07, `sms`/`voice` recipients are always
resolved from `subscribers.json` for the report's own region — never
from a caller-supplied list.** Previously an admin could pass an
arbitrary `recipients` array, which (combined with the also-just-fixed
open admin signup) turned this endpoint into an open SMS/voice relay
against the org's paid Africa's Talking account, able to message any
phone number at all, not just people actually affected by this
incident. Real send (`"status": "sent"`) if the region has subscribers
and Africa's Talking is configured; `"simulated"` if it's not
configured; `"no_recipients"` if the region genuinely has none
registered — never a fabricated success either way.

`radio` and `community_leader` still take `recipients` as freeform text
— there's no paid per-message API behind either, so there's no abuse
surface to close there. **Both have no real dispatch integration at
all** — no radio-station API or community-leader contact system has
ever been built for this project — so a response on either channel is
**always** `"simulated"`, logged honestly rather than pretending a real
broadcast or call happened. Also advances the report's
`status` to `"responding"` if it's still earlier in the workflow (never
moves a `"resolved"` report backward).

---

## `GET /api/admin/incidents/{report_id}/responses`

Full response history for one report, oldest first — everything ever
sent via `POST .../response`.

### Response

Array of objects, same shape as `POST .../response`'s response, above.
