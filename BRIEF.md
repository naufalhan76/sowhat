# Sowhat — Product Brief

## What Is This?

Sowhat is an **internal operations dashboard for cold-chain logistics**. It monitors a fleet of refrigerated trucks in real-time, tracking their GPS positions, temperature sensor readings, delivery compliance, and operational health. The system pulls live telemetry data from Solofleet (a third-party GPS/temperature hardware platform) and integrates with CargoShare TMS (a transport management system) to cross-reference delivery schedules against actual truck movements.

In simple terms: a company operates dozens of refrigerated trucks delivering temperature-sensitive goods (frozen food, dairy, pharmaceuticals). Sowhat is the control room software that lets operations staff see where every truck is, whether its refrigeration is working, whether it's on schedule, and whether anything has gone wrong — all from one screen.

---

## Who Uses It?

- **Fleet operations analysts** — monitor trucks during shifts, watch for temperature excursions, GPS anomalies, and delivery delays in real-time.
- **Management supervisors** — review daily rollups, warehouse KPIs, incident trends, and compliance reports to make staffing and routing decisions.
- Both groups work on desktop monitors in office or warehouse control rooms, occasionally checking status on tablets.

---

## Core Problem It Solves

Before Sowhat, operations staff had to:
1. Log into Solofleet manually to check each truck one by one.
2. Copy data into spreadsheets to compile daily temperature incident reports.
3. Cross-reference delivery schedules from TMS against GPS data manually.
4. Manually track which trucks had temperature errors, how long they lasted, and which warehouses had compliance issues.

Sowhat automates all of this. It polls Solofleet every 60 seconds, aggregates the data, detects temperature incidents automatically, cross-references with TMS delivery schedules, and presents everything in organized views. The result: fewer missed temperature excursions, faster incident response, and reliable daily reporting without manual data pulls.

---

## Technical Architecture

- **Frontend**: React 19 single-page application, built with Vite, styled with Tailwind CSS v4 + custom CSS. No component library — all UI primitives are custom-built.
- **Backend**: Node.js Express server that acts as a proxy/aggregator. It polls Solofleet APIs, stores state locally (JSON files) or in PostgreSQL, and serves the frontend.
- **Data sources**: Solofleet GPS/temperature API (polled), CargoShare TMS API (synced), local configuration.
- **Deployment**: Runs locally or on a VPS. Single `npm start` command runs both backend and frontend dev server.
- **Authentication**: Web-based login (username/password) with session management. Solofleet credentials are stored separately for API access.

---

## Pages & Features

### 1. Login Page

**What it is:** Split-screen authentication page. Left side shows the Sowhat brand with topographic SVG background and operational stats. Right side has the login form.

**Features:**
- Username/password authentication
- Dark/light theme toggle
- Error state with shake animation on failed login
- Loading state with spinner during workspace initialization
- Responsive: stacks vertically on mobile

---

### 2. Overview (Default Landing Page)

**What it is:** The "is everything OK right now?" dashboard. A single-glance operational summary showing fleet health, temperature incidents, and warehouse compliance KPIs.

**Features:**
- **KPI strip** — 4 metric cards showing: total configured units, temperature error rate (%), moving rate (%), idle rate (%). Each card shows the count and percentage for the selected account.
- **Temperature incident trend chart** — line chart showing daily temperature incidents over the selected date range. Below it: summary metrics (total incidents, affected units, total duration, longest incident).
- **Fleet composition donut** — interactive donut chart showing the breakdown of fleet status (moving, idle, temp error, no live data). Hover segments to see counts and percentages. Legend alongside.
- **Astro KPI per Warehouse** — 4 warehouse cards (BGO, CBN, PGS, SRG) each showing multi-line trend charts for WH Arrival Time compliance, WH Temperature Pass rate, and POD Arrival Time compliance. Cards load sequentially with shimmer loading animation.
- **Account selector** — dropdown to switch between different Solofleet accounts (for companies managing multiple fleets).

---

### 3. Fleet

**What it is:** The "where is each truck and what's its status?" panel. A split-view showing a scrollable list of all trucks on the left and detailed information for the selected truck on the right.

**Features:**
- **Unit list (left panel)**:
  - Search by plate number, unit ID, or location
  - Filter by account and unit category (OnCall, Dedicated Astro, Dedicated HAVI)
  - Quick filter pills: All, Temp Error, Moving, Idle, GPS Late, etc. with live counts
  - Each row shows: plate number, location, status tags (geofence status, Astro status, health status), temperature readings (T1/T2) with fault highlighting, speed for moving units
  - Color-coded left accent bar: red for danger, amber for warning, emerald for active selection
  - Export fleet data as CSV

- **Unit detail (right panel)**:
  - Header with unit name, account, location, status badge, and action chips (category, customer, geofence status, last update time)
  - Action buttons: Open in Google Maps, view Temp Errors, view Historical data
  - Metrics strip: Temp 1, Temp 2, Gap, Speed, Trip km, Setpoint range, GPS status
  - **Live map** (Leaflet/OpenStreetMap): shows the truck's route with polyline, current position marker, and stop markers. Route toggle button. Draggable/zoomable.
  - **Temperature chart**: SVG line chart showing Temp 1 and Temp 2 over time with threshold bands (from TMS if available). Hover crosshair with tooltip showing exact values. Zoom controls.
  - **Resizable split**: map and chart panes separated by a draggable handle. Split ratio persisted to localStorage.

---

### 4. Trips (Trip Monitor)

**What it is:** Exception-based monitoring board for trucks with active delivery jobs from TMS. Shows which deliveries have issues and what kind.

**Features:**
- **Severity kanban board** — 3-column layout (Critical / Warning / Normal) showing delivery cards sorted by severity. Each card shows: plate number, customer, origin/destination, incident badges, shipping status, driver name, temperature range.
- **Filter toolbar**: filter by severity, customer, incident type, and free-text search.
- **Incident types tracked**: GPS error, temp error, temp out of range, late load, late destination, long stop, geofence miss (origin/destination).
- **Floating detail panels** — click a card to open a draggable, resizable floating panel showing:
  - Full delivery details (job order ID, origin, destination, ETA, driver assignments)
  - Route map with stop markers
  - Temperature chart with TMS threshold bands
  - Incident history timeline (active/resolved incidents with timestamps and locations)
  - Actions: open in Fleet view, open in Map, open Historical
- **TMS sync**: manual sync button + auto-sync on configurable interval.

---

### 5. Map

**What it is:** Full-fleet map view showing all trucks plotted on an OpenStreetMap tile layer.

**Features:**
- All trucks plotted with color-coded truck icons (red = temp error, orange = single temp error, yellow = GPS late, green = moving, gray = stopped)
- Truck labels showing plate numbers
- Click popup with: unit ID, account, status, location, temperatures, speed
- Filter by account
- Search by plate number
- Legend showing icon color meanings
- Region grouping (Jabodetabek, Jawa Barat, Jawa Tengah, Jawa Timur, Jogja, Bali, Sumatera, etc.)

---

### 6. Astro Report

**What it is:** Delivery compliance report for Astro (a specific customer). Evaluates whether trucks arrived at warehouses and POD locations on time and at correct temperatures.

**Features:**
- **Report generator**: select date range, account, specific route (plate number), and view mode (with/without KPI scoring).
- **KPI summary**: eligible rit count, overall pass rate, WH on-time rate, WH temp pass rate, POD on-time rate.
- **Rit summary table**: one row per delivery trip showing service date, plate number, warehouse arrival time/temp, POD arrival times, pass/fail status for each checkpoint.
- **Diagnostics modal**: shows dates with incomplete data and which requirements weren't met.
- Export as CSV.

---

### 7. Temp Errors

**What it is:** The "what went wrong today?" panel. Lists all temperature sensor incidents across the fleet.

**Features:**
- **Error overview metrics**: total incidents, affected units, critical alerts (both sensors failed), total error duration.
- **Incident table**: each row = one unit per day. Shows: date, start/end time, duration, account, plate number, severity (single sensor vs both), temperature ranges, speed range. Click a row to see its chart.
- **Daily compile table**: aggregated view — one row per day showing error unit counts, incident counts, total/longest duration.
- **Selected unit chart**: temperature trend chart for the clicked incident row.
- Export as CSV.

---

### 8. Stop / Idle Explorer

**What it is:** Analyzes when and where trucks stopped or idled, using Solofleet's stop/idle report API.

**Features:**
- **Query form**: select unit, report type (Stop Engine / Idle Engine / Speed-based), minimum duration filter.
- **Results table**: start time, end time, duration, distance, average temperature, location, coordinates, zone, engine status (idle vs stop), Google Maps link.
- **Summary metrics**: total rows, total minutes, longest stop, stops with coordinates.
- Export as CSV.

---

### 9. API Monitor

**What it is:** Internal debugging tool showing all API calls the backend makes to Solofleet.

**Features:**
- **Traffic summary**: total requests, errors, slow requests, unique endpoints.
- **Endpoint summary table**: per-endpoint hit count, error count, average duration, last status code, last error.
- **Recent requests table**: timestamp, method, path, HTTP status, duration, error message.

---

### 10. Config (Admin Only)

**What it is:** System configuration panel for managing Solofleet accounts, unit settings, geofence locations, and delivery routes.

**Features:**
- **Multi-account management**: add/remove Solofleet accounts, login with email/password, discover units automatically, switch active account.
- **Unit category mapping**: assign categories (OnCall, Dedicated Astro, Dedicated HAVI) to units. Bulk assignment, CSV import/export.
- **Geofence locations (Astro)**: manage warehouse (WH), POD, Pool, POL, Rest Area, and Pelabuhan locations with coordinates and radius. CSV import/export. Scope to specific accounts or customers.
- **Astro route configuration**: define delivery routes with warehouse, pool, POD sequence (up to 5 PODs), rit schedules (Rit 1 and Rit 2 with time windows), arrival time SLAs per stop, temperature SLAs. CSV import/export.
- **TMS integration**: configure CargoShare TMS connection (URL, credentials), auto-sync interval, geofence radius, long-stop threshold.
- **Remote reset automation**: enable/disable automatic session reset for selected accounts.
- **Polling settings**: poll interval, request lookback window, history retention, temperature profile, archive type.

---

### 11. Admin (Admin Only)

**What it is:** System administration panel for managing web users and database operations.

**Features:**
- **User management**: create/edit/delete web dashboard users. Set username, display name, password, role (admin/viewer), active status.
- **Database tools**: view storage provider (local JSON vs PostgreSQL), browse temperature rollup records and POD snapshot records, create/edit/delete individual records.
- **Astro snapshot console**: view sync logs, trigger manual snapshot sync, toggle auto-sync.
- **TMS sync console**: view TMS sync logs, trigger manual sync.

---

### 12. Historical

**What it is:** Deep-dive into a specific unit's temperature and location history over a custom date range.

**Features:**
- **Unit selector**: searchable dropdown of all fleet units with search filtering.
- **Date range picker**: independent from the global topbar range. "Tarik data" button to fetch.
- **Unit summary**: selected unit's current status, account, location, category.
- **Temperature chart**: full-width SVG chart with Temp 1 and Temp 2 lines, threshold bands, hover crosshair, zoom controls.
- **Route map**: shows the unit's path over the selected period with stop markers.
- **Geofence events table**: shows when the unit entered/exited configured geofence zones.
- **Trip metrics**: distance traveled, moving time, stopped time.
- Export history as CSV.

---

### 13. POD (Proof of Delivery)

**What it is:** Automated capture log of when trucks arrive at POD (Point of Delivery) locations.

**Features:**
- **POD capture table**: each row = one POD visit. Shows: date, time, account, unit, customer, POD name, distance to POD center, speed at arrival, location.
- POD locations are configured in the Config panel with coordinates and radius.
- Captures are triggered automatically when a unit enters a POD radius at low speed.
- Export as CSV.

---

## Global UI Components

### Navigation Sidebar (NavRail)
- Collapsible sidebar with brand logo, navigation sections (Workspace, Reports, System), user profile with avatar, theme toggle, sign out.
- Dock-style icon scaling on hover. Active page indicated by emerald left rail.
- Collapses to icon-only mode. Off-canvas drawer on mobile (<960px).

### Command Bar (Topbar)
- Page title, global search (Ctrl+K), date range picker, action buttons (refresh, export, polling controls, poll now).
- Centered search with keyboard shortcut hint.

### Command Palette
- Ctrl+K opens a searchable command palette with quick actions: navigate to any panel, poll now, refresh, export data.

### Status Footer
- Bottom strip showing: polling status (on/off), next poll time, last sync time, error messages.

### Toast Notifications
- Bottom-right toast messages for success/error/info events. Auto-dismiss. Retry button on errors.

### Theme Support
- Full dark mode (default) and light mode. Toggle in sidebar. Persisted to localStorage.

---

## Data Flow Summary

1. **Solofleet polling**: Backend polls Solofleet API every 60s (configurable) for each configured account. Fetches vehicle positions, temperatures, speed, GPS status.
2. **TMS sync**: Backend syncs with CargoShare TMS every 15min (configurable) to fetch active delivery jobs, job orders, driver assignments, and geofence data.
3. **Incident detection**: Backend automatically detects temperature excursions by comparing sensor readings against configured thresholds and TMS job order ranges.
4. **Astro KPI scoring**: Backend evaluates delivery compliance by checking warehouse arrival times/temperatures and POD arrival times against configured SLAs.
5. **Frontend polling**: Frontend refreshes dashboard data every 15s via `/api/status`, `/api/report`, and `/api/monitor` endpoints.
6. **Storage**: Configuration and state stored in local JSON files (`data/config.json`, `data/state.json`) or PostgreSQL database.

---

## Key Integrations

| System | Purpose | Method |
|--------|---------|--------|
| Solofleet | GPS positions, temperature readings, vehicle data, stop/idle reports | HTTP API polling (session cookie auth) |
| CargoShare TMS | Delivery jobs, job orders, driver assignments, shipping status | HTTP API sync (username/password auth) |
| OpenStreetMap | Map tiles for fleet and route visualization | Leaflet.js tile layer |
| Google Maps | External link for opening truck locations | URL redirect |

---

## API Endpoints (46 total)

The backend exposes 46 API endpoints. All are served from a single `server.js` file using a custom `http.createServer` handler (no Express).

| Category | Count | Auth Required | Examples |
|----------|-------|---------------|----------|
| Public | 1 | None | `GET /api/status` |
| Web Auth | 2 | Trusted mutation | `POST /api/web-auth/login`, `POST /api/web-auth/logout` |
| Dashboard Data | 6 | Web session | `/api/report`, `/api/monitor`, `/api/unit-detail`, `/api/unit-history`, `/api/report/pod`, `/api/report/stop` |
| Fleet/Polling | 3 | Admin session | `/api/poll/run`, `/api/poll/start`, `/api/poll/stop` |
| Solofleet Auth | 2 | Admin session | `/api/auth/login`, `/api/auth/logout` |
| Config | 3 | Admin session | `/api/config` (GET/POST), `/api/discover/units` |
| TMS | 10 | Mixed | Board, sync, config, auth, incidents, comments |
| Astro | 8 | Mixed | Config, locations, routes, report, snapshots |
| Admin | 7 | Admin session | Users CRUD, DB tools, remote reset |

## Background Jobs

| Job | Interval | Trigger |
|-----|----------|---------|
| Fleet polling | 60s (configurable) | Auto-start or manual |
| TMS sync | 15min (configurable) | Auto or manual |
| Astro snapshot | 3 hours | When polling active |
| Remote reset | Per-cycle | When enabled for selected accounts |
| Dashboard refresh | 15s | Frontend auto-poll |

## Security

- Web login required to access any dashboard functionality.
- Solofleet credentials stored server-side, never exposed to frontend.
- Rate limiting on login attempts (stored in DB or JSON).
- Session-based authentication with configurable secret.
- Admin role required for Config and Admin panels.
- Trusted mutation check on all POST/PUT/DELETE requests.
- All non-API routes serve the SPA with security headers (CSP, X-Frame-Options, etc.).
