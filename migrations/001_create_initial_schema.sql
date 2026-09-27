-- Bật extension tạo UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ========== 1. users ==========
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  avatar_key VARCHAR(50) DEFAULT 'avatar_default',
  role VARCHAR(20) NOT NULL DEFAULT 'player',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT email_lowercase CHECK (email = LOWER(email)),
  CONSTRAINT username_length CHECK (LENGTH(username) >= 3),
  CONSTRAINT user_role_valid CHECK (role IN ('player', 'admin')),
  CONSTRAINT user_status_valid CHECK (status IN ('active', 'banned', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ========== 2. wallets ==========
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 100000,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT balance_non_negative CHECK (balance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);

-- ========== 3. wallet_transactions (Sổ cái / Ledger) ==========
-- Contract bắt buộc: mọi biến động xu phải ghi balance_before, balance_after,
-- idempotency_key, transaction_type thuộc danh sách cố định.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  transaction_type VARCHAR(50) NOT NULL,
  amount BIGINT NOT NULL,
  balance_before BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  actor_id UUID REFERENCES users(id),
  room_id UUID,
  round_id UUID,
  reward_session_id UUID,
  idempotency_key VARCHAR(100),
  reason VARCHAR(255),
  reference_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT txn_type_valid CHECK (transaction_type IN (
    'WELCOME', 'BET_DEBIT', 'BET_REFUND', 'ROUND_PAYOUT', 'ADMIN_GRANT', 'AD_REWARD'
  )),
  CONSTRAINT txn_amount_valid CHECK (amount <> 0)
);

-- Idempotency: mỗi user + idempotency_key chỉ được ghi 1 lần
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_idempotency
  ON wallet_transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_txns_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_created_at ON wallet_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_type ON wallet_transactions(transaction_type);

-- ========== 4. auth_sessions ==========
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

-- ========== 5. account_tokens ==========
CREATE TABLE IF NOT EXISTS account_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  type VARCHAR(50) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT token_type_valid CHECK (type IN ('email_verify', 'password_reset'))
);

CREATE INDEX IF NOT EXISTS idx_account_tokens_token_hash ON account_tokens(token_hash);

-- ========== 6. rooms ==========
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  host_id UUID NOT NULL REFERENCES users(id),
  mode VARCHAR(20) NOT NULL DEFAULT 'normal',
  capacity INT NOT NULL DEFAULT 20,
  betting_duration INT NOT NULL DEFAULT 30,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ,

  CONSTRAINT room_status_valid CHECK (status IN ('active', 'paused', 'closed')),
  CONSTRAINT room_mode_valid CHECK (mode IN ('normal', 'auto'))
);

CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- ========== 7. room_members ==========
-- Không dùng UNIQUE(room_id, user_id, left_at) vì NULLs distinct trong PostgreSQL.
-- Chỉ dùng partial unique index idx_unique_active_membership bên dưới.
CREATE TABLE IF NOT EXISTS room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'player',
  joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMPTZ,

  CONSTRAINT member_role_valid CHECK (role IN ('host', 'player'))
);

-- Mỗi user chỉ được tham gia 1 phòng active (left_at IS NULL) tại 1 thời điểm
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_membership
  ON room_members(user_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);

-- ========== 8. rounds ==========
CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'betting',
  dice JSONB,
  final_result JSONB,
  admin_override_result JSONB,
  result_mode VARCHAR(20) NOT NULL DEFAULT 'random',
  betting_deadline TIMESTAMPTZ,
  started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMPTZ,

  CONSTRAINT unique_room_round_number UNIQUE(room_id, round_number),
  CONSTRAINT round_status_valid CHECK (status IN (
    'waiting', 'betting', 'revealing', 'result', 'settled', 'cancelled'
  )),
  CONSTRAINT round_result_mode_valid CHECK (result_mode IN ('random', 'admin_scheduled'))
);

CREATE INDEX IF NOT EXISTS idx_rounds_room_id ON rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);

-- ========== 9. bets ==========
CREATE TABLE IF NOT EXISTS bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  amount BIGINT NOT NULL,
  payout BIGINT DEFAULT 0,
  request_id VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'placed',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT bet_amount_positive CHECK (amount > 0),
  CONSTRAINT bet_symbol_valid CHECK (symbol IN ('bau', 'cua', 'tom', 'ca', 'ga', 'nai')),
  CONSTRAINT bet_status_valid CHECK (status IN ('placed', 'won', 'lost', 'cancelled')),
  CONSTRAINT unique_round_user_symbol_request UNIQUE(round_id, user_id, symbol, request_id)
);

CREATE INDEX IF NOT EXISTS idx_bets_round_id ON bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);

-- ========== 10. player_round_results ==========
CREATE TABLE IF NOT EXISTS player_round_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  total_bet BIGINT NOT NULL DEFAULT 0,
  total_return BIGINT NOT NULL DEFAULT 0,
  net_gain BIGINT NOT NULL DEFAULT 0,
  outcome VARCHAR(20) NOT NULL,
  settled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_player_round_result UNIQUE(round_id, user_id),
  CONSTRAINT prr_outcome_valid CHECK (outcome IN ('win', 'loss', 'draw'))
);

CREATE INDEX IF NOT EXISTS idx_prr_user_id ON player_round_results(user_id);
CREATE INDEX IF NOT EXISTS idx_prr_room_id ON player_round_results(room_id);
CREATE INDEX IF NOT EXISTS idx_prr_settled_at ON player_round_results(settled_at);

-- ========== 11. processed_commands ==========
CREATE TABLE IF NOT EXISTS processed_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_key VARCHAR(150) NOT NULL UNIQUE,
  room_id UUID,
  user_id UUID REFERENCES users(id),
  command_type VARCHAR(50) NOT NULL,
  result_payload JSONB,
  processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proc_cmd_key ON processed_commands(command_key);
CREATE INDEX IF NOT EXISTS idx_proc_cmd_room ON processed_commands(room_id);

-- ========== 12. ad_reward_sessions ==========
CREATE TABLE IF NOT EXISTS ad_reward_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50),
  nonce VARCHAR(100),
  reward_amount BIGINT NOT NULL DEFAULT 50000,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  provider_transaction_id VARCHAR(150),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT ad_status_valid CHECK (status IN (
    'pending', 'completed', 'claimed', 'rejected', 'expired'
  ))
);

-- Nếu nhà cung cấp có transaction_id thì chống dùng lặp
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_provider_txn
  ON ad_reward_sessions(provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_reward_sessions_user_id ON ad_reward_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_reward_sessions_created_at ON ad_reward_sessions(created_at);

-- ========== 13. admin_audit_logs ==========
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  reason TEXT,
  changes JSONB,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs(created_at);

-- ========== 14. View: player_profiles ==========
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
  u.updated_at
FROM users u
JOIN wallets w ON u.id = w.user_id;
