import { query } from './connection.js';

export class AuditLogger {
  /**
   * Log an administrative action (e.g., ban user, grant coins, update room setting)
   */
  static async logAdminAction({
    adminId,
    action,
    targetType = null,
    targetId = null,
    reason = null,
    changes = null,
    details = null,
    ipAddress = null,
    requestId = null,
    succeeded = true,
  }, clientOverride = null) {
    const q = clientOverride ? clientOverride.query.bind(clientOverride) : query;
    const res = await q(
      `INSERT INTO admin_audit_logs
        (admin_id, action, target_type, target_id, reason, changes, details,
         ip_address, request_id, succeeded)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        adminId,
        action,
        targetType,
        targetId,
        reason,
        changes ? JSON.stringify(changes) : null,
        details ? JSON.stringify(details) : null,
        ipAddress,
        requestId,
        succeeded,
      ]
    );
    return res.rows[0];
  }

  /**
   * Retrieve audit logs with filtering and pagination
   */
  static async getLogs({ adminId = null, action = null, targetType = null, limit = 50, offset = 0 } = {}) {
    let sql = `SELECT a.*, u.username as admin_username, u.display_name as admin_display_name
               FROM admin_audit_logs a
               JOIN users u ON a.admin_id = u.id`;
    const conditions = [];
    const values = [];

    if (adminId) {
      values.push(adminId);
      conditions.push(`a.admin_id = $${values.length}`);
    }

    if (action) {
      values.push(action);
      conditions.push(`a.action = $${values.length}`);
    }

    if (targetType) {
      values.push(targetType);
      conditions.push(`a.target_type = $${values.length}`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    values.push(limit, offset);
    sql += ` ORDER BY a.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;

    const res = await query(sql, values);
    return res.rows;
  }
}
