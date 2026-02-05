'use strict';

const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const {
  joinRound,
  cashOut: engineCashOut,
  getRoundStatus
} = require("./gameEngine");

// Use JSON body parsing for POST endpoints
const json = express.json();

// Simple in-memory rate limiter for cashout per user (short window)
const cashoutTimestamps = new Map();
const CASHOUT_MIN_INTERVAL_MS = 1000; // 1 second between cashout attempts per user

/* ---------------- START ROUND (place bet and join global round) ---------------- */
router.post("/start", json, async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(500).json({ error: "Database not initialized" });

  // Require authenticated user for real-money bet
  const user = req.user;
  if (!user || user.guest) {
    return res.status(401).json({ error: "You must be logged in to place a bet" });
  }

  const betAmount = Number(req.body?.betAmount);
  if (!betAmount || isNaN(betAmount) || betAmount <= 0) {
    return res.status(400).json({ error: "Invalid bet amount" });
  }

  // Ensure there's an active running round
  const status = getRoundStatus();
  if (!status || status.status !== "running") {
    return res.status(400).json({ error: "No active running round" });
  }

  // Begin transaction: atomically debit user and persist bet row (locks funds)
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Atomically deduct funds if sufficient
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

    // create bet record
    const betId = crypto.randomUUID();
    await client.query(
      `INSERT INTO bets (id, round_id, user_id, bet_amount, status, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
       [betId, status.roundId, user.id, betAmount, "active"]
    );

    await client.query("COMMIT");

    // Now join the in-memory round via engine (this uses server authority)
    try {
      const engineResp = joinRound(user.id, betAmount);
      // Return betId to client so it can poll or reference it
      return res.json({ betId, roundId: engineResp.roundId, serverSeedHash: engineResp.serverSeedHash, startedAt: engineResp.startedAt, balance: Number(updateRes.rows[0].balance) });
    } catch (err) {
      // If joinRound fails for some reason, refund the user
      // Try safe refund
      const refundClient = await db.connect();
      try {
        await refundClient.query("BEGIN");
        await refundClient.query(
          `UPDATE users SET balance = balance + $1, updatedat = NOW() WHERE id = $2`,
          [betAmount, user.id]
        );
        await refundClient.query(
          `UPDATE bets SET status = 'refunded', updatedat = NOW() WHERE id = $1`,
          [betId]
        );
        await refundClient.query("COMMIT");
      } catch (e2) {
        await refundClient.query("ROLLBACK");
        console.error("Failed to refund after joinRound failure:", e2);
      } finally {
        refundClient.release();
      }
      console.error("joinRound error after DB changes:", err);
      return res.status(500).json({ error: "Failed to join round" });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("game/start transaction error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

/* ---------------- ROUND STATUS ---------------- */
/**
 * Frontend polls this to know if round has crashed
 */
router.get("/status", (req, res) => {
  try {
    const status = getRoundStatus();

    // Defensive normalization: if startedAt looks like seconds (10 digits), convert to ms
    if (status && status.startedAt) {
      const startedAtNum = Number(status.startedAt);
      if (startedAtNum && startedAtNum < 1e12) {
        status.startedAt = startedAtNum * 1000;
      } else {
        status.startedAt = startedAtNum;
      }
    }

    return res.json(status);
  } catch (err) {
    console.error("game/status error:", err && err.message ? err.message : err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------------- CASH OUT ---------------- */
router.post("/cashout", json, async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(500).json({ error: "Database not initialized" });

  const user = req.user;
  if (!user || user.guest) {
    return res.status(401).json({ error: "You must be logged in to cash out" });
  }

  // Rate-limit quick repeated cashouts
  const last = cashoutTimestamps.get(user.id) || 0;
  if (Date.now() - last < CASHOUT_MIN_INTERVAL_MS) {
    return res.status(429).json({ error: "Too many cashout attempts; slow down" });
  }
  // mark attempt time (we will update on success/failure)
  cashoutTimestamps.set(user.id, Date.now());

  // Ensure there's an active round
  const status = getRoundStatus();
  if (!status || status.status !== "running") {
    // mark timestamp so user can't spam; we still return appropriate message
    return res.status(400).json({ error: "No active running round" });
  }

  // Fetch the user's active bet for this round
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const betRes = await client.query(
      `SELECT id, round_id, user_id, bet_amount, status
       FROM bets
       WHERE user_id = $1 AND status = 'active' AND round_id = $2
       FOR UPDATE`,
       [user.id, status.roundId]
    );

    if (!betRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No active bet found for current round" });
    }

    const bet = betRes.rows[0];

    // Call server engine to compute payout / mark cashed
    let engineResult;
    try {
      engineResult = engineCashOut(user.id);
      // engineResult: { win: boolean, payout: number, multiplier }
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Engine cashOut error:", err);
      return res.status(500).json({ error: "Server error during cashout" });
    }

    if (!engineResult.win) {
      // Player lost — mark bet lost
      await client.query(
        `UPDATE bets SET status = 'lost', payout = $1, updatedat = NOW() WHERE id = $2`,
        [0, bet.id]
      );
      await client.query("COMMIT");
      return res.json({ success: false, payout: 0, multiplier: engineResult.multiplier });
    }

    // Player won — credit payout atomically
    const payout = Number(engineResult.payout);
    // Update user balance and bets row
    const updateUser = await client.query(
      `UPDATE users SET balance = balance + $1, updatedat = NOW() WHERE id = $2 RETURNING balance`,
      [payout, user.id]
    );

    if (!updateUser.rowCount) {
      // Shouldn't happen, but handle
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Failed to credit user" });
    }

    await client.query(
      `UPDATE bets SET status = 'cashed', payout = $1, updatedat = NOW() WHERE id = $2`,
      [payout, bet.id]
    );

    await client.query("COMMIT");

    // update rate limiter timestamp to now (already set)
    cashoutTimestamps.set(user.id, Date.now());

    return res.json({ success: true, payout, multiplier: engineResult.multiplier, balance: Number(updateUser.rows[0].balance) });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("game/cashout transaction error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
