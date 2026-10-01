-- TOTP multi-factor authentication for system administrators.
-- Secrets are encrypted by the application before they reach PostgreSQL.

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS admin_mfa_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  encrypted_secret TEXT NOT NULL,
  secret_iv VARCHAR(32) NOT NULL,
  secret_tag VARCHAR(32) NOT NULL,
  enabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT admin_mfa_iv_shape CHECK (secret_iv ~ '^[A-Za-z0-9_-]{16}$'),
  CONSTRAINT admin_mfa_tag_shape CHECK (secret_tag ~ '^[A-Za-z0-9_-]{22}$')
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_enabled
  ON admin_mfa_credentials(enabled_at)
  WHERE enabled_at IS NOT NULL;
