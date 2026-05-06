"""
Migration runner script for Baku Bus Route Dashboard (SQLite edition).

Reads every ``*.sql`` file under ``./migrations/`` in lexical order and applies
it to the local SQLite database (default: ``./data/ayna.sqlite``; override with
``SQLITE_DB_PATH``).

Note that SQLite has no concept of a schema — the previous ``ayna`` schema
prefix has been dropped and tables now live in the default namespace.
"""

import logging
import sys
from pathlib import Path

from db_utils import (
    DB_PATH,
    close_connection,
    execute_query,
    fetch_all,
    fetch_one,
    get_connection,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


EXPECTED_TABLES = [
    "payment_types",
    "regions",
    "working_zone_types",
    "stops",
    "stop_details",
    "buses",
    "bus_stops",
    "routes",
    "route_coordinates",
]


def run_migration_file(migration_file: Path) -> bool:
    try:
        logger.info("Running migration: %s", migration_file.name)
        sql = migration_file.read_text(encoding="utf-8")

        conn = get_connection()
        # Migration files contain multiple statements; executescript handles those.
        conn.executescript(sql)

        logger.info("✓ Migration %s completed successfully", migration_file.name)
        return True
    except Exception as exc:
        logger.error("✗ Migration %s failed: %s", migration_file.name, exc)
        return False


def run_all_migrations() -> bool:
    project_root = Path(__file__).resolve().parent.parent
    migrations_dir = project_root / "migrations"

    if not migrations_dir.exists():
        logger.error("Migrations directory not found: %s", migrations_dir)
        return False

    migration_files = sorted(migrations_dir.glob("*.sql"))
    if not migration_files:
        logger.warning("No migration files found")
        return True

    logger.info("Database file: %s", DB_PATH)
    logger.info("Found %s migration file(s)", len(migration_files))

    for migration_file in migration_files:
        if not run_migration_file(migration_file):
            return False

    return True


def verify_schema() -> bool:
    rows = fetch_all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    existing = {r["name"] for r in rows}
    logger.info("Found %d table(s): %s", len(existing), sorted(existing))

    missing = set(EXPECTED_TABLES) - existing
    if missing:
        logger.error("Missing tables: %s", missing)
        return False

    for table in EXPECTED_TABLES:
        logger.info("  ✓ Table %s exists", table)

    views = fetch_all("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
    view_names = [v["name"] for v in views]
    logger.info("Found %d view(s): %s", len(view_names), view_names)

    logger.info("✓ Schema verification complete")
    return True


def main() -> int:
    logger.info("=" * 60)
    logger.info("Starting database migrations")
    logger.info("=" * 60)

    if not run_all_migrations():
        logger.error("\n✗ Migrations failed")
        close_connection()
        return 1

    logger.info("\n" + "=" * 60)
    logger.info("All migrations completed successfully!")
    logger.info("=" * 60)

    logger.info("\nVerifying database schema...")
    ok = verify_schema()
    close_connection()

    if ok:
        logger.info("\n✓ Database is ready!")
        return 0
    logger.error("\n✗ Schema verification failed")
    return 1


if __name__ == "__main__":
    sys.exit(main())
