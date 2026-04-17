require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const schema = (process.env.DATABASE_SCHEMA || 'public').toLowerCase();
const sql = neon(process.env.DATABASE_URL);

const tableNames = ['bus_stops', 'buses', 'payment_types', 'regions', 'route_coordinates', 'routes', 'stop_details', 'stops', 'working_zone_types'];

async function inspect() {
  // Row counts
  console.log('=== ROW COUNTS ===');
  for (const name of tableNames) {
    const count = await sql.query(`SELECT COUNT(*) as cnt FROM "${schema}"."${name}"`);
    console.log(`${name}: ${count[0].cnt} rows`);
  }

  // Sample data
  console.log('\n=== SAMPLE DATA ===');
  for (const name of tableNames) {
    const sample = await sql.query(`SELECT * FROM "${schema}"."${name}" LIMIT 5`);
    console.log(`\n--- ${name} (${sample.length} sample rows) ---`);
    console.log(JSON.stringify(sample, null, 2));
  }
}

inspect().catch(e => { console.error(e); process.exit(1); });
