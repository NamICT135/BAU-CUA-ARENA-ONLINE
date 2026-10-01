import { test, describe } from 'node:test';
import assert from 'node:assert';
import { TransactionManager } from '../../server/db/TransactionManager.js';
import { query } from '../../server/db/connection.js';

describe('TransactionManager Test Suite', () => {
  test('Should auto-commit on success', async () => {
    const result = await TransactionManager.withinTransaction(async (client) => {
      const res = await client.query('SELECT 1 + 1 AS sum');
      return res.rows[0].sum;
    });
    assert.strictEqual(result, 2);
  });

  test('Should auto-rollback on error', async () => {
    const uniqueUsername = 'txn_rollback_' + Date.now();

    // Insert trong transaction sẽ bị rollback
    await assert.rejects(async () => {
      await TransactionManager.withinTransaction(async (client) => {
        await client.query(
          `INSERT INTO users (username, email, password_hash, display_name)
           VALUES ($1, $2, 'hash', 'Rollback Test')`,
          [uniqueUsername, `${uniqueUsername}@example.com`]
        );
        throw new Error('Deliberate rollback');
      });
    }, /Deliberate rollback/);

    // Xác nhận user KHÔNG tồn tại sau rollback
    const res = await query('SELECT * FROM users WHERE username = $1', [uniqueUsername]);
    assert.strictEqual(res.rowCount, 0);
  });

  test('Should pass existing client without nested BEGIN', async () => {
    const result = await TransactionManager.withinTransaction(async (outerClient) => {
      // Gọi withinTransaction lồng nhau nhưng truyền client → không BEGIN lồng
      const innerResult = await TransactionManager.withinTransaction(
        async (client) => {
          const res = await client.query('SELECT 2 + 3 AS sum');
          return res.rows[0].sum;
        },
        { client: outerClient }
      );
      return innerResult;
    });
    assert.strictEqual(result, 5);
  });
});
