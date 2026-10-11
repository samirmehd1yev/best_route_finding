import copy
import logging
from pathlib import Path
import sqlite3
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import busDetails
import db_utils
import stops


class IngestionTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:", isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript((ROOT / "migrations/001_initial_schema.sql").read_text())
        self.connection = patch.object(db_utils, "_connection", self.db)
        self.connection.start()
        self.bus = {
            "id": 10, "carrier": "Test", "number": "10", "firstPoint": "A", "lastPoint": "B", "tariff": 60,
            "durationMinuts": 20,
            "stops": [{"id": 1, "busId": 10, "stopId": 1, "stopName": "A", "directionTypeId": 1,
                       "stop": {"id": 1, "name": "A", "latitude": "4,049,233", "longitude": "49,737,864"}}],
            "routes": [{"id": 10, "busId": 10, "directionTypeId": 1,
                        "flowCoordinates": [{"lat": "40.49233", "lng": "49.737864"}]}],
        }

    def tearDown(self):
        self.connection.stop()
        self.db.close()

    def snapshot(self):
        return list(self.db.iterdump())

    def test_grouped_coordinates_preserve_variable_decimal_precision(self):
        for raw, expected in [("49,961,721", 49.961721), ("4,049,233", 40.49233),
                              ("4,049,409", 40.49409), ("-49,961,721", -49.961721),
                              ("49,961721", 49.961721), ("4.049233", 4.049233),
                              ("-122.4", -122.4), (49, 49)]:
            with self.subTest(raw=raw):
                self.assertEqual(db_utils.parse_coordinate(raw), expected)
        for raw in [None, "", "junk", "NaN", "Infinity", "999", "999,999,999", "40,12,345"]:
            with self.subTest(raw=raw):
                self.assertIsNone(db_utils.parse_coordinate(raw))

    def test_refresh_replaces_existing_foreign_key_dependents(self):
        self.assertTrue(busDetails.save_all([self.bus]))
        self.bus["stops"][0]["stop"]["name"] = "Updated A"
        self.assertTrue(busDetails.save_all([self.bus]))
        row = self.db.execute("SELECT name, latitude FROM stop_details WHERE id=1").fetchone()
        self.assertEqual(tuple(row), ("Updated A", 40.49233))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM bus_stops").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM route_coordinates").fetchone()[0], 1)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_failed_refresh_rolls_back_every_table(self):
        self.assertTrue(busDetails.save_all([self.bus]))
        before = self.snapshot()
        invalid = copy.deepcopy(self.bus)
        invalid["routes"][0]["flowCoordinates"][0]["lat"] = "invalid"
        self.assertFalse(busDetails.save_all([invalid]))
        self.assertEqual(self.snapshot(), before)

    def test_empty_replacements_preserve_existing_data(self):
        self.assertTrue(busDetails.save_all([self.bus]))
        self.assertTrue(stops.save_stops_to_db([{"id": 1, "latitude": 40, "longitude": 49}]))
        before = self.snapshot()
        self.assertFalse(busDetails.save_all([]))
        self.assertFalse(stops.save_stops_to_db([]))
        self.assertEqual(self.snapshot(), before)

    def test_invalid_failure_thresholds_abort_before_fetching(self):
        for value in ["NaN", "Infinity", "-0.1", "1.1", "junk", ""]:
            with self.subTest(value=value), patch.dict("os.environ", {"FAILURE_THRESHOLD": value}), \
                 patch.object(busDetails, "fetch_bus_list") as fetch:
                self.assertIsNone(busDetails.fetch_all_bus_details())
                fetch.assert_not_called()

    def test_failure_fraction_is_checked_at_the_configured_boundary(self):
        buses = [{"id": 1, "number": "1"}, {"id": 2, "number": "2"}]
        for threshold, accepted in [("0.5", True), ("0.49", False)]:
            with self.subTest(threshold=threshold), patch.dict("os.environ", {"FAILURE_THRESHOLD": threshold}), \
                 patch.object(busDetails, "fetch_bus_list", return_value=buses), \
                 patch.object(busDetails, "fetch_bus_details", side_effect=[self.bus, None]), \
                 patch.object(busDetails.time, "sleep"):
                result = busDetails.fetch_all_bus_details()
                self.assertEqual(result, [self.bus] if accepted else None)

    def test_coordinate_repair_is_repeatable_and_preserves_newer_values(self):
        for table in ["stops", "stop_details"]:
            columns = "id, latitude, longitude" + (", name" if table == "stop_details" else "")
            values = "?, ?, 49" + (", 'Test'" if table == "stop_details" else "")
            self.db.executemany(f"INSERT INTO {table} ({columns}) VALUES ({values})",
                                [(3838, 4.049233), (3839, 4.049409), (1, 4.049233)])
        migration = (ROOT / "migrations/002_repair_grouped_latitudes.sql").read_text()
        self.db.executescript(migration)
        self.db.executescript(migration)
        for table in ["stops", "stop_details"]:
            rows = self.db.execute(f"SELECT id, latitude FROM {table} ORDER BY id").fetchall()
            self.assertEqual([tuple(row) for row in rows], [(1, 4.049233), (3838, 40.49233), (3839, 40.49409)])
        self.db.execute("UPDATE stop_details SET latitude = 40.5 WHERE id=3838")
        self.db.executescript(migration)
        self.assertEqual(self.db.execute("SELECT latitude FROM stop_details WHERE id=3838").fetchone()[0], 40.5)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    unittest.main()
