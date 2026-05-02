# Plan: Shipping Status Detection Revamp + Temp Override Fix

## Overview

Two critical fixes for Trip Monitor:
1. **Temp Range Override bug** — override saves to DB but UI reverts to old values
2. **Shipping Status Detection** — uses entire day's GPS data causing false arrivals; needs ETA-windowed detection + per-stop arrival visibility

---

## Bug 1: Temp Range Override Not Persisting in UI

### Root Cause (confirmed by Oracle analysis)

The bug is **frontend state sync**, not backend persistence.

Flow:
1. User edits temp to `2.0 / 4.0`, clicks Save
2. `handleSaveTempRange()` POSTs to API → 200 OK
3. Sets `overridden=true`, `editMode=false`
4. Calls `onRefetchDetail?.()` → triggers detail API fetch
5. **BUT**: `useEffect` at line 45-51 fires because `editMode` changed to `false`
6. `useEffect` reads `normalizedJobTempRange` which is STILL the old props (refetch hasn't completed yet)
7. `setMinValue(oldMin)`, `setMaxValue(oldMax)` → **reverts the display**
8. When refetch completes, `headlineJob` updates, `useEffect` fires AGAIN with correct server data
9. But `overridden=true` means UI renders `minValue/maxValue` (which were already reverted in step 7)

Additional issues:
- `overridden` and `originalTmsValue` are unkeyed local state — survive headline JO changes
- `onRefetchDetail` is not wired in `TripMonitorFloatingPanel` → refetch may not happen at all
- Backend destructively applies override into `tempMin/tempMax` — no way to distinguish "original TMS value" vs "overridden value" from server response

### Fix Plan

#### F1: Track pending override with JO key
```js
const [pendingOverride, setPendingOverride] = useState(null);
// { joId: 'JO-29884', min: 2.0, max: 4.0, originalMin: -20, originalMax: -18 }
```

#### F2: After save, set pending override optimistically
```js
const handleSaveTempRange = async () => {
  // ... POST to API ...
  setPendingOverride({
    joId: headlineJob.jobOrderId,
    min: Number(minValue),
    max: Number(maxValue),
    originalMin: normalizedJobTempRange?.min,
    originalMax: normalizedJobTempRange?.max,
  });
  setEditMode(false);
  onRefetchDetail?.();
};
```

#### F3: Display logic uses pending override
```js
const isOverridden = pendingOverride?.joId === headlineJob?.jobOrderId;
const displayMin = isOverridden ? pendingOverride.min : normalizedJobTempRange?.min;
const displayMax = isOverridden ? pendingOverride.max : normalizedJobTempRange?.max;
const originalTms = isOverridden ? { min: pendingOverride.originalMin, max: pendingOverride.originalMax } : null;
```

#### F4: useEffect should NOT overwrite when pending override exists
```js
React.useEffect(() => {
  if (!editMode && headlineJob && !pendingOverride) {
    setMinValue(normalizedJobTempRange?.min ?? '');
    setMaxValue(normalizedJobTempRange?.max ?? '');
  }
}, [headlineJob, normalizedJobTempRange, editMode, pendingOverride]);
```

#### F5: Wire onRefetchDetail in TripMonitorFloatingPanel
Ensure the detail refetch callback is passed down so the panel actually re-fetches after override save.

#### F6: Backend — preserve original TMS temp in metadata
In `refreshTripMonitorStoredRow`, when override is applied, store original values:
```js
if (overrideRow.temp_range_override) {
  snapshot._originalTempMin = snapshot.tempMin;
  snapshot._originalTempMax = snapshot.tempMax;
  snapshot.tempMin = overrideRow.temp_range_override.tempMin;
  snapshot.tempMax = overrideRow.temp_range_override.tempMax;
}
```
Frontend can then read `headlineJob._originalTempMin` to show strikethrough values from server (not local state).

---

## Bug 2: Shipping Status Detection Revamp

### Root Cause (confirmed by Oracle analysis)

`buildRealtimeRecordSeries()` (server.js:2936) returns ALL `unitState.records` up to `now`. Records can span up to 7 days (retention). `extractGeofenceVisitStats()` scans ALL these records and returns `firstInside` from the earliest matching point.

**Result**: If a truck passes near a stop location in the morning (different trip), that morning timestamp becomes the "arrival" for the afternoon delivery.

Additional issues:
- `TRIP_MONITOR_STATUS_RADIUS_METERS = 1000` (1km!) — very wide, increases false positives
- `unitState.tmsGeofence` memory caches bad arrivals and persists them across refreshes
- Multi-unload stops collapsed into single `sampai-unload` step — no per-stop visibility
- Frontend only sees coarse shipping steps, not individual stop arrival times

### Resolved Decisions (from Metis consultation)
- **Window strategy**: Single anchor point — `etaLoad - 2 hours`. ALL GPS records before this cutoff are ignored for ALL stops (load + unloads). Not per-stop windowing.
- **Null ETA fallback**: Use JO start time (`snapshot.etaOrigin` or `startTimestamp`) as anchor
- **Geofence radius**: Keep 1000m (no change)
- **Corrupted data**: Reset ALL `geofence_arrival_at` to NULL in `tms_master_data_stops` so they re-detect with new logic
- **TMS workflow fallback**: ETA window does NOT apply to TMS workflow-based arrivals (driver swipe confirmations). Only applies to geofence GPS detection.

### Fix Plan

#### S1: ETA-windowed record filtering
In `buildTripMonitorStopProgress()`, compute a single window start from the LOAD stop's ETA, then filter records ONCE before the stop loop:

```js
const loadStop = stops.find(s => s.taskType === 'load') || stops[0];
const etaLoadMs = loadStop?.eta || snapshot.etaOrigin || snapshot.startTimestamp || null;
const windowStart = etaLoadMs ? etaLoadMs - (2 * 60 * 60 * 1000) : null;
const windowedRecords = windowStart
  ? records.filter(r => r.timestamp >= windowStart)
  : records; // fallback: use all records if no ETA at all

// Then use windowedRecords for ALL geofence detection in the stop loop
for (const stop of stops) {
  const geofenceStats = extractGeofenceVisitStats(windowedRecords, stop, radius);
  // ... rest of logic
}
```

Do NOT modify `buildRealtimeRecordSeries()` globally — other callers depend on full records.
Do NOT apply window to TMS workflow fallback detection (lines 4584-4596) — those are human-confirmed.

#### S2: Invalidate stale geofence memory
Clear `unitState.tmsGeofence[jobId][stopIndex]` if the cached `arrivedAt` is earlier than the window start. This prevents old bad arrivals from persisting.

```js
const cached = unitState.tmsGeofence?.[jobId]?.[stopIndex];
if (cached?.arrivedAt && windowStart && cached.arrivedAt < windowStart) {
  delete unitState.tmsGeofence[jobId][stopIndex]; // force re-detection
}
```

#### S3: Expose per-stop progress in shippingStatus
Add `stopProgress` array to the return value of `buildTripMonitorShippingStatus()`:

```js
return {
  key: currentKey,
  label: ...,
  changedAt: ...,
  steps: [...],
  stopProgress: progress.map(entry => ({
    stopIdx: entry.stop.idx,
    taskType: entry.stop.taskType,
    label: entry.stop.label,
    name: entry.stop.name,
    address: entry.stop.taskAddress,
    eta: entry.stop.eta,
    arrivedAt: entry.arrivedAt,
    arrivedSource: entry.arrivedSource,
    departedAt: entry.departedAt,
    departedSource: entry.departedSource,
    distanceMeters: entry.distanceMeters,
    isCurrentStop: entry.isCurrentStop,
    insideRadius: entry.insideRadius,
  })),
};
```

#### S4: Attach per-stop arrivals to shipping steps
Enrich existing `steps` array with stop-level data:

```js
steps: [
  {
    key: 'sampai-load',
    changedAt: loadStop?.arrivedAt,
    stops: [{ label: 'LOAD', address: '...', arrivedAt: '07:15', ... }],
  },
  {
    key: 'sampai-unload',
    changedAt: lastUnloadArrived?.arrivedAt,
    stops: [
      { label: 'U1', address: '...', arrivedAt: '09:30', ... },
      { label: 'U2', address: '...', arrivedAt: '11:45', ... },
    ],
  },
]
```

#### S5: Frontend — show per-stop arrival times
In `TripMonitorShippingProgressClean`, render each stop's arrival time:

```
OTW LOAD
  ↓
SAMPAI LOAD — 07:15
  ↓
MENUJU UNLOAD
  ↓
SAMPAI UNLOAD
  ├─ U1 (Klender) — 09:30
  ├─ U2 (Caman) — 11:45
  └─ U3 (Duren Sawit) — arrived
  ↓
SELESAI BONGKAR
```

#### S6: Fix master-data geofence path
The master-data populate loop (server.js:6574) also uses `extractGeofenceVisitStats` with unwindowed records. Apply same ETA-windowed filtering there. Also fix the `COALESCE(geofence_arrival_at, $1)` pattern — it preserves old bad arrivals. Change to unconditional update when new detection is more recent.

#### S7: Data migration — reset corrupted geofence arrivals
Run a one-time migration to reset all `geofence_arrival_at` and `geofence_departure_at` to NULL in `tms_master_data_stops`:

```sql
UPDATE tms_master_data_stops SET geofence_arrival_at = NULL, geofence_departure_at = NULL, dwell_time_min = NULL, ata_geofence = NULL, on_time = NULL;
```

Also clear all `unitState.tmsGeofence` in-memory caches on server restart (or add a one-time flag).
This ensures all stops re-detect with the new ETA-windowed logic.

#### S8: Metis warnings to address
- Do NOT modify `buildRealtimeRecordSeries()` globally (other callers depend on full records)
- Do NOT apply ETA window to TMS workflow fallback (lines 4584-4596, human-confirmed arrivals)
- Be aware that `evaluateTripMonitorTemperatureGate()` (line 4973) calls `buildTripMonitorStopProgress()` — temperature monitoring behavior may change as a side effect
- `geoMemory` invalidation (S2) must preserve `departedAt` and `source` fields, only clear `arrivedAt` if it's before window start

---

## Implementation Phases

### Phase 1: Temp Override Fix (F1-F6)
**Files**: `TripMonitorDetailMapSection.jsx`, `TripMonitorFloatingPanel.jsx`, `server.js`
**Effort**: 1-2 hours
**Priority**: High (user-facing bug)

### Phase 2: ETA-Windowed Detection + Memory Invalidation (S1-S2)
**Files**: `server.js` — `buildTripMonitorStopProgress()`
**Effort**: 1-2 hours
**Priority**: High (core accuracy fix)
**WARNING**: Do NOT touch `buildRealtimeRecordSeries()`. Do NOT apply window to TMS workflow fallback.

### Phase 3: Per-Stop Progress Data (S3-S4)
**Files**: `server.js` — `buildTripMonitorShippingStatus()`
**Effort**: 1-2 hours
**Priority**: Medium (data structure change)

### Phase 4: Frontend Per-Stop Visibility (S5)
**Files**: `TripMonitorShippingProgressClean`, `TripMonitorDetailModal.jsx`
**Effort**: 2-3 hours
**Priority**: Medium (UI enhancement)

### Phase 5: Master Data Fix + Data Migration (S6-S7-S8)
**Files**: `server.js` — sync loop + migration
**Effort**: 1 hour
**Priority**: High (must run after Phase 2 to re-detect with correct logic)
**Includes**: Reset all geofence_arrival_at to NULL, apply ETA window to master-data path

---

## QA Scenarios

### Temp Override
- QA-F1: Edit temp range → Save → values persist after refetch
- QA-F2: Edit temp range → close modal → reopen → override badge shows with correct values
- QA-F3: Reset override → values revert to TMS original
- QA-F4: Multiple JOs on same plate → override applies to correct JO only

### Shipping Status
- QA-S1: Truck passes near stop in morning (different trip) → NOT detected as arrival for afternoon JO
- QA-S2: Truck arrives at load within 2h of ETA → correctly detected
- QA-S3: Multi-unload JO → each unload stop shows individual arrival time
- QA-S4: Frontend shipping progress shows per-stop timestamps
- QA-S5: Master data geofence_arrival_at reflects ETA-windowed detection
