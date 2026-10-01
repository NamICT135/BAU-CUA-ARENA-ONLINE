import { test, describe } from 'node:test';
import assert from 'node:assert';
import { pool, checkConnection, query } from '../../server/db/connection.js';

describe('Database Connection & Schema Test Suite', () => {
  test('Should connect to PostgreSQL successfully', async () => {
    const status = await checkConnection();
    assert.strictEqual(status.ok, true, `Database connection failed: ${status.error}`);
    assert.strictEqual(typeof status.database, 'string');
  });

  test('Should query all 13 domain tables from schema', async () => {
    const expectedTables = [
      'users',
      'wallets',
      'wallet_transactions',
      'auth_sessions',
      'account_tokens',
      'rooms',
      'room_members',
      'rounds',
      'bets',
      'player_round_results',
      'processed_commands',
      'ad_reward_sessions',
      'admin_audit_logs'
    ];

    for (const tableName of expectedTables) {
      const res = await query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [tableName]
      );
      assert.strictEqual(res.rowCount, 1, `Table ${tableName} should exist in database`);
    }
  });

  test('Should support basic transaction and rollback', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT 1 + 1 AS result');
      assert.strictEqual(res.rows[0].result, 2);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  test('Should apply the database hardening migration', async () => {
    const migration = await query(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      ['002_harden_database_contract.sql']
    );
    assert.strictEqual(migration.rowCount, 1);

    const indexes = await query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])`,
      [[
        'idx_users_username_lower_unique',
        'idx_unique_active_host_per_room',
        'idx_unique_unfinished_round_per_room',
      ]]
    );
    assert.strictEqual(indexes.rowCount, 3);

    const requiredColumns = await query(
      `SELECT table_name, column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (
           ('wallet_transactions', 'idempotency_key'),
           ('bets', 'request_id')
         )`,
    );
    assert.strictEqual(requiredColumns.rowCount, 2);
    assert.ok(requiredColumns.rows.every(column => column.is_nullable === 'NO'));

    const constraints = await query(
      `SELECT conname FROM pg_constraint
       WHERE conname = ANY($1::text[])`,
      [[
        'txn_balance_equation',
        'bet_payout_non_negative',
        'player_round_totals_valid',
        'balance_safe_integer',
      ]]
    );
    assert.strictEqual(constraints.rowCount, 4);
  });
});
