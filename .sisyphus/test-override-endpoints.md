# Override API Endpoints Test Plan

## Endpoints Implemented

### 1. GET /api/tms/overrides/:jobOrderId
- **Auth**: requireAdminSession
- **Returns**: Override row or 404 if not found
- **Query**: `SELECT * FROM tms_jo_overrides WHERE job_order_id = $1`

### 2. POST /api/tms/overrides/:jobOrderId
- **Auth**: requireAdminSession + requireTrustedApiMutation
- **Body**: `{ stops, tempRange, forceClose, reason, notes }`
- **Logic**:
  - Fetch existing override for audit comparison
  - Build dynamic upsert query based on provided fields
  - Insert/update override row
  - Log audit entries for changed fields (stops, tempRange, forceClose, notes)
- **Returns**: Updated override row

### 3. DELETE /api/tms/overrides/:jobOrderId
- **Auth**: requireAdminSession + requireTrustedApiMutation
- **Logic**:
  - Fetch existing override (404 if not found)
  - Delete override row
  - Log audit entry with old values
- **Returns**: `{ ok: true, success: true }`

### 4. GET /api/tms/overrides/:jobOrderId/audit
- **Auth**: requireAdminSession
- **Returns**: Audit trail sorted by performed_at DESC
- **Query**: `SELECT * FROM tms_jo_override_audit WHERE job_order_id = $1 ORDER BY performed_at DESC`

## Route Ordering
Routes are ordered correctly:
1. `/audit` endpoint first (most specific)
2. GET endpoint second
3. POST endpoint third
4. DELETE endpoint fourth

This prevents `/audit` from being matched by the generic GET handler.

## Test Commands (when server is running)

```powershell
# Test GET (should return 401 without auth)
Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/tms/overrides/TEST-JO-001" -Method GET

# Test POST (should return 401 without auth)
Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/tms/overrides/TEST-JO-001" -Method POST -Body '{"stops":[]}' -ContentType "application/json"

# Test DELETE (should return 401 without auth)
Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/tms/overrides/TEST-JO-001" -Method DELETE

# Test audit trail (should return 401 without auth)
Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/tms/overrides/TEST-JO-001/audit" -Method GET
```

## Verification Checklist
- [x] All 4 endpoints implemented
- [x] Admin authentication required on all endpoints
- [x] Mutation protection on POST/DELETE
- [x] GET returns 404 if override not found
- [x] POST upserts with partial update support
- [x] POST logs audit entries for changed fields
- [x] DELETE logs audit entry with old values
- [x] Audit endpoint returns sorted trail
- [x] Route ordering prevents conflicts
- [x] Error handling with try-catch
- [x] LSP diagnostics clean
