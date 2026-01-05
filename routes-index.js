const express = require("express");
const router = express.Router();

const users = require("./users");

// health endpoint for frontend probe
router.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.use("/", users); // mount auth & user endpoints under /api/*

// mount admin routes (add this)
let admin;
try {
  admin = require("./admin");
  router.use("/admin", admin);
} catch (e) {
  // admin.js not present — continue without admin endpoints
  console.warn("admin.js not loaded (file may be missing). Admin endpoints unavailable.");
}

module.exports = router;
