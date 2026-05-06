# run_migrations.py

## Overview

Migration runner that creates the local **SQLite** schema for the Baku
Bus Route Dashboard. Reads every `*.sql` file under `migrations/` in
lexical order and applies it via `sqlite3.Connection.executescript()`.

> Historical note: this script used to target Postgres via psycopg2.
> It has been ported to stdlib `sqlite3` and the `ayna.` schema prefix
> has been dropped (SQLite has no schemas).

## Usage

```bash
python scripts/run_migrations.py
```

By default the script writes to `./data/ayna.sqlite`. Override with the
`SQLITE_DB_PATH` environment variable:

```bash
SQLITE_DB_PATH=/var/lib/baku-bus/ayna.sqlite python scripts/run_migrations.py
```

The directory of `SQLITE_DB_PATH` is auto-created if missing.

### Expected output

```
============================================================
Starting database migrations
============================================================
Database file: /…/best_route_finding/data/ayna.sqlite
Found 1 migration file(s)
Running migration: 001_initial_schema.sql
✓ Migration 001_initial_schema.sql completed successfully

============================================================
All migrations completed successfully!
============================================================

Verifying database schema...
Found 9 table(s): ['bus_stops', 'buses', 'payment_types', 'regions',
                   'route_coordinates', 'routes', 'stop_details', 'stops',
                   'working_zone_types']
  ✓ Table payment_types exists
  ✓ Table regions exists
  ✓ Table working_zone_types exists
  ✓ Table stops exists
  ✓ Table stop_details exists
  ✓ Table buses exists
  ✓ Table bus_stops exists
  ✓ Table routes exists
  ✓ Table route_coordinates exists
Found 2 view(s): ['v_bus_stops_details', 'v_buses_complete']
✓ Schema verification complete

✓ Database is ready!
```

## Migration File Layout

```
migrations/
├── 001_initial_schema.sql
├── 002_future_migration.sql
└── ...
```

**Naming convention:**
- numeric prefix for ordering (`001_`, `002_`, `003_`)
- descriptive name (`001_initial_schema.sql`)
- files run in lexical order

## Functions

### `run_migration_file(migration_file: Path) -> bool`
Reads a single SQL file (UTF-8) and runs it through
`sqlite3.Connection.executescript()`, which can handle multiple
statements separated by semicolons.

### `run_all_migrations() -> bool`
Discovers `migrations/*.sql`, sorts lexically, runs each file in turn
through `run_migration_file`. Stops on the first failure.

### `verify_schema() -> bool`
Asserts that every expected table is present (`payment_types`,
`regions`, `working_zone_types`, `stops`, `stop_details`, `buses`,
`bus_stops`, `routes`, `route_coordinates`) and lists the views.

## Idempotency

The `001_initial_schema.sql` migration is idempotent:
- `CREATE TABLE IF NOT EXISTS …`
- `CREATE INDEX IF NOT EXISTS …`
- `DROP VIEW IF EXISTS … ; CREATE VIEW …`
- `PRAGMA foreign_keys = ON`

Running it a second time over an already-initialised database is a
no-op.

## Adding a new migration

1. Create a numbered file:
   ```bash
   touch migrations/002_add_feature.sql
   ```
2. Write idempotent SQL (`CREATE … IF NOT EXISTS`, `ALTER TABLE …`, etc.).
3. Test locally:
   ```bash
   python scripts/run_migrations.py
   ```
4. Commit.

## Rollback

Because the database is a single file, the simplest rollback is to
delete it and re-run migrations + scrapers:

```bash
rm data/ayna.sqlite
python scripts/run_migrations.py
python scripts/stops.py
python scripts/busDetails.py
```

For a non-destructive snapshot before risky migrations:

```bash
cp data/ayna.sqlite data/ayna.sqlite.bak
```

## Exit Codes

- **0** — All migrations completed successfully
- **1** — Migration failure or schema verification failure

## Logging

Standard Python `logging` module at `INFO` level. Uses the same logger
as `db_utils.py`.

## Related Files

- `migrations/001_initial_schema.sql` — Initial schema
- `scripts/db_utils.py` — Shared SQLite helpers
- `scripts/stops.py`, `scripts/busDetails.py` — Scrapers that populate
  the schema
