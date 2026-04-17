# Baku Bus Route Planner

A production-ready web application for finding optimal public bus routes across Baku, Azerbaijan. Built with Next.js, Leaflet maps, and a custom multi-objective routing engine.

## Features

- **Interactive Map** - Browse all 3,400+ bus stops on an OpenStreetMap-based map
- **Smart Route Finding** - Computes the optimal route between any two stops using a balanced multi-objective algorithm
- **Walking Transfers** - Suggests short walks (up to 300m) between nearby stops to find better routes
- **Transfer Detection** - Automatically identifies where to change buses with distinct color-coded segments
- **Geolocation** - Detect your location and find the nearest bus stop
- **Mobile-Responsive** - Tab-based layout (Search / Map) optimized for touch devices
- **207 Bus Lines** - Full coverage of BakuBus network

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Map | Leaflet + react-leaflet |
| Routing Engine | Custom Dijkstra + Yen's K-shortest paths + walking transfers |
| Database | PostgreSQL (Neon Serverless) |
| Deployment | Vercel |

## Quick Start

### Prerequisites

- Node.js 20+ and npm
- Access to the Neon PostgreSQL database

### Installation

```bash
git clone https://github.com/Ismat-Samadov/best_route_finding.git
cd best_route_finding
npm install
```

### Environment Setup

Create a `.env` file:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
DATABASE_SCHEMA=AYNA
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
best_route_finding/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main page with map and controls
│   │   ├── layout.tsx                  # Root layout
│   │   ├── globals.css                 # Global styles
│   │   └── api/
│   │       ├── stops/route.ts          # GET /api/stops
│   │       ├── stops/nearby/route.ts   # GET /api/stops/nearby
│   │       ├── buses/route.ts          # GET /api/buses
│   │       ├── routes/find/route.ts    # POST /api/routes/find
│   │       └── routes/geometry/route.ts # GET /api/routes/geometry
│   ├── lib/
│   │   ├── db.ts                       # Database queries
│   │   ├── graph.ts                    # Transit graph with walking edges
│   │   ├── routing.ts                  # Dijkstra + Yen's algorithms
│   │   ├── geo.ts                      # Haversine distance calculations
│   │   └── types.ts                    # TypeScript type definitions
│   └── components/
│       ├── Map.tsx                     # Interactive Leaflet map with route visualization
│       ├── StopSearch.tsx              # Stop search autocomplete
│       ├── JourneyCard.tsx             # Route timeline with bus/walk segments
│       └── LocationButton.tsx          # Geolocation button
├── scripts/
│   ├── stops.py                    # Scraper: fetch all bus stops
│   ├── busDetails.py               # Scraper: fetch bus routes and coordinates
│   ├── db_utils.py                 # Shared DB connection utilities
│   ├── run_migrations.py           # Apply database migrations
│   ├── check-schemas.js            # JS utility: inspect DB schemas
│   ├── inspect-data.js             # JS utility: inspect JSON data
│   └── inspect-db.js               # JS utility: inspect DB contents
├── migrations/
│   └── 001_initial_schema.sql      # PostgreSQL schema (ayna schema)
├── .github/
│   └── workflows/
│       └── scrape-data.yml         # GitHub Actions: scrape every 3 hours
├── docs/
│   ├── scraping/                   # Scraping infrastructure docs
│   │   ├── stops.md
│   │   ├── busDetails.md
│   │   ├── db_utils.md
│   │   └── run_migrations.md
│   ├── architecture.md
│   ├── routing-algorithm.md
│   ├── deployment.md
│   └── database/
│       ├── schema-analysis.md
│       └── data-dictionary.md
└── requirements.txt                # Python dependencies for scrapers
```

## API Reference

### GET /api/stops

Returns all bus stops with coordinates.

**Response:**
```json
{
  "stops": [
    {
      "id": 1439,
      "code": "1001200",
      "name": "Neftciler m/st",
      "latitude": 40.4115,
      "longitude": 49.9419,
      "is_transport_hub": false
    }
  ]
}
```

### GET /api/stops/nearby

Find stops near a location.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| lat | float | Yes | Latitude |
| lng | float | Yes | Longitude |
| radius | float | No | Search radius in km (default: 1.0) |
| limit | int | No | Max results (default: 20) |

### GET /api/buses

Returns all bus lines with metadata.

### POST /api/routes/find

Compute the optimal route between two stops.

**Request Body:**
```json
{
  "fromStopId": 1439,
  "toStopId": 631
}
```

**Response:**
```json
{
  "from": { "id": 1439, "name": "Neftciler m/st" },
  "to": { "id": 631, "name": "Qara Qarayev m/st" },
  "route": {
    "segments": [
      {
        "busId": 1,
        "busNumber": "1",
        "stops": [...],
        "distance": 2.5,
        "time": 8.2
      },
      {
        "busId": -1,
        "busNumber": "walk",
        "stops": [...],
        "distance": 0.15,
        "time": 2.0
      }
    ],
    "totalDistance": 2.65,
    "totalTime": 10.2,
    "totalTransfers": 0,
    "totalStops": 5
  }
}
```

### GET /api/routes/geometry

Get GPS polyline coordinates for a route.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| busId | int | Yes | Bus line ID |
| direction | int | No | Direction (1=forward, 2=return, default: 1) |

## Routing Algorithm

The routing engine uses a **Modified Dijkstra's algorithm** with **walking transfer edges** to find the best route:

1. **Graph Model:** Bus stops are nodes; consecutive stops on bus routes are directed edges; nearby stops (within 300m) are connected by bidirectional walking edges
2. **Multi-objective Cost:** `0.3 * distance + 0.5 * time + 0.2 * transfer_penalty` (balanced mode)
3. **Transfer Tracking:** State includes current bus ID to detect transfers
4. **Walking Transfers:** The algorithm can suggest short walks between nearby stops to avoid long detours

See [docs/routing-algorithm.md](docs/routing-algorithm.md) for detailed pseudocode and complexity analysis.

## Database Schema

The application connects to a PostgreSQL database (Neon) with the `ayna` schema containing:

- `buses` (207 rows) - Bus line definitions
- `bus_stops` (11,702 rows) - Ordered stop sequences per bus
- `stop_details` (3,444 rows) - Physical stop locations with GPS coordinates
- `routes` (396 rows) - Route variants (forward/return)
- `route_coordinates` (108,556 rows) - GPS polylines for route paths

See [docs/database/schema-analysis.md](docs/database/schema-analysis.md) for full documentation.

## Deployment

Deploy to Vercel in one click:

1. Connect GitHub repo to Vercel
2. Set environment variables (`DATABASE_URL`, `DATABASE_SCHEMA`)
3. Deploy

See [docs/deployment.md](docs/deployment.md) for full deployment guide.

## Scraping Infrastructure

This repo also contains the automated data pipeline that keeps the PostgreSQL database fresh.

### Overview

Python scripts fetch data from the [Ayna Transport API](https://map-api.ayna.gov.az) and insert it into PostgreSQL. A GitHub Actions workflow runs the scrapers every 3 hours automatically.

### Setup

```bash
# Install Python dependencies
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure database
echo "DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require" > .env

# Create schema
python scripts/run_migrations.py

# Fetch data
python scripts/stops.py
python scripts/busDetails.py
```

### Scripts

| Script | Description |
|--------|-------------|
| `scripts/stops.py` | Fetches 3,841 bus stops from API, truncates and reloads `ayna.stops` |
| `scripts/busDetails.py` | Fetches 208 bus routes with stops and coordinates (~127K total records) |
| `scripts/db_utils.py` | Shared database connection pooling and query helpers |
| `scripts/run_migrations.py` | Applies `migrations/001_initial_schema.sql` to create the `ayna` schema |

### Automated Scraping (GitHub Actions)

The workflow at `.github/workflows/scrape-data.yml` runs on schedule (`0 */3 * * *`) and on manual trigger:

1. **Job 1 – Scrape Stops:** runs `stops.py`, uploads logs as artifact
2. **Job 2 – Scrape Bus Details:** runs `busDetails.py` after Job 1 succeeds
3. **Job 3 – Notify:** reports overall success/failure

**Required secret:** Add `DATABASE_URL` to the repository's **Settings → Secrets and variables → Actions**.

### Scraping Documentation

| Document | Description |
|----------|-------------|
| [docs/scraping/stops.md](docs/scraping/stops.md) | Stops scraper |
| [docs/scraping/busDetails.md](docs/scraping/busDetails.md) | Bus details scraper |
| [docs/scraping/db_utils.md](docs/scraping/db_utils.md) | Database utilities |
| [docs/scraping/run_migrations.md](docs/scraping/run_migrations.md) | Migration runner |

## Documentation

| Document | Description |
|----------|-------------|
| [docs/architecture.md](docs/architecture.md) | System architecture and data flow |
| [docs/routing-algorithm.md](docs/routing-algorithm.md) | Algorithm design and pseudocode |
| [docs/database/schema-analysis.md](docs/database/schema-analysis.md) | Database schema analysis |
| [docs/database/data-dictionary.md](docs/database/data-dictionary.md) | Field semantics and domain model |
| [docs/deployment.md](docs/deployment.md) | Vercel deployment guide |

## License

ISC
