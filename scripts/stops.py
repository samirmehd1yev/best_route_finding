"""
Fetch all bus stop data from the Ayna Transport API and save to local SQLite.

This script retrieves comprehensive information about all public transport stops
in the Baku transportation system and stores them in the local SQLite database
(default ``./data/ayna.sqlite``; override with ``SQLITE_DB_PATH``).

API Endpoint: https://map-api.ayna.gov.az/api/stop/getAll
Database Table: stops
"""

import json
import logging
import sys
from typing import Any, Dict, List, Optional

import requests

from db_utils import (
    close_connection,
    execute_values,
    get_row_count,
    parse_coordinate,
    table_exists,
    test_connection,
    transaction,
    truncate_table,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

API_BASE_URL = "https://map-api.ayna.gov.az/api"
STOPS_ENDPOINT = f"{API_BASE_URL}/stop/getAll"


def fetch_stops() -> Optional[List[Dict[str, Any]]]:
    try:
        logger.info("Fetching stops data from API...")
        logger.info("URL: %s", STOPS_ENDPOINT)

        response = requests.get(STOPS_ENDPOINT, timeout=30)
        response.raise_for_status()

        data = response.json()
        if isinstance(data, list):
            logger.info("✓ Successfully fetched %d stops", len(data))
            return data
        logger.error("Unexpected response format (expected list)")
        return None

    except requests.exceptions.RequestException as exc:
        logger.error("✗ Network error: %s", exc)
        return None
    except json.JSONDecodeError as exc:
        logger.error("✗ JSON decode error: %s", exc)
        return None


def save_stops_to_db(stops: List[Dict[str, Any]]) -> bool:
    """Replace the entire ``stops`` table atomically."""
    if not table_exists("stops"):
        logger.error("Table 'stops' does not exist. Run migrations first.")
        return False

    try:
        # Single transaction: truncate + insert. If any row fails to bind, the
        # whole replacement rolls back and the database is left in its prior state.
        with transaction():
            logger.info("Truncating table stops (removing old data)...")
            truncate_table("stops")

            logger.info("Preparing data for database insert...")
            data_tuples = []
            for stop in stops:
                longitude = parse_coordinate(stop.get("longitude"))
                latitude = parse_coordinate(stop.get("latitude"))
                data_tuples.append(
                    (
                        stop["id"],
                        longitude,
                        latitude,
                        1 if stop.get("isTransportHub", False) else 0,
                    )
                )

            logger.info("Inserting %d stops into database...", len(data_tuples))
            query = """
                INSERT INTO stops (id, longitude, latitude, is_transport_hub)
                VALUES (?, ?, ?, ?)
            """
            rows_affected = execute_values(query, data_tuples)
            logger.info("✓ Successfully saved %d stops to database", rows_affected)

        total_rows = get_row_count("stops")
        logger.info("Total stops in database: %s", total_rows)
        return True

    except Exception as exc:
        logger.error("✗ Error saving stops to database: %s", exc)
        return False


def get_statistics(stops: List[Dict[str, Any]]) -> None:
    logger.info("=" * 60)
    logger.info("STOPS DATA STATISTICS")
    logger.info("=" * 60)

    total = len(stops)
    transport_hubs = sum(1 for s in stops if s.get("isTransportHub"))
    logger.info("Total stops: %d", total)
    logger.info("Transport hubs: %d", transport_hubs)
    logger.info("Regular stops: %d", total - transport_hubs)

    with_coords = sum(1 for s in stops if s.get("longitude") and s.get("latitude"))
    logger.info("Stops with coordinates: %d (%.1f%%)", with_coords, with_coords / total * 100)
    logger.info("=" * 60)


def main() -> int:
    logger.info("=" * 60)
    logger.info("BAKU BUS STOPS DATA FETCHER")
    logger.info("=" * 60)

    logger.info("\nTesting database connection...")
    if not test_connection():
        logger.error("✗ Database connection failed!")
        logger.info("Tip: ensure the SQLite file exists. Run `python scripts/run_migrations.py` first.")
        return 1

    stops = fetch_stops()
    if not stops:
        logger.error("✗ Failed to fetch stops data")
        close_connection()
        return 1

    get_statistics(stops)

    logger.info("\nSaving stops to database (will replace existing data)...")
    success = save_stops_to_db(stops)
    close_connection()

    if success:
        logger.info("\n" + "=" * 60)
        logger.info("✓ ALL OPERATIONS COMPLETED SUCCESSFULLY!")
        logger.info("=" * 60)
        return 0

    logger.error("✗ Failed to save stops to database")
    logger.info("\nTip: Make sure you've run migrations first:")
    logger.info("  python scripts/run_migrations.py")
    return 1


if __name__ == "__main__":
    sys.exit(main())
