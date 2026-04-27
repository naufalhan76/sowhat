# Real-data validation — Solofleet account

Smoke-test of the Notion redesign against a live Solofleet account (114 units). Goal: prove feature parity holds when the dashboard pulls real data, not seed fixtures.

## Setup

- Logged in to web shell as `admin / devintest`
- Linked Solofleet account `naufal.hanafi@coldspace.id` via the Config panel
- Triggered `POST /api/discover/units` → 114 unit rows materialised
- Triggered `POST /api/poll/run` → live snapshot persisted (status, GPS, temp1/temp2, location, error flags)

## Panels exercised

| # | Panel       | Mode  | State                                                                                       | File                          |
|---|-------------|-------|---------------------------------------------------------------------------------------------|-------------------------------|
| 1 | Overview    | light | 114 total · 26.3% moving (30) · 73.7% idle (84) · KPI numerals tabular                      | `01-overview-light.png`       |
| 2 | Fleet Live  | light | 114 rows live, real nopol/temp/coords, sticky header, no horizontal scroll                  | `02-fleet-light-114units.png` |
| 3 | Trips       | light | Empty state — TMS account not linked, valid behaviour                                        | `03-trips-light-empty.png`    |
| 4 | Map         | light | 114 Leaflet markers, "Unit per wilayah" auto-grouped: Jabodetabek 86 · Bali 14 · JaBar 6 · JaTeng 1 · Sumatera 5 · Lainnya 2 | `04-map-light.png`            |
| 5 | Astro       | dark  | Empty until Generate — Astro routes belum di-config, valid                                  | `05-astro-dark.png`           |
| 6 | Temp errors | dark  | 0 incidents in range · Selected unit chart auto-loads `COL85 / B 9769 SXW` historical curve | `06-temp-errors-dark.png`     |
| 7 | Stop / idle | dark  | All 114 units enumerated in selector, 3 report types, exporter wired                         | `07-stop-idle-dark.png`       |
| 8 | API monitor | dark  | 68 reqs · 14 endpoints · 2 errors (TMS no-PG + my own 405 typo on `/api/discover-units`)    | `08-api-monitor-dark.png`     |
| 9 | Config      | dark  | "verified session · 114 unit configured" pill, all sub-sections collapsible                  | `09-config-dark.png`          |
| 10 | Admin      | dark  | Web profile KPI · user table · DB tools · POD/rollup editors                                 | `10-admin-dark.png`           |

## Findings

**Holds up under real load**
- 114-unit Fleet Live table stays dense without ratty wrapping or layout collapse
- Map clustering / regional grouping logic survives — no JS errors with sparse "Lainnya" bucket
- API monitor traced exactly the requests I issued during validation, no missing instrumentation
- Notion design language reads as intended: sentence-case headings, soft-gray meta, JetBrains Mono numerals on KPI

**Polish items to consider (non-blocking)**
- Sensor-trend legend on Temp errors panel wraps awkwardly when the right column shrinks (Temp1 / Temp2 / Setpoint min / max / Drag-zoom hint / Auto-refresh badge stack vertically). Not broken, just dense.
- `/api/auth/login` took ~2.7s and `/api/discover/units` ~900ms for first-time pull — fine for a 114-unit account but worth surfacing in the Poll Now affordance ("first sync may take a moment") if cold-start UX matters.
- Active filter pill on Fleet Live doesn't reflect URL state — refresh resets to "All fleet". Out of scope for this PR but candidate for the route-split follow-up.

**Aesthetic confirmation**
- No "high-tech wannabe" gimmicks left: no boot shell, no system-status checklist, no terminal frame, no emerald accent bar on cards, no SECURE LOGIN, no Cmd K pill, no LIVE indicator, no uppercase-tracked eyebrows
- Emerald is reserved for primary CTA (`Poll now`, `Save config`, `Save user`, `Generate report`, `Analyze stop / idle`) and the verified-session ring on the active Solofleet account card
- Light + dark both pass — tokens cascade end-to-end, no panel forgets the theme

## Out of scope (deferred to follow-up PR)

- App.jsx 5800-line route split
- Modal → page conversion (unit detail, trip detail)
- Cmd K palette wiring
- TMS / Astro empty-state polish (those need real config first, not a UI fix)
