-- Phase 11 Migration: Legal Compliance tables

-- Legal compliance tracking (T&C acceptance, age verification)
CREATE TABLE IF NOT EXISTS legal_compliance (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  terms_accepted BOOLEAN NOT NULL DEFAULT false,
  terms_accepted_at TIMESTAMPTZ,
  terms_version VARCHAR(50) DEFAULT 'v1.0',
  age_verified BOOLEAN NOT NULL DEFAULT false,
  age_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_compliance_user_id ON legal_compliance (user_id);
CREATE INDEX IF NOT EXISTS idx_legal_compliance_terms_accepted ON legal_compliance (terms_accepted);
CREATE INDEX IF NOT EXISTS idx_legal_compliance_age_verified ON legal_compliance (age_verified);

-- Self-exclusion tracking
CREATE TABLE IF NOT EXISTS self_exclusion (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  excluded_until TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_self_exclusion_excluded_until ON self_exclusion (excluded_until);
CREATE INDEX IF NOT EXISTS idx_self_exclusion_user_id ON self_exclusion (user_id);

-- Audit log for legal compliance actions
CREATE TABLE IF NOT EXISTS legal_audit_log (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('terms_accepted', 'age_verified', 'self_excluded', 'exclusion_cancelled', 'daily_limit_exceeded')),
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_audit_log_user_id ON legal_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_legal_audit_log_action ON legal_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_legal_audit_log_created_at ON legal_audit_log (created_at DESC);
