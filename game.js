const express = require("express");
const router = express.Router();

const { startRound, cashOut } = require("./gameEngine");

// START ROUND
router.post("/start", (req, res) => {
  try {
    const round = startRound();
    res.json(round);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// CASH OUT
router.post("/cashout", (req, res) => {
  try {
    const { roundId, betAmount, multiplier } = req.body;

    if (!roundId || !betAmount || !multiplier) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const result = cashOut(roundId, betAmount, multiplier);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

