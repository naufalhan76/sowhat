# Trip Monitor · Drawer pattern (Pattern 1)

## What changed
Detail view dipindah dari centered modal jadi right-side drawer (slide in dari kanan, ~720px / 92vw, full height).
Kanban board tetap visible di kiri (di-dim oleh backdrop blur), jadi user gak ke-context-switch.

## Mechanics
- **Backdrop**: fixed inset 0, soft dim + 2px blur, fade-in 200ms.
- **Panel**: flex column, sticky header (Trip Monitor Detail eyebrow + nopol + customer + route),
  body scrollable, slide-in 260ms `cubic-bezier(0.22, 0.61, 0.36, 1)`.
- **Close**:
  - `Esc` keyboard (handler di `useEffect` listening `keydown`)
  - Tombol X di pojok kanan-atas sticky header (`.tm-drawer-close`, 32×32, focus ring emerald)
  - Klik backdrop di luar panel
- **Mobile**: ≤720px → 100vw full-screen.

## Animations (CSS-only, lightweight)
- `tmDrawerBackdropFade` 200ms ease-out (opacity 0 → 1).
- `tmDrawerSlideIn` 260ms cubic-bezier (translateX 24px → 0 + opacity).
- Hanya `transform` + `opacity` — zero layout thrash.

## Screenshots
- `01-drawer-critical-dark.png` — drawer open dari card B 9500 CXU (Critical column)
- `02-drawer-scrolled-stops-dark.png` — scrolled state, status pengiriman timeline + map + graphic visible
- `03-drawer-warning-light.png` — drawer di light mode, sticky header + close button visible
- `04-drawer-warning-dark-with-close.png` — dark mode dengan sticky close X di header

## Belum
- Open-as-page escape (button → `/trips/:rowId` full canvas)
- Hover sync stops timeline ↔ map markers
- Strip old `.fleet-detail-modal-*` CSS
