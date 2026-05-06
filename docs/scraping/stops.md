# stops.py

## Overview

Python script that fetches every bus stop from the Ayna Transport API
and writes it into the local **SQLite** database (`./data/ayna.sqlite`
by default; override via `SQLITE_DB_PATH`).

The whole replacement runs inside a single transaction — if the API
fails or any row fails to bind, the existing data is left intact.

## API Endpoint

```
GET https://map-api.ayna.gov.az/api/stop/getAll
```

## Output

- **Database table:** `stops`
- **Total records:** ~3,841 stops
- **Strategy:** atomic truncate-and-replace inside `with transaction():`

## Schema

See `migrations/001_initial_schema.sql`. Relevant columns:

```sql
CREATE TABLE IF NOT EXISTS stops (
    id INTEGER PRIMARY KEY,
    longitude REAL NOT NULL,
    latitude REAL NOT NULL,
    is_transport_hub INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

## API Response Shape

```json
{
  "id": 1732,
  "longitude": "50.15006",
  "latitude": "40.378864",
  "isTransportHub": false
}
```

The API also returns `code`, `name`, `nameMonitor`, `utmCoordX`,
`utmCoordY`, but those are populated into `stop_details` by
`busDetails.py`, not here.

## Usage

### Prerequisites

1. Apply migrations first:
   ```bash
   python scripts/run_migrations.py
   ```

2. (Optional) override the SQLite file path:
   ```bash
   export SQLITE_DB_PATH=/var/lib/baku-bus/ayna.sqlite
   ```

### Run

```bash
python scripts/stops.py
```

### Expected output

```
============================================================
BAKU BUS STOPS DATA FETCHER
============================================================

Testing database connection...
✓ Database connection successful!

Fetching stops data from API...
URL: https://map-api.ayna.gov.az/api/stop/getAll
✓ Successfully fetched 3841 stops

============================================================
STOPS DATA STATISTICS
============================================================
Total stops: 3841
Transport hubs: 8
Regular stops: 3833
Stops with coordinates: 3841 (100.0%)
============================================================

Saving stops to database (will replace existing data)...
Truncating table stops (removing old data)...
Preparing data for database insert...
Inserting 3841 stops into database...
✓ Successfully saved 3841 stops to database
Total stops in database: 3841

============================================================
✓ ALL OPERATIONS COMPLETED SUCCESSFULLY!
============================================================
```

## Key Functions

### `fetch_stops() -> list[dict] | None`
Fetches the raw stops list from the upstream API with a 30-second
timeout. Returns the parsed list, or `None` on any error.

### `save_stops_to_db(stops: list[dict]) -> bool`

```python
with transaction():
    truncate_table("stops")
    execute_values(
        "INSERT INTO stops (id, longitude, latitude, is_transport_hub) VALUES (?, ?, ?, ?)",
        rows,
    )
```

The whole replacement runs inside one SQLite transaction. If the
truncate succeeds but the insert fails (e.g. malformed coordinate that
got past validation), SQLite rolls back and the previous data is
restored.

Coordinates are parsed via `parse_coordinate()` from `db_utils` — see
the [db_utils docs](db_utils.md#coordinate-parsing) for accepted
formats.

### `get_statistics(stops: list[dict])`
Logs a summary block with counts of total stops, transport hubs, and
stops with valid coordinates.

## Atomicity

Old behaviour: truncate first, then insert. A failure between the two
steps left the table empty.

New behaviour (this version): both happen inside a single transaction.
On success → committed. On failure → rolled back.

## Error Handling

| Class | Source | Action |
|-------|--------|--------|
| `requests.exceptions.RequestException` | Network | Log + return `None`; nothing written |
| `json.JSONDecodeError` | API | Log + return `None`; nothing written |
| `sqlite3.Error` | DB layer | Transaction rolled back; previous data preserved |

## Exit Codes

- **0** — All stops fetched and saved
- **1** — Network error, JSON error, or DB save error

## Logging

Standard `logging` at `INFO` level. Co-shared with `db_utils.py`.

```
2026-05-06 22:14:01 - INFO - Fetching stops data from API...
2026-05-06 22:14:02 - INFO - ✓ Successfully fetched 3841 stops
2026-05-06 22:14:02 - INFO - Truncating table stops (removing old data)...
2026-05-06 22:14:02 - INFO - ✓ Successfully saved 3841 stops to database
```

## Inspecting the Result

```bash
sqlite3 data/ayna.sqlite "SELECT COUNT(*) FROM stops;"
sqlite3 data/ayna.sqlite "SELECT * FROM stops LIMIT 5;"
sqlite3 data/ayna.sqlite "SELECT * FROM stops WHERE is_transport_hub = 1;"
npm run inspect-data
```

## Troubleshooting

### `Table 'stops' does not exist. Run migrations first.`
Run:
```bash
python scripts/run_migrations.py
```

### `Could not parse coordinate: …`
Non-fatal; the row is dropped or stored as `NULL`. The new parser also
warns when the value is out of `[-180, 180]` range so format drift is
visible immediately.

### API timeout
Try again — the upstream API can be slow. The 30 s timeout is a code
constant; bump if needed.

## Related Files

- `scripts/db_utils.py` — Connection, helpers, coordinate parser
- `scripts/run_migrations.py` — Schema setup
- `scripts/busDetails.py` — Populates `stop_details` (the bigger sibling)
- `migrations/001_initial_schema.sql` — Schema definition
