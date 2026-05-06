"""
Fetch detailed information for all bus routes and save to local SQLite.

This script retrieves comprehensive route information including stops, coordinates,
fare information, and carrier details for all buses in the Baku public transportation
system, then writes everything to ``./data/ayna.sqlite`` (override with
``SQLITE_DB_PATH``).

API Endpoints:
    * Bus List:    https://map-api.ayna.gov.az/api/bus/getBusList
    * Bus Details: https://map-api.ayna.gov.az/api/bus/getBusById?id={bus_id}

Database Tables: payment_types, regions, working_zone_types, buses,
                 stop_details, bus_stops, routes, route_coordinates

Atomicity: the entire database load (reference tables → stops → buses → bus_stops
→ routes → route_coordinates) runs inside a single transaction.  If any step
fails, the database is rolled back to its prior state — no more "partial
ingestion possible".
"""

import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional

import requests

from db_utils import (
    close_connection,
    execute_values,
    get_row_count,
    parse_coordinate,
    test_connection,
    transaction,
    truncate_table,
    upsert_reference_data,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

API_BASE_URL = "https://map-api.ayna.gov.az/api"
BUS_LIST_ENDPOINT = f"{API_BASE_URL}/bus/getBusList"
BUS_DETAILS_ENDPOINT = f"{API_BASE_URL}/bus/getBusById"


# ---------------------------------------------------------------------------
# API fetchers
# ---------------------------------------------------------------------------

def fetch_bus_list() -> Optional[List[Dict[str, Any]]]:
    try:
        logger.info("Fetching bus list from API...")
        logger.info("URL: %s", BUS_LIST_ENDPOINT)
        response = requests.get(BUS_LIST_ENDPOINT, timeout=30)
        response.raise_for_status()
        bus_list = response.json()
        logger.info("✓ Successfully fetched %d buses", len(bus_list))
        return bus_list
    except requests.exceptions.RequestException as exc:
        logger.error("✗ Network error: %s", exc)
        return None
    except json.JSONDecodeError as exc:
        logger.error("✗ JSON decode error: %s", exc)
        return None


def fetch_bus_details(bus_id: int) -> Optional[Dict[str, Any]]:
    url = f"{BUS_DETAILS_ENDPOINT}?id={bus_id}"
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as exc:
        logger.error("  ✗ Error: %s", exc)
        return None
    except json.JSONDecodeError as exc:
        logger.error("  ✗ JSON decode error: %s", exc)
        return None


# Maximum tolerated fraction of failed bus fetches before we refuse to ingest.
# Default 0.05 = 5%. The upstream API is known to return persistent 500s for a
# tiny minority of bus IDs (e.g. id 96), and refusing to ingest at all in that
# case would mean the DB never gets updated. Override with FAILURE_THRESHOLD.
_DEFAULT_FAILURE_FRACTION = 0.05


def fetch_all_bus_details() -> Optional[List[Dict[str, Any]]]:
    bus_list = fetch_bus_list()
    if not bus_list:
        logger.error("Failed to fetch bus list")
        return None

    all_bus_details: List[Dict[str, Any]] = []
    failures: List[int] = []
    total_buses = len(bus_list)

    logger.info("\nFetching details for %d buses...", total_buses)
    logger.info("=" * 60)

    for idx, bus in enumerate(bus_list, 1):
        bus_id = bus["id"]
        bus_number = bus["number"]
        logger.info("[%d/%d] Fetching bus #%s (ID: %s)...", idx, total_buses, bus_number, bus_id)

        details = fetch_bus_details(bus_id)
        if details:
            all_bus_details.append(details)
            logger.info("  ✓ Success")
        else:
            failures.append(bus_id)
            logger.warning("  ✗ Failed")

        time.sleep(0.1)  # rate limiting

    logger.info("=" * 60)
    logger.info(
        "Successfully fetched details for %d/%d buses",
        len(all_bus_details),
        total_buses,
    )

    if not all_bus_details:
        logger.error("Aborting ingest: every bus fetch failed")
        return None

    # If failures are above threshold, refuse the ingest — something has likely
    # gone wrong upstream and we don't want to wipe out the DB to replace it
    # with a partial copy. Atomicity at the DB layer is still guaranteed by the
    # surrounding transaction in save_all().
    threshold_str = os.getenv("FAILURE_THRESHOLD")
    try:
        threshold = float(threshold_str) if threshold_str else _DEFAULT_FAILURE_FRACTION
    except ValueError:
        threshold = _DEFAULT_FAILURE_FRACTION

    failure_rate = len(failures) / total_buses
    if failure_rate > threshold:
        logger.error(
            "Aborting ingest: %d/%d (%.1f%%) bus fetches failed — above threshold %.1f%%. "
            "Failed IDs: %s",
            len(failures), total_buses, failure_rate * 100, threshold * 100, failures,
        )
        return None

    if failures:
        logger.warning(
            "Continuing with partial data: %d/%d failed bus(es) tolerated under %.1f%% threshold. "
            "Failed IDs: %s",
            len(failures), total_buses, threshold * 100, failures,
        )

    return all_bus_details


# ---------------------------------------------------------------------------
# Per-table savers (called inside a single transaction)
# ---------------------------------------------------------------------------

def _save_reference_tables(all_buses: List[Dict[str, Any]]) -> None:
    logger.info("\nSaving reference tables...")
    payment_types: Dict[int, Dict[str, Any]] = {}
    regions: Dict[int, Dict[str, Any]] = {}
    working_zone_types: Dict[int, Dict[str, Any]] = {}

    for bus in all_buses:
        if bus.get("paymentType"):
            pt = bus["paymentType"]
            payment_types[pt["id"]] = pt
        if bus.get("region"):
            r = bus["region"]
            regions[r["id"]] = r
        if bus.get("workingZoneType"):
            wzt = bus["workingZoneType"]
            working_zone_types[wzt["id"]] = wzt

    logger.info("  - payment_types: %d records", len(payment_types))
    upsert_reference_data("payment_types", list(payment_types.values()))
    logger.info("  - regions: %d records", len(regions))
    upsert_reference_data("regions", list(regions.values()))
    logger.info("  - working_zone_types: %d records", len(working_zone_types))
    upsert_reference_data("working_zone_types", list(working_zone_types.values()))


def _save_stop_details(all_buses: List[Dict[str, Any]]) -> None:
    logger.info("\nSaving stop details...")
    truncate_table("stop_details")

    stops_dict: Dict[int, Dict[str, Any]] = {}
    for bus in all_buses:
        for bus_stop in bus.get("stops", []):
            stop = bus_stop.get("stop")
            if stop and stop["id"] not in stops_dict:
                stops_dict[stop["id"]] = stop

    rows: List[tuple] = []
    for stop in stops_dict.values():
        longitude = parse_coordinate(stop.get("longitude"))
        latitude = parse_coordinate(stop.get("latitude"))
        rows.append(
            (
                stop["id"],
                stop.get("code"),
                stop.get("name"),
                stop.get("nameMonitor"),
                stop.get("utmCoordX"),
                stop.get("utmCoordY"),
                longitude,
                latitude,
                1 if stop.get("isTransportHub", False) else 0,
            )
        )

    query = """
        INSERT INTO stop_details
        (id, code, name, name_monitor, utm_coord_x, utm_coord_y,
         longitude, latitude, is_transport_hub)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    rows_affected = execute_values(query, rows)
    logger.info("✓ Saved %d stop details", rows_affected)


def _save_buses(all_buses: List[Dict[str, Any]]) -> None:
    logger.info("\nSaving buses...")
    truncate_table("buses")

    rows = []
    for bus in all_buses:
        rows.append(
            (
                bus["id"],
                bus.get("carrier"),
                bus.get("number"),
                bus.get("firstPoint"),
                bus.get("lastPoint"),
                float(bus["routLength"]) if bus.get("routLength") else None,
                bus.get("paymentTypeId"),
                bus.get("cardPaymentDate"),
                bus.get("tariff"),
                bus.get("tariffStr"),
                bus.get("regionId"),
                bus.get("workingZoneTypeId"),
                bus.get("durationMinuts"),
            )
        )

    query = """
        INSERT INTO buses
        (id, carrier, number, first_point, last_point, route_length,
         payment_type_id, card_payment_date, tariff, tariff_str,
         region_id, working_zone_type_id, duration_minuts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    rows_affected = execute_values(query, rows)
    logger.info("✓ Saved %d buses", rows_affected)


def _save_bus_stops(all_buses: List[Dict[str, Any]]) -> None:
    logger.info("\nSaving bus stops...")
    truncate_table("bus_stops")

    rows = []
    for bus in all_buses:
        for bus_stop in bus.get("stops", []):
            rows.append(
                (
                    bus_stop["id"],
                    bus_stop["busId"],
                    bus_stop["stopId"],
                    bus_stop.get("stopCode"),
                    bus_stop.get("stopName"),
                    float(bus_stop["totalDistance"]) if bus_stop.get("totalDistance") else None,
                    float(bus_stop["intermediateDistance"]) if bus_stop.get("intermediateDistance") else None,
                    bus_stop["directionTypeId"],
                )
            )

    query = """
        INSERT INTO bus_stops
        (bus_stop_id, bus_id, stop_id, stop_code, stop_name,
         total_distance, intermediate_distance, direction_type_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """
    rows_affected = execute_values(query, rows)
    logger.info("✓ Saved %d bus stops", rows_affected)


def _save_routes(all_buses: List[Dict[str, Any]]) -> None:
    logger.info("\nSaving routes...")
    truncate_table("routes")

    rows = []
    for bus in all_buses:
        for route in bus.get("routes", []):
            rows.append(
                (
                    route["id"],
                    route.get("code"),
                    route.get("customerName"),
                    route.get("type"),
                    route.get("name"),
                    route.get("destination"),
                    route.get("variant"),
                    route.get("operator"),
                    route["busId"],
                    route["directionTypeId"],
                )
            )

    query = """
        INSERT INTO routes
        (id, code, customer_name, type, name, destination, variant,
         operator, bus_id, direction_type_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    rows_affected = execute_values(query, rows)
    logger.info("✓ Saved %d routes", rows_affected)


def _save_route_coordinates(all_buses: List[Dict[str, Any]]) -> None:
    logger.info("\nSaving route coordinates...")
    truncate_table("route_coordinates")

    rows = []
    for bus in all_buses:
        for route in bus.get("routes", []):
            route_id = route["id"]
            for idx, coord in enumerate(route.get("flowCoordinates", [])):
                lat = parse_coordinate(coord.get("lat"))
                lng = parse_coordinate(coord.get("lng"))
                rows.append((route_id, lat, lng, idx + 1))

    logger.info("  Inserting %d coordinate points...", len(rows))
    query = """
        INSERT INTO route_coordinates
        (route_id, latitude, longitude, sequence_order)
        VALUES (?, ?, ?, ?)
    """
    rows_affected = execute_values(query, rows)
    logger.info("✓ Saved %d route coordinates", rows_affected)


def save_all(all_buses: List[Dict[str, Any]]) -> bool:
    """Persist every table inside one atomic transaction."""
    try:
        with transaction():
            _save_reference_tables(all_buses)
            _save_stop_details(all_buses)
            _save_buses(all_buses)
            _save_bus_stops(all_buses)
            _save_routes(all_buses)
            _save_route_coordinates(all_buses)
        return True
    except Exception as exc:
        logger.error("✗ Ingest failed and was rolled back: %s", exc)
        return False


def get_statistics(all_buses: List[Dict[str, Any]]) -> None:
    logger.info("=" * 60)
    logger.info("BUS DATA STATISTICS")
    logger.info("=" * 60)
    total_buses = len(all_buses)
    carriers = {b.get("carrier") for b in all_buses if b.get("carrier")}
    total_stops = sum(len(b.get("stops", [])) for b in all_buses)
    total_routes = sum(len(b.get("routes", [])) for b in all_buses)
    total_coordinates = sum(
        len(r.get("flowCoordinates", []))
        for b in all_buses
        for r in b.get("routes", [])
    )
    logger.info("Total buses: %d", total_buses)
    logger.info("Unique carriers: %d", len(carriers))
    logger.info("Total bus stops entries: %d", total_stops)
    logger.info("Total routes: %d", total_routes)
    logger.info("Total coordinate points: %d", total_coordinates)
    logger.info("=" * 60)


def main() -> int:
    logger.info("=" * 60)
    logger.info("BAKU BUS DETAILS DATA FETCHER & DATABASE LOADER")
    logger.info("=" * 60)

    logger.info("\nTesting database connection...")
    if not test_connection():
        logger.error("✗ Database connection failed!")
        logger.info("Tip: run `python scripts/run_migrations.py` first to create the database file.")
        return 1

    all_buses = fetch_all_bus_details()
    if not all_buses:
        logger.error("✗ Failed to fetch bus details")
        close_connection()
        return 1

    get_statistics(all_buses)

    logger.info("\n" + "=" * 60)
    logger.info("SAVING DATA TO DATABASE (REPLACING OLD DATA)")
    logger.info("=" * 60)
    success = save_all(all_buses)

    if success:
        logger.info("\n" + "=" * 60)
        logger.info("DATABASE ROW COUNTS")
        logger.info("=" * 60)
        for table in [
            "payment_types", "regions", "working_zone_types",
            "stop_details", "buses", "bus_stops", "routes", "route_coordinates",
        ]:
            logger.info("  %s: %s rows", table, f"{get_row_count(table):,}")
        logger.info("\n" + "=" * 60)
        logger.info("✓ ALL OPERATIONS COMPLETED SUCCESSFULLY!")
        logger.info("=" * 60)
        close_connection()
        return 0

    close_connection()
    return 1


if __name__ == "__main__":
    sys.exit(main())
