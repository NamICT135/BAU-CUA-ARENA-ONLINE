import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { query } from '../db/connection.js';
import { TransactionManager } from '../db/TransactionManager.js';
import { WalletService } from './WalletService.js';

export const AUTH_ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'AUTH_VALIDATION_ERROR',
  USERNAME_TAKEN: 'AUTH_USERNAME_TAKEN',
  EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  LOGIN_RATE_LIMITED: 'AUTH_LOGIN_RATE_LIMITED',
  ACCOUNT_BANNED: 'AUTH_ACCOUNT_BANNED',
  ACCOUNT_DELETED: 'AUTH_ACCOUNT_DELETED',
  ACCOUNT_INACTIVE: 'AUTH_ACCOUNT_INACTIVE',
  SESSION_INVALID: 'AUTH_SESSION_INVALID',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  CSRF_INVALID: 'AUTH_CSRF_INVALID',
  USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  CURRENT_PASSWORD_INVALID: 'AUTH_CURRENT_PASSWORD_INVALID',
  PASSWORD_UNCHANGED: 'AUTH_PASSWORD_UNCHANGED',
  CREDENTIALS_CHANGED: 'AUTH_CREDENTIALS_CHANGED',
  RESET_TOKEN_INVALID: 'AUTH_RESET_TOKEN_INVALID',
  INTERNAL_ERROR: 'AUTH_INTERNAL_ERROR',
});

const ERROR_STATUS = Object.freeze({
  [AUTH_ERROR_CODES.VALIDATION_ERROR]: 400,
  [AUTH_ERROR_CODES.USERNAME_TAKEN]: 409,
  [AUTH_ERROR_CODES.EMAIL_TAKEN]: 409,
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [AUTH_ERROR_CODES.LOGIN_RATE_LIMITED]: 429,
  [AUTH_ERROR_CODES.ACCOUNT_BANNED]: 403,
  [AUTH_ERROR_CODES.ACCOUNT_DELETED]: 403,
  [AUTH_ERROR_CODES.ACCOUNT_INACTIVE]: 403,
  [AUTH_ERROR_CODES.SESSION_INVALID]: 401,
  [AUTH_ERROR_CODES.SESSION_EXPIRED]: 401,
  [AUTH_ERROR_CODES.CSRF_INVALID]: 403,
  [AUTH_ERROR_CODES.USER_NOT_FOUND]: 404,
  [AUTH_ERROR_CODES.CURRENT_PASSWORD_INVALID]: 401,
  [AUTH_ERROR_CODES.PASSWORD_UNCHANGED]: 400,
  [AUTH_ERROR_CODES.CREDENTIALS_CHANGED]: 409,
  [AUTH_ERROR_CODES.RESET_TOKEN_INVALID]: 400,
  [AUTH_ERROR_CODES.INTERNAL_ERROR]: 500,
});

const DEFAULT_PASSWORD_HASH_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const USERNAME_PATTERN = /^[a-z0-9_]{3,50}$/;
const AVATAR_KEYS = new Set(['avatar_default', 'bau', 'cua', 'tom', 'ca', 'ga', 'nai']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AuthError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code] ?? 400;
    this.statusCode = this.status;
    if (Number.isFinite(options.retryAfterMs)) {
      this.retryAfterMs = Math.max(0, Math.ceil(options.retryAfterMs));
    }
  }

  toJSON() {
    const result = { code: this.code, message: this.message };
    if (this.retryAfterMs !== undefined) result.retryAfterMs = this.retryAfterMs;
    return result;
  }
}

function fail(code, message, options) {
  return new AuthError(code, message, options);
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqualHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function asDate(value) {
  if (value instanceof Date) return value;
  return value == null ? null : new Date(value);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.user_id ?? row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    avatarKey: row.avatar_key,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified_at),
    emailVerifiedAt: asDate(row.email_verified_at),
    createdAt: asDate(row.user_created_at ?? row.created_at),
    updatedAt: asDate(row.user_updated_at ?? row.updated_at),
  };
}

function publicWallet(row) {
  if (!row || !(row.wallet_id ?? row.id)) return null;
  const balance = Number(row.wallet_balance ?? row.balance);
  return {
    id: row.wallet_id ?? row.id,
    userId: row.user_id,
    balance,
    version: row.wallet_version ?? row.version,
    updatedAt: asDate(row.wallet_updated_at ?? row.updated_at),
  };
}

function publicSession(row) {
  return {
    id: row.session_id ?? row.id,
    absoluteExpiresAt: asDate(row.expires_at),
    idleExpiresAt: asDate(row.idle_expires_at),
    lastActivityAt: asDate(row.last_activity_at),
    createdAt: asDate(row.session_created_at ?? row.created_at),
  };
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export class AuthService {
  constructor(options = {}) {
    this.config = Object.freeze({
      sessionAbsoluteTtlMs: positiveInteger(options.sessionAbsoluteTtlMs ?? 7 * 24 * 60 * 60 * 1000, 'sessionAbsoluteTtlMs'),
      sessionIdleTtlMs: positiveInteger(options.sessionIdleTtlMs ?? 30 * 60 * 1000, 'sessionIdleTtlMs'),
      resetTokenTtlMs: positiveInteger(options.resetTokenTtlMs ?? 30 * 60 * 1000, 'resetTokenTtlMs'),
      loginWindowMs: positiveInteger(options.loginWindowMs ?? 15 * 60 * 1000, 'loginWindowMs'),
      loginBlockMs: positiveInteger(options.loginBlockMs ?? 15 * 60 * 1000, 'loginBlockMs'),
      loginAccountMaxAttempts: positiveInteger(options.loginAccountMaxAttempts ?? 5, 'loginAccountMaxAttempts'),
      loginIpMaxAttempts: positiveInteger(options.loginIpMaxAttempts ?? 20, 'loginIpMaxAttempts'),
      welcomeBalance: positiveInteger(options.welcomeBalance ?? 100_000, 'welcomeBalance'),
    });
    if (this.config.sessionIdleTtlMs > this.config.sessionAbsoluteTtlMs) {
      throw new TypeError('sessionIdleTtlMs cannot exceed sessionAbsoluteTtlMs');
    }
    if (this.config.welcomeBalance > 1_000_000_000_000) {
      throw new TypeError('welcomeBalance exceeds the wallet limit');
    }

    this.passwordHashOptions = Object.freeze({
      ...DEFAULT_PASSWORD_HASH_OPTIONS,
      ...(options.passwordHashOptions || {}),
      type: argon2.argon2id,
    });
    this.clock = typeof options.clock === 'function' ? options.clock : () => new Date();
    this.sendPasswordReset = typeof options.sendPasswordReset === 'function'
      ? options.sendPasswordReset
      : null;
    this.onDeliveryError = typeof options.onDeliveryError === 'function'
      ? options.onDeliveryError
      : null;
    this._dummyPasswordHashPromise = null;
  }

  async register({
    username,
    email,
    password,
    displayName,
    avatarKey = 'avatar_default',
    ipAddress = null,
    userAgent = null,
  } = {}) {
    return this._run(async () => {
      const account = {
        username: this._username(username),
        email: this._email(email),
        displayName: this._displayName(displayName),
        avatarKey: this._avatarKey(avatarKey),
      };
      const passwordHash = await argon2.hash(this._newPassword(password), this.passwordHashOptions);
      const credentials = this._newSessionCredentials();

      try {
        return await TransactionManager.withinTransaction(async (client) => {
          const userResult = await client.query(
            `INSERT INTO users
              (username, email, password_hash, display_name, avatar_key, role, status)
             VALUES ($1, $2, $3, $4, $5, 'player', 'active')
             RETURNING *`,
            [account.username, account.email, passwordHash, account.displayName, account.avatarKey],
          );
          const user = userResult.rows[0];
          const wallet = await WalletService.createWalletWithWelcomeGrant(
            user.id,
            this.config.welcomeBalance,
            client,
          );
          const session = await this._insertSession(client, user.id, credentials, { ipAddress, userAgent });

          return {
            user: publicUser(user),
            wallet: publicWallet({ ...wallet, wallet_id: wallet.id, wallet_balance: wallet.balance }),
            sessionToken: credentials.sessionToken,
            csrfToken: credentials.csrfToken,
            session: publicSession({ ...session, session_id: session.id }),
          };
        });
      } catch (error) {
        if (error?.code === '23505') {
          if (error.constraint === 'users_email_key') {
            throw fail(AUTH_ERROR_CODES.EMAIL_TAKEN, 'Email is already registered.');
          }
          if (error.constraint === 'users_username_key' || error.constraint === 'idx_users_username_lower_unique') {
            throw fail(AUTH_ERROR_CODES.USERNAME_TAKEN, 'Username is already registered.');
          }
        }
        throw error;
      }
    });
  }

  async login({ identifier, password, ipAddress = null, userAgent = null } = {}) {
    return this._run(async () => {
      const normalizedIdentifier = this._identifier(identifier);
      const candidatePassword = this._loginPassword(password);
      await query(`UPDATE users SET status='active', banned_at=NULL, banned_until=NULL, ban_reason=NULL
        WHERE (LOWER(username)=$1 OR email=$1) AND status='banned' AND banned_until<=CURRENT_TIMESTAMP`, [normalizedIdentifier]);
      const rateKeys = this._loginRateKeys(normalizedIdentifier, ipAddress);
      await this._assertLoginAllowed(rateKeys);

      const lookup = await query(
        `SELECT * FROM users
         WHERE LOWER(username) = $1 OR email = $1
         LIMIT 1`,
        [normalizedIdentifier],
      );
      const initialUser = lookup.rows[0] || null;
      const hash = initialUser?.password_hash ?? await this._dummyPasswordHash();
      const passwordMatches = await this._verifyPassword(hash, candidatePassword);

      if (!initialUser || !passwordMatches) {
        const limit = await this._recordLoginFailure(rateKeys);
        if (limit.blockedUntil) {
          throw fail(AUTH_ERROR_CODES.LOGIN_RATE_LIMITED, 'Too many login attempts. Try again later.', {
            retryAfterMs: limit.blockedUntil.getTime() - this._now().getTime(),
          });
        }
        throw fail(AUTH_ERROR_CODES.INVALID_CREDENTIALS, 'Invalid username/email or password.');
      }

      this._assertAccountCanAuthenticate(initialUser);
      const credentials = this._newSessionCredentials();

      return TransactionManager.withinTransaction(async (client) => {
        const currentResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [initialUser.id]);
        const currentUser = currentResult.rows[0];
        if (!currentUser || currentUser.password_hash !== initialUser.password_hash) {
          throw fail(AUTH_ERROR_CODES.INVALID_CREDENTIALS, 'Invalid username/email or password.');
        }
        this._assertAccountCanAuthenticate(currentUser);
        await this._assertLoginAllowed(rateKeys, client);

        const session = await this._insertSession(client, currentUser.id, credentials, { ipAddress, userAgent });
        await client.query(
          `DELETE FROM auth_login_rate_limits
           WHERE scope = 'account' AND key_hash = $1`,
          [rateKeys.account],
        );
        const walletResult = await client.query('SELECT * FROM wallets WHERE user_id = $1', [currentUser.id]);
        const wallet = walletResult.rows[0] || null;

        return {
          user: publicUser(currentUser),
          wallet: wallet ? publicWallet({ ...wallet, wallet_id: wallet.id, wallet_balance: wallet.balance }) : null,
          sessionToken: credentials.sessionToken,
          csrfToken: credentials.csrfToken,
          session: publicSession({ ...session, session_id: session.id }),
        };
      });
    });
  }

  async verifySession(rawToken, { csrfToken, requireCsrf = false, touch = true } = {}) {
    return this._run(async () => {
      if (!this._isOpaqueToken(rawToken)) {
        throw fail(AUTH_ERROR_CODES.SESSION_INVALID, 'Session is invalid.');
      }
      if (requireCsrf && !this._isOpaqueToken(csrfToken)) {
        throw fail(AUTH_ERROR_CODES.CSRF_INVALID, 'CSRF token is invalid.');
      }
      if (csrfToken !== undefined && !this._isOpaqueToken(csrfToken)) {
        throw fail(AUTH_ERROR_CODES.CSRF_INVALID, 'CSRF token is invalid.');
      }

      const tokenHash = sha256(rawToken);
      const csrfHash = csrfToken === undefined ? null : sha256(csrfToken);
      const now = this._now();
      const result = await TransactionManager.withinTransaction(async (client) => {
        const sessionResult = await client.query(
          `SELECT
             s.id AS session_id,
             s.csrf_token_hash,
             s.expires_at,
             s.idle_expires_at,
             s.last_activity_at,
             s.revoked_at,
             s.created_at AS session_created_at,
             u.id AS user_id,
             u.username,
             u.email,
             u.display_name,
             u.avatar_key,
             u.role,
             u.status,
             u.email_verified_at,
             u.deleted_at,
             u.created_at AS user_created_at,
             u.updated_at AS user_updated_at
           FROM auth_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1
           FOR UPDATE OF s, u`,
          [tokenHash],
        );
        const row = sessionResult.rows[0];
        if (!row || row.revoked_at || !row.csrf_token_hash || !row.idle_expires_at) {
          return { failure: [AUTH_ERROR_CODES.SESSION_INVALID, 'Session is invalid.'] };
        }

        const absoluteExpiresAt = asDate(row.expires_at);
        const idleExpiresAt = asDate(row.idle_expires_at);
        if (absoluteExpiresAt <= now || idleExpiresAt <= now) {
          await client.query(
            'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1',
            [row.session_id, now],
          );
          return { failure: [AUTH_ERROR_CODES.SESSION_EXPIRED, 'Session has expired.'] };
        }
        if (row.deleted_at || row.status === 'deleted') {
          await client.query(
            'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1',
            [row.session_id, now],
          );
          return { failure: [AUTH_ERROR_CODES.ACCOUNT_DELETED, 'Account is unavailable.'] };
        }
        if (row.status === 'banned') {
          await client.query(
            'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1',
            [row.session_id, now],
          );
          return { failure: [AUTH_ERROR_CODES.ACCOUNT_BANNED, 'Account is banned.'] };
        }
        if (row.status !== 'active') {
          return { failure: [AUTH_ERROR_CODES.ACCOUNT_INACTIVE, 'Account is unavailable.'] };
        }
        if ((requireCsrf || csrfToken !== undefined) && !safeEqualHex(row.csrf_token_hash, csrfHash)) {
          return { failure: [AUTH_ERROR_CODES.CSRF_INVALID, 'CSRF token is invalid.'] };
        }

        let sessionRow = row;
        if (touch) {
          const proposedIdle = new Date(now.getTime() + this.config.sessionIdleTtlMs);
          const nextIdle = proposedIdle < absoluteExpiresAt ? proposedIdle : absoluteExpiresAt;
          const touchResult = await client.query(
            `UPDATE auth_sessions
             SET last_activity_at = $2, idle_expires_at = $3
             WHERE id = $1
             RETURNING id AS session_id, expires_at, idle_expires_at,
                       last_activity_at, created_at AS session_created_at`,
            [row.session_id, now, nextIdle],
          );
          sessionRow = { ...row, ...touchResult.rows[0] };
        }

        const user = publicUser(row);
        return {
          userId: user.id,
          role: user.role,
          user,
          session: publicSession(sessionRow),
        };
      });

      if (result.failure) throw fail(result.failure[0], result.failure[1]);
      return result;
    });
  }

  async logout(rawToken) {
    return this._run(async () => {
      if (!this._isOpaqueToken(rawToken)) return { revoked: false };
      const result = await query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING id`,
        [sha256(rawToken)],
      );
      return { revoked: result.rowCount > 0 };
    });
  }

  async logoutAll(userId) {
    return this._run(async () => {
      this._uuid(userId, 'userId');
      const result = await query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      return { revokedCount: result.rowCount };
    });
  }

  async getProfile(userId) {
    return this._run(async () => {
      this._uuid(userId, 'userId');
      const result = await query(
        `SELECT u.*, u.created_at AS user_created_at, u.updated_at AS user_updated_at,
                w.id AS wallet_id, w.balance AS wallet_balance,
                w.version AS wallet_version, w.updated_at AS wallet_updated_at
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
         WHERE u.id = $1`,
        [userId],
      );
      const row = result.rows[0];
      if (!row) throw fail(AUTH_ERROR_CODES.USER_NOT_FOUND, 'User was not found.');
      this._assertAccountAvailable(row);
      return { user: publicUser(row), wallet: publicWallet(row) };
    });
  }

  async updateProfile(userId, { displayName, avatarKey } = {}) {
    return this._run(async () => {
      this._uuid(userId, 'userId');
      if (displayName === undefined && avatarKey === undefined) {
        throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'At least one profile field is required.');
      }
      const normalizedDisplayName = displayName === undefined ? null : this._displayName(displayName);
      const normalizedAvatarKey = avatarKey === undefined ? null : this._avatarKey(avatarKey);

      const result = await TransactionManager.withinTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const existing = existingResult.rows[0];
        if (!existing) throw fail(AUTH_ERROR_CODES.USER_NOT_FOUND, 'User was not found.');
        this._assertAccountAvailable(existing);

        const updated = await client.query(
          `UPDATE users
           SET display_name = COALESCE($2, display_name),
               avatar_key = COALESCE($3, avatar_key),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [userId, normalizedDisplayName, normalizedAvatarKey],
        );
        return updated.rows[0];
      });
      return { user: publicUser(result) };
    });
  }

  async changePassword({ userId, currentPassword, newPassword } = {}) {
    return this._run(async () => {
      this._uuid(userId, 'userId');
      const candidateCurrent = this._loginPassword(currentPassword);
      const candidateNew = this._newPassword(newPassword);
      const initialResult = await query('SELECT * FROM users WHERE id = $1', [userId]);
      const initialUser = initialResult.rows[0];
      if (!initialUser) throw fail(AUTH_ERROR_CODES.USER_NOT_FOUND, 'User was not found.');
      this._assertAccountAvailable(initialUser);

      if (!await this._verifyPassword(initialUser.password_hash, candidateCurrent)) {
        throw fail(AUTH_ERROR_CODES.CURRENT_PASSWORD_INVALID, 'Current password is incorrect.');
      }
      if (await this._verifyPassword(initialUser.password_hash, candidateNew)) {
        throw fail(AUTH_ERROR_CODES.PASSWORD_UNCHANGED, 'New password must be different.');
      }
      const newPasswordHash = await argon2.hash(candidateNew, this.passwordHashOptions);

      return TransactionManager.withinTransaction(async (client) => {
        const lockedResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const lockedUser = lockedResult.rows[0];
        if (!lockedUser) throw fail(AUTH_ERROR_CODES.USER_NOT_FOUND, 'User was not found.');
        this._assertAccountAvailable(lockedUser);
        if (lockedUser.password_hash !== initialUser.password_hash) {
          throw fail(AUTH_ERROR_CODES.CREDENTIALS_CHANGED, 'Credentials changed during the request.');
        }

        const userResult = await client.query(
          `UPDATE users
           SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [userId, newPasswordHash],
        );
        const revoked = await client.query(
          `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        await client.query(
          `UPDATE account_tokens SET used_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND type = 'password_reset' AND used_at IS NULL`,
          [userId],
        );
        return { user: publicUser(userResult.rows[0]), revokedCount: revoked.rowCount };
      });
    });
  }

  async requestPasswordReset({ email, sendPasswordReset, ipAddress: _ipAddress = null } = {}) {
    return this._run(async () => {
      const normalizedEmail = this._email(email);
      const lookup = await query(
        `SELECT * FROM users
         WHERE email = $1
           AND status = 'active'
           AND deleted_at IS NULL
           AND email_verified_at IS NOT NULL`,
        [normalizedEmail],
      );
      const initialUser = lookup.rows[0];
      if (!initialUser) return { accepted: true };

      const token = randomBytes(32).toString('base64url');
      const tokenHash = sha256(token);
      const now = this._now();
      const expiresAt = new Date(now.getTime() + this.config.resetTokenTtlMs);
      const delivery = await TransactionManager.withinTransaction(async (client) => {
        const locked = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [initialUser.id]);
        const user = locked.rows[0];
        if (!user || user.status !== 'active' || user.deleted_at || !user.email_verified_at) return null;
        const recent = await client.query("SELECT id FROM account_tokens WHERE user_id=$1 AND type='password_reset' AND created_at>CURRENT_TIMESTAMP-INTERVAL '1 minute'", [user.id]);
        if (recent.rowCount) return null;

        await client.query(
          `UPDATE account_tokens
           SET used_at = $2
           WHERE user_id = $1 AND type = 'password_reset' AND used_at IS NULL`,
          [user.id, now],
        );
        await client.query(
          `INSERT INTO account_tokens (user_id, token_hash, type, expires_at)
           VALUES ($1, $2, 'password_reset', $3)`,
          [user.id, tokenHash, expiresAt],
        );
        return { to: user.email, token, expiresAt, user: publicUser(user) };
      });

      const sender = typeof sendPasswordReset === 'function' ? sendPasswordReset : this.sendPasswordReset;
      if (delivery && sender) {
        try {
          await sender(delivery);
        } catch (error) {
          try {
            await this.onDeliveryError?.(error, { userId: delivery.user.id });
          } catch {
            // Delivery monitoring must never change the public, non-enumerating response.
          }
        }
      }
      return { accepted: true };
    });
  }

  async resetPassword({ token, newPassword } = {}) {
    return this._run(async () => {
      if (!this._isOpaqueToken(token)) {
        throw fail(AUTH_ERROR_CODES.RESET_TOKEN_INVALID, 'Password reset token is invalid or expired.');
      }
      const candidateNew = this._newPassword(newPassword);
      const newPasswordHash = await argon2.hash(candidateNew, this.passwordHashOptions);
      const tokenHash = sha256(token);
      const now = this._now();

      const result = await TransactionManager.withinTransaction(async (client) => {
        const tokenResult = await client.query(
          `SELECT
             t.id AS token_id, t.user_id, t.expires_at, t.used_at,
             u.username, u.email, u.display_name, u.avatar_key, u.role,
             u.status, u.deleted_at, u.email_verified_at,
             u.created_at AS user_created_at, u.updated_at AS user_updated_at
           FROM account_tokens t
           JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = $1 AND t.type = 'password_reset'
           FOR UPDATE OF t, u`,
          [tokenHash],
        );
        const row = tokenResult.rows[0];
        if (!row || row.used_at || asDate(row.expires_at) <= now || row.deleted_at || row.status === 'deleted') {
          return { failure: true };
        }

        const userResult = await client.query(
          `UPDATE users
           SET password_hash = $2, updated_at = $3
           WHERE id = $1
           RETURNING *`,
          [row.user_id, newPasswordHash, now],
        );
        await client.query(
          `UPDATE account_tokens SET used_at = $2
           WHERE user_id = $1 AND type = 'password_reset' AND used_at IS NULL`,
          [row.user_id, now],
        );
        const revoked = await client.query(
          `UPDATE auth_sessions SET revoked_at = $2
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [row.user_id, now],
        );
        return { user: publicUser(userResult.rows[0]), revokedCount: revoked.rowCount };
      });

      if (result.failure) {
        throw fail(AUTH_ERROR_CODES.RESET_TOKEN_INVALID, 'Password reset token is invalid or expired.');
      }
      return result;
    });
  }

  async consumePasswordReset(input) {
    return this.resetPassword(input);
  }

  async requestEmailVerification({ userId, sendEmail }) {
    return this._run(async () => {
      this._uuid(userId, 'userId');
      const token = randomBytes(32).toString('base64url');
      const delivery = await TransactionManager.withinTransaction(async client => {
        const result = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId]);
        const user = result.rows[0];
        if (!user) throw fail(AUTH_ERROR_CODES.USER_NOT_FOUND, 'Không tìm thấy tài khoản.');
        this._assertAccountAvailable(user);
        if (user.email_verified_at) return null;
        const recent = await client.query("SELECT id FROM account_tokens WHERE user_id=$1 AND type='email_verify' AND created_at>CURRENT_TIMESTAMP-INTERVAL '1 minute'", [userId]);
        if (recent.rowCount) throw fail(AUTH_ERROR_CODES.LOGIN_RATE_LIMITED, 'Chờ một phút trước khi yêu cầu lại.');
        await client.query("UPDATE account_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND type='email_verify' AND used_at IS NULL", [userId]);
        await client.query("INSERT INTO account_tokens(user_id,token_hash,type,expires_at) VALUES($1,$2,'email_verify',CURRENT_TIMESTAMP+INTERVAL '30 minutes')", [userId, sha256(token)]);
        return { to: user.email, token, type: 'email_verify' };
      });
      if (delivery) await sendEmail(delivery);
      return { accepted: true };
    });
  }

  async verifyEmail({ token }) {
    return this._run(async () => {
      if (!this._isOpaqueToken(token)) throw fail(AUTH_ERROR_CODES.RESET_TOKEN_INVALID, 'Liên kết không hợp lệ hoặc đã hết hạn.');
      return TransactionManager.withinTransaction(async client => {
        const result = await client.query(`SELECT t.id,t.user_id FROM account_tokens t JOIN users u ON u.id=t.user_id
          WHERE t.token_hash=$1 AND t.type='email_verify' AND t.used_at IS NULL AND t.expires_at>CURRENT_TIMESTAMP
          AND u.status='active' FOR UPDATE OF t,u`, [sha256(token)]);
        const row = result.rows[0];
        if (!row) throw fail(AUTH_ERROR_CODES.RESET_TOKEN_INVALID, 'Liên kết không hợp lệ hoặc đã hết hạn.');
        await client.query('UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=$1', [row.user_id]);
        await client.query('UPDATE account_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=$1', [row.id]);
        return { verified: true };
      });
    });
  }

  async _insertSession(client, userId, credentials, { ipAddress, userAgent }) {
    const result = await client.query(
      `INSERT INTO auth_sessions
        (user_id, token_hash, csrf_token_hash, ip_address, user_agent,
         expires_at, idle_expires_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        credentials.sessionTokenHash,
        credentials.csrfTokenHash,
        this._ipForStorage(ipAddress),
        this._userAgent(userAgent),
        credentials.absoluteExpiresAt,
        credentials.idleExpiresAt,
        credentials.createdAt,
      ],
    );
    return result.rows[0];
  }

  _newSessionCredentials() {
    const createdAt = this._now();
    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const absoluteExpiresAt = new Date(createdAt.getTime() + this.config.sessionAbsoluteTtlMs);
    const idleExpiresAt = new Date(Math.min(
      absoluteExpiresAt.getTime(),
      createdAt.getTime() + this.config.sessionIdleTtlMs,
    ));
    return {
      sessionToken,
      csrfToken,
      sessionTokenHash: sha256(sessionToken),
      csrfTokenHash: sha256(csrfToken),
      createdAt,
      absoluteExpiresAt,
      idleExpiresAt,
    };
  }

  _loginRateKeys(identifier, ipAddress) {
    const source = this._ipForRateLimit(ipAddress);
    return {
      account: sha256(`account:${identifier}`),
      ip: sha256(`ip:${source}`),
    };
  }

  async _assertLoginAllowed(keys, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `SELECT scope, key_hash, blocked_until
       FROM auth_login_rate_limits
       WHERE (scope = 'account' AND key_hash = $1)
          OR (scope = 'ip' AND key_hash = $2)`,
      [keys.account, keys.ip],
    );
    const now = this._now();
    const activeBlocks = result.rows
      .map(row => asDate(row.blocked_until))
      .filter(until => until && until > now);
    if (activeBlocks.length > 0) {
      const blockedUntil = new Date(Math.max(...activeBlocks.map(date => date.getTime())));
      throw fail(AUTH_ERROR_CODES.LOGIN_RATE_LIMITED, 'Too many login attempts. Try again later.', {
        retryAfterMs: blockedUntil.getTime() - now.getTime(),
      });
    }
  }

  async _recordLoginFailure(keys) {
    const now = this._now();
    const cutoff = new Date(now.getTime() - this.config.loginWindowMs);
    const newBlock = new Date(now.getTime() + this.config.loginBlockMs);
    const scopes = [
      ['account', keys.account, this.config.loginAccountMaxAttempts],
      ['ip', keys.ip, this.config.loginIpMaxAttempts],
    ];

    const rows = await TransactionManager.withinTransaction(async (client) => {
      const updated = [];
      for (const [scope, keyHash, maximum] of scopes) {
        const result = await client.query(
          `INSERT INTO auth_login_rate_limits
             (scope, key_hash, failure_count, window_started_at, blocked_until, updated_at)
           VALUES ($1, $2, 1, $3, CASE WHEN 1 >= $4 THEN $5::timestamptz ELSE NULL END, $3)
           ON CONFLICT (scope, key_hash) DO UPDATE SET
             failure_count = CASE
               WHEN auth_login_rate_limits.window_started_at <= $6 THEN 1
               ELSE auth_login_rate_limits.failure_count + 1
             END,
             window_started_at = CASE
               WHEN auth_login_rate_limits.window_started_at <= $6 THEN $3
               ELSE auth_login_rate_limits.window_started_at
             END,
             blocked_until = CASE
               WHEN (CASE
                 WHEN auth_login_rate_limits.window_started_at <= $6 THEN 1
                 ELSE auth_login_rate_limits.failure_count + 1
               END) >= $4
                 THEN CASE
                   WHEN auth_login_rate_limits.blocked_until > $5
                     THEN auth_login_rate_limits.blocked_until
                   ELSE $5::timestamptz
                 END
               WHEN auth_login_rate_limits.blocked_until > $3
                 THEN auth_login_rate_limits.blocked_until
               ELSE NULL
             END,
             updated_at = $3
           RETURNING scope, failure_count, blocked_until`,
          [scope, keyHash, now, maximum, newBlock, cutoff],
        );
        updated.push(result.rows[0]);
      }
      return updated;
    });

    const activeBlocks = rows
      .map(row => asDate(row.blocked_until))
      .filter(until => until && until > now);
    return {
      blockedUntil: activeBlocks.length
        ? new Date(Math.max(...activeBlocks.map(date => date.getTime())))
        : null,
    };
  }

  _assertAccountCanAuthenticate(user) {
    if (user.deleted_at || user.status === 'deleted') {
      throw fail(AUTH_ERROR_CODES.ACCOUNT_DELETED, 'Account is unavailable.');
    }
    if (user.status === 'banned') {
      throw fail(AUTH_ERROR_CODES.ACCOUNT_BANNED, 'Account is banned.');
    }
    if (user.status !== 'active') {
      throw fail(AUTH_ERROR_CODES.ACCOUNT_INACTIVE, 'Account is unavailable.');
    }
  }

  _assertAccountAvailable(user) {
    this._assertAccountCanAuthenticate(user);
  }

  async _dummyPasswordHash() {
    if (!this._dummyPasswordHashPromise) {
      this._dummyPasswordHashPromise = argon2.hash(randomBytes(32), this.passwordHashOptions);
    }
    return this._dummyPasswordHashPromise;
  }

  async _verifyPassword(hash, password) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  _now() {
    const value = this.clock();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('clock must return a valid date');
    return date;
  }

  _username(value) {
    if (typeof value !== 'string') throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Username is required.');
    const normalized = value.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(normalized)) {
      throw fail(
        AUTH_ERROR_CODES.VALIDATION_ERROR,
        'Username must be 3-50 characters and contain only letters, numbers, or underscores.',
      );
    }
    return normalized;
  }

  _identifier(value) {
    if (typeof value !== 'string') {
      throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Username or email is required.');
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.length < 3 || normalized.length > 255) {
      throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Username or email is invalid.');
    }
    return normalized;
  }

  _email(value) {
    if (typeof value !== 'string') throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Email is required.');
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 255 || !EMAIL_PATTERN.test(normalized)) {
      throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Email is invalid.');
    }
    return normalized;
  }

  _displayName(value) {
    if (typeof value !== 'string') {
      throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Display name is required.');
    }
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length < 2 || normalized.length > 24 || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
      throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Tên hiển thị phải có 2–24 ký tự hợp lệ.');
    }
    return normalized;
  }

  _avatarKey(value) {
    if (typeof value !== 'string' || !AVATAR_KEYS.has(value.trim())) {
      throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Avatar key is invalid.');
    }
    return value.trim();
  }

  _newPassword(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
      throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, 'Password must be 8-128 characters.');
    }
    return value;
  }

  _loginPassword(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
      throw fail(AUTH_ERROR_CODES.INVALID_CREDENTIALS, 'Invalid username/email or password.');
    }
    return value;
  }

  _uuid(value, field) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw fail(AUTH_ERROR_CODES.VALIDATION_ERROR, `${field} is invalid.`);
    }
    return value;
  }

  _isOpaqueToken(value) {
    return typeof value === 'string' && OPAQUE_TOKEN_PATTERN.test(value);
  }

  _ipForStorage(value) {
    if (value == null || value === '') return null;
    const normalized = String(value).trim();
    return normalized.length <= 45 ? normalized : normalized.slice(0, 45);
  }

  _ipForRateLimit(value) {
    return this._ipForStorage(value)?.toLowerCase() || 'unknown';
  }

  _userAgent(value) {
    if (value == null || value === '') return null;
    return String(value).trim().slice(0, 1000) || null;
  }

  async _run(callback) {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw fail(AUTH_ERROR_CODES.INTERNAL_ERROR, 'Authentication service is temporarily unavailable.', {
        cause: error,
      });
    }
  }
}

export default AuthService;

