## 2026-05-04
- `computeGeofenceCutoffMs(snapshot, now)` should prefer `snapshot.etaOrigin`, then fall back to `parseSolofleetDateInputStart(snapshot.day)`.
- `parseSolofleetDateInputStart()` already applies the WIB offset, so no extra timezone handling is needed in the new helper.
- Clamp future cutoffs to `now` to avoid widening the geofence window when ETA is ahead of current time.
- `buildTripMonitorStopProgress()` should compute `geofenceCutoffMs` immediately after `buildRealtimeRecordSeries()` and only pass `filteredRecords` into historical geofence visit extraction; live GPS and workflow fallback paths stay unfiltered.
