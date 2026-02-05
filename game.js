'use strict';

const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const {
  joinRound,
  cashOut: engineCashOut,
  getRoundStatus
} = require("./gameEngine");

const json = express.json();

// Simple in-memory rate limiter
const cashoutTimestamps = new Map();
const CASHOUT_MIN_INTERVAL_MS = 800;

/* ========================= START ROUND ========================= */
router.post("/start", json, async (req, res) => {
  const db = req.app.locals.db;
  const user = req.user || { guest: true, id: "guest" };

  const betAmount = Number(req.body?.betAmount);
  if (!betAmount || isNaN(betAmount) || betAmount <= 0) {
    return res.status(400).json({ error: "Invalid bet amount" });
  }

  const status = getRoundStatus();
  if (!status || status.status !== "running") {
    return res.status(400).json({ error: "No active running round" });
  }

  /* ================= GUEST MODE ================= */
  if (user.guest) {
    try {
      const engineResp = joinRound("guest", betAmount);
      return res.json({
        betId: "guest",
        roundId: engineResp.roundId,
        serverSeedHash: engineResp.serverSeedHash,
        startedAt: engineResp.startedAt
      });
    } catch (err) {
      return res.status(500).json({ error: "Failed to join round" });
    }
  }

  /* ================= AUTHENTICATED USER ================= */
  if (!db) return res.status(500).json({ error: "Database not initialized" });

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const updateRes = await client.query(
      `UPDATE users
       SET balance = balance - $1, updatedat = NOW()
       WHERE id = $2 AND balance >= $1
       RETURNING balance`,
      [betAmount, user.id]
    );

    if (!updateRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(402).json({ error: "Insufficient funds" });
    }

    const betId = crypto.randomUUID();
    await client.query(
      `INSERT INTO bets (id, round_id, user_id, bet_amount, status, createdat, updatedat)
       VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())`,
      [betId, status.roundId, user.id, betAmount]
    );

    await client.query("COMMIT");

    const engineResp = joinRound(user.id, betAmount);

    return res.json({
      betId,
      roundId: engineResp.roundId,
      serverSeedHash: engineResp.serverSeedHash,
      startedAt: engineResp.startedAt,
      balance: Number(updateRes.rows[0].balance)
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("start error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

/* ========================= ROUND STATUS ========================= */
router.get("/status", (req, res) => {
  try {
    const status = getRoundStatus();
    return res.json(status);
  } catch (err) {
    console.error("status error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ========================= CASH OUT ========================= */
router.post("/cashout", json, async (req, res) => {
  const db = req.app.locals.db;
  const user = req.user || { guest: true, id: "guest" };

  const last = cashoutTimestamps.get(user.id) || 0;
  if (Date.now() - last < CASHOUT_MIN_INTERVAL_MS) {
    return res.status(429).json({ error: "Too many attempts" });
  }
  cashoutTimestamps.set(user.id, Date.now());

  const status = getRoundStatus();
  if (!status || status.status !== "running") {
    return res.status(400).json({ error: "No active round" });
  }

  /* ================= GUEST CASHOUT ================= */
  if (user.guest) {
    try {
      const result = engineCashOut("guest");
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: "Cashout failed" });
    }
  }

  /* ================= AUTH USER CASHOUT ================= */
  if (!db) return res.status(500).json({ error: "Database not initialized" });

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const betRes = await client.query(
      `SELECT id, bet_amount
       FROM bets
       WHERE user_id = $1 AND status = 'active' AND round_id = $2
       FOR UPDATE`,
      [user.id, status.roundId]
    );

    if (!betRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No active bet" });
    }

    const bet = betRes.rows[0];
    const engineResult = engineCashOut(user.id);

    if (!engineResult.win) {
      await client.query(
        `UPDATE bets SET status = 'lost', payout = 0, updatedat = NOW() WHERE id = $1`,
        [bet.id]
      );
      await client.query("COMMIT");
      return res.json(engineResult);
    }

    const payout = Number(engineResult.payout);

    const updateUser = await client.query(
      `UPDATE users SET balance = balance + $1, updatedat = NOW() WHERE id = $2 RETURNING balance`,
      [payout, user.id]
    );

    await client.query(
      `UPDATE bets SET status = 'cashed', payout = $1, updatedat = NOW() WHERE id = $2`,
      [payout, bet.id]
    );

    await client.query("COMMIT");

    return res.json({
      win: true,
      payout,
      multiplier: engineResult.multiplier,
      balance: Number(updateUser.rows[0].balance)
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("cashout error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router; 
