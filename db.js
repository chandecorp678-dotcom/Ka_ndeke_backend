const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

async function initDb() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to PostgreSQL database");
  } catch (err) {
    console.error("❌ Failed to connect to PostgreSQL:", err);
    throw err;
  }
}

module.exports = {
  pool,
  initDb,
};
