'use strict';

const logger = require('./logger');

/**
 * KILL SWITCH SERVICE
 * Allows admins to pause/resume game rounds and payment processing
 * Stored in memory with database backup
 */

let killSwitchState = {
  gameRounds: false,  // true = paused
  payments: false,    // true = paused
  pausedAt: null,
  pausedBy: null,
  reason: null
};

/**
 * Check if kill switch is active
 */
function isGamePaused() {
  return killSwitchState.gameRounds;
}

function isPaymentsPaused() {
  return killSwitchState.payments;
}

/**
 * Pause game rounds
 */
async function pauseGameRounds(db, adminToken, reason = 'Admin maintenance') {
  try {
    killSwitchState.gameRounds = true;
    killSwitchState.pausedAt = new Date().toISOString();
    killSwitchState.pausedBy = adminToken.slice(0, 8); // log only first 8 chars
    killSwitchState.reason = reason;

    // Log to database
    await db.query(
      `INSERT INTO kill_switch_log (action, target, reason, activated_at, activated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      ['pause', 'game_rounds', reason, killSwitchState.pausedAt, killSwitchState.pausedBy]
    );

    logger.warn('killSwitch.gameRounds.paused', { reason, by: killSwitchState.pausedBy });
    return killSwitchState;
  } catch (err) {
    logger.error('killSwitch.pauseGameRounds.error', { message: err.message });
    throw err;
  }
}

/**
 * Resume game rounds
 */
async function resumeGameRounds(db, adminToken, reason = 'Admin resumed') {
  try {
    killSwitchState.gameRounds = false;
    const resumedAt = new Date().toISOString();

    await db.query(
      `INSERT INTO kill_switch_log (action, target, reason, activated_at, activated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      ['resume', 'game_rounds', reason, resumedAt, adminToken.slice(0, 8)]
    );

    logger.info('killSwitch.gameRounds.resumed', { by: adminToken.slice(0, 8) });
    return killSwitchState;
  } catch (err) {
    logger.error('killSwitch.resumeGameRounds.error', { message: err.message });
    throw err;
  }
}

/**
 * Pause payments
 */
async function pausePayments(db, adminToken, reason = 'Admin maintenance') {
  try {
    killSwitchState.payments = true;
    killSwitchState.pausedAt = new Date().toISOString();
    killSwitchState.pausedBy = adminToken.slice(0, 8);
    killSwitchState.reason = reason;

    await db.query(
      `INSERT INTO kill_switch_log (action, target, reason, activated_at, activated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      ['pause', 'payments', reason, killSwitchState.pausedAt, killSwitchState.pausedBy]
    );

    logger.warn('killSwitch.payments.paused', { reason, by: killSwitchState.pausedBy });
    return killSwitchState;
  } catch (err) {
    logger.error('killSwitch.pausePayments.error', { message: err.message });
    throw err;
  }
}

/**
 * Resume payments
 */
async function resumePayments(db, adminToken, reason = 'Admin resumed') {
  try {
    killSwitchState.payments = false;
    const resumedAt = new Date().toISOString();

    await db.query(
      `INSERT INTO kill_switch_log (action, target, reason, activated_at, activated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      ['resume', 'payments', reason, resumedAt, adminToken.slice(0, 8)]
    );

    logger.info('killSwitch.payments.resumed', { by: adminToken.slice(0, 8) });
    return killSwitchState;
  } catch (err) {
    logger.error('killSwitch.resumePayments.error', { message: err.message });
    throw err;
  }
}

/**
 * Get current kill switch state
 */
function getState() {
  return { ...killSwitchState };
}

/**
 * Get kill switch history
 */
async function getHistory(db, limit = 50) {
  try {
    const result = await db.query(
      `SELECT action, target, reason, activated_at, activated_by 
       FROM kill_switch_log 
       ORDER BY activated_at DESC 
       LIMIT $1`,
      [limit]
    );

    return result.rows || [];
  } catch (err) {
    logger.error('killSwitch.getHistory.error', { message: err.message });
    return [];
  }
}

/**
 * Initialize kill switch from database (on startup)
 */
async function initialize(db) {
  try {
    // Check if there's an active pause
    const result = await db.query(
      `SELECT action, target, reason, activated_at FROM kill_switch_log 
       WHERE action = 'pause' 
       ORDER BY activated_at DESC LIMIT 1`
    );

    if (result.rows.length > 0) {
      const lastPause = result.rows[0];
      logger.warn('killSwitch.initialized.with_active_pause', { target: lastPause.target, reason: lastPause.reason });
    }

    logger.info('killSwitch.initialized');
  } catch (err) {
    logger.warn('killSwitch.initialize.error', { message: err.message });
  }
}

module.exports = {
  isGamePaused,
  isPaymentsPaused,
  pauseGameRounds,
  resumeGameRounds,
  pausePayments,
  resumePayments,
  getState,
  getHistory,
  initialize
};
