# Plan: Master Data Page + Manual JO Add

## Overview

Add two features to Solofleet:
1. **Manual Add JO** — button in Trip Monitor to manually add a JO by number
2. **Master Data Page** — historical analytics/BI page with per-JO metrics, dashboard, table, and CSV export

## Goals

- Enable users to manually track JOs that weren't auto-synced
- Provide a comprehensive BI data source for: success rate, avg trip metrics, driver performance, customer SLA, route optimization, fleet utilization
- Store finalized trip data for 34 days with CSV export capability

---

## Feature 1: Manual Add JO

### Location
- `+ Add JO` button in Trip Monitor page (top action bar)

### Flow
1. User clicks `+ Add JO`
2. Modal/input appears, user types `JO-XXXXX`
3. System validates format
4. System checks if JO already exists on board → if yes, reject with message "JO sudah ada di board"
5. System calls `fetchTmsJobOrderDoc(joId)` from TMS API
6. If found → process same as auto-sync (build snapshot, resolve addresses, match fleet unit, insert to `tms_monitor_rows`)
7. If not found → show error "JO tidak ditemukan di TMS"

### Backend
- `POST /api/tms/board/add` — body: `{ joId: "JO-29851" }`
- Requires web session (admin or operator)
- Uses existing `fetchTmsJobOrderDoc` + `buildTmsJobSnapshotFromDoc` + `resolveTmsAddressEntries`
- Duplicate check: query `tms_monitor_rows` for matching `job_order_id`

### Persistence During Sync
**Problem:** `replaceTmsSnapshotWindow()` (server.js:6072-6077) deletes ALL `tms_monitor_rows` in the sync window, which would wipe manually added JOs.

**Solution:** Add `source` column to `tms_monitor_rows`:
- `source = 'auto'` — from auto-sync (can be deleted/replaced)
- `source = 'manual'` — user-added (preserved during sync)

Modify `replaceTmsSnapshotWindow()`:
```js
// Instead of: delete from tms_monitor_rows where day >= $1 and day <= $2
// Use: delete from tms_monitor_rows where day >= $1 and day <= $2 AND source != 'manual'
```

Manual rows are still refreshed from TMS on each sync (re-fetch + update), but never deleted by the window replacement.

### Edge Cases
- JO exists in Master Data but not on Trip Monitor board → allow add (different purpose)
- JO has no matching fleet unit (plate not in Solofleet) → **reject** with error "Unit tidak terdaftar di Solofleet"
- TMS API unreachable → show error, don't add
- Manual JO persists across syncs — data refreshed but row never auto-deleted
- Manual JO that becomes inactive (JO closed) — stays on board until user removes or it falls off naturally
- Master Data population → not immediate on manual add, waits for next sync cycle

---

## Feature 2: Master Data Page

### Navigation
- New item in sidebar nav: "Master Data" (between Trips and Map, or after Trips)

### Layout
```
┌─────────────────────────────────────────────────────┐
│ [Date Range Picker] [Customer ▼] [Driver ▼] [Plate ▼] │
├─────────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │
│ │Total │ │On-time│ │Temp  │ │Avg   │ │Avg   │ │Inci- │ │
│ │JO    │ │Rate % │ │Compl%│ │Duratn│ │Dist  │ │dents │ │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ Supabase-style data table                       │ │
│ │ JO | Date | Customer | Plate | Driver | Route.. │ │
│ │ ─────────────────────────────────────────────── │ │
│ │ JO-29851 | 01/05 | PT Havi | B9502CXU | ...   │ │
│ │ JO-29855 | 01/05 | PT Havi | B9506CXU | ...   │ │
│ └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│ [Export CSV ▼] [Showing 45 of 892 records]          │
└─────────────────────────────────────────────────────┘
```

### Dashboard Cards (6)
All cards respect active date range filter.

| Card | Metric | Calculation |
|------|--------|-------------|
| Total JO | Count of JOs in period | `COUNT(*)` where `day` in range |
| On-time Rate | % stops where ATA ≤ ETA | `COUNT(on_time=true) / COUNT(eta IS NOT NULL) * 100` |
| Temp Compliance | % JOs without breach | `COUNT(temp_compliant=true) / COUNT(*) * 100` |
| Avg Duration | Mean trip duration | `AVG(total_duration_min)` where status=completed |
| Avg Distance | Mean actual distance | `AVG(actual_distance_km)` where status=completed |
| Incidents | Total incident count | `SUM(incident_count)` |

### Table Columns (default visible)
| Column | Source | Sortable | Notes |
|--------|--------|----------|-------|
| JO Number | `jo_id` | Yes | Link to detail? |
| Date | `day` | Yes | Format: DD/MM/YYYY |
| Customer | `customer_name` | Yes | |
| Plate | `plate` | Yes | |
| Driver | `driver_1_name` | Yes | |
| Route | `origin_name → destination_name` | No | Truncated |
| Stop count | `stop_count` | Yes | |
| Duration | `total_duration_min` | Yes | Format: Xh Ym |
| Distance | `actual_distance_km` | Yes | Format: XX.X km |
| Temp range | `temp_min / temp_max` | No | Format: X° / Y° |
| Temp status | `temp_compliant` | Yes | Badge: Compliant / Breach |

### Filters
| Filter | Type | Options |
|--------|------|---------|
| Date range | Date picker | Default: last 7 days |
| Customer | Dropdown/search | All customers from data |
| Driver | Dropdown/search | All drivers from data |
| Unit/Plate | Dropdown/search | All plates from data |

### Row Click → Separate Detail Page
- Clicking a row navigates to `/master-data/:joId`
- Detail page shows full JO data:
  - Header: JO number, customer, plate, driver, status badge
  - Map: route with all stops plotted
  - Timeline: geofence arrival/departure per stop (vertical timeline)
  - Temperature chart: temp over time with breach zones highlighted
  - Stops table: per-stop metrics (dwell, leg distance, leg temp, on-time)
  - Incidents list: all incidents with severity, duration, status
  - Driver metrics: idle time, speed violations
- Back button returns to Master Data table (preserving filters)

---

## Data Schema

### Table: `tms_master_data`
Primary key: `jo_id`

```sql
CREATE TABLE IF NOT EXISTS tms_master_data (
  jo_id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  tenant_label TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  plate TEXT NOT NULL DEFAULT '',
  normalized_plate TEXT NOT NULL DEFAULT '',
  driver_1_name TEXT NOT NULL DEFAULT '',
  driver_2_name TEXT NOT NULL DEFAULT '',
  origin_name TEXT NOT NULL DEFAULT '',
  destination_name TEXT NOT NULL DEFAULT '',
  stop_count INTEGER NOT NULL DEFAULT 0,

  -- Timing (geofence-based)
  trip_start_at BIGINT,          -- ms timestamp: geofence arrival at load
  trip_end_at BIGINT,            -- ms timestamp: geofence departure at last stop
  total_duration_min REAL,       -- (trip_end_at - trip_start_at) / 60000

  -- Distance
  actual_distance_km REAL,       -- sum of GPS haversine distances
  planned_distance_km REAL,      -- OSRM route distance
  route_efficiency REAL,         -- planned / actual * 100 (higher = better)

  -- Temperature (from Solofleet historical records)
  temp_min REAL,
  temp_max REAL,
  temp_avg REAL,
  breach_count INTEGER NOT NULL DEFAULT 0,
  breach_total_min REAL NOT NULL DEFAULT 0,
  temp_compliant BOOLEAN NOT NULL DEFAULT TRUE,

  -- Incidents (from TMS)
  incident_count INTEGER NOT NULL DEFAULT 0,
  incident_codes TEXT[] NOT NULL DEFAULT '{}',

  -- Driver behavior
  total_idle_min REAL NOT NULL DEFAULT 0,
  speed_violation_count INTEGER NOT NULL DEFAULT 0,

  -- Status & lifecycle
  status TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | completed | cancelled
  finalized_at BIGINT,
  expires_at BIGINT,             -- finalized_at + 34 days (or created_at + 34 days)
  warning_shown BOOLEAN NOT NULL DEFAULT FALSE,

  -- Meta
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_master_data_day ON tms_master_data(day);
CREATE INDEX IF NOT EXISTS idx_master_data_status ON tms_master_data(status);
CREATE INDEX IF NOT EXISTS idx_master_data_customer ON tms_master_data(customer_name);
CREATE INDEX IF NOT EXISTS idx_master_data_expires ON tms_master_data(expires_at);
```

### Table: `tms_master_data_stops`
One row per stop per JO.

```sql
CREATE TABLE IF NOT EXISTS tms_master_data_stops (
  id SERIAL PRIMARY KEY,
  jo_id TEXT NOT NULL REFERENCES tms_master_data(jo_id) ON DELETE CASCADE,
  stop_idx INTEGER NOT NULL,
  stop_type TEXT NOT NULL DEFAULT 'unload',  -- load | unload
  stop_label TEXT NOT NULL DEFAULT '',       -- LOAD, U1, U2...
  address_name TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,

  -- Timing (geofence-based)
  geofence_arrival_at BIGINT,
  geofence_departure_at BIGINT,
  dwell_time_min REAL,

  -- Temperature per leg (from previous stop to this stop)
  leg_temp_min REAL,
  leg_temp_max REAL,
  leg_temp_avg REAL,
  leg_breach_count INTEGER NOT NULL DEFAULT 0,

  -- Distance (from previous stop)
  leg_distance_km REAL,

  -- ETA vs ATA
  eta BIGINT,
  ata_geofence BIGINT,
  on_time BOOLEAN,

  -- Meta
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_master_stops_jo ON tms_master_data_stops(jo_id);
CREATE INDEX IF NOT EXISTS idx_master_stops_address ON tms_master_data_stops(address_name);
```

### Table: `tms_master_data_gps_points`
Persistent GPS track storage for active JOs (needed because in-memory records expire after 7 days).

```sql
CREATE TABLE IF NOT EXISTS tms_master_data_gps_points (
  id BIGSERIAL PRIMARY KEY,
  jo_id TEXT NOT NULL REFERENCES tms_master_data(jo_id) ON DELETE CASCADE,
  timestamp_ms BIGINT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed REAL,
  temperature REAL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_master_gps_jo ON tms_master_data_gps_points(jo_id);
CREATE INDEX IF NOT EXISTS idx_master_gps_ts ON tms_master_data_gps_points(jo_id, timestamp_ms);
```

---

## Data Population Logic

### Real-time (during Trip Monitor sync)

On every `syncTmsMonitor()` cycle, for each active JO on the board:

1. **Upsert `tms_master_data`** — basic info (customer, plate, driver, origin, destination, stop_count)
2. **Upsert `tms_master_data_stops`** — per-stop info (address, coords, ETA)
3. **Append `tms_master_data_gps_points`** — new GPS records since last sync (from `unitState.records`)
4. **Update geofence timing** — if unit enters/exits a stop geofence, update `geofence_arrival_at` / `geofence_departure_at`
5. **Update temperature** — running min/max/avg from GPS points with temperature data
6. **Update incidents** — from `tms_monitor_incidents`

### Finalization (when JO completes)

Triggered when shipping status reaches `selesai-pengiriman` or JO status = `Closed`:

1. **Compute actual_distance_km** — sum haversine distances from `tms_master_data_gps_points` (filter speed > 0 to exclude idle GPS jitter)
2. **Compute planned_distance_km** — OSRM route through all stops (cache by route hash)
3. **Compute route_efficiency** — `planned / actual * 100`
4. **Compute per-leg metrics** — segment GPS points by geofence timestamps, calculate leg_distance, leg_temp per stop
5. **Compute speed_violation_count** — count GPS points where speed > 80 km/h
6. **Compute total_idle_min** — sum of periods where speed = 0 for > 3 minutes (exclude stops)
7. **Lock status** — set `status = 'completed'`, `finalized_at = now`, `expires_at = now + 34 days`
8. **Cleanup GPS points** — optionally downsample `tms_master_data_gps_points` to 5-min intervals after finalization (reduce storage)

### Timing Source: Geofence Only
- Use `extractGeofenceVisitStats()` (existing function) with address_cache coordinates
- Geofence radius: use `TRIP_MONITOR_STATUS_RADIUS_METERS` (existing config, default 300m)
- NOT from driver swipe (task_list ata/atd) — those are inaccurate

---

## CSV Export

### Endpoint
`GET /api/tms/master-data/export?format=summary|stops|both&from=YYYY-MM-DD&to=YYYY-MM-DD`

### File: `jo_summary_{from}_{to}.csv`
Columns:
```
jo_id, day, customer_name, plate, driver_1_name, driver_2_name,
origin_name, destination_name, stop_count,
trip_start_at, trip_end_at, total_duration_min,
actual_distance_km, planned_distance_km, route_efficiency,
temp_min, temp_max, temp_avg, breach_count, breach_total_min, temp_compliant,
incident_count, incident_codes,
total_idle_min, speed_violation_count,
status, finalized_at
```

### File: `jo_stops_{from}_{to}.csv`
Columns:
```
jo_id, stop_idx, stop_type, stop_label, address_name,
latitude, longitude,
geofence_arrival_at, geofence_departure_at, dwell_time_min,
leg_temp_min, leg_temp_max, leg_temp_avg, leg_breach_count,
leg_distance_km,
eta, ata_geofence, on_time
```

---

## Data Retention & Cleanup

### Policy
- Data retained for **34 days** (1 month + 3 day buffer)
- `expires_at` computed as:
  - If finalized: `finalized_at + 34 days`
  - If never finalized (stuck in_progress): `created_at + 34 days`

### Warning
- 3 days before expiry: show visual indicator on row (e.g., orange badge "Expires in X days")
- Banner on Master Data page: "X records expiring in 3 days. Export before deletion."

### Auto-Delete
- Background job runs daily (e.g., 2:00 AM server time)
- Deletes rows where `expires_at < now`
- CASCADE deletes `tms_master_data_stops` and `tms_master_data_gps_points`
- Log deletion count to console

---

## Implementation Phases

### Phase A: DB Schema + Backend Populate + GPS Persistence
**Files:** `server.js` (schema + populate hooks in sync)
**Scope:**
- Add 3 new tables to `ensurePostgresSchema()`
- Add `populateMasterDataFromSync(row, fleetContext, tmsConfig, now)` function
- Hook into existing `syncTmsMonitor()` to call populate after each row processed
- Add GPS point accumulation: on each poll, persist new GPS records for active JOs
- Add geofence arrival/departure detection per stop

**Depends on:** Nothing (first phase)
**Blocks:** All other phases

### Phase B: Manual Add JO Button
**Files:** `server.js` (endpoint), `frontend/src/components/trip-monitor/TripMonitorPanel.jsx` (UI)
**Scope:**
- Add `POST /api/tms/board/add` endpoint
- Add `+ Add JO` button + input modal in Trip Monitor
- Duplicate check + error handling

**Depends on:** Phase A (needs master data table)
**Blocks:** Nothing

### Phase C: Master Data Page UI
**Files:** `frontend/src/App.jsx` (route), new component files in `frontend/src/components/master-data/`
**Scope:**
- New nav item "Master Data"
- Dashboard cards component (6 cards)
- Data table component (Supabase-style: sortable, filterable)
- Filter bar (date range, customer, driver, plate)
- `GET /api/tms/master-data` endpoint (list with filters + pagination)
- `GET /api/tms/master-data/summary` endpoint (dashboard card metrics)

**Depends on:** Phase A (needs data + API)
**Blocks:** Nothing
**Can run parallel with Phase B**

### Phase D: Finalize Logic
**Files:** `server.js`
**Scope:**
- `finalizeMasterDataJo(joId)` function — compute all derived metrics
- Trigger: hook into shipping status change detection (existing `buildTripMonitorShippingStatus`)
- OSRM planned distance calculation (with caching)
- GPS distance calculation (haversine sum, filter idle)
- Per-leg temperature segmentation
- Speed violation counting
- GPS point downsampling after finalization

**Depends on:** Phase A (needs accumulated GPS data)
**Blocks:** Phase E (export needs finalized data for full metrics)
**Critical timing:** Must finalize before GPS in-memory data expires (7 days). Phase A's GPS persistence solves this.

### Phase E: CSV Export
**Files:** `server.js` (endpoint), frontend (export button)
**Scope:**
- `GET /api/tms/master-data/export` endpoint
- Generate 2 CSV files (summary + stops)
- Frontend: "Export CSV" dropdown button on Master Data page
- Stream generation for large datasets

**Depends on:** Phase A + D (needs finalized data)
**Blocks:** Nothing

### Phase F: Auto-Delete + Expiry Warning
**Files:** `server.js` (background job), frontend (warning UI)
**Scope:**
- Daily background job (setInterval, 24h, run at 2 AM)
- Delete expired rows (CASCADE)
- Frontend: expiry badge per row, banner warning
- Log deletions

**Depends on:** Phase A (needs expires_at column)
**Blocks:** Nothing
**Can run parallel with Phase E**

---

## Recommended Execution Order

```
Phase A (foundation)
  ↓
Phase B + C (parallel — UI features)
  ↓
Phase D (finalize logic — needs GPS data accumulated from Phase A)
  ↓
Phase E + F (parallel — export + cleanup)
```

---

## Architecture Notes

### GPS Point Storage Sizing
- ~30 active JOs/day × avg 8 hours active × 1 point/minute = ~14,400 points/day
- 34 days retention = ~490,000 points max
- Each point: ~50 bytes → ~25 MB total. Manageable.
- After finalization, downsample to 5-min intervals: reduces to ~3,000 points/JO

### OSRM Caching
- Cache planned distance by route hash: `hash(stop1_coords + stop2_coords + ... + stopN_coords)`
- Same route (same stops) = same planned distance
- Store in `metadata` JSONB or separate cache table

### Module Extraction (Recommended)
- Consider extracting master data logic to `master-data-core.js` to avoid bloating server.js further
- Follow pattern of existing code organization

### Geofence Detection Reuse
- Existing `extractGeofenceVisitStats(records, stop, radius)` already computes first/last inside geofence
- Reuse for `geofence_arrival_at` (firstInside.timestamp) and `geofence_departure_at` (lastInside.timestamp)
- Requires GPS records to be available — Phase A's persistence ensures this

---

## Resolved Questions

1. ~~Shipping status timeline~~ → Covered by geofence timing per stop
2. **Row click in table** → Opens separate detail page (dedicated page per JO)
3. **Master Data status visibility** → Show ALL statuses (in_progress + completed + cancelled)
4. **Manual Add JO populate** → No immediate Master Data populate; waits for next sync cycle
5. **Unmatched plate** → Reject. Manual Add requires plate to be registered in Solofleet fleet

---

## QA Scenarios

### Phase A: DB Schema + Populate

**QA-A1: Schema creation**
- Tool: `curl` or direct DB query
- Steps: Deploy → hit any TMS endpoint → check tables exist
- Expected: `SELECT count(*) FROM tms_master_data` returns 0 (no error)
- Expected: `SELECT count(*) FROM tms_master_data_stops` returns 0
- Expected: `SELECT count(*) FROM tms_master_data_gps_points` returns 0

**QA-A2: Real-time population on sync**
- Tool: Trigger TMS sync via `POST /api/tms/sync`
- Steps: Sync → query `tms_master_data`
- Expected: Rows appear for active JOs with `status = 'in_progress'`
- Expected: `stop_count > 0`, `customer_name` not empty
- Expected: `tms_master_data_stops` has rows matching stop count

**QA-A3: GPS point accumulation**
- Tool: After sync + poll cycle, query GPS table
- Steps: Wait for 1-2 poll cycles → query `tms_master_data_gps_points WHERE jo_id = 'JO-XXXXX'`
- Expected: Points accumulate (count increases each poll)
- Expected: Each point has valid lat/lng within Indonesia bounds

### Phase B: Manual Add JO

**QA-B1: Successful add**
- Tool: `POST /api/tms/board/add` with body `{"joId": "JO-29851"}`
- Steps: Call endpoint with valid JO
- Expected: 200 OK, JO appears on trip monitor board
- Expected: `tms_monitor_rows` has row with `source = 'manual'`

**QA-B2: Duplicate rejection**
- Tool: `POST /api/tms/board/add` with JO already on board
- Expected: 409 or 400 with error "JO sudah ada di board"

**QA-B3: Manual JO survives sync**
- Tool: Add manual JO → trigger sync → check board
- Steps: Add JO-XXXXX manually → `POST /api/tms/sync` → query board
- Expected: Manual JO still present after sync (not deleted by `replaceTmsSnapshotWindow`)

**QA-B4: Invalid JO**
- Tool: `POST /api/tms/board/add` with body `{"joId": "JO-99999"}`
- Expected: Error "JO tidak ditemukan di TMS"

### Phase C: Master Data Page UI

**QA-C1: Page loads with data**
- Tool: Browser → navigate to Master Data page
- Expected: Dashboard cards show non-zero values (after sync has populated data)
- Expected: Table shows rows with all columns populated

**QA-C2: Filters work**
- Tool: Browser → apply customer filter
- Expected: Table rows filtered, dashboard cards recalculated for filtered set

**QA-C3: Sort works**
- Tool: Browser → click column header
- Expected: Rows reorder correctly

### Phase D: Finalize Logic

**QA-D1: Auto-finalization on JO complete**
- Tool: Wait for a JO to reach `selesai-pengiriman` status
- Steps: Query `tms_master_data WHERE jo_id = 'JO-XXXXX'`
- Expected: `status = 'completed'`, `finalized_at` not null
- Expected: `actual_distance_km > 0`, `total_duration_min > 0`
- Expected: `expires_at = finalized_at + 34 days`

**QA-D2: Per-leg metrics computed**
- Tool: Query `tms_master_data_stops WHERE jo_id = 'JO-XXXXX'`
- Expected: `leg_distance_km > 0` for stops after LOAD
- Expected: `dwell_time_min > 0` for stops with both arrival and departure
- Expected: `leg_temp_min/max/avg` populated

**QA-D3: Speed violations counted**
- Tool: Query finalized JO
- Expected: `speed_violation_count` reflects GPS points where speed > 80

### Phase E: CSV Export

**QA-E1: Summary export**
- Tool: `GET /api/tms/master-data/export?format=summary&from=2026-05-01&to=2026-05-01`
- Expected: Valid CSV with header row + data rows
- Expected: Column count matches spec (28 columns)

**QA-E2: Stops export**
- Tool: `GET /api/tms/master-data/export?format=stops&from=2026-05-01&to=2026-05-01`
- Expected: Valid CSV, rows = sum of all stop_counts for JOs in range
- Expected: Each row has valid `jo_id` that exists in summary

**QA-E3: Both export**
- Tool: `GET /api/tms/master-data/export?format=both&from=2026-05-01&to=2026-05-01`
- Expected: ZIP file or multipart with 2 CSVs

### Phase F: Auto-Delete + Warning

**QA-F1: Expiry warning shown**
- Tool: Browser → Master Data page (with data nearing expiry)
- Expected: Rows within 3 days of expiry show orange badge
- Expected: Banner appears if any rows expiring soon

**QA-F2: Auto-delete executes**
- Tool: Set `expires_at` to past timestamp for test row → wait for cleanup job (or trigger manually)
- Expected: Row deleted from `tms_master_data`
- Expected: Associated `tms_master_data_stops` rows deleted (CASCADE)
- Expected: Associated `tms_master_data_gps_points` rows deleted (CASCADE)
- Expected: Console log shows deletion count
