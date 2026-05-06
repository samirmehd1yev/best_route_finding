-- Initial Database Schema for Baku Bus Route Dashboard (SQLite)
-- Description: Complete schema for bus routes, stops, and geographic data
--
-- Notes on the SQLite port:
--   * SQLite has no schemas — tables live in the default namespace.
--   * Postgres `DECIMAL(10,7)` -> `REAL` (53-bit double, ample for 7-digit coords).
--   * `BOOLEAN` -> `INTEGER` storing 0/1; better-sqlite3 hands these back as numbers
--     and the JS layer coerces with `!!`.
--   * `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` -> `TEXT DEFAULT (strftime(...))` so
--     timestamps round-trip as unambiguous ISO-8601 UTC strings.
--   * Postgres `SERIAL` -> `INTEGER PRIMARY KEY AUTOINCREMENT`.
--   * `CREATE OR REPLACE VIEW` -> `DROP VIEW IF EXISTS` + `CREATE VIEW`.
--   * `update_updated_at` triggers were dropped — no caller reads `updated_at`.

PRAGMA foreign_keys = ON;

-- ============================================================================
-- REFERENCE TABLES (Lookup/Dictionary Tables)
-- ============================================================================

-- Payment Types -- Payment methods for bus routes (Card/Cash)
CREATE TABLE IF NOT EXISTS payment_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    deactived_date TEXT,
    priority INTEGER,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_types_active ON payment_types(is_active);

-- Regions -- Geographic regions (e.g., Baku)
CREATE TABLE IF NOT EXISTS regions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    deactived_date TEXT,
    priority INTEGER,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_regions_active ON regions(is_active);

-- Working Zone Types -- Zone types (Urban, Suburban, etc.)
CREATE TABLE IF NOT EXISTS working_zone_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    deactived_date TEXT,
    priority INTEGER,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_working_zone_types_active ON working_zone_types(is_active);

-- ============================================================================
-- CORE DATA TABLES
-- ============================================================================

-- All bus stops with geographic coordinates (from /api/stop/getAll)
CREATE TABLE IF NOT EXISTS stops (
    id INTEGER PRIMARY KEY,
    longitude REAL NOT NULL,
    latitude REAL NOT NULL,
    is_transport_hub INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stops_coordinates ON stops(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_stops_transport_hub ON stops(is_transport_hub);

-- Detailed stop information including names and codes (from busDetails stops.stop nested data)
CREATE TABLE IF NOT EXISTS stop_details (
    id INTEGER PRIMARY KEY,
    code TEXT,
    name TEXT NOT NULL,
    name_monitor TEXT,
    utm_coord_x TEXT,
    utm_coord_y TEXT,
    longitude REAL NOT NULL,
    latitude REAL NOT NULL,
    is_transport_hub INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stop_details_code ON stop_details(code);
CREATE INDEX IF NOT EXISTS idx_stop_details_name ON stop_details(name);
CREATE INDEX IF NOT EXISTS idx_stop_details_coordinates ON stop_details(latitude, longitude);

-- Bus routes with operator and fare information
CREATE TABLE IF NOT EXISTS buses (
    id INTEGER PRIMARY KEY,
    carrier TEXT NOT NULL,
    number TEXT NOT NULL,
    first_point TEXT NOT NULL,
    last_point TEXT NOT NULL,
    route_length REAL,
    payment_type_id INTEGER REFERENCES payment_types(id),
    card_payment_date TEXT,
    tariff INTEGER NOT NULL,
    tariff_str TEXT,
    region_id INTEGER REFERENCES regions(id),
    working_zone_type_id INTEGER REFERENCES working_zone_types(id),
    duration_minuts INTEGER,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_buses_number ON buses(number);
CREATE INDEX IF NOT EXISTS idx_buses_carrier ON buses(carrier);
CREATE INDEX IF NOT EXISTS idx_buses_payment_type ON buses(payment_type_id);
CREATE INDEX IF NOT EXISTS idx_buses_region ON buses(region_id);
CREATE INDEX IF NOT EXISTS idx_buses_zone_type ON buses(working_zone_type_id);

-- Junction table linking buses to stops with sequence and distance
CREATE TABLE IF NOT EXISTS bus_stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_stop_id INTEGER NOT NULL,         -- Original ID from API
    bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    stop_id INTEGER NOT NULL REFERENCES stop_details(id),
    stop_code TEXT,
    stop_name TEXT NOT NULL,
    total_distance REAL,
    intermediate_distance REAL,
    direction_type_id INTEGER NOT NULL,   -- 1=outbound, 2=inbound
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(bus_id, bus_stop_id, direction_type_id)
);
CREATE INDEX IF NOT EXISTS idx_bus_stops_bus ON bus_stops(bus_id);
CREATE INDEX IF NOT EXISTS idx_bus_stops_stop ON bus_stops(stop_id);
CREATE INDEX IF NOT EXISTS idx_bus_stops_direction ON bus_stops(direction_type_id);
CREATE INDEX IF NOT EXISTS idx_bus_stops_bus_direction ON bus_stops(bus_id, direction_type_id);

-- Route directions with metadata for each bus
CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY,
    code TEXT,
    customer_name TEXT,
    type TEXT,
    name TEXT,
    destination TEXT,
    variant TEXT,
    operator TEXT,
    bus_id INTEGER NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    direction_type_id INTEGER NOT NULL,   -- 1=outbound, 2=inbound
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_routes_bus ON routes(bus_id);
CREATE INDEX IF NOT EXISTS idx_routes_direction ON routes(direction_type_id);
CREATE INDEX IF NOT EXISTS idx_routes_bus_direction ON routes(bus_id, direction_type_id);
CREATE INDEX IF NOT EXISTS idx_routes_code ON routes(code);

-- Geographic coordinates defining the route path for visualization
CREATE TABLE IF NOT EXISTS route_coordinates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    sequence_order INTEGER NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_route_coordinates_route ON route_coordinates(route_id);
CREATE INDEX IF NOT EXISTS idx_route_coordinates_sequence ON route_coordinates(route_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_route_coordinates_location ON route_coordinates(latitude, longitude);

-- ============================================================================
-- VIEWS
-- ============================================================================

DROP VIEW IF EXISTS v_buses_complete;
CREATE VIEW v_buses_complete AS
SELECT
    b.id,
    b.number,
    b.carrier,
    b.first_point,
    b.last_point,
    b.route_length,
    b.duration_minuts,
    b.tariff,
    b.tariff_str,
    b.card_payment_date,
    pt.name AS payment_type,
    r.name AS region,
    wzt.name AS working_zone_type,
    b.created_at,
    b.updated_at
FROM buses b
LEFT JOIN payment_types pt ON b.payment_type_id = pt.id
LEFT JOIN regions r ON b.region_id = r.id
LEFT JOIN working_zone_types wzt ON b.working_zone_type_id = wzt.id;

DROP VIEW IF EXISTS v_bus_stops_details;
CREATE VIEW v_bus_stops_details AS
SELECT
    bs.id,
    bs.bus_id,
    b.number AS bus_number,
    bs.stop_id,
    sd.name AS stop_name,
    sd.code AS stop_code,
    sd.latitude,
    sd.longitude,
    bs.total_distance,
    bs.intermediate_distance,
    bs.direction_type_id,
    CASE
        WHEN bs.direction_type_id = 1 THEN 'Outbound'
        WHEN bs.direction_type_id = 2 THEN 'Inbound'
        ELSE 'Unknown'
    END AS direction_name,
    sd.is_transport_hub
FROM bus_stops bs
JOIN buses b ON bs.bus_id = b.id
JOIN stop_details sd ON bs.stop_id = sd.id;
