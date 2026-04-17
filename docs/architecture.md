# System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │  Map Layer   │  │  UI Controls │  │  State Management      ││
│  │  (Leaflet)   │  │  (React 19)  │  │  (React useState)      ││
│  │              │  │              │  │                          ││
│  │ - Stop dots  │  │ - StopSearch │  │ - Selected stops        ││
│  │ - Route lines│  │ - JourneyCard│  │ - Route result          ││
│  │ - Walk paths │  │ - LocationBtn│  │ - User location         ││
│  │ - Markers    │  │              │  │ - Mobile view toggle    ││
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────┘│
│         └──────────────────┴──────────────────────┘             │
│                            │ HTTP                               │
└────────────────────────────┼────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                     NEXT.JS 16 SERVER                           │
│                            │                                    │
│  ┌─────────────────────────┴───────────────────────────────┐   │
│  │                   API Routes (/api)                      │   │
│  │                                                          │   │
│  │  GET  /api/stops              - All stops with coords    │   │
│  │  GET  /api/stops/nearby       - Stops near a location    │   │
│  │  GET  /api/buses              - All bus lines             │   │
│  │  POST /api/routes/find        - Compute optimal route    │   │
│  │  GET  /api/routes/geometry    - Route GPS polyline       │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                    │
│  ┌─────────────────────────┴───────────────────────────────┐   │
│  │                   Library Layer (src/lib/)               │   │
│  │                                                          │   │
│  │  db.ts         - Neon query functions (tagged templates) │   │
│  │  graph.ts      - TransitGraph class (build + cache)      │   │
│  │  routing.ts    - Dijkstra + Yen's k-shortest paths       │   │
│  │  geo.ts        - Haversine distance, nearby stop lookup   │   │
│  │  types.ts      - TypeScript interfaces and constants      │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │ SQL (tagged templates)             │
└────────────────────────────┼────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│              NEON POSTGRESQL (Cloud)                             │
│                                                                 │
│  Schema: ayna                                                   │
│  Tables: buses, bus_stops, stop_details, routes,                │
│          route_coordinates, stops, regions,                      │
│          payment_types, working_zone_types                       │
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
| Database | PostgreSQL via Neon serverless driver | - |
| Deployment | Vercel | - |

## Project Structure

```
best_route_finding/
├── docs/
│   ├── architecture.md               # This file
│   ├── routing-algorithm.md           # Algorithm design and pseudocode
│   ├── deployment.md                  # Vercel deployment guide
│   └── database/
│       ├── schema-analysis.md         # Database schema documentation
│       └── data-dictionary.md         # Field semantics and domain model
├── prompts/
│   └── development.txt                # Development context
├── scripts/
│   ├── check-schemas.js               # Schema validation
│   ├── inspect-db.js                  # Database schema inspection
│   └── inspect-data.js               # Data sampling script
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout, viewport meta, Leaflet CSS
│   │   ├── page.tsx                   # Main page (client component)
│   │   ├── globals.css                # All styles: desktop, tablet, mobile, landscape
│   │   ├── icon.svg                   # Favicon
│   │   └── api/
│   │       ├── stops/
│   │       │   ├── route.ts           # GET /api/stops
│   │       │   └── nearby/
│   │       │       └── route.ts       # GET /api/stops/nearby
│   │       ├── buses/
│   │       │   └── route.ts           # GET /api/buses
│   │       └── routes/
│   │           ├── find/
│   │           │   └── route.ts       # POST /api/routes/find
│   │           └── geometry/
│   │               └── route.ts       # GET /api/routes/geometry
│   ├── lib/
│   │   ├── db.ts                      # Neon SQL query functions
│   │   ├── graph.ts                   # TransitGraph class
│   │   ├── routing.ts                 # Dijkstra + Yen's + PriorityQueue
│   │   ├── geo.ts                     # Haversine, findNearbyStops
│   │   └── types.ts                   # Interfaces, constants
│   └── components/
│       ├── Map.tsx                     # Leaflet map with route visualization
│       ├── StopSearch.tsx             # Autocomplete stop search
│       ├── JourneyCard.tsx            # Route timeline (bus + walk segments)
│       └── LocationButton.tsx         # Browser geolocation button
├── .env.example                       # Environment variable template
├── .gitignore
├── next.config.ts                     # Next.js configuration
├── postcss.config.mjs                 # PostCSS with Tailwind plugin
├── tsconfig.json                      # TypeScript configuration
├── package.json
└── README.md
```

## Layer Responsibilities

### 1. Database Layer (`src/lib/db.ts`)

Standalone query functions using the Neon serverless driver (`@neondatabase/serverless`). Each function creates a `neon()` SQL tagged template client from `DATABASE_URL` and returns typed results.

Key functions:
- `queryStopDetails()` — all 3,444 stops with coordinates (parses varchar lat/lng to float)
- `queryBuses()` — all 207 bus lines with metadata
- `queryBusStops()` — all 11,702 bus-stop sequences ordered by bus, direction, position
- `queryRouteCoordinates(routeId)` — GPS polyline for a specific route
- `queryRoutes()` — all route variants
- `queryRoutesByBusAndDirection(busId, directionTypeId)` — single route ID lookup

All queries use the hardcoded `ayna.` schema prefix with Neon tagged template literals (SQL injection safe).

### 2. Graph Layer (`src/lib/graph.ts`)

The `TransitGraph` class builds and caches the bus network graph:

- **Adjacency list:** `Map<stopId, GraphEdge[]>` — directed edges per stop
- **Stop index:** `Map<stopId, StopDetail>` — stop metadata lookup
- **Bus index:** `Map<busId, Bus>` — bus metadata lookup
- **Build process:** Fetches all data from DB, constructs bus edges + walking edges
- **Singleton:** `getGraph()` returns a cached instance (module-level variable)

### 3. Routing Layer (`src/lib/routing.ts`)

Standalone functions for route computation:

- `findRoutes(graph, source, target, mode, k)` — Yen's k-shortest paths (default k=3)
- `dijkstraFull(graph, source, target, mode, excludedEdges?, excludedNodes?)` — full Dijkstra with path reconstruction
- `reconstructRoute(graph, pathKeys, prevMap)` — builds `RouteResult` from path
- `edgeCost(edge, isTransfer, mode)` — mode-specific cost function
- `PriorityQueue<T>` — binary min-heap implementation

### 4. Geo Layer (`src/lib/geo.ts`)

Utility functions:
- `haversine(lat1, lon1, lat2, lon2)` — great-circle distance in km
- `findNearbyStops(lat, lon, stops, radiusKm, limit)` — brute-force nearest stop search

### 5. API Layer (`src/app/api/`)

Next.js App Router API routes:

| Endpoint | Method | Input | Output |
|----------|--------|-------|--------|
| `/api/stops` | GET | — | `{ stops: StopDetail[] }` |
| `/api/stops/nearby` | GET | `?lat=&lon=&radius=&limit=` | `{ stops: StopDetail[] }` |
| `/api/buses` | GET | — | `{ buses: Bus[] }` |
| `/api/routes/find` | POST | `{ fromStopId, toStopId }` | `{ from, to, route: RouteResult }` |
| `/api/routes/geometry` | GET | `?busId=&direction=` | `{ routeId, coordinates }` |

### 6. Frontend Layer (`src/components/` + `src/app/page.tsx`)

Client-side React components:

- **`page.tsx`** — Main page, state management (selected stops, route, mobile view), `useIsMobile()` hook for responsive breakpoint detection at 768px
- **`Map.tsx`** — Leaflet map (dynamically imported, no SSR). Shows all stops as CircleMarkers, route polylines (color-coded per segment, dashed for walking), start/end/transfer markers, user location
- **`StopSearch.tsx`** — Text input with inline dropdown, filters stops by name/code, touch-friendly with onTouchEnd handlers
- **`JourneyCard.tsx`** — Route timeline visualization with summary stats (distance, time, buses, transfers) and segment-by-segment breakdown
- **`LocationButton.tsx`** — Browser geolocation API, finds nearest stop on success

## Responsive Layout

| Screen Size | Layout | Navigation |
|-------------|--------|------------|
| Desktop (>=1024px) | Side-by-side: 420px sidebar + map | Always visible |
| Tablet (768-1023px) | Side-by-side: 360px sidebar + map | Always visible |
| Mobile (<768px) | Full-screen tabs (Search / Map) | Bottom tab bar |
| Small phone (<400px) | Compact spacing variant | Bottom tab bar |
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

## Deployment (Vercel)

```
┌─────────────────────────────────────┐
│           Vercel Platform           │
│                                     │
│  ┌─────────────────────────────┐   │
│  │   Edge Network (CDN)        │   │
│  │   - Static assets (CSS/JS)  │   │
│  │   - Pre-rendered pages      │   │
│  └──────────┬──────────────────┘   │
│             │                       │
│  ┌──────────┴──────────────────┐   │
│  │   Serverless Functions      │   │
│  │   - API route handlers      │   │
│  │   - Graph build + cache     │   │
│  └──────────┬──────────────────┘   │
│             │                       │
└─────────────┼───────────────────────┘
              │ HTTPS
              │
┌─────────────┴───────────────────────┐
│     Neon PostgreSQL                 │
│     - Serverless HTTP driver        │
│     - Schema: ayna                  │
└─────────────────────────────────────┘
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `DATABASE_SCHEMA` | Schema name (read but queries use hardcoded `ayna.` prefix) | `AYNA` |

## Performance

- **Graph caching:** Built once per serverless function cold start (~2-5s), cached in module-level variable. Subsequent requests within the same instance reuse it.
- **Graph size:** ~3,444 nodes, ~11,700+ edges (bus routes + walking transfers). Fits in serverless function memory.
- **Route computation:** Sub-second for single best route (Dijkstra on a small graph).
- **Stop data:** All 3,444 stops loaded on initial page load for map display.
- **Database driver:** Neon serverless uses HTTP-based queries optimized for edge/serverless environments.

## Security

- Database credentials in environment variables only
- SSL/TLS for all database connections (Neon default)
- SQL injection prevention via tagged template literals
- Input validation on all API endpoints
- No user authentication (public transit data)
- `viewport-fit=cover` with safe area insets for modern mobile browsers
