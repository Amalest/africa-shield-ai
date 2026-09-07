/// Real, source-cited general emergency phone numbers for all 54
/// countries in `countries.dart`. Sourced 2026-08-29 from Wikipedia's
/// "List of emergency telephone numbers"
/// (en.wikipedia.org/wiki/List_of_emergency_telephone_numbers), read
/// directly from that article's wikitext table (not an AI-summarized
/// paraphrase of it) — most entries there are themselves cited to a
/// government, embassy, telecom, or ITU source. Where a country has one
/// unified emergency number, that's used; otherwise this is the police
/// number, since that's the one number every listed country has and is
/// the closest to a universal "get connected to help" line where no
/// single unified number exists.
///
/// **Cross-verified 2026-08-29 for the 10 countries this backend
/// currently monitors** (Nigeria, Kenya, Egypt, Ghana, Uganda,
/// Mozambique, Tanzania, DRC, Somalia, Ethiopia — see
/// `backend/app/data/regions.json`), against the UK government's travel
/// advice "Getting help" pages (gov.uk/foreign-travel-advice/.../
/// getting-help) — an independent source from Wikipedia, and the two
/// disagreed for 4 of the 10: Kenya (999, not 112 — Wikipedia lists 112
/// as also valid, gov.uk states 999), Egypt (122, not 112 — gov.uk
/// doesn't mention 112 at all for Egypt), Uganda (999, not 112 — gov.uk
/// states 999; Wikipedia's own notes column also mentioned 999 as an
/// alternative), Mozambique (112, not 119 — gov.uk states a unified 112
/// gov.uk doesn't mention). The other 6 of the 10 matched exactly. **The
/// remaining 44 countries are still single-sourced from Wikipedia's
/// "List of emergency telephone numbers" only, not independently
/// re-verified** — treat those the same way this project treats an
/// AI-drafted translation: meaningfully better than nothing, appropriate
/// to ship, but flagged for a follow-up pass before relying on them at
/// real scale. Phone systems also change over time regardless of source
/// — see `todo.md`.
///
/// Keyed by the country name exactly as it appears in `countries.dart`.
/// A couple of short-form aliases are included too, since
/// `country_from_location()` on the backend derives a region's country
/// from whatever comes after the last comma in its `location_name` (e.g.
/// "Kinshasa, DRC" → `"DRC"`), which doesn't always match the full name
/// used in the country picker.
const Map<String, String> emergencyNumberByCountry = {
  'Algeria': '1548',
  'Angola': '113',
  'Benin': '117',
  'Botswana': '999',
  'Burkina Faso': '17',
  'Burundi': '117',
  'Cabo Verde': '132',
  'Cameroon': '112',
  'Central African Republic': '117',
  'Chad': '17',
  'Comoros': '17',
  'Congo, Democratic Republic of the': '112', // cross-verified against gov.uk 2026-08-29
  'DRC': '112', // alias — see doc comment
  'Congo, Republic of the': '117',
  'Djibouti': '17',
  'Egypt': '122', // cross-verified against gov.uk 2026-08-29 — not 112, see doc comment
  'Equatorial Guinea': '114',
  'Eritrea': '113',
  'Eswatini': '999',
  'Ethiopia': '911', // cross-verified against gov.uk 2026-08-29 — matched
  'Gabon': '1730',
  'Gambia': '117',
  'Ghana': '112', // cross-verified against gov.uk 2026-08-29 — matched
  'Guinea': '117',
  'Guinea-Bissau': '112',
  "Ivory Coast (Côte d'Ivoire)": '110',
  'Kenya': '999', // cross-verified against gov.uk 2026-08-29 — not 112, see doc comment
  'Lesotho': '123',
  'Liberia': '911',
  'Libya': '1515',
  'Madagascar': '117',
  'Malawi': '997',
  'Mali': '17',
  'Mauritania': '117',
  'Mauritius': '112',
  'Morocco': '19',
  'Mozambique': '112', // cross-verified against gov.uk 2026-08-29 — not 119, see doc comment
  'Namibia': '10111',
  'Niger': '17',
  'Nigeria': '112', // cross-verified against gov.uk 2026-08-29 — matched
  'Rwanda': '112',
  'São Tomé and Príncipe': '112',
  'Senegal': '17',
  'Seychelles': '112',
  'Sierra Leone': '019',
  'Somalia': '888', // cross-verified against gov.uk 2026-08-29 — matched (gov.uk notes these numbers "can be unreliable"; Somali Red Crescent also runs a free line, 446)
  'South Africa': '10111',
  'South Sudan': '999',
  'Sudan': '999',
  'Tanzania': '112', // cross-verified against gov.uk 2026-08-29 — matched
  'Togo': '117',
  'Tunisia': '197',
  'Uganda': '999', // cross-verified against gov.uk 2026-08-29 — not 112, see doc comment
  'Zambia': '999',
  'Zimbabwe': '999',
};
