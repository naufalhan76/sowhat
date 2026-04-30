# Issues — Trip Monitor Revamp

## [2026-04-30T07:08] Pre-Implementation

### Blockers
- None yet

### Risks
1. **Plan has no checkboxes** — need to convert design spec to executable task list
2. **Large scope** — 7 phases, 1290-line spec, risk of scope creep
3. **Three pipeline injection points** — must apply overrides consistently across all paths
4. **OSRM rate limits** — public instance ~1 req/s, may need self-hosted if >30 active units
5. **No existing override system** — greenfield implementation, no reference code

### Gotchas (from plan)
- `snapshot.stops` checked FIRST by `getTripMonitorSnapshotStops()` (L4391), then falls back to `snapshot.taskList`
- Override must be applied BEFORE `chooseHeadlineSnapshot()` call (severity scoring needs corrected data)
- `metadata.jobOrders` in `refreshTripMonitorStoredRow` uses cached snapshots, NOT DB — must apply override there too
- Force-closed JO stays in `activeItems` filter (correct behavior, `isClosed` check in `buildTripMonitorShippingStatus` handles status change)
- Override save must trigger immediate row recompute via `refreshTripMonitorStoredRow()` + `upsertTmsMonitorRows()`
