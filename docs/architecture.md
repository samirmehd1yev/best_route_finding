# System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │  Map Layer   │  │  UI Controls │  │  State Management      ││
│  │  (Leaflet)   │  │  (React 19)  │  │  (React useState)      ││
│  │              │  │              │  │                        ││
│  │ - Stop dots  │  │ - StopSearch │  │ - Selected stops       ││
│  │ - Route lines│  │ - JourneyCard│  │ - Route result         ││
│  │ - Walk paths │  │ - LocationBtn│  │ - User location        ││
│  │ - Markers    │  │              │  │ - Mobile view toggle   ││
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────┘│
│         └──────────────────┴──────────────────────┘             │
│                            │ HTTP                               │
└────────────────────────────┼────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                     NEXT.JS 16 SERVER                           │
│                            │                                    │
│  ┌─────────────────────────┴───────────────────────────────┐    │
│  │                   API Routes (/api)                     │    │
│  │                                                         │    │
│  │  GET  /api/stops              - All stops with coords   │    │
│  │  GET  /api/stops/nearby       - Stops near a location   │    │
│  │  GET  /api/buses              - All bus lines           │    │
│  │  POST /api/routes/find        - Compute optimal route   │    │
│  │  GET  /api/routes/geometry    - Route GPS polyline      │    │
│  │  GET  /api/data-status        - Last ingest timestamp   │    │
│  └─────────────────────────┬───────────────────────────────┘    │
│                            │                                    │
│  ┌─────────────────────────┴───────────────────────────────┐    │
│  │                   Library Layer (src/lib/)              │    │
│  │                                                         │    │
│  │  db.ts       - better-sqlite3 query functions           │    │
│  │  graph.ts    - TransitGraph class (build + cache)       │    │
│  │  routing.ts  - Dijkstra + Yen's k-shortest paths        │    │
│  │  geo.ts      - Haversine distance, nearby stop lookup   │    │
│  │  types.ts    - TypeScript interfaces and constants      │    │
│  └─────────────────────────┬───────────────────────────────┘    │
│                            │ prepared statements                │
└────────────────────────────┼────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                       SQLite (file)                             │
│                                                                 │
│  Path:   ./data/ayna.sqlite (override: SQLITE_DB_PATH)          │
│  Tables: buses, bus_stops, stop_details, routes,                │
│          route_coordinates, stops, regions,                     │
│          payment_types, working_zone_types                      │
│  Views:  v_buses_complete, v_bus_stops_details                  │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16 |
| UI | React | 19 |
| Language | TypeScript (strict) | 5.9 |
| Styling | Tailwind CSS + custom CSS | 4 |
| CSS Build | PostCSS with `@tailwindcss/postcss` | 8 |
| Maps | Leaflet + react-leaflet | 1.9 / 5.0 |
| Database driver (Node) | `better-sqlite3` | 11.x |
| Database driver (Python) | stdlib `sqlite3` | — |
| Deployment | any Node 22+ host | — |

## Project Structure

```
best_route_finding/
├── data/                                 # SQLite file (committed alongside source)
│   └── ayna.sqlite
├── docs/
│   ├── architecture.md                   # This file
│   ├── routing-algorithm.md              # Algorithm design and pseudocode
│   ├── deployment.md                     # Deployment guide
│   ├── scraping/                         # Scraper module docs
│   └── database/
│       ├── schema-analysis.md            # Database schema documentation
│       └── data-dictionary.md            # Field semantics and domain model
├── prompts/
│   └── development.txt                   # Development context
├── scripts/
│   ├── inspect-db.js                     # SQLite schema inspection (Node)
│   ├── inspect-data.js                   # Quick row counts + samples (Node)
│   ├── run_migrations.py                 # Apply migrations (Python)
│   ├── stops.py                          # Stops scraper (Python)
│   ├── busDetails.py                     # Bus details scraper (Python)
│   └── db_utils.py                       # Shared SQLite helpers (Python)
├── migrations/
│   └── 001_initial_schema.sql            # SQLite schema
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout, viewport meta, Leaflet CSS
│   │   ├── page.tsx                      # Main page (client component)
│   │   ├── globals.css                   # All styles: desktop, tablet, mobile, landscape
│   │   ├── icon.svg                      # Favicon
│   │   └── api/
│   │       ├── stops/route.ts            # GET /api/stops
│   │       ├── stops/nearby/route.ts     # GET /api/stops/nearby
│   │       ├── buses/route.ts            # GET /api/buses
│   │       ├── routes/find/route.ts      # POST /api/routes/find
│   │       ├── routes/geometry/route.ts  # GET /api/routes/geometry
│   │       └── data-status/route.ts      # GET /api/data-status
│   ├── lib/
│   │   ├── db.ts                         # SQLite query functions
│   │   ├── graph.ts                      # TransitGraph class
│   │   ├── routing.ts                    # Dijkstra + Yen's + PriorityQueue
│   │   ├── geo.ts                        # Haversine, findNearbyStops
│   │   └── types.ts                      # Interfaces, constants
│   └── components/
│       ├── Map.tsx                       # Leaflet map with route visualization
│       ├── StopSearch.tsx                # Autocomplete stop search
│       ├── JourneyCard.tsx               # Route timeline (bus + walk segments)
│       └── LocationButton.tsx            # Browser geolocation button
├── .gitignore
├── next.config.ts                        # Next.js config (better-sqlite3 external)
├── postcss.config.mjs                    # PostCSS with Tailwind plugin
├── tsconfig.json                         # TypeScript configuration
├── package.json
└── README.md
```

## Layer Responsibilities

### 1. Database Layer (`src/lib/db.ts`)

Thin query layer over `better-sqlite3`. The database connection is opened
once (read-only, WAL mode, foreign keys ON) and cached at module level. The
exported functions are `async` for ergonomic compatibility with existing
callers — internally they run synchronous prepared statements.

Key functions:
- `queryStopDetails()` — all stops with coordinates
- `queryBuses()` — all bus lines with metadata
- `queryBusStops()` — all bus-stop sequences ordered by bus, direction, position
- `queryRouteCoordinates(routeId)` — GPS polyline for a specific route
- `queryAllRouteCoordinates()` — ordered polylines loaded during graph construction
- `queryRoutes()` — all route variants
- `queryRoutesByBusAndDirection(busId, directionTypeId)` — single route ID lookup
- `getDataLastUpdated()` — `MAX(created_at)` from `buses`, returned as ISO-8601

Query parameters use `?` placeholders bound by better-sqlite3 — SQL
injection is impossible from this layer.

### 2. Graph Layer (`src/lib/graph.ts`)

The `TransitGraph` class builds and caches the bus network graph:

- **Adjacency list:** `Map<stopId, GraphEdge[]>` — directed edges per stop
- **Stop index:** `Map<stopId, StopDetail>` — stop metadata lookup
- **Bus index:** `Map<busId, Bus>` — bus metadata lookup
- **Build process:** Loads all data from SQLite, constructs bus edges + walking edges
- **Singleton:** `getGraph()` awaits a shared build promise and returns the completed cached instance; failures permit retry

Walking edges connect physical stops within 300 m in both directions,
including stops on the same line. Bus edges retain their direction and
sequence positions, along with clipped road geometry and road distance.
Exact repeated copies of a complete stop sequence are collapsed before
edges are created.

### 3. Routing Layer (`src/lib/routing.ts`)

Standalone functions for route computation:

- `findRoutes(graph, source, target, mode, k)` — Yen's k-shortest paths (default k=3, the API uses k=1 which short-circuits Yen's loop)
- `shortestPath(graph, start, target, mode, excludedTransitions?, excludedStates?)` — Dijkstra retaining bus, direction, sequence, and boarding history
- `reconstructRoute(graph, path)` — builds segments, road geometry, and totals including transfer waits
- `edgeCost(edge, isTransfer, mode)` — mode-specific cost function
- `PriorityQueue<T>` — binary min-heap implementation

### 4. Geo Layer (`src/lib/geo.ts`)

Utility functions:
- `haversine(lat1, lon1, lat2, lon2)` — great-circle distance in km
- `findNearbyStops(lat, lon, stops, radiusKm, limit)` — brute-force nearest stop search

`src/lib/geometry.ts` aligns ordered stops with stored polylines in either
orientation. It clips each bus leg at projected stop positions and sums
distance along the road. Missing or unmatched geometry falls back to the
stop coordinates.

### 5. API Layer (`src/app/api/`)

Next.js App Router API routes:

| Endpoint | Method | Input | Output |
|----------|--------|-------|--------|
| `/api/stops` | GET | optional `?limit=&offset=` | `{ stops, total[, limit, offset] }` |
| `/api/stops/nearby` | GET | `?lat=&lng=&radius=&limit=` | `{ stops: StopDetail[] }` |
| `/api/buses` | GET | — | `{ buses: Bus[] }` |
| `/api/routes/find` | POST | `{ fromStopId, toStopId }` | `{ from, to, route: RouteResult }` |
| `/api/routes/geometry` | GET | `?busId=&direction=` | `{ routeId, coordinates }` |
| `/api/data-status` | GET | — | `{ lastUpdated: string \| null }` |

### 6. Frontend Layer (`src/components/` + `src/app/page.tsx`)

Client-side React components:

- **`page.tsx`** — Main page, state management (selected stops, route, mobile view), `useIsMobile()` hook for responsive breakpoint detection at 768 px. Nearest-stop lookup uses `haversine()` from `@/lib/geo` (great-circle distance).
- **`Map.tsx`** — Leaflet map (dynamically imported, no SSR). Shows stops as CircleMarkers and draws each segment's returned road geometry, with dashed walking connections. The viewport includes geometry as well as stop coordinates.
- **`StopSearch.tsx`** — Text input with inline dropdown, filters stops by name/code, touch-friendly with `onTouchEnd` handlers.
- **`JourneyCard.tsx`** — Route timeline visualization with summary stats (distance, time, buses, transfers) and segment-by-segment breakdown.
- **`LocationButton.tsx`** — Browser geolocation API, finds nearest stop on success.

## Responsive Layout

| Screen Size | Layout | Navigation |
|-------------|--------|------------|
| Desktop (>=1024 px) | Side-by-side: 420 px sidebar + map | Always visible |
| Tablet (768–1023 px) | Side-by-side: 360 px sidebar + map | Always visible |
| Mobile (<768 px) | Full-screen tabs (Search / Map) | Bottom tab bar |
| Small phone (<400 px) | Compact spacing variant | Bottom tab bar |
| Landscape mobile | Compressed header, hidden subtitle | Bottom tab bar (horizontal) |

Safe area insets (`env(safe-area-inset-*)`) supported for notched phones. Dynamic viewport height (`dvh`) used to handle mobile browser address bars.

## Data Flow: Route Finding

```
1. Page loads → fetch GET /api/stops → populate stop list + map markers
2. User selects From stop (search or map click or geolocation)
3. User selects To stop (search or map click)
4. User clicks "Find Route"
5. POST /api/routes/find { fromStopId, toStopId }
6. Server: getGraph() → returns cached TransitGraph (or builds on cold start)
7. Server: findRoutes(graph, from, to, "balanced", 1) → Dijkstra shortest path
8. Server returns: { from, to, route: { segments, totalDistance, totalTime, totalTransfers, totalStops } }
9. Client: renders JourneyCard timeline + Map polylines/markers
10. Mobile: auto-switches to Map tab after route is found
```

## Deployment

```
┌─────────────────────────────────────┐
│           Node host (any)           │
│                                     │
│  ┌─────────────────────────────┐    │
│  │   Next.js server            │    │
│  │   - Static assets (CDN/CF)  │    │
│  │   - API route handlers      │    │
│  │   - Graph build + cache     │    │
│  └──────────┬──────────────────┘    │
│             │ better-sqlite3        │
│             │ (read-only, WAL)      │
│  ┌──────────┴──────────────────┐    │
│  │   ./data/ayna.sqlite        │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

Refreshing data is a separate workflow: re-run `python scripts/stops.py`
and `python scripts/busDetails.py`, commit/upload the new SQLite file,
then redeploy. There is no live database connection from the running app
to anything external.

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SQLITE_DB_PATH` | (Optional) Override the database file path | `/var/lib/baku-bus/ayna.sqlite` |

## Performance

- **Graph caching:** Built once per Node process at first request (~2–5 s
  on cold start), cached in a module-level variable.
- **Graph size:** ~3,444 nodes, ~11,700 bus edges + walking edges. Easily
  fits in memory.
- **Route computation:** Sub-second for a single best route (Dijkstra on
  a small graph). With `k=1` Yen's loop is skipped entirely.
- **Stop data:** All ~3,444 stops loaded on initial page load for map
  display (paginatable via query string if a caller prefers).
- **SQLite mode:** WAL journal + `synchronous=NORMAL` for fast reads;
  the runtime opens the file read-only.

## Security

- No external services to authenticate against — the app and data are
  fully local.
- Prepared statements throughout (`?` placeholders) — SQL injection is
  not possible from app code.
- Input validation on all API endpoints.
- No user authentication (public transit data).
- `viewport-fit=cover` with safe area insets for modern mobile browsers.
