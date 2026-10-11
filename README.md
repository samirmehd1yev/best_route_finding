# Baku Bus Route Planner

A self-contained web application for finding optimal public bus routes across Baku, Azerbaijan. Built with Next.js, Leaflet maps, a custom multi-objective routing engine, and a **local SQLite database** — no external services required.

## Features

- **Interactive Map** — Browse all 3,400+ bus stops on an OpenStreetMap-based map
- **Smart Route Finding** — Computes the optimal route between any two stops with a balanced multi-objective algorithm
- **Walking Transfers** — Suggests short walks (up to 300 m) between nearby stops to find better routes
- **Transfer Detection** — Color-coded segments mark every bus change
- **Geolocation** — Detect your location and find the nearest bus stop
- **Mobile-Responsive** — Tab-based layout (Search / Map) optimized for touch devices
- **Zero external dependencies** — Data lives in a single SQLite file checked out (or built) alongside the source

## Screenshots

### 1. Landing — every stop in Baku at a glance
![Landing page](screenshots/landing%20page.png)

On first load the app fetches every stop from `GET /api/stops` (3,456
rows ≈ 200 KB) and renders them as small CircleMarkers across the
city. The sidebar shows the empty journey form, a "Use My Location"
button, and a freshness indicator backed by `GET /api/data-status`
(`MAX(created_at)` from `buses`). The Find Route button stays
disabled until both From and To are populated.

### 2. Geolocation — the app picks your nearest stop
![Geolocation snap](screenshots/detection%20of%20my%20location.png)

Clicking **Use My Location** triggers the browser Geolocation API.
The blue marker is your raw GPS fix; the green marker is the
**nearest bus stop** chosen by `findNearbyStops()` ranking via the
**haversine** great-circle distance over the in-memory stop list.
The "From" field auto-fills with that stop ("42 saylı uşaq bağçası"
here), and the success banner stays for 2 s. From here you only
need to pick a destination.

### 3. Result — a multi-modal route appears
![Detected shortest path](screenshots/detected%20shortest%20path.png)

After the user picks a destination and hits **Find Route**, the
client posts `{fromStopId, toStopId}` to `POST /api/routes/find`.
The server runs a single Dijkstra over the cached transit graph and
returns a `RouteResult` of mixed walking + bus segments. The map
draws each bus segment in its own colour (red → orange → purple →
green), walking segments as dashed grey lines, and amber transfer
markers wherever buses change. The summary chip shows
**13.0 km / 39 min / 4 buses / 3 transfers**.

### 4. Itinerary — every leg, in order
![Full itinerary](screenshots/full%20bus%20stop%20flow.png)

Scrolling the journey card reveals the full step-by-step itinerary:
*walk 2 min (180 m) → Bus 4 (7 stops, 2.3 km, 8 min) → transfer →
Bus 20 (2 stops, 0.5 km, 1 min) → transfer → Bus 72 (3 stops,
3.2 km, 12 min) → transfer → Bus 12 (5 stops, 5.6 km, 16 min) →
arrive at Əhmədli m/st*. Each segment shows the bus number, stop
count, distance, and duration; transfer points are explicitly
labelled between segments. The colour palette is shared with the
map polylines via `SEGMENT_COLORS` so the eye can follow the same
journey on both panels.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Map | Leaflet + react-leaflet |
| Routing Engine | Custom Dijkstra + Yen's K-shortest paths + walking transfers |
| Database | SQLite (via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)) |
| Scrapers | Python 3.11+ stdlib `sqlite3` + `requests` |
| Deployment | Any Node host (Vercel, Fly.io, a VPS, your laptop…) |

## Quick Start

### Prerequisites

- Node.js 22+ and npm
- Python 3.11+ — only required if you want to **refresh** data; the
  prebuilt `data/ayna.sqlite` is committed to this repo, so a fresh
  clone is immediately runnable.

### 1. Clone & install

```bash
git clone https://github.com/Ismat-Samadov/best_route_finding.git
cd best_route_finding
npm install
```

`better-sqlite3` includes native binaries for supported platforms and compiles
from source on other platforms.

The repository already contains a populated `data/ayna.sqlite` with
the latest scrape — you can skip step 2 and go straight to running the
app.

### 2. (Optional) Refresh the local database

To pull the latest data from the upstream Ayna Transport API:

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Recreate the schema (idempotent — safe to re-run)
python scripts/run_migrations.py

# Repopulate (each runs in a single atomic transaction)
python scripts/stops.py
python scripts/busDetails.py
```

The two scrapers each take ~30–60 s. Both wrap their writes in a single
transaction, so a network failure mid-run leaves your existing data
intact. `busDetails.py` tolerates up to 5 % of bus fetches failing
(override with `FAILURE_THRESHOLD=0.10`, etc.) — the upstream API has
one or two persistently broken IDs.

### 3. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production build

```bash
npm run build
npm start
```

The compiled app reads `./data/ayna.sqlite` at runtime. Bundle the file
alongside the build artefact (or set `SQLITE_DB_PATH` to point at one
elsewhere) when you deploy.

### Configuration

The app and the scrapers need **zero** configuration to run with the
defaults — there is no `.env` file. If you want to relocate the SQLite
file, export one environment variable in the shell that runs the app
or scraper:

| Variable | Purpose | Default |
|----------|---------|---------|
| `SQLITE_DB_PATH` | Override the database file location used by both the app and the scrapers | `./data/ayna.sqlite` |

```bash
export SQLITE_DB_PATH=/var/lib/baku-bus/ayna.sqlite
```

## Project Structure

```
best_route_finding/
├── data/                              # ← SQLite file (committed; ~16 MB)
│   └── ayna.sqlite
├── src/
│   ├── app/
│   │   ├── page.tsx                   # Main page with map and controls
│   │   ├── layout.tsx                 # Root layout
│   │   ├── globals.css                # Global styles
│   │   └── api/
│   │       ├── stops/route.ts         # GET /api/stops (paginatable)
│   │       ├── stops/nearby/route.ts  # GET /api/stops/nearby
│   │       ├── buses/route.ts         # GET /api/buses
│   │       ├── routes/find/route.ts   # POST /api/routes/find
│   │       ├── routes/geometry/route.ts # GET /api/routes/geometry
│   │       └── data-status/route.ts   # GET /api/data-status
│   ├── lib/
│   │   ├── db.ts                      # better-sqlite3 query layer
│   │   ├── graph.ts                   # Transit graph with walking edges
│   │   ├── routing.ts                 # Dijkstra + Yen's algorithms
│   │   ├── geo.ts                     # Haversine distance calculations
│   │   └── types.ts                   # TypeScript type definitions
│   └── components/
│       ├── Map.tsx                    # Interactive Leaflet map with route visualization
│       ├── StopSearch.tsx             # Stop search autocomplete
│       ├── JourneyCard.tsx            # Route timeline with bus/walk segments
│       └── LocationButton.tsx         # Geolocation button
├── scripts/
│   ├── stops.py                       # Scraper: fetch all bus stops
│   ├── busDetails.py                  # Scraper: fetch routes (atomic transaction)
│   ├── db_utils.py                    # Shared SQLite helpers
│   ├── run_migrations.py              # Apply migrations
│   ├── inspect-data.js                # JS utility: row counts + samples
│   └── inspect-db.js                  # JS utility: full schema inspection
├── migrations/
│   └── 001_initial_schema.sql         # SQLite schema
├── docs/                              # See below
└── requirements.txt                   # Python deps (just `requests`)
```

## API Reference

### GET /api/stops

Returns every bus stop. With no query string, returns all stops at once
(this is what the UI does on first load). Pagination is opt-in:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | int | No | Max items per page (≤ 5000) — default 100 when paginating |
| `offset` | int | No | Items to skip — default 0 |

**Response (no params):** `{ stops: StopDetail[], total: number }`
**Response (paginated):** `{ stops: StopDetail[], total, limit, offset }`

### GET /api/stops/nearby

Find stops near a location.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | float | Yes | Latitude |
| `lng` | float | Yes | Longitude |
| `radius` | float | No | Search radius in km (default 1.0) |
| `limit` | int | No | Max results (default 20) |

### GET /api/buses

Returns all bus lines with metadata.

### POST /api/routes/find

Compute the optimal route between two stops. Body:
```json
{ "fromStopId": 1439, "toStopId": 631 }
```

### GET /api/routes/geometry

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `busId` | int | Yes | Bus line ID |
| `direction` | int | No | 1=forward, 2=return (default 1) |

### GET /api/data-status

`{ lastUpdated: string | null }` — ISO-8601 of the most recent ingest.

## How It Works

The app has three distinct lifecycles: an **offline scrape** that builds
the SQLite snapshot, an **app boot** that lifts that snapshot into an
in-memory graph, and a **request** path that runs Dijkstra on demand.
This section walks through all three.

### A. Offline scrape (build-time)

```
                ┌──────────────────────────────────────────┐
                │           Ayna Transport API             │
                │    https://map-api.ayna.gov.az/api/…     │
                └────────────────┬─────────────────────────┘
                                 │ HTTPS (rate-limited 0.1s)
                ┌────────────────┴─────────────────────────┐
                │   scripts/stops.py                       │
                │   scripts/busDetails.py                  │
                │     • parse_coordinate() (defensive)     │
                │     • with transaction(): atomic         │
                │       truncate-and-replace               │
                └────────────────┬─────────────────────────┘
                                 │ INSERT … VALUES (?,?,?)
                                 ▼
                       ┌─────────────────────┐
                       │  data/ayna.sqlite   │
                       │   (16 MB, tracked   │
                       │    in git)          │
                       └─────────────────────┘
```

You only run the scrapers when you want fresh data. Each one wraps the
whole load in a single SQLite transaction — if the upstream API drops
mid-run, the on-disk database is rolled back to its prior state. The
result is one self-contained file that's checked into git so a `git
clone` is immediately runnable.

### B. App boot — graph construction

When the Next.js process starts, **nothing** about the transit graph
is loaded yet. The first request that hits a graph-using endpoint
(typically `POST /api/routes/find`) triggers the lazy build inside
`getGraph()` (`src/lib/graph.ts`):

1. Open `data/ayna.sqlite` read-only via `better-sqlite3`. The
   connection caches at module level for the life of the process.
2. Pull every row of `stop_details`, `buses`, and `bus_stops` in
   parallel via the `db.ts` query helpers (3 prepared statements).
3. **Index** stops by ID (`stopInfo`) and buses by ID (`busInfo`).
4. **Bus edges:** Group `bus_stops` by `(bus_id, direction_type_id)`,
   sort by ordinal `bus_stop_id`, and for every consecutive pair add
   a directed edge with `distance = haversine(...)` and
   `time = duration_minuts / segment_count` (uniform per route — the
   upstream API doesn't publish per-leg timings).
5. **Walking edges:** O(n²) sweep over all stop pairs with a coarse
   lat/lng pre-filter (≤ 0.004° / 0.005°), then a haversine check
   (≤ 300 m). A walking edge is only added if both endpoints have at
   least one bus AND `stopB` exposes a route `stopA` doesn't —
   otherwise the walk is a redundant shortcut. Speed is 4.5 km/h.
6. The resulting graph (~3,456 nodes, ~15,600 edges of which ~4,200
   are walking) is cached in a module-level singleton. Subsequent
   requests reuse it.

Cold-start cost: **~70 ms** in production (graph build + first
Dijkstra). Warm requests: **6–10 ms**.

### C. Request path — finding the best route

```
 Browser                Next.js server               better-sqlite3
   │                          │                            │
   │  POST /api/routes/find   │                            │
   │  {from,to} ─────────────▶│                            │
   │                          │  getGraph() (cached)       │
   │                          │  findRoutes(g, …, k=1) ───▶│  3 SELECTs
   │                          │     │                       │  on cold start
   │                          │     ▼                      │
   │                          │  modified Dijkstra         │
   │                          │  over (stopId, busId)      │
   │                          │  state space               │
   │                          │     │                       │
   │                          │     ▼                      │
   │                          │  reconstructRoute()        │
   │                          │  → segments, totals        │
   │  ◀──── 200 OK ───────────│                            │
   │     RouteResult JSON     │                            │
   │                          │                            │
   ▼                          │                            │
 Client                       │                            │
   • Map.tsx draws polylines  │                            │
     coloured by SEGMENT_COLORS                            │
   • JourneyCard renders the timeline                      │
   • On mobile: switches to map view                       │
```

#### The cost function (`src/lib/routing.ts`)

The router supports three modes; the API exposes only the **balanced**
one. For each candidate edge:

```
balanced:   0.3 · distance + 0.5 · time + 0.2 · (isTransfer ? 10 : 0)
shortest:   distance + (isTransfer ? 0.5 : 0)
fastest:    time + (isTransfer ? 5 : 0)
```

A transfer is detected when the current bus ID is non-null and differs
from the edge's bus ID — including walking edges (`busId = -1`).

#### Why state is `(stopId, busId)`, not just `stopId`

If Dijkstra ran over plain stop IDs, it couldn't tell whether arriving
at a stop "still on Bus 4" was different from arriving "after just
boarding Bus 4". It would either over-count transfers (charging a
penalty for staying on the same bus) or under-count them. The
expanded `(stopId, busId)` state space lets us charge a transfer
penalty exactly once per actual bus change.

#### Yen's k-shortest paths — and why we use k=1

`findRoutes()` is generic over `k`; the API hard-codes `k=1` so only a
single Dijkstra runs. The Yen scaffolding is kept for future use cases
where alternative routes are useful (e.g. "show me three options").

### Path reconstruction

Once Dijkstra reaches the target state, `reconstructRoute()` walks the
`prev` map back to the source and groups consecutive edges by `busId`
into segments. Walking segments (`busId = -1`) bridge bus segments but
don't count as transfers — the final tally is
`totalTransfers = max(0, busSegments.length - 1)`.

The result returned to the client:

```ts
{
  segments: [
    { busId, busNumber, stops: [...], distance, time },
    ...
  ],
  totalDistance,   // km, 2 decimals
  totalTime,       // min, 1 decimal
  totalTransfers,  // bus changes, walking doesn't count
  totalStops,      // bus stops on the journey
}
```

### End-to-end data flow

```
Ayna API ── stops.py ─────────▶ stops table ────────┐
         └─ busDetails.py ────▶ stop_details        │
                              ▶ buses               │
                              ▶ bus_stops           │
                              ▶ routes              ├── data/ayna.sqlite
                              ▶ route_coordinates   │   (the snapshot)
                              ▶ payment_types       │
                              ▶ regions             │
                              ▶ working_zone_types ─┘
                                                    │
                                                    ▼
                                           src/lib/db.ts
                                           (better-sqlite3, read-only)
                                                    │
                                                    ▼
                                           src/lib/graph.ts
                                           (in-memory TransitGraph)
                                                    │
                                                    ▼
                                           src/lib/routing.ts
                                           (Dijkstra + Yen)
                                                    │
                                                    ▼
                                           Next.js API routes
                                                    │
                                                    ▼
                                           React + Leaflet UI
```

### TL;DR

- **Once** (build): scrape → write SQLite → commit.
- **Once per process** (boot): read SQLite → build graph → cache.
- **Every request**: Dijkstra over cached graph → JSON.

Per-segment travel time is the route's total duration spread evenly
across all stop-to-stop hops — the upstream API doesn't publish
per-leg timings.

See [docs/routing-algorithm.md](docs/routing-algorithm.md) for full
pseudocode and complexity analysis, and
[docs/architecture.md](docs/architecture.md) for the layered system
diagram.

## Database Schema

A single SQLite file (default `./data/ayna.sqlite`) holds:

| Table | Approx rows | Purpose |
|-------|-------------|---------|
| `buses` | 207 | Bus line definitions |
| `bus_stops` | 11,702 | Ordered stop sequences per bus |
| `stop_details` | 3,444 | Physical stops with GPS coordinates |
| `routes` | 396 | Route variants (forward/return) |
| `route_coordinates` | 108,556 | GPS polylines for route paths |
| `stops` | 3,841 | Bare stop coordinates (from `/api/stop/getAll`) |
| `payment_types`, `regions`, `working_zone_types` | small | Reference lookups |

Plus two views: `v_buses_complete`, `v_bus_stops_details`.

See [docs/database/schema-analysis.md](docs/database/schema-analysis.md) for full detail.

### Inspecting the database

```bash
npm run inspect-db      # tables, columns, indexes, FKs, row counts, samples
npm run inspect-data    # quick row counts + 5-row samples per table
sqlite3 data/ayna.sqlite '.schema'
```

## Deployment

The app is a normal Next.js Node app. Use Node 22 or newer.

* **Local / VPS:** `npm run build && npm start`. Mount the SQLite file
  next to the build (or set `SQLITE_DB_PATH`).
* **Vercel / serverless:** the SQLite file is read-only at runtime, which
  is fine — the connection opens lazily and is cached per warm function
  instance. Refresh the data by re-running the scrapers locally and
  re-deploying with the new `data/ayna.sqlite` bundled.

See [docs/deployment.md](docs/deployment.md) for full notes.

## Refreshing the Data

The committed `data/ayna.sqlite` is a snapshot — re-run the scrapers
locally whenever you want fresh data, then commit the updated file:

```bash
source .venv/bin/activate
python scripts/stops.py        # ~5 s
python scripts/busDetails.py   # ~30-60 s; atomic transaction
git add data/ayna.sqlite
git commit -m "Refresh transit data"
```

Each scraper rolls back on a DB-layer failure, so the on-disk database
is never left in a half-populated state. There is no GitHub Actions
cron — refresh is intentional and manual.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/architecture.md](docs/architecture.md) | System architecture and data flow |
| [docs/routing-algorithm.md](docs/routing-algorithm.md) | Algorithm design and pseudocode |
| [docs/database/schema-analysis.md](docs/database/schema-analysis.md) | Database schema reference |
| [docs/database/data-dictionary.md](docs/database/data-dictionary.md) | Field semantics and domain model |
| [docs/deployment.md](docs/deployment.md) | Deployment guide |
| [docs/scraping/run_migrations.md](docs/scraping/run_migrations.md) | Migration runner |
| [docs/scraping/db_utils.md](docs/scraping/db_utils.md) | DB utility module |
| [docs/scraping/stops.md](docs/scraping/stops.md) | Stops scraper |
| [docs/scraping/busDetails.md](docs/scraping/busDetails.md) | Bus details scraper |

## License

ISC
