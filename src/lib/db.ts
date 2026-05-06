/**
 * SQLite data access layer (better-sqlite3).
 *
 * Replaces the previous Neon/Postgres driver. The connection is opened lazily
 * in read-only mode and cached at module level for the lifetime of the Node
 * process — perfect for Next.js dev/prod servers and serverless cold starts.
 *
 * The query functions keep their original `async` signatures so all existing
 * `await queryStops()` callers still work, even though the underlying driver
 * is synchronous.
 */
import Database from "better-sqlite3";
import path from "path";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "ayna.sqlite");
const DB_PATH = process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH;

let db: Database.Database | null = null;

function getDB(): Database.Database {
  if (db) return db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    // NB: do NOT set `journal_mode = WAL` here. PRAGMA journal_mode writes the
    // mode into the database header, which fails on a read-only connection
    // ("attempt to write a readonly database"). The file's existing journal
    // mode (whatever the scrapers left it in) is fine for read-only access.
    // foreign_keys is per-connection state, so it's always safe.
    db.pragma("foreign_keys = ON");
    return db;
  } catch (err) {
    throw new Error(
      `Failed to open SQLite database at "${DB_PATH}". ` +
        `Run \`python scripts/run_migrations.py\` followed by \`python scripts/stops.py\` ` +
        `and \`python scripts/busDetails.py\` to create and populate it. ` +
        `Original error: ${(err as Error).message}`
    );
  }
}

interface StopDetailRow {
  id: number;
  code: string | null;
  name: string;
  latitude: number;
  longitude: number;
  is_transport_hub: number;
}

export async function queryStopDetails() {
  const rows = getDB()
    .prepare(
      `SELECT id, code, name, latitude, longitude, is_transport_hub
       FROM stop_details
       ORDER BY id`
    )
    .all() as StopDetailRow[];
  return rows.map((row) => ({
    id: row.id,
    code: row.code ?? "",
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    is_transport_hub: !!row.is_transport_hub,
  }));
}

interface BusRow {
  id: number;
  carrier: string;
  number: string;
  first_point: string;
  last_point: string;
  route_length: number | null;
  tariff: number;
  tariff_str: string | null;
  region_id: number | null;
  working_zone_type_id: number | null;
  duration_minuts: number | null;
}

export async function queryBuses() {
  const rows = getDB()
    .prepare(
      `SELECT id, carrier, number, first_point, last_point,
              route_length, tariff, tariff_str, region_id,
              working_zone_type_id, duration_minuts
       FROM buses
       ORDER BY id`
    )
    .all() as BusRow[];
  return rows.map((row) => ({
    id: row.id,
    carrier: row.carrier,
    number: row.number,
    first_point: row.first_point,
    last_point: row.last_point,
    route_length: row.route_length ?? 0,
    tariff: row.tariff,
    tariff_str: row.tariff_str ?? "",
    region_id: row.region_id ?? 0,
    working_zone_type_id: row.working_zone_type_id ?? 0,
    duration_minuts: row.duration_minuts ?? 0,
  }));
}

interface BusStopRow {
  id: number;
  bus_stop_id: number;
  bus_id: number;
  stop_id: number;
  stop_code: string | null;
  stop_name: string;
  total_distance: number | null;
  intermediate_distance: number | null;
  direction_type_id: number;
}

export async function queryBusStops() {
  const rows = getDB()
    .prepare(
      `SELECT id, bus_stop_id, bus_id, stop_id, stop_code, stop_name,
              total_distance, intermediate_distance, direction_type_id
       FROM bus_stops
       ORDER BY bus_id, direction_type_id, bus_stop_id`
    )
    .all() as BusStopRow[];
  return rows.map((row) => ({
    id: row.id,
    bus_stop_id: row.bus_stop_id,
    bus_id: row.bus_id,
    stop_id: row.stop_id,
    stop_code: row.stop_code ?? "",
    stop_name: row.stop_name,
    total_distance: row.total_distance ?? 0,
    intermediate_distance: row.intermediate_distance,
    direction_type_id: row.direction_type_id,
  }));
}

interface RouteCoordRow {
  latitude: number;
  longitude: number;
  sequence_order: number;
}

export async function queryRouteCoordinates(routeId: number) {
  const rows = getDB()
    .prepare(
      `SELECT latitude, longitude, sequence_order
       FROM route_coordinates
       WHERE route_id = ?
       ORDER BY sequence_order`
    )
    .all(routeId) as RouteCoordRow[];
  return rows.map((row) => ({
    latitude: row.latitude,
    longitude: row.longitude,
    sequence_order: row.sequence_order,
  }));
}

interface RouteRow {
  id: number;
  code: string | null;
  destination: string | null;
  bus_id: number;
  direction_type_id: number;
}

export async function queryRoutes() {
  const rows = getDB()
    .prepare(
      `SELECT id, code, destination, bus_id, direction_type_id
       FROM routes
       ORDER BY id`
    )
    .all() as RouteRow[];
  return rows.map((row) => ({
    id: row.id,
    code: row.code ?? "",
    destination: row.destination ?? "",
    bus_id: row.bus_id,
    direction_type_id: row.direction_type_id,
  }));
}

export async function queryRoutesByBusAndDirection(
  busId: number,
  directionTypeId: number
) {
  const row = getDB()
    .prepare(
      `SELECT id FROM routes
       WHERE bus_id = ? AND direction_type_id = ?
       LIMIT 1`
    )
    .get(busId, directionTypeId) as { id: number } | undefined;
  return row ? row.id : null;
}

export async function getDataLastUpdated(): Promise<string | null> {
  const row = getDB()
    .prepare(`SELECT MAX(created_at) AS last_updated FROM buses`)
    .get() as { last_updated: string | null } | undefined;
  if (!row?.last_updated) return null;
  // Schema stores ISO-8601 UTC ('YYYY-MM-DDTHH:MM:SS.sssZ'), so Date can parse directly.
  const d = new Date(row.last_updated);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
