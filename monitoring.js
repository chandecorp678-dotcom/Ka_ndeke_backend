'use strict';

const logger = require('./logger');

/**
 * MONITORING SERVICE
 * Tracks game metrics, RTP, crash distribution, system health
 * Stores data in PostgreSQL for historical analysis
 */

const RTP_TARGET_MIN = Number(process.env.RTP_TARGET_MIN || 90);
const RTP_TARGET_MAX = Number(process.env.RTP_TARGET_MAX || 97);
const ANOMALY_THRESHOLD = Number(process.env.ANOMALY_THRESHOLD || 5); // consecutive same crashes

// In-memory alert queue
const alertQueue = [];
const MAX_ALERTS = 1000;

/**
 * Log an alert
 */
function createAlert(severity, title, message, metadata = {}) {
  const alert = {
    id: require('crypto').randomUUID(),
    timestamp: new Date().toISOString(),
    severity, // 'critical', 'warning', 'info'
    title,
    message,
    metadata,
    acknowledged: false
  };

  alertQueue.push(alert);
  if (alertQueue.length > MAX_ALERTS) alertQueue.shift();

  logger.warn(`monitoring.alert.${severity}`, { title, message, metadata });

  return alert;
}

/**
 * Get current alerts
 */
function getAlerts(severity = null, limit = 50) {
  let filtered = alertQueue;
  if (severity) filtered = filtered.filter(a => a.severity === severity);
  return filtered.slice(-limit).reverse();
}

/**
 * Acknowledge an alert
 */
function acknowledgeAlert(alertId) {
  const alert = alertQueue.find(a => a.id === alertId);
  if (alert) alert.acknowledged = true;
  return alert;
}

/**
 * Calculate RTP for a time period
 * RTP = (Total Payouts / Total Bets) * 100
 */
async function calculateRTP(db, hoursBack = 24) {
  try {
    const query = `
      SELECT
        SUM(bet_amount) as total_bets,
        SUM(CASE WHEN status = 'cashed' THEN payout ELSE 0 END) as total_payouts,
        COUNT(*) as bet_count,
        COUNT(CASE WHEN status = 'cashed' THEN 1 END) as won_count,
        COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_count,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count
      FROM bets
      WHERE createdat >= NOW() - INTERVAL '${hoursBack} hours'
    `;

    const result = await db.query(query);
    const row = result.rows[0];

    const totalBets = Number(row.total_bets || 0);
    const totalPayouts = Number(row.total_payouts || 0);

    const rtp = totalBets > 0 ? (totalPayouts / totalBets) * 100 : 0;

    const rtpData = {
      rtp: Number(rtp.toFixed(2)),
      totalBets: Number(totalBets.toFixed(2)),
      totalPayouts: Number(totalPayouts.toFixed(2)),
      betCount: row.bet_count || 0,
      wonCount: row.won_count || 0,
      lostCount: row.lost_count || 0,
      activeCount: row.active_count || 0,
      period: `${hoursBack}h`,
      timestamp: new Date().toISOString()
    };

    // Alert if RTP is outside target range
    if (rtp < RTP_TARGET_MIN && row.bet_count > 10) {
      createAlert('warning', 'Low RTP Alert', `RTP is ${rtp.toFixed(2)}% (below ${RTP_TARGET_MIN}%)`, rtpData);
    } else if (rtp > RTP_TARGET_MAX && row.bet_count > 10) {
      createAlert('warning', 'High RTP Alert', `RTP is ${rtp.toFixed(2)}% (above ${RTP_TARGET_MAX}%)`, rtpData);
    }

    return rtpData;
  } catch (err) {
    logger.error('monitoring.calculateRTP.error', { message: err.message });
    return null;
  }
}

/**
 * Analyze crash point distribution
 * Returns histogram and detects anomalies
 */
async function analyzeCrashDistribution(db, hoursBack = 24) {
  try {
    const query = `
      SELECT
        ROUND(crash_point::numeric, 1) as crash_bucket,
        COUNT(*) as frequency
      FROM rounds
      WHERE ended_at >= NOW() - INTERVAL '${hoursBack} hours'
        AND crash_point IS NOT NULL
      GROUP BY ROUND(crash_point::numeric, 1)
      ORDER BY crash_bucket ASC
    `;

    const result = await db.query(query);
    const distribution = {};
    let totalRounds = 0;

    result.rows.forEach(row => {
      distribution[row.crash_bucket] = row.frequency;
      totalRounds += row.frequency;
    });

    // Detect anomalies (unusually high concentration)
    const anomalies = [];
    Object.entries(distribution).forEach(([bucket, freq]) => {
      const percentage = (freq / totalRounds) * 100;
      if (percentage > 15) { // More than 15% in one bucket is suspicious
        anomalies.push({
          bucket: Number(bucket),
          frequency: freq,
          percentage: Number(percentage.toFixed(2))
        });
      }
    });

    const analysis = {
      distribution,
      totalRounds,
      anomalies,
      period: `${hoursBack}h`,
      timestamp: new Date().toISOString()
    };

    if (anomalies.length > 0) {
      createAlert('warning', 'Crash Distribution Anomaly', `Detected ${anomalies.length} unusual crash point(s)`, analysis);
    }

    return analysis;
  } catch (err) {
    logger.error('monitoring.analyzeCrashDistribution.error', { message: err.message });
    return null;
  }
}

/**
 * Get system health status
 */
async function getSystemHealth(db) {
  try {
    // Check database connectivity
    const dbCheck = await db.query('SELECT 1');
    const dbHealthy = dbCheck.rowCount > 0;

    // Check active rounds
    const roundsCheck = await db.query(`
      SELECT COUNT(*) as active_rounds FROM rounds WHERE ended_at IS NULL
    `);
    const activeRounds = Number(roundsCheck.rows[0]?.active_rounds || 0);

    // Check pending payments
    const paymentsCheck = await db.query(`
      SELECT COUNT(*) as pending_payments FROM payments 
      WHERE status IN ('pending', 'processing')
    `);
    const pendingPayments = Number(paymentsCheck.rows[0]?.pending_payments || 0);

    // Check user count
    const usersCheck = await db.query('SELECT COUNT(*) as user_count FROM users');
    const userCount = Number(usersCheck.rows[0]?.user_count || 0);

    const health = {
      status: dbHealthy ? 'healthy' : 'unhealthy',
      database: { healthy: dbHealthy },
      activeRounds,
      pendingPayments,
      userCount,
      timestamp: new Date().toISOString()
    };

    if (pendingPayments > 50) {
      createAlert('warning', 'High Pending Payments', `${pendingPayments} payments awaiting confirmation`, health);
    }

    return health;
  } catch (err) {
    logger.error('monitoring.getSystemHealth.error', { message: err.message });
    return {
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Store monitoring snapshot (call periodically)
 */
async function storeMonitoringSnapshot(db) {
  try {
    const rtp = await calculateRTP(db, 24);
    const health = await getSystemHealth(db);
    const distribution = await analyzeCrashDistribution(db, 24);

    const snapshot = {
      id: require('crypto').randomUUID(),
      rtp: rtp?.rtp || 0,
      totalBets: rtp?.totalBets || 0,
      totalPayouts: rtp?.totalPayouts || 0,
      activeRounds: health.activeRounds || 0,
      pendingPayments: health.pendingPayments || 0,
      userCount: health.userCount || 0,
      anomaliesDetected: distribution?.anomalies?.length || 0,
      createdAt: new Date().toISOString()
    };

    await db.query(
      `INSERT INTO monitoring_snapshots 
       (id, rtp, total_bets, total_payouts, active_rounds, pending_payments, user_count, anomalies_detected, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [snapshot.id, snapshot.rtp, snapshot.totalBets, snapshot.totalPayouts, 
       snapshot.activeRounds, snapshot.pendingPayments, snapshot.userCount, 
       snapshot.anomaliesDetected, snapshot.createdAt]
    );

    logger.info('monitoring.snapshot.stored', { rtp: snapshot.rtp, activeRounds: snapshot.activeRounds });
    return snapshot;
  } catch (err) {
    logger.error('monitoring.storeMonitoringSnapshot.error', { message: err.message });
  }
}

/**
 * Get monitoring history
 */
async function getMonitoringHistory(db, hoursBack = 24, limit = 100) {
  try {
    const query = `
      SELECT id, rtp, total_bets, total_payouts, active_rounds, pending_payments, user_count, anomalies_detected, created_at
      FROM monitoring_snapshots
      WHERE created_at >= NOW() - INTERVAL '${hoursBack} hours'
      ORDER BY created_at DESC
      LIMIT $1
    `;

    const result = await db.query(query, [limit]);
    return result.rows || [];
  } catch (err) {
    logger.error('monitoring.getMonitoringHistory.error', { message: err.message });
    return [];
  }
}

module.exports = {
  createAlert,
  getAlerts,
  acknowledgeAlert,
  calculateRTP,
  analyzeCrashDistribution,
  getSystemHealth,
  storeMonitoringSnapshot,
  getMonitoringHistory,
  RTP_TARGET_MIN,
  RTP_TARGET_MAX
};
