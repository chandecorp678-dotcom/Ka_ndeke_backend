const express = require("express");
const path = require("path");
const router = express.Router();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-this-admin-token"; // set a strong value in Render env

// Middleware to require admin token in header "x-admin-token"
function requireAdmin(req, res, next) {
  const t = req.get("x-admin-token") || "";
  if (!t || t !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Missing or invalid admin token" });
  }
  next();
}

// One-time admin endpoint: create required tables (safe: uses IF NOT EXISTS)
// Add this block near the other admin routes. Remove it after you ran it successfully.
router.post("/init-db", requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  if (!db || typeof db.query !== "function") {
    return res.status(500).json({ error: "Database not initialized on server" });
  }

  // Create users table (if not present) and bets table
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      balance NUMERIC(18,2) NOT NULL DEFAULT 0,
      freerounds INTEGER NOT NULL DEFAULT 0,
      createdat TIMESTAMPTZ NOT NULL,
      updatedat TIMESTAMPTZ NOT NULL
    );
  `;

  const createBetsTable = `
    CREATE TABLE IF NOT EXISTS bets (
      id UUID PRIMARY KEY,
      round_id TEXT NOT NULL,
      user_id UUID,
      bet_amount NUMERIC(18,2) NOT NULL,
      payout NUMERIC(18,2),
      status TEXT NOT NULL DEFAULT 'active',  -- active, cashed, lost, refunded
      meta JSONB DEFAULT '{}'::jsonb,
      createdat TIMESTAMPTZ NOT NULL,
      updatedat TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets (user_id);
    CREATE INDEX IF NOT EXISTS idx_bets_round_id ON bets (round_id);
  `;

  try {
    await db.query(createUsersTable);
    await db.query(createBetsTable);
    return res.json({ ok: true, message: "users + bets tables created (if not already existed)" });
  } catch (err) {
    console.error("Init DB error:", err);
    return res.status(500).json({ error: "Init DB failed", detail: err.message });
  }
});

// GET /api/admin/users -> list all users (no password_hash)
router.get("/users", requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  try {
    const result = await db.query(
      `SELECT id, username, phone, balance, freerounds, createdat, updatedat
       FROM users
       ORDER BY createdat DESC`
    );
    return res.json({ users: result.rows || [] });
  } catch (err) {
    console.error("Admin list users error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/export-db -> optional: if you still want to download the SQLite file
// Not useful with Postgres unless you export manually. You can leave this out.
router.get("/export-db", requireAdmin, (req, res) => {
  return res.status(501).json({ error: "Postgres export not supported via API" });
});

module.exports = router;
