# Data Dictionary - AYNA Bus Transport System

## Domain Context

This database models the public bus transportation system of **Baku and Sumqayit, Azerbaijan**, operated primarily by **BakuBus MMC**. The data is sourced from the AYNA (Azərbaycan Yerüstü Nəqliyyat Agentliyi - Azerbaijan Land Transport Agency) system.

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
- A name (in Azerbaijani, e.g., "Neftçilər m/st" = Neftchilar metro station)
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

| Field | Table(s) | Format | Description |
|-------|----------|--------|-------------|
| `latitude` | stop_details, stops, route_coordinates | varchar "40.XXXXXX" | WGS84 latitude (decimal degrees) |
| `longitude` | stop_details, stops, route_coordinates | varchar "49.XXXXXX" | WGS84 longitude (decimal degrees) |
| `utm_coord_x` | stop_details | varchar | UTM easting (currently unused, value "0") |
| `utm_coord_y` | stop_details | varchar | UTM northing (currently unused, value "0") |

### Identification Fields

| Field | Table | Format | Description |
|-------|-------|--------|-------------|
| `bus_stop_id` | bus_stops | integer | Ordinal position of stop within a bus route direction |
| `stop_code` | bus_stops, stop_details.code | varchar "1XXXXXX" | Unique stop identifier code |
| `stop_id` | bus_stops | integer | FK to stop_details.id, the physical stop |
| `bus_id` | bus_stops, routes | integer | FK to buses.id, the bus line |
| `route_id` | route_coordinates | integer | FK to routes.id, the route variant |

### Distance & Time Fields

| Field | Table | Unit | Description |
|-------|-------|------|-------------|
| `route_length` | buses | kilometers | Total one-way route length |
| `total_distance` | bus_stops | kilometers | Total route distance (same for all stops on a route) |
| `intermediate_distance` | bus_stops | kilometers | Distance from previous stop (often null) |
| `duration_minuts` | buses | minutes | Estimated one-way trip duration |
| `tariff` | buses | qapik | Fare amount (60 = 0.60 AZN) |
| `sequence_order` | route_coordinates | integer | GPS point order in route polyline |

### Direction & Type Fields

| Field | Table | Values | Description |
|-------|-------|--------|-------------|
| `direction_type_id` | bus_stops, routes | 1=forward, 2=return | Travel direction along route |
| `is_transport_hub` | stop_details, stops | boolean | Major transfer station flag |
| `working_zone_type_id` | buses | 1-7 | Service zone classification |
| `payment_type_id` | buses | 1=Card, 2=Cash | Accepted payment method |

---

## Table Roles in Route Planning

| Role | Primary Table | Supporting Tables |
|------|---------------|-------------------|
| **Graph Nodes** | `stop_details` | `stops` |
| **Graph Edges** | `bus_stops` (ordered stop sequences) | `buses` (edge metadata) |
| **Route Geometry** | `route_coordinates` | `routes` |
| **Transfer Points** | `stop_details` where served by multiple buses | `bus_stops` |
| **Edge Weights** | `intermediate_distance`, `duration_minuts` | `route_length` |
| **Network Metadata** | `buses`, `regions`, `working_zone_types` | `payment_types` |

---

## Data Quality Notes

1. **Coordinate Storage:** Lat/lng stored as varchar, not numeric. Must cast to float for calculations.
2. **Intermediate Distances:** The `intermediate_distance` field in `bus_stops` is frequently null. Distance between stops must be calculated using Haversine formula from coordinates.
3. **Stop Naming:** Stop names are in Azerbaijani. "m/st" = metro station, "NMM" = terminal, "k." = street, "qəs." = settlement.
4. **Direction Pairs:** Most buses have exactly 2 route entries (forward + return), totaling ~396 routes for ~207 buses.
5. **Coordinate Precision:** Typically 7 decimal places (~1.1 cm precision).
