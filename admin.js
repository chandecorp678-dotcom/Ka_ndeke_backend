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
