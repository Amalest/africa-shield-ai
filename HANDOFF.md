# Session Handoff — AfriShield AI

Rewritten 2026-09-08, replacing the 2026-08-28 version (that one is now
stale — a lot happened since). Read this first, then dig into the files
it points to as needed — this doc is the map, not the territory.

## Hard rules — do these regardless of what else you're asked

- **Never mention Claude, Anthropic, or any AI-assistant name in git
  commits, PR titles/descriptions, issues, or any other GitHub-visible
  content in this repo.** No `Co-Authored-By`, no mention in the commit
  body, nothing. Standing instruction from the repo owner (Matthias),
  given multiple times across sessions. Every commit so far complies —
  keep doing it without being asked again.
- This project has a strict **"never fake data" culture** that runs
  through every layer: risk scores, alert sends, translations, GPS,
  training data, auth, everything. When something isn't real yet, the
  pattern is always: build the real integration, make it degrade to a
  clearly labeled "simulated"/"unavailable" state when not configured,
  and say so honestly in the UI and in the docs — never silently
  fabricate a success. Follow this for anything new. See "Established
  patterns" below for the concrete shape this takes in code.
- **Only commit when explicitly asked.** This user is comfortable with
  large autonomous changes in one turn but wants to control when they
  land in git history.

## What this project is

AfriShield AI — a flood early-warning system built for the **AI for All
Hackathon**. Real deadline: **Regional Hackathon & Demo Days, 2026-09-17
to 2026-09-19** (only 5 of 12 teams advance). Five pieces:

- **`backend/`** — FastAPI service: rules-based + trained-ML flood risk
  scoring, multi-language alerts, real SMS/USSD/voice via Africa's
  Talking, IoT sensor ingestion, citizen hazard reporting, push
  notifications, and (new since the last handoff) an **authenticated
  Admin Command Center API** — incident management, AI-explainable
  triage, assistance dispatch, dashboard stats, an incident map.
  Lightweight JSON-file storage, no database.
- **`mobile-app/`** — Flutter citizen-facing app matching the team's
  Figma design, wired to the backend above, including real SMS
  subscribe/unsubscribe (with phone-verification, added this session).
- **`frontend-web/`** — React admin dashboard (Vite + Tailwind), an
  internal "Command Center" for disaster-management authorities, not a
  public/citizen-facing site (no login page exists — confirmed by
  reading `App.jsx`; the mobile app is the citizen channel). All 8 pages
  now have real content (Habiba's `habiba-dashboard-expansion` branch
  was merged into `master` on 2026-08-29 — see "What happened" below).
  **Not yet wired to the new Admin Command Center API at all** — that's
  the next concrete step, see "What's left."
- **`hardware/wokwi-flood-sensor/`** — a Wokwi (browser) ESP32 simulation
  standing in for real sensor hardware, which doesn't exist yet.

Team: Matthias (backend/AI — the account every session runs as),
Habiba/Farid/Thompson (frontend web dashboard), Mohamed Zaki (embedded
systems/robotics).

## Where to look for what

Don't duplicate these in your head — read them when you need the detail:

- **`todo.md`** — the live, current punch list, ordered by the jury
  scorecard's point weights. Single most useful file for "what's left."
  Keep it updated as you close things out.
- **`docs/progress-log.md`** — dated, factual history, newest entries at
  the top. Read the most recent few (2026-09-07 has two entries — read
  both, "later same day" is the security-fix one) for exactly what
  happened, including what was verified vs. not.
- **`docs/api-contract.md`** — authoritative backend API request/response
  shapes, with a dated "Status" changelog at the top. **Just got a
  significant rewrite** for the security fixes — several endpoints'
  request shapes changed (new required fields), not just additive.
- **`docs/AfriShield-Admin-API-Reference.pdf`** — a short, standalone PDF
  reference for the Admin Command Center API, built for sharing with
  Habiba directly (not everything from `api-contract.md`, just enough to
  start wiring the dashboard). **Written before the security fixes** —
  it still shows `POST /api/admin/signup` without `signup_code` and
  `POST /api/subscribers` without `code`. Regenerate it (the generator
  script isn't committed — see `docs/progress-log.md`'s 2026-09-07 entry
  for the reportlab-based approach used) or just point Habiba at
  `api-contract.md` for anything auth-related until it's refreshed.
- **`backend/README.md`**, **`mobile-app/README.md`** — setup +
  feature-by-feature "what's real vs. not" tables, kept accurate. Trust
  these over guessing from the code.
- **`docs/pitch-notes.md`** — hackathon pitch narrative. Cost/scalability
  and sustainability sections are done; talking points/demo flow still
  marked TODO. **New material to fold in, not yet done**: Africa's
  Talking's actual country coverage limitation (see "What's left").

## What happened since the last handoff (2026-08-28), in build order

Commit hashes below are on `origin/master` unless noted. Full detail for
each in `docs/progress-log.md`.

1. **Push notifications fully wired** (`a9b322e`, `8aa3b56`, `f10ba3d`,
   2026-08-29) — real Firebase project (`afrishield-ai-flood`) created,
   `flutterfire configure` run, a real Web Push VAPID key, and a real
   backend service-account credential. `push_gateway.is_configured()`
   confirmed `True`. **Still not done**: a push notification has never
   actually been observed arriving on a real device/browser — only the
   plumbing is verified, no Android/iOS emulator available in this
   environment.
2. **Localized runtime errors + cross-verified emergency numbers**
   (`0d4d859`, 2026-08-29) — `ApiException`/`LocationException` now carry
   an error-kind enum resolved to a translated message at the UI layer
   instead of a raw English string. Cross-checked the 10 monitored
   countries' emergency numbers against a second source (gov.uk), found
   and fixed 4 wrong ones (Kenya, Egypt, Uganda, Mozambique).
3. **Merged Habiba's frontend dashboard work** (`84cd4c9` merge +
   `aa295e8` doc update, 2026-08-29) — two commits that had been sitting
   unmerged on `origin/habiba-dashboard-expansion` since 2026-08-16,
   filling in real content for 6 pages that were empty placeholders on
   `master` at the time. **Important: Habiba has since pushed two more
   commits to that same branch (`bcb998e`, `15bbf7a`) — wiring
   `Reports.jsx` to the real `POST`/`GET /api/hazard-reports` endpoints —
   and these are still NOT merged into `master`.** Check
   `git log origin/master..origin/habiba-dashboard-expansion` before
   assuming the frontend's Reports page is still a local-only stub.
4. **Wokwi tunnel fix + real emergency numbers + real ML validation data**
   (`f559548`, 2026-08-29) — switched `sketch.ino` from `ngrok` to
   `cloudflared` (ngrok's free tier force-redirects http→https, which the
   sketch's `HTTPClient` doesn't follow); sourced real per-country
   emergency numbers for all 54 countries from Wikipedia; used the
   Dartmouth Flood Observatory to genuinely validate (not retrain) both
   risk models against 239 real flood-days — rules-based recall 41%, ML
   recall 28%, cited in `docs/pitch-notes.md`.
5. **Admin Command Center API built** (`a4cfd2c`, 2026-09-07) — Habiba
   asked for a specific endpoint list to connect the dashboard to a real
   backend. Built: admin signup/login/me (bcrypt + JWT), incident status
   workflow (New→Verifying→Prioritized→Assigned→Responding→Resolved)
   with evidence verification, an explainable rules-based AI priority/
   triage score (`app/models/priority_model.py` — same design philosophy
   as `risk_model.py`), assistance-request assignment, multi-channel
   response dispatch (sms/voice real, radio/community_leader always
   simulated), response history, dashboard stats, an incident map.
   Additive to `hazard_reports.json`; the citizen-facing hazard-report
   endpoints kept their exact existing behavior. A short PDF reference
   (see above) was generated with `reportlab` and shared with Habiba.
6. **Discovered and fixed a real, pre-existing broken-clone bug**
   (`b1ed187`, 2026-09-07) — Habiba pulled `master` and got
   `ImportError: cannot import name 'subscribers' from 'app.routes'`.
   Root cause: `backend/app/routes/subscribers.py` had been wired into
   `main.py` in an *earlier* session (before this one) but the file
   itself was never actually committed — only ever present locally on
   this machine. Reproduced the exact error in a clean `git worktree` of
   `origin/master` before fixing, to be certain. Fixed by committing the
   file (no behavior change — it's the same file that had been running
   locally all along).
7. **Full security audit + fixes** (`c641120`, 2026-09-07/08) — asked to
   audit the whole project (backend, mobile, the Wokwi hardware sim;
   frontend-web excluded both because it wasn't part of the ask and
   because it has no wired-up code to have a vulnerability in yet).
   Found and fixed 5 high-severity and 3 medium-severity real,
   exploitable gaps — see "Established patterns" below for the shape of
   each fix, and `docs/progress-log.md`'s 2026-09-07 "later same day"
   entry for full detail with the exact curl commands used to verify
   each one. **This same commit also finishes the mobile SMS-toggle
   integration** (`SubscriberService`, a phone-number field added to
   onboarding) that was sitting uncommitted locally when this session
   started — it had to be rebuilt against the new phone-verification
   requirement anyway, so both landed together.
8. **Twilio discussed as a possible supplement, not built** — a teammate
   asked how Africa's Talking works "all over Africa"; checked their
   actual coverage (help.africastalking.com) and found they have real
   local product presence in only 11 countries. **4 of this project's 10
   monitored cities are in countries outside that list**: Cairo (Egypt),
   Maputo (Mozambique), Kinshasa (DRC), Mogadishu (Somalia) — no amount
   of account setup makes real delivery to those possible through Africa's
   Talking. Confirmed Twilio does support SMS to all 4 via Alphanumeric
   Sender ID (checked Twilio's own per-country guidelines), but this was
   discussed, not implemented — flagged as a real limitation to fold into
   the pitch honestly, and a possible post-decision follow-up. **If asked
   to build this**: keep Africa's Talking for the 6 countries it covers,
   add Twilio only for the 4 gap countries via a second gateway module
   mirroring `sms_gateway.py`'s shape. Watch Egypt's ~3-week alpha-sender-
   ID pre-registration lead time against the Sep 17–19 deadline.

## Established patterns — follow these, don't reinvent

- **Gateway modules** (`backend/app/models/*_gateway.py`): every external
  service (Africa's Talking SMS/voice, Firebase push) gets
  `is_configured()` (checks env vars, no side effects) and a `send_*()`
  that raises if called while unconfigured. Callers check
  `is_configured()` first and fall back to a clearly labeled simulation.
  New optional env vars go in `backend/app/config.py` and are documented
  in `backend/.env.example` with setup instructions.
- **Two different "safe default" shapes for security-sensitive config —
  pick the right one:**
  - **Fail closed** when the unconfigured state would otherwise be
    actively dangerous: `ADMIN_SIGNUP_CODE` unset → signup disabled
    entirely (503), not silently open. A `device_key` mismatch → 401,
    never "allow it anyway."
  - **Fail open with a loud warning** when the unconfigured state matches
    an already-documented, harmless local workflow: `USSD_WEBHOOK_*`
    unset → the webhook stays open, matching the repo's own "tested
    locally via raw curl" instructions; `CORS_ALLOWED_ORIGINS` unset →
    `*`, since the dashboard's real deployed URL isn't fixed yet. Both
    print a `NOTE:`/`WARNING:` to stderr at startup so it's never a
    silent gap.
  - `ADMIN_JWT_SECRET` is a third shape specific to auth: it can't
    "simulate" (a token always needs a real secret to verify), so an
    unset value now generates a **real random secret per process start**
    instead of falling back to a fixed one — secure either way, the only
    cost is admin sessions not surviving a restart without a persistent
    value set.
- **One-time verification codes** (`app/routes/subscribers.py`'s
  `POST /api/subscribers/verify/request`): generate a 6-digit code,
  store it with a short expiry keyed by the phone number
  (gitignored runtime JSON, same pattern as everywhere else), consume
  it (delete, whether it matched or not) on the next `POST`/`DELETE`
  call. When the underlying send is unconfigured, **return the code
  directly in the response** rather than pretending one was sent — same
  "never fake success" rule as the SMS/push gateways, applied to a new
  shape of unconfigured state.
- **Admin auth** (`app/auth.py`): bcrypt password hashes, PyJWT (HS256,
  24h lifetime, a `jti` claim for revocation). Every admin-only route
  uses `Depends(get_current_admin)` — one place to change the auth rule.
  `POST /api/admin/logout` adds the token's `jti` to
  `app/data/revoked_jtis.json` (gitignored) so a logged-out token stops
  working immediately, not just after its natural expiry.
- **Explainable scoring, not opaque models**: `app/models/risk_model.py`
  (flood risk) and `app/models/priority_model.py` (incident triage) are
  both simple weighted sums with every factor's contribution shown in the
  response — a deliberate choice so judges/admins can see *why* a score
  is what it is. Follow this shape for any new scoring logic; don't
  reach for a black-box model where an explainable one already exists.
- **Data storage**: plain JSON files in `backend/app/data/`. Two
  categories, and `.gitignore` distinguishes them:
  - **Seed data** (committed): `regions.json`, `devices.json`,
    `subscribers.json`, `push_tokens.json` — hand-editable rosters.
  - **Runtime state** (gitignored): `alert_log.json`,
    `region_alert_state.json`, `hazard_reports.json`,
    `hazard_report_photos/`, `admins.json`, `revoked_jtis.json`,
    `pending_subscriber_verifications.json` — grows from live/test usage,
    never committed. `admins.json` in particular holds password hashes —
    treat it as sensitive even though it's "just seed-shaped" data.
- **Mobile honesty pattern**: every real-but-possibly-unconfigured
  feature shows an honest state rather than a silent no-op or fake
  success — see `PushService`, `LocationService`, `SubscriberService`.
  The SMS toggle's code-entry dialog follows the same rule: pre-filled
  when the backend hands back a code directly (unconfigured SMS),
  otherwise blank since a real code only exists in an actual text
  message.
- **Docs discipline**: every feature/fix touches the same set of docs —
  the relevant `README.md`, `docs/api-contract.md` (dated Status banner
  at the top if a request/response shape changed), `docs/progress-log.md`
  (a new dated entry), and `todo.md`. Keep doing all of them, not just
  the code. This session's security-fix entry in `progress-log.md` is a
  good template for how much detail is expected.
- **Verify before claiming done**: this user expects independent
  verification (curl, `flutter analyze`/`test`, re-reading the
  filesystem/git state) before being told something works — see
  "Environment gotchas" below for the specific mechanics that make this
  reliable in this environment.

## Environment gotchas learned the hard way

- **No Android SDK/emulator on this machine.** The only reliably
  testable mobile target is **Flutter web**
  (`flutter run -d chrome --web-port=5050`) or Windows desktop.
- **Starting the backend takes ~5-8 seconds** before it's actually
  listening. An immediate `curl` right after launching `uvicorn` often
  gets connection-refused even though the process started fine.
- **A backgrounded shell command does not survive into the next Bash
  tool call** in this environment — `(uvicorn ... &)` in one call, then
  `curl` in a separate call, gets "connection refused" even though the
  server logs look fine, because the background process was a child of
  a shell that already exited. Use the tool's actual `run_in_background:
  true` parameter (a real persistent background task with its own
  notification), or keep the background-launch and the immediate check
  in the *same* Bash call.
- **`curl -F "field=@/tmp/file"` fails silently (exit 26,
  `CURLE_READ_ERROR`) under Git Bash on Windows** when the path starts
  with `/tmp/` — MSYS path translation issue. Write the test file to the
  current working directory instead (`./file.ext`) and reference it with
  a relative path.
- **`backend/.env` now has a real Africa's Talking sandbox API key
  configured** (not a placeholder) — `is_sms_configured()` returns
  `True`, so testing anything that sends SMS makes a **real** call to
  Africa's Talking's sandbox. Use realistically-shaped fake numbers
  (e.g. `+15551234567`), not obviously-fake strings with letters — the
  `africastalking` SDK validates client-side and raises `ValueError` on
  a malformed number. This is now caught in
  `POST /api/subscribers/verify/request` (returns a clean 502), but
  **the same unhandled-exception risk still exists in
  `app/routes/alerts.py`'s `send_alert_for_region()`** (used by both
  `POST /api/alerts/send` and the sensor auto-trigger) — not yet fixed,
  low real-world likelihood since real subscriber numbers are unlikely
  to be malformed, but worth wrapping the same way if it ever bites.
- **`ADMIN_JWT_SECRET` is ephemeral-by-default now** — if `.env` doesn't
  set one, every admin session is invalidated on the next backend
  restart. This machine's local `.env` has a persistent value set (plus
  a persistent `ADMIN_SIGNUP_CODE`) so admin signup/login keep working
  across restarts here — **neither transfers to a new machine**, since
  `.env` is gitignored. See "Running it locally" below for how to
  generate fresh ones.
- **The Claude-in-Chrome browser extension is not reliably connected** —
  don't assume you can visually click through the UI; verify what you
  can independently (curl, `flutter analyze`/`test`) and say plainly
  what wasn't visually confirmed. No live browser click-through of the
  new SMS verification dialog has been done for exactly this reason.
- **A backgrounded `fork` subagent once fabricated a "done" report with
  zero actual tool calls.** Always verify a subagent's completion claim
  against the actual filesystem/git state before reporting it to the
  user, especially for large delegated work.

## Running it locally

```bash
# Backend
cd backend
python -m venv .venv   # if not already present
source .venv/Scripts/activate   # Git Bash on Windows
pip install -r requirements.txt   # bcrypt, pyjwt, email-validator added 2026-09-07
cp .env.example .env
# Generate real values for local testing (each is a one-liner):
python -c "import secrets; print(secrets.token_hex(32))"   # -> ADMIN_JWT_SECRET
python -c "import secrets; print(secrets.token_urlsafe(12))"   # -> ADMIN_SIGNUP_CODE
uvicorn app.main:app --reload
# -> http://localhost:8000, docs at /docs
```

Without `ADMIN_SIGNUP_CODE` set, `POST /api/admin/signup` returns 503 —
this is expected, not a bug, until you set one. Without
`AT_USERNAME`/`AT_API_KEY`, everything SMS/voice-related (including the
new `POST /api/subscribers/verify/request`) degrades to a clearly
labeled simulation, same as before. `backend/.env` is gitignored and
does not transfer between machines/clones — nothing in it is required
to run, but `ADMIN_SIGNUP_CODE` is required to actually sign up an admin.

```bash
# Mobile app (web target, since no Android SDK here)
cd mobile-app
flutter pub get
flutter create . --platforms=web   # only if web/ doesn't exist yet
flutter run -d chrome --dart-define=API_BASE_URL=http://127.0.0.1:8000 --web-port=5050
```

## What's left (see `todo.md` for the full, current, ordered list)

Highest-priority items, all still open as of this handoff:

- **Habiba's latest frontend work isn't merged.** Two commits on
  `origin/habiba-dashboard-expansion` (`bcb998e`, `15bbf7a`) wire
  `Reports.jsx` to the real hazard-reports API — check
  `git log origin/master..origin/habiba-dashboard-expansion` and merge
  if it's ready.
- **Frontend isn't wired to the Admin Command Center API at all yet** —
  Habiba has `docs/AfriShield-Admin-API-Reference.pdf` and
  `docs/api-contract.md`, but **the PDF predates the security fixes** —
  `signup_code` and the subscriber verification flow aren't in it.
  Regenerate it or point her at `api-contract.md` in the meantime.
- **Critical for a real demo**: still no real (non-sandbox) Africa's
  Talking account, no confirmed real push notification delivery, and
  the Wokwi ESP32 simulation has never actually been run in
  wokwi.com's UI against a live `cloudflared` tunnel (only proven via
  `curl` standing in for the device) — someone needs to open wokwi.com,
  paste in `sketch.ino` + `diagram.json`, and click Run.
- **Africa's Talking coverage gap**: 4 of 10 monitored cities (Egypt,
  Mozambique, DRC, Somalia) are in countries with no real Africa's
  Talking presence at all — a structural limitation, not a setup gap.
  Twilio was researched as a viable supplement (see "What happened"
  above) but not built. Worth deciding before the pitch, since it
  affects an honest claim about real coverage.
- **Security fixes still need real values in whatever the actual demo
  deployment uses** — `ADMIN_SIGNUP_CODE`, `USSD_WEBHOOK_USERNAME`/
  `PASSWORD`, `CORS_ALLOWED_ORIGINS` are only set in this machine's local
  `.env` right now, not in any shared/production environment.
- **No live device/browser click-through** of the new mobile SMS
  verification dialog — verified via `flutter analyze`/`test` and
  backend-side curl testing of the same calls, not an actual tap-through.
- **Rate limiting** on login/signup/verify-code-request doesn't exist
  anywhere — deliberately out of scope for the security-fix pass (which
  explicitly excluded DoS/rate-limiting concerns), but worth revisiting
  if there's time.
- **Native-speaker review** still outstanding: French/Portuguese/Amharic
  alert wording, the safety-priority clause in all 7 languages, all 6
  non-English mobile UI-chrome translations, and (new) the 6 non-English
  SMS-verification-dialog strings added this session.
- **Mobile**: 44 of 54 countries' emergency numbers remain single-sourced
  (only the 10 monitored countries were cross-verified), LGA still free
  text, reverse geocoding still not attempted (no Flutter-web-compatible
  plugin found).
- **Pitch materials for judges**: `docs/pitch-notes.md`'s talking
  points/demo-flow sections are still literally marked TODO, no
  Innovation Canvas exists yet, and the Africa's Talking coverage
  limitation above should be folded in honestly rather than surprise
  anyone during Q&A.

## A note on how this user likes to work

- Explicit, standing instruction: never Claude/Anthropic attribution in
  any GitHub-visible content (see "Hard rules" above).
- Only commits/pushes when explicitly asked — do the work and verify it,
  then ask, rather than assuming.
- Prefers being told directly what's real vs. simulated/unavailable — do
  not round up a partial success to a full one. Pushed back correctly
  when told (incorrectly, at first) that Africa's Talking works "all
  over Africa" — expects that same rigor applied without being asked.
- Comfortable with substantial autonomous work in one turn, but expects
  independent verification (tests, curl, re-reading the filesystem)
  before being told something works — not just an optimistic self-report.
- When asked to draft a message for a teammate (Slack/WhatsApp-style),
  wants it short and friendly, not a wall of technical detail — the
  detail belongs in the docs, the message should be a pointer to it.
- Asks for security/vulnerability reviews proactively and, once findings
  are presented, wants them actually fixed end-to-end (code + tests +
  docs), not just left as a list.
- Wants documentation kept current as a side effect of every feature
  change, not as a separate later pass.
