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

## Run

```bash
uvicorn app.main:app --reload
```

The API is at `http://localhost:8000`. Interactive docs (Swagger UI) are at
`http://localhost:8000/docs`.

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
  Talking to its subscribers (`app/data/subscribers.json`), by SMS
  (default) or voice call (`"channel": "voice"`); simulates the send
  (clearly labeled) if the matching credentials aren't set or the region
  has no subscribers yet. Also pushes a real notification (Firebase
  Cloud Messaging) to every device registered for this region via
  `POST /api/push-tokens`, additive alongside whichever channel was
  picked — see `push_status` in the response.
- `POST /api/push-tokens` / `DELETE /api/push-tokens/{token}` — real.
  Registers/unregisters a mobile device's FCM token against a region, so
  `POST /api/alerts/send` (manual or automatic) can push to it. See
  `app/routes/push_tokens.py`.
- `POST /api/ussd` — real. Africa's Talking USSD webhook: check a
  region's risk, or subscribe/unsubscribe a phone number, no smartphone
  needed. See `app/routes/ussd.py`.
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
  "Automatic alerts" below. See `app/routes/sensors.py` and
  `../hardware/wokwi-flood-sensor/`.
- `POST /api/admin/signup` / `POST /api/admin/login` / `GET /api/admin/me`
  — real. Admin Command Center authentication: bcrypt-hashed passwords,
  signed JWT bearer tokens (24h lifetime). See "Admin Command Center API"
  below.
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
- `app/models/train_ml_model.py` — the training script that produced
  `ml_risk_model.pkl`. Trains on **synthetic** data (clearly flagged in
  that file's docstring) standing in for real historical flood data. Run
  it directly to retrain: `python -m app.models.train_ml_model`.
- `app/models/fetch_real_training_data_dfo.py` +
  `app/models/validate_against_dfo.py` — real historical flood data
  (Dartmouth Flood Observatory, 49 events across all 10 cities) paired
  with real Open-Meteo rainfall/discharge, used to genuinely validate
  (not retrain) both risk scores against 239 real confirmed flood-days —
  see `docs/pitch-notes.md`'s "Real-data validation" section for the
  actual numbers, and `docs/progress-log.md`'s 2026-08-29 entry for why
  this stayed validation rather than becoming a production retrain
  (GloFAS discharge ≠ the model's river-level input, and the live
  sensor-reading endpoint has no history to compute a percentile from
  anyway).
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
  script, or are visually impaired). `POST /api/alerts/send` with
  `"channel": "voice"` uses this path instead of SMS.
- `app/data/subscribers.json` is the shared recipient list (used by both
  SMS and voice) — `{"phone_number": ..., "location_name": ...}` pairs.
  Starts empty; add entries by hand for testing, or use the USSD
  subscribe flow below.
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
  automatic via `maybe_auto_trigger()`) — it's not a third `channel`
  choice alongside `"sms"`/`"voice"`, since a device can want push
  *and* SMS at once.
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
