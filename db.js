const { Pool } = require("pg");
const logger = require("./logger");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  // Safety timeouts
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
});

const DB_STATEMENT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 5000);

// When a new client is created for the pool, set a session-level statement_timeout
pool.on('connect', (client) => {
  try {
    client.query(`SET statement_timeout = ${DB_STATEMENT_TIMEOUT_MS}`).catch((err) => {
      // Log but continue: we don't want to crash on inability to set session param
      logger.warn('db.pool.set_statement_timeout_failed', { message: err && err.message ? err.message : String(err) });
    });
    logger.info('db.pool.client_connected', { statement_timeout_ms: DB_STATEMENT_TIMEOUT_MS });
  } catch (e) {
    // non-fatal
    logger.warn('db.pool.connect_handler_failed', { message: e && e.message ? e.message : String(e) });
  }
});

async function initDb() {
  try {
    // a simple check to ensure the DB is reachable
    await pool.query("SELECT 1");
    logger.info("db.connected", {});
  } catch (err) {
    logger.error("db.connect_failed", { message: err && err.message ? err.message : String(err) });
    throw err;
  }
}

module.exports = {
  pool,
  initDb,
};
