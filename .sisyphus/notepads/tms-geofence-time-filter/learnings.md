## 2026-05-04
- `computeGeofenceCutoffMs(snapshot, now)` should prefer `snapshot.etaOrigin`, then fall back to `parseSolofleetDateInputStart(snapshot.day)`.
- `parseSolofleetDateInputStart()` already applies the WIB offset, so no extra timezone handling is needed in the new helper.
- Clamp future cutoffs to `now` to avoid widening the geofence window when ETA is ahead of current time.
- `buildTripMonitorStopProgress()` should compute `geofenceCutoffMs` immediately after `buildRealtimeRecordSeries()` and only pass `filteredRecords` into historical geofence visit extraction; live GPS and workflow fallback paths stay unfiltered.
- Stale `geoMemory[index]` timestamps must be invalidated at the start of the `stops.map()` loop before memory reads, deleting only `arrivedAt`/`arrivedSource` or `departedAt`/`departedSource` when the timestamp is older than `geofenceCutoffMs`.
- Preserve `unitState.tmsGeofence` entries for non-headline job IDs; headline JO can change between polls, and deleting other keys breaks multi-JO geofence memory isolation.
- `computeGeofenceCutoffMs()` should defensively fall back to `now - 2h` when both `etaOrigin` and parsed `day` fail or produce a non-finite cutoff, before clamping future cutoffs.
