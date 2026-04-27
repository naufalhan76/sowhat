# Milestone 01 — Notion pivot (initial)

After feedback "ini mah yang berubah cuman warnanya aja" + "kaya high tech wannabe gasuka gw" + "gw mau tampilannya kaya notion".

## Stripped
- "Solofleet Ops Bridge" subtitle in sidebar → just "Sowhat"
- "FLEET OPS / ANALYTICS / PLATFORM" uppercase tracked-out section labels → sentence case "Reports", "Settings"
- Sub-hint per nav item ("Live KPI + alerts", "JO kanban") → only icon + page name
- "PLATFORM / Config" breadcrumb caps gimmick → just page title "Config"
- "Cmd K" hint pill in CommandBar
- "LIVE" indicator pill in CommandBar
- "ACCOUNT Primary account" caps tag in CommandBar
- "SECURE LOGIN 04/27/2026" tag in login
- "Operations bridge / sign in" eyebrow in login
- "BUILT FOR COLD-CHAIN FLEET OPERATIONS / SOWHAT X SOLOFLEET" footer in login
- System status checklist (System operational / Encrypted transport / Local seed storage)
- "Boot frame" terminal aesthetic + grid background pattern
- Boot loading "BOOTING WORKSPACE / Backend connection CONNECTING / Web session VERIFYING"
- Sidebar "DARK MODE" caps label → just "Dark"
- Status footer "IDLE / NEXT / ACCOUNT / SNAPSHOT" caps tracked-out meta → "Polling off · next -" muted single line
- Emerald accent bar before every panel heading
- Mono uppercase eyebrow on stat cards ("TOTAL UNITS" → "Total units")
- All `text-transform: uppercase + letter-spacing: 0.04em–0.18em` gimmicks across stat cards, table headers, eyebrows, etc.
- Heavy gradient background-images on cards
- Drop-shadow box-shadow drama

## Notion-style replacements
- Sidebar: light gray `#F7F6F3` (light) / `#202020` (dark), 1px hairline border, 13.5px Inter regular nav items, hover bg `rgba(55,53,47,0.06)`
- Active nav: subtle gray bg, no emerald glow, weight 500
- Header: single row, big sentence-case page title (16px) + tiny muted account meta + tools right-aligned
- Search: pill-shaped soft-bg input, no Cmd K decoration
- Login: simple centered card, brand mark + "Sign in" + sublabel + 2 fields + Continue button, theme toggle in top-right corner
- Status footer: 28px tall, muted gray meta in a single line, em-dash separators
- Stat cards: clean surface, no gradient, sentence-case label, sans-serif value with `tnum` numerals
- Tables: sentence-case headers, no caps tracked-out, hairline border, hover row tint

## Files
- `frontend/src/App.jsx` (login JSX rewritten boot-shell → auth-shell, BrandLockup simplified)
- `frontend/src/layout/NavRail.jsx` (sectioned + simple list, dropped sub-hints)
- `frontend/src/layout/CommandBar.jsx` (single row, no breadcrumb/Cmd K/LIVE)
- `frontend/src/layout/StatusFooter.jsx` (subtle inline meta)
- `frontend/src/styles.css` (+~1200 lines Notion override layer at end)

## Screenshots
- `01-overview-dark.png` — Overview page in dark mode
- `02-signin-dark.png` — Sign in page in dark mode
- `03-signin-light.png` — Sign in page in light mode
- `04-overview-light.png` — Overview page in light mode

## Next
- Audit remaining panels (Fleet, Trips, Map, Astro, Temp errors, Stop/idle, API monitor, Config, Admin) for residual gimmicks
- Polish header layout (search width, tool wrap behavior at narrow widths)
- Donut SVG "CONFIGURED" caps label remaining
- Per-panel pass for any residual uppercase tracked-out labels
