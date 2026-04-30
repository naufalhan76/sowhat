# OSRM ETA Calculation

## Overview

Trip Monitor menggunakan **OSRM (Open Source Routing Machine)** untuk menghitung ETA (Estimated Time of Arrival) real-time dari posisi unit ke stop berikutnya.

## Setup

**Tidak perlu setup apapun.** Sistem menggunakan public OSRM API:
```
https://router.project-osrm.org
```

API ini gratis dan tidak perlu API key.

## How It Works

### 1. Target Stop Selection

Sistem otomatis pilih target stop berdasarkan shipping status:

| Shipping Status | Target Stop |
|----------------|-------------|
| `otw-load` | First load stop |
| `sampai-load` | First unload stop |
| `menuju-unload` | First unload stop |
| `sampai-unload` | Next unload stop (after current) |
| `selesai` | No ETA (trip complete) |

Logic ada di `pickTripMonitorEtaTargetStop()` (server.js L4801-4818).

### 2. OSRM API Call

Request format:
```
GET https://router.project-osrm.org/route/v1/driving/{vehicleLng},{vehicleLat};{destLng},{destLat}?overview=false
```

Response:
```json
{
  "code": "Ok",
  "routes": [{
    "duration": 7200,      // seconds
    "distance": 120000     // meters
  }]
}
```

### 3. Caching

- **TTL**: 60 seconds
- **Cache key**: Rounded coordinates (3 decimal places = ~100m precision)
- **Max size**: 2000 entries (auto-evict oldest)

Ini untuk avoid spam OSRM API dan improve performance.

### 4. Status Determination

ETA status ditentukan dengan compare arrival time vs TMS ETA:

```javascript
const arrivalTime = Date.now() + durationSeconds * 1000;
const buffer = 30 * 60 * 1000; // 30 min buffer

if (arrivalTime <= tmsEta) {
  status = 'on-time';        // Green
} else if (arrivalTime <= tmsEta + buffer) {
  status = 'at-risk';        // Yellow
} else {
  status = 'late';           // Red
}
```

## Integration Points

### Backend (server.js)

**Function**: `calculateTripMonitorEta(fleetRow, shippingStatus, snapshot)`

Called from:
- `GET /api/tms/board` - Board list refresh (L10649-10680)
- `GET /api/tms/board/detail` - Detail modal refresh

**Concurrency**: Max 5 parallel OSRM calls via `mapWithConcurrency()` (L4890-4902)

### Frontend

**Display locations**:
1. **Kanban card** (`TripMonitorUnitCard.jsx`):
   - ETA chip: `~2h 15m (120km)`
   - Color-coded by status

2. **Detail modal header** (`TripMonitorDetailHeader.jsx` L166-193):
   - Same format as card
   - Shows target stop name

**Data structure**:
```javascript
{
  durationSeconds: 7200,
  distanceMeters: 120000,
  status: 'on-time' | 'at-risk' | 'late' | 'neutral',
  stopName: 'PT. Customer Warehouse',
  stopType: 'unload'
}
```

## Error Handling

- **OSRM timeout**: 2.5 seconds → return `null`
- **OSRM unavailable**: Silently return `null` (no error thrown)
- **Invalid coordinates**: Return `null`
- **No target stop**: Return `null`

Frontend gracefully handles `null` ETA (chip tidak muncul).

## Performance

- **Cache hit rate**: ~80% (typical)
- **OSRM response time**: 200-500ms (typical)
- **Timeout**: 2.5s (safety)
- **Concurrency limit**: 5 parallel calls

## Self-Hosted OSRM (Optional)

Kalau mau self-host OSRM (untuk production atau rate limit):

1. Install OSRM backend:
   ```bash
   docker run -t -i -p 5000:5000 -v "${PWD}:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/indonesia-latest.osrm
   ```

2. Update `OSRM_BASE_URL` di server.js:
   ```javascript
   const OSRM_BASE_URL = 'http://localhost:5000';
   ```

3. Download Indonesia map data:
   ```bash
   wget http://download.geofabrik.de/asia/indonesia-latest.osm.pbf
   osrm-extract -p /opt/car.lua indonesia-latest.osm.pbf
   osrm-partition indonesia-latest.osrm
   osrm-customize indonesia-latest.osrm
   ```

Docs: https://github.com/Project-OSRM/osrm-backend

## Troubleshooting

### ETA tidak muncul di UI

Check:
1. Unit punya `latitude` & `longitude` di fleet data?
2. Stop punya `latitude` & `longitude` di TMS?
3. Shipping status bukan `selesai`?
4. Browser console ada error?

### ETA selalu `neutral` (abu-abu)

Artinya TMS tidak provide ETA target di stop data. Status hanya bisa `on-time`/`at-risk`/`late` kalau TMS punya `eta` field di stop.

### OSRM timeout

Public OSRM API kadang slow. Kalau sering timeout, consider self-host.

## Monitoring

Check ETA calculation di server logs:
```bash
# Count ETA calculations
grep "calculateTripMonitorEta" server.log | wc -l

# Check cache hit rate
grep "ETA cache hit" server.log | wc -l
```

(Note: Logging belum implemented - add kalau perlu monitoring)
