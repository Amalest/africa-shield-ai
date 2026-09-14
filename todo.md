# To-Do — Africa Shield AI

Living checklist of everything still open, consolidated from
`docs/progress-log.md`'s "Not Yet Started"/"Flags for the Team" sections
across all sessions so it's tracked in one place. Update this file
directly as items get done — `progress-log.md` stays the historical
record of *when*/*why* something happened; this file just tracks *what's
left*, right now.

**Real deadline: Regional Hackathon & Demo Days, 2026-09-17 to
2026-09-19** — only 5 of 12 teams advance. Aug 29 is just the end of
Innovation Labs, not the finish line (see `docs/progress-log.md`'s
2026-08-17 entry).

Priorities below are ordered by the jury scorecard's actual point
weights (`AI_for_All_Hackathon_Jury_Evaluation_Scorecard.docx`):
Social Impact & Inclusion 20, Functionality & Prototype 20, Problem & DRR
Relevance 15, Innovation & Creativity 15, Feasibility & Scalability 10,
Appropriate Use of AI/Tech 10, Sustainability & Resource Efficiency 5,
Presentation & Pitch 5.

## Critical — must happen before the demo

- [x] **Sandbox Africa's Talking account already set up** (real
      `AT_USERNAME`/`AT_API_KEY` in local `.env`) — `POST
      /api/subscribers/verify/request` confirmed the API call succeeds.
      **But deep research on 2026-09-09 found sandbox mode NEVER
      delivers to a real phone, for SMS, Voice, or USSD, under any
      circumstances** (confirmed directly from Africa's Talking's own
      help center — sandbox traffic always routes to their internal
      simulator only). An earlier claim in this project that "sandbox
      works for real sending" was wrong and has been corrected — see
      `docs/progress-log.md`'s 2026-09-09 entry.
- [ ] **Create a Live app (not sandbox) and add ~$25 of real prepaid
      credit** — the only way a real SMS/voice alert actually reaches a
      phone. Not a subscription; billed per message (~$0.01–0.03/SMS),
      so $25 covers 100+ real demo sends. See
      `docs/AfriShield-Hardware-Cost-Breakdown.pdf`'s "Service Cost"
      section. **Do this well before the 17th** — exact Live-app
      verification/approval timelines aren't documented, so there's
      unknown lead time risk if left to the last minute.
- [ ] **Send a real test SMS** to a team member's own phone via
      `POST /api/alerts/send`, once on a Live app — as of 2026-09-09
      this always sends both SMS and voice together (no more `channel`
      choice), so this single test also covers the next item.
- [ ] **Place a real test voice call** — now happens automatically as
      part of the same `POST /api/alerts/send` call above, once on Live.
- [ ] **USSD: plan to demo via Africa's Talking's own web simulator**
      (simulator.africastalking.com), not a real phone — going live with
      USSD needs an actual shortcode application, a bigger/slower step
      than SMS/voice. Only pursue a real USSD channel if there's
      confirmed approval time before the 17th.
- [ ] **Test USSD against Africa's Talking's real sandbox simulator** —
      needs a public URL pointed at `/api/ussd`, and a sandbox USSD
      channel configured to call it. Only tested locally via raw
      form-encoded requests so far. **Use `cloudflared tunnel --url
      http://localhost:8000` for the tunnel, not `ngrok`** — found
      2026-08-29 that ngrok's free tier force-redirects plain `http://`
      to `https://`, which broke the Wokwi sketch (see below);
      `cloudflared`'s quick tunnels (no account needed) serve `https://`
      cleanly with no redirect, verified with `curl`.
- [ ] **Verify Africa's Talking's voice `<Say>` handles non-English text**
      (Arabic/Swahili/Somali/Amharic) acceptably — still genuinely
      untested as of 2026-09-09; research confirmed `<Say>` uses Google
      Cloud TTS underneath, but couldn't get a reliable answer on
      whether Swahili/Somali/Amharic voices actually exist there. **For
      the presentation itself, decided to demo in French** — it's a
      well-established Google TTS language (near-zero voice risk),
      Latin-script (safe for USSD's known Arabic-encoding blank-screen
      issue too), and still tells a real localization story (matches
      Kinshasa/DRC, one of the 10 sample cities, and Côte d'Ivoire, one
      of Africa's Talking's actual live-covered countries). Swahili was
      considered too (ties to 3 of AT's live countries directly) but
      rejected for the live demo specifically due to this same unverified
      voice-support risk — worth testing separately, just not gambling
      on it in front of judges.
- [ ] **Run the Wokwi ESP32 simulation against a real, locally running
      backend — backend side fully proven 2026-08-29, one step left.**
      `hardware/wokwi-flood-sensor/sketch.ino` now uses
      `WiFiClientSecure` to speak real HTTPS (was plain HTTP, which
      never worked through any tunnel). Verified end-to-end with `curl`
      against a live `cloudflared` tunnel standing in for the device:
      low reading → `low`, high reading → `high` AND correctly
      auto-triggered a real (simulated) SMS alert, logged with
      `"trigger": "automatic"` — the exact backend path Wokwi would
      exercise. **The one thing not yet confirmed: whether Wokwi's
      simulated ESP32 actually completes a TLS handshake to an external
      `https://` host** — open [wokwi.com](https://wokwi.com/), paste in
      this folder's `sketch.ino` + `diagram.json`, click Run. If the
      Serial Monitor shows a real backend response, this is fully done;
      if it shows a TLS/connection error, that's a genuine Wokwi
      limitation to work around, not a backend problem. See that
      folder's README for full detail.

## Social Impact & Inclusion (20 pts) — currently the weakest-covered criterion

- [x] Voice alerts for people a text channel doesn't reach (can't read,
      local script, or visually impaired) — built 2026-08-17.
- [x] **Voice made additive, not opt-in, 2026-09-09.** Voice used to only
      go out if an admin picked `"channel": "voice"` on a given send —
      meaning the accessibility benefit depended on someone else
      remembering to choose it, not on the recipient's actual need. Now
      every `POST /api/alerts/send` sends both SMS and voice to every
      subscriber, always (same additive pattern push already used). See
      `docs/progress-log.md`'s 2026-09-09 entry.
- [x] **Women and children — the two named groups nothing had been
      deliberately designed for — addressed 2026-08-20.** High-risk
      alerts (all 7 languages) now include a safety-priority line naming
      children, elderly people, and pregnant/nursing individuals during
      evacuation — standard humanitarian guidance (the IFRC/UNICEF
      category), not a new personal-data field. See
      `backend/app/models/translations.py`.
- [ ] **Native-speaker review of the new safety-priority clause, in all
      7 languages — including Swahili, Arabic, and Somali**, whose
      *original* wording was already reviewed. That review didn't cover
      this new clause; treat it as unreviewed everywhere until checked.

## Functionality & Prototype (20 pts)

- [ ] Everything above under "Critical" — a demo that only shows
      "(simulated)" labels undercuts this criterion directly.
- [x] **Admin Command Center backend API built (2026-09-07), at Habiba's
      request.** Admin signup/login/me (bcrypt + JWT), incident
      management (status workflow + evidence verification, additive
      fields on `hazard_reports.json`), AI-explainable priority/triage
      scoring, assistance assignment, multi-channel response dispatch
      (sms/voice real via Africa's Talking, radio/community_leader always
      simulated — no such integration exists), response history,
      dashboard stats, and an incident map. Verified end-to-end via curl.
      See `docs/api-contract.md`'s "Admin Command Center API" section and
      `docs/progress-log.md`'s 2026-09-07 entry. **Not done yet: the
      frontend dashboard isn't wired to any of it** — that's the next
      step, on Habiba's side.
- [x] **Security audit + fixes (2026-09-07, later same day): 5 high +
      3 medium severity gaps found and closed.** Admin signup previously
      had no gate (fixed: shared `ADMIN_SIGNUP_CODE` required);
      `ADMIN_JWT_SECRET` had a fixed, public fallback (fixed: real random
      secret per process start + token revocation/logout); sensor
      ingestion had no auth (fixed: per-device `device_key`); subscribing
      *and unsubscribing* a phone number had zero ownership check (fixed:
      one-time SMS verification code, `POST /api/subscribers/verify/request`);
      the USSD webhook trusted any caller (fixed: optional HTTP Basic
      Auth). Plus: the admin response endpoint could message arbitrary
      numbers (fixed: real subscribers only), photo uploads trusted a
      spoofable `Content-Type` header (fixed: real magic-byte check), and
      CORS is now restrictable (`CORS_ALLOWED_ORIGINS`). Mobile app's SMS
      toggle updated to match the new verification flow. All verified via
      curl + `flutter analyze`/`test`. See `docs/progress-log.md`'s
      2026-09-07 (later) entry for full detail. **Not done:** rate
      limiting on login/signup/verify-code (deliberately out of scope);
      `ADMIN_SIGNUP_CODE`/`USSD_WEBHOOK_USERNAME`/`PASSWORD`/
      `CORS_ALLOWED_ORIGINS` still need setting in the actual demo
      deployment's `.env`, not just this machine's local one; no live
      mobile device click-through of the new code-entry dialog.
- [ ] Frontend cleanup (left to the frontend team, doesn't block the demo
      but worth doing before judging):
  - [ ] Move the hardcoded `http://localhost:8000` API URL (duplicated in
        `RegionTable.jsx`, `RiskMap.jsx`, `RiskOverview.jsx`,
        `RiskDistribution.jsx`) into one config value.
  - [ ] Delete unused `frontend-web/src/data/mockData.js`.
  - [ ] Fix the stray `py-` Tailwind class typo in `Dashboard.jsx`.
  - [ ] De-duplicate the repeated fetch/loading/error boilerplate into one
        shared hook.
  - [ ] Label `RecentAlerts.jsx`'s data as simulated in the UI, or wire it
        to the now-real `GET /api/alerts`.
  - [ ] Wire `Reports.jsx`'s submit handler to the now-real `POST
        /api/hazard-reports` (backend built 2026-08-28, see
        `docs/api-contract.md`) — the page itself is real (fetches
        `GET /api/regions` for context) but its own code comment says
        "A community-report POST endpoint is not currently available,"
        and `handleSubmit` just sets local `submitted` state without
        persisting anywhere. That backend endpoint exists now.
  - [x] **All 8 dashboard pages are real — resolved 2026-08-29 by
        merging Habiba's `origin/habiba-dashboard-expansion` branch,
        which had been sitting unmerged since 2026-08-16/23.** The
        2026-08-28 finding that 6 of 8 pages were empty placeholders was
        accurate for what was on `master` at the time, but Habiba had
        already built out `Alerts.jsx`, `Analytics.jsx`,
        `HelpSupport.jsx`, `LiveFloodMap.jsx`, `Regions.jsx`, and
        `Settings.jsx` (plus expanded `Reports.jsx`,
        `RecentAlerts.jsx`, `RegionDetails.jsx`, `RegionTable.jsx`, and
        `RiskMap.jsx`) on a branch that never got integrated. Verified
        after merging: `npm run build` succeeds, `npm run lint` shows
        only pre-existing unused-variable warnings (no errors), and
        Alerts/Analytics/Regions/LiveFloodMap all genuinely fetch live
        data (`fetch()`/`useEffect`) rather than just looking real.

## Innovation & Creativity (15 pts) / Appropriate Use of AI & Tech (10 pts)

- [x] IoT sensor ingestion (`POST /api/sensor-reading` + a Wokwi ESP32
      simulation with rain/water-level sensors) — built 2026-08-17,
      directly targets the scorecard's explicit "IoT & Sensors"
      sub-criterion. No real hardware yet — see Critical above for the
      Wokwi-against-real-backend test still needed.
- [x] **Investigated real training data (2026-08-17: GDACS — not
      feasible; 2026-08-29: Dartmouth Flood Observatory (DFO) — real
      validation achieved, still not a full retrain).** EM-DAT
      (registration-gated), ICPAC (categorical, no raw-data API), NASA
      EONET (effectively empty for Africa), GDACS (real events but 7 of
      9 cities got zero, and its river-flood events partly auto-derive
      from the same GloFAS discharge used as a feature — real leakage)
      all ruled out on 2026-08-17. **2026-08-29: DFO gave 49 real, dated
      flood events across all 10 cities (1985–2010), independent of
      GloFAS — see `backend/app/data/dfo_flood_events.json` and
      `backend/app/models/fetch_real_training_data_dfo.py`.** Still
      blocked from a full production retrain by the same fundamental
      issue as before — GloFAS gives river *discharge* (m³/s), not the
      model's *level* (meters), and the live sensor-reading endpoint has
      no 26-year history to compute a percentile from anyway. Used
      instead for genuine validation
      (`backend/app/models/validate_against_dfo.py`): **real result —
      the rules-based model catches 41% of real historical flood days
      (22% false-positive rate), the trained ML model catches 28% (13.7%
      false-positive rate)**, against 239 real DFO-confirmed flood-days.
      Now cited in `docs/pitch-notes.md`'s "Real-data validation"
      section. See `docs/progress-log.md`'s 2026-08-17 and 2026-08-29
      entries for both investigations in full. **Next step for anyone
      continuing this:** find a second, more recent (post-2010) real
      flood-label source to layer on top — DFO's own archive stops
      there.
- [x] **The "not a full retrain" blocker above turned out to be
      solvable, 2026-09-09** — then the first attempt's numbers turned
      out to have a leakage bug, caught and fixed the same day. The
      discharge-percentile approximation `validate_against_dfo.py`
      already used for evaluation works just as well as a training
      feature (`app/models/train_ml_model_real.py`), but the initial
      random row-level train/test split let days from the same
      multi-day flood event land on both sides (19 of 29 events, 65%,
      confirmed affected) — inflating the first "81.2% recall" claim.
      Fixed with leave-one-event-out cross-validation across all 29 real
      events (`app/models/evaluate_ml_loeo.py`): the trustworthy, pooled
      result is **threshold 0.80: 52.7% recall / 17.95% false-positive
      rate — still genuinely better than rules-based's 41.0% recall /
      22.05% FPR on both axes**, just a smaller margin than first
      thought. See `docs/progress-log.md`'s 2026-09-09 correction entry.
- [x] **Attempted to wire the real-data model into production,
      2026-09-09 — reverted after finding it's not safe to ship.**
      Retrained on 100% of real data and swapped it into
      `ml_risk_model.py`, then sanity-checked it against the actual demo
      `regions.json` cities before calling it done: it predicted "low"
      for **all 10 demo cities**, including Lagos and Kampala, which the
      rules-based model correctly flags "high". Cause: the model's
      real-world-calibrated discharge percentile treats "elevated" as far
      more extreme than the hand-picked demo river-level values, which
      were tuned to look sane against the rules-based 50/50 formula, not
      against this model's learned distribution — a genuine calibration
      mismatch, not a code bug. **Reverted** `ml_risk_model.py`/
      `ml_risk_model.pkl`/`train_ml_model.py` to the original
      synthetic-trained model via `git checkout`; production is
      unaffected. See `docs/progress-log.md`'s 2026-09-09 correction
      entry for the full story.
- [ ] **Open, unsolved: reconcile the real-data model with the demo's
      region values before attempting to deploy it again.** Either
      recalibrate `regions.json`'s sample rainfall/river-level numbers to
      be consistent with real discharge percentiles per city, or find
      another way to bridge the two scales. Until then, production stays
      on the original synthetic-trained model — do not re-attempt the
      swap without solving this first.
- [x] **Native-speaker review of Swahili, Arabic, and Somali alert
      wording — all 3 confirmed correct (2026-08-17).** Also added
      city-name localization per the reviewers' feedback (e.g. "Cairo" →
      "القاهرة", "Mogadishu" → "Muqdisho") — see `LOCALIZED_CITY_NAMES`
      in `backend/app/models/translations.py`.
- [x] **Added French as a 5th language (2026-08-17)** to reach more
      Francophone African countries — DRC corrected from an English
      fallback to French (its actual official language; Kinshasa is a
      live sample city), plus 15 more Francophone countries mapped ahead
      of having a sample city there yet (same pattern used for Somalia
      before Mogadishu was added). Deliberately excluded
      Congo-Brazzaville — too easily confused with DRC by country name.
- [ ] **Native-speaker review of the new French alert wording** —
      unreviewed AI draft, same status Arabic/Swahili/Somali were in
      before this session. Whoever finds a French speaker next should
      use the same `docs/translation-review/` packet pattern.
- [x] **Fixed a real live bug: Maputo/Mozambique was defaulting to
      English (2026-08-17).** Portuguese is Mozambique's actual official
      language — corrected, same category of bug the DRC/French fix
      caught. Maputo is the team's most real-data-validated city (a real
      confirmed flood event from the Dec 2025-Jan 2026 investigation),
      so this was a priority fix, not a routine addition.
- [x] **Added Portuguese and Amharic (2026-08-17)**, completing
      alignment with the African Union's 6 official languages (Amharic
      substituted for Spanish per the organizer's guidance) — English,
      Arabic, French, Portuguese, Swahili, Amharic, plus Somali kept as
      a 7th from before that alignment. Portuguese also mapped to
      Angola, Guinea-Bissau, Cabo Verde, São Tomé and Príncipe, and
      Equatorial Guinea (explicit team call despite Spanish/French also
      being co-official there) ahead of having sample cities in them.
      Skipped as genuinely ambiguous: Djibouti (Arabic/French/Somali all
      plausible), Comoros (French/Arabic co-official), Eritrea (none of
      our 7 languages is actually its primary one — Tigrinya is).
- [x] **Added Addis Ababa, Ethiopia as a 10th sample city (2026-08-17).**
      Amharic is now exercised live by `GET /api/regions`, not just
      reachable via a manual `POST /api/risk-check` call — closes the gap
      flagged earlier the same day. Inputs (65mm rainfall, 2.6m river
      level) chosen to land in `medium` (score 0.65, ML model
      independently agrees at 0.66), keeping the 10-city distribution a
      reasonable 3 high / 4 medium / 3 low. Updated every doc/comment
      that said "9 sample cities."
- [ ] **Native-speaker review of Portuguese and Amharic alert wording**
      — both unreviewed AI drafts, same status French is in. **Amharic
      especially needs review** — it's the least confident draft of all
      7 languages (different script, linguistically furthest from the
      team's other languages) — see
      `docs/translation-review/amharic-review.txt`'s explicit warning.
      Portuguese packet: `docs/translation-review/portuguese-review.txt`.
- [ ] **Native-speaker review of the mobile app's UI-chrome translations
      (2026-08-28) — all 6 non-English `mobile-app/lib/l10n/*.arb` files,
      a separate item from the alert-wording reviews above.** Even
      Swahili/Arabic/Somali need this: their alert wording was reviewed
      2026-08-17, but that review never covered this different set of
      strings (buttons, labels, headings), so treat all 6 as unreviewed
      here regardless of that language's alert-text status.
- [x] **Automatic threshold-triggered alerts (2026-08-18).**
      `POST /api/sensor-reading` now auto-sends a real SMS the first time
      a device's region crosses into `high` risk, reusing the exact same
      send function `POST /api/alerts/send` uses. Fires once per
      transition (tracked in the new `region_alert_state.json`), not
      once per reading. Deliberately NOT wired into `POST /api/risk-check`
      — that endpoint also backs the judge/dashboard "what-if" slider
      demo, which must stay side-effect-free. `GET /api/alerts` entries
      now show `"trigger": "manual"` or `"automatic"`. Still only covers
      the sensor-reading path — a scheduled job re-scoring `regions.json`
      itself (for regions with no live sensor) is a separate, un-done
      next step.
- [ ] Real subscriber registration/outreach at scale, instead of a
      hand-seeded or USSD-only list.

## Feasibility & Scalability (10 pts) — not addressed in any doc yet

- [x] **Cost/scaling note written (2026-08-21)** — see the new "Cost &
      scalability" section in `docs/pitch-notes.md`: Africa's Talking SMS
      costs roughly $0.01–0.03/message, adding a region is a data-entry
      cost not an engineering one, and the new safety-priority line
      roughly doubles a "high" alert's segment cost worth flagging
      honestly rather than quoting one flat rate.

## Sustainability & Resource Efficiency (5 pts)

- [x] **Sustainability note written (2026-08-24)** — see the new
      "Sustainability & resource efficiency" section in
      `docs/pitch-notes.md`: lightweight JSON-file backend + FastAPI, no
      heavy infra, low compute footprint, data-entry-only maintenance,
      low-bandwidth channels by design.

## Presentation & Pitch (5 pts)

- [ ] Write the actual pitch deck — `docs/pitch-notes.md` is still a
      placeholder.
- [ ] Build an Innovation Canvas artifact (problem, AI solution,
      tech/data sources, partners, impact, risks, scalability) — implied
      as an expected deliverable by the organizers' ideation deck.

## Post-hackathon roadmap (not needed for the Sep demo)

- [ ] Expand beyond flooding to droughts, heatwaves, wildfires, cyclones,
      earthquakes.
- [ ] **Offline-first Flutter mobile app — Figma design implemented
      (2026-08-27); GPS + hazard-report photo, UI chrome translated into
      all 7 languages, real State/City geo data, push notifications, and
      real emergency-call numbers added (2026-08-28/29).** See
      `mobile-app/README.md`'s feature table for exactly what's real vs.
      UI-only. Full onboarding flow (language/country/location), 4-tab
      app (Home/Alert/Maps/Reports) all wired to the live backend, real
      OSM map, real text-to-speech "Read Aloud" accessibility feature,
      real offline cache, real `geolocator` GPS (onboarding + Reports
      tab), real photo attachment on hazard reports, real
      `AppLocalizations`-driven UI chrome switching live from Settings >
      Language, real State/City pickers (1,117 states/regions, 4,638
      cities from the open `dr5hn/countries-states-cities-database`, see
      `mobile-app/lib/data/geo_data.dart`) across all 54 countries, real
      Firebase Cloud Messaging push wiring (Settings > Alert Channels >
      "Mobile App"), a real "Call Emergency Line" button (cited
      per-country numbers for all 54 countries, see
      `mobile-app/lib/data/emergency_numbers.dart` — sourced from
      Wikipedia's emergency-numbers table; **the 10 currently monitored
      countries are cross-verified against gov.uk's travel advice too
      (2026-08-29), which caught 4 wrong numbers: Kenya, Egypt, Uganda,
      Mozambique** — the other 44 remain single-sourced), and localized
      `ApiException`/`LocationException` runtime error messages
      (2026-08-29 — each now carries an error-kind enum instead of a raw
      English string, resolved to a translated message at the UI layer).
      `flutter analyze` and `flutter test` both pass. Still needed:
      native-speaker review of
      the 6 non-English UI translations (see the translation-review
      section below). LGA stays free text — no equally reliable third
      administrative tier exists across all 54 countries in the dataset
      used.
- [x] ~~Create a real Firebase project and drop its config into
      `mobile-app/lib/firebase_options.dart` via `flutterfire configure`,
      plus a Web Push VAPID key and a backend service-account key~~
      **Done 2026-08-29** — real project `afrishield-ai-flood`: real
      client config for Android/iOS/Web (`flutterfire configure`,
      `google-services.json`, the Gradle plugin), a real Web Push VAPID
      key in `PushService._webVapidKey`, and a real service-account key
      (Firebase Admin SDK) at `backend/.env`'s
      `FIREBASE_SERVICE_ACCOUNT_JSON` — confirmed
      `push_gateway.is_configured()` returns `True` and the backend still
      imports/starts cleanly. See `docs/progress-log.md`'s 2026-08-29
      "Real Firebase project created" entry for the full
      account/permissions saga. **Still not done:**
      - [ ] Android/iOS token registration is wired up but untested on a
            real device/emulator (none available in this environment).
      - [ ] An actual push notification has never been triggered
            end-to-end and observed arriving on a device/browser — only
            the plumbing (`is_configured()`, imports, `flutter analyze`)
            has been verified, not a real delivered notification.
- [ ] Real translation API instead of the hardcoded dictionary; expand
      language coverage.
- [ ] **Community-reporting feature — backend + mobile app fully wired,
      including GPS and photo attachment (2026-08-28); web dashboard
      still not wired.** `POST /api/hazard-reports` / `GET
      /api/hazard-reports` / `POST .../{id}/photo` / `GET .../{id}/photo`
      all exist and are tested (see `docs/api-contract.md`). The mobile
      app's Reports tab submits category/description/location/GPS/photo
      for real, with honest partial-failure handling if the photo upload
      fails after the report itself sends. Still needed: wire the web
      dashboard's Reports page (still an empty placeholder) to `GET
      /api/hazard-reports` so reports are actually visible somewhere; no
      dispatch/routing for `needs_assistance: true` reports exists either
      — that field isn't even settable from the mobile UI yet, since the
      Figma design has no "I need help" toggle.
- [ ] Move from the Wokwi simulation to real ESP32 hardware with real
      rain/water-level sensors (backend ingestion already built).
- [ ] User authentication / role-based access for disaster-management
      authorities.
- [ ] Analytics/impact dashboard (alerts sent, regions covered, estimated
      impact).
