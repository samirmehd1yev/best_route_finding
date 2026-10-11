# busDetails.py

## Overview

Python script that fetches detailed information for every bus route in
the Baku public transportation system and writes it to the local
**SQLite** database. It populates eight tables in a single atomic
transaction — if any step fails, the on-disk database is rolled back to
its prior state.

> Historical note: previous versions logged per-bus failures and
> committed partial data. The new version refuses partial ingest: if a
> single bus fetch fails, the whole load aborts.

## API Endpoints

### Bus list
```
GET https://map-api.ayna.gov.az/api/bus/getBusList
```

### Bus details
```
GET https://map-api.ayna.gov.az/api/bus/getBusById?id={bus_id}
```

## Output

The script populates eight tables:

| Table | Approx records | Description |
|-------|---------------|-------------|
| `payment_types` | 2 | Payment method reference |
| `regions` | 1–2 | Geographic regions reference |
| `working_zone_types` | 1–7 | Service zone reference |
| `stop_details` | ~3,400 | Detailed stop info with names |
| `buses` | ~207 | Bus route metadata |
| `bus_stops` | ~11,700 | Junction table (buses ↔ stops) |
| `routes` | ~396 | Direction-specific route metadata |
| `route_coordinates` | ~108,500 | Flow coordinates for visualisation |

**Strategy:** atomic truncate-and-replace inside `with transaction():`.

## Usage

### Prerequisites

1. Apply migrations:
   ```bash
   python scripts/run_migrations.py
   ```
2. (Optional but recommended) populate the bare `stops` table first:
   ```bash
   python scripts/stops.py
   ```
3. (Optional) override the SQLite file path:
   ```bash
   export SQLITE_DB_PATH=/var/lib/baku-bus/ayna.sqlite
   ```

### Run

```bash
python scripts/busDetails.py
```

### Expected output

```
============================================================
BAKU BUS DETAILS DATA FETCHER & DATABASE LOADER
============================================================

Testing database connection...
✓ Database connection successful!

Fetching bus list from API...
URL: https://map-api.ayna.gov.az/api/bus/getBusList
✓ Successfully fetched 209 buses

Fetching details for 209 buses...
============================================================
[1/209] Fetching bus #1 (ID: 1)...
  ✓ Success
…
[209/209] Fetching bus #596 (ID: 209)...
  ✓ Success
============================================================
Successfully fetched details for 209/209 buses

============================================================
BUS DATA STATISTICS
============================================================
Total buses: 207
Unique carriers: 15
Total bus stops entries: 11702
Total routes: 396
Total coordinate points: 108556
============================================================

============================================================
SAVING DATA TO DATABASE (REPLACING OLD DATA)
============================================================

Saving reference tables...
  - payment_types: 2 records
  - regions: 1 records
  - working_zone_types: 5 records

Saving stop details...
✓ Saved 3444 stop details

Saving buses...
✓ Saved 207 buses

Saving bus stops...
✓ Saved 11702 bus stops

Saving routes...
✓ Saved 396 routes

Saving route coordinates...
  Inserting 108556 coordinate points...
✓ Saved 108556 route coordinates

============================================================
DATABASE ROW COUNTS
============================================================
  payment_types: 2 rows
  regions: 1 rows
  working_zone_types: 5 rows
  stop_details: 3,444 rows
  buses: 207 rows
  bus_stops: 11,702 rows
  routes: 396 rows
  route_coordinates: 108,556 rows

============================================================
✓ ALL OPERATIONS COMPLETED SUCCESSFULLY!
============================================================
```

## Architecture

```
fetch_all_bus_details()
  └── fetch_bus_list()
  └── for each bus:  fetch_bus_details(bus_id)   # 0.1s rate-limited
  └── if any failure: abort and return None      # no partial ingest

save_all(all_buses)
  └── with transaction():                        # one atomic block
        _save_reference_tables()
        truncate_table("bus_stops")               # remove old stop references
        _save_stop_details()
        _save_buses()
        _save_bus_stops()
        _save_routes()
        _save_route_coordinates()
```

## Key Functions

### `fetch_bus_list() -> list[dict] | None`
GET on the bus-list endpoint. Returns `[ {id, number}, ... ]`.

### `fetch_bus_details(bus_id: int) -> dict | None`
GET on the bus-details endpoint. Returns the full bus detail dict
(including nested `stops`, `routes`, `paymentType`, `region`,
`workingZoneType`, etc.).

### `fetch_all_bus_details() -> list[dict] | None`
Iterates over the bus list, fetching details for each. Per-bus
failures are logged but tolerated up to a configurable threshold
(`FAILURE_THRESHOLD`, default `0.05` = 5 %). Above that threshold the
function returns `None` so the existing database content is kept
untouched. Below it, ingest proceeds with the partial data.
The threshold must be finite and between 0 and 1; invalid values abort
before any bus fetches begin.

### `save_all(all_buses) -> bool`
Single transaction wrapping every per-table saver. Rolls back on any
exception and rejects empty replacements. Old bus-stop references are
deleted before stop details, allowing repeated refreshes with foreign-key
enforcement enabled.

### Per-table savers (private):

- `_save_reference_tables` — UPSERT into `payment_types`, `regions`,
  `working_zone_types`.
- `_save_stop_details` — Truncate + insert.
- `_save_buses` — Truncate + insert (CASCADE clears `bus_stops` and
  `routes`).
- `_save_bus_stops` — Truncate + insert.
- `_save_routes` — Truncate + insert (CASCADE clears
  `route_coordinates`).
- `_save_route_coordinates` — Truncate + insert.

All inserts use `?` placeholders bound by sqlite3.

## Coordinate Parsing

Stop and route-coordinate values are passed through
`db_utils.parse_coordinate()`, which handles:
- standard period-decimal: `"49.961721"`
- comma-decimal: `"49,961721"`
- Ayna grouped form: `"49,961,721"` → `49.961721`
- bare integers
- and rejects out-of-range or unparseable values.

## Atomicity

Old behaviour: each per-table save committed on its own. A network
failure on bus #N could leave a half-populated `stop_details` and an
empty `bus_stops`.

New behaviour (this version): one transaction covers the entire load.
SQLite either fully commits the new data or fully rolls back to the
previous state. The application never sees an inconsistent database.

## Error Handling

| Class | Source | Action |
|-------|--------|--------|
| `requests.exceptions.RequestException` | Per-bus fetch | Logged; ingest aborts |
| `json.JSONDecodeError` | Per-bus fetch | Logged; ingest aborts |
| `sqlite3.IntegrityError` (FK violations) | DB layer | Transaction rolled back |
| Any unexpected exception | DB layer | Transaction rolled back |

## Direction Types

Routes carry directional data:
- `direction_type_id = 1`: outbound (firstPoint → lastPoint)
- `direction_type_id = 2`: inbound (lastPoint → firstPoint)

Each bus typically has two routes (one per direction), each with its own
`route_coordinates` polyline.

## Performance

| Phase | Approx duration |
|-------|----------------|
| API fetching (209 buses, 0.1 s rate limit) | ~25–30 s |
| Database insert (~125k rows) | 5–10 s |
| **Total** | **30–40 s** |

The whole job is one transaction, so commit overhead is negligible.

## Inspecting the Result

```bash
sqlite3 data/ayna.sqlite ".tables"
sqlite3 data/ayna.sqlite "SELECT COUNT(*) FROM bus_stops;"
sqlite3 data/ayna.sqlite "SELECT * FROM v_buses_complete LIMIT 3;"
npm run inspect-db
```

## Example Queries

### Find a bus by number
```python
from db_utils import fetch_one

bus = fetch_one(
    """
    SELECT b.*, pt.name AS payment_type_name, r.name AS region_name
    FROM buses b
    LEFT JOIN payment_types pt ON b.payment_type_id = pt.id
    LEFT JOIN regions r ON b.region_id = r.id
    WHERE b.number = ?
    """,
    ("210",),
)
```

### Get all stops for a bus, in order
```python
stops = fetch_all(
    """
    SELECT bs.bus_stop_id, sd.name, sd.latitude, sd.longitude
    FROM bus_stops bs
    JOIN stop_details sd ON bs.stop_id = sd.id
    WHERE bs.bus_id = ? AND bs.direction_type_id = ?
    ORDER BY bs.bus_stop_id
    """,
    (bus_id, 1),
)
```

### Most popular stops (most routes passing through)
```python
hot_stops = fetch_all(
    """
    SELECT sd.name, sd.code,
           COUNT(DISTINCT bs.bus_id) AS route_count,
           sd.latitude, sd.longitude, sd.is_transport_hub
    FROM stop_details sd
    JOIN bus_stops bs ON sd.id = bs.stop_id
    GROUP BY sd.id
    ORDER BY route_count DESC
    LIMIT 10
    """
)
```

### Buses serving a specific stop
```python
buses_here = fetch_all(
    """
    SELECT DISTINCT b.id, b.number, b.first_point, b.last_point, b.carrier
    FROM buses b
    JOIN bus_stops bs ON b.id = bs.bus_id
    WHERE bs.stop_id = ?
    ORDER BY b.number
    """,
    (stop_id,),
)
```

## Known Issues

- **UTM coordinates** in upstream stop data are currently `"0"`. The
  fields are kept for future use.
- The upstream API occasionally returns a 500 for individual bus IDs
  (e.g. ID 96). The ingest tolerates a small fraction of such failures
  (`FAILURE_THRESHOLD`, default 5 %); above the threshold the load
  aborts and the existing database is kept untouched.

## Related Files

- `scripts/db_utils.py` — Connection, transaction, helpers, coordinate parser
- `scripts/run_migrations.py` — Schema setup
- `scripts/stops.py` — Populates the bare `stops` table
- `migrations/001_initial_schema.sql` — Schema definition

## Notes

- Rate-limited at 0.1 s between requests to be polite to the upstream API.
- All data stored as UTF-8; Azerbaijani characters (ə, ş, ç, ı, ğ, ü, ö) preserved.
- Idempotent — safe to re-run as often as you like.
- Foreign-key cascade keeps dependent tables consistent without manual cleanup.
