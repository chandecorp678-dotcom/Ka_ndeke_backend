const express = require("express");
const router = express.Router();

const users = require("./users");
const payments = require("./payments");
const { optionalAuth } = require("./auth");

// health endpoint for frontend probe
router.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Attach optional authentication for all subsequent API routes.
// This will set req.user when a valid Bearer token is provided, but won't reject requests without one.
router.use(optionalAuth);

// mount auth & user endpoints
router.use("/", users);

// mount payment endpoints (Phase 9.3)
router.use("/payments", payments);

// mount admin routes (optional)
let admin;
try {
  admin = require("./admin");
  router.use("/admin", admin);
} catch (e) {
  console.warn("admin.js not loaded. Admin endpoints unavailable.");
}

// mount game routes (PRODUCTION)
const game = require("./game");
router.use("/game", game);

module.exports = router;
