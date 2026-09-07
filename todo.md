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

- [ ] **Create a real Africa's Talking sandbox account** and fill in
      `backend/.env` (`AT_USERNAME`, `AT_API_KEY`, `AT_VOICE_NUMBER`,
      optionally `AT_SENDER_ID`). Free at
      https://account.africastalking.com/. Nothing has been sent for
      real yet — every alert so far says "(simulated)".
- [ ] **Send a real test SMS** to a team member's own phone via
      `POST /api/alerts/send` once credentials are set.
- [ ] **Place a real test voice call** to a team member's own phone via
      `POST /api/alerts/send` with `"channel": "voice"`.
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
      (Arabic/Swahili/Somali) acceptably — untested. If it doesn't, decide
      a fallback (e.g. speak English instead of `alert_message_local` for
      those regions) before the demo, not during it.
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
