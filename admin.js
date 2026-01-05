const express = require('express');
const path = require('path');
const router = express.Router();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-this-admin-token';

// middleware: require admin token in header "x-admin-token"
function requireAdmin(req, res, next) {
  const t = req.get('x-admin-token') || '';
  if (!t || t !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Missing or invalid admin token' });
  }
  next();
}

// GET /api/admin/users  -> list basic user info (no password_hash)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const rows = await db.all(
      `SELECT id, username, phone, balance, freeRounds, createdAt, updatedAt FROM users ORDER BY createdAt DESC`
    );
    return res.json({ users: rows || [] });
  } catch (err) {
    console.error('Admin list users error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/export-db -> downloads the SQLite file
router.get('/export-db', requireAdmin, (req, res) => {
  try {
    const dbFile = path.join(__dirname, 'db', 'ka-ndeke.db');
    return res.download(dbFile, 'ka-ndeke.db');
  } catch (err) {
    console.error('Admin export-db error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
