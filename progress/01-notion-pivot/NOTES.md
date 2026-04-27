# Milestone 01 — Notion pivot (final)

After feedback `ini mah yang berubah cuman warnanya aja` + `kaya high tech wannabe gasuka gw` + `gw mau tampilannya kaya notion`. Total visual + architectural shell rewrite. 12 panel feature parity preserved.

## Stripped

- `Solofleet Ops Bridge` subtitle in sidebar → just `Sowhat`
- `FLEET OPS / ANALYTICS / PLATFORM` uppercase tracked-out section labels → sentence case `Workspace`, `Reports`, `Settings`
- Sub-hint per nav item (`Live KPI + alerts`, `JO kanban`) → only icon + page name
- `PLATFORM / Config` breadcrumb caps gimmick → just page title `Config`
- `Cmd K` hint pill in CommandBar
- `LIVE` indicator pill in CommandBar
- `ACCOUNT Primary account` caps tag in CommandBar
- `SECURE LOGIN 04/27/2026` tag in login
- `Operations bridge / sign in` eyebrow in login
- `BUILT FOR COLD-CHAIN FLEET OPERATIONS / SOWHAT X SOLOFLEET` footer in login
- System status checklist (System operational / Encrypted transport / Local seed storage)
- Boot-frame terminal aesthetic + grid background pattern
- Boot loading `BOOTING WORKSPACE / Backend connection CONNECTING / Web session VERIFYING`
- Sidebar `DARK MODE` caps label → just `Dark`
- Status footer `IDLE / NEXT / ACCOUNT / SNAPSHOT` caps tracked-out meta → `Polling off · next - last sync -` muted single line
- 3px emerald accent bar before every panel heading
- Mono uppercase eyebrow on stat cards (`TOTAL UNITS` → `Total units`)
- All `text-transform: uppercase + letter-spacing: 0.04em–0.18em` gimmicks across stat cards, table headers, eyebrows, severity tags, donut center
- Heavy gradient `background-image` on cards
- Drop-shadow box-shadow drama
- Donut center `CONFIGURED` caps → `Configured` sentence case

## Notion-style replacements

- Sidebar: light surface `#FFFFFF` (light) / `#191919` (dark), 1px hairline border, 13.5px Inter regular nav items, hover bg `var(--surface-hover)`
- Active nav: subtle gray bg `var(--surface-hover)`, no emerald glow, weight 500
- Header (CommandBar): single row, sentence-case page title h1 + tiny muted account meta + tools right-aligned (search pill, date range, icon buttons, emerald `Poll now` CTA). Force `flex-direction: row !important` to override legacy 2-row layout.
- Search: pill-shaped soft-bg input, no Cmd K decoration, focus-within shows soft emerald ring
- Login (auth-shell): simple centered card, brand mark `S Sowhat` + `Sign in` + `Use your Sowhat workspace account.` sublabel + 2 fields + Continue button, theme toggle pojok kanan atas
- Status footer: 28px thin, muted gray meta single line, em-dash separators
- Stat cards: clean surface, no gradient, sentence-case label 12.5px, sans-serif value 22-26px bold with `tnum` numerals, severity color retained
- Tables: sentence-case headers, no caps tracked-out, hairline border, hover row tint
- Empty states: 1px dashed border, 40px padding, muted italic
- Focus rings: 2px alpha 0.20 emerald ring on inputs + 2px outline on buttons
- Hover transitions: 120ms ease on bg/border-color (no transform jumpy)

## Notion design tokens

**Light**:
- bg `#FFFFFF`, surface `#FFFFFF`, surface-raised `#F7F6F3`, surface-hover rgba(55,53,47,0.06)
- text-dark `#1F1E1B`, text-main `#37352F`, text-secondary `#5E5C57`, text-muted `#787773`
- border `#EBEBEA`, border-strong `#DDDDDC`
- primary `#059669`

**Dark**:
- bg `#191919`, surface `#191919`, surface-raised `#202020`, surface-hover rgba(255,255,255,0.06)
- text-dark `#ECECEC`, text-main `#E6E6E6`, text-secondary `#B5B5B5`, text-muted `#8C8C8C`
- border rgba(255,255,255,0.094), border-strong rgba(255,255,255,0.16)
- primary `#10B981`

## Files

- `frontend/src/App.jsx` (login JSX rewritten boot-shell → auth-shell, BrandLockup simplified to `S / Sowhat`)
- `frontend/src/layout/NavRail.jsx` (sectioned + simple list, dropped sub-hints)
- `frontend/src/layout/CommandBar.jsx` (single row, no breadcrumb/Cmd K/LIVE)
- `frontend/src/layout/StatusFooter.jsx` (subtle inline meta)
- `frontend/src/styles.css` (+~1500 lines Notion override layer at end, -470 lines legacy boot-shell + login-shell + login-glass-card cleanup)

## Cleanup pass

Removed legacy CSS (~470 lines):
- `.boot-shell / .boot-grid / .boot-frame / .boot-frame-* / .boot-eyebrow / .boot-headline / .boot-form / .boot-field / .boot-checklist / .boot-spinner-row / .boot-frame-foot / .boot-theme-toggle` (~262 lines)
- `.login-shell / .login-hero / .login-form-panel / .login-glass-card / .login-input / .login-submit-btn / .login-card / .login-copy / .login-header` (~209 lines)

Build clean (~700ms).

## Screenshots

| File | Description |
|---|---|
| `01-overview-dark.png` | Overview dark (initial milestone) |
| `02-signin-dark.png` | Sign in dark |
| `03-signin-light.png` | Sign in light |
| `04-overview-light.png` | Overview light |
| `05-fleet-light.png` | Fleet Live light |
| `06-trips-light.png` | Trip Monitor light |
| `07-map-light.png` | Map light |
| `08-astro-light.png` | Astro report light |
| `09-temp-errors-light.png` | Temp errors light |
| `10-stop-idle-light.png` | Stop / idle light |
| `11-api-monitor-light.png` | API monitor light |
| `12-config-light.png` | Config light |
| `13-admin-light.png` | Admin light |
| `14-overview-dark-final.png` | Overview dark (post-fixes initial) |
| `15-overview-dark-fixed.png` | Overview dark (header fixed, donut sentence case) |
| `16-overview-light-fixed.png` | Overview light (header fixed) |
| `17-trips-light-fixed.png` | Trips light (filter chips polished) |
| `18-overview-light-polish.png` | Overview light (polish layer applied) |
| `19-fleet-dark.png` | Fleet Live dark |
| `20-trips-dark.png` | Trips dark |
| `21-api-monitor-dark.png` | API monitor dark (table styling) |
| `22-signin-dark-final.png` | Sign in dark (post-cleanup, no legacy CSS) |
| `23-overview-dark-final-cleanup.png` | Overview dark (post-cleanup, login flow verified) |

## Smoke tests

- Build clean (`npm run build` → 700ms, no warnings)
- Login: auth-shell renders, sign in via admin/devintest succeeds, lands on Overview
- Sign out: returns to auth-shell
- Sidebar nav: all 12 panels render, no console errors
- Theme toggle: dark ↔ light flips smoothly
- React Router: deep-link routes intact (PR #1 not regressed)

## Sengaja deferred (follow-up PR)

- App.jsx 5800+ lines → split into `routes/*.jsx`
- Modal → route conversions (unit detail, trip detail jadi page tersendiri)
- Cmd K palette wiring (search field skeleton sudah ada)
