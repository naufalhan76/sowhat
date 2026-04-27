# 04 · Trip Monitor — audit + redesign proposal

## TMS CargoShare wired ✓

- Postgres bootstrap di Docker (`postgres:16-alpine` :5432, db `sowhat`).
- `DATABASE_URL=postgres://postgres:devintest@localhost:5432/sowhat`.
- Admin user di-seed dari `data/config.json` (`admin/devintest`) ke tabel `dashboard_web_users`.
- TMS config: tenant `CargoShare TMS`, baseUrl `https://1903202401.cargoshare.id`, login `hanif.amal@coldspace.id`. Session verified, csrfToken cached.
- `/api/tms/auth/login` → `hasVerifiedSession: true`.
- `/api/tms/sync` → fetched 45 JO, saved 43 rows. Severity bucket: 0 critical, 17 warning, 26 normal. 8 customers (Astro / Havi / Yimi / Pandurasa / Sebastian / Dairi Alami / Omiyage).

## State sekarang (snapshot)

| File | State |
|---|---|
| `01-current-state-light.png` | Trip Monitor light mode dengan 43 trip card (4-column flat grid). |
| `02-current-state-dark.png` | Trip Monitor dark mode, scroll position sama. |

Dari audit, layout sekarang:

- Header card (`Trip Monitor` h2) + 2 action button (`Refresh board`, `Sync TMS`).
- Toolbar: 5 severity filter pill (`All / Critical / Warning / Normal / Unmatched / No JO`) dengan count.
- Filter grid: dropdown Customer, dropdown Incident, search bar nopol/JO.
- Incident legend: 8 icon (GPS error, Temp error, Temp out of range, Late load, Late destination, Long stop, Miss load geofence, Miss destination geofence).
- Status strip text: tenant + window + topbar range + row count + last sync.
- Body: flat 4-column grid card (`trip-monitor-flat-board` → `TripMonitorUnitCard`).
  - Card content: nopol heading + `JO-xxx | customer` + incident icons + tahap status (`OTW LOAD / MENUJU UNLOAD / SAMPAI LOAD/UNLOAD / SELESAI`) + lokasi origin/destination + temp range setpoint.
- Klik card → modal popup `TripMonitorDetailModal` dengan KPI grid + map + temp chart + history range + comments.

## Issue yang ke-spot dari current state

1. **Card density terlalu tinggi tapi info-nya datar** — semua 43 trip terlihat sama besar walaupun severitas-nya beda. 17 warning + 26 normal + 0 critical campur tanpa visual hierarchy yang jelas (cuma icon kecil di pojok).
2. **Card hanya 1 status per trip** — gak bisa liat progress trip multi-stop (`Load → Unload 1 → Unload 2 → ...`). Padahal data API ngirim full stops array.
3. **Modal popup heavy** — sama issue kayak fleet sebelum redesign: block view, gak bisa compare antar trip.
4. **Filter incident bingung** — incident legend punya 8 jenis tapi dropdown cuma 3 (incident yang aktif di window). Legend dijejer di toolbar (bukan di kartu) jadi user harus mata bolak-balik buat decode icon.
5. **Status strip teks panjang** (`Tenant: ... | TMS window: ... | Topbar range: ... | Status: ... | Last sync: ... | Auto-sync: ... | Rows: ...`) mirip wall of text — ngeganggu.
6. **Driver app status hidden** — data ada (`On Assignment | Not Ready | Accepted` dst.) tapi gak ditampilin di kartu.
7. **No pinning / saved filters** — kalau user fokus monitor 1 customer (PT Havi), tiap kali refresh harus filter lagi.

## Three direction options (similar pattern dgn Fleet V2)

### Option A · Severity-first board (kanban-by-severity)
```
┌─ Critical ────────┬─ Warning ───────┬─ Normal ─────┐
│ (0)               │ (17)            │ (26)         │
├───────────────────┼─────────────────┼──────────────┤
│ [no items]        │ B 9503 CXU      │ B 9258 SXX   │
│                   │ JO-28603        │ JO-28660     │
│                   │ HAVI Pondok ... │ INDOMARET    │
│                   │ Late load 191m  │ Selesai      │
│                   │                 │              │
└───────────────────┴─────────────────┴──────────────┘
```
- 3-column kanban berdasar severity. Card di-stack vertikal.
- Tiap card lebih dense: nopol + JO + customer + tahap stage + driver app status + incident summary.
- Klik card → side drawer kanan (mirroring Fleet V2 "page peek").
- Pro: critical/warning prioritas naik visually. Card berurut by-time-since-last-sync.
- Con: masih card-based, susah compare detail antar trip.

### Option B · Trip list + stops timeline (3-pane like Fleet V2) ← **gw recommend**
```
┌──────────────────┬─────────────────────────────────┐
│ Trip list 360px  │ Selected trip detail            │
│ ─────────────── │ ──────────────────────────────── │
│ Pills All/Crit/.│ Header: B 9503 CXU · JO-28603   │
│ Customer filter │ Customer · driver app status     │
│ Search          │ ───────────────────────────────  │
│                 │ ┌─ Stops timeline ────────────┐  │
│ ◉ B 9503 CXU    │ │ ✓ Load   PK01 ETA 10:00     │  │
│   JO-28603      │ │ • Unload 1 ETA 14:30 (Late) │  │
│   Late load     │ │ • Unload 2 ETA 16:15        │  │
│ ○ B 9188 SXX    │ │ • Unload 3 ETA 17:00        │  │
│ ○ B 9573 SXW    │ │ • Unload 4 ETA 18:30        │  │
│ ...             │ │ • Unload 5 ETA 19:45        │  │
│                 │ └─────────────────────────────┘  │
│                 │ ┌─ Live map (60%)─────────────┐  │
│                 │ │ truck position + route      │  │
│                 │ │ + stop markers              │  │
│                 │ └─────────────────────────────┘  │
│                 │ ┌─ Incidents ─────────────────┐  │
│                 │ │ • Late load (191m late)     │  │
│                 │ │ Comments                    │  │
│                 │ └─────────────────────────────┘  │
└──────────────────┴─────────────────────────────────┘
```
- Konsisten sama pattern Fleet V2 (list kiri 320-360px, detail kanan).
- Detail pane: stops timeline (vertical) di atas, live map di tengah, incidents di bawah.
- List row dense: nopol + customer + tahap stage + incident summary dengan severity dot kiri.
- Hover row → highlight stop yang sedang aktif di map.
- Pro: gak ada modal, deep work + scan side-by-side, konsisten dgn Fleet pattern (user udah familiar).
- Con: butuh refactor bigger (list row + stops timeline + map + incidents).

### Option C · Severity-banded table (Linear-style)
```
┌──── Warning (17) ───────────────────────────────────┐
│ Nopol  | JO     | Customer | Stage    | Incident   │
│ B 9503 | 28603  | Havi    | OTW Load  | Late load  │
│ B 9188 | 29019  | Astro   | OTW Load  | Late load  │
│ ...                                                 │
├──── Normal (26) ────────────────────────────────────┤
│ B 9258 | 28660  | Dairi   | Selesai   | -          │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```
- Table yang di-band per severity, sticky band header.
- Row click → drawer kanan (similar pattern).
- Pro: max density, fast scan, sortable.
- Con: less visual, lebih "spreadsheet" feel — kurang Notion vibe.

## Rekomendasi gw: Option B (3-pane list + stops timeline + map + incidents)

Alasan:
1. Konsisten sama Fleet V2 pattern. User udah belajar interaksi 3-pane (list kiri, detail kanan, drag handle).
2. Stops timeline = informasi paling matter buat ops cold-chain trip — kapan tiap drop point dijadwal vs aktual, mana yang late.
3. Map + timeline + incidents 3-blok di kanan-pane bisa di-resize (drag handle) sesuai mood (focus map vs focus stops vs focus incidents).
4. Severity dot (red/amber/grey) di list row + filter pill jaga signal critical/warning.
5. Bonus: tab Incidents ada filter ke unit ini (link ke Fleet detail Incidents tab).

## Pertanyaan biar gw bisa start

1. **Layout**: A severity kanban / **B 3-pane stops timeline (gw recommend)** / C severity table?
2. **Modal popup**: hapus total (jadi drawer/side panel), atau biarin sebagai escape hatch?
3. **Stops timeline**: full-height vertical (semua stop kelihatan), atau collapsed (cuma current + next stop)?
4. **Driver app status**: tampilkan di list row (compact) atau cuma di detail pane?
5. **Hover sync map ↔ stops timeline**: ya / no (ya = klik stop → map zoom ke marker stop itu)?

Bilang aja `B + default semua` atau pilih spesifik, gw langsung jalan.
