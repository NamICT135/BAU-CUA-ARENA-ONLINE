-- Harden the initial schema before authentication/admin features are wired.
-- Keep 001 immutable so an existing database can be upgraded safely.

-- Usernames are looked up case-insensitively, so the database must enforce
-- the same identity rule. Abort with a useful error if legacy duplicates need
-- manual reconciliation first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    GROUP BY LOWER(username)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce case-insensitive usernames: duplicate legacy usernames exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower_unique
  ON users (LOWER(username));

-- Runtime idempotency keys include command type, round UUID, user UUID and a
-- caller request id. The initial 100/150-character limits were too small for
-- otherwise valid 100-character request ids.
ALTER TABLE wallet_transactions
  ALTER COLUMN idempotency_key TYPE VARCHAR(255);

ALTER TABLE processed_commands
  ALTER COLUMN command_key TYPE VARCHAR(255);

-- Older repository helpers allowed ledger rows and bets without a caller key.
-- Preserve those historical rows with a stable, non-replayable legacy key,
-- then make the invariant mandatory for every new write.
UPDATE wallet_transactions
SET idempotency_key = 'legacy:' || id::text
WHERE idempotency_key IS NULL;

ALTER TABLE wallet_transactions
  ALTER COLUMN idempotency_key SET NOT NULL;

UPDATE bets
SET request_id = 'legacy:' || id::text
WHERE request_id IS NULL;

ALTER TABLE bets
  ALTER COLUMN request_id SET NOT NULL;

-- Fields required by the planned account verification and reversible ban
-- workflow. Deletion remains soft through status/deleted_at.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ban_reason TEXT,
  ADD COLUMN IF NOT EXISTS banned_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE OR REPLACE VIEW player_profiles AS
SELECT
  u.id AS user_id,
  u.username,
  u.email,
  u.display_name,
  u.avatar_key,
  u.role,
  u.status,
  w.id AS wallet_id,
  w.balance,
  w.version AS wallet_version,
  u.created_at,
  u.updated_at,
  u.email_verified_at,
  u.banned_at,
  u.banned_until,
  u.ban_reason
FROM users u
JOIN wallets w ON u.id = w.user_id;

-- Financial/game history must not disappear through a direct user delete.
-- Production account removal is a soft delete; hard deletion is only possible
-- after an explicit retention/erasure workflow removes dependent data.
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_user_id_fkey,
  ADD CONSTRAINT wallets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_wallet_id_fkey,
  ADD CONSTRAINT wallet_transactions_wallet_id_fkey
    FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT;

ALTER TABLE bets
  DROP CONSTRAINT IF EXISTS bets_user_id_fkey,
  ADD CONSTRAINT bets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE player_round_results
  DROP CONSTRAINT IF EXISTS player_round_results_user_id_fkey,
  ADD CONSTRAINT player_round_results_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE ad_reward_sessions
  DROP CONSTRAINT IF EXISTS ad_reward_sessions_user_id_fkey,
  ADD CONSTRAINT ad_reward_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- The application exposes balances as JavaScript numbers and currently caps
-- game wallets at one trillion coins. Enforce that contract at rest as well.
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS balance_safe_integer,
  ADD CONSTRAINT balance_safe_integer
    CHECK (balance >= 0 AND balance <= 1000000000000),
  DROP CONSTRAINT IF EXISTS wallet_version_positive,
  ADD CONSTRAINT wallet_version_positive CHECK (version >= 1);

ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS txn_balances_safe_integer,
  ADD CONSTRAINT txn_balances_safe_integer CHECK (
    balance_before >= 0 AND balance_before <= 1000000000000 AND
    balance_after >= 0 AND balance_after <= 1000000000000 AND
    amount >= -1000000000000 AND amount <= 1000000000000
  ),
  DROP CONSTRAINT IF EXISTS txn_balance_equation,
  ADD CONSTRAINT txn_balance_equation CHECK (balance_after = balance_before + amount);

UPDATE bets SET payout = 0 WHERE payout IS NULL;

ALTER TABLE bets
  ALTER COLUMN payout SET NOT NULL,
  DROP CONSTRAINT IF EXISTS bet_payout_non_negative,
  ADD CONSTRAINT bet_payout_non_negative CHECK (payout >= 0);

ALTER TABLE player_round_results
  DROP CONSTRAINT IF EXISTS player_round_totals_valid,
  ADD CONSTRAINT player_round_totals_valid CHECK (
    total_bet >= 0 AND
    total_return >= 0 AND
    net_gain = total_return - total_bet
  );

-- Only one current host and one unfinished round may exist per room. These
-- indexes turn lifecycle bugs into transaction failures instead of allowing
-- silently divergent state.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_host_per_room
  ON room_members(room_id)
  WHERE left_at IS NULL AND role = 'host';

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_unfinished_round_per_room
  ON rounds(room_id)
  WHERE status IN ('waiting', 'betting', 'revealing', 'result');

-- Persisted results must always be a three-die JSON array. Symbol validation
-- remains in the game service and settlement transaction.
ALTER TABLE rounds
  DROP CONSTRAINT IF EXISTS round_dice_shape,
  ADD CONSTRAINT round_dice_shape CHECK (
    dice IS NULL OR (jsonb_typeof(dice) = 'array' AND jsonb_array_length(dice) = 3)
  ),
  DROP CONSTRAINT IF EXISTS round_final_result_shape,
  ADD CONSTRAINT round_final_result_shape CHECK (
    final_result IS NULL OR
    (jsonb_typeof(final_result) = 'array' AND jsonb_array_length(final_result) = 3)
  ),
  DROP CONSTRAINT IF EXISTS round_admin_override_shape,
  ADD CONSTRAINT round_admin_override_shape CHECK (
    admin_override_result IS NULL OR
    (jsonb_typeof(admin_override_result) = 'array' AND jsonb_array_length(admin_override_result) = 3)
  );

-- Reward/admin fields needed for replay-safe callbacks and idempotent admin
-- commands. They are inert until those services are implemented.
ALTER TABLE ad_reward_sessions
  ADD COLUMN IF NOT EXISTS config_version INTEGER,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS callback_received_at TIMESTAMPTZ;

ALTER TABLE admin_audit_logs
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS succeeded BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_audit_request
  ON admin_audit_logs(admin_id, request_id)
  WHERE request_id IS NOT NULL;

-- Access paths used by session validation, unsettled-bet checks, history and
-- recovery. Existing single-column indexes are kept for other query shapes.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_user
  ON auth_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bets_user_status_round
  ON bets(user_id, status, round_id);

CREATE INDEX IF NOT EXISTS idx_rounds_room_status
  ON rounds(room_id, status);

CREATE INDEX IF NOT EXISTS idx_wallet_txns_user_created
  ON wallet_transactions(user_id, created_at DESC);
