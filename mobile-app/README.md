# AfriShield Mobile

Citizen-facing companion app to the SMS/USSD/voice alerts — see
`../docs/progress-log.md`'s 2026-08-27 entries for why it's scoped this way
and not as an admin tool. UI now implements the team's Figma design
("AfriShield AI App"); everything is wired to the real backend, nothing is
mocked.

## Screens (matching Figma)

**Onboarding:** Splash → Welcome → Language (9 languages) → Country (all 54)
→ Location Setup (Country, then real State/City pickers + a free-text LGA
field) → main app.

**Main app**, 4-tab bottom nav:
- **Home** — the citizen's chosen region's current risk, stats, mini map,
  quick links to Safety Guidance and the full alert.
- **Alert** — every monitored region as a colored card, filterable by
  risk (All/High/Medium/Low), tap through to full detail.
- **Maps** — real OpenStreetMap (`flutter_map`) with every region pinned,
  color-coded, tap a pin for its stats + "View Alert".
- **Reports** — community hazard reporting form (category, description,
  location, GPS, photo) — sent for real, see below.

Reached from Home's app bar (not a bottom tab, matching Figma): **Settings**
— Location, Alert Preference, Language, Alert Channels, Accessibility,
About.

## What's real vs. not, by feature

| Feature | Status |
|---|---|
| Region risk, alert text, map pins | **Real** — `GET /api/regions` |
| Alert filtering by risk level | **Real** — computed from the same data |
| SMS alert channel toggle | **Real channel** (backend sends via Africa's Talking); the toggle itself is just a local preference, doesn't yet call a backend "opt in" endpoint |
| "Mobile App" (push notification) channel | **Real** — Firebase Cloud Messaging, against a real project (`afrishield-ai-flood`, configured 2026-08-29 via `flutterfire configure` — see `lib/firebase_options.dart`), with a real Web Push VAPID key set too (`PushService._webVapidKey`). Toggling it on requests a device token and registers it with `POST /api/push-tokens`; toggling off calls `DELETE /api/push-tokens/{token}`. Android/iOS/Web should all be able to obtain a token now (untested on Android/iOS — no device/emulator in this environment). **The backend still needs its own service-account credential** in `backend/.env`'s `FIREBASE_SERVICE_ACCOUNT_JSON` before it can actually send anything — this file/key pair alone only lets the app receive |
| WhatsApp / USSD channels | **Not built.** Switches are disabled with an inline note explaining why — see `screens/settings/alert_channels_screen.dart` |
| Voice alerts (text-to-speech "Read Aloud") | **Real** — `flutter_tts`, on-device, no backend involved |
| Text size / high contrast | **Real** — applied app-wide via `AccessibilityProvider` + `MediaQuery` override in `app.dart` |
| Offline cache | **Real** — last-known regions/alerts persist via `SharedPreferences`, shown with an honest "showing saved data" banner |
| Hazard reporting ("Reports" tab) | **Real** — `POST /api/hazard-reports`. Category/description/location/GPS are sent for real and persisted server-side; a failed send shows a real error, not a fake success |
| Hazard report photo attachment | **Real** — `image_picker` (camera or gallery) + `POST /api/hazard-reports/{id}/photo`. If the report sends but the photo upload fails, the dialog says so honestly rather than claiming full success |
| "Use my current location" (GPS) | **Real** — `geolocator`, in both onboarding's Location Setup and the Reports tab. No reverse geocoding: onboarding shows the raw coordinates and still requires manual State/LGA/City entry; Reports attaches the raw coordinates to the report |
| Emergency call button | **Real** — `url_launcher` + real, cited per-country emergency numbers for all 54 countries (`lib/data/emergency_numbers.dart`, sourced from Wikipedia's "List of emergency telephone numbers"). **The 10 currently monitored countries are cross-verified against a second independent source** (UK gov.uk travel advice) — this caught and corrected 4 wrong numbers (Kenya, Egypt, Uganda, Mozambique). The other 44 are still single-sourced. Confirms with the user first, showing the exact number |
| Country/State/LGA/City pickers | **Real** for Country/State/City — 54 countries, 1,117 states/regions, 4,638 cities/towns from the open `dr5hn/countries-states-cities-database` (see `lib/data/geo_data.dart`). Picking a State opens a real searchable list of that country's actual regions; picking a City opens that state's actual cities. **LGA is still a plain text field** — no equally reliable third administrative tier exists across all 54 countries in that dataset |
| Yoruba / Hausa (2 of the 9 languages) | Selectable, tagged "alerts not translated yet" — the backend's `translations.py` only covers 7 of the 9 languages Figma lists. The app's own UI chrome (buttons/labels) also has no translation for these two, and falls back to English |
| UI chrome translation (buttons, labels, headings) | **Real for the 7 backend-supported languages** — `lib/l10n/*.arb` + generated `AppLocalizations`, switched live from the Settings > Language choice. **AI-drafted, unreviewed by a native speaker** — same caveat as the backend's own French/Portuguese/Amharic alert text (see `backend/README.md`), except here it applies to all 6 non-English languages, since this is a different set of strings than the alert wording and has never been reviewed even for Swahili/Arabic/Somali. This now includes runtime error messages (`ApiException`, `LocationException`) too — each carries an error-kind enum instead of a raw English string, so the UI resolves a translated message via `localizedMessage(l10n)` instead of showing `toString()`'s technical (always-English) detail |

## Structure

```
lib/
  main.dart, app.dart
  config/env.dart                      — API base URL, override via --dart-define
  theme/app_theme.dart                  — colors/type matching the Figma file
  data/countries.dart, languages.dart    — static reference lists
  data/geo_data.dart                     — real State/City data loader (assets/geo/)
  models/region.dart, alert.dart, hazard_report.dart
  services/api_service.dart, cache_service.dart, location_service.dart,
           push_service.dart
  firebase_options.dart                  — real Firebase config (afrishield-ai-flood) — see its doc comment
  l10n/app_en.arb, app_sw.arb, app_ar.arb, app_so.arb, app_fr.arb,
       app_pt.arb, app_am.arb  — UI chrome translations (see l10n.yaml)
  providers/
    region_provider.dart                 — live regions/alerts + cache fallback
    region_selection.dart                 — shared "which region is mine" resolver
    settings_provider.dart                — which backend region is "mine"
    onboarding_provider.dart               — language/country/location + completion flag
    accessibility_provider.dart             — text scale, voice alerts, high contrast
  screens/
    onboarding/  — splash, welcome, language, country, location_setup
    settings/    — alert_channels, accessibility, about
    home_screen.dart, alerts_screen.dart, alert_detail_screen.dart,
    risk_map_screen.dart, reports_screen.dart, safety_guidance_screen.dart,
    settings_screen.dart, root_shell.dart (4-tab pill nav)
  widgets/
    afrishield_logo.dart, alert_card.dart, risk_badge.dart,
    region_card.dart, offline_banner.dart
```

## Running it

```
cd mobile-app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000   # Android emulator -> host machine
```

Backend must be running (`cd ../backend && uvicorn app.main:app --reload`)
for real data; with nothing reachable and nothing cached yet, screens show
a real error state, not fake data.

`flutter analyze` and `flutter test` both pass clean.

## Known gaps worth tackling next

- **Firebase project is real now** (`afrishield-ai-flood`, configured
  2026-08-29 via `flutterfire configure`, plus a real Web Push VAPID key —
  see `lib/firebase_options.dart` and `PushService`'s doc comments). One
  setup step remains: a service-account key in `backend/.env`'s
  `FIREBASE_SERVICE_ACCOUNT_JSON` (Project Settings > Service Accounts >
  Firebase Admin SDK > Generate new private key) so the backend can
  actually send anything — until then, tokens register successfully but
  nothing gets pushed. Android/iOS token registration is also still
  untested (no device/emulator here).
- No third administrative tier (LGA) with reliable coverage across all 54
  countries — stays free text. GPS also still gives raw coordinates, not
  an address, so it doesn't help fill this in either.
- **Native-speaker review of the 6 non-English UI-chrome translations**
  (`lib/l10n/*.arb`) — all are unreviewed AI drafts right now, including
  Swahili/Arabic/Somali even though those languages' *alert* wording was
  already reviewed (that review never covered this separate set of
  strings).
- The 44 countries outside the 10 currently monitored regions still
  have single-sourced (Wikipedia only) emergency numbers, not
  cross-verified against a second source.
