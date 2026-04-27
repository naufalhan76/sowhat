# Sticky-notes drawer redesign

## Layout
- Header thin (title + Maximize2 + Close), drawer width `min(840px, 94vw)`
- Map ~60% top with floating "Hide route" pojok kanan
- Sticky-notes wall ~40% bottom (auto-fit grid, min 220px col)
- 7 notes total: Severity, JO Drivers, Schedule, Status, TMS Temp Range, Stops Timeline, Temperature Trend, Incident History

## Sticky-notes vibe (subtle, profesional)
- White background (light) / `rgba(255,255,255,0.018)` (dark)
- 3px colored left border, severity-aware (Critical red / Warning amber / Normal mint)
- Tiny rotation per note via `--rotation: -0.5deg | +0.5deg` inline style
- Soft shadow, hover lifts `translateY(-2px)`
- Pin icon mini di header

## Tap-to-expand inline
- Temperature Trend + Incident History default = mini preview
- Klik note → expand inline jadi `grid-column: 1 / -1` full-width, durasi 240ms
- Hanya 1 note bisa expanded at a time (state `expandedNoteId`)
- Klik lagi → collapse

## Verified (manual visual test)
- Dark mode: ✓ default, Temperature Trend expand+collapse, Incident History expand
- Light mode: ✓ default, Temperature Trend expand
- Layout proportions hold di kedua mode
- No text overflow, no layout-shift saat expand

## Screenshots
- `00-dark-default.png` — drawer default state, dark mode
- `01-dark-graphic-expanded.png` — Temperature Trend expanded, full chart visible
- `02-dark-history-expanded.png` — Incident History expanded, full table visible
- `03-light-default.png` — drawer default state, light mode
- `04-light-graphic-expanded.png` — Temperature Trend expanded, light mode
