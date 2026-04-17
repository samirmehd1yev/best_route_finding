import { neon } from "@neondatabase/serverless";

const schema = (process.env.DATABASE_SCHEMA || "ayna").toLowerCase();

function getSQL() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return neon(process.env.DATABASE_URL);
}

export async function queryStopDetails() {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, code, name, latitude, longitude, is_transport_hub
    FROM ayna.stop_details
    ORDER BY id
  `;
  return rows.map((row) => ({
    id: row.id as number,
    code: row.code as string,
    name: row.name as string,
    latitude: parseFloat(row.latitude as string),
    longitude: parseFloat(row.longitude as string),
    is_transport_hub: row.is_transport_hub as boolean,
  }));
}

export async function queryBuses() {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, carrier, number, first_point, last_point,
           route_length, tariff, tariff_str, region_id,
           working_zone_type_id, duration_minuts
    FROM ayna.buses
    ORDER BY id
  `;
  return rows.map((row) => ({
    id: row.id as number,
    carrier: row.carrier as string,
    number: row.number as string,
    first_point: row.first_point as string,
    last_point: row.last_point as string,
    route_length: parseFloat(row.route_length as string),
    tariff: row.tariff as number,
    tariff_str: row.tariff_str as string,
    region_id: row.region_id as number,
    working_zone_type_id: row.working_zone_type_id as number,
    duration_minuts: row.duration_minuts as number,
  }));
}

export async function queryBusStops() {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, bus_stop_id, bus_id, stop_id, stop_code, stop_name,
           total_distance, intermediate_distance, direction_type_id
    FROM ayna.bus_stops
    ORDER BY bus_id, direction_type_id, bus_stop_id
  `;
  return rows.map((row) => ({
    id: row.id as number,
    bus_stop_id: row.bus_stop_id as number,
    bus_id: row.bus_id as number,
    stop_id: row.stop_id as number,
    stop_code: row.stop_code as string,
    stop_name: row.stop_name as string,
    total_distance: parseFloat(row.total_distance as string) || 0,
    intermediate_distance: row.intermediate_distance
      ? parseFloat(row.intermediate_distance as string)
      : null,
    direction_type_id: row.direction_type_id as number,
  }));
}

export async function queryRouteCoordinates(routeId: number) {
  const sql = getSQL();
  const rows = await sql`
    SELECT latitude, longitude, sequence_order
    FROM ayna.route_coordinates
    WHERE route_id = ${routeId}
    ORDER BY sequence_order
  `;
  return rows.map((row) => ({
    latitude: parseFloat(row.latitude as string),
    longitude: parseFloat(row.longitude as string),
    sequence_order: row.sequence_order as number,
  }));
}

export async function queryRoutes() {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, code, destination, bus_id, direction_type_id
    FROM ayna.routes
    ORDER BY id
  `;
  return rows.map((row) => ({
    id: row.id as number,
    code: row.code as string,
    destination: row.destination as string,
    bus_id: row.bus_id as number,
    direction_type_id: row.direction_type_id as number,
  }));
}

export async function queryRoutesByBusAndDirection(
  busId: number,
  directionTypeId: number
) {
  const sql = getSQL();
  const rows = await sql`
    SELECT id FROM ayna.routes
    WHERE bus_id = ${busId} AND direction_type_id = ${directionTypeId}
    LIMIT 1
  `;
  return rows.length > 0 ? (rows[0].id as number) : null;
}

export async function getDataLastUpdated(): Promise<string | null> {
  const sql = getSQL();
  const rows = await sql`SELECT MAX(created_at) AS last_updated FROM ayna.buses`;
  const val = rows[0]?.last_updated;
  return val ? new Date(val).toISOString() : null;
}
