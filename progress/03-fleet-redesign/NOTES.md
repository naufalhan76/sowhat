# 03 · Fleet redesign — V2 3-pane layout

Goal yang lo set: list kiri, kanan dibagi map (gede) + chart (strip), dengan animasi tipis. **V2** dipilih (70% map / 30% chart, drag handle resize, ratio persist).

## Yang ke-deliver di milestone ini

**Layout 3-pane** (`/fleet`):
- **Left** — `aside.fleet-workspace-list` width 320px, sticky search box, account + category dropdown, 4 quick filter pills (`All` / `Temp error` / `Setpoint mismatch` / `GPS late > 30 min`), counter `N of 114`, Export CSV, scrollable list semua unit dengan compact row (kode unit + nopol + alamat + temp readings + state badge).
- **Right** — `section.fleet-workspace-detail` dibagi:
  - Header: unit kode + nopol, location, chips (state + category + idle + updated), action buttons (`Open in Maps` · `Temp errors` · `Historical`).
  - KPI grid 7 metric (Temp1, Temp2, Gap, Speed, Trip km, Setpoint, GPS) — temp error highlighted merah otomatis.
  - **Split workspace** — map 70% (default) + drag handle 6px + chart 30%, semua di dalam grid `grid-template-rows: calc(var(--fleet-split-ratio) * 100%) 6px 1fr`.
- Empty state kalau belum ada unit yang dipilih: copy halus `Pilih unit di kiri untuk lihat map dan grafik suhu.`

**Resizable split**:
- Drag handle pakai pointer events (mouse + touch). Ratio di-clamp 0.35–0.85.
- Persist di `localStorage['sowhat:fleet-workspace-split']`. Ratio di-baca saat mount, tetap setelah refresh.
- Verified: set `localStorage` → 0.55 → reload → map kecil, chart gede ([screenshot 03](./03-fleet-resized-055-dark.png)).
- Keyboard: handle focusable (`tabindex=0`), arrow up/down geser ±0.05.

**Map fix kritikal** (lo bakal peduli kalau dive in):
- `.unit-map-canvas` punya `height: 320px` global dari versi lama. Di split context itu kunci map jadi kecil.
- Solusi: scoped override `.fleet-workspace-split-map .unit-map-canvas { height:100% !important }` + `min-height: 0` chain di shell/frame.
- Plus `ResizeObserver` di `UnitRouteMap` yang call `map.invalidateSize()` setiap container resize → drag handle nge-resize map mulus tanpa tile gap.

**Animations Notion-style** (cuma `transform` + `opacity`, durasi 120-180ms):
- Tab fade-in saat detail pane swap unit.
- List row hover slide 1px translateX.
- Drag handle hover → emerald accent.
- Marker pulse di selected unit map.
- Tidak ada library tambahan. Tidak ada spring physics.

## Screenshots

| File | State |
|---|---|
| `02-fleet-detail-temperror-dark.png` | Default 70/30, dark, COL94 (45.6°C temp error) auto-selected. Map render route 203 titik, chart visible bawah handle. |
| `03-fleet-resized-055-dark.png` | Ratio 0.55, dark, chart strip gede — full temp trend visible (nampak spike merah Temp1 = 45.6°C). |
| `04-fleet-detail-light.png` | Light mode, ratio 0.55. Notion aesthetic tetap konsisten — emerald cuma di Poll now CTA, sisanya soft slate. |

Screenshots ambil pakai akun `naufal.hanafi@coldspace.id` (114 unit live).

## Verified flows

- All 114 unit render di list, scroll mulus.
- Filter pill: All=114, Temp error=3, Setpoint mismatch=0, GPS late >30 min=7. Counter `N of 114` update saat pill aktif.
- Klik row → detail pane render dengan map (route 203 titik) + chart (Temp1/Temp2 lines).
- Theme toggle dark ↔ light: tile filter map switch (`OSM dark mode` ↔ light), border + text color update.
- localStorage split persist setelah F5.
- 0 console error.

## Sengaja DEFERRED (next PR scope)

- Tab `Route` (full-bleed map) di header detail — saat ini cuma single Overview view.
- Tab `History` (date range picker + chart historical, merge dari `/historical`) — saat ini Historical masih standalone page.
- Tab `Incidents` (temp errors filtered by unit) — saat ini Temp errors button lempar ke panel Temp errors global.
- URL routing `/fleet/:unitId?tab=...` — pake state-based selection.
- Hover sync map marker ↔ chart point.
- Cmd K palette wiring buat unit search dari mana aja.

## Issues / known caveats

- Klik tombol `Historical` di detail header lempar ke standalone Historical page (bukan tab) — masih konsisten sama state sebelum redesign tab masuk.
- Drag chart untuk box-zoom feature di Temperature trend tetap jalan (controls Zoom in/out/Reset di header chart).
- Saat split di-resize ke ratio kecil (<0.4), map masih readable tapi route polyline bisa kepotong di edge — wajar karena viewport map mengecil.
