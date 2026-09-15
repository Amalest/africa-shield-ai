# Africa Shield AI — Backend

FastAPI service for the "Last-Mile Alert AI" flood demo: real rules-based
flood risk scoring, a genuine trained ML model as a second opinion,
multi-language alert generation, real SMS/USSD/voice alerts via Africa's
Talking, live IoT sensor ingestion (currently a Wokwi ESP32 simulation —
see `../hardware/wokwi-flood-sensor/`), citizen hazard reporting, and an
authenticated Admin Command Center API (incident management, AI triage,
assistance dispatch) for the web dashboard.

## Setup

```bash
cd backend
python -m venv .venv
# Windows (Git Bash): source .venv/Scripts/activate
# Windows (PowerShell): .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in AT_USERNAME/AT_API_KEY (+ AT_VOICE_NUMBER for voice) — optional, see below
```

Without a filled-in `.env`, everything still runs — `POST /api/alerts/send`
just labels every send as simulated instead of calling Africa's Talking.
Get free sandbox credentials at https://account.africastalking.com/.

Push notifications work the same way: without `FIREBASE_SERVICE_ACCOUNT_JSON`
set, `push_status` in the alert log just says `"simulated"` instead of
actually calling Firebase Cloud Messaging. Free to set up at
https://console.firebase.google.com/ — see `app/models/push_gateway.py`.

## Security fixes (2026-09-07)

A security audit found 5 high-severity gaps, all now fixed — full detail
in [`../docs/api-contract.md`](../docs/api-contract.md)'s status banner
and each affected endpoint's section, and `docs/progress-log.md`'s
2026-09-07 entry. Summary:

- **Admin signup had no gate at all** — anyone could create a full admin
  account. Fixed: `POST /api/admin/signup` now requires `signup_code`
  matching `ADMIN_SIGNUP_CODE` in `.env` (disabled entirely, `503`, if
  that's unset).
- **`ADMIN_JWT_SECRET` fell back to a fixed, publicly-known value** —
  forgeable by anyone who read this repo. Fixed: an unset one now
  generates a real random secret per process start instead (sessions
  just don't survive a restart without a persistent value). Added
  `POST /api/admin/logout` to revoke a token immediately rather than
  waiting out its 24h expiry.
- **Sensor ingestion had no authentication** — the demo `device_id` is
  published in this repo's own README, so anyone could spoof a reading
  and trigger a real automatic alert. Fixed: `POST /api/sensor-reading`
  now requires a per-device `device_key`.
- **Subscribing/unsubscribing a phone number had no ownership check** —
  anyone could add *or remove* any real number from real flood alerts.
  Fixed: both now require a one-time code from the new
  `POST /api/subscribers/verify/request`.
- **The USSD webhook trusted a caller-supplied phone number with no
  origin check.** Fixed: optional HTTP Basic Auth
  (`USSD_WEBHOOK_USERNAME`/`PASSWORD`), off by default for the documented
  local-testing workflow.
- Also fixed two medium-severity gaps: the admin incident-response
  endpoint could message arbitrary phone numbers (now always resolved
  from the incident's own region's real subscribers), and photo uploads
  trusted the client's declared `Content-Type` instead of the file's
  actual bytes (now checked by magic-byte signature). And CORS is now
  restrictable via `CORS_ALLOWED_ORIGINS` (still defaults to `*`).

## Run

```bash
uvicorn app.main:app --reload
```

The API is at `http://localhost:8000`. Interactive docs (Swagger UI) are at
`http://localhost:8000/docs`.

## Test

```bash
pytest
```

61 tests covering the highest-stakes logic: the rules-based risk formula
and its threshold boundaries, the AI-priority triage weighting, admin
auth (password hashing, JWT issuance/expiry/revocation), the real
alert-send pipeline, and — the newest and most safety-critical piece —
the operator-review pending-alert state machine (`app/routes/pending_alerts.py`),
including the fail-open auto-send-on-timeout path. Every test module
redirects that module's `SOMETHING_FILE` storage constant to a `tmp_path`
via `monkeypatch` (see `tests/conftest.py`), so running the suite never
reads or writes this project's real `app/data/*.json` files, and an
autouse fixture forces every SMS/voice send to the "simulated" path so
the suite runs fully offline with no real (even sandbox) Africa's
Talking API calls.

## Endpoints

See [`../docs/api-contract.md`](../docs/api-contract.md) for exact request/response
shapes. Summary:

- `POST /api/risk-check` — real. Computes the rules-based risk level/score
  and the ML model's second opinion from the posted rainfall/river level,
  plus a translated alert message.
- `GET /api/regions` — real. Computes both scores live for the 10 sample
  cities in `app/data/regions.json`.
- `GET /api/alerts` — real send history (`app/data/alert_log.json`) once
  something has been sent via `POST /api/alerts/send`; falls back to the
  hardcoded list in `../docs/mock-data.json` before that.
- `POST /api/alerts/send` — real. Sends a region's alert via Africa's
  Talking to its subscribers (`app/data/subscribers.json`). **As of
  2026-09-09, every subscriber gets both SMS and a voice call, always**
  — no more picking one via `"channel"` (removed). Each independently
  simulates (clearly labeled) if its credentials aren't set or the
  region has no subscribers yet — see `sms_status`/`voice_status` in the
  response. Also pushes a real notification (Firebase Cloud Messaging)
  to every device registered for this region via `POST /api/push-tokens`,
  additive the same way — see `push_status`.
- `POST /api/push-tokens` / `DELETE /api/push-tokens/{token}` — real.
  Registers/unregisters a mobile device's FCM token against a region, so
  `POST /api/alerts/send` (manual or automatic) can push to it. See
  `app/routes/push_tokens.py`.
- `POST /api/subscribers/verify/request` — real. Sends a one-time code to
  a phone number (real SMS if configured, returned directly in the
  response if not — never faked). Required before `POST`/`DELETE
  /api/subscribers` below will accept that number.
- `POST /api/subscribers` / `DELETE /api/subscribers/{phone_number}` —
  real. Registers/unregisters a phone number for SMS/voice alerts for a
  region — the smartphone-app equivalent of the USSD "Subscribe" menu.
  **Both require a fresh code from the endpoint above** (added
  2026-09-07 — previously neither had any ownership check at all, so
  anyone could subscribe *or unsubscribe* any real phone number just by
  knowing it). See `app/routes/subscribers.py`.
- `POST /api/ussd` — real. Africa's Talking USSD webhook: check a
  region's risk, or subscribe/unsubscribe a phone number, no smartphone
  needed. Optional HTTP Basic Auth (`USSD_WEBHOOK_USERNAME`/`PASSWORD`)
  as of 2026-09-07 — see "Security fixes" below. See `app/routes/ussd.py`.
- `POST /api/voice/callback` — real. Africa's Talking Voice webhook,
  called when a `channel: "voice"` alert is answered; responds with the
  queued alert text as speech. See `app/routes/voice.py`.
- `POST /api/hazard-reports` — real. A citizen reports a hazard they're
  seeing, or flags `"needs_assistance": true` if they need help — stored
  in `app/data/hazard_reports.json`. No dispatch/routing happens yet;
  this only persists the report. See `app/routes/hazard_reports.py`.
- `GET /api/hazard-reports` — real. Lists everything reported so far,
  oldest first. Empty list, not a 404, before anyone's reported.
- `POST /api/hazard-reports/{id}/photo` — real. Attaches a photo
  (JPEG/PNG/WebP, max 8MB) to an already-created report — multipart, so
  it's a separate call from the JSON `POST` above. Stored as a plain file
  on local disk (`app/data/hazard_report_photos/`), not object storage.
- `GET /api/hazard-reports/{id}/photo` — real. Serves the attached photo;
  404 if the report has none.
- `POST /api/sensor-reading` — real. Ingests a reading from a registered
  ESP32 flood sensor (`app/data/devices.json` resolves `device_id` to a
  region) and scores it exactly like `POST /api/risk-check` — same
  underlying function, same input validation, identical response shape.
  **Also auto-sends a real SMS** the first time this pushes the region
  into `"high"` (not on every reading while it stays high) — see
  "Automatic alerts" below. **Requires `device_key`** (per-device, in
  `devices.json`) as of 2026-09-07 — see "Security fixes" below. See
  `app/routes/sensors.py` and `../hardware/wokwi-flood-sensor/`.
- `POST /api/admin/signup` (**requires a shared `ADMIN_SIGNUP_CODE`** as
  of 2026-09-07) / `POST /api/admin/login` / `GET /api/admin/me` /
  `POST /api/admin/logout` — real. Admin Command Center authentication:
  bcrypt-hashed passwords, signed JWT bearer tokens (24h lifetime,
  revocable via logout). See "Admin Command Center API" below.
- `GET /api/admin/dashboard/stats`, `GET /api/admin/incidents/prioritized`,
  `GET /api/admin/incidents/map`, `PATCH /api/admin/incidents/{id}/status`,
  `POST /api/admin/incidents/{id}/verify`,
  `GET /api/admin/assistance-requests`,
  `POST /api/admin/assistance-requests/{id}/assign`,
  `POST /api/admin/incidents/{id}/response`,
  `GET /api/admin/incidents/{id}/responses` — real, all require an admin
  bearer token. Incident management, AI-explainable triage, and
  multi-channel response dispatch on top of `hazard_reports.json`. See
  "Admin Command Center API" below.

## Automatic alerts

- `POST /api/sensor-reading` calls `maybe_auto_trigger()`
  (`app/routes/alerts.py`) after scoring a reading — it sends a real
  alert the first time a region crosses into `"high"`, using the exact
  same `send_alert_for_region()` function `POST /api/alerts/send` uses,
  so there's one send code path, not two.
- `app/data/region_alert_state.json` tracks each region's last-seen risk
  level so "still high" doesn't re-fire the same alert every reading —
  gitignored, since it's runtime state, not seed data.
- `POST /api/risk-check` does **not** auto-trigger — it's also the
  judge/dashboard "what-if" slider demo, which needs to stay
  side-effect-free.
- `GET /api/alerts` entries now include `"trigger": "manual"` or
  `"trigger": "automatic"` so the history is honest about which is which.

## How the two risk scores work

- `app/models/risk_model.py` — the primary, rules-based score: an
  equal-weighted blend of normalized rainfall and normalized river level,
  bucketed into low/medium/high. Simple enough to explain and audit by hand.
- `app/models/ml_risk_model.py` — a genuine trained ML model (scikit-learn:
  `StandardScaler` + `LogisticRegression`) that runs alongside the
  rules-based score as a comparison, not a replacement. Loads
  `ml_risk_model.pkl` at import time — that file is committed to the repo
  so the server doesn't need to retrain on every start.
- `app/models/train_ml_model.py` — the training script that produces
  `ml_risk_model.pkl`. **As of 2026-09-14, trains on real historical
  data**, not synthetic — see below for how it got there and
  `train_ml_model.py`'s own docstring for the full three-attempt story.
  Run it directly to retrain: `python -m app.models.train_ml_model`.
- `app/models/fetch_real_training_data_dfo.py` +
  `app/models/validate_against_dfo.py` — real historical flood data
  (Dartmouth Flood Observatory, 49 events across all 10 cities) paired
  with real Open-Meteo rainfall/discharge, used to genuinely validate
  both risk scores against 239 real confirmed flood-days — see
  `docs/pitch-notes.md`'s "Real-data validation" section for the actual
  numbers. `app/models/dfo_features.py` holds the shared
  discharge-percentile-as-river-level approximation both this script and
  the one below use, so they can't silently drift apart.
- **Getting a real-data model into production took three attempts**
  (all documented honestly in `docs/progress-log.md`'s 2026-09-09 and
  2026-09-14 entries, because each one taught something real):
  1. Labeling a day "elevated" only if it fell inside a DFO-documented
     disaster's exact date range (`train_ml_model_real.py`,
     `evaluate_ml_loeo.py`) trains on real data, but DFO only catalogs
     headline, reported disasters — the resulting model learned a
     backwards relationship (more rainfall predicting *lower* risk)
     exactly in the "obviously severe" corner of input space, and
     predicted "low" for all 10 demo cities including Lagos. Caught
     before shipping, reverted.
  2. Annual-maxima return periods (`return_period_features.py`, kept as
     the record) turned out far stricter than DFO's real disasters
     actually reach — only 4.2% crossed even a 2-year threshold computed
     this way.
  3. **What worked**: relabel using a discharge-percentile cutoff
     calibrated via Youden's J against real DFO-confirmed days
     (`app/models/calibrated_percentile_labels.py`), instead of an exact
     date match or a block-maxima statistic. Multi-day rainfall
     accumulation (`accumulation_features.py`) was tried as a way to
     raise the ceiling further and didn't move it — river discharge
     already integrates upstream rainfall better than a city's own point
     rainfall history can.
- **Current production numbers**, leave-one-event-out cross-validated
  with the percentile threshold itself recalibrated inside every fold
  (`app/models/evaluate_calibrated_loeo.py`) — no leakage: **76.6%
  recall vs. rules-based's 41.0%, at ~35.8% false-positive rate vs.
  rules-based's 22.05%.** This is a real, disclosed trade-off, not a
  free win on both axes — the false-positive rate never drops below
  ~31% even at the strictest possible decision threshold, so don't cite
  this as "beats rules-based outright." Checked against all 10 demo
  `regions.json` cities: 8/10 exact match, the 2 misses each one tier
  low (undershooting, not falsely alarming).
- See [`../docs/architecture.md`](../docs/architecture.md)'s "Two risk
  scores, on purpose" section for why both are kept side by side.

## SMS/USSD/Voice alerts

- `app/models/sms_gateway.py` wraps the `africastalking` SDK behind
  `is_configured()`/`send_sms()`. Set `AT_USERNAME`/`AT_API_KEY` in `.env`
  (free sandbox account at https://account.africastalking.com/) to send
  real SMS; leave them unset to keep everything running in simulated mode.
- `app/models/voice_gateway.py` does the same for voice calls
  (`place_call()`), needs `AT_VOICE_NUMBER` too (your sandbox app's Voice
  number). A voice call reads the alert aloud when answered — for
  recipients a text-only channel doesn't reach (can't read, or the local
  script, or are visually impaired). **As of 2026-09-09, `POST
  /api/alerts/send` always uses this path alongside SMS, for every
  subscriber** — no longer a `"channel"` a caller has to pick.
- `app/data/subscribers.json` is the shared recipient list (used by both
  SMS and voice) — `{"phone_number": ..., "location_name": ...}` pairs.
  Starts empty; add entries by hand for testing, or use
  `POST /api/subscribers` (needs a verification code first, see
  `POST /api/subscribers/verify/request` — added 2026-09-07 so nobody can
  subscribe or unsubscribe a number that isn't theirs) or the USSD
  subscribe flow below (no code needed there — a real USSD session's
  phone number is asserted by the carrier, not the caller).
- To test USSD or voice without a real telecom, use Africa's Talking's
  sandbox simulators, pointed at your locally running server's
  `/api/ussd` or `/api/voice/callback` (needs a public URL — e.g.
  `ngrok http 8000` — since Africa's Talking calls these endpoints from
  their servers, not the other way around).
- All three endpoints are additive and safe to call with no
  configuration — see `POST /api/alerts/send`, `POST /api/ussd`, and
  `POST /api/voice/callback` in
  [`../docs/api-contract.md`](../docs/api-contract.md).

## Push notifications

- `app/models/push_gateway.py` wraps the `firebase-admin` SDK behind the
  same `is_configured()`/`send_push()` shape as `sms_gateway.py`. Set
  `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env` (a path to a service-account
  key from a free Firebase project) to send real pushes; leave it unset
  to keep `push_status` reporting `"simulated"`.
- `app/data/push_tokens.json` is the device registry —
  `{"token": ..., "location_name": ...}` pairs, populated by
  `POST /api/push-tokens` (the mobile app calls this when a user enables
  the "Mobile App" alert channel in Settings). Starts empty.
- Push is additive to every send in `POST /api/alerts/send` (manual or
  automatic via `maybe_auto_trigger()`) — same as SMS and voice, which
  are also both additive now rather than a `"channel"` choice (see
  `docs/progress-log.md`'s 2026-09-09 entry). A device can want push
  *and* SMS *and* voice all at once.
- The mobile app also needs its own Firebase config to obtain a device
  token in the first place, separate from this backend's service-account
  key — see `mobile-app/lib/firebase_options.dart`'s doc comment.

## IoT sensor ingestion

- `app/routes/sensors.py` (`POST /api/sensor-reading`) is a thin route:
  it resolves `device_id` → region via `app/data/devices.json`, then
  calls `build_risk_check_response()` (`app/routes/risk.py`) — the exact
  same function `POST /api/risk-check` calls — so a device reading and a
  manual risk-check are scored identically, by one code path, not two.
- `app/data/devices.json` maps `device_id` → `{location_name, latitude,
  longitude}`. Seeded with one demo device (`"esp32-demo-01"` →
  "Lagos, Nigeria"). Add entries by hand for more simulated/real devices.
- No real hardware exists yet — `../hardware/wokwi-flood-sensor/` is a
  Wokwi (browser-based) ESP32 simulation with two potentiometers standing
  in for a rain sensor and a water level sensor. See that folder's
  README for how to run it against this backend (needs a tunnel — Wokwi
  can't reach `localhost`, same constraint as the USSD/voice sandbox
  testing above).

## Admin Command Center API

Everything the admin web dashboard (`../frontend-web/`) needs beyond the
citizen-facing hazard-report endpoints: auth, incident management,
triage, assistance dispatch, and stats. Full request/response examples in
[`../docs/api-contract.md`](../docs/api-contract.md)'s "Admin Command
Center API" section.

- **Auth** — `app/auth.py`: bcrypt password hashing, PyJWT (HS256, 24h
  tokens), `app/data/admins.json` (gitignored — holds password hashes,
  never seed data). `get_current_admin` is a FastAPI dependency every
  admin-only route uses via `Depends(...)` — one place to change the auth
  rule if it ever needs to. `ADMIN_JWT_SECRET` (`app/config.py`) has a
  fixed demo fallback if unset in `.env` — real deployments must set
  their own, or tokens are forgeable (`app/auth.py` warns at import time
  if the default is still active).
- **Incident management** (`app/routes/admin_reports.py`) — every hazard
  report gains `status` (`new`/`verifying`/`prioritized`/`assigned`/
  `responding`/`resolved`, with a full `status_history` audit trail),
  `verified`/`verified_by`/`verified_at`/`verification_notes` (evidence
  review), and `assigned_to`/`assigned_by`. These fields are additive to
  `hazard_reports.json` — `GET`/`POST /api/hazard-reports` and the photo
  endpoints keep their exact existing behavior; only the admin routes
  read/write the new fields.
- **AI priority/triage** (`app/models/priority_model.py`) — same
  design philosophy as `risk_model.py`: a simple, explainable weighted
  sum (not an opaque model) so an admin can see exactly why one report
  outranks another. Five factors: `needs_assistance` (0.40),
  `region_risk_level` (0.30, via `risk_model.py`), `category` (0.15,
  keyword-matched urgency), `evidence` (0.05, has a photo), `report_age`
  (0.10, capped at 24h). `GET /api/admin/incidents/prioritized` and
  `GET /api/admin/assistance-requests` both rank by this score.
- **Response dispatch** — `POST /api/admin/incidents/{id}/response`
  reuses `sms_gateway.py`/`voice_gateway.py` exactly as
  `POST /api/alerts/send` does for `sms`/`voice` channels (real send if
  configured + recipients given, simulated otherwise). **`radio` and
  `community_leader` have no real integration at all** — there's no radio
  station API or community-leader contact system in this project — so
  those two channels are always logged as `"simulated"`, honestly, rather
  than faking a real broadcast.
- **Incident map** (`GET /api/admin/incidents/map`) — reuses the same
  `latitude`/`longitude` fields hazard reports already carry (from the
  mobile app's real GPS fix); skips reports with no fix rather than
  guessing a location.

## Translations

`app/models/translations.py` hardcodes English plus one of
Swahili/Arabic/Somali/French/Portuguese/Amharic per alert (mapped by
country, see that file for the mapping and fallback rules), with the
city name itself localized too where it differs from English (e.g.
"Cairo" → "القاهرة", "Addis Ababa" → "አዲስ አበባ" — see
`LOCALIZED_CITY_NAMES` in that file). 6 of these 7 languages
(English, Arabic, French, Portuguese, Swahili, Amharic) match the
African Union's official languages — Amharic substitutes for Spanish
per the organizer's guidance, since Spanish isn't relevant to our
flood-risk regions; Somali is a 7th, kept from before that alignment
since it's already reviewed and live via Mogadishu.

Swahili, Arabic, and Somali are reviewed and confirmed correct by
native speakers (2026-08-17). French, Portuguese, and Amharic (all
added 2026-08-17) are still AI-drafted placeholders — see the module
docstring and `docs/progress-log.md` for the team's decision to ship
unreviewed languages as-is for the hackathon rather than block on a
review pass. **Mozambique's mapping was corrected from English to
Portuguese the same day** — it was a real bug (Portuguese is
Mozambique's actual official language), not just a new addition; Maputo
is a live sample city, so this changed real output, not just added a
new option.
