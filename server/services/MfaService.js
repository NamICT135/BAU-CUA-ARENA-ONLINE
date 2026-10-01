import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from '../db/connection.js';
import { TransactionManager } from '../db/TransactionManager.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export class MfaError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'MfaError';
    this.code = code;
    this.status = status;
  }
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const normalized = String(input).replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new MfaError('MFA_SECRET_INVALID', 'Secret MFA không hợp lệ.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now()) {
  const counter = BigInt(Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

function validCode(secret, code, now = Date.now()) {
  return matchedCounter(secret, code, now) !== null;
}

function matchedCounter(secret, code, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const supplied = Buffer.from(code);
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(totp(secret, now + offset * TOTP_PERIOD_SECONDS * 1000));
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return Math.floor((now + offset * TOTP_PERIOD_SECONDS * 1000) / 30000);
  }
  return null;
}

function encryptionKey() {
  const configured = process.env.MFA_ENCRYPTION_KEY;
  if (configured) {
    let decoded;
    try { decoded = Buffer.from(configured, 'base64url'); } catch { /* handled below */ }
    if (decoded?.length === 32) return decoded;
    throw new MfaError('MFA_CONFIG_INVALID', 'MFA_ENCRYPTION_KEY phải là khóa base64url 32 byte.', 503);
  }
  if (process.env.NODE_ENV !== 'production' && process.env.DB_PASSWORD) {
    return scryptSync(process.env.DB_PASSWORD, 'bau-cua-mfa-development-v1', 32);
  }
  throw new MfaError('MFA_NOT_CONFIGURED', 'Máy chủ chưa cấu hình khóa mã hóa MFA.', 503);
}

function encrypt(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    encryptedSecret: encrypted.toString('base64url'),
    secretIv: iv.toString('base64url'),
    secretTag: cipher.getAuthTag().toString('base64url'),
  };
}

function decrypt(row) {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(row.secret_iv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(row.secret_tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(row.encrypted_secret, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof MfaError) throw error;
    throw new MfaError('MFA_SECRET_UNAVAILABLE', 'Không thể giải mã cấu hình MFA.', 503);
  }
}

async function requireAdmin(client, userId) {
  const result = await client.query(
    `SELECT id, username, email, role, status FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  const user = result.rows[0];
  if (!user || user.status !== 'active') throw new MfaError('AUTH_REQUIRED', 'Tài khoản không còn hoạt động.', 401);
  if (user.role !== 'admin') throw new MfaError('ADMIN_REQUIRED', 'Chỉ quản trị viên được dùng MFA quản trị.', 403);
  return user;
}

export class MfaService {
  async status({ userId, sessionId }) {
    const result = await query(
      `SELECT u.role, credential.enabled_at,
              session.mfa_verified_at
       FROM users u
       JOIN auth_sessions session ON session.id = $2 AND session.user_id = u.id
       LEFT JOIN admin_mfa_credentials credential ON credential.user_id = u.id
       WHERE u.id = $1 AND u.status = 'active'
         AND session.revoked_at IS NULL
         AND session.expires_at > CURRENT_TIMESTAMP
         AND session.idle_expires_at > CURRENT_TIMESTAMP`,
      [userId, sessionId]
    );
    const row = result.rows[0];
    if (!row) throw new MfaError('AUTH_REQUIRED', 'Phiên đăng nhập không còn hợp lệ.', 401);
    const required = row.role === 'admin';
    return {
      required,
      configured: Boolean(row.enabled_at),
      verified: !required || Boolean(row.mfa_verified_at),
    };
  }

  async beginSetup({ userId }) {
    return TransactionManager.withinTransaction(async client => {
      const user = await requireAdmin(client, userId);
      const existing = await client.query('SELECT enabled_at FROM admin_mfa_credentials WHERE user_id=$1 FOR UPDATE', [userId]);
      if (existing.rows[0]?.enabled_at) throw new MfaError('MFA_ALREADY_CONFIGURED', 'MFA đã được thiết lập. Dùng lệnh khôi phục khi cần thay khóa.', 409);
      const secret = base32Encode(randomBytes(20));
      const encrypted = encrypt(secret);
      await client.query(
        `INSERT INTO admin_mfa_credentials
           (user_id, encrypted_secret, secret_iv, secret_tag, enabled_at)
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
           encrypted_secret = EXCLUDED.encrypted_secret,
           secret_iv = EXCLUDED.secret_iv,
           secret_tag = EXCLUDED.secret_tag,
           enabled_at = NULL,
           failed_attempts = 0, blocked_until = NULL, last_verified_counter = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, encrypted.encryptedSecret, encrypted.secretIv, encrypted.secretTag]
      );
      const label = encodeURIComponent(`Bau Cua Victory:${user.username}`);
      const issuer = encodeURIComponent('Bau Cua Victory');
      return {
        secret,
        otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
      };
    });
  }

  async verifySetup({ userId, sessionId, code }) {
    return this._verify({ userId, sessionId, code, setup: true });
  }

  async verify({ userId, sessionId, code }) {
    return this._verify({ userId, sessionId, code, setup: false });
  }

  async _verify({ userId, sessionId, code, setup }) {
    const result = await TransactionManager.withinTransaction(async client => {
      await requireAdmin(client, userId);
      const credentialResult = await client.query(
        'SELECT * FROM admin_mfa_credentials WHERE user_id=$1 FOR UPDATE',
        [userId]
      );
      const credential = credentialResult.rows[0];
      if (!credential) throw new MfaError('MFA_SETUP_REQUIRED', 'Tài khoản admin chưa thiết lập MFA.', 409);
      if (setup && credential.enabled_at) throw new MfaError('MFA_ALREADY_CONFIGURED', 'MFA đã được thiết lập.', 409);
      if (!setup && !credential.enabled_at) throw new MfaError('MFA_SETUP_REQUIRED', 'Cần hoàn tất thiết lập MFA.', 409);
      if (credential.blocked_until && new Date(credential.blocked_until) > new Date()) return { failure: 'MFA_RATE_LIMITED' };
      if (credential.blocked_until) {
        await client.query('UPDATE admin_mfa_credentials SET failed_attempts=0, blocked_until=NULL WHERE user_id=$1', [userId]);
      }
      const counter = matchedCounter(decrypt(credential), code);
      if (counter === null || (credential.last_verified_counter !== null && counter <= Number(credential.last_verified_counter))) {
        await client.query(`UPDATE admin_mfa_credentials SET failed_attempts=failed_attempts+1,
          blocked_until=CASE WHEN failed_attempts+1>=5 THEN CURRENT_TIMESTAMP+INTERVAL '15 minutes' ELSE NULL END
          WHERE user_id=$1`, [userId]);
        return { failure: 'MFA_CODE_INVALID' };
      }
      await client.query(`UPDATE admin_mfa_credentials SET enabled_at=COALESCE(enabled_at,CURRENT_TIMESTAMP),
        last_verified_counter=$2, failed_attempts=0, blocked_until=NULL WHERE user_id=$1`, [userId, counter]);
      const session = await client.query(
        `UPDATE auth_sessions SET mfa_verified_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND expires_at>CURRENT_TIMESTAMP AND idle_expires_at>CURRENT_TIMESTAMP
         RETURNING id`,
        [sessionId, userId]
      );
      if (session.rowCount !== 1) throw new MfaError('AUTH_REQUIRED', 'Phiên đăng nhập không còn hợp lệ.', 401);
      return { configured: true, verified: true };
    });
    if (result.failure) throw new MfaError(result.failure, result.failure === 'MFA_RATE_LIMITED'
      ? 'Đã nhập sai nhiều lần. Thử lại sau 15 phút.' : 'Mã không đúng, đã dùng hoặc hết hạn.', result.failure === 'MFA_RATE_LIMITED' ? 429 : 401);
    return result;
  }

  async requireVerifiedAdmin({ userId, sessionId }) {
    const status = await this.status({ userId, sessionId });
    if (!status.required) throw new MfaError('ADMIN_REQUIRED', 'Chỉ quản trị viên được phép.', 403);
    if (!status.configured) throw new MfaError('MFA_SETUP_REQUIRED', 'Quản trị viên phải thiết lập xác thực hai bước.', 403);
    if (!status.verified) throw new MfaError('MFA_REQUIRED', 'Hãy nhập mã xác thực hai bước.', 403);
    return status;
  }
}

export const mfaService = new MfaService();
export const __mfaTest = { base32Encode, base32Decode, totp, validCode };
