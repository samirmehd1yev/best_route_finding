#!/usr/bin/env node
/**
 * Inspect the local SQLite database — schema + sample data dump.
 *
 * Usage:
 *   npm run inspect-db
 *   SQLITE_DB_PATH=./data/ayna.sqlite npm run inspect-db
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'ayna.sqlite');

function main() {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch (err) {
    console.error(`Cannot open database at ${DB_PATH}: ${err.message}`);
    console.error('Run `python scripts/run_migrations.py` first.');
    process.exit(1);
  }

  console.log(`Database: ${DB_PATH}`);

  // 1. Tables
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  console.log('\n=== TABLES ===');
  console.log(JSON.stringify(tables, null, 2));

  // 2. Columns per table (PRAGMA table_info)
  console.log('\n=== COLUMNS ===');
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
    console.log(`\n--- ${t.name} ---`);
    console.log(JSON.stringify(cols, null, 2));
  }

  // 3. Indexes
  console.log('\n=== INDEXES ===');
  for (const t of tables) {
    const idx = db.prepare(`PRAGMA index_list("${t.name}")`).all();
    if (idx.length === 0) continue;
    console.log(`\n--- ${t.name} ---`);
    console.log(JSON.stringify(idx, null, 2));
  }

  // 4. Foreign keys
  console.log('\n=== FOREIGN KEYS ===');
  for (const t of tables) {
    const fks = db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all();
    if (fks.length === 0) continue;
    console.log(`\n--- ${t.name} ---`);
    console.log(JSON.stringify(fks, null, 2));
  }

  // 5. Row counts
  console.log('\n=== ROW COUNTS ===');
  for (const t of tables) {
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get();
    console.log(`${t.name}: ${c} rows`);
  }

  // 6. Sample data
  console.log('\n=== SAMPLE DATA (first 5 rows) ===');
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t.name}" LIMIT 5`).all();
    console.log(`\n--- ${t.name} (${rows.length} sample rows) ---`);
    console.log(JSON.stringify(rows, null, 2));
  }

  // 7. Views
  const views = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name"
  ).all();
  console.log('\n=== VIEWS ===');
  console.log(JSON.stringify(views, null, 2));

  db.close();
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
