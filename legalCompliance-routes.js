'use strict';

const express = require('express');
const router = express.Router();
const logger = require('./logger');
const { sendError, wrapAsync } = require('./apiResponses');
const legalCompliance = require('./legalCompliance');

/**
 * LEGAL COMPLIANCE ROUTES
 * GET /api/legal/terms - Get T&C
 * POST /api/legal/accept-terms - Accept T&C
 * POST /api/legal/verify-age - Verify age 18+
 * GET /api/legal/compliance-status - Check user compliance
 * GET /api/legal/daily-loss-limit - Check daily loss limit
 * POST /api/legal/self-exclude - Self-exclude user
 * GET /api/legal/exclusion-status - Check exclusion status
 * POST /api/legal/cancel-exclusion - Cancel self-exclusion
 * GET /api/legal/responsible-gaming - Responsible gaming message
 */

/**
 * GET /api/legal/terms
 * Get Terms & Conditions
 */
router.get('/terms', (req, res) => {
  try {
    const terms = legalCompliance.getTermsAndConditions();
    return res.json({ ok: true, terms });
  } catch (err) {
    logger.error('legal.terms.error', { message: err.message });
    return sendError(res, 500, 'Failed to fetch terms');
  }
});

/**
 * POST /api/legal/accept-terms
 * Accept Terms & Conditions (requires auth)
 */
router.post('/accept-terms', express.json(), wrapAsync(async (req, res) => {
  if (!req.user || !req.user.id) {
    return sendError(res, 401, 'Authentication required');
  }

  try {
    const db = req.app.locals.db;
    const result = await legalCompliance.acceptTermsAndConditions(db, req.user.id);
    return res.json({ ok: true, message: 'Terms accepted', ...result });
  } catch (err) {
    logger.error('legal.acceptTerms.error', { userId: req.user.id, message: err.message });
    return sendError(res, 500, 'Failed to accept terms');
  }
}));

/**
 * POST /api/legal/verify-age
 * Verify user is 18+ (requires auth)
 * Body: { confirmed: true }
 */
router.post('/verify-age', express.json(), wrapAsync(async (req, res) => {
  if (!req.user || !req.user.id) {
    return sendError(res, 401, 'Authentication required');
  }

  const { confirmed } = req.body || {};

  if (confirmed !== true) {
    return sendError(res, 400, 'You must confirm you are 18 or older');
  }

  try {
    const db = req.app.locals.db;
    const result = await legalCompliance.verifyAge(db, req.user.id, confirmed);
    return res.json({ ok: true, message: 'Age verified', ...result });
  } catch (err) {
    logger.error('legal.verifyAge.error', { userId: req.user.id, message: err.message });
    return sendError(res, 500, 'Failed to verify age');
  }
}));

/**
 * GET /api/legal/compliance-status
 * Check if user has accepted T&C and verified age (requires auth)
 */
router.get('/compliance-status', wrapAsync(async (req, res) => {
  if (!req.user || !req.user.id) {
    return sendError(res, 401, 'Authentication required');
  }

  try {
    const db = req.app.locals.db;
    const status = await legalCompliance.getComplianceStatus(db, req.user.id);
    return res.json({ ok: true, status });
  } catch (err) {
    logger.error('legal.complianceStatus.error', { userId: req.user.id, message: err.message });
    return sendError(res, 500, 'Failed to fetch compliance status');
  }
}));

/**
 * GET /api/legal/daily-loss-limit
 * Check daily loss and remaining limit (requires auth)
 */
router.get('/daily-loss-limit', wrapAsync(async (req, res) => {
  if (!req.user || !req.user.id) {
    return sendError(res, 401, 'Authentication required');
  }

  try {
    const db = req.app.locals.db;
    const limitStatus = await legalCompliance.checkDailyLossLimit(db, req.user.id);
    return res.json({ ok: true, ...limitStatus });
  } catch (err) {
    logger.error('legal.dailyLossLimit.error', { userId: req.user.id, message: err.message });
    return sendError(res, 500, 'Failed to check daily loss limit');
  }
}));

/**
 * POST /api/legal/self-exclude
 * Self-exclude user for 7, 30, or 90 days (requires auth)
 * Body: { days: 7 | 30 | 90 }
 */
router.post('/self-exclude', express.json(), wrapAsync(async (req, res) => {
  if (!req.user || !req.user.id) {
    return sendError(res, 401, 'Authentication required');
  }

  let { days } = req.body || {};
  days = Number(days) || 7;

  if (![7, 30, 90].includes(days)) {
    return sendError(res, 400, 'Days must be 7, 30, or 90');
  }

  try {
    const db = req.app.locals.db;
    const result = await legalCompliance.selfExclude(db, req.user.id, days);
    logger.info('legal.selfExclude.success', { userId: req.user.id, days });
    return res.json({ ok: true, message: `You are now self-excluded for ${days} days`, ...result });
  } catch (err) {
    logger.error('legal.selfExclude.error', { userId: req.user.id, message: err.message });
    return sendError(res, 500, 'Failed to self-exclude');
  }
}));

/**
 * GET /api/legal/exclusion-status
 * Check if user is currently self-excluded (requires auth)
 */
router.get('/exclusion-status', wrapAsync(async (req, res) => {
  if (!req.user || !req.user.id) {
    return sendError(res, 401, 'Authentication required');
  }

  try {
    const db = req.app.locals.db;
    const status = await legalCompliance.isUserExcluded(db, req.user.id);
    return res.json({ ok: true, ...status });
  } catch (err) {
    logger.error('legal.exclusionStatus.error', { userId: req.user.id, message: err.message });
    return sendError(res, 500, 'Failed to check exclusion status');
  }
}));

/**
 * POST /api/legal/cancel-exclusion
 * Cancel self-exclusion (requires auth)
 */
router.post('/cancel-exclusion', express.json(), wrapAsync(async (req, res) => {
  if (!req.user || !req.user.id) {
    return sendError(res, 401, 'Authentication required');
  }

  try {
    const db = req.app.locals.db;
    const result = await legalCompliance.cancelSelfExclusion(db, req.user.id);
    logger.info('legal.cancelExclusion.success', { userId: req.user.id });
    return res.json({ ok: true, message: 'Self-exclusion cancelled', ...result });
  } catch (err) {
    logger.error('legal.cancelExclusion.error', { userId: req.user.id, message: err.message });
    return sendError(res, 500, 'Failed to cancel self-exclusion');
  }
}));

/**
 * GET /api/legal/responsible-gaming
 * Get responsible gaming message (public, no auth needed)
 */
router.get('/responsible-gaming', (req, res) => {
  try {
    const message = 'Please gamble responsibly. Set limits, never gamble money you cannot afford to lose, and take regular breaks.';
    const demoMode = legalCompliance.isDemoMode();
    return res.json({
      ok: true,
      message,
      demoMode,
      demoNotice: demoMode ? 'This is DEMO mode. No real money is involved.' : null
    });
  } catch (err) {
    logger.error('legal.responsibleGaming.error', { message: err.message });
    return sendError(res, 500, 'Failed to fetch responsible gaming message');
  }
});

module.exports = router;
