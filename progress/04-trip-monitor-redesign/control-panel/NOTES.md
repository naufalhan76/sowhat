# Trip Monitor — Control Panel Drawer (560px)

Refactor dari sticky-notes wall jadi card-stacked control panel sesuai reference image dari user.

## Layout

- Drawer 560px (vs 720-840px sebelumnya)
- Header sticky: title + brand chip + severity badge + maximize/close
- Stack vertical (single column) di body — no grid, no multi-pane
- Driver row: nama driver + route summary + status pill
- Map embedded compact 240px (vs 60% dominan sebelumnya)
- Action row outline: Track Route | Trip History | Open Fleet
- Notification collapsible — incidents grouped by severity (Critical/Warning/Normal)
  - Colored alert rows per severity (red/amber/green wash)
- Stops Timeline collapsible
- Schedule (4-cell info grid)
- Temperature Trend collapsible
- Fullscreen-only: Historical Records + Incident History tables

## Animations (lightweight)

- Section fade-in 220ms ease-out (transform/opacity only)
- Alert row slide-in 200ms ease-out
- Chevron rotate 0→180deg pada `details[open]` (transform only)
- Action button hover translateY(-1px) 120ms

## Files

- frontend/src/App.jsx — TripMonitorDetailModal restructured
- frontend/src/styles.css — `.tm-stack`, `.tm-stack-section`, `.tm-alert-row.severity-*`, `.tm-action-btn`, etc.

## Screenshots

- 01-light-default.png — drawer terbuka dari kanan (light, top of stack)
- 02-light-scrolled.png — scrolled to show Notification + Stops Timeline + Schedule (light)
- 03-dark-default.png — same drawer di dark mode dengan map loading
