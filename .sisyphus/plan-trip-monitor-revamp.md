# Plan: Trip Monitor Revamp

> **Status:** Reviewed + UX critiqued — all issues fixed (2025-07-14)
> **UX Health Score:** 27/40 (Acceptable) → targeting 32+ after implementation
> **Created:** 2025-07-14
> **Author:** AI (brainstormed with user)
> **Scope:** Logic overhaul, UI restructure, manual override system, ETA calculation

---

## TODOs

### Phase 1A — Detail Modal Restructure

- [x] **T1A.1**: Extract header into `TripMonitorDetailHeader.jsx` component
  - 2-tier layout: sticky glance info + scrolling reference
  - Props: detail, headlineJob, shippingStatus, eta, overrideActive, handlers
  - Acceptance: Header renders with all elements, sticky tier works on scroll

- [x] **T1A.2**: Create `TripMonitorDetailMapSection.jsx` with schedule grid
  - Map (200px) + 4-column schedule grid (ETA Load, ETD Unload, Temp Range, Last Update)
  - Grid responsive: 2x2 on mobile (<480px)
  - Acceptance: Section renders, grid adapts to viewport

- [x] **T1A.3**: Restructure `TripMonitorDetailModal.jsx` to 5-section layout
  - Remove old 8-section structure
  - New order: Header → Map+Schedule → Temp Trend (collapsed) → Alerts (expanded) → Stops (expanded) → Deep Dive actions
  - Acceptance: Modal renders new layout, collapsible sections work

- [x] **T1A.4**: Add ETA chip to `TripMonitorUnitCard.jsx`
  - Display format: `~2h 15m` (compact)
  - Color-coded: green (on time) / yellow (at risk) / red (late)
  - Acceptance: ETA shows on kanban cards when data available

- [x] **T1A.5**: Add override indicator dot to kanban card
  - Cyan dot on card top-right corner when override active
  - Acceptance: Dot appears when `overrideActive === true`

### Phase 1B — Override System Backend

- [x] **T1B.1**: Create database tables (`tms_jo_overrides`, `tms_jo_override_audit`)
  - Schema per plan L154-196
  - Indexes on job_order_id and performed_at
  - Acceptance: Tables created, migrations run clean

- [x] **T1B.2**: Implement API endpoints for override CRUD
  - `GET /api/tms/overrides/:jobOrderId`
  - `POST /api/tms/overrides/:jobOrderId` (upsert)
  - `DELETE /api/tms/overrides/:jobOrderId`
  - `GET /api/tms/overrides/:jobOrderId/audit`
  - Acceptance: All endpoints return correct data, audit trail logs changes

- [x] **T1B.3**: Implement `applyJoOverrides(snapshot, overrideRow)` function
  - Apply stops_override → `snapshot.stops`
  - Apply temp_range_override → `snapshot.tempMin/tempMax`
  - Apply force_closed → `snapshot.jobOrderStatus = 'closed'`
  - Skip shipping_status_override (Phase 2A)
  - Acceptance: Function correctly merges override data into snapshot

- [x] **T1B.4**: Inject override loading into `syncTmsMonitor()` path
  - Load all overrides: `SELECT * FROM tms_jo_overrides`
  - Build `Map<jobOrderId, overrideRow>`
  - Pass to `buildTmsMonitorRows()` as param
  - Apply overrides to each snapshot in `group.items` BEFORE `chooseHeadlineSnapshot()` call (L5615-5617)
  - Acceptance: Full sync applies overrides, board shows corrected data

- [x] **T1B.5**: Inject override loading into `listTmsMonitorRows()` refresh path
  - Same full query (all rows refreshed)
  - Pass to `refreshTripMonitorStoredRow()` as param
  - Apply overrides to `metadata.jobOrders` array BEFORE `chooseHeadlineSnapshot()` call (L5003)
  - Acceptance: Board list refresh applies overrides

- [x] **T1B.6**: Inject override loading into `/api/tms/board/detail` handler
  - Scoped query: `SELECT * FROM tms_jo_overrides WHERE job_order_id = ANY($1)`
  - Pass to `refreshTripMonitorStoredRow()` as param
  - Acceptance: Detail view applies overrides

- [x] **T1B.7**: Implement post-override-save row recompute
  - After `POST /api/tms/overrides/:jobOrderId` saves override:
  - Find affected `tms_monitor_rows` (query: JSONB containment or text LIKE)
  - Call `refreshTripMonitorStoredRow()` with fresh override
  - `upsertTmsMonitorRows()` to persist
  - Acceptance: Board reflects override immediately without waiting for next sync

### Phase 1C — Override UI (Inline Edit)

- [x] **T1C.1**: Implement temp range inline edit in schedule grid
  - Click pencil → show min/max inputs + save/cancel
  - On save: `POST /api/tms/overrides/:joId` with `tempRange`
  - Show "Overridden" badge + original TMS value (muted, inline)
  - Reset button to revert
  - Acceptance: Temp range editable, override saves, badge shows, reset works

- [x] **T1C.2**: Create `TripMonitorStopsEditor.jsx` component
  - Normal mode: read-only progress bar + stop list
  - Edit mode: inline inputs (name, address, latlong, type), drag handles, add/remove
  - Draft persistence: localStorage auto-save keyed by `override-draft::{jobOrderId}`
  - Acceptance: Stops editable, reorder works, draft persists, save/cancel work

- [x] **T1C.3**: Implement map picker for stop latlong
  - Mini Leaflet map (200px), click to set pin
  - Triggered from stop editor "Pick on map" button
  - Acceptance: Map picker opens, pin sets latlong, confirms back to editor

- [x] **T1C.4**: Implement Force Close dialog
  - Button in header (danger style)
  - Confirmation dialog with reason textarea (required, min 5 chars)
  - On confirm: `POST /api/tms/overrides/:joId` with `forceClose: true`
  - Acceptance: Dialog shows, reason required, JO moves to "Selesai" after close

- [x] **T1C.5**: Create `TripMonitorOverrideBadge.jsx` component
  - Badge in header when any override active
  - Click → popover listing active overrides with per-field reset links
  - Acceptance: Badge shows when override exists, popover lists overrides, reset works

- [x] **T1C.6**: Implement stale data indicator
  - Compare board refresh data with cached panel detail
  - Show pulsing amber dot + "Data updated" text when stale
  - Click indicator or refresh button → full detail refetch
  - Acceptance: Indicator shows when data stale, click refetches

### Phase 1D — Deep Dive Pages

- [x] **T1D.1**: Add `subView` state to `TripMonitorPanel.jsx`
  - State: `{ type: 'board' | 'historical' | 'incidents' | 'audit-log', context: {...} }`
  - Acceptance: State manages sub-view navigation

- [x] **T1D.2**: Create `TripMonitorDeepDiveShell.jsx` wrapper
  - Back button → return to board
  - Header with context (unitId, jobOrderId, range)
  - Acceptance: Shell renders with back nav, context displays

- [x] **T1D.3**: Implement Historical Records sub-view
  - Full-width DataTable, same columns as current modal section
  - Receives unitId + range from context
  - Acceptance: Historical data loads, table renders, back button works

- [x] **T1D.4**: Implement Incident History sub-view
  - Full-width DataTable with incident history + comments
  - Receives jobOrderId from context
  - Acceptance: Incident data loads, table renders, back button works

- [x] **T1D.5**: Implement Override Audit Log sub-view
  - Timeline view: timestamp + field changed + old→new + who + reason
  - API: `GET /api/tms/overrides/:jobOrderId/audit`
  - Acceptance: Audit log loads, timeline renders, back button works

### Phase 2A — Shipping Status Manual Override (DEFERRED)

- [ ] **T2A.1**: Implement shipping status override dropdown
- [ ] **T2A.2**: Add override logic to `buildTripMonitorShippingStatus()`
- [ ] **T2A.3**: Implement status change history section

### Phase 2B — ETA Realtime Calculation (DEFERRED)

- [ ] **T2B.1**: Implement `calculateTripMonitorEta()` function with OSRM
- [ ] **T2B.2**: Add ETA caching (TTL 60s)
- [ ] **T2B.3**: Integrate ETA into board refresh pipeline
- [ ] **T2B.4**: Add ETA display to detail modal header

### Phase 2C — WA Driver Shortcut (DEFERRED)

- [ ] **T2C.1**: Extract driver phone from TMS crew data (pending HAR)
- [ ] **T2C.2**: Add WA icon next to driver names in header
- [ ] **T2C.3**: Implement `wa.me` link handler

---

## Final Verification Wave

- [ ] **F1**: Code review — all changed files follow existing patterns
- [ ] **F2**: Manual QA — test override CRUD, inline edit, deep dive nav
- [ ] **F3**: Build verification — `npm run build` passes
- [ ] **F4**: Integration test — full flow from board → override → verify board update

---

## Progress Tracking

**Phase 1A**: 0/5 tasks
**Phase 1B**: 0/7 tasks
**Phase 1C**: 0/6 tasks
**Phase 1D**: 0/5 tasks
**Phase 2 (deferred)**: 0/6 tasks
**Final Wave**: 0/4 tasks

**Total**: 0/33 tasks (27 active, 6 deferred)

---

[Original design spec continues below...]

---

## Problem Statement

TMS (Frappe/ERPNext) = sumber data kotor. Inputer jarang fix masalah data. Akibatnya trip monitor jadi tidak akurat.

**Data yang sering salah di TMS:**
1. **LatLong load/unload** — koordinat tidak sesuai realita → geofence detection salah → shipping status salah
2. **Urutan stops** — urutan load/unload di TMS tidak sesuai rute sebenarnya → progress timeline salah
3. **Suhu range** — min/max temp di JO tidak sesuai agreement customer → false positive/negative temp-out-of-range
4. **JO gantung** — JO harusnya sudah selesai tapi status masih open karena tidak di-close → unit terus muncul di board
5. **Driver tidak update app** — shipping status stuck karena driver tidak update aplikasi

**Root cause:** Tidak ada mekanisme koreksi dari sisi ops. Semua bergantung pada data TMS yang tidak bisa diubah.

---

## Solution: JO Override Layer + Modal Restructure + ETA Calc

### Architecture

```
                TMS (Frappe)
                     │
                syncTmsMonitor()
                     │
               raw JO snapshots
                     │
           ┌─────────┴─────────┐
           │                   │
     tms_jo_overrides    (no override)
           │                   │
           └─────────┬─────────┘
                     │
            ★ applyJoOverrides()  ← merge point
                     │
           ┌─────────┼─────────┐
           │         │         │
      stops      temp range   force close
           │         │         │
   buildShipping  evaluateInc  severity
   Status()       idents()     determination
           │         │         │
           └─────────┼─────────┘
                     │
               tms_monitor_rows
                     │
             GET /api/tms/board
                     │
                 Frontend
```

Override di-key by **JO ID** (bukan nopol). TMS sync tidak overwrite override. Admin only. Full audit trail. Per-JO lifetime (JO selesai = override tidak relevan lagi).

---

[Rest of original spec omitted for brevity — full design details remain in original file]
