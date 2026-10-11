"""
Database utility module for Baku Bus Route Dashboard (SQLite edition).

Replaces the previous psycopg2/Postgres helpers. The whole module now uses
the stdlib ``sqlite3`` driver against a local file (default ``./data/ayna.sqlite``).

Highlights:
    * One process-wide connection (``get_connection``); SQLite is single-file,
      so no pool is needed — closes #9 ("SimpleConnectionPool has no timeout").
    * ``transaction()`` context manager for atomic ingest — closes #3
      ("partial ingestion possible").
    * ``parse_coordinate`` is now strict & defensive — closes #2
      (coordinate parser silently corrupted input on format drift).
"""

import logging
import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "ayna.sqlite"
DB_PATH = Path(os.getenv("SQLITE_DB_PATH", str(DEFAULT_DB_PATH))).resolve()

_connection: Optional[sqlite3.Connection] = None


# ---------------------------------------------------------------------------
# Coordinate parsing (replaces fragile per-script copies)
# ---------------------------------------------------------------------------

# Plausible Earth coordinate range. Anything else is treated as garbage.
_COORD_MIN = -180.0
_COORD_MAX = 180.0


def parse_coordinate(value: Any) -> Optional[float]:
    """Parse a latitude/longitude value coming from the Ayna API.

    Accepts the formats observed in production data:
        * ``49.961721``           -> period decimal (clean)
        * ``"49.961721"``         -> string period decimal
        * ``"49,961721"``         -> comma decimal (some EU locales)
        * ``"49,961,721"``        -> Ayna "grouped" form meaning 49.961721
        * ``"4,049,233"``         -> grouped form with five decimals: 40.49233
        * ``49`` / ``"49"``       -> bare integer degree

    Returns ``None`` for empty input or anything outside ``[-180, 180]`` so
    downstream NOT NULL constraints fail loudly rather than silently storing
    corrupted coordinates.
    """
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return _validate(float(value))

    s = str(value).strip()
    if not s:
        return None

    # 1) plain float (handles "49.961721" and "49")
    try:
        return _validate(float(s))
    except ValueError:
        pass

    # 2) comma decimal: a single comma, no period, e.g. "49,961721"
    if s.count(",") == 1 and "." not in s:
        try:
            return _validate(float(s.replace(",", ".")))
        except ValueError:
            pass

    # Ayna groups the digits after removing the decimal point. Baku coordinates
    # have two degree digits, even when five decimals leave a one-digit group.
    if re.fullmatch(r"-?\d{1,3}(?:,\d{3}){2,}", s):
        sign = -1.0 if s.startswith("-") else 1.0
        digits = s.lstrip("-").replace(",", "")
        coordinate = float(f"{digits[:2]}.{digits[2:]}")
        # The grouped notation is ambiguous outside the source's region.
        # Ordinary numeric, period-decimal and comma-decimal inputs stay global.
        if 38 <= coordinate <= 51:
            return _validate(sign * coordinate)

    logger.warning("Could not parse coordinate: %r", value)
    return None


def _validate(val: float) -> Optional[float]:
    if _COORD_MIN <= val <= _COORD_MAX:
        return val
    logger.warning("Coordinate %s out of range [%s, %s]", val, _COORD_MIN, _COORD_MAX)
    return None


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

def get_connection() -> sqlite3.Connection:
    """Return the process-wide SQLite connection, opening it on first use."""
    global _connection
    if _connection is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(
            str(DB_PATH),
            timeout=30.0,             # wait up to 30s for write locks
            isolation_level=None,     # autocommit; we drive transactions explicitly
        )
        _connection.row_factory = sqlite3.Row
        _connection.execute("PRAGMA foreign_keys = ON")
        _connection.execute("PRAGMA journal_mode = WAL")
        _connection.execute("PRAGMA synchronous = NORMAL")
        logger.info("Opened SQLite database: %s", DB_PATH)
    return _connection


def close_connection() -> None:
    global _connection
    if _connection is not None:
        _connection.close()
        _connection = None
        logger.info("Closed SQLite database")


# Backwards-compat aliases (older scripts may still call these).
init_connection_pool = lambda *_args, **_kwargs: get_connection()  # noqa: E731
close_all_connections = close_connection
release_connection = lambda _conn: None  # connection is shared, nothing to release  # noqa: E731


@contextmanager
def transaction():
    """Atomic write block. Rolls back on any exception so a failed scrape leaves the DB unchanged.

    Used by the bus-details ingest to fix the "partial ingestion possible" bug.
    """
    conn = get_connection()
    conn.execute("BEGIN")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def execute_query(
    query: str,
    params: Optional[Sequence[Any]] = None,
    fetch: bool = False,
    commit: bool = True,
) -> Optional[List[sqlite3.Row]]:
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(query, params or ())
        return cur.fetchall() if fetch else None
    finally:
        cur.close()


def execute_many(query: str, data: Iterable[Sequence[Any]], commit: bool = True) -> int:
    """Bulk insert via ``cursor.executemany``. Use ``?`` placeholders."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.executemany(query, list(data))
        rowcount = cur.rowcount
        logger.info("Bulk insert: %s rows affected", rowcount)
        return rowcount
    finally:
        cur.close()


# Postgres-API-compatible alias. The page_size argument is ignored — sqlite3
# handles batching internally.
def execute_values(query: str, data: Iterable[Sequence[Any]], page_size: int = 1000) -> int:  # noqa: ARG001
    return execute_many(query, data)


def fetch_one(query: str, params: Optional[Sequence[Any]] = None) -> Optional[sqlite3.Row]:
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(query, params or ())
        return cur.fetchone()
    finally:
        cur.close()


def fetch_all(query: str, params: Optional[Sequence[Any]] = None) -> List[sqlite3.Row]:
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(query, params or ())
        return cur.fetchall()
    finally:
        cur.close()


def table_exists(table_name: str, schema: Optional[str] = None) -> bool:  # noqa: ARG001
    """Check if a table exists. ``schema`` arg is kept for API compat and ignored (SQLite has no schemas)."""
    row = fetch_one(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    )
    return row is not None


def truncate_table(table_name: str, schema: Optional[str] = None, cascade: bool = False) -> None:  # noqa: ARG001
    """Empty a table. ``cascade`` is implicit — FK ON DELETE CASCADE handles it."""
    execute_query(f"DELETE FROM {table_name}")
    logger.info("Table %s truncated", table_name)


def get_row_count(table_name: str, schema: Optional[str] = None) -> int:  # noqa: ARG001
    row = fetch_one(f"SELECT COUNT(*) AS c FROM {table_name}")
    return row["c"] if row else 0


def upsert_reference_data(
    table_name: str,
    data: List[Dict[str, Any]],
    schema: Optional[str] = None,  # noqa: ARG001
) -> int:
    """INSERT ... ON CONFLICT DO UPDATE for the lookup tables (payment_types, regions, working_zone_types)."""
    if not data:
        return 0

    columns = ["id", "name", "description", "is_active", "deactived_date", "priority"]
    placeholders = ", ".join(["?"] * len(columns))
    columns_str = ", ".join(columns)
    update_clause = ", ".join(f"{c} = excluded.{c}" for c in columns if c != "id")

    query = (
        f"INSERT INTO {table_name} ({columns_str}) VALUES ({placeholders}) "
        f"ON CONFLICT(id) DO UPDATE SET {update_clause}"
    )

    rows: List[Tuple[Any, ...]] = []
    for item in data:
        rows.append(
            (
                item["id"],
                item.get("name"),
                item.get("description"),
                1 if item.get("isActive", True) else 0,
                item.get("deactivedDate"),
                item.get("priority"),
            )
        )
    return execute_many(query, rows)


def test_connection() -> bool:
    try:
        row = fetch_one("SELECT sqlite_version() AS v")
        if row:
            logger.info("Database connection successful")
            logger.info("SQLite version: %s", row["v"])
            return True
        return False
    except Exception as exc:  # pragma: no cover
        logger.error("Database connection failed: %s", exc)
        return False


if __name__ == "__main__":
    print(f"Database file: {DB_PATH}")
    if test_connection():
        print("✓ Database connection successful!")
        if table_exists("buses"):
            print("✓ Schema is initialised")
        else:
            print("✗ Schema is not initialised — run `python scripts/run_migrations.py`")
    else:
        print("✗ Database connection failed!")
    close_connection()
