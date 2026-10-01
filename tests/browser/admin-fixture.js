// Optional manual browser smoke test. Never runs against a non-test database.
import { randomUUID } from 'node:crypto';
import { query, closePool } from '../../server/db/connection.js';
import { AuthService } from '../../server/services/AuthService.js';
import { createProductionGameServer } from '../../server/production.js';

if (process.env.NODE_ENV !== 'test') throw new Error('NODE_ENV=test is required.');
const database = (await query('SELECT current_database() AS name')).rows[0].name;
if (!/(^|[_-])test($|[_-])/i.test(database)) throw new Error('A dedicated test database is required.');
if (!process.env.ADMIN_QA_PASSWORD || process.env.ADMIN_QA_PASSWORD.length < 12) throw new Error('Set a temporary ADMIN_QA_PASSWORD (12+ characters).');
const auth = new AuthService();
const fixtureIds = [];
let app;
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  await app?.close();
  await query('DELETE FROM rooms WHERE host_id=ANY($1::uuid[])', [fixtureIds]);
  await query('DELETE FROM admin_audit_logs WHERE admin_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])', [fixtureIds]);
  for (const table of ['processed_commands', 'admin_mfa_credentials', 'auth_sessions', 'account_tokens', 'wallet_transactions', 'wallets']) await query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [fixtureIds]);
  await query('DELETE FROM users WHERE id=ANY($1::uuid[])', [fixtureIds]);
  await closePool();
  console.log('QA fixtures removed.');
  process.exit(0);
}
for (const role of ['admin', 'player']) {
  const username = `qa_${role}_${randomUUID().slice(0, 8)}`;
  const account = await auth.register({ username, email: `${username}@example.test`, password: process.env.ADMIN_QA_PASSWORD, displayName: `QA ${role}` });
  fixtureIds.push(account.user.id);
  if (role === 'admin') await query("UPDATE users SET role='admin' WHERE id=$1", [account.user.id]);
  console.log(`QA_${role.toUpperCase()}=${username}`);
}
app = await createProductionGameServer();
await app.listen(3001, '127.0.0.1');
console.log('Browser QA: http://127.0.0.1:3001/admin — type stop + Enter to clean up.');
process.stdin.resume();
process.stdin.on('data', data => { if (String(data).trim() === 'stop') cleanup().catch(console.error); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cleanup().catch(console.error));
