const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

async function initDb() {
  // Just test connection
  await pool.query("SELECT 1");
  console.log("✅ Connected to Postgres");
  return pool;
}

module.exports = { pool, initDb };  await db.exec("PRAGMA foreign_keys = ON;");
  // create or migrate users table (existing logic kept simple)
  await db.exec(USERS_TABLE_SQL);

  return db; // db has run/get/all/exec via sqlite package
}

// Small Postgres wrapper that exposes run/get/all/exec similar to sqlite API
async function initPostgres() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: PG_URL, ssl: PG_URL.startsWith('postgres://') ? { rejectUnauthorized: false } : false });

  // Helper to run a query and return rows
  async function all(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows;
  }
  // Return first row or undefined
  async function get(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows[0];
  }
  // Run a command (INSERT/UPDATE). Return result-like object
  async function run(sql, params = []) {
    const res = await pool.query(sql, params);
    return res;
  }
  // Exec: allow running multiple statements; split by semicolon safely (simple)
  async function exec(sql) {
    // naive split: run sequentially for non-empty statements
    const parts = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      await pool.query(p);
    }
  }

  // Ensure users table exists (Postgres-compatible)
  await exec(USERS_TABLE_SQL);

  // Return wrapper with same method names used by the app
  return { pool, all, get, run, exec, query: pool.query.bind(pool) };
}

async function initDb() {
  if (PG_URL) {
    console.log('Using Postgres DB at', PG_URL.startsWith('postgres') ? '(postgres)' : PG_URL);
    return await initPostgres();
  } else {
    console.log('Using local SQLite DB at', SQLITE_PATH);
    return await initSqlite();
  }
}

module.exports = { initDb, SQLITE_PATH };
