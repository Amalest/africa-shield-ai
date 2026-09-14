# Progress Log — Africa Shield AI

Dated, factual session log for the whole team. Read the most recent entry
first for current state; scroll down for history.

---

## 2026-09-09 (later still) — Correction: the real-data ML numbers were leaked, and the fixed model isn't safe to deploy

**This corrects the entry immediately below — read this one first.** Two
real problems found while trying to actually ship what that entry
described, both caught before either one reached production.

### Problem 1: the 81.2%/62.5% numbers had a real leakage bug
DFO flood events span multiple consecutive days, and the training data
labels every day in an event's range. The random *row-level* train/test
split used below could put some days of one event in training and other
days of that SAME event in testing — the model could partly "recognize"
an event it had already seen pieces of, rather than genuinely
generalizing. Checked directly (`app/models/check_split_leakage.py`):
**19 of 29 real events had days on both sides of the split** — the
majority. Fixed properly with leave-one-event-out cross-validation
(`app/models/evaluate_ml_loeo.py`) — every one of the 29 real, usable
events held out and tested exactly once, predictions pooled across all
29 folds. **Corrected, trustworthy result: at threshold 0.80, 52.7%
recall / 17.95% false-positive rate — still genuinely better than
rules-based (41.0% recall / 22.05% FPR) on both axes**, just a smaller
margin than the leaked numbers claimed.

### Problem 2: the corrected model still isn't safe to deploy — a real calibration mismatch with the demo's own regions
Retrained a final model on 100% of the real usable data and wired it
into `ml_risk_model.py` at threshold 0.80 — then, before calling it
done, tested it against the actual `app/data/regions.json` sample
cities (not just the DFO test data) as a sanity check. **It predicted
"low" for all 10 demo cities, including Lagos and Kampala, which the
rules-based model correctly scores as "high" (0.82 and 0.89).** Root
cause: the model's training feature (a real discharge percentile scaled
onto the same 0-4m range as `river_level_m`) reflects how rare *actual
confirmed floods* are in 26 years of real history (239 of 40,904 days,
0.58%) — so the model's real-data-calibrated notion of "elevated" turns
out to be much more extreme than the hand-picked `regions.json` values,
which were tuned to "look sane" against the rules-based formula's 50/50
blend, not against this model's learned distribution. Two different
scales that happen to share the same 0-4 numeric range are not the same
scale.

**Reverted immediately** (`git checkout` on `ml_risk_model.py` and
`ml_risk_model.pkl`, confirmed back to the original synthetic-trained
model and its normal output) rather than shipping something that would
have made the ML "second opinion" look broken to judges in the actual
demo. The LOEO-CV finding above is still real and worth citing (a
genuine, validated improvement exists when the model sees inputs from
the same distribution it was trained on) — it just isn't safely
deployable against this project's specific hand-picked demo inputs
without more work.

### Current honest status
- Production (`ml_risk_model.py`) is unchanged — still the original
  synthetic-trained model, unaffected by any of this.
- The real-data-trained model, LOEO-CV-validated at 52.7% recall / 17.95%
  FPR vs. rules-based's 41.0%/22.05%, remains a genuine finding but is
  **not deployed and not currently deployable** without resolving the
  calibration mismatch above.
- `app/models/train_ml_model_real.py`, `tune_ml_threshold.py`,
  `check_split_leakage.py`, and `evaluate_ml_loeo.py` are all real,
  working, and kept for this reason — the analysis is sound, the
  deployment isn't ready.
- **`docs/AfriShield-ML-Evolution-Guide.pdf` and this file's entry below
  still state the leaked 81.2%/62.5% numbers and don't mention the
  calibration mismatch — due for a correction pass.**
- **Next step for anyone continuing this**: either recalibrate the
  demo's `regions.json` sample values to be consistent with real
  discharge percentiles for each city (a data-honesty question, not just
  a code one), or find a genuine way to reconcile the two scales, before
  attempting to deploy a real-data-trained model against this project's
  own demo inputs again.

---

## 2026-09-09 (later same day) — ML model retrained on real data, then threshold-tuned to beat the rules-based model

**Correction posted above, same day — the recall/FPR numbers in this
entry have a leakage bug, and the resulting model was found unsafe to
deploy. Read the entry above this one first.**

Real, meaningful follow-up to the 2026-08-29 DFO validation work — that
session only used real data to *check* the existing models; this one
uses it to actually *train* a new one, and finds a genuine improvement.

### Completed
- **Extracted shared real-data feature logic into
  `app/models/dfo_features.py`** (`load_usable_rows()`,
  `discharge_percentile_by_city()`, `build_pseudo_features()`) so
  `validate_against_dfo.py` and the new training script use the exact
  same discharge-percentile-as-river-level approximation instead of two
  copies drifting apart. Refactored `validate_against_dfo.py` to import
  from it and re-ran it to confirm byte-identical output to before the
  refactor (41.0%/28.0% recall, 21.99%/13.73% FPR — unchanged).
- **`app/models/train_ml_model_real.py`** — trains on the real
  `real_training_data_dfo.csv` (40,904 usable real rows, 239 real
  DFO-confirmed elevated-risk days) instead of synthetic data, with
  `class_weight="balanced"` to keep the rare flood class (0.58% of rows)
  from being ignored. Tried Logistic Regression and Random Forest; on a
  held-out 20% real test split (never seen during training — avoids the
  leakage risk of training and "validating" on the same data),
  **Logistic Regression won on recall: 81.2% vs. the old synthetic
  model's 27.1% and rules-based's 47.9% on this same held-out set** (not
  the full-239-row figures quoted elsewhere, which aren't a fair
  comparison to a model that trained on part of that data). Saved to
  `ml_risk_model_real.pkl` — **not yet wired into `ml_risk_model.py`**.
- **`app/models/tune_ml_threshold.py`** — swept the model's decision
  threshold (default is an implicit ~50% confidence cutoff) instead of
  accepting the default. Found **threshold 0.80: 62.5% recall, 17.69%
  false-positive rate — better than rules-based on both axes at once**
  (rules-based: 47.9% recall, 21.92% FPR), not a recall-for-FPR
  trade-off. Also reports the higher-recall end of the curve (threshold
  0.55: 87.5% recall, 42.15% FPR) as an option if the team ever wants to
  prioritize catching more floods over fewer false alarms.
- **Caught and fixed a real bug while building the threshold sweep**: an
  early version of its recall metric used a looser "elevated vs. low"
  definition than `validate_against_dfo.py`/`train_ml_model_real.py`'s
  stricter "predicted level must meet or exceed the true level"
  definition, which silently inflated recall numbers and made results
  incomparable across scripts. Fixed before reporting any numbers
  publicly — caught by cross-checking the rules-based/old-ML figures
  against already-known values from the other two scripts, which didn't
  match until the metric was unified.
- Wrote `docs/AfriShield-ML-Evolution-Guide.pdf` — a beginner-friendly,
  5-chapter walkthrough of this whole progression (hand-written formula
  → synthetic ML → real-data validation reality check → real-data
  training → threshold tuning) plus a 12-term glossary (recall, false
  positive, FPR, precision, threshold, class imbalance, class weight
  balancing, Logistic Regression, training/test data, overfitting,
  Youden's J), for sharing with non-ML teammates.

### Not yet started
- **The tuned real-data model is not wired into production.**
  `ml_risk_model.py`'s `predict_ml_risk()` still loads the old
  synthetic-trained `ml_risk_model.pkl` and uses the severity-weighted
  blend approach, not `ml_risk_model_real.pkl` with a 0.80 threshold.
  Swapping it in needs: replacing the loaded model file, changing
  `predict_ml_risk()`'s decision logic to threshold-based instead of
  blend-based, and re-verifying `POST /api/risk-check` and
  `GET /api/regions` end-to-end afterward.
- The discharge-percentile-as-river-level approximation is still real,
  still honest, but still an approximation — same standing caveat as the
  2026-08-29 validation work.
- No decision yet on which threshold to actually ship (0.80's "beats
  rules-based on both axes" is the easy, defensible pick; 0.55's "catch
  almost everything" is a real option too, just with a real false-alarm
  cost) — a team call, not a technical one.

---

## 2026-09-09 — Voice alerts made additive, matching push (no longer a `channel` choice)

Closes a real accessibility gap: voice existed in this project
specifically for people a text-only channel doesn't reach, but was only
sent if an admin remembered to pick `"channel": "voice"` on a given send
— meaning that accessibility depended on someone else's manual choice,
not on the recipient's actual need.

### Completed
- **`POST /api/alerts/send` now sends both SMS and a voice call to every
  subscriber, always.** Removed the `channel` request field entirely (no
  more `"sms"` vs `"voice"` choice) and replaced the single `channel`
  response field with independent `sms_status`/`voice_status` fields,
  reusing the exact same vocabulary `push_status` already established
  (`"sent"` / `"simulated"` / `"failed"` / `"no_recipients"`) — all three
  channels (SMS, voice, push) now report status identically. Confirmed
  no frontend or mobile code called this endpoint with a `channel` param
  before making the change, so nothing else needed updating.
- **`maybe_auto_trigger()`** (the sensor-reading auto-alert path) updated
  to match — an automatic "high" transition now auto-sends both SMS and
  voice, not just SMS.
- **Also fixed a real, previously-flagged latent bug while touching this
  code**: `send_alert_for_region()`'s SMS/voice sends had no exception
  handling, so a malformed phone number could crash the whole endpoint
  with a raw 500 (the exact class of bug found and fixed in
  `POST /api/subscribers/verify/request` on 2026-09-07/08, but noted then
  as "still exists in alerts.py, not yet fixed"). Extracted a shared
  `_send_channel()` helper so SMS and voice share one status-handling
  code path, both wrapped in try/except → `"failed"` status instead of
  crashing. Applied the identical fix to
  `POST /api/admin/incidents/{id}/response` in `admin_reports.py`, which
  had the same unguarded pattern.
- Verified end-to-end via curl against a running server: a region with a
  real subscriber (Maputo) correctly showed `sms_status: "sent"`
  (real Africa's Talking send) and `voice_status: "simulated"` (no
  `AT_VOICE_NUMBER` configured); a region with none (Nairobi) correctly
  showed `"no_recipients"` for both; an unknown region still 404s.
  `GET /api/alerts` confirmed to return old log entries (pre-2026-09-09,
  still carrying the old `channel` field) and new entries (`sms_status`/
  `voice_status`) side by side without crashing — `alert_log.json` is
  gitignored runtime state, never migrated retroactively.

### Not yet started
- This makes every alert send more expensive (SMS + voice both billed,
  where it used to be one or the other) — not a concern for the hackathon
  demo ($25 of Africa's Talking credit easily covers it), but worth a
  one-line honesty note in the pitch if asked about real-world cost at
  scale.
- `POST /api/admin/incidents/{id}/response` (the admin's targeted,
  per-incident response tool) deliberately was NOT changed to be
  SMS+voice-additive — that endpoint lets an admin pick a specific
  channel for a specific incident on purpose (e.g. "just call this
  person"), which is a different use case from the broadcast regional
  alert this change applies to.

---

## 2026-09-07 (later same day) — Security audit and fixes: 5 high, 3 medium severity gaps closed

A full-project security audit (backend, mobile, the Wokwi hardware sim —
frontend-web had nothing comparable, since it has no wired-up code yet)
found 5 high-severity and 3 medium-severity real, exploitable gaps.
Every one is now fixed and verified end-to-end via curl against a
running server (not just written and assumed correct). Full field-level
detail in `docs/api-contract.md`'s status banner and each endpoint's own
section; summary here.

### Completed — high severity
- **Admin signup had no gate at all** — any internet user could create a
  full admin account with full incident-management access. Fixed:
  `POST /api/admin/signup` now requires `signup_code` matching a new
  `ADMIN_SIGNUP_CODE` env var; disabled entirely (503) if that's unset,
  rather than silently open.
- **`ADMIN_JWT_SECRET` fell back to a fixed, publicly-known value** —
  forgeable by anyone who'd read this repo's source. Fixed
  (`app/config.py`): an unset one now generates a real random secret via
  `secrets.token_hex(32)` once per process start instead. Trade-off,
  not a security concern: sessions don't survive a restart without a
  persistent value set. Also added token revocation (`jti` claim +
  `app/data/revoked_jtis.json`) and `POST /api/admin/logout`, so a
  logged-out token stops working immediately instead of staying valid
  for its full 24h.
- **Sensor ingestion (`POST /api/sensor-reading`) had no authentication**
  — the demo `device_id` (`esp32-demo-01`) is published in this repo's
  own README, so anyone could spoof a reading and trigger a real
  automatic SMS/voice/push alert, or flap it to spam subscribers. Fixed:
  now requires a per-device `device_key` (`devices.json`), checked with
  `hmac.compare_digest`. Generated one for the demo device and updated
  `hardware/wokwi-flood-sensor/sketch.ino` to send it — documented
  explicitly as a public demo key, real devices should get their own,
  uncommitted.
- **Subscribing/unsubscribing a phone number had zero ownership check**
  — anyone could add *or remove* any real phone number from real flood
  alerts just by knowing it, reachable via the direct API, the USSD
  webhook, and (as of the mobile SMS-toggle work finished the same day)
  the mobile app too. Fixed: new `POST /api/subscribers/verify/request`
  sends a 6-digit code (real SMS if configured, returned directly in the
  response for testing if not — same "never fake success" pattern as
  everywhere else in this backend); `POST`/`DELETE /api/subscribers`
  now both require it, single-use, 10-minute expiry. **Also discovered
  and fixed a real crash while testing this**: `send_sms()` propagates
  a `ValueError` when the `africastalking` SDK rejects a malformed phone
  number client-side, which was unhandled and produced a raw 500 — now
  caught and returned as a clean `502`.
- **The USSD webhook trusted a caller-supplied `phoneNumber` with no
  check on who was actually calling it** — anyone could POST directly to
  `/api/ussd` pretending to be any phone number. Fixed: optional HTTP
  Basic Auth (`USSD_WEBHOOK_USERNAME`/`PASSWORD`, embeddable in the
  webhook URL Africa's Talking calls) — off by default, matching this
  repo's documented local-curl-testing workflow, verified both the
  protected and unprotected states work correctly. The subscribe/
  unsubscribe *menu itself* deliberately still needs no per-action code
  — once the webhook is protected, a real USSD session's phone number is
  asserted by the telecom carrier, not attacker-controlled.

### Completed — medium severity
- **`POST /api/admin/incidents/{id}/response` could message arbitrary
  phone numbers** — an admin (including a self-registered one, before
  the signup fix above) could pass any `recipients` array for
  `sms`/`voice`, turning this into an open relay against the org's paid
  Africa's Talking account. Fixed: `sms`/`voice` recipients are now
  always resolved from `subscribers.json` for the report's own region;
  caller-supplied `recipients` is only used for `radio`/`community_leader`
  (freeform station/leader names, no paid API behind either).
- **Photo uploads trusted the client's declared `Content-Type`**, not
  the file's actual bytes — a non-image file labeled `image/jpeg` used
  to pass. Fixed: `app/routes/hazard_reports.py` now sniffs real magic
  bytes (JPEG/PNG/WebP signatures) and rejects anything else with a 415,
  regardless of the declared type. Verified: an HTML file spoofed as
  `image/jpeg` is now rejected; a real (tiny, hand-built) JPEG still
  succeeds.
- **CORS was wide open** (`allow_origins=["*"]`) with no way to tighten
  it. Fixed: new `CORS_ALLOWED_ORIGINS` env var (comma-separated);
  still defaults to `*` if unset, since the dashboard's deployed URL
  isn't fixed yet, but now closeable without a code change.

### Mobile app changes to match
- `mobile-app/lib/services/subscriber_service.dart` rewritten: `enable`/
  `disable` now take a `code` parameter, plus a new `requestCode()`
  method matching the backend's two-step flow.
- `alert_channels_screen.dart`: the SMS toggle (both directions) now
  requests a code and shows a dialog prompting for it before completing
  — pre-filled when the backend returns one directly (SMS not configured
  server-side), otherwise blank since a real code only exists in the SMS
  the user just received. Removed the old silent background
  re-registration on screen-open (`_syncSmsRegistration`) — it can't
  complete anymore without the user present to enter a code. SMS's
  default toggle state changed from "on" to "off", since an unverified
  "on" would now be misleading.
- Added 6 new keys × 7 languages to `lib/l10n/app_*.arb` for the code
  dialog (title, body with a `{phone}` placeholder, the simulated-code
  testing note, hint, submit button, request-failed message).
- `flutter analyze` and `flutter test` both pass clean after all of the
  above.

### Verification
Every fix curl-tested end-to-end against a locally running server:
admin signup rejected without/with-wrong `signup_code` then accepted
with the right one; a revoked token correctly rejected on the next call;
sensor readings rejected without/with-wrong `device_key` then accepted;
the full request-code → register → re-use-same-code-fails →
request-new-code → unsubscribe flow for `/api/subscribers`; USSD
correctly open with no Basic Auth configured and correctly gated
(401/401/200 for none/wrong/right credentials) once configured; an admin
response's `recipients` field verified to reflect the real Maputo
subscriber regardless of what phone number was passed in, and
`"no_recipients"` for a region with none; the spoofed-Content-Type photo
upload test. Mobile side verified via `flutter analyze`/`flutter test`
(no live device/browser click-through this session — see the standing
"Chrome extension not always connected" caveat from earlier sessions).

### Not yet started
- No rate limiting on login/signup/verify-code-request — brute-forcing a
  password or a 6-digit code isn't prevented by anything at the
  application layer (relies on network-level protection if any exists).
  Deliberately out of scope for this pass (DoS/rate-limiting concerns
  were explicitly excluded from the audit that drove this work).
- `ADMIN_SIGNUP_CODE`/`USSD_WEBHOOK_USERNAME`/`PASSWORD`/
  `CORS_ALLOWED_ORIGINS` are all unset in the actual deployed/demo
  environment until someone sets them — this session only built the
  mechanism and set local dev values in this machine's own gitignored
  `.env`, not any shared/production one.
- No live mobile device/browser click-through of the new SMS
  verification dialog — verified via static analysis and backend-side
  curl testing of the same API calls the mobile code makes, not an
  actual tap-through.

---

## 2026-09-07 — Admin Command Center API built, at Habiba's request

Habiba asked (via Matthias) for a specific list of endpoints to connect
the admin web dashboard to the real backend: admin signup/login,
report/incident CRUD, dashboard stats, AI priority/triage, incident
status management, assistance assignment/response dispatch, and an
incident map — while explicitly keeping the existing
`GET`/`POST /api/hazard-reports` + photo endpoints unchanged.

### Completed
- **Real admin authentication** — new `app/auth.py`: bcrypt-hashed
  passwords (never stored/logged in plaintext), signed JWTs (PyJWT,
  HS256, 24h lifetime), `app/data/admins.json` (gitignored — holds
  password hashes, unlike seed-data files). `POST /api/admin/signup`,
  `POST /api/admin/login`, `GET /api/admin/me`. `ADMIN_JWT_SECRET`
  (`app/config.py`) has a fixed demo fallback if `.env` doesn't set one —
  flagged honestly (a startup warning + doc comments) as forgeable in
  that state, since auth can't degrade to "simulated" the way SMS/push
  do; a real deployment must set its own secret.
- **Incident management, additive to `hazard_reports.json`** — every
  report now also carries `status` (`new`/`verifying`/`prioritized`/
  `assigned`/`responding`/`resolved`, with a full `status_history` audit
  trail of who changed what and when), `verified`/`verified_by`/
  `verified_at`/`verification_notes` (evidence review), and
  `assigned_to`/`assigned_by`. **`GET`/`POST /api/hazard-reports` and the
  photo endpoints keep their exact existing response shape** (Pydantic
  quietly drops the new fields from those specific response models) —
  only the new admin routes read/write them. One new sibling endpoint,
  `GET /api/hazard-reports/{id}` (single report, unauthenticated like its
  siblings), was added alongside the existing two.
- **AI priority/triage — a real, explainable rules-based scorer**
  (`app/models/priority_model.py`), same design philosophy as
  `risk_model.py`: a weighted sum of 5 factors (`needs_assistance` 0.40,
  `region_risk_level` 0.30 via the existing risk model, `category` 0.15
  keyword-matched, `evidence` 0.05 has-a-photo, `report_age` 0.10 capped
  at 24h) bucketed into `critical`/`high`/`medium`/`low`, with every
  factor's contribution shown in the response — not an opaque score.
  `GET /api/admin/incidents/prioritized` and
  `GET /api/admin/assistance-requests` both rank by it.
- **Assistance & response dispatch** — `POST
  /api/admin/assistance-requests/{id}/assign` (assigns a
  responder/team, advances status); `POST
  /api/admin/incidents/{id}/response` sends via `sms`/`voice` (reusing
  the exact same Africa's Talking gateways `POST /api/alerts/send`
  already uses — real send if configured + recipients given, simulated
  otherwise) or `radio`/`community_leader` (**always simulated** — no
  real radio-station or community-leader integration has ever been built
  for this project, logged honestly rather than faking a broadcast);
  `GET /api/admin/incidents/{id}/responses` for the full history.
- **Dashboard stats** (`GET /api/admin/dashboard/stats`) and **incident
  map** (`GET /api/admin/incidents/map`, skips reports with no GPS fix
  rather than guessing a location) — both computed live from
  `hazard_reports.json` on every call.
- New dependencies: `bcrypt`, `pyjwt` (was already a transitive dependency
  via `firebase-admin`, now declared directly since it's called
  directly), `email-validator` (for `pydantic.EmailStr`) — added to
  `requirements.txt`.
- **Verified end-to-end via `curl`, not just import-checked**: full
  lifecycle tested against a locally running server — signup → duplicate
  signup (409) → login → wrong password (401) → `/me` with and without a
  token (401 without) → create a hazard report → single-report GET
  (unauthenticated, works) → dashboard stats (401 unauthenticated, real
  numbers authenticated) → prioritized incidents (correctly ranked a
  `needs_assistance: true` Lagos "Trapped" report at `priority_score:
  0.85`/`critical` above a routine low-risk Nairobi report at `0.0`/`low`)
  → verify → assign → send an sms response (no recipients → correctly
  `"simulated"`) → send a radio response (correctly always `"simulated"`)
  → response history → status→`resolved` → incident map → stats
  reflecting the resolved count. Confirmed the pre-existing
  `GET /api/hazard-reports` and the OpenAPI schema (`/openapi.json`, 27
  unique paths, no route collisions) both still work unchanged. Test data
  (`admins.json`, `hazard_reports.json`) deleted afterward — both are
  gitignored runtime state, never committed.

### Not yet started
- Frontend (`frontend-web/`) isn't wired to any of this yet — this
  session only built and verified the backend API surface Habiba asked
  for; connecting the dashboard's UI to it is separate work.
- No password-reset flow, no admin-account deletion/deactivation, no
  role-based permission tiers (every admin account can do everything) —
  none of these were asked for; flagging as an intentionally unscoped gap
  if the dashboard grows multiple admin roles later.
- `ADMIN_JWT_SECRET` still needs a real value set in `backend/.env`
  before any real (non-hackathon-demo) deployment — see the warning
  `app/auth.py` prints at import time if it's still on the default.
- The priority-scoring weights are a first, reasonable-looking pass
  (same "tuned to look sane for the demo" standard as `risk_model.py`'s
  thresholds) — not validated against any real incident-triage dataset,
  since none exists for this project.

---

## 2026-08-29 — Push notification setup fully wired: VAPID key + backend service-account key

Closes out the two remaining Firebase setup steps from earlier today.

### Completed
- **Generated a real Web Push VAPID key** (Project Settings > Cloud
  Messaging > Web configuration > Web Push certificates) and set it as
  `PushService._webVapidKey` in `mobile-app/lib/services/push_service.dart`
  (previously `null`). Fixed a resulting `unnecessary_nullable_for_final_
  variable_declarations` lint by narrowing the field's type from
  `String?` to `String` now that it always has a value.
  `flutter analyze` — "No issues found!".
- **Generated a real backend service-account key** (Project Settings >
  Service Accounts > Firebase Admin SDK > Generate new private key),
  saved outside the repo, and pointed `backend/.env`'s
  `FIREBASE_SERVICE_ACCOUNT_JSON` at its path (`backend/.env` is
  gitignored, so this is a local-only change, not committed).
- Verified both ends: `app.models.push_gateway.is_configured()` now
  returns `True` (previously `False` with no credential set), and
  `app.main` still imports cleanly with the credential wired in.

### Not yet started
- Android/iOS token registration is wired up but untested — no
  device/emulator available in this environment.
- No actual push notification has been triggered end-to-end and
  observed arriving anywhere yet — only the configuration plumbing has
  been verified (`is_configured()`, clean imports, `flutter analyze`),
  not a real delivered notification via `POST /api/alerts/send` or
  `POST /api/push-tokens`.

---

## 2026-08-29 — Real Firebase project created; `flutterfire configure` wired into the mobile app

### Completed
- **Created a real Firebase project**, `afrishield-ai-flood`. This took
  more steps than expected because of two separate account-level
  restrictions, not code issues:
  - The first Google account used hit "You've reached the project limit
    for your account" when creating a project in the Firebase console.
  - Switched to a second Google account and created a project there via
    the browser, but `firebase projects:list` under the CLI login for
    that same account showed no projects — a genuine account/project
    mismatch (confirmed by checking which email the CLI's local config
    was actually authenticated as). Rather than keep debugging that,
    created the Firebase project fresh via the CLI instead:
    `firebase projects:create afrishield-ai-flood` — this succeeded for
    the underlying GCP project, but the following "add Firebase
    resources" step failed with `403 PERMISSION_DENIED` on
    `firebase.googleapis.com:addFirebase` (confirmed via
    `firebase-debug.log`, not just the summary error) — a known
    restriction on fresh Google accounts calling that API directly.
    Worked around it by adding Firebase to the *existing* GCP project via
    the Firebase console's "Add project" flow (browser calls, unlike raw
    API calls, aren't subject to the same restriction) — this succeeded.
- **Ran `flutterfire configure`** from `mobile-app/` against the now
  Firebase-enabled project:
  ```
  flutterfire configure --project=afrishield-ai-flood --platforms=android,ios,web \
    --android-package-name=com.afrishield.afrishield_mobile \
    --ios-bundle-id=com.afrishield.afrishieldMobile --yes --overwrite-firebase-options
  ```
  Generated real `lib/firebase_options.dart` (replacing the old
  placeholder values), `android/app/google-services.json`, and
  `mobile-app/firebase.json`; auto-applied the standard
  `com.google.gms.google-services` Gradle plugin to
  `android/app/build.gradle.kts` and `android/settings.gradle.kts`
  (superseding an earlier no-plugin workaround that existed only because
  there was no real project to point it at yet).
- Updated `PushService` to pass a (currently `null`) web VAPID key to
  `FirebaseMessaging.instance.getToken()` only on web
  (`kIsWeb`) — Android/iOS ignore that parameter.
- Verified nothing broke: `flutter pub get`, `flutter analyze` ("No
  issues found!"), `flutter test` (all passed), and a fresh
  `flutter run -d chrome` all succeeded with the new config in place.
- Updated `mobile-app/README.md` (feature table, Structure section,
  Known gaps) to describe the real project instead of the old
  placeholder state.

### Not yet started
- **Web Push VAPID key** — needed before `getToken()` works in a
  browser. Generate at Project Settings > Cloud Messaging > Web
  configuration > Web Push certificates, then fill into
  `PushService._webVapidKey`.
- **Backend service-account credential** — a separate credential from
  Project Settings > Service Accounts > Generate new private key, needed
  in `backend/.env`'s `FIREBASE_SERVICE_ACCOUNT_JSON` before the backend
  can actually send any push notification (the mobile-side config alone
  only lets the app *receive*, not the backend *send*).
- Android/iOS push registration is wired up but untested — no
  device/emulator available in this environment.

---

## 2026-08-29 — Localized runtime error messages; cross-verified 10 countries' emergency numbers

Closing out the two remaining mobile gaps that didn't need an account,
a real device, or the (explicitly deprioritized) translation review.

### Completed
- **`ApiException`/`LocationException` are localized now**, not
  English-only. Both used to carry a raw English `message` string set
  at throw time, deep in a service class with no `BuildContext` to
  localize with. Redesigned so each carries an error-*kind* enum
  (`ApiErrorKind.network`/`.server`; `LocationErrorKind
  .servicesDisabled`/`.permissionDenied`/`.permissionDeniedForever`)
  plus a `debugDetail` string (kept English-only, for logs — e.g. the
  exact status code and URL). UI call sites (which do have a
  `BuildContext`) call `e.localizedMessage(l10n)` instead of
  `e.toString()`/`e.message`. Added 5 new keys to all 7 `lib/l10n/*.arb`
  files. `image_picker`'s own native platform error strings (a separate,
  third-party `catch (e)` in `reports_screen.dart`) are out of scope —
  we don't control what language a native OS exception is thrown in.
- **Cross-verified emergency numbers for the 10 currently monitored
  countries** against a second, independent source (UK gov.uk's
  `foreign-travel-advice/.../getting-help` pages) — the original
  2026-08-28 data was single-sourced from Wikipedia only. **Found 4 real
  discrepancies**: Kenya (was 112, gov.uk says 999 — Wikipedia listed
  112 as *also* valid, but 999 is what the independent source leads
  with), Egypt (was 112, gov.uk says 122 and doesn't mention 112 at
  all), Uganda (was 112, gov.uk says 999), Mozambique (was 119, gov.uk
  states a unified 112). The other 6 of the 10 (Nigeria, Ghana,
  Tanzania, DRC, Somalia, Ethiopia) matched exactly — corrected the 4,
  annotated all 10 in `emergency_numbers.dart` with which were checked
  and against what. The other 44 countries remain single-sourced from
  Wikipedia only.
- `flutter analyze` and `flutter test` both pass clean.

### Not yet started
- The 44 non-monitored countries' emergency numbers are still
  single-sourced — same standing caveat as before, just narrower in
  scope now.
- `image_picker`'s native error strings are still English-only —
  documented as a real, structural boundary (third-party plugin error
  text), not something fixable from this side.

---

## 2026-08-29 — Merged Habiba's frontend dashboard work (was stuck unmerged since 2026-08-16)

### Completed
- Checked all remote branches while investigating what the frontend team
  had done — found `origin/habiba-dashboard-expansion` with two commits
  (`51720a8`, 2026-08-16, "Complete frontend dashboard with real API
  data"; `81b6031`, 2026-08-23, "Expand flood alerts and regional risk
  dashboard") that had never been merged into `master`. A prior session
  had started an integration (`integration/habiba-onto-master`, last
  touched 2026-08-24) but never finished merging it back.
- Verified no conflict risk before merging: nobody had touched
  `frontend-web/` on `master` since the integration branch was last
  synced, and a merge simulation against the current `master` tip
  applied cleanly.
- **Merged `origin/habiba-dashboard-expansion` into `master`** (merge
  commit `84cd4c9`). This is real, substantial work, not a formality —
  it fills in real content for `Alerts.jsx`, `Analytics.jsx`,
  `HelpSupport.jsx`, `LiveFloodMap.jsx`, `Regions.jsx`, and
  `Settings.jsx` (the exact 6 pages flagged as empty placeholders
  earlier this session, on 2026-08-28 — that finding was accurate for
  `master` at the time, but wrong about the state of the team's actual
  work, which existed and just hadn't been integrated), plus expanded
  `Reports.jsx`, `RecentAlerts.jsx`, `RegionDetails.jsx`,
  `RegionTable.jsx`, and `RiskMap.jsx`.
- Verified after merging, not just assumed: `npm run build` succeeds
  (`vite build`, 20s, no errors), `npm run lint` shows only pre-existing
  unused-variable warnings (no errors), and spot-checked that
  `Alerts.jsx`/`Analytics.jsx`/`Regions.jsx`/`LiveFloodMap.jsx`
  genuinely call `fetch()`/`useEffect` for live data rather than just
  looking complete.

### Not yet started
- `Reports.jsx`'s own code comment already says "A community-report
  POST endpoint is not currently available" — that's no longer true
  (`POST /api/hazard-reports`, built 2026-08-28) but the page's
  `handleSubmit` hasn't been wired to it yet.
- The frontend cleanup items from `todo.md` (hardcoded API URLs, unused
  `mockData.js`, a Tailwind typo, unused-variable lint warnings) are
  unaffected by this merge and still open.
- Nobody has told Habiba this was merged, or checked whether she has
  further uncommitted/unpushed local work beyond what's on
  `origin/habiba-dashboard-expansion`.

---

## 2026-08-29 — Wokwi tunnel fix, real emergency numbers, real ML validation data

### Completed
- **Wokwi ESP32 simulation — backend side fully proven end-to-end,
  switched from `ngrok` to `cloudflared`.** Found that `ngrok`'s free
  tier force-redirects plain `http://` to `https://`, which
  `sketch.ino`'s `HTTPClient` doesn't follow — `cloudflared tunnel --url
  http://localhost:8000` (no account needed) serves `https://` directly
  with no redirect, verified with `curl` (clean `200 OK`, no `Location`
  header). Updated `sketch.ino` to use `WiFiClientSecure` +
  `setInsecure()` instead of a plain `HTTPClient`. Sent a full
  low-reading → high-reading sequence through a live `cloudflared`
  tunnel via `curl` standing in for the device: correctly scored
  low/high and the high reading correctly auto-triggered a real
  (simulated) SMS alert with `"trigger": "automatic"` — the exact path
  Wokwi would exercise. **The one thing not re-confirmed:** whether
  Wokwi's simulated ESP32 actually completes a TLS handshake to an
  external host — a prior attempt against `ngrok`'s `https://` endpoint
  got `connection refused` during the handshake itself, never confirmed
  whether that was Wokwi-specific or an `ngrok` interop issue. Needs
  someone to open wokwi.com and click Run to close this out. See
  `hardware/wokwi-flood-sensor/README.md` for full detail.
- **Real per-country emergency numbers for all 54 countries** — the
  mobile app's "Call Emergency Line" button was deliberately inert since
  2026-08-27 (no verified data existed). Sourced from Wikipedia's "List
  of emergency telephone numbers," read directly from the article's
  wikitext table (not an AI-summarized paraphrase — cross-checked after
  an initial AI-summarized pass looked inconsistent for a couple of
  countries) — most entries there are themselves cited to a government,
  embassy, telecom, or ITU source. See
  `mobile-app/lib/data/emergency_numbers.dart` for the full list and its
  honesty caveat: this is real, cited data, not independently
  re-verified per country, and the UI says so before dialing. Wired via
  a new `url_launcher` dependency; confirms with the user (showing the
  exact number) before placing a real `tel:` call.
- **Real ML training/validation data — a second, much better attempt
  after the 2026-08-17 GDACS attempt found almost nothing usable.**
  Investigated (via a research pass) several sources not tried on
  2026-08-17; the **Dartmouth Flood Observatory (DFO)** — an
  independent, non-satellite-derived global flood catalog, free, no
  login, republished via HDX — was the winner:
  - Text-matched DFO's master list (4,029 global events) against our 10
    city names, filtered one false positive (Cairo, Illinois, USA vs.
    Cairo, Egypt), got **49 real, dated flood events across all 10
    cities**, 1985–2010 — committed as
    `backend/app/data/dfo_flood_events.json`. This directly fixes GDACS's
    coverage problem (7 of 9 cities got zero real events on 2026-08-17).
  - DFO's events are compiled independently of GloFAS, fixing GDACS's
    other, more serious problem: GDACS's own river-flood events were
    partly auto-derived from the same GloFAS discharge series used as a
    model feature — real label leakage. DFO has no such circularity.
  - New `backend/app/models/fetch_real_training_data_dfo.py` pairs these
    events with real Open-Meteo rainfall + GloFAS discharge, 1985–2010.
    **Found and fixed a real bug while building this:**
    `fetch_rainfall_series()`/`fetch_discharge_series()` in the existing
    `fetch_real_training_data.py` silently ignored any caller-supplied
    date range and always used that file's own hardcoded 2010–2022
    window — the first full run of the new script silently got 2010–2022
    data back while claiming to cover 1985–2010, which would have gone
    unnoticed without independently checking the actual date range of
    the returned data rather than trusting the row counts. Fixed by
    adding optional `start`/`end` parameters (default-preserving the old
    behavior for the GDACS script).
  - **A second real, previously-undiscovered limitation found while
    debugging a suspiciously-low result:** GloFAS discharge data has
    **zero coverage at all** for Maputo and Mogadishu's coordinates (100%
    missing, every single day 1985–2010), and for the other 8 cities,
    only starts 1997-01-01 (100% missing 1985–1996, complete 1997–2010).
    Not a bug — Open-Meteo's API genuinely returns `null` for these
    (location, date) pairs. This is new information: the 2026-08-17
    investigation used a 2010–2022 window and never hit this, since it
    never queried earlier dates.
  - **Still blocked from a full production retrain, same fundamental
    issue as 2026-08-17:** GloFAS gives discharge (m³/s), not the
    production model's `river_level_m` (meters) — not convertible
    without river-specific data that doesn't exist. Also, the live
    `POST /api/sensor-reading` inference path receives a raw
    `river_level_m` with no historical context, so even a model trained
    on a "discharge percentile relative to 26 years of history" feature
    couldn't be fed at inference time anyway — this isn't just a training
    limitation, it's a pipeline-compatibility one.
  - **What this real data was used for instead: genuine validation, not
    retraining.** New `backend/app/models/validate_against_dfo.py`
    evaluates the *existing* rules-based and trained-ML models (using
    each city's own relative discharge percentile as an approximation
    for "how high is the river," clearly flagged as an approximation, not
    a real river-level reading) against 239 real, usable DFO-confirmed
    flood-days (the 7 cities with both events and discharge coverage
    overlapping). **Real result:** rules-based model recall 41% (22%
    false-positive rate), trained ML model recall 28% (13.7%
    false-positive rate) — genuine numbers from real data, now cited in
    `docs/pitch-notes.md`'s new "Real-data validation" section instead of
    the vaguer "cite GDACS as external validation" plan from 2026-08-17.

### Not yet started
- Wokwi's actual TLS-handshake behavior against `cloudflared` — needs a
  human to click Run in the Wokwi web UI (not doable from this
  environment without either a Wokwi account or working browser access,
  neither available this session).
- Emergency numbers are cited, real data but not independently
  re-verified per country against each government's own current source
  — flagged in the UI and in `emergency_numbers.dart`'s doc comment as a
  follow-up item, same standing as an unreviewed translation.
- No newer (post-2010) real flood-label source has been found or tried
  yet — DFO's archive itself stops there. A second, more recent source
  layered on top would be the next step for anyone continuing this.

---

## 2026-08-28 — Push notifications (backend + mobile) and a real geo dataset

### Completed
- **Real State/City data for all 54 countries**, replacing free-text
  fields. Filtered the open, CC-licensed
  `dr5hn/countries-states-cities-database` down from its 46MB worldwide
  file to just our 54 countries — 1,117 real states/regions, 4,638 real
  cities/towns, an 89KB asset (`mobile-app/assets/geo/states_cities.json`,
  loaded by `mobile-app/lib/data/geo_data.dart`). Spot-checked several
  countries by hand (Nigeria's 37 states including the FCT, Kenya's 47
  counties, Egypt's 27 governorates, Comoros' 3 islands) — genuine
  administrative data, not fabricated.
  - `LocationSetupScreen`'s State and City fields are now real
    search-and-pick screens (`GeoPickerScreen`, mirroring
    `CountryScreen`'s existing search UX) instead of free text, cascading
    (picking a State clears any previously typed City, since it almost
    certainly doesn't belong to the new State).
  - **LGA stays free text, deliberately** — no dataset found gives a
    reliable, consistent third administrative tier across all 54
    countries; faking one would be worse than admitting the gap.
- **Real push notifications (Firebase Cloud Messaging), backend and
  mobile, following the exact same honest-degradation pattern as
  SMS/voice:**
  - Backend: `app/models/push_gateway.py` (`is_configured()`/
    `send_push()`, mirrors `sms_gateway.py`), a new device registry
    (`app/routes/push_tokens.py` + `app/data/push_tokens.json`,
    committed empty like `subscribers.json`), and `send_alert_for_region`
    now also pushes to every registered device for a region — additive
    to whichever channel (`sms`/`voice`) was used, not a third channel
    choice. New `push_status` field (`"sent"`/`"simulated"`/`"failed"`/
    `"no_recipients"`) on `POST /api/alerts/send`'s response and every
    `GET /api/alerts` log entry. Tested end-to-end via curl: register →
    send → `push_status: "simulated"` (no Firebase project yet) →
    unregister → send → `push_status: "no_recipients"`.
  - Mobile: `lib/services/push_service.dart` wraps `firebase_messaging`,
    catching every real failure mode (placeholder credentials, no
    permission, no VAPID key on web) into one honest "unavailable" result
    rather than guessing which one occurred. The Settings > Alert
    Channels "Mobile App" toggle is now real and interactive (was
    permanently disabled before) — enabling it registers a token against
    whichever region `pickMyRegion()` (new shared helper in
    `lib/providers/region_selection.dart`, factored out of
    `HomeScreen`'s previously-private region-matching logic, now also
    used here) resolves as "mine"; if there's no real region match yet,
    or Firebase isn't configured, the toggle stays off and says why
    instead of turning on and doing nothing.
  - **No Firebase project has actually been created** — that's an
    external console step nobody has done (same category of gap as "no
    real Africa's Talking account yet" on `todo.md`'s Critical list).
    `lib/firebase_options.dart` is placeholder values with the exact
    setup steps in its doc comment. Until that's done, push cleanly
    reports itself unavailable everywhere; nothing crashes or fakes a
    success.
- `flutter analyze` and `flutter test` both pass clean on all of the
  above. Backend push endpoints verified manually via curl (see above).

### Not yet started
- Nobody has created the actual Firebase project yet, so push has never
  actually delivered a real notification to a real device — only the
  graceful-unavailable path has been exercised.
- Could not visually click through the "Mobile App" toggle in a live
  browser this session (the Chrome extension used for that wasn't
  connected) — verified via `flutter analyze`/`flutter test` and the fact
  that the app boots without crashing (Firebase init is lazy, only
  attempted when the toggle is used), but not via an actual tap.
- Native-speaker review still outstanding for the ~10 new mobile UI
  strings this added (push enabled/disabled/unavailable messages, etc.)
  — same standing item as the rest of `lib/l10n/*.arb`.

---

## 2026-08-28 — Mobile: UI chrome translated into all 7 backend languages

### Completed
- Real Flutter localization, replacing the locale-only scaffolding that
  existed before (`supportedLocales` was wired for RTL, but every
  screen's own text was hardcoded English). Added `generate: true` +
  `l10n.yaml` + `lib/l10n/app_{en,sw,ar,so,fr,pt,am}.arb` (~150 keys
  each) and wired every screen and widget with real UI text — all of
  `lib/screens/**` and `lib/widgets/**` — to `AppLocalizations.of(context)`
  instead of literal strings.
- `MaterialApp.locale` in `app.dart` is now driven live by
  `OnboardingProvider.language` via a new `languageLocaleCodes` map in
  `lib/data/languages.dart` — changing Settings > Language actually
  changes the app's own UI language now, not just alert text.
- Deliberately **not** translated, to avoid breaking behavior: data that
  comes from the backend at runtime (region names, `alert_message_en`/
  `alert_message_local`, risk-level words like "HIGH"/"MEDIUM"/"LOW");
  the `hazardCategories` values in `reports_screen.dart` (still sent to
  `POST /api/hazard-reports` in English, and still used as the icon
  lookup key — only the *displayed* category label is translated,
  via a new `_categoryLabel()` mapping); the 54-country list and
  language names in `lib/data/`.
- Yoruba and Hausa have no `.arb` file (matching their existing "alerts
  not translated yet" gap) — `app.dart` falls back to English UI chrome
  for those two rather than crashing or guessing.
- **Every one of the 6 non-English translations is an unreviewed AI
  draft** — flagged explicitly here because this is a *different* set of
  strings than the alert wording, so Swahili/Arabic/Somali's prior
  native-speaker review (2026-08-17) does not cover it. Treat all 6
  languages as equally unreviewed for this UI-chrome set, same standing
  policy as French/Portuguese/Amharic's alert text.
- `flutter analyze` and `flutter test` both still pass clean after the
  full pass — verified by grepping for any remaining hardcoded English
  `Text(...)`/`hintText`/`tooltip` literals across `lib/screens/` and
  `lib/widgets/`; none found.

### Not yet started
- Native-speaker review of all 6 non-English `.arb` files.
- `ApiException`/`LocationException` messages (thrown from service
  classes with no `BuildContext`) are still English-only regardless of
  the selected language — localizing them would need passing localized
  strings into the service layer, which wasn't attempted here.
- `lib/widgets/region_card.dart` and `risk_badge.dart` were left
  untouched — grepped and confirmed unused anywhere in the app (likely
  leftover from before the Figma rebuild), so there's no live UI to
  localize there.
- RTL (Arabic) layout wasn't manually re-checked screen-by-screen beyond
  what Flutter's locale-driven `Directionality` handles automatically —
  worth a visual pass once someone can actually run the Arabic locale on
  a device.

---

## 2026-08-28 — Mobile: real GPS and hazard-report photo attachment

### Completed
- **Real GPS via `geolocator`, replacing two UI-only stubs.** New
  `lib/services/location_service.dart` wraps `Geolocator` with real error
  handling (services off, permission denied/denied forever) — every
  failure surfaces as a real message, never a silent fallback.
  - Onboarding's Location Setup screen: "Use my current location" now
    fetches a real fix and shows the raw coordinates. **No reverse
    geocoding** — State/LGA/City still need manual entry, since a
    coordinate isn't an address; this is captured honestly in the UI
    copy rather than pretending to auto-fill.
  - Reports tab: "Attach my current GPS location" fetches a fresh fix at
    submit time (not reused from onboarding, since a report should
    reflect where you are now) and sends it as `latitude`/`longitude` on
    `POST /api/hazard-reports`.
  - Added Android (`ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`) and
    iOS (`NSLocationWhenInUseUsageDescription`) permission entries.
- **Real photo attachment for hazard reports**, both sides:
  - Backend: new `POST /api/hazard-reports/{id}/photo` (multipart;
    JPEG/PNG/WebP only, 8MB cap) and `GET /api/hazard-reports/{id}/photo`.
    Stored as a plain file on local disk
    (`app/data/hazard_report_photos/`, gitignored) — same lightweight
    approach as the rest of this backend, not object storage. Tested
    manually: create → upload → `has_photo` flips true → photo downloads
    back byte-identical; 404/415/413 error paths all verified.
  - Mobile: `image_picker` (camera or gallery) replaces the "ADD PHOTO"
    stub, with a thumbnail preview and a remove button. Uses
    `readAsBytes()` + `MultipartFile.fromBytes` (not a file path), so
    this works on web too, where picked files have no filesystem path.
  - **Partial-failure case handled honestly:** if the report itself sends
    but the photo upload fails, the dialog says exactly that ("report
    sent, but the photo could not be uploaded") instead of claiming full
    success or silently dropping the photo.
- Added Android (`CAMERA`/`READ_MEDIA_IMAGES`) and iOS
  (`NSCameraUsageDescription`/`NSPhotoLibraryUsageDescription`)
  permission entries for the photo picker.
- `flutter analyze` and `flutter test` both pass clean after all of the
  above.

### Not yet started
- Reverse geocoding (coordinate → address) — would need a geocoding
  service; `geocoding`-style plugins don't support Flutter web, which is
  the only platform actually testable in this environment right now
  (no Android emulator/SDK installed), so this was deliberately not
  attempted rather than shipped broken on the one testable platform.
- The web dashboard's Reports page is still not wired to
  `GET /api/hazard-reports` (see the 2026-08-28 entry below).

---

## 2026-08-28 — Citizen hazard/help reporting: backend endpoint built

### Completed
- New `POST /api/hazard-reports` / `GET /api/hazard-reports` endpoints —
  a citizen can report a hazard they're seeing, or flag
  `"needs_assistance": true` if they need help, and it's persisted to
  `backend/app/data/hazard_reports.json` (gitignored, same runtime-state
  pattern as `alert_log.json`). See `docs/api-contract.md` for the full
  request/response shape and `backend/app/routes/hazard_reports.py`.
- `category` is intentionally freeform on the backend, not a server-
  enforced enum, even though the mobile UI offers a fixed list
  (`hazardCategories` in `mobile-app/lib/models/hazard_report.dart`) —
  other channels (USSD, web) may want to send their own categories, and
  "Other" already covers anything not in the list.
- Tested manually end-to-end against a locally running backend: posted a
  routine report and a `needs_assistance: true` report, confirmed both
  round-trip correctly through `GET /api/hazard-reports`.
- **Mobile app's Reports tab wired to the real endpoint.**
  `ApiService.submitHazardReport()` posts `category`/`description`/
  `location_name` to `POST /api/hazard-reports`; `ReportsScreen` shows a
  real success dialog on `201`, or a real error dialog (nothing faked)
  if the send fails — same "don't overclaim" pattern as
  `RegionProvider`'s live/cached/error states. `needs_assistance` isn't
  sent from the mobile UI — the Figma design has no "I need help"
  toggle, so every mobile-submitted report defaults to `false` on that
  field; it's only reachable today by calling the API directly.

### Not yet started
- The web dashboard's Reports page (`frontend-web/src/pages/Reports.jsx`)
  is still an empty placeholder — not wired to `GET /api/hazard-reports`.
- No dispatch/routing of any kind — a `needs_assistance: true` report
  just sits in the log for now. Deciding who sees it and how fast is a
  separate, unscoped piece of work.
- Photo upload and GPS were both still-missing at the time this entry was
  written; both are now done — see the GPS/photo entry above (same date).

---

## 2026-08-27 — Flutter mobile app: Figma design implemented

### Completed
- Team shared the Figma design ("AfriShield AI App") as one PDF export per
  screen. Read all ~20 exports (onboarding flow, Home in both High/Low risk
  states, Alerts in all 4 filter states, Alert Details, Alert Channels,
  Risk Map, Report a Hazard, Safety Guidance, Settings) and rebuilt the app
  to match: full onboarding (Splash → Welcome → Language → Country →
  Location Setup), a 4-tab main app (Home / Alert / Maps / Reports) with a
  floating pill nav bar matching the design, and Settings reached from
  Home's app bar rather than as a 5th tab, exactly as designed.
- Real, not placeholder, where the design called for real: `flutter_map`
  (OpenStreetMap) for the Risk Map screen — the same tile-source family the
  web dashboard's Leaflet map uses; `flutter_tts` for a genuine "Read Aloud"
  accessibility feature (on-device text-to-speech reading the alert +
  safety steps aloud); `share_plus` for the real system share sheet on
  "Share Alert"; app-wide text-scale and high-contrast settings actually
  applied via a `MediaQuery` override in `app.dart`, not just a settings
  screen that does nothing.
- Found and flagged two real gaps between the Figma design and what
  actually exists, rather than quietly papering over them:
  - The language list has 9 languages (adds Yoruba and Hausa); the backend
    only generates alert text in 7. Yoruba/Hausa are still selectable, each
    tagged "alerts not translated yet" in the UI.
  - The Location Setup screen's State/LGA/City fields are dropdowns in the
    design, but there's no real administrative-boundary dataset for all 54
    countries to populate them from — built as plain text fields instead of
    faking that data.
- Deliberately left non-functional, with an honest explanation in the UI
  rather than a silent no-op: the "Call Emergency Line" button (no verified
  per-country emergency number exists — dialing a guessed one could
  actively mislead someone), "Use my current location" (no `geolocator`
  wired in yet), and the Reports tab's hazard-reporting form (no backend
  endpoint exists for community reports — confirmed against `todo.md`'s
  roadmap; submitting shows a local-only confirmation, explained as such).
- `flutter analyze` and `flutter test` both pass clean.

### Not yet started
- A real backend endpoint for hazard reports.
- `geolocator` integration for GPS-based location.
- A real State/LGA/City geo dataset.
- A verified emergency-number source per country.
- Push notifications into the app itself (backend still only sends via
  SMS/USSD/voice).
- Translated UI strings for the 7 (or 9) supported languages.

---

## 2026-08-27 — Flutter mobile app: scoped citizen-facing, structural scaffold built

### Completed
- **Decided the app's audience before writing any code:** citizen-facing,
  as an additional channel alongside SMS/USSD/voice — not a replacement,
  and not an admin tool (the web dashboard already covers that). Reasoning:
  "offline-first" only makes sense for someone in the field during a flood
  who may lose connectivity mid-event; an authority already has the web
  dashboard from an office. A citizen app only makes sense as *extra*
  reach for the smartphone-owning segment — the project's actual
  differentiator is still reaching people who don't have one.
- Created `mobile-app/` (Flutter, Android + iOS targets) with a real
  layered structure: `config/` (API base URL via `--dart-define`, not
  hardcoded — the web dashboard's opposite choice cost real cleanup time,
  see `todo.md`), `models/` (mirror `GET /api/regions` and
  `GET /api/alerts` field-for-field), `services/` (real HTTP calls, no
  mocking, plus a `SharedPreferences`-backed cache), `providers/` (region
  + alert state with live-data-falls-back-to-cache logic, exposed to the
  UI as `LoadStatus` so it can honestly show "cached" vs "live" — same
  no-overclaiming standard as the rest of the project), `screens/`, and
  `widgets/`.
- Screens are functional placeholders, not final design: region list
  (color-coded by risk), region detail (risk, alert text in the local
  language + English, alert history), full alert history, and a settings
  screen for picking a region + one of the 7 supported languages. All of
  it is wired to the real backend — running it against a live
  `uvicorn` instance actually loads real regions and real alert history.
- `flutter analyze` and `flutter test` both pass clean.
- Declared the same 7 locales the backend supports
  (`backend/app/models/translations.py`) as the app's supported locales,
  enabling things like Arabic RTL — but the UI's own strings aren't
  translated yet, only prepared to be.

### Not yet started
- **The actual visual design** — waiting on Figma from the team; nothing
  in `mobile-app/` right now is meant to be final UI.
- A map screen (no mapping package chosen/wired in yet).
- Push notifications — the backend's automatic-alert system sends real
  SMS/voice today, not a push into this app. That needs its own delivery
  mechanism (e.g. Firebase Cloud Messaging) and a backend trigger; out of
  scope for this scaffold.
- Translated UI chrome for the 7 languages (structure is ready; strings
  aren't written).

---

## 2026-08-20 — Safety-priority line for women/children in high-risk alerts

### Completed
- Closed a real gap flagged in `todo.md` since the pitch-brief work
  earlier the same day: "women" and "children" are two of the groups
  the jury scorecard's Social Impact & Inclusion criterion names
  explicitly, and until now nothing in the system had been deliberately
  designed for either — voice alerts, local-language text, and
  feature-phone delivery served disabilities/elderly/underserved
  communities, but the other two were unaddressed.
- **Added a safety-priority clause to every "high" risk alert template**
  in `backend/app/models/translations.py`, in all 7 languages — naming
  children, elderly people, and pregnant/nursing individuals as
  priorities during evacuation. This is standard humanitarian
  evacuation guidance (the same category IFRC/UNICEF flood materials
  use), not a new personal-data field or subscriber attribute — no
  schema change, no new privacy surface.
- Deliberately scoped to `"high"` only — `medium`/`low` templates have
  no evacuation instruction for this clause to attach to.
- Updated the 4 example payloads in `docs/api-contract.md` that quoted
  the old "high" message text verbatim so they match the real output.

### Flags for the team
- **This new clause is unreviewed by a native speaker in all 7
  languages — including Swahili, Arabic, and Somali**, whose *original*
  sentence was already confirmed correct on 2026-08-17. That review
  didn't cover this new addition; don't assume it inherited that
  review. Same status the newer French/Portuguese/Amharic content
  already carries.
- Adding a sentence can push a "high" SMS from one 160-character GSM-7
  segment into two, which roughly doubles that message's per-alert send
  cost — worth accounting for before quoting "$0.01-$0.03 per alert" as
  a flat figure in the pitch or BMC.

---

## 2026-08-18 — Automatic threshold-triggered alerts (sensor path only)

### Completed
- Closed a real todo item: previously every alert required a person to
  press "send" — `POST /api/alerts/send` was the only way anything went
  out, even a device reporting a dangerously high reading.
- **Refactored `backend/app/routes/alerts.py`** to extract
  `send_alert_for_region(location_name, channel, trigger)` — the actual
  work `POST /api/alerts/send` was already doing (look up the region,
  score it, find subscribers, send via SMS/voice, log the result) pulled
  out of the FastAPI route handler so it can be called from elsewhere
  without duplicating it. The route itself is now a thin wrapper that
  calls this function with `trigger="manual"` and translates
  `LookupError` into the existing 404. Verified this refactor changed
  nothing about `/api/alerts/send`'s existing behavior.
- **Added `maybe_auto_trigger(location_name, risk_level)`** in the same
  file: tracks each region's last-seen risk level in the new
  `backend/app/data/region_alert_state.json`, and calls
  `send_alert_for_region(..., trigger="automatic")` — but only the first
  time a region's level becomes `"high"`, not on every subsequent
  reading that's still `"high"`. Dropping back below `"high"` and rising
  into it again re-arms it. Without this, a Wokwi/ESP32 sensor reporting
  every 15 seconds would re-send the same alert to the same subscribers
  every 15 seconds while a flood was ongoing — worse than not automating
  it at all.
- **Wired this into `POST /api/sensor-reading` only.** Considered also
  wiring it into `POST /api/risk-check` and deliberately did not:
  `risk-check` also backs the judge/dashboard "what-if" slider demo (see
  `docs/frontend-feature-spec.md`) — a real SMS firing every time someone
  drags a demo slider into the red during a pitch would be a bad
  surprise, not a feature. Automatic alerting only makes sense where a
  "high" reading represents a genuinely new real event, which is true
  for a sensor reading and not true for someone testing the UI.
- Tested by pointing the Wokwi-simulated device at the Lagos region
  (which has zero subscribers seeded) specifically so the transition
  logic could be verified without sending a real SMS to a real phone.
- Added `"trigger": "manual" | "automatic"` to every `GET /api/alerts`
  entry, and to `.gitignore`'d `region_alert_state.json` /
  `alert_log.json` (runtime state, not seed data).
- Documented in `backend/README.md` and `docs/api-contract.md`.

### Not yet started
- A scheduled job re-scoring `regions.json` itself on a timer, for
  regions with no live sensor feeding them — this session only covers
  the sensor-reading path.

---

## 2026-08-17 — Added Addis Ababa as a 10th sample city, so Amharic is exercised live

### Completed
- Closed the gap flagged in the immediately preceding entry: with no
  Ethiopian sample city, Amharic was mapped and correctly reachable via
  a manual `POST /api/risk-check` call, but invisible on the live
  dashboard (`GET /api/regions`) — unlike every other language, which
  has at least one real sample city exercising it. Team decided to add
  one rather than leave the gap.
- Added `"Addis Ababa, Ethiopia"` to `backend/app/data/regions.json`
  (lat 9.0320, lon 38.7469, rainfall 65mm/24h, river 2.6m, population
  estimate 5,200,000) — the sample set is now 10 cities, not 9.
  Inputs chosen (same "tuned to look sane for the demo, not derived from
  real hydrological data" methodology used for every other sample city)
  to land in the `medium` bucket (score 0.65), keeping the risk-level
  spread a reasonable 3 high / 4 medium / 3 low across all 10 — not a
  perfectly even split (10 doesn't divide by 3), but not lopsided either.
- Verified end-to-end against the running server: `GET /api/regions`
  now returns 10 entries; Addis Ababa's entry has `"local_language":
  "Amharic"`, the city name correctly localized to "አዲስ አበባ" inside
  `alert_message_local`, and the ML model independently agrees on the
  bucket (`ml_risk_level: "medium"`, `ml_risk_score: 0.66` vs. the
  rules-based 0.65) — same "second opinion, not a contradiction"
  pattern every other sample city already showed.
- Updated every place that said "9 sample cities" as a live claim:
  `backend/app/models/risk_model.py`'s sanity-check docstring (added
  Addis Ababa's score, updated the spread from 3/3/3 to 3/4/3),
  `backend/app/models/translations.py` (several comments, including
  removing the now-stale "not exercised by /api/regions" caveat on the
  Amharic mapping), `docs/api-contract.md`, `docs/architecture.md`,
  `docs/frontend-feature-spec.md`, `backend/README.md`, and both
  `docs/translation-review/amharic-review.txt` (rewrote the "not
  reachable live" context note — it's live now) and `portuguese-review.txt`
  (simple count fix).
- **Also caught and fixed a real, separate gap while regenerating
  `docs/mock-data.json` for this change: Mogadishu's entry there still
  said "Mogadishu" in the Somali text, not "Muqdisho."** The live API
  has correctly said "Muqdisho" since the city-name-localization session
  earlier today — `mock-data.json` was just never updated for that one
  entry at the time. Fixed now, verified against live output rather than
  assumed. Also added the new Addis Ababa entry to `mock-data.json`'s
  `regions` list, pulled from a live server response, not hand-typed.

### In Progress / Partially Done
- Nothing left half-finished.

### Not Yet Started
- **`docs/Africa-Shield-AI-Overview.pdf` and `docs/API-Schema-Reference.pdf`
  are now stale** (still describe 9 regions and the pre-fix language
  mappings) — per existing project convention, these are snapshots
  regenerated on request from an HTML source not committed to the repo,
  not automatically kept in sync with every data change. Flagging as
  due for a refresh before any pitch/judge-facing use, not fixing
  automatically here.
- Everything else already tracked in `todo.md`.

### Findings & Decisions
- **Chose Addis Ababa specifically** (not some other Ethiopian city) —
  it's the capital, largest city, and the same choice already used
  throughout this session's Amharic work (`LOCALIZED_CITY_NAMES`, the
  review packet, testing), so adding it as the sample city kept
  everything consistent rather than introducing a second Ethiopian city
  name to track.
- **Chose inputs landing in `medium` rather than re-tuning for an exact
  3/3/3-equivalent split** — 10 cities can't split evenly into 3
  buckets, and `medium` (4 cities) was judged a fine place for the
  4th, being reused, non-extreme bucket; not a finding that needed deep
  analysis, just a demo-plausibility call same as every prior sample
  city's inputs.
- **Finding the stale Mogadishu entry in `mock-data.json` while doing
  this work is a useful reminder for the team:** the "verify against
  the live server, not just the diff" discipline this project uses
  caught it. If a doc-regeneration step is ever skipped for one entry
  while updating others, it's easy to miss silently — worth a quick
  `mock-data.json`-vs-live diff pass periodically, not just when a
  specific field is being touched.

### Flags for the Team
- **The sample-city count is 10 now, not 9** — anything outside this
  repo (pitch deck drafts, slides, prior conversation notes) that says
  "9 sample cities" is now stale.
- **Regenerate `docs/Africa-Shield-AI-Overview.pdf` and
  `docs/API-Schema-Reference.pdf`** before handing either to a judge —
  both still reflect the pre-this-week state.
- **Amharic and Portuguese are both live and demoable now** (Addis
  Ababa and Maputo respectively) but both still need native-speaker
  review — see `docs/translation-review/`.

---

## 2026-08-17 — Aligned language coverage with the African Union's official languages; fixed a live Mozambique bug

### Completed
- Team decision: expand language coverage to match the African Union's
  6 official languages (Arabic, English, French, Portuguese, Spanish,
  Kiswahili), substituting Amharic for Spanish per the organizer's own
  guidance (Spanish isn't relevant to our flood-risk regions). Target
  set: English, Arabic, French, Portuguese, Swahili, Amharic — plus
  Somali, kept as a 7th since it predates this alignment and is already
  reviewed/live via Mogadishu. Followed the exact same pattern used for
  the French addition earlier the same day: real translated templates
  (flagged unreviewed where they are), country→language mapping, an
  explicit ambiguous-country skip list, doc/mock-data regeneration, and
  testing against the running server.
- **Checked Maputo's mapping first, as a priority, before adding
  anything — and found the same bug DRC had before the French fix.**
  `LOCAL_LANGUAGE_BY_COUNTRY["mozambique"]` was `"English"`. This
  wasn't a hidden bug exactly — the code comment already said
  "Mozambique's real primary language is Portuguese, not covered here"
  — but the *live output* for Maputo, one of our 9 sample cities and the
  team's most real-data-validated one (the Dec 2025-Jan 2026 flood
  event confirmed in the real-training-data investigation), was still
  wrong every time `/api/regions` or `/api/risk-check` was called for
  it. Fixed to `"Portuguese"`.
- **Added Portuguese**, real (non-machine-translated-and-forgotten)
  templates, flagged AI-drafted/unreviewed same as French:
  - `ALERT_TEMPLATES["Portuguese"]` — high/medium/low, standard
    post-1990-orthographic-reform spelling (shared across Portugal and
    Lusophone Africa/Brazil, not a Brazil-vs-Portugal split).
  - Mapped Mozambique (the bug fix above) plus Angola, Guinea-Bissau,
    Cabo Verde (both "cabo verde" and "cape verde" keys, since it's
    called both in English), São Tomé and Príncipe (both the accented
    and plain-ASCII spelling, since `country_from_location()` doesn't
    strip accents before lowercasing — verified Python's exact `.lower()`
    output for the accented form before adding the key, not assumed),
    and Equatorial Guinea.
  - **Equatorial Guinea is a deliberate inclusion, not a guess** —
    Spanish and French are also co-official there, but the team
    explicitly named it as one of the countries to map to Portuguese in
    this session's instructions. Documented in code as "not a guess made
    by whoever last edited this file," to distinguish it from the
    genuinely-skipped ambiguous cases below.
  - City names: only Maputo is currently live, and "Maputo" is already
    its Portuguese name — no `LOCALIZED_CITY_NAMES` entries needed for
    Portuguese yet.
- **Added Amharic** — Ethiopia's official language:
  - `ALERT_TEMPLATES["Amharic"]` — high/medium/low, written in Ge'ez
    script. **Flagged explicitly, more strongly than any other language
    in this file, as the least confident draft** — Amharic is
    linguistically further from the team's other languages than
    French/Portuguese are from English, and this was drafted with less
    confidence than the others. `docs/translation-review/amharic-review.txt`
    repeats this warning for whoever reviews it.
  - `LOCALIZED_CITY_NAMES["Amharic"]["Addis Ababa"] = "አዲስ አበባ"` — added
    even though no sample city is in Ethiopia yet, so the mapping is
    complete and ready rather than discovered missing later.
  - **No sample city in `regions.json` is in Ethiopia — Amharic is NOT
    exercised by `GET /api/regions` today.** Tested it via a manual
    `POST /api/risk-check` call for "Addis Ababa, Ethiopia" instead (see
    Findings below for the recommendation on whether to add a real
    sample city for this).
- **Skipped as genuinely ambiguous, per the same discipline the French
  addition used** (Congo-Brazzaville, Djibouti):
  - Djibouti (still skipped) — Arabic, French, and Somali all plausible.
  - Comoros — French and Arabic co-official; ambiguous between two of
    our seven languages.
  - Eritrea — none of our seven languages is actually its primary one
    (Tigrinya is, which isn't in our set); Arabic and English are both
    used administratively there but neither is clearly "the" answer, so
    left unmapped (falls back to English) rather than picking one.
- **Verified against the running server, not just by reading the diff:**
  `GET /api/regions`'s Maputo entry now returns `"local_language":
  "Portuguese"` with real Portuguese text; a manual risk-check for
  "Luanda, Angola" (not a sample city, a mapping-only check) correctly
  resolved to Portuguese; a manual risk-check for "Addis Ababa, Ethiopia"
  correctly resolved to Amharic with the city name localized to
  "አዲስ አበባ" inside the sentence.
- Regenerated `docs/mock-data.json`'s Maputo entry to match the live
  output exactly. Updated `docs/api-contract.md`, `docs/architecture.md`,
  `backend/README.md`, and `docs/frontend-feature-spec.md` everywhere
  they said "five languages" or otherwise undercounted the language set
  — corrected to accurately say 7 languages total (6 AU-aligned + Somali),
  not "six," after catching that exact inconsistency in this session's
  own first draft of the wording.
- Added `docs/translation-review/portuguese-review.txt` and
  `amharic-review.txt` (demo city Maputo and Addis Ababa respectively),
  matching the existing packet format.

### In Progress / Partially Done
- Nothing left half-finished — both languages work end-to-end
  (Portuguese live via Maputo, Amharic reachable via manual risk-check).

### Not Yet Started
- **Native-speaker review of Portuguese and Amharic** — both unreviewed
  AI drafts, same status French is in. Amharic should be treated as the
  most likely of the two (of all 7 languages, really) to need real
  correction — see the explicit warning in its review packet.
- **Whether to add an Ethiopian sample city to `regions.json` — an open
  decision, not made in this session.** Told the team plainly: without
  one, Amharic is invisible on the live dashboard and only reachable via
  a manual API call, which undercuts demoing it as a real feature.
  Adding one is a small, contained change (one more entry in
  `regions.json`, matching the existing 9-city format) but touches the
  "9 sample cities" framing referenced throughout the docs, so it's a
  team call, not something to do silently.
- Everything else already tracked in `todo.md`.

### Findings & Decisions
- **Maputo's bug was a real, live-output problem, not just a stale
  comment** — worth stating plainly since it could have been an
  embarrassing live-demo moment (a judge asking about the "most
  validated" city and getting an English message when Portuguese was
  expected). Treated as a priority fix per the team's explicit framing,
  fixed before any new language was added, not after.
- **Chose to verify the exact `.lower()` output for "São Tomé and
  Príncipe" before adding it as a dict key**, rather than assume ASCII
  folding — Python's `.lower()` preserves and lowercases accented
  characters rather than stripping them, so `country_from_location()`'s
  lookup needs the accented lowercase form to match. Added both the
  accented and a plain-ASCII fallback key to cover a caller who types it
  either way.
- **Caught and fixed an internal inconsistency before it reached the
  docs:** an early draft of this session's docstring said "six agreed
  languages" while listing seven names. Corrected everywhere (code
  comments, `api-contract.md`, `architecture.md`, `backend/README.md`)
  to consistently say 7 total, explaining the 6-AU-aligned-plus-Somali
  split, rather than leaving a number that doesn't match its own list.
- **Did not re-audit Rwanda/Burundi's existing French mapping** even
  though both have significant Swahili use — out of scope for this
  session (which was about adding Portuguese/Amharic and fixing
  Mozambique, not re-opening the French list), and neither is currently
  ambiguous in a way this session's instructions asked to check.

### Flags for the Team
- **Portuguese and Amharic still need native-speaker review** —
  `docs/translation-review/portuguese-review.txt` (demo: Maputo) and
  `amharic-review.txt` (demo: Addis Ababa, flagged as the highest-risk
  draft of all 7 languages) are ready to hand off.
- **Decide on an Ethiopian sample city.** Without one, Amharic support
  is real but invisible in any live demo of the dashboard — flagging
  this as a decision point, not deciding it here.
- **If Maputo's old (wrong) English output was referenced anywhere
  outside this repo** (screenshots, prior pitch materials, a PDF export)
  **it's now stale** — same caveat as the DRC/French fix from earlier
  today.

---

## 2026-08-17 — Translation review: Swahili/Arabic/Somali confirmed, city names localized, French added

### Completed
- Prepared and handed off a translation-review packet
  (`docs/translation-review/{arabic,swahili,somali}-review.txt`) to the
  team's native speakers — plain-text, demo data filled in instead of
  the `{location}` placeholder, an English gloss next to each line, and
  a section listing not-yet-translated UI strings (USSD menu, subscribe/
  unsubscribe confirmations, voice fallback line) so reviewers could
  flag whether those are worth localizing too, without us inventing
  translations for them ahead of a decision.
- **All three came back confirmed correct** — Swahili, Arabic, and
  Somali are no longer flagged as unreviewed AI drafts in
  `backend/app/models/translations.py`'s docstring/comments.
- **Reviewer feedback: city names should appear in the local language,
  not the English/Latin name.** Previously every language's message
  dropped in the plain English city name (e.g. "Cairo" inside an Arabic
  sentence). Added `LOCALIZED_CITY_NAMES` to `translations.py` —
  `{"Arabic": {"Cairo": "القاهرة"}, "Somali": {"Mogadishu": "Muqdisho"}}`
  — and `build_alert_messages()` now looks up the local name for
  `alert_message_local` only; `alert_message_en` is unaffected. Swahili
  needed no entries — Nairobi/Dar es Salaam/Kampala are already their
  Swahili names.
- **Added French as a 5th agreed language**, to reach more Francophone
  African countries per the team's request. `ALERT_TEMPLATES["French"]`
  added (AI-written, unreviewed — same status the other three were in
  before this session). `LOCAL_LANGUAGE_BY_COUNTRY["drc"]` corrected
  from `"English"` to `"French"` — French is DRC's actual official
  language; the old English mapping was only ever an arbitrary fallback
  for a language outside the previously-agreed four. Kinshasa is a live
  sample city in `regions.json`, so this is exercised by `/api/regions`
  immediately, not just a hypothetical.
  - Also added 15 more Francophone countries not yet in `regions.json`
    (Senegal, Mali, Côte d'Ivoire, Cameroon, Niger, Chad, Burkina Faso,
    Benin, Togo, Guinea, Gabon, Madagascar, Central African Republic,
    Rwanda, Burundi) — same "map ahead of having a sample city there"
    reasoning the team used for Somalia before Mogadishu was added.
  - **Deliberately did not add Congo-Brazzaville/Republic of the
    Congo** — its country name is too easily confused with DRC ("Congo")
    to add safely without a real example to test the parsing against.
- Verified all of the above against the running server, not just by
  reading the diff: `POST /api/risk-check` for Cairo now returns
  `القاهرة` in `alert_message_local`; Mogadishu returns `Muqdisho`;
  `GET /api/regions`'s Kinshasa entry now shows `"local_language":
  "French"` with a real French sentence; a test call for "Dakar,
  Senegal" (not a real sample city, just a mapping check) correctly
  resolved to French too.
- Regenerated `docs/mock-data.json`'s Cairo entries (both the `regions`
  list and `risk_check_example`) and Kinshasa's `regions` entry to match
  the live output exactly — same zero-drift discipline as every prior
  contract-affecting change.
- Updated `docs/api-contract.md`, `docs/architecture.md`,
  `backend/README.md`, and `docs/frontend-feature-spec.md` everywhere
  they listed "four languages" or the old DRC→English mapping.
- Updated the three existing review packets to say "CONFIRMED CORRECT"
  instead of "never reviewed," with their demo text updated to the new
  localized-city-name output — kept as accurate reference material, not
  left stale now that the review happened. Added
  `docs/translation-review/french-review.txt` for the next reviewer,
  using Kinshasa as the demo city and flagging that the wording will be
  reused across all the newly-added Francophone countries (worth a
  regional-neutrality check, not just a grammar check).

### In Progress / Partially Done
- Nothing left half-finished — the language/city-name change is
  complete and verified end-to-end.

### Not Yet Started
- **French alert wording is unreviewed** — same status Arabic/Swahili/
  Somali were in until today. `docs/translation-review/french-review.txt`
  is ready to hand to a French speaker whenever one's available.
- City-name localization was only added for Arabic and Somali (the two
  languages where reviewers actually asked for it) — if a French speaker
  says a French/francized city name is expected for a specific city
  (uncommon, but some cities do have distinct French exonyms), that's a
  small addition to `LOCALIZED_CITY_NAMES`, not a rework.
- Everything else already tracked in `todo.md`.

### Findings & Decisions
- **Chose to localize the city name only inside `alert_message_local`,
  never `alert_message_en`.** `alert_message_en` is meant to be readable
  by anyone regardless of local language (e.g. for team/judge review),
  so keeping it in plain English city names throughout was an easy,
  low-risk call — no reviewer asked for this to change, and changing it
  would arguably reduce clarity for that message's actual purpose.
  Voice/USSD/SMS purposes reflect `alert_message_local`, so they all
  benefit from the same fix automatically for both languages.
- **DRC's language correction (English → French) is a live output
  change on an existing endpoint field (`local_language`,
  `alert_message_local` for Kinshasa), not just an additive field.**
  Flagging this explicitly per the standing "don't change the contract
  without saying so" instruction — no field was renamed/removed/retyped,
  but an existing region's *value* changed. This is a deliberate,
  requested correction (DRC's old English mapping was never claimed to
  be linguistically correct, just an arbitrary fallback), not drift.
- **Chose a broad but conservative set of Francophone countries to add
  ahead of time**, excluding any country name ambiguous enough to
  misroute (Congo-Brazzaville vs. DRC being the clearest risk) or where
  French isn't clearly the primary/most natural choice among this app's
  five languages (e.g. skipped Djibouti — Arabic, French, and Somali are
  all plausible there, and guessing wrong is worse than leaving it
  unmapped to the English default).

### Flags for the Team
- **Only French is left unreviewed now.** Get a French speaker to check
  `docs/translation-review/french-review.txt` before relying on it in a
  demo where DRC/Kinshasa (or any other French-mapped country) comes up.
- **If the team adds a sample city in a newly-mapped French country**
  (Senegal, Mali, Côte d'Ivoire, etc.) **to `regions.json`, it'll
  automatically get French alert text** — no code change needed, this
  was the point of mapping ahead of time.
- **`docs/mock-data.json` and the live API will now disagree with any
  screenshot/notes taken before this session** for Cairo (city name) and
  Kinshasa (whole language) — expected, not a regression, if anyone
  notices the difference from older material.

---

## 2026-08-17 — Investigated real ML training data; found it doesn't cleanly support a retrain

### Completed
- Team lead asked to investigate replacing `train_ml_model.py`'s synthetic
  training data with real historical data, explicitly permitting an
  honest "not feasible cleanly" outcome rather than forcing a retrain.
  Scoped strictly to ML training data — no other files touched beyond
  what's listed below.
- Confirmed the "intentionally isolated, contained swap" claim in
  `docs/architecture.md` is accurate: `generate_synthetic_training_data()`
  returns `(X, y)` and everything downstream (the `Pipeline`, the
  train/test split, the save step) doesn't care where `X`/`y` came from.
  The blocker turned out to be data availability, not code structure.
- **Checked 4 sources, actually querying each live (not from memory),
  via 5 parallel research passes:**
  - **EM-DAT** (emdat.be): registration-gated even for the public query
    tool — confirmed by hitting the live page, not just reading their
    docs. An open HDX mirror exists but is aggregated to country/year
    counts, no city granularity. Ruled out: not usable in this timeframe.
  - **ICPAC East Africa Hazards Watch**: no documented raw-data API —
    the Floods Watch layer shows categorical High/Medium/Low discharge
    buckets, not measured mm/m values, and only covers 4 of our 9 cities
    (the IGAD region) to begin with. Ruled out: wrong data shape even if
    accessible.
  - **NASA EONET**: genuinely free, no key — confirmed with a real
    successful call. But its "floods" category returned essentially
    nothing for Africa (0 events across every query tried), and every
    returned event's `sources` field pointed back to GDACS — it's a thin
    GDACS mirror, not independent data. Ruled out: empty.
  - **GDACS** (gdacs.org): genuinely free, no key, real historical depth
    (confirmed events back to 2010+). This one actually works.
  - **Bonus check, not in the original source list:** Open-Meteo's
    Historical Weather API (ERA5 reanalysis, free, keyless, to 1950) and
    Flood API (GloFAS reanalysis, free, keyless, 1984–2022) both work —
    confirmed with real successful calls returning real daily values for
    our cities. This closes the "no free river-adjacent data exists"
    assumption from the original brief, with a caveat: GloFAS gives river
    **discharge in m³/s**, not **level in meters** — a different
    quantity, not a drop-in substitute for `river_level_m`.
- **Built and actually ran `backend/app/models/fetch_real_training_data.py`**
  end-to-end against the live APIs (not just written and left untested):
  pulls real daily rainfall + real daily discharge for all 9 cities from
  `regions.json` (2010-01-01 to 2022-07-31, the window GloFAS's July 2022
  cutoff forces), and labels each day using real GDACS flood events
  within 150km and ±3 days, defaulting everything else to "low."
  - Hit and fixed two real bugs while running it: GDACS returns an empty
    204 body (not JSON) for a country with zero matching events (crashed
    the first run on Egypt), and Open-Meteo's flood-api endpoint
    occasionally resets the connection under rapid repeated calls (added
    retry/backoff + a 1-second pace between requests).
  - **Actual result: 41,355 (city, date) rows written to
    `backend/app/data/real_training_data.csv`. Only 14 of them (0.034%)
    carry a real GDACS-confirmed elevated-risk label — 7 days each for
    Maputo and Mogadishu, the only 2 of 9 cities with any matching event
    at all.** The other 7 cities, including Cairo (zero GDACS flood
    events in the entire window — consistent with the Nile being
    dam-regulated), got zero real positive labels. Several of the
    *closest* real events for other cities (e.g. Nairobi, Dar es Salaam)
    turned out to date from 2023–2024 — just past GloFAS's July 2022
    cutoff, so the best available real evidence for those cities isn't
    even in the usable window.
  - **Found a second, more serious problem while inspecting a live GDACS
    response, not from the coverage numbers alone:** many GDACS river
    flood events carry `"source": "GLOFAS"` — the event label is itself
    partly auto-generated from a GloFAS discharge threshold crossing.
    Since discharge is also this dataset's proposed input feature, using
    GDACS-GloFAS events as the label risks real leakage/circularity, not
    just class imbalance — a model could partly re-derive the label from
    the same series it's handed as input, rather than learning a genuine
    relationship.
- **Decision: did not retrain or touch `train_ml_model.py`/`ml_risk_model.pkl`.**
  Both problems found (severe label scarcity/imbalance — 7 of 9 cities
  with zero real positive examples — and the discharge/label leakage
  risk) are real data-quality issues, not solvable with more engineering
  time. Forcing a retrain on this data would produce a model that looks
  more "validated" than it actually is, which cuts against this project's
  established pattern of flagging what's real vs. simulated/synthetic
  rather than overstating it.

### In Progress / Partially Done
- Nothing left half-finished — the investigation reached a clear,
  evidence-backed conclusion, not an inconclusive stopping point.

### Not Yet Started
- Nothing new opened by this session. The underlying "train on real data"
  item in `todo.md` is updated to reflect this finding rather than left
  as if it were still simply undone.

### Findings & Decisions
- **Recommendation: keep the synthetic-trained model for the demo, and
  cite the real sources as external validation/context instead of a
  training-data replacement.** E.g., a pitch slide showing real rainfall
  + real GDACS-confirmed flood dates for Nairobi or Dar es Salaam,
  annotated with what the rules-based/ML thresholds would have said on
  those real days, is honest, uses real external data, and doesn't carry
  the leakage/imbalance problems a forced retrain would.
- `backend/app/data/real_training_data.csv` (41,355 rows, generated
  2026-08-17) is left in place as a real, inspectable artifact — useful
  for that pitch-slide idea above — but is explicitly NOT wired into
  `train_ml_model.py`. Regenerate by rerunning the fetch script rather
  than hand-editing it; it will change slightly run-to-run only if
  Open-Meteo's or GDACS's underlying data is revised.
- `backend/requirements.txt` gained one line, `requests>=2.30` — the new
  fetch script's only new dependency (it was already installed
  transitively via the `africastalking` SDK, but wasn't declared
  directly until now).

### Flags for the Team
- **If anyone is tempted to "just retrain on the CSV anyway" for a bigger
  pitch claim: don't, without addressing the leakage issue first.** A
  judge asking "is this trained on real flood data?" deserves the honest
  answer this session arrived at — real data was seriously investigated
  and partially assembled, but doesn't yet support a clean retrain — not
  a technically-true-but-misleading "yes."
- **The 150km/±3-day event-matching radius in `fetch_real_training_data.py`
  is a judgment call, clearly marked as one in the code** (`EVENT_RADIUS_KM`,
  `EVENT_WINDOW_DAYS`) — loosening it would manufacture more positive
  labels without addressing why they're scarce (few real GDACS-logged
  events near most of our cities in this specific window), so it's not a
  quick fix for the imbalance problem, just a way to hide it.
- **`docs/architecture.md`'s "Two risk scores, on purpose" section's
  documented upgrade path ("swap out `generate_synthetic_training_data()`
  for a real dataset loader") was correct about the code being a
  contained swap** — the barrier turned out to be real-world data
  availability, not the codebase. Worth knowing before anyone assumes
  this is still just an engineering task waiting to be picked up.

---

## 2026-08-17 — IoT sensor ingestion: POST /api/sensor-reading + Wokwi ESP32 simulation

### Completed
- Team lead specced an IoT/hardware addition: an ESP32-WROOM-32 (chosen
  over Arduino Uno for built-in WiFi) with exactly two analog sensors —
  a rain sensor (YL-83/FC-37 style) and a water level sensor — chosen
  deliberately minimal because they map directly onto the risk model's
  two existing inputs (`rainfall_mm_24h`, `river_level_m`). No real
  hardware exists yet; this session built the backend ingestion path and
  a Wokwi (browser-based ESP32 simulator) simulation to demo it, per
  explicit instructions not to touch the frontend or change
  `/api/risk-check`, `/api/regions`, or `/api/alerts`.
- **Design decision: reused `/api/risk-check`'s scoring logic via a
  shared function, not a duplicate implementation.** Refactored
  `backend/app/routes/risk.py` to extract `build_risk_check_response()`
  — the exact same computation `POST /api/risk-check` already did, just
  no longer inlined in that route handler. `risk_check()` itself now
  just calls it. Verified this refactor changed nothing observable: same
  Cairo/Egypt example (`risk_score: 0.42`, Arabic alert text) came back
  identical before and after, tested against the running server, not
  just read from the diff.
- **New `backend/app/routes/sensors.py`** (`POST /api/sensor-reading`):
  accepts `{device_id, rainfall_mm_24h, river_level_m, timestamp}`,
  resolves `device_id` → region via the new `backend/app/data/devices.json`
  (404 on an unregistered device rather than guessing a location), then
  calls `build_risk_check_response()` — so a device reading is scored by
  exactly the same code path as a manual risk-check, not a second
  implementation that could drift from the first. `rainfall_mm_24h`/
  `river_level_m` reuse the identical `allow_inf_nan=False` field
  constraint `RiskCheckRequest` uses, so they're rejected by the same
  `RequestValidationError` handler in `app/main.py` that already fixes
  the NaN/Infinity-crash bug — confirmed by sending a literal `NaN` and
  getting a clean 422, not a 500.
- **Decided this needed a genuinely separate route, not a bare alias**,
  because the request shapes differ in a real way: `/api/risk-check`
  takes a human-provided `location_name`/`latitude`/`longitude` directly;
  a device only knows its own `device_id` and must have its location
  resolved server-side. An alias would have forced the ESP32 firmware to
  know and send its own human-readable location, which doesn't match how
  a real IoT fleet is provisioned (the backend knows where a device is
  installed, not the device itself).
- **New `backend/app/data/devices.json`**: a device-to-region registry
  (`device_id` → `location_name`/`latitude`/`longitude`), same
  seed-by-hand pattern as `subscribers.json`. Seeded with one demo entry,
  `"esp32-demo-01"` → `"Lagos, Nigeria"` — a deliberate default since the
  team's spec didn't include a location field in the device payload (by
  design, per the request), not a silent guess: flagging it explicitly
  here and in the docs in case a different demo region was intended.
- **New `hardware/wokwi-flood-sensor/`**: a Wokwi (wokwi.com, browser-based,
  no local toolchain needed) ESP32 simulation.
  - `sketch.ino`: reads two simulated analog sensors (potentiometers
    standing in for the rain/water-level sensors' voltage output on
    GPIO34/GPIO35 — input-only ADC pins, chosen to avoid conflicting with
    WiFi), converts each 0–4095 raw ADC reading onto the same scale the
    backend expects (0–100mm rainfall, 0–4m river level — matching
    `risk_model.py`'s caps), syncs real UTC time over NTP (Wokwi's
    simulated network supports it), and POSTs a JSON reading to
    `/api/sensor-reading` every 15 seconds, printing what it sends (and
    the backend's response) to Serial. No external libraries beyond the
    ESP32 core's built-in `WiFi.h`/`HTTPClient.h` — kept dependency-free
    and readable per the instruction that whoever demos this may have
    never touched embedded code before.
  - `diagram.json`: ESP32 devkit + two potentiometers wired to
    GPIO34/GPIO35, each with a `label` attr naming which real sensor it
    simulates. Not run through the actual Wokwi simulator to confirm
    pixel-perfect part/pin names (no access to Wokwi's simulator from
    this environment) — flagged as unverified below.
  - `README.md`: setup + the exact answer to "how do I test this
    end-to-end" — see Findings below, since this had a real, specific
    constraint (Wokwi can't reach `localhost`) that needed a concrete
    workaround, not a hand-wave.
- Updated `docs/api-contract.md` (new `POST /api/sensor-reading` section),
  `docs/architecture.md` (diagram + a new "IoT sensor ingestion" section,
  updated the stale "Add low-cost IoT sensor integration" Future
  Improvements line), both top-level `README.md`s, and `todo.md` (marked
  the IoT-ingestion item done, added the still-open "test Wokwi against a
  real backend" item under Critical).

### In Progress / Partially Done
- The backend half is complete and tested end-to-end (`curl` standing in
  for the ESP32: happy path, unknown device → 404, NaN → clean 422, and
  output verified byte-for-byte identical to `/api/risk-check` for the
  same inputs). The Wokwi half exists as files but **has not been run
  inside Wokwi's actual simulator** — this environment has no browser/
  Wokwi access, so `sketch.ino`/`diagram.json` are written correctly
  against Wokwi's documented conventions (confirmed from prior knowledge
  of their format, not verified live) but unverified end-to-end.

### Not Yet Started
- **Actually running the Wokwi simulation** (open it at wokwi.com, paste
  in these two files, verify the diagram wires cleanly with no red
  error markers, watch the Serial Monitor) — needs a human with browser
  access, which this environment doesn't have.
- **Testing the full loop against a real locally-running backend** —
  needs `ngrok` (or similar) to expose `localhost:8000` publicly, since
  Wokwi's simulated ESP32 cannot reach `localhost` (that address means
  "the Wokwi simulator itself" from inside the simulation, not the host
  computer). Documented as the primary answer to "how do I test this,"
  not just a footnote — see `hardware/wokwi-flood-sensor/README.md`.
- Real ESP32 hardware — this was never in scope for this session (Wokwi
  simulation only, per the plan as given).
- Everything else already tracked in `todo.md`.

### Findings & Decisions
- **Answering "how do I test this end-to-end," the specific ask this
  session's instructions called out:** run the backend locally
  (`uvicorn app.main:app --reload`), run `ngrok http 8000` in a second
  terminal to get a public URL, paste that URL (the `http://`, not
  `https://`, form — ngrok exposes both — to avoid TLS/certificate
  handling in the sketch) into `SERVER_URL` in `sketch.ino`, then run the
  Wokwi simulation. This is the standard, documented way to bridge
  Wokwi's simulated network to a real local server — Wokwi's own
  "Wokwi-GUEST" WiFi network gives the simulated ESP32 real internet
  access, but "real internet" still doesn't include a developer's own
  `localhost`.
- **What won't work as expected, flagged rather than discovered live:**
  (1) hardcoding `http://localhost:8000` in the sketch — Wokwi will
  resolve "localhost" to itself, not the host machine, so every request
  will fail silently or time out; (2) HTTPS without either using ngrok's
  plain-http forwarding or adding `WiFiClientSecure`/`setInsecure()` to
  the sketch — chose the ngrok-http-URL route specifically to avoid
  needing certificate-skipping code in a sketch meant to be read by
  someone new to embedded work.
- **Chose NTP time sync over `millis()`-since-boot for the device's
  `timestamp` field** — Wokwi's simulated internet supports it with
  ~10 lines of standard ESP32 code, and a fake relative timestamp would
  have been actively misleading in a field meant to carry a real clock
  reading, inconsistent with this project's pattern of not faking data
  that looks real. (The response's own `timestamp` field, per the
  response-shape-must-match-`/api/risk-check` requirement, is still
  server-computed at scoring time, same meaning as everywhere else that
  field appears — the device's reported timestamp is accepted/validated
  but not part of what's returned.)
- **`docs/api-contract.md`'s per-endpoint "3 endpoints" reference was
  already stale** (there are 7 now, after this week's SMS/USSD/voice
  additions) — corrected in the top-level `README.md` while already
  editing that section; not a change introduced by this session's work,
  just a pre-existing inaccuracy fixed in passing.

### Flags for the Team
- **The device-to-region mapping is a real design decision worth a
  second look, not an obvious default.** The spec's minimum payload
  (`device_id`, `rainfall_mm_24h`, `river_level_m`, `timestamp`) doesn't
  include a location, so `devices.json` resolves it server-side — this
  is the standard IoT-fleet pattern (a backend registry knows where a
  device is installed; the device itself just knows its own ID), but if
  a different design was intended (e.g. the ESP32 sending its own
  location), that's a small, contained change to `sensors.py`, not a
  rewrite.
- **The demo device (`"esp32-demo-01"`) was mapped to Lagos, Nigeria by
  default** — arbitrary, since nothing in the spec named a region. Change
  `backend/app/data/devices.json` (and `DEVICE_ID`/the pin-to-sensor
  comments in `sketch.ino` if the region matters for the demo narrative)
  if a different city fits the pitch better.
- **`hardware/wokwi-flood-sensor/diagram.json` has not been visually
  confirmed inside Wokwi's editor** — Wokwi part/pin names
  (`wokwi-esp32-devkit-v1`, `wokwi-potentiometer`, pin names like `D34`/
  `GND.1`) were written from established convention, not verified
  against a live Wokwi session. If Wokwi's editor shows a wiring error on
  open, it's very likely a minor pin-name mismatch, fixable by dragging
  the wire to the correct pin in Wokwi's visual editor — not a sign the
  underlying approach is wrong.
- **This is additive and isolated** — `/api/risk-check`, `/api/regions`,
  and `/api/alerts` are unchanged in behavior (the risk.py edit was a
  pure refactor, verified before/after), and the frontend wasn't touched,
  per this session's explicit instructions.

---

## 2026-08-17 — Voice alerts (Social Impact & Inclusion): read jury scorecard, added Africa's Talking voice calls

### Completed
- Read the actual jury scorecard (`AI_for_All_Hackathon_Jury_Evaluation_Scorecard.docx`,
  provided by the team lead) — this has the **exact point weights** per
  criterion, which weren't known before (the earlier docs review only had
  the criteria names, not weights): Problem & DRR Relevance 15, Innovation
  & Creativity 15, **Social Impact & Inclusion 20**, **Functionality &
  Prototype 20**, Feasibility & Scalability 10, Appropriate Use of
  AI/Technology 10, Sustainability & Resource Efficiency 5, Presentation &
  Pitch 5. Also read `AYAB-DRR_Training_Evaluation_Forms.docx` — confirmed
  it's a training-satisfaction survey (Kirkpatrick Level 1), not relevant
  to project features.
- **Identified Social Impact & Inclusion (tied for the largest single
  category, 20/100) as the weakest-covered criterion.** The scorecard
  explicitly names "people with disabilities, women, children, elderly
  people, and underserved groups." USSD already helps the
  no-smartphone/underserved angle, but nothing addressed disability or
  literacy access specifically.
- **Added voice alerts** as the highest points-per-effort fix, reusing
  the Africa's Talking account/credentials already set up for SMS/USSD
  rather than a new integration:
  - **New `backend/app/models/voice_gateway.py`**: wraps
    `africastalking.Voice.call()` behind `is_configured()`/`place_call()`,
    same pattern as `sms_gateway.py`. Outbound voice calls are two-step in
    Africa's Talking's model — `place_call()` starts the call, then
    Africa's Talking calls back once answered, expecting XML instructions.
    Since that callback carries no memory of *why* the call was placed,
    added a `_pending_messages` dict keyed by phone number, written by
    `place_call()` and read (and cleared) by the callback — confirmed
    this bridging approach against the SDK's actual `Voice.call()`
    signature (`callFrom, callTo`) by reading its source directly.
  - **New `backend/app/routes/voice.py`** (`POST /api/voice/callback`):
    the webhook Africa's Talking calls when a voice alert connects.
    Returns Africa's Talking's XML "Voice Actions" format (`<Say>`), not
    JSON — `xml.sax.saxutils.escape()` used on the message to avoid
    malformed XML if a message ever contains `&`/`<`/`>`. Falls back to a
    generic spoken line if no message is queued for that number, rather
    than saying nothing.
  - `backend/app/routes/alerts.py`: `SendAlertRequest` gained a
    `channel: Literal["sms", "voice"] = "sms"` field (additive, default
    preserves old behavior exactly). `channel="voice"` calls
    `voice_gateway.place_call()` instead of `sms_gateway.send_sms()`,
    logging `"Voice call"` / `"Voice call (simulated)"` instead of the
    SMS equivalents — same subscriber list, same fallback-when-
    unconfigured-or-no-subscribers safety as the SMS path.
  - `backend/app/config.py`: added `AT_VOICE_NUMBER` (the sandbox app's
    Voice number — separate from the SMS sender, per Africa's Talking's
    account model). `backend/.env.example` documents it.
  - `backend/app/main.py`: registered the new `voice` router, updated app
    description and root endpoint list.
- **Verified end-to-end with the server running locally**: confirmed
  `POST /api/alerts/send` with `"channel": "voice"` correctly returns
  `"channel": "Voice call (simulated)"` (no `AT_VOICE_NUMBER` configured
  in this environment); confirmed `POST /api/voice/callback` returns
  well-formed `<Say>` XML with the correct fallback line when no message
  is queued (the actual "message queued then read back" path can't be
  tested without real Africa's Talking credentials placing a real call —
  see Not Yet Started). Test-generated `alert_log.json` entries were
  deleted before committing, same discipline as the previous session.
- Updated `docs/api-contract.md` (new `POST /api/voice/callback` section,
  updated `/api/alerts/send`'s request/response to cover `channel`),
  `docs/architecture.md` ("Real SMS/USSD alerts" renamed "Real
  SMS/USSD/Voice alerts", with the Social-Impact rationale explained),
  both `README.md`s, and this entry.

### In Progress / Partially Done
- Nothing left half-finished in the code — the voice channel works
  end-to-end in simulated mode, same as SMS did before its first real
  test.

### Not Yet Started
- **Real end-to-end voice test** — nobody has placed an actual Africa's
  Talking sandbox voice call yet. Needs `AT_VOICE_NUMBER` set, a public
  callback URL (e.g. `ngrok`) pointed at `/api/voice/callback`, and a
  real test call to confirm the `_pending_messages` handoff works against
  Africa's Talking's real timing/behavior, not just the logic in isolation.
- **Non-English `<Say>` text-to-speech is unverified** — flagged
  explicitly in `docs/architecture.md` and `api-contract.md`. If Africa's
  Talking's voice synthesis doesn't handle Arabic/Swahili/Somali well,
  the fallback for those regions would need to be an English voice
  message rather than `alert_message_local` — a one-line change in
  `alerts.py` if needed, but shouldn't be assumed fine without testing.
- Everything listed as Not Yet Started in the entry below (real AT
  credentials for SMS too, USSD real-sandbox test, automatic
  threshold-triggered sends, real subscriber outreach at scale, ML
  real-data training, translation review, pitch deck, Innovation Canvas,
  sustainability/scalability narrative) — consolidated into a new
  top-level `todo.md` this session so they're tracked in one place
  instead of scattered across log entries.

### Findings & Decisions
- **Chose voice over other Social-Impact options** (e.g. a
  vulnerability/accessibility indicator per region, community reporting)
  because it reuses infrastructure already built this week (same Africa's
  Talking account, same subscriber list, same alert-text generation) —
  highest points-per-effort given the real deadline is Sep 17–19, not a
  rebuild of the recipient/messaging model.
- **Voice and SMS share one subscriber list** (`subscribers.json`) rather
  than a per-channel preference — a subscriber added via USSD gets both
  channels available to send to, since USSD's subscribe flow doesn't ask
  which channel they want. Simple for a hackathon demo; a real product
  would let someone choose SMS-only vs. voice-only.
- Learning the scorecard's exact weights changes prioritization concretely:
  Social Impact & Inclusion and Functionality & Prototype are tied for
  the largest categories (20 each, 40% of the total combined) — this is
  why voice (Social Impact) was chosen as this session's build, over e.g.
  a Sustainability-focused change (worth only 5 points).

### Flags for the Team
- **Whoever sets up the real Africa's Talking sandbox account (still not
  done — see previous entry) should also grab the Voice number while
  they're in the dashboard** and add `AT_VOICE_NUMBER` to `.env` alongside
  `AT_USERNAME`/`AT_API_KEY` — one signup covers all three channels.
- **Test a real voice call to your own phone before the pitch**, same as
  the SMS flag from the previous entry — don't find out live that the
  `_pending_messages` handoff or Africa's Talking's TTS doesn't behave as
  expected.
- **`todo.md` (new, repo root) now tracks every open item across both
  sessions in one place** — check there instead of scanning old
  progress-log entries for what's left.

---

## 2026-08-17 — Real SMS/USSD alerts via Africa's Talking

### Completed
- Team decision: since the real deadline is now known to be 2026-09-17 to
  2026-09-19 (see the entry below), not 2026-08-29, chose to build real
  SMS/USSD alerts now rather than leave them simulated — this is the
  single highest-leverage remaining item against the "Appropriate Use of
  AI/Technology" judging criterion identified in the docs review below.
- **New `backend/app/config.py`**: centralized env config (`AT_USERNAME`,
  `AT_API_KEY`, `AT_SENDER_ID`), loaded via `python-dotenv` from a `.env`
  file. **New `backend/.env.example`** documents the keys; `.env` itself
  was already gitignored (`.env.*` pattern, `.env.example` excluded) from
  the original skeleton session, so no gitignore change was needed.
- **New `backend/app/models/sms_gateway.py`**: wraps the `africastalking`
  SDK behind `is_configured()`/`send_sms()`. Verified the exact SDK
  version installed (`africastalking==2.0.3`) exposes `initialize(username,
  api_key)` and `SMS.send(message, recipients, sender_id=...)` by reading
  its source directly rather than assuming API shape from memory/docs.
- **New `backend/app/data/subscribers.json`**: recipient list
  (`{"phone_number", "location_name"}` pairs), starts empty (`[]`).
  Populated by the new USSD subscribe flow, or by hand for testing.
- **Rewrote `backend/app/routes/alerts.py`**: `GET /api/alerts` now
  returns real send history from `app/data/alert_log.json` (created on
  first send) once anything exists there, falling back to the original
  hardcoded `mock-data.json` list otherwise — so the endpoint is never
  empty on a fresh clone. **New `POST /api/alerts/send`**: looks up a
  region, computes its current risk + local-language alert text (same
  functions the other endpoints already use), finds its subscribers, and
  sends via Africa's Talking if configured and there's at least one
  subscriber — otherwise logs a clearly labeled `"SMS (simulated)"` entry
  instead. Every call appends to `alert_log.json`, real or simulated.
- **New `backend/app/routes/ussd.py`** (`POST /api/ussd`): Africa's
  Talking USSD webhook implementing a 3-option menu — check a region's
  flood risk, subscribe this phone number to a region's alerts (writes to
  `subscribers.json`), or unsubscribe from all regions. No smartphone or
  SMS credit needed to use it, which is the point of USSD for this
  project's "last-mile" framing.
- `backend/app/main.py`: registered the new `ussd` router, updated the
  app description and root endpoint list to include both new routes.
- `backend/requirements.txt`: added `africastalking>=2.0`,
  `python-multipart>=0.0.9` (needed for FastAPI to parse USSD's
  form-encoded webhook body), `python-dotenv>=1.0`.
- **Verified end-to-end with the server running locally**, not just by
  reading the code: `GET /api/alerts` correctly falls back to the mock
  list on a clean state; `POST /api/alerts/send` for Lagos correctly
  returns `"channel": "SMS (simulated)"` and `"recipients": 0` with zero
  subscribers (no `AT_API_KEY` set in this session's test); walked the
  full USSD menu tree via raw form-encoded POSTs (welcome → check risk →
  region list → Lagos risk result; welcome → subscribe → region list →
  Lagos subscribe confirmation) and confirmed `subscribers.json` was
  written correctly; re-sent the Lagos alert and confirmed `recipients`
  went from 0 to 1, reflecting the new subscriber. Test-generated
  `subscribers.json`/`alert_log.json` entries were reset to empty/deleted
  before committing — they're runtime state, not seed data.
- Updated `docs/api-contract.md` (new sections for both endpoints, updated
  `GET /api/alerts` section to describe the log/fallback behavior and the
  new `recipients` field), `docs/architecture.md` (diagram + a new "Real
  SMS/USSD alerts" section, moved the old "integrate a real SMS/USSD
  gateway" line out of Future Improvements), `README.md`, and
  `backend/README.md` (setup instructions for `.env`, new endpoints,
  a "SMS/USSD alerts" how-to-test section).

### In Progress / Partially Done
- Nothing left half-finished from this session's scope — both endpoints
  work end-to-end in simulated mode; only real Africa's Talking sandbox
  credentials are needed to flip sends from simulated to real, and that's
  a config step (`.env`), not a code change.

### Not Yet Started
- **Nobody has actually created an Africa's Talking sandbox account yet**
  — `AT_USERNAME`/`AT_API_KEY` are unset in this environment, so every
  send so far has been simulated. Whoever owns this next should sign up
  at https://account.africastalking.com/ (free), fill in `backend/.env`,
  and send one real test SMS to their own phone before the pitch.
- USSD hasn't been tested against Africa's Talking's actual USSD
  simulator/sandbox (only tested locally via raw form-encoded curl
  requests standing in for their webhook call) — needs a public URL
  (e.g. `ngrok`) pointed at a running server and a sandbox USSD channel
  configured to call it.
- Automatic threshold-triggered sends (a scheduled job firing
  `/api/alerts/send` when a region crosses into `high`) — this session
  only built on-demand sending.
- Real subscriber registration/outreach at scale — today's subscriber
  list is either hand-seeded or grown one USSD session at a time.
- Everything else already listed as Not Yet Started in prior entries
  (real historical ML training data, native-speaker translation review,
  pitch deck, Innovation Canvas, sustainability/scalability narrative).

### Findings & Decisions
- **Chose on-demand sending (`POST /api/alerts/send`, called manually or
  from a dashboard button) over automatic threshold-triggered sending**
  for this pass — far less to build and demo, and equally convincing for
  a judge ("here's a real SMS arriving on my phone") without needing a
  background scheduler. Automatic triggering is a documented next step,
  not abandoned.
- **Both SMS and the USSD risk-check screen send `alert_message_local`,
  not `alert_message_en`** — consistent with the whole project's
  "last-mile, local-language" framing. (First draft of the USSD handler
  used `message_en` for that screen; caught and fixed before this entry,
  not left as a known inconsistency.)
- **USSD region menu uses each city's short name only** (e.g. "Lagos",
  not "Lagos, Nigeria") to keep each screen short — USSD screens have a
  tight length limit on many carriers, and 9 full "City, Country" lines
  risked overflowing it. Not verified against a real carrier's exact
  limit this session; flagged as a real risk if regions expand.

### Flags for the Team
- **`docs/mock-data.json`'s alert examples don't have a `recipients`
  field** — that field only appears on entries created by the new
  `/api/alerts/send` log, not the old hardcoded fallback list. Frontend:
  if you display `recipients`, handle it being absent/undefined on
  fallback entries.
- **Nobody has real Africa's Talking credentials configured yet** — see
  Not Yet Started above. Don't be surprised every alert still says
  `"(simulated)"` until someone completes that step.
- **`backend/app/data/subscribers.json` and `alert_log.json` are runtime
  state, not seed data** — they'll change as people test locally. Check
  `git diff` before committing either file; don't commit test phone
  numbers or fake send history.

---

## 2026-08-17 — Frontend PR review + corrected the real hackathon deadline

### Completed
- Reviewed Habiba's frontend dashboard PR (#1 "habiba-frontend", merged as `152343f`: `RiskOverview`, `RiskMap`, `RiskDistribution`, `RegionTable`, `RecentAlerts`, `AlertCard`/`AlertDetails`/`RegionDetails`, `Sidebar`/`Topbar`/`StatCard`, plus stub pages for Alerts/Analytics/Regions/Reports/HelpSupport/Settings). Verified her "complete dashboard with real API data" claim against the actual code rather than taking it at face value.
- Confirmed **4 of 5 widgets genuinely fetch live from `GET /api/regions`** (`RiskOverview`, `RiskMap`, `RiskDistribution`, `RegionTable`) and correctly handle both the flat and `risk_score_breakdown`-nested score fields on the right 0–1 scale — the backend/frontend contract is working as designed.
- Read the entire `docs/` folder, including the hackathon organizers' materials (`docs/helpfull-from-the-online-session/AYAB DRR AI for All Hackathon_Ideation deck.pdf` and `AI 4 All Hackathon information brief_AYAB_DRR.pdf`), to check the team's plan against the actual program structure.

### In Progress / Partially Done
- Nothing half-finished from this session — this was a review + planning pass, no code was changed (frontend was explicitly left untouched per team-lead instruction; backend needed no fix).

### Not Yet Started
- Fixing the frontend issues found in this review (see Findings) — deliberately left to the frontend team, not done this session.
- Pitch deck (`docs/pitch-notes.md` is still a placeholder).
- An Innovation Canvas artifact (problem/AI solution/tech & data sources/partners/impact/risks/scalability) — implied as expected deliverable by the organizers' ideation deck, not started.
- A "Sustainability & Resource Efficiency" / scalability narrative — not addressed anywhere in current docs, and it's one of the official judging criteria.
- Real SMS/USSD gateway (`/api/alerts` is still an intentional stub) — flagged again here specifically because Africa's Talking integration is the most direct way to score on the "Appropriate Use of AI/Technology" criterion.

### Findings & Decisions
- **Frontend review findings (not fixed this session, left for the frontend team):** `http://localhost:8000` is hardcoded as a literal API base URL in 4 separate files (`RegionTable.jsx`, `RiskMap.jsx`, `RiskOverview.jsx`, `RiskDistribution.jsx`) — will break on any non-local deployment; `src/data/mockData.js` (~290 lines) is dead code, not imported anywhere; `RecentAlerts.jsx` uses a hardcoded local array rather than `GET /api/alerts` (defensible given that endpoint is a deliberate stub, but should be labeled as such in the UI rather than blending in with the live widgets); `Dashboard.jsx` has a stray `py-` Tailwind class (likely a typo/no-op); the same fetch/loading/error boilerplate is copy-pasted across 4 components instead of one shared hook. New dependencies added (`leaflet`, `react-leaflet`, `framer-motion`, `lucide-react`, `react-router-dom`) are all reasonable, low-risk choices.
- **⚠️ Deadline correction — this is the important one.** `docs/progress-log.md` and `docs/api-contract.md` have been treating **2026-08-29** as *the* hackathon deadline. Per the official 2026 AYAB DRR / AI for All Hackathon brief, that date is only the end of the **Innovation Labs** build sprint. The actual program has three phases: Virtual Boot Camp (2026-08-14 to 2026-08-15, done), Innovation Labs (2026-08-15 to 2026-08-29, in progress now), and **Regional Hackathon & Demo Days (2026-09-17 to 2026-09-19)** — the real judged event, where only **5 of 12 teams** advance to pitch live to an international jury. Winner receives €1000 to finish the prototype. None of our docs currently reflect a plan for making that cut or preparing for a live jury Q&A.
- **Official judging criteria** (2026 brief, supersedes any older/generic weighting): Problem & DRR Relevance, Innovation & Creativity, Social Impact & Inclusion, Functionality & Prototype, Feasibility & Scalability, Appropriate Use of AI/Technology (incl. Robotics/IoT/GIS), Sustainability & Resource Efficiency, Presentation & Pitch. No published weights.
- Backend work to date maps well onto "Appropriate Use of AI" (real rules-based scoring + a genuinely trained, honestly-caveated ML second opinion, per the 2026-08-10 entries below) — the weaker criteria right now are Sustainability & Resource Efficiency and Feasibility & Scalability, neither of which any doc currently addresses.
- The rest of `docs/helpfull-from-the-online-session/` (Flutter, Robotics, Web-Dev-AI-session, Nour Said session slides) is generic training material, not hackathon-specific requirements. `Project's building tools.pdf` is a useful non-mandatory free-tooling cheat sheet (GDACS, ReliefWeb, Africa's Talking, etc.) worth revisiting when scoping the SMS/USSD gateway.

### Flags for the Team
- **Aug 29 is not the finish line — treat it as an internal milestone, not the deadline.** The real judged demo is 2026-09-17 to 2026-09-19, and only 5 of 12 teams get a pitch slot. Anyone planning around "we're done Aug 29" should replan around a pitch-ready state by mid-September instead.
- **Frontend team:** the API-URL/mock-data/typo issues above are yours whenever convenient — nothing broken today, just tech debt worth cleaning up before a real deployment or before Sept.
- **No one owns the pitch deck or Innovation Canvas yet** — both are effectively blank as of this entry and both map directly to judging criteria ("Presentation & Pitch," and the canvas covers several others at once). Worth assigning owners soon given the real deadline is now known to be further out but with a harder cut (top-5) at the end of it.

---

## 2026-08-10 — API enrichment: closed 4 gaps a frontend teammate flagged

### Completed
- A frontend teammate asked for the exact live API schema (fields: location, country, lat/lon, risk level, risk score, rainfall, water level, alert message). Cross-checked the actual route code against that list and found 4 gaps, then decided — for the strongest possible demo/judging outcome — to close all 4 as additive fields rather than push the workarounds onto the frontend:
  1. **`country` added** as a real field on both `POST /api/risk-check` and `GET /api/regions`, parsed from `location_name`. Implemented via a new public `country_from_location()` in `backend/app/models/translations.py` (display-cased); the existing internal `_country_from_location()` now delegates to it and lowercases for the language-lookup dict, so no behavior changed there.
  2. **`latitude`/`longitude` echoed back** in `POST /api/risk-check`'s response (previously only in the request — `GET /api/regions` already had them).
  3. **`rainfall_mm_24h`/`river_level_m` promoted to top-level** on both endpoints (previously only reachable via `risk_score_breakdown.rainfall_mm_24h` etc.). Kept in `risk_score_breakdown` too — additive duplicate, not a move, so nothing that already reads the nested path breaks.
  4. **`alert_message_en`/`alert_message_local`/`local_language` added to `GET /api/regions`**, computed per-region the same way `/api/risk-check` does (via `build_alert_messages`, using each region's rules-based `risk_level`). This was the highest-value fix: before this, a per-region alert view needed either a second API call per region or client-side duplication of the sample rainfall/river data — now it's one field, one call.
- Verified via live server calls (not reconstructed from memory) that all 4 new capabilities work correctly for every affected case, including non-trivial ones: `country: "DRC"` for Kinshasa (no comma-splitting edge case), `alert_message_local` in Arabic/Swahili/Somali/English correctly varying per-region, `rainfall_mm_24h`/`river_level_m` matching their `risk_score_breakdown` counterparts exactly.
- Regenerated `docs/mock-data.json` **programmatically** (a Python script writing the file from captured live JSON, not hand-edited) for all 9 regions plus the risk-check example, to eliminate any chance of transcription error given how many fields are now involved.
- Updated `docs/api-contract.md` (a third additive contract-change note, plus updated examples/field tables for both endpoints) and `docs/frontend-feature-spec.md` (noted that alert messages no longer require an extra risk-check call per region).
- Produced a standalone PDF (`docs/API-Schema-Reference.pdf`) of the finalized schema, in the exact copy-paste markdown format the teammate asked for, for the team lead to send her directly.

### In Progress / Partially Done
- Nothing left half-finished from this session's scope.

### Not Yet Started
- Nothing new — this closed out a specific request rather than opening new work.

### Findings & Decisions
- **Decision rationale for closing all 4 gaps rather than leaving some to client-side parsing:** the team lead asked to "decide the best for winning" — for a judged hackathon demo, a clean, flat, complete API response that "just works" for a frontend developer reduces integration risk and dev time under a tight deadline, which matters more here than minimizing backend surface area. All 4 changes are additive and zero-risk to existing consumers, so there was no real tradeoff to weigh against doing them.
- **`alert_message` on `/api/regions` intentionally reflects the rules-based `risk_level`, not `ml_risk_level`.** The ML score is a comparison/second-opinion field, not the "official" score used for alerting — consistent with the existing design (see the "Two risk scores, on purpose" section of `docs/architecture.md`). If the team ever wants an ML-based alert variant, that's a new, separate decision, not implied by this change.

### Flags for the Team
- **This is now the third documented exception to "don't change the API contract without asking"** — same as the ML fields, this was explicitly requested by the team lead this session, and is flagged in `docs/api-contract.md`, not snuck in.
- **Frontend team:** `country`, top-level `rainfall_mm_24h`/`river_level_m`, and per-region alert messages are now available on `GET /api/regions` — if you'd already built a workaround for any of these (e.g. parsing `location_name` yourself, or maintaining a duplicate rainfall/river table to call `risk-check` per region), you can simplify to use the new fields whenever convenient. Nothing forces an immediate change — old fields are untouched.
- `docs/API-Schema-Reference.pdf` is a snapshot as of this session — if the schema changes again, regenerate rather than hand-editing the PDF (same convention as the beginner-friendly overview PDF).

---

## 2026-08-10 — Dual risk model: genuine ML "second opinion" alongside rules

### Completed
- **Added a real, trained ML model** alongside the rules-based one, per the team's decision to lean into the hackathon's AI track. Model type: a `scikit-learn` `Pipeline` of `StandardScaler` + `LogisticRegression`, three-class (low/medium/high). Chosen because it's simple enough to describe in one sentence to a judge ("a learned linear boundary between the three risk levels, after standardizing the two inputs") — no deep learning, no ensemble methods, per the constraint to keep it judge-explainable.
- **Training data is synthetic** (`backend/app/models/train_ml_model.py`, `generate_synthetic_training_data()`), clearly flagged as such in that file's docstring with a `# TODO` pointing at the real upgrade path. It is deliberately **not** a 1:1 re-encoding of the rules-based formula: different feature weights (55/45 vs. the rules' 50/50), a compounding rainfall×river-level interaction term, and injected Gaussian noise before bucketing into labels. On a held-out synthetic test split, the trained model disagreed with what the rules-based formula would say for the same inputs on **11.00%** of samples (test accuracy against its own synthetic ground truth: 87.25%) — real variation, not a restatement.
- Verified against the 9 real sample cities in `app/data/regions.json`: **all 9 agree on risk_level bucket** between the two models, while the underlying scores differ slightly (e.g. Lagos: rules 0.82 vs. ML 0.84; Kinshasa: rules 0.31 vs. ML 0.23) — exactly the "second opinion, not a contradiction" framing wanted for the demo, confirmed empirically rather than assumed.
- Trained the model and committed the fitted pipeline to `backend/app/models/ml_risk_model.pkl` (1.2 KB) so the server loads it once at import time instead of retraining on every start.
- `backend/app/models/ml_risk_model.py`: inference wrapper. Blends the model's per-class probabilities into a single 0.0–1.0 `ml_risk_score` using fixed severity weights (low=0.2, medium=0.55, high=0.85 — the midpoints of the rules-based bands), then buckets that score into `ml_risk_level` using the **same** `HIGH_THRESHOLD`/`MEDIUM_THRESHOLD` constants as the rules-based model — so the ML label and ML score can never visually contradict each other, and the two models' scores are on a directly comparable scale.
- **API contract change (additive, explicitly flagged per standing instructions):** `POST /api/risk-check` and `GET /api/regions` both gained `ml_risk_level` and `ml_risk_score`. No existing field renamed, removed, or retyped. Updated `docs/api-contract.md` (both endpoints' example responses and field tables) and `docs/mock-data.json` (all 9 regions plus the risk-check example) with the exact live values, verified byte-for-byte via a script diffing live API output against `mock-data.json` (zero drift, timestamp excluded).
- Added a "Two risk scores, on purpose" section to `docs/architecture.md` explaining why both models are kept, what the ML model actually is, and the documented path to training on real data. Lightly corrected adjacent stale claims in that file (risk model/translations were still marked "Not implemented yet" from the very first skeleton session) since leaving them would have directly contradicted the new section.
- Updated `README.md` (pitch paragraph, status section, tech stack, Future Improvements) and `backend/README.md` (full rewrite — was still describing the stubbed-skeleton state) to reflect the dual-model reality.

### In Progress / Partially Done
- Nothing left half-finished from this session's scope.

### Not Yet Started
- Training on real historical data (see Findings below for what that would require).
- Frontend display of the second score — explicitly not this session's job; `frontend-web/` was not touched.
- Everything else already listed as Not Yet Started in prior entries.

### Findings & Decisions
- **What a real-data upgrade would need:** a real historical dataset of (rainfall, river level, actual flood outcome) tuples — e.g. from NASA/ESA satellite archives or national meteorological services — to replace `generate_synthetic_training_data()`. Everything downstream (the `Pipeline` definition, the train/test split, the save-to-`.pkl` step, the inference wrapper, the API fields) needs no changes; only the data-loading function changes. This isolation was a deliberate design choice this session, not an accident.
- Chose to blend class probabilities into a severity-weighted score (rather than e.g. using `P(high)` alone) specifically so `ml_risk_score` sits on the same 0–1 scale and "feels like" `risk_score` for a side-by-side display — a UX/comparability decision, not a modeling requirement.
- Used a fixed random seed (42) for both the synthetic data generation and the train/test split, so retraining reproduces the same model unless the generation logic itself changes — important for demo stability (nobody wants the numbers to shift between now and Aug 29 just from re-running the training script).

### Flags for the Team
- **This is the one deliberate exception to "don't change the API contract without asking"** — the user's own instructions for this task explicitly pre-authorized and requested this additive change, and it's called out here and in `docs/api-contract.md` per those same instructions, not snuck in silently.
- **Frontend team:** two new fields are available (`ml_risk_level`, `ml_risk_score`) on both endpoints whenever you want to surface them — no rush, they're additive and nothing existing changed shape.
- **The ML model's wording/behavior hasn't been "reviewed" the way the translations were flagged as unreviewed** — it's a real trained model, not placeholder text, but it's still trained on synthetic (not real) data, which is the honest caveat to have ready if a judge asks "is this trained on real flood data?" — the answer is no, and that's documented, not hidden.
- If `backend/app/models/ml_risk_model.pkl` is ever deleted or `.gitignore`'d by accident, the server will fail to start (`ml_risk_model.py` loads it at import time with no fallback) — regenerate with `python -m app.models.train_ml_model` from `backend/`.

---

## 2026-08-10 — Documentation accuracy pass

### Completed
- **Leftover Yoruba reference removed** from `docs/frontend-feature-spec.md` (an example response had literally said `"local_language": "Yoruba"`, stale from before the team dropped Yoruba) and from the PDF's API-overview example (same issue). Confirmed via full-text extraction of the regenerated PDF and a grep of `docs/*.md` that no live-facing doc mentions Yoruba anymore. `docs/progress-log.md`'s own historical entries still mention Yoruba by name — that's correct and intentional (they're a dated record of what was true in earlier sessions, not live content) and were left unchanged.
- **"3-day hackathon" framing corrected.** The actual deadline is **2026-08-29**, not the ~3-day/Aug-12 window several earlier sessions assumed. Fixed in the PDF (4 occurrences — the "simulated" callout, the translations caveat, the tech-stack callout, and the closing note) and in `backend/app/models/translations.py`'s module docstring (was "the Aug 12 demo," now references the real 2026-08-29 deadline). Historical `docs/progress-log.md` entries that mention "Aug 12" were left as-is — they're an accurate record of what the team believed/decided at the time, not a live claim.
- **Confirmed Mogadishu, Somalia is genuinely in `backend/app/data/regions.json`** (read the file directly rather than trusting memory) — it is, bringing the total to 9 sample cities, matching every current doc that states "9." The only places that say "8 sample cities" are `docs/progress-log.md`'s historical entries from before Mogadishu was added, which is correct as a dated record — no live doc or code needed a fix here.
- **Team & Roles completed.** Added Mohamed Zaki (Embedded Systems / Robotics, confirmed with the team lead) and removed the `[ Name ] / [ Role ]` placeholder row, in `README.md`, `docs/pitch-notes.md`, and the PDF's Team & Roles table. Full team: Matthias (Backend/AI), Habiba/Farid/Thompson (Frontend web dashboard), Mohamed Zaki (Embedded Systems/Robotics).
- **Docs/code sync claim corrected.** The PDF's architecture section previously said syncing was "checked automatically" — it isn't; there's no test suite or CI check in this repo enforcing it. Reworded to say it's manually re-verified each session (which is what actually happened — see the 2026-08-10 "backend pass" entry below, where a one-off script was run by hand, not a standing automated check).
- Regenerated `docs/Africa-Shield-AI-Overview.pdf` from the corrected HTML source and verified via text extraction (not just visual spot-check) that none of the fixed strings reappear and the corrected ones (Mohamed Zaki, 2026-08-29, "manually re-verifying") are present on the expected pages. Page count unchanged (14).

### In Progress / Partially Done
- Nothing left half-finished from this session.

### Not Yet Started
- `docs/architecture.md` itself (the markdown file, not the PDF) is still written from the very first skeleton session and says things like "risk model... Not implemented yet" and frontend "starting tomorrow" — both long since overtaken by events. Noticed during this pass but **not fixed**, since it wasn't one of the 5 items asked for this session and a full rewrite is a bigger job than a targeted correction. Worth a dedicated pass.
- Everything else already listed as Not Yet Started in prior entries.

### Findings & Decisions
- Distinguished consistently between "historical record" (progress-log.md's dated entries — never rewritten, even when they mention since-corrected facts like Yoruba or Aug 12) and "live/current-state claims" (README, pitch-notes, architecture sections of the PDF, code comments — corrected when wrong). This distinction is what let this pass fix real inconsistencies without falsifying the team's actual history of decisions.
- The "checked automatically" claim was an overstatement of what actually happened in past sessions: a person (or this assistant) ran a one-off Python script via the terminal to diff live API output against `docs/mock-data.json`. That's more rigorous than eyeballing, but it is not a repeatable, automated mechanism (no test file, no CI config) — so it shouldn't be described as "automatic" without that caveat.

### Flags for the Team
- **If the Aug 29 deadline changes again, search before editing.** The stale "Aug 12" framing this session fixed came from an earlier, apparently superseded deadline. Live docs affected: `docs/Africa-Shield-AI-Overview.pdf` (regenerate from `docs/frontend-feature-spec.md`'s sibling HTML source — ask for it, it isn't committed) and `backend/app/models/translations.py`'s docstring.
- **`docs/architecture.md` is stale** (see Not Yet Started above) — don't cite it as current-state without checking against `docs/api-contract.md` and `docs/progress-log.md` first.
- **Team roster is now complete** in README/pitch-notes/PDF: Matthias, Habiba, Farid, Thompson, Mohamed Zaki. If anyone else joins or a role changes, update all three places (they're not generated from a single source).

---

## 2026-08-10 — Beginner-friendly project overview PDF

### Completed
- Wrote `docs/Africa-Shield-AI-Overview.pdf` (14 pages) — a beginner-friendly explainer of the whole project: what it is, the problem it solves, the workflow step by step, the risk-scoring formula worked through with a real example (Lagos, 0.82 → HIGH), the four-language translation mapping, simulated alert delivery, tech stack in plain language, system architecture, API overview, and the roadmap. Includes diagrams (workflow pipeline, risk-score bar chart, language-mapping diagram, roadmap timeline) rather than just text.
- Built from an HTML source (print-styled) and converted with headless Chrome (`--print-to-pdf`) — no paid tooling needed. Verified page count (14, matches the 12 content sections + cover + TOC, no overflow) and visually spot-checked rendering (emoji, SVG diagrams, RTL Arabic, tables) via screenshots before finalizing.
- Linked from the top-level `README.md`'s Docs section as the recommended starting point for anyone new to the project, including judges/reviewers.

### In Progress / Partially Done
- Nothing left half-finished from this session.

### Not Yet Started
- N/A — this was a standalone documentation task, not tied to open backend/frontend work.

### Findings & Decisions
- Used population/risk figures and translation examples already established in prior sessions (e.g. Lagos 0.82/HIGH, Cairo/Arabic example) rather than inventing new ones, so this document can't drift from the actual running system.
- Repeated the same honesty pattern as the rest of this project's docs: the PDF explicitly states what's simulated (SMS/USSD/WhatsApp sending), what's unreviewed (Swahili/Arabic/Somali translations), and what's roadmap vs. built today — rather than presenting the demo as more finished than it is.

### Flags for the Team
- This PDF is a good one to send to judges/reviewers ahead of the live demo, or to hand a new teammate on day one.
- The source HTML isn't committed to the repo (only the final PDF is, in `docs/`) — if the content needs updating later, ask for it to be regenerated rather than hand-editing the PDF.

---

## 2026-08-10 — "Make the demo superb" backend pass + frontend handoff spec

### Completed
- Discussed a prioritized feature list to strengthen the Aug 12 demo (map view, live risk simulator, "why this score" breakdown, phone-mockup alert screens, population/impact framing, low-bandwidth mode). Confirmed with the team lead that `frontend-web/` is still off-limits (no teammate commits there yet, but the boundary stands) — so this session did backend enrichment + a written spec instead of touching frontend code.
- `backend/app/models/risk_model.py`: added `risk_score_breakdown(rainfall_mm_24h, river_level_m) -> dict`, returning the raw inputs, their normalized values, the caps/thresholds used, and the resulting risk_level/risk_score — full explainability data for a "why this score" UI. Refactored the normalization math into a shared `_normalized_inputs()` helper used by both `compute_risk()` (unchanged signature/behavior) and the new function.
- `backend/app/data/regions.json`: added `population_estimate` to all 9 sample cities — rough, publicly-known city/metro population figures (e.g. Lagos 15,000,000, Kinshasa 15,000,000, Maputo 1,100,000). **Not a flood-exposure model** — see Flags below.
- `backend/app/routes/regions.py` and `risk.py`: both endpoints now include `risk_score_breakdown` in their response; `/api/regions` also includes `population_estimate` per region. Both are **additive fields only** — `location_name`/`latitude`/`longitude`/`risk_level`/`risk_score`/`alert_message_en`/`alert_message_local`/`local_language`/`timestamp` are all unchanged in name, type, and meaning.
- `docs/api-contract.md` and `docs/mock-data.json` updated to document and mirror the new fields exactly, including a top-of-file note flagging this as an additive/non-breaking contract change.
- Wrote `docs/frontend-feature-spec.md` — a full handoff doc for Habiba/Farid/Thompson covering all 6 features with concrete API request/response examples, a suggested priority order (map → live simulator → score breakdown → phone mockups → population framing → low-bandwidth toggle), and explicit caveats (population figures aren't a flood model; Arabic needs `dir="rtl"`; USSD has no rich UI).
- Verified end-to-end with a programmatic diff (not just eyeballing): started the server, pulled live `/api/regions` and `/api/risk-check` responses, and asserted they match `docs/mock-data.json` byte-for-byte (excluding the timestamp field) — confirmed zero drift for all 9 regions plus the Cairo/Arabic risk-check example.

### In Progress / Partially Done
- Nothing left half-finished from this session's backend scope. The 6 features themselves are specced, not built — that's explicitly frontend work per the team's decision this session.

### Not Yet Started
- All 6 frontend features described in `docs/frontend-feature-spec.md` (map, live simulator, score breakdown UI, phone mockups, population framing, low-bandwidth toggle) — backend is ready for all of them, none are built yet.
- Everything else already listed as Not Yet Started in prior entries (native-speaker translation review — no longer a hard blocker per the earlier team decision, but still open; real SMS/USSD gateway; ML model; pitch deck).

### Findings & Decisions
- **Chose to keep `population_estimate` as a general city-population figure rather than attempting a flood-exposure estimate.** Computing "population actually in a flood-prone zone" would need real GIS/elevation data this team doesn't have this week; a fabricated-looking subset number would be easier for a judge to poke a hole in than an honestly-labeled general population figure. Flagged prominently in both `api-contract.md` and `frontend-feature-spec.md` with suggested safe phrasing.
- **`risk_score_breakdown` duplicates `risk_level`/`risk_score` inside itself** (they also appear at the top level of the response). Deliberate — lets a UI component receive the breakdown object standalone (e.g. for a detail modal) without needing to also thread through the parent response's top-level fields.
- Confirmed via automated diff, not manual inspection, that there is no drift between `docs/mock-data.json` and the live API — this is a stronger check than previous sessions' manual `curl` comparisons and worth repeating this way going forward.

### Flags for the Team
- **API contract gained two new fields, non-breaking.** If anyone already started building against the old `/api/regions`/`/api/risk-check` shapes, nothing breaks — the new fields (`population_estimate`, `risk_score_breakdown`) are additive and can be adopted whenever convenient.
- **`population_estimate` is not a flood-risk number — it's the city's general population.** Do not present it in the pitch as "X people at risk of flooding." See the caveat and suggested phrasing in `docs/frontend-feature-spec.md` section 5. If a judge asks about it, the honest answer is "general population of the monitored area, not a flood-exposure model — that's on the roadmap."
- **All 6 features are specced in `docs/frontend-feature-spec.md` with a suggested priority order** (map view first, low-bandwidth toggle last) in case there isn't time for all six before Aug 12 — do the highest-impact ones first rather than going in this log's listed order.
- **Arabic RTL reminder repeated in the new spec doc** (section 4) — easy to miss until someone actually renders a Cairo/Mogadishu-adjacent-Arabic alert card.

---

## 2026-08-10 — Add Mogadishu, Somalia; ship AI-drafted translations as-is

### Completed
- Added `Mogadishu, Somalia` (lat 2.0469, lon 45.3182, rainfall 55mm/24h, river 2.6m) to `backend/app/data/regions.json` and the matching entry to `docs/mock-data.json`'s `regions` list — the sample set is now 9 cities, not 8. Computed risk: 0.6 / `medium`. Chosen to give an even 3-high/3-medium/3-low spread across all 9 sample cities (previously 3/2/3 with none in Somalia).
- Wrote real Somali wording in `backend/app/models/translations.py`'s `ALERT_TEMPLATES["Somali"]`, replacing the three `"TODO: awaiting reviewed Somali translation"` placeholders. Per team decision, kept the existing AI-written Swahili and Arabic strings as the working translations too — no longer blocking on a review pass before Aug 12 (softened the "MUST be replaced" comment in the module docstring to reflect this; the native-speaker-review recommendation stays, just not as a blocker).
- Updated region counts from "8" to "9" everywhere they were stated as current-state facts: `docs/api-contract.md`, and the sanity-check comments in `backend/app/models/risk_model.py` and `translations.py`. (Left "8" untouched in this log's own prior dated entries — those describe the past, not now.)
- Verified end-to-end: `GET /api/regions` now returns 9 entries including `{"location_name": "Mogadishu, Somalia", ..., "risk_level": "medium"}`; `POST /api/risk-check` for Mogadishu returns the real Somali sentence (`"Khatarta daadka ee Mogadishu waa DHEXDHEXAAD. La soco warbixinnaha maxaliga ah."`), not a TODO string, and it matches `docs/mock-data.json` exactly.

### In Progress / Partially Done
- Nothing left half-finished from this session's scope.

### Not Yet Started
- Native-speaker review of Swahili/Arabic/Somali wording — no longer a hard blocker for Aug 12 per today's team decision, but still worth doing if time allows.
- Frontend RTL handling for Arabic, real translation API, real SMS/USSD gateway, ML model, pitch deck — all still open from prior entries.

### Findings & Decisions
- **Team decision (2026-08-10): ship the AI-written Swahili/Arabic/Somali translations as the working set for the Aug 12 demo**, rather than waiting on a native-speaker review pass. This reverses the "MUST be replaced" framing from the previous entry — the review is now a nice-to-have, not a blocker.
- Mogadishu's rainfall/river inputs (55mm, 2.6m) were picked specifically to land in the `medium` bucket and even out the risk-level distribution across all 9 cities — not based on real Somali hydrological data.

### Flags for the Team
- **`/api/regions` now returns 9 entries, not 8** — anyone (frontend, pitch deck) who assumed a fixed count of 8 should double check that assumption.
- **Somali now has real (if unreviewed) wording**, not a visible TODO string — if you test a Somalia request and expect to still see a placeholder, that's been replaced.
- Swahili/Arabic wording is unchanged from the previous entry — still AI-written, just no longer flagged as blocking.

---

## 2026-08-10 — Finalize language mapping (English/Swahili/Arabic/Somali)

### Completed
- `backend/app/models/translations.py`: replaced `LOCAL_LANGUAGE_BY_COUNTRY` to map only to the team's four agreed languages. Final mapping: `kenya` → Swahili, `tanzania` → Swahili, `uganda` → Swahili, `egypt` → Arabic, `somalia` → Somali, `nigeria` → English, `ghana` → English, `mozambique` → English, `drc` → English. `DEFAULT_LOCAL_LANGUAGE` changed from `"Swahili"` to `"English"` for any country not explicitly listed.
- Removed Yoruba entirely from `translations.py` — no leftover mapping entries or template block. (It remains mentioned in this log's 2026-08-10 "real logic" entry below and the entry before that, since those are a historical record of what was true at the time and are not rewritten.)
- `ALERT_TEMPLATES` restructured: kept `"en"` (always used for `alert_message_en`), added an `"English"` alias pointing at the same template dict (needed because `local_language` can now be `"English"` itself, and the lookup would otherwise `KeyError`), kept the Swahili and Arabic draft templates as-is, added a `"Somali"` block with `"TODO: awaiting reviewed Somali translation"` placeholders for `high`/`medium`/`low` instead of any guessed wording.
- Added a prominent module-docstring flag: Swahili and Arabic strings are unreviewed AI-written drafts; Somali has no wording yet; both need the team's reviewed text before Aug 12.
- Added a module-docstring note that `alert_message_local` is right-to-left when `local_language` is `"Arabic"`, and that this module does nothing about RTL rendering — that's explicitly a frontend concern.
- `docs/mock-data.json` and `docs/api-contract.md`: replaced the `risk_check_example` (was Lagos/Nigeria/Yoruba) with Cairo/Egypt/Arabic, using the exact same Arabic string as `translations.py`'s `ALERT_TEMPLATES["Arabic"]["medium"]` formatted for Cairo — verified character-for-character identical, so there's no drift between the docs and the code. Updated the `local_language` field note in `api-contract.md` to list the four agreed languages and call out the RTL consideration.
- Verified end-to-end with the server running locally: tested one request per language path — Cairo/Egypt → Arabic (medium/0.42), Nairobi/Kenya → Swahili (low/0.20), Lagos/Nigeria → English (high/0.82, now matching `alert_message_en` since Nigeria has no dedicated local template), Mogadishu/Somalia → Somali (medium/0.50, returned the TODO placeholder string as expected, not invented wording), and an unmapped country → English (high/0.93, confirming the fallback change from Swahili to English). `/api/regions` response shape unchanged. Confirmed no remaining "Yoruba" references anywhere in `backend/` via a full-repo grep (the only hits are in this log's historical entries below, which is correct — they're a record of the past, not live code).

### In Progress / Partially Done
- Nothing left half-finished from this session's scope.

### Not Yet Started
- Reviewed Swahili and Arabic wording (still AI-written drafts as of this entry).
- Any Somali wording at all (currently just TODO placeholders).
- Frontend RTL handling for Arabic (`frontend-web/` not touched this session, per instructions).
- Everything else already listed as Not Yet Started in the entry below (real translation API, real SMS/USSD gateway, ML model, frontend dashboard, pitch deck, etc.).

### Findings & Decisions
- **Somalia is in the language mapping even though it's not one of the 8 sample cities in `backend/app/data/regions.json`.** Added because Somali is one of the four agreed languages and Somalia is the obvious country for it — flagging this as an addition beyond the 8 sample cities so it can be sanity-checked.
- **Nigeria, Ghana, Mozambique, and DRC are mapped explicitly to `"English"`** in the dictionary (rather than relying on `DEFAULT_LOCAL_LANGUAGE` for them) — this makes the mapping self-documenting and means adding a 9th agreed language later won't silently change what these four countries show.
- **The `"English"` alias in `ALERT_TEMPLATES` is a plumbing necessity, not a design choice** — `build_alert_messages` looks up `ALERT_TEMPLATES[local_language][risk_level]`, and once `"English"` became a possible value of `local_language` (not just `"en"`), that lookup needed a matching key or it would crash. `alert_message_local` and `alert_message_en` are therefore identical strings whenever `local_language == "English"`.

### Flags for the Team
- **Yoruba is fully removed.** The final four languages are English, Swahili, Arabic, and Somali — English is always the baseline, the other three are the local-language options depending on country.
- **Swahili and Arabic wording in `translations.py` is still an unreviewed AI-written draft.** Needs native/fluent-speaker review before Aug 12 — same flag as the previous entry, not yet resolved.
- **Somali has zero real wording yet** — three `"TODO: awaiting reviewed Somali translation"` placeholder strings sitting in `ALERT_TEMPLATES["Somali"]`. Whoever owns Somali translation needs to fill these in; until then, any Somalia-mapped request will visibly return the TODO string, not silently wrong text.
- **Arabic is right-to-left — this needs frontend handling.** The backend returns plain Arabic text with no directionality markup; the dashboard needs to render it RTL (e.g. `dir="rtl"`) when `local_language === "Arabic"`. Flagging explicitly for Habiba/Farid/Thompson since this is easy to miss until someone actually looks at a Cairo alert card.
- **Default fallback language changed from Swahili to English** for any country not in `LOCAL_LANGUAGE_BY_COUNTRY`. If a new sample city gets added later and its country isn't explicitly mapped, it'll now show English by default, not Swahili — worth knowing if that ever looks surprising in a demo.

---

## 2026-08-10 — Real flood risk scoring and translation logic

### Completed
- `backend/app/models/risk_model.py`: implemented `compute_risk(rainfall_mm_24h, river_level_m)` for real. Formula: `normalized_rainfall = min(rainfall_mm_24h / 100, 1.0)`, `normalized_river = min(river_level_m / 4.0, 1.0)`, `risk_score = round(0.5*normalized_rainfall + 0.5*normalized_river, 2)`. Buckets: `risk_score >= 0.7` → `high`, `>= 0.4` → `medium`, else `low`. Removed the `NotImplementedError` stub.
- `backend/app/models/translations.py`: implemented `build_alert_messages(location_name, risk_level)` for real. Hardcoded EN + one of {Yoruba, Swahili, Arabic} per alert, mapped by country parsed from `location_name` (`LOCAL_LANGUAGE_BY_COUNTRY` dict: Nigeria→Yoruba, Kenya/Tanzania/Uganda→Swahili, Egypt→Arabic; everything else falls back to `DEFAULT_LOCAL_LANGUAGE = "Swahili"`). Removed the `NotImplementedError` stub.
- `backend/app/routes/risk.py`: `POST /api/risk-check` now calls `compute_risk` + `build_alert_messages` on the actual request body instead of returning the fixed `docs/mock-data.json` example. Response shape unchanged.
- `backend/app/routes/regions.py`: `GET /api/regions` now loads `backend/app/data/regions.json` (8 sample cities) and computes each region's `risk_level` live via `compute_risk`, instead of returning the hardcoded `mock-data.json` list. Response shape unchanged.
- `backend/app/routes/alerts.py`: left as a stub returning `docs/mock-data.json["alerts"]`, with a comment making clear this is intentional (no real SMS/USSD gateway this week), not forgotten.
- Verified end-to-end with the server running locally (`uvicorn app.main:app`):
  - `GET /api/regions` → 3 high (Lagos 0.82, Kampala 0.89, Dar es Salaam 0.70), 2 medium (Cairo 0.42, Accra 0.61), 3 low (Nairobi 0.20, Maputo 0.20, Kinshasa 0.31) — a varied, non-degenerate spread, computed live rather than hardcoded.
  - `POST /api/risk-check` tested with Lagos (85mm/3.2m → high/0.82, Yoruba), Nairobi (12mm/1.1m → low/0.20, Swahili), Cairo (35mm/2.0m → medium/0.42, Arabic), and an unmapped country (90mm/3.8m → high/0.93, fell back to Swahili as expected).
  - Confirmed JSON field names/structure for all three endpoints still match `docs/api-contract.md` exactly — no renames, no shape changes.
- Updated `docs/api-contract.md` status notes (top of file + per-endpoint) to say scoring/translation are real; `/api/alerts` still marked stubbed-on-purpose.
- Updated top-level `README.md` status section to reflect real backend logic.

### In Progress / Partially Done
- Nothing left half-finished from today's scope — all three files planned for this session are complete and verified.

### Not Yet Started
- Real translation API integration (still hardcoded dictionary, per this week's scope — documented future improvement).
- Real SMS/USSD/WhatsApp gateway (`/api/alerts` stays simulated this week).
- ML-based risk model (this week stays rules-based, per team decision).
- Frontend dashboard build-out (Habiba/Farid/Thompson, in progress separately in `frontend-web/` — not touched this session).
- Native-speaker review of the Yoruba/Swahili/Arabic translation text (see Flags below).
- Pitch deck.

### Findings & Decisions
- **Thresholds chosen:** 50/50 weight between rainfall and river level; rainfall normalized against a 100mm/24h cap, river level against a 4m cap; high ≥0.7, medium ≥0.4. Chosen because they produce a believable, varied spread across the 8 sample cities without any single bucket dominating (see Completed section for the actual scores) — not derived from real hydrological data, just tuned to look sane for the demo.
- **Language mapping is per-country, not per-region**, and only covers 5 countries explicitly (Nigeria, Kenya, Egypt, Tanzania, Uganda); every other country (Ghana, Mozambique, DRC, and anything else) silently falls back to Swahili. This is a coarse hackathon shortcut, not a real localization strategy.
- **`docs/mock-data.json`'s hand-picked risk levels from the skeleton session already matched what the real formula produces** for all 8 sample cities — no drift, nothing to reconcile.
- The `RiskCheckRequest` pydantic model still accepts any `location_name` string; if it has no comma (no ", Country" suffix), `_country_from_location` returns `""`, which also falls back to the Swahili default.

### Flags for the Team
- **Translations are unverified.** The Yoruba, Swahili, and Arabic strings in `backend/app/models/translations.py` were written by an AI assistant and have not been checked by a native/fluent speaker. Get someone to review wording before the August 12 presentation — a wrong flood warning is worse than none. Flagged again as a code comment in that file.
- **Risk thresholds are demo-tuned, not scientifically derived.** If real rainfall/river-level data (or judge feedback) suggests the buckets feel wrong, they're isolated in `risk_model.py`'s `RAINFALL_CAP_MM`, `RIVER_LEVEL_CAP_M`, `HIGH_THRESHOLD`, `MEDIUM_THRESHOLD` constants — easy to retune without touching routes.
- **API contract did not change** — `/api/regions` and `/api/risk-check` responses have the same fields/types as the stub version. Frontend work against `docs/mock-data.json` should not break when pointed at the real backend.
- **`/api/alerts` is still fake on purpose** — don't be surprised it doesn't reflect real risk-check calls; it's a fixed list for the demo's "alert history" view.

---

## 2026-08-09 — Initial project skeleton

_(Retroactive summary — this predates the progress-log file itself.)_

### Completed
- Repo structure created: `backend/` (FastAPI), `frontend-web/` (Vite+React), `docs/`.
- Backend skeleton: FastAPI app with CORS, 3 endpoints (`/api/risk-check`, `/api/regions`, `/api/alerts`) stubbed to return hardcoded data from `docs/mock-data.json` rather than computing anything.
- `backend/app/data/regions.json` created with sample rainfall/river-level readings for 8 real African cities (Lagos, Nairobi, Cairo, Accra, Kampala, Maputo, Dar es Salaam, Kinshasa), ready for real scoring logic to be built against.
- `backend/app/models/risk_model.py` and `translations.py` scaffolded as `NotImplementedError` stubs with `# TODO` comments marking where real logic goes.
- `frontend-web/`: genuine unmodified `npm create vite@latest -- --template react` output — no dashboard components, routing, or styling added.
- `docs/api-contract.md` written documenting exact request/response shapes for all 3 endpoints.
- `docs/mock-data.json` written as the single source of truth for stub responses (backend routes read directly from this file, so docs and running API can't drift).
- `docs/architecture.md` (pieces-diagram + future roadmap) and `docs/pitch-notes.md` (narrative placeholder) written.
- Top-level `README.md` and `.gitignore` written.
- Verified backend ran locally and all 3 endpoints returned valid JSON matching the docs; verified frontend ran locally showing the default Vite+React page.
- Git repo initialized, initial commit made, pushed to new public GitHub repo `https://github.com/Matthias-Ab/africa-shield-ai`.

### In Progress / Partially Done
- Nothing — skeleton session was scoped to structure only, and that scope was fully completed.

### Not Yet Started
- Real risk scoring logic (started next session, see 2026-08-10 entry above).
- Real translation logic (started next session, see 2026-08-10 entry above).
- Frontend dashboard UI (starts today, 2026-08-10, with Habiba/Farid/Thompson).
- Real SMS/USSD gateway, real ML model, multi-hazard expansion, mobile app, community reporting, IoT sensors, auth, analytics dashboard — all documented as Future Improvements in `README.md` / `docs/architecture.md`, none started.

### Findings & Decisions
- Chose FastAPI for automatic interactive docs (`/docs`) and fast setup.
- Chose to have stub routes read from `docs/mock-data.json` directly (rather than duplicating hardcoded JSON in Python) specifically to make doc/code drift structurally impossible.
- Had to loosen `backend/requirements.txt` version pins from exact (`==`) to minimum (`>=`) because the pinned `pydantic==2.9.2` has no prebuilt wheel for Python 3.14 (the machine's installed version) and failed to compile from source.

### Flags for the Team
- Frontend devs: `frontend-web/` was a deliberately bare scaffold — no assumptions were baked in about routing, state management, or styling. Build it however makes sense to you.
- Everyone: the region risk levels and alert history in `docs/mock-data.json` were hand-picked placeholders as of this entry — see the 2026-08-10 entry above confirming they now match the real computed values, so no update was needed there.
