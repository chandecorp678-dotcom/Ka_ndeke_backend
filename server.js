require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const logger = require("./logger");
const { initDb, pool } = require("./db");
const routes = require("./routes");
const gameEngine = require("./gameEngine");

const app = express();

let serverInstance = null;
let isShuttingDown = false;
const GRACEFUL_TIMEOUT = Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || 30000);

// Basic request logging to help debugging (uses structured logger)
app.use((req, res, next) => {
  logger.info('http.request.start', { method: req.method, url: req.originalUrl, ip: req.ip });
  next();
});

app.use(cors());
app.use(express.json());

// Serve static frontend from ./public
app.use(express.static(path.join(__dirname, "public")));

async function start() {
  try {
    await initDb();       // test Postgres connection
    app.locals.db = pool; // attach Postgres pool to app

    // mount API routes under /api
    app.use("/api", routes);

    const PORT = process.env.PORT || 3000;
    serverInstance = app.listen(PORT, () => {
      logger.info("server.started", { port: PORT });
    });

  } catch (err) {
    logger.error("server.start.failed", { message: err && err.message ? err.message : String(err) });
    // Ensure non-zero exit when start fails
    process.exit(1);
  }
}

start();

// Graceful shutdown routine
async function gracefulShutdown(reason = "signal") {
  if (isShuttingDown) {
    logger.warn("shutdown.already_in_progress", { reason });
    return;
  }
  isShuttingDown = true;
  logger.info("shutdown.start", { reason });

  // Start a timeout to force exit if shutdown hangs
  const forceExitTimeout = setTimeout(() => {
    logger.error("shutdown.force_exit", { timeoutMs: GRACEFUL_TIMEOUT });
    // Attempt to end pool/file but then exit
    try {
      if (logger._internal && logger._internal.fileStream) {
        try { logger._internal.fileStream.end(); } catch (e) {}
      }
    } catch (e) {}
    process.exit(1);
  }, GRACEFUL_TIMEOUT).unref();

  try {
    // Stop accepting new connections
    if (serverInstance && serverInstance.close) {
      logger.info("shutdown.http.stop_listening");
      await new Promise((resolve) => serverInstance.close(() => resolve()));
      logger.info("shutdown.http.closed");
    } else {
      logger.warn("shutdown.http.no_server_instance");
    }

    // Tell game engine to dispose timers/rounds
    try {
      if (gameEngine && typeof gameEngine.dispose === "function") {
        logger.info("shutdown.gameEngine.dispose_start");
        await gameEngine.dispose();
        logger.info("shutdown.gameEngine.disposed");
      } else {
        logger.warn("shutdown.gameEngine.no_dispose");
      }
    } catch (e) {
      logger.error("shutdown.gameEngine.dispose_error", { message: e && e.message ? e.message : String(e) });
    }

    // Close Postgres pool
    try {
      if (pool && typeof pool.end === "function") {
        logger.info("shutdown.db.pool_ending");
        await pool.end();
        logger.info("shutdown.db.closed");
      } else {
        logger.warn("shutdown.db.no_pool");
      }
    } catch (e) {
      logger.error("shutdown.db.close_error", { message: e && e.message ? e.message : String(e) });
    }

    // Flush & close file stream if present
    try {
      if (logger._internal && logger._internal.fileStream) {
        logger.info("shutdown.logger.flush_close");
        logger._internal.fileStream.end();
      }
    } catch (e) {
      // non-fatal
    }

    clearTimeout(forceExitTimeout);
    logger.info("shutdown.complete");
    process.exit(0);
  } catch (err) {
    logger.error("shutdown.unhandled_error", { message: err && err.message ? err.message : String(err) });
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
}

// Signal handlers
process.on("SIGTERM", () => {
  logger.info("signal.received", { signal: "SIGTERM" });
  gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  logger.info("signal.received", { signal: "SIGINT" });
  gracefulShutdown("SIGINT");
});

// Uncaught exceptions / unhandled rejections
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { message: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack : undefined });
  // Attempt graceful shutdown, then exit non-zero
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason: reason && reason.message ? reason.message : String(reason) });
  // Attempt graceful shutdown, then exit non-zero
  gracefulShutdown("unhandledRejection");
});

// Export app and server for tests or later shutdown
module.exports = {
  app,
  serverInstance,
  _internal: { setShuttingDown: (val) => { isShuttingDown = !!val; } }
};
