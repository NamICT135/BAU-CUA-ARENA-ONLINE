#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { closePool } from '../server/db/connection.js';
import { TransactionManager } from '../server/db/TransactionManager.js';

const username = process.argv[2];
let exitCode = 0;

try {
  if (!username) throw new Error('Cách dùng: npm run admin:mfa-reset -- <username>');
  const result = await TransactionManager.withinTransaction(async client => {
    const userResult = await client.query(
      `SELECT id, username FROM users
       WHERE LOWER(username) = LOWER($1) AND role = 'admin' AND status <> 'deleted'
       FOR UPDATE`,
      [username]
    );
    const user = userResult.rows[0];
    if (!user) throw new Error('Không tìm thấy tài khoản admin phù hợp.');
    await client.query('DELETE FROM admin_mfa_credentials WHERE user_id = $1', [user.id]);
    await client.query(
      `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE user_id = $1`,
      [user.id]
    );
    await client.query(
      `INSERT INTO admin_audit_logs
         (admin_id, action, target_type, target_id, reason, details, request_id, succeeded)
       VALUES ($1, 'RESET_ADMIN_MFA_OPERATOR', 'user', $1,
               'Operator recovery command', $2, $3, TRUE)`,
      [user.id, JSON.stringify({ source: 'scripts/reset-admin-mfa.js' }), `mfa-reset:${randomUUID()}`]
    );
    return user;
  });
  console.log(`Đã xóa MFA và thu hồi toàn bộ phiên của admin "${result.username}". Đăng nhập lại để thiết lập mới.`);
} catch (error) {
  console.error(`Không thể reset MFA: ${error.message}`);
  exitCode = 1;
} finally {
  await closePool();
  process.exitCode = exitCode;
}
