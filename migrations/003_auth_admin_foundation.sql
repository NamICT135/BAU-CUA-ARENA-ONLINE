-- Authentication/session hardening and the persistent login-rate-limit store.
-- This migration intentionally keeps auth_sessions.expires_at as the absolute
-- expiry used by the existing repository. New AuthService sessions also carry
-- a shorter, sliding idle_expires_at deadline.

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS csrf_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS idle_expires_at TIMESTAMPTZ;

-- Sessions created before this migration did not have a CSRF secret or an idle
-- deadline. They cannot be upgraded securely because the server never stored
-- their raw tokens, so revoke them and retain the rows as an audit trail.
UPDATE auth_sessions
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE csrf_token_hash IS NULL OR idle_expires_at IS NULL;

ALTER TABLE auth_sessions
  DROP CONSTRAINT IF EXISTS auth_session_csrf_hash_shape,
  ADD CONSTRAINT auth_session_csrf_hash_shape CHECK (
    csrf_token_hash IS NULL OR csrf_token_hash ~ '^[0-9a-f]{64}$'
  ),
  DROP CONSTRAINT IF EXISTS auth_session_idle_before_absolute,
  ADD CONSTRAINT auth_session_idle_before_absolute CHECK (
    idle_expires_at IS NULL OR idle_expires_at <= expires_at
  );

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_token_deadlines
  ON auth_sessions(token_hash, idle_expires_at, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_user_created
  ON auth_sessions(user_id, created_at DESC)
  WHERE revoked_at IS NULL;

-- Durable counters prevent a process restart from clearing brute-force
-- protection. Only SHA-256 digests of the normalized account identifier and
-- source address are stored; raw login identifiers are not copied here.
CREATE TABLE IF NOT EXISTS auth_login_rate_limits (
  scope VARCHAR(20) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (scope, key_hash),
  CONSTRAINT auth_rate_limit_scope_valid CHECK (scope IN ('account', 'ip')),
  CONSTRAINT auth_rate_limit_hash_shape CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_rate_limit_failure_count_valid CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_auth_login_rate_limits_cleanup
  ON auth_login_rate_limits(updated_at);

-- Password-reset lookup and invalidation are always scoped by user and type.
CREATE INDEX IF NOT EXISTS idx_account_tokens_user_type_active
  ON account_tokens(user_id, type, expires_at)
  WHERE used_at IS NULL;

