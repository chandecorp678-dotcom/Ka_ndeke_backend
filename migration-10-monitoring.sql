-- Phase 10 Migration: Monitoring and Kill Switch tables

-- Monitoring snapshots (stores periodic health checks)
CREATE TABLE IF NOT EXISTS monitoring_snapshots (
  id UUID PRIMARY KEY,
  rtp NUMERIC(5, 2) NOT NULL DEFAULT 95.00,
  total_bets NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_payouts NUMERIC(18, 2) NOT NULL DEFAULT 0,
  active_rounds INTEGER NOT NULL DEFAULT 0,
  pending_payments INTEGER NOT NULL DEFAULT 0,
  user_count INTEGER NOT NULL DEFAULT 0,
  anomalies_detected INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_snapshots_created_at ON monitoring_snapshots (created_at DESC);

-- Kill switch log (tracks all pause/resume actions)
CREATE TABLE IF NOT EXISTS kill_switch_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('pause', 'resume')),
  target TEXT NOT NULL CHECK (target IN ('game_rounds', 'payments', 'all')),
  reason TEXT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kill_switch_log_activated_at ON kill_switch_log (activated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kill_switch_log_target ON kill_switch_log (target);

-- Cleanup old monitoring data (keep 30 days)
-- Run this as a scheduled job or manually
-- DELETE FROM monitoring_snapshots WHERE created_at < NOW() - INTERVAL '30 days';
