const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const logger = require("./logger");
const { sendError, sendSuccess, wrapAsync } = require("./apiResponses");
const metrics = require("./metrics");

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret"; // secure secret in Render env

// ----------------- Helper -----------------
function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    phone: row.phone,
    balance: Number(row.balance || 0),
    freeRounds: Number(row.freerounds || 0),
    createdAt: row.createdat,
    updatedAt: row.updatedat,
  };
}

// ----------------- Health + Game helpers -----------------
router.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const { generateCrashPoint, computePayout } = require("./gameEngine");
router.get("/game/round", (req, res) => {
  try {
    const crashPoint = generateCrashPoint();
    return res.json({ crashPoint });
  } catch (err) {
    logger.error("Error generating crash point:", { message: err && err.message ? err.message : String(err) });
    return sendError(res, 500, "Server error");
  }
});

router.post("/game/payout", express.json(), (req, res) => {
  try {
    const { bet, multiplier } = req.body;
    if (bet == null || multiplier == null)
      return sendError(res, 400, "Missing 'bet' or 'multiplier'");
    const payout = computePayout(bet, multiplier);
    return res.json({ payout });
  } catch (err) {
    logger.error("Error computing payout:", { message: err && err.message ? err.message : String(err) });
    return sendError(res, 500, "Server error");
  }
});

// ----------------- Auth & User endpoints -----------------
router.post("/auth/register", express.json(), wrapAsync(async (req, res) => {
  const db = req.app.locals.db;
  const { username, phone, password } = req.body || {};
  if (!username || !phone || !password)
    return sendError(res, 400, "username, phone and password required");

  const existing = await db.query("SELECT id FROM users WHERE phone = $1", [phone]);
  if (existing.rows.length) return sendError(res, 409, "Phone already registered");

  const id = uuidv4();
  const now = new Date().toISOString();
  const password_hash = await bcrypt.hash(password, 10);

  await db.query(
    `INSERT INTO users (id, username, phone, password_hash, balance, freerounds, createdat, updatedat)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, username, phone, password_hash, 0, 0, now, now]
  );

  const userRow = await db.query("SELECT * FROM users WHERE id = $1", [id]);
  const user = sanitizeUser(userRow.rows[0]);
  const token = jwt.sign({ uid: id }, JWT_SECRET, { expiresIn: "30d" });

  return res.status(201).json({ token, user });
}));

router.post("/auth/login", express.json(), wrapAsync(async (req, res) => {
  const db = req.app.locals.db;
  const { phone, password } = req.body || {};
  if (!phone || !password) return sendError(res, 400, "phone and password required");

  const rowRes = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
  const row = rowRes.rows[0];
  if (!row) return sendError(res, 401, "Invalid credentials");

  const ok = await bcrypt.compare(password, row.password_hash || "");
  if (!ok) return sendError(res, 401, "Invalid credentials");

  const user = sanitizeUser(row);
  const token = jwt.sign({ uid: row.id }, JWT_SECRET, { expiresIn: "30d" });
  return res.json({ token, user });
}));

// ----------------- Auth middleware -----------------
async function requireAuth(req, res, next) {
  const db = req.app.locals.db;
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return sendError(res, 401, "Missing authorization token");

  const token = match[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.uid) return sendError(res, 401, "Invalid token");

    const rowRes = await db.query("SELECT * FROM users WHERE id = $1", [payload.uid]);
    const row = rowRes.rows[0];
    if (!row) return sendError(res, 401, "User not found");

    req.user = sanitizeUser(row);
    req.userRaw = row;
    next();
  } catch (err) {
    logger.error("Auth verify error", { message: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack : undefined });
    return sendError(res, 401, "Invalid or expired token", err && err.message ? err.message : undefined);
  }
}

// ----------------- User routes -----------------
router.get("/users/me", requireAuth, (req, res) => {
  return res.json(req.user);
});

// Extracted handler for changing balance — atomic update
const changeBalanceHandler = wrapAsync(async (req, res) => {
  const db = req.app.locals.db;
  const delta = Number(req.body?.delta);
  if (isNaN(delta)) return sendError(res, 400, "delta must be a number");

  try {
    const rowRes = await db.query(
      `UPDATE users
       SET balance = balance + $1, updatedat = NOW()
       WHERE id = $2 AND (balance + $1) >= 0
       RETURNING *`,
      [delta, req.user.id]
    );

    if (!rowRes.rowCount) {
      return sendError(res, 400, "Insufficient funds");
    }

    return res.json(sanitizeUser(rowRes.rows[0]));
  } catch (err) {
    logger.error("Balance change error:", { message: err && err.message ? err.message : String(err) });
    return sendError(res, 500, "Server error");
  }
});

router.post("/users/balance/change", requireAuth, express.json(), changeBalanceHandler);

router.post("/users/deposit", requireAuth, express.json(), wrapAsync(async (req, res) => {
  const amount = Number(req.body?.amount);
  if (isNaN(amount) || amount <= 0) return sendError(res, 400, "amount must be > 0");
  req.body = { delta: amount };
  return changeBalanceHandler(req, res);
}));

router.post("/users/withdraw", requireAuth, express.json(), wrapAsync(async (req, res) => {
  const amount = Number(req.body?.amount);
  if (isNaN(amount) || amount <= 0) return sendError(res, 400, "amount must be > 0");
  req.body = { delta: -Math.abs(amount) };
  return changeBalanceHandler(req, res);
}));

// ----------------- Public game history endpoints -----------------

// GET /api/game/history?limit=50
router.get("/game/history", wrapAsync(async (req, res) => {
  const db = req.app.locals.db;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  try {
    const rows = await db.query(
      `SELECT round_id, crash_point, server_seed_hash, started_at, ended_at, meta
       FROM rounds
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.json({ rounds: rows.rows || [] });
  } catch (err) {
    logger.error("game.history.error", { message: err && err.message ? err.message : String(err) });
    return sendError(res, 500, "Server error");
  }
}));

// GET /api/game/rounds/:roundId -> details + bets
router.get("/game/rounds/:roundId", wrapAsync(async (req, res) => {
  const db = req.app.locals.db;
  const roundId = req.params.roundId;
  if (!roundId) return sendError(res, 400, "roundId required");

  try {
    const r = await db.query(`SELECT round_id, crash_point, server_seed_hash, started_at, ended_at, meta FROM rounds WHERE round_id = $1`, [roundId]);
    if (!r.rowCount) return sendError(res, 404, "Round not found");

    const bets = await db.query(`SELECT id, user_id, bet_amount, payout, status, meta, createdat FROM bets WHERE round_id = $1`, [roundId]);

    return res.json({ round: r.rows[0], bets: bets.rows || [] });
  } catch (err) {
    logger.error("game.round.detail.error", { message: err && err.message ? err.message : String(err) });
    return sendError(res, 500, "Server error");
  }
}));

// ----------------- Public aggregated metrics endpoint -----------------
router.get("/metrics/public", async (req, res) => {
  try {
    const m = metrics.getMetrics();
    return res.json({
      totalBets: m.totalBets,
      totalVolume: m.totalVolume,
      totalCashouts: m.totalCashouts,
      totalPayouts: m.totalPayouts,
      lastUpdated: m.lastUpdated
    });
  } catch (err) {
    logger.error("public.metrics.error", { message: err && err.message ? err.message : String(err) });
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
