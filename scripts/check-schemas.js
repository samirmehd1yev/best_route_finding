require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function check() {
  // List all schemas
  const schemas = await sql`SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`;
  console.log('=== ALL SCHEMAS ===');
  console.log(JSON.stringify(schemas, null, 2));

  // List all tables across all schemas
  const allTables = await sql`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
    AND table_schema NOT IN ('information_schema', 'pg_catalog')
    ORDER BY table_schema, table_name
  `;
  console.log('\n=== ALL TABLES ===');
  console.log(JSON.stringify(allTables, null, 2));
}

check().catch(e => { console.error(e); process.exit(1); });
