require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

// Schema is stored as uppercase in .env but PostgreSQL stores it lowercase
const schema = (process.env.DATABASE_SCHEMA || 'public').toLowerCase();
const sql = neon(process.env.DATABASE_URL);

async function inspect() {
  console.log(`Inspecting schema: ${schema}`);

  // 1. List all tables
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = ${schema} AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  console.log('\n=== TABLES ===');
  console.log(JSON.stringify(tables, null, 2));

  // 2. Get columns for each table
  console.log('\n=== COLUMNS ===');
  for (const t of tables) {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default,
             character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = ${t.table_name}
      ORDER BY ordinal_position
    `;
    console.log(`\n--- ${t.table_name} ---`);
    console.log(JSON.stringify(cols, null, 2));
  }

  // 3. Primary keys
  console.log('\n=== PRIMARY KEYS ===');
  const pks = await sql`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = ${schema}
    ORDER BY tc.table_name, kcu.ordinal_position
  `;
  console.log(JSON.stringify(pks, null, 2));

  // 4. Foreign keys
  console.log('\n=== FOREIGN KEYS ===');
  const fks = await sql`
    SELECT
      tc.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = ${schema}
    ORDER BY tc.table_name
  `;
  console.log(JSON.stringify(fks, null, 2));

  // 5. Row counts
  console.log('\n=== ROW COUNTS ===');
  for (const t of tables) {
    const count = await sql(`SELECT COUNT(*) as cnt FROM "${schema}"."${t.table_name}"`);
    console.log(`${t.table_name}: ${count[0].cnt} rows`);
  }

  // 6. Sample data from each table (first 5 rows)
  console.log('\n=== SAMPLE DATA ===');
  for (const t of tables) {
    const sample = await sql(`SELECT * FROM "${schema}"."${t.table_name}" LIMIT 5`);
    console.log(`\n--- ${t.table_name} (sample) ---`);
    console.log(JSON.stringify(sample, null, 2));
  }

  // 7. Unique constraints
  console.log('\n=== UNIQUE CONSTRAINTS ===');
  const uniques = await sql`
    SELECT tc.table_name, kcu.column_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE'
      AND tc.table_schema = ${schema}
    ORDER BY tc.table_name
  `;
  console.log(JSON.stringify(uniques, null, 2));
}

inspect().catch(e => { console.error(e); process.exit(1); });
