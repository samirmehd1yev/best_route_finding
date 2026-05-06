#!/usr/bin/env node
/**
 * Quick data sanity check — row counts + 5-row samples for the core tables.
 *
 * Usage:
 *   npm run inspect-data
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'ayna.sqlite');

const TABLES = [
  'bus_stops',
  'buses',
  'payment_types',
  'regions',
  'route_coordinates',
  'routes',
  'stop_details',
  'stops',
  'working_zone_types',
];

function main() {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch (err) {
    console.error(`Cannot open database at ${DB_PATH}: ${err.message}`);
    process.exit(1);
  }

  console.log('=== ROW COUNTS ===');
  for (const name of TABLES) {
    try {
      const { c } = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get();
      console.log(`${name}: ${c} rows`);
    } catch (err) {
      console.log(`${name}: <missing> (${err.message})`);
    }
  }

  console.log('\n=== SAMPLE DATA ===');
  for (const name of TABLES) {
    try {
      const rows = db.prepare(`SELECT * FROM "${name}" LIMIT 5`).all();
      console.log(`\n--- ${name} (${rows.length} sample rows) ---`);
      console.log(JSON.stringify(rows, null, 2));
    } catch {
      // already reported above
    }
  }

  db.close();
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
