'use strict';

const express = require('express');
const router = express.Router();
const logger = require('./logger');
const { sendError } = require('./apiResponses');
const monitoring = require('./monitoring');
const killSwitch = require('./killSwitch');

/**
 * MONITORING API ROUTES
 * GET /api/admin/monitoring/health - System health
 * GET /api/admin/monitoring/rtp - RTP stats
 * GET /api/admin/monitoring/crashes - Crash distribution
 * GET /api/admin/monitoring/alerts - Active alerts
 * GET /api/admin/monitoring/history - Historical data
 * GET /api/admin/killswitch/status - Kill switch status
 * POST /api/admin/killswitch/pause - Pause games/payments
 * POST /api/admin/killswitch/resume - Resume games/payments
 */

// Admin token middleware
function requireAdmin(req, res, next) {
  const t = req.get("x-admin-token") || "";
  if (!t || t !== process.env.ADMIN_TOKEN) {
    return sendError(res, 401, "Missing or invalid admin token");
  }
  next();
}

router.use(requireAdmin);

/**
 * GET /api/admin/monitoring/health
 * System health check
 */
router.get('/health', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const health = await monitoring.getSystemHealth(db);
    return res.json({ ok: true, ...health });
  } catch (err) {
    logger.error('monitoring.health.error', { message: err.message });
    return sendError(res, 500, 'Failed to fetch health status');
  }
});

/**
 * GET /api/admin/monitoring/rtp
 * RTP calculation for last 24h
 */
router.get('/rtp', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const hoursBack = Math.min(720, Math.max(1, Number(req.query.hours) || 24));
    const rtp = await monitoring.calculateRTP(db, hoursBack);
    return res.json({ ok: true, ...rtp });
  } catch (err) {
    logger.error('monitoring.rtp.error', { message: err.message });
    return sendError(res, 500, 'Failed to calculate RTP');
  }
});

/**
 * GET /api/admin/monitoring/crashes
 * Crash point distribution analysis
 */
router.get('/crashes', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const hoursBack = Math.min(720, Math.max(1, Number(req.query.hours) || 24));
    const analysis = await monitoring.analyzeCrashDistribution(db, hoursBack);
    return res.json({ ok: true, ...analysis });
  } catch (err) {
    logger.error('monitoring.crashes.error', { message: err.message });
    return sendError(res, 500, 'Failed to analyze crashes');
  }
});

/**
 * GET /api/admin/monitoring/alerts
 * Get active alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const severity = req.query.severity || null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const alerts = monitoring.getAlerts(severity, limit);
    return res.json({ ok: true, alerts, count: alerts.length });
  } catch (err) {
    logger.error('monitoring.alerts.error', { message: err.message });
    return sendError(res, 500, 'Failed to fetch alerts');
  }
});

/**
 * POST /api/admin/monitoring/alerts/:alertId/acknowledge
 * Mark alert as acknowledged
 */
router.post('/alerts/:alertId/acknowledge', async (req, res) => {
  try {
    const alertId = req.params.alertId;
    const alert = monitoring.acknowledgeAlert(alertId);
    if (!alert) return sendError(res, 404, 'Alert not found');
    return res.json({ ok: true, alert });
  } catch (err) {
    logger.error('monitoring.alerts.acknowledge.error', { message: err.message });
    return sendError(res, 500, 'Failed to acknowledge alert');
  }
});

/**
 * GET /api/admin/monitoring/history
 * Monitoring history (snapshots over time)
 */
router.get('/history', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const hoursBack = Math.min(720, Math.max(1, Number(req.query.hours) || 24));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const history = await monitoring.getMonitoringHistory(db, hoursBack, limit);
    return res.json({ ok: true, history, count: history.length });
  } catch (err) {
    logger.error('monitoring.history.error', { message: err.message });
    return sendError(res, 500, 'Failed to fetch history');
  }
});

/**
 * GET /api/admin/killswitch/status
 * Get current kill switch state
 */
router.get('/killswitch/status', async (req, res) => {
  try {
    const state = killSwitch.getState();
    return res.json({ ok: true, state });
  } catch (err) {
    logger.error('killSwitch.status.error', { message: err.message });
    return sendError(res, 500, 'Failed to fetch kill switch status');
  }
});

/**
 * POST /api/admin/killswitch/pause
 * Pause game rounds and/or payments
 * Body: { target: 'games' | 'payments' | 'all', reason: 'optional' }
 */
router.post('/killswitch/pause', express.json(), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { target = 'all', reason = 'Admin maintenance' } = req.body;
    const adminToken = req.get('x-admin-token');

    if (!['games', 'payments', 'all'].includes(target)) {
      return sendError(res, 400, "Target must be 'games', 'payments', or 'all'");
    }

    let state;

    if (target === 'games' || target === 'all') {
      await killSwitch.pauseGameRounds(db, adminToken, reason);
    }
    if (target === 'payments' || target === 'all') {
      await killSwitch.pausePayments(db, adminToken, reason);
    }

    state = killSwitch.getState();
    logger.warn('killSwitch.paused', { target, reason });

    return res.json({ ok: true, message: `${target} paused successfully`, state });
  } catch (err) {
    logger.error('killSwitch.pause.error', { message: err.message });
    return sendError(res, 500, 'Failed to pause');
  }
});

/**
 * POST /api/admin/killswitch/resume
 * Resume game rounds and/or payments
 * Body: { target: 'games' | 'payments' | 'all', reason: 'optional' }
 */
router.post('/killswitch/resume', express.json(), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { target = 'all', reason = 'Admin resumed' } = req.body;
    const adminToken = req.get('x-admin-token');

    if (!['games', 'payments', 'all'].includes(target)) {
      return sendError(res, 400, "Target must be 'games', 'payments', or 'all'");
    }

    let state;

    if (target === 'games' || target === 'all') {
      await killSwitch.resumeGameRounds(db, adminToken, reason);
    }
    if (target === 'payments' || target === 'all') {
      await killSwitch.resumePayments(db, adminToken, reason);
    }

    state = killSwitch.getState();
    logger.warn('killSwitch.resumed', { target, reason });

    return res.json({ ok: true, message: `${target} resumed successfully`, state });
  } catch (err) {
    logger.error('killSwitch.resume.error', { message: err.message });
    return sendError(res, 500, 'Failed to resume');
  }
});

/**
 * GET /api/admin/killswitch/history
 * Get kill switch activation history
 */
router.get('/killswitch/history', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const history = await killSwitch.getHistory(db, limit);
    return res.json({ ok: true, history, count: history.length });
  } catch (err) {
    logger.error('killSwitch.history.error', { message: err.message });
    return sendError(res, 500, 'Failed to fetch history');
  }
});

module.exports = router;
