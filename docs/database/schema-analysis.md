# Database Schema Analysis Report

## Database: Baku Public Transport System (AYNA)

**Schema:** `ayna`
**Database:** PostgreSQL (Neon)
**Total Tables:** 9

---

## Table Overview

| Table | Rows | Purpose |
|-------|------|---------|
| `bus_stops` | 11,702 | Junction table linking buses to their ordered stop sequences |
| `buses` | 207 | Bus line/route definitions with metadata |
| `payment_types` | 2 | Payment method lookup (Card / Cash) |
| `regions` | 2 | Geographic regions (Baku, Sumqayit) |
| `route_coordinates` | 108,556 | GPS coordinate polylines for route paths |
| `routes` | 396 | Route variants with direction (forward/return) |
| `stop_details` | 3,444 | Physical bus stop locations with coordinates |
| `stops` | 3,841 | Simplified stop coordinate reference |
| `working_zone_types` | 7 | Zone classification (urban, suburban, express, etc.) |

---

## Detailed Table Definitions

### 1. `buses` - Bus Lines

The primary entity representing a bus line/service.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Auto-increment primary key |
| `carrier` | varchar(255) | NO | Operating company (e.g., "BakuBus MMC") |
| `number` | varchar(50) | NO | Bus line number (e.g., "1", "2", "H1") |
| `first_point` | varchar(255) | NO | Name of the first terminal stop |
| `last_point` | varchar(255) | NO | Name of the last terminal stop |
| `route_length` | numeric(10,2) | YES | Total route length in kilometers |
| `payment_type_id` | integer (FK) | YES | References `payment_types.id` |
| `card_payment_date` | timestamp | YES | Date when card payment was introduced |
| `tariff` | integer | YES | Fare in qapik (60 = 0.60 AZN) |
| `tariff_str` | varchar(50) | YES | Human-readable fare string |
| `region_id` | integer (FK) | YES | References `regions.id` |
| `working_zone_type_id` | integer (FK) | YES | References `working_zone_types.id` |
| `duration_minuts` | integer | YES | Estimated one-way trip duration in minutes |
| `created_at` | timestamp | YES | Record creation timestamp |
| `updated_at` | timestamp | YES | Record update timestamp |

**Foreign Keys:**
- `payment_type_id` -> `payment_types.id`
- `region_id` -> `regions.id`
- `working_zone_type_id` -> `working_zone_types.id`

### 2. `stop_details` - Physical Bus Stops

Represents physical bus stop locations with geospatial coordinates.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Unique stop identifier |
| `code` | varchar(50) | YES | Stop code (e.g., "1001200") |
| `name` | varchar(255) | NO | Stop name in Azerbaijani |
| `name_monitor` | varchar(255) | YES | Display name for monitors |
| `utm_coord_x` | varchar(50) | YES | UTM X coordinate (unused, "0") |
| `utm_coord_y` | varchar(50) | YES | UTM Y coordinate (unused, "0") |
| `longitude` | varchar(50) | YES | GPS longitude (WGS84) |
| `latitude` | varchar(50) | YES | GPS latitude (WGS84) |
| `is_transport_hub` | boolean | NO | Whether stop is a transport hub |
| `created_at` | timestamp | YES | Record creation timestamp |
| `updated_at` | timestamp | YES | Record update timestamp |

**Note:** Coordinates are stored as varchar, not numeric. Baku coordinates are approximately lat: 40.3-40.5, lon: 49.8-50.1.

### 3. `bus_stops` - Bus-Stop Sequence Junction

Links buses to their stops in order, forming the route sequence.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Auto-increment primary key |
| `bus_stop_id` | integer | NO | Sequence position within the bus route |
| `bus_id` | integer (FK) | NO | References `buses.id` |
| `stop_id` | integer (FK) | NO | References `stop_details.id` |
| `stop_code` | varchar(50) | YES | Denormalized stop code |
| `stop_name` | varchar(255) | NO | Denormalized stop name |
| `total_distance` | numeric(10,2) | YES | Total route distance (km) |
| `intermediate_distance` | numeric(10,2) | YES | Distance from previous stop (km) |
| `direction_type_id` | integer | NO | Direction: 1=forward, 2=return |
| `created_at` | timestamp | YES | Record creation timestamp |
| `updated_at` | timestamp | YES | Record update timestamp |

**Foreign Keys:**
- `bus_id` -> `buses.id`
- `stop_id` -> `stop_details.id`

**Key Insight:** `bus_stop_id` represents the ordinal position of a stop within a bus route for a given direction. This is the primary table for constructing the route graph.

### 4. `routes` - Route Variants

Represents route variants (forward and return directions).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Unique route variant ID |
| `code` | varchar(50) | YES | Route code (matches bus number) |
| `customer_name` | varchar(255) | YES | Customer-facing name |
| `type` | varchar(50) | YES | Route type identifier |
| `name` | varchar(255) | YES | Route name |
| `destination` | text | YES | Full destination description (e.g., "Neftciler m/st - 28 May m/st") |
| `variant` | varchar(50) | YES | Route variant identifier |
| `operator` | varchar(255) | YES | Operator identifier |
| `bus_id` | integer (FK) | YES | References `buses.id` |
| `direction_type_id` | integer | YES | Direction: 1=forward, 2=return |
| `created_at` | timestamp | YES | Record creation timestamp |
| `updated_at` | timestamp | YES | Record update timestamp |

**Foreign Keys:**
- `bus_id` -> `buses.id`

### 5. `route_coordinates` - Route GPS Polylines

Ordered GPS coordinates forming the actual path of bus routes.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Auto-increment primary key |
| `route_id` | integer (FK) | NO | References `routes.id` |
| `latitude` | varchar(50) | YES | GPS latitude |
| `longitude` | varchar(50) | YES | GPS longitude |
| `sequence_order` | integer | YES | Order of coordinate in polyline |
| `created_at` | timestamp | YES | Record creation timestamp |

**Foreign Keys:**
- `route_id` -> `routes.id`

### 6. `stops` - Simplified Stop Reference

Basic stop coordinates (appears to be a separate reference table).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Stop ID |
| `longitude` | varchar(50) | YES | GPS longitude |
| `latitude` | varchar(50) | YES | GPS latitude |
| `is_transport_hub` | boolean | YES | Whether this is a transfer hub |
| `created_at` | timestamp | YES | Record creation timestamp |
| `updated_at` | timestamp | YES | Record update timestamp |

### 7. `payment_types` - Payment Method Lookup

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Payment type ID |
| `name` | varchar(100) | NO | Name: "Kart" (Card), "Nəğd" (Cash) |
| `description` | text | YES | Description |
| `is_active` | boolean | NO | Active status |
| `priority` | integer | YES | Display order |

### 8. `regions` - Geographic Regions

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Region ID |
| `name` | varchar(100) | NO | Region name: "Bakı", "Sumqayıt" |
| `description` | text | YES | Description |
| `is_active` | boolean | NO | Active status |
| `priority` | integer | YES | Display order |

### 9. `working_zone_types` - Service Zone Types

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | integer (PK) | NO | Zone type ID |
| `name` | varchar(100) | NO | Zone name |
| `is_active` | boolean | NO | Active status |
| `priority` | integer | YES | Display/sort order |

**Known Values:**
- 1: Şəhərdaxili (Intracity)
- 2: Şəhərdaxili ekspres (Intracity Express)
- 3: Şəhərətrafı (Suburban)
- 5: Qəsəbədaxili (Intra-settlement)
- 6: Qəsəbələrarası (Inter-settlement)

---

## Entity Relationship Diagram (Textual)

```
regions (1) ──────────────< buses (N)
payment_types (1) ────────< buses (N)
working_zone_types (1) ───< buses (N)

buses (1) ────────────────< bus_stops (N) >──────── stop_details (1)
buses (1) ────────────────< routes (N)
routes (1) ───────────────< route_coordinates (N)

stops (standalone - coordinate reference)
```

## Key Relationships for Route Planning

1. **Bus -> Stops:** `buses` -> `bus_stops` -> `stop_details` (ordered by `bus_stop_id` per `direction_type_id`)
2. **Bus -> Route Path:** `buses` -> `routes` -> `route_coordinates` (ordered by `sequence_order`)
3. **Transfer Detection:** Stops served by multiple buses can be identified by shared `stop_id` values in `bus_stops` across different `bus_id` values

## Geospatial Data Summary

- **Stop locations:** 3,444 physical stops with lat/lng in `stop_details`
- **Route polylines:** 108,556 GPS coordinate points in `route_coordinates`
- **Coverage area:** Baku and Sumqayit, Azerbaijan (lat: ~40.3-40.5, lon: ~49.8-50.1)
- **Coordinate system:** WGS84 (standard GPS)
