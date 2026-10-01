#!/usr/bin/env node
import { AuthService } from '../server/services/AuthService.js';
import { query, closePool } from '../server/db/connection.js';

const [username, email, ...displayNameParts] = process.argv.slice(2);
const displayName = displayNameParts.join(' ').trim();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

try {
  if (!username || !email || !displayName) {
    fail('Cách dùng: ADMIN_BOOTSTRAP_PASSWORD=<mật khẩu> npm run admin:create -- <username> <email> <tên hiển thị>');
  } else if (typeof password !== 'string' || password.length < 12) {
    fail('ADMIN_BOOTSTRAP_PASSWORD phải có ít nhất 12 ký tự và không được ghi vào file dự án.');
  } else {
    const existingAdmin = await query(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1`
    );
    if (existingAdmin.rowCount > 0 && process.env.ALLOW_ADDITIONAL_ADMIN !== 'true') {
      fail('Đã có admin hoạt động. Đặt ALLOW_ADDITIONAL_ADMIN=true nếu chủ ý tạo thêm một admin.');
    } else {
      const auth = new AuthService();
      const created = await auth.register({ username, email, password, displayName });
      await query(
        `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [created.user.id]
      );
      await auth.logoutAll(created.user.id);
      console.log(`Đã tạo admin "${created.user.username}" và thu hồi phiên bootstrap.`);
    }
  }
} catch (error) {
  fail(`Không thể tạo admin: ${error.message}`);
} finally {
  await closePool();
}
