# db_utils.py

## Overview

Shared SQLite helper module for the Python scrapers. Provides a single
process-wide connection, atomic transaction management, query helpers,
and a defensive coordinate parser.

> Historical note: this module used to wrap psycopg2 with a connection
> pool. It now wraps stdlib `sqlite3` directly — SQLite is a single
> file, so a single connection per process is the right primitive.

## Configuration

The database file path defaults to `./data/ayna.sqlite` (relative to the
project root). Override via the `SQLITE_DB_PATH` environment variable:

```bash
SQLITE_DB_PATH=/var/lib/baku-bus/ayna.sqlite python scripts/stops.py
```

The directory of `SQLITE_DB_PATH` is auto-created on first connection.

## Connection Management

### `get_connection() -> sqlite3.Connection`

Returns the process-wide connection, opening it on first use with these
pragmas:
- `PRAGMA foreign_keys = ON` — enforce FK constraints
- `PRAGMA journal_mode = WAL` — Write-Ahead Logging for better concurrency
- `PRAGMA synchronous = NORMAL` — fsync less aggressively (safe with WAL)

The connection is opened with `isolation_level=None` so transactions are
driven explicitly by the `transaction()` context manager.

### `close_connection()`

Closes the shared connection. Call once at the end of a script's
lifetime. Both scrapers do this in their `main()`.

### Backwards-compat aliases

`init_connection_pool`, `release_connection`, `close_all_connections`
still exist for any caller that might still use them — they're now
no-ops or thin wrappers around `get_connection`/`close_connection`.

## Transactions

### `transaction()` (context manager)

Atomic write block. If the body raises, the transaction rolls back; on
clean exit it commits.

```python
from db_utils import transaction, execute_values, truncate_table

with transaction():
    truncate_table("stops")
    execute_values(
        "INSERT INTO stops (id, longitude, latitude, is_transport_hub) VALUES (?, ?, ?, ?)",
        rows,
    )
```

This is what makes ingest atomic: a network failure or a bad row
mid-load leaves the on-disk database untouched.

## Query Helpers

All helpers use `?` placeholders (sqlite3 default).

### `execute_query(query, params=None, fetch=False, commit=True) -> list[Row] | None`

Run a single SQL statement.

### `execute_many(query, data, commit=True) -> int`

Bulk insert via `cursor.executemany`. Returns row count.

### `execute_values(query, data, page_size=1000) -> int`

Postgres-API-compatible alias for `execute_many`. The `page_size` is
ignored — sqlite3 handles batching internally.

### `fetch_one(query, params=None) -> Row | None`
### `fetch_all(query, params=None) -> list[Row]`

Plain wrappers around the corresponding cursor methods. Rows are
returned as `sqlite3.Row` objects (dict-like access by name).

### `table_exists(table_name) -> bool`

Looks up `sqlite_master` for a table of that name.

### `truncate_table(table_name) -> None`

Issues `DELETE FROM <table>`. CASCADE is implicit — `ON DELETE CASCADE`
on the FK definitions handles dependent rows.

### `get_row_count(table_name) -> int`

Returns `COUNT(*)` from the table.

### `upsert_reference_data(table_name, data: list[dict]) -> int`

Insert-or-update the lookup tables (`payment_types`, `regions`,
`working_zone_types`). Uses SQLite's UPSERT syntax:

```sql
INSERT INTO <table> (id, name, description, is_active, deactived_date, priority)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    is_active = excluded.is_active,
    deactived_date = excluded.deactived_date,
    priority = excluded.priority
```

## Coordinate Parsing

### `parse_coordinate(value) -> float | None`

Converts an Ayna-API coordinate value into a validated float in
`[-180, 180]`. Accepts:

| Input | Output |
|-------|--------|
| `49.961721` (number) | `49.961721` |
| `"49.961721"` (period decimal) | `49.961721` |
| `"49,961721"` (comma decimal) | `49.961721` |
| `"49,961,721"` (Ayna grouped form — first group = degrees) | `49.961721` |
| `"-49.961721"` | `-49.961721` |
| `""` / `None` / `"junk"` | `None` |
| `"999.0"` (out of range) | `None` |

Out-of-range and unparseable values produce a `WARNING` log and return
`None` so downstream `NOT NULL` constraints fail loudly.

> The previous parser stripped all separators and re-inserted a decimal
> at a hardcoded position — it would silently corrupt anything that
> wasn't already in Baku-shaped form. The new parser tries the obvious
> formats in order and bounds-checks the result.

## Connection Test

### `test_connection() -> bool`

Returns the SQLite version via `SELECT sqlite_version()`. Useful smoke
test:

```bash
python scripts/db_utils.py
```

Output:

```
Database file: /…/best_route_finding/data/ayna.sqlite
✓ Database connection successful!
✓ Schema is initialised
```

## Usage Example

```python
from db_utils import (
    test_connection,
    transaction,
    execute_values,
    truncate_table,
    parse_coordinate,
    get_row_count,
    close_connection,
)

if not test_connection():
    raise SystemExit("DB unreachable")

rows = [
    (1, parse_coordinate("49,961721"), parse_coordinate("40,43885"), 0),
    (2, 49.9574, 40.3758, 0),
]

with transaction():
    truncate_table("stops")
    execute_values(
        "INSERT INTO stops (id, longitude, latitude, is_transport_hub) VALUES (?, ?, ?, ?)",
        rows,
    )

print(f"stops: {get_row_count('stops')}")
close_connection()
```

## Dependencies

Stdlib only — `sqlite3`, `pathlib`, `os`, `re`, `logging`,
`contextlib`, `typing`. There are no third-party dependencies for the
database layer.

## Related Files

- `migrations/001_initial_schema.sql` — Schema definition
- `scripts/run_migrations.py` — Migration runner
- `scripts/stops.py` — Stops scraper
- `scripts/busDetails.py` — Bus details scraper
