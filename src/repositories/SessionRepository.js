import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';

export class SessionRepository extends Repository {
  constructor() {
    super('auth_sessions');
  }

  async createSession(userId, tokenHash, ipAddress, userAgent, expiresAt) {
    const res = await query(
      `INSERT INTO auth_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, tokenHash, ipAddress, userAgent, expiresAt]
    );
    return res.rows[0];
  }

  async findByTokenHash(tokenHash) {
    const res = await query(
      `SELECT s.*, u.username, u.display_name, u.role, u.status
       FROM auth_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1
         AND s.expires_at > CURRENT_TIMESTAMP
         AND s.revoked_at IS NULL`,
      [tokenHash]
    );
    return res.rows[0] || null;
  }

  /**
   * Soft-revoke: đánh dấu revoked_at thay vì xóa, giữ audit trail.
   */
  async revokeSession(tokenHash) {
    const res = await query(
      `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING *`,
      [tokenHash]
    );
    return res.rows[0] || null;
  }

  async revokeAllUserSessions(userId) {
    const res = await query(
      `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [userId]
    );
    return res.rows;
  }

  /**
   * Cập nhật last_activity_at cho session (dùng cho idle timeout check).
   */
  async touchSession(tokenHash) {
    const res = await query(
      `UPDATE auth_sessions SET last_activity_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       RETURNING *`,
      [tokenHash]
    );
    return res.rows[0] || null;
  }

  async cleanupExpiredSessions() {
    const res = await query(
      `DELETE FROM auth_sessions
       WHERE expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL
       RETURNING *`
    );
    return res.rowCount;
  }
}
