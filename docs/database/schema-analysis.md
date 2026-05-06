# Database Schema Analysis Report

## Database: Baku Public Transport System (AYNA)

**Engine:** SQLite (file: `./data/ayna.sqlite`, override via `SQLITE_DB_PATH`)
**Total tables:** 9
**Total views:** 2

> Historical note: the database used to live in Postgres under the
> `ayna` schema. SQLite has no concept of schemas, so the `ayna.`
> prefix has been dropped — all tables and views are now in the
> default namespace.

---

## Table Overview

| Table | Approx rows | Purpose |
|-------|-------------|---------|
| `bus_stops` | 11,702 | Junction table linking buses to their ordered stop sequences |
| `buses` | 207 | Bus line/route definitions with metadata |
| `payment_types` | 2 | Payment method lookup (Card / Cash) |
| `regions` | 2 | Geographic regions (Baku, Sumqayit) |
| `route_coordinates` | 108,556 | GPS coordinate polylines for route paths |
| `routes` | 396 | Route variants with direction (forward/return) |
| `stop_details` | 3,444 | Physical bus stop locations with coordinates |
| `stops` | 3,841 | Simplified stop coordinate reference (from `/api/stop/getAll`) |
| `working_zone_types` | 7 | Zone classification (urban, suburban, express, …) |

---

## SQLite Type Mapping

| Logical type (was Postgres) | SQLite storage | Notes |
|-----------------------------|----------------|-------|
| `INTEGER` / `BIGINT` | `INTEGER` | Native |
| `SERIAL` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Used by `bus_stops.id`, `route_coordinates.id` |
| `VARCHAR(n)` / `TEXT` | `TEXT` | SQLite ignores length constraints; the column is just text |
| `DECIMAL(10,7)` | `REAL` | 53-bit double — ample for 7-digit lat/lng |
| `DECIMAL(10,2)` | `REAL` | Same — used for distances |
| `BOOLEAN` | `INTEGER` (0/1) | The JS layer coerces with `!!`, the Python layer with `1 if x else 0` |
| `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | `TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` | ISO-8601 in UTC, parses cleanly via `new Date(value)` |
| `CREATE OR REPLACE VIEW` | `DROP VIEW IF EXISTS` + `CREATE VIEW` | SQLite has no `OR REPLACE` for views |
| Update triggers (`update_updated_at`) | dropped | No caller reads `updated_at` and SQLite doesn't have pl/pgsql |

---

## Detailed Table Definitions

### 1. `buses` — Bus Lines

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | INTEGER (PK) | NO | Primary key (set explicitly from API) |
| `carrier` | TEXT | NO | Operating company (e.g., "BakuBus MMC") |
| `number` | TEXT | NO | Bus line number (e.g., "1", "210", "H1") |
| `first_point` | TEXT | NO | Name of the first terminal stop |
| `last_point` | TEXT | NO | Name of the last terminal stop |
| `route_length` | REAL | YES | Total route length in kilometres |
| `payment_type_id` | INTEGER (FK) | YES | References `payment_types.id` |
| `card_payment_date` | TEXT | YES | Date when card payment was introduced |
| `tariff` | INTEGER | NO | Fare in qapik (60 = 0.60 AZN) |
| `tariff_str` | TEXT | YES | Human-readable fare string |
| `region_id` | INTEGER (FK) | YES | References `regions.id` |
| `working_zone_type_id` | INTEGER (FK) | YES | References `working_zone_types.id` |
| `duration_minuts` | INTEGER | YES | Estimated one-way trip duration in minutes |
| `created_at` | TEXT | YES | ISO-8601 ingest timestamp |
| `updated_at` | TEXT | YES | ISO-8601 ingest timestamp |

**Foreign keys:** `payment_type_id → payment_types.id`, `region_id → regions.id`, `working_zone_type_id → working_zone_types.id`.

### 2. `stop_details` — Physical Bus Stops

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | INTEGER (PK) | NO | Unique stop identifier |
| `code` | TEXT | YES | Stop code (e.g., "1001200") |
| `name` | TEXT | NO | Stop name (Azerbaijani) |
| `name_monitor` | TEXT | YES | Display name for on-bus monitors |
| `utm_coord_x` | TEXT | YES | UTM X (currently "0" upstream) |
| `utm_coord_y` | TEXT | YES | UTM Y (currently "0" upstream) |
| `longitude` | REAL | NO | GPS longitude (WGS84) |
| `latitude` | REAL | NO | GPS latitude (WGS84) |
| `is_transport_hub` | INTEGER | NO | 0/1 flag |
| `created_at` | TEXT | YES | ISO-8601 |
| `updated_at` | TEXT | YES | ISO-8601 |

**Note:** Coordinates are stored as `REAL` (true floats). Baku coordinates are roughly lat 40.3–40.5, lon 49.8–50.1. The Python ingest uses a defensive `parse_coordinate()` that accepts the upstream API's quirky comma-grouped form (`"49,961,721"` → `49.961721`) and rejects out-of-range values.

### 3. `bus_stops` — Bus-Stop Sequence Junction

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | NO | Surrogate key |
| `bus_stop_id` | INTEGER | NO | Sequence position within the bus route |
| `bus_id` | INTEGER (FK) | NO | References `buses.id`, ON DELETE CASCADE |
| `stop_id` | INTEGER (FK) | NO | References `stop_details.id` |
| `stop_code` | TEXT | YES | Denormalised stop code |
| `stop_name` | TEXT | NO | Denormalised stop name |
| `total_distance` | REAL | YES | Total route distance (km) |
| `intermediate_distance` | REAL | YES | Distance from previous stop (km, often null) |
| `direction_type_id` | INTEGER | NO | 1=outbound, 2=inbound |
| `created_at` | TEXT | YES | ISO-8601 |
| `updated_at` | TEXT | YES | ISO-8601 |

**Constraints:** `UNIQUE(bus_id, bus_stop_id, direction_type_id)`.

**Key insight:** `bus_stop_id` is the ordinal position within a bus route for a given direction. This is the primary table for constructing the route graph.

### 4. `routes` — Route Variants

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | INTEGER (PK) | NO | Unique route variant ID |
| `code` | TEXT | YES | Route code (matches bus number) |
| `customer_name` | TEXT | YES | Customer-facing name |
| `type` | TEXT | YES | Route type identifier |
| `name` | TEXT | YES | Route name |
| `destination` | TEXT | YES | Full destination description |
| `variant` | TEXT | YES | Route variant identifier |
| `operator` | TEXT | YES | Operator identifier |
| `bus_id` | INTEGER (FK) | NO | References `buses.id`, ON DELETE CASCADE |
| `direction_type_id` | INTEGER | NO | 1=forward, 2=return |
| `created_at` | TEXT | YES | ISO-8601 |
| `updated_at` | TEXT | YES | ISO-8601 |

### 5. `route_coordinates` — Route GPS Polylines

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | NO | Surrogate key |
| `route_id` | INTEGER (FK) | NO | References `routes.id`, ON DELETE CASCADE |
| `latitude` | REAL | NO | GPS latitude |
| `longitude` | REAL | NO | GPS longitude |
| `sequence_order` | INTEGER | NO | Position in polyline |
| `created_at` | TEXT | YES | ISO-8601 |

### 6. `stops` — Simplified Stop Reference

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | INTEGER (PK) | NO | Stop ID |
| `longitude` | REAL | NO | GPS longitude |
| `latitude` | REAL | NO | GPS latitude |
| `is_transport_hub` | INTEGER | NO | 0/1 flag |
| `created_at` | TEXT | YES | ISO-8601 |
| `updated_at` | TEXT | YES | ISO-8601 |

Populated by `scripts/stops.py` from `/api/stop/getAll`.

### 7. `payment_types`, 8. `regions`, 9. `working_zone_types`

All three lookup tables share the same shape:

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | INTEGER (PK) | NO | Lookup ID |
| `name` | TEXT | NO | Name |
| `description` | TEXT | YES | Description |
| `is_active` | INTEGER | NO | 0/1 flag |
| `deactived_date` | TEXT | YES | ISO-8601 if deactivated |
| `priority` | INTEGER | YES | Display order |
| `created_at` | TEXT | YES | ISO-8601 |
| `updated_at` | TEXT | YES | ISO-8601 |

`working_zone_types` known values:
- 1: Şəhərdaxili (Intracity)
- 2: Şəhərdaxili ekspres (Intracity Express)
- 3: Şəhərətrafı (Suburban)
- 5: Qəsəbədaxili (Intra-settlement)
- 6: Qəsəbələrarası (Inter-settlement)

---

## Views

### `v_buses_complete`

Joins `buses` against the lookup tables to produce a denormalised view
of every bus line, including `payment_type`, `region`, and
`working_zone_type` names alongside fare and duration metadata.

### `v_bus_stops_details`

Joins `bus_stops` against `buses` and `stop_details` to expose every
ordered stop on every bus with full names, coordinates, and a
human-readable `direction_name` (`'Outbound' | 'Inbound'`).

---

## Entity Relationship Diagram (Textual)

```
regions (1) ──────────────< buses (N)
payment_types (1) ────────< buses (N)
working_zone_types (1) ───< buses (N)

buses (1) ────────────────< bus_stops (N) >──────── stop_details (1)
buses (1) ────────────────< routes (N)
routes (1) ───────────────< route_coordinates (N)

stops (standalone — coordinate reference)
```

## Key Relationships for Route Planning

1. **Bus → stops:** `buses → bus_stops → stop_details` (ordered by `bus_stop_id` per `direction_type_id`).
2. **Bus → route path:** `buses → routes → route_coordinates` (ordered by `sequence_order`).
3. **Transfer detection:** Stops served by multiple buses can be identified by shared `stop_id` values in `bus_stops` across different `bus_id` values.

## Geospatial Data Summary

- **Stop locations:** ~3,444 physical stops with lat/lng in `stop_details`
- **Route polylines:** ~108,556 GPS coordinate points in `route_coordinates`
- **Coverage area:** Baku and Sumqayit (lat ~40.3–40.5, lon ~49.8–50.1)
- **Coordinate system:** WGS84 (standard GPS)

## Foreign Key Enforcement

`PRAGMA foreign_keys = ON` is set both in the migration and at every
connection (Python `db_utils.py`, JavaScript `src/lib/db.ts`).

## Inspecting the Database

```bash
npm run inspect-db                # full dump (tables, columns, FKs, samples)
npm run inspect-data              # quick row counts + 5-row samples
sqlite3 data/ayna.sqlite '.schema'  # raw schema
sqlite3 data/ayna.sqlite '.tables'  # list tables
```
