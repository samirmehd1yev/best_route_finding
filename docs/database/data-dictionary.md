# Data Dictionary - AYNA Bus Transport System

## Domain Context

This database models the public bus transportation system of **Baku and Sumqayit, Azerbaijan**, operated primarily by **BakuBus MMC**. The data is sourced from the AYNA (Azərbaycan Yerüstü Nəqliyyat Agentliyi — Azerbaijan Land Transport Agency) public API.

The data is stored in a single local SQLite file (`./data/ayna.sqlite` by default). The Python scrapers under `scripts/` populate it from the upstream Ayna API; the Next.js app reads from it via `better-sqlite3`.

---

## Key Domain Concepts

### Bus (Marşrut)
A bus line/service identified by a number (e.g., "1", "2", "H1"). Each bus has:
- A fixed route between two terminal points
- A known total route length (km) and estimated duration (minutes)
- A fare (tariff) in qapik (1 AZN = 100 qapik)
- A service zone type (urban, express, suburban, etc.)

### Stop (Dayanacaq)
A physical location where buses stop to pick up/drop off passengers. Each stop has:
- A unique code (e.g., "1001200")
- A name in Azerbaijani (e.g., "Neftçilər m/st" = Neftchilar metro station)
- GPS coordinates (latitude, longitude)
- A transport hub flag (for major transfer points)

### Route Direction
Each bus line operates in two directions:
- **Direction 1 (Forward):** From `first_point` to `last_point`
- **Direction 2 (Return):** From `last_point` to `first_point`

### Route Coordinate
GPS waypoints forming the actual road path of a bus route, stored as ordered polylines.

---

## Field Semantics

### Geographic Fields

| Field | Table(s) | Storage | Description |
|-------|----------|---------|-------------|
| `latitude` | stop_details, stops, route_coordinates | REAL | WGS84 latitude (decimal degrees) |
| `longitude` | stop_details, stops, route_coordinates | REAL | WGS84 longitude (decimal degrees) |
| `utm_coord_x` | stop_details | TEXT | UTM easting (currently unused upstream, value `"0"`) |
| `utm_coord_y` | stop_details | TEXT | UTM northing (currently unused upstream, value `"0"`) |

> Note: in the previous Postgres incarnation these were stored as strings. The SQLite port stores true floats, parsed defensively in `scripts/db_utils.py:parse_coordinate()`.

### Identification Fields

| Field | Table | Storage | Description |
|-------|-------|---------|-------------|
| `bus_stop_id` | bus_stops | INTEGER | Ordinal position of stop within a bus route direction |
| `stop_code` | bus_stops, stop_details.code | TEXT | Unique stop identifier code (e.g., "1XXXXXX") |
| `stop_id` | bus_stops | INTEGER | FK → stop_details.id |
| `bus_id` | bus_stops, routes | INTEGER | FK → buses.id |
| `route_id` | route_coordinates | INTEGER | FK → routes.id |

### Distance & Time Fields

| Field | Table | Unit | Description |
|-------|-------|------|-------------|
| `route_length` | buses | km | Total one-way route length |
| `total_distance` | bus_stops | km | Total route distance (same for all stops on a route) |
| `intermediate_distance` | bus_stops | km | Distance from previous stop (often null) |
| `duration_minuts` | buses | minutes | Estimated one-way trip duration |
| `tariff` | buses | qapik | Fare amount (60 = 0.60 AZN) |
| `sequence_order` | route_coordinates | integer | GPS point order in route polyline |

### Direction & Type Fields

| Field | Table | Values | Description |
|-------|-------|--------|-------------|
| `direction_type_id` | bus_stops, routes | 1=forward, 2=return | Travel direction along route |
| `is_transport_hub` | stop_details, stops | INTEGER 0/1 | Major transfer station flag |
| `working_zone_type_id` | buses | 1–7 | Service zone classification |
| `payment_type_id` | buses | 1=Card, 2=Cash | Accepted payment method |

### Audit Fields

All tables carry `created_at` (and most also `updated_at`) as `TEXT`
columns defaulted to `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` — i.e.
ISO-8601 in UTC. The `getDataLastUpdated()` API uses
`MAX(created_at) FROM buses` and parses it directly with `new Date()`.

---

## Table Roles in Route Planning

| Role | Primary Table | Supporting Tables |
|------|---------------|-------------------|
| **Graph nodes** | `stop_details` | `stops` |
| **Graph edges** | `bus_stops` (ordered stop sequences) | `buses` (edge metadata) |
| **Route geometry** | `route_coordinates` | `routes` |
| **Transfer points** | `stop_details` where served by multiple buses | `bus_stops` |
| **Edge weights** | `intermediate_distance`, `duration_minuts` | `route_length` |
| **Network metadata** | `buses`, `regions`, `working_zone_types` | `payment_types` |

---

## Data Quality Notes

1. **Coordinate parsing.** The upstream API ships coordinates in a mix of forms (`"49.961721"`, `"49,961721"`, and the quirky grouped form `"49,961,721"` meaning `49.961721`). The Python parser in `scripts/db_utils.py` handles all three and rejects values outside `[-180, 180]` so corrupt data fails loudly rather than silently.
2. **Intermediate distances.** `intermediate_distance` in `bus_stops` is frequently null. Distance between stops is therefore computed at runtime via the Haversine formula in `src/lib/geo.ts`.
3. **Stop naming.** Stop names are in Azerbaijani. `m/st` = metro station, `NMM` = terminal, `k.` = street, `qəs.` = settlement.
4. **Direction pairs.** Most buses have exactly two route entries (forward + return), totalling ~396 routes for ~207 buses.
5. **Coordinate precision.** Typically 6–7 decimal places (~10 cm precision).
6. **Booleans as integers.** SQLite has no boolean type — `is_transport_hub`, `is_active`, etc. are `INTEGER 0/1`. The JS layer coerces with `!!`.
7. **Atomic ingest.** `scripts/busDetails.py` wraps the entire load in a single transaction — partial ingests are no longer possible. If a single bus fails to fetch, the script aborts and the on-disk database is untouched.
