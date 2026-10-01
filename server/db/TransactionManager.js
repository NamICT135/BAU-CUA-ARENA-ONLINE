import { getClient } from './connection.js';

/**
 * TransactionManager — Utility tái sử dụng để quản lý DB transactions.
 *
 * Phần B (Game Integration) sẽ gọi TransactionManager.withinTransaction()
 * để gộp nhiều thao tác (trừ cược, ghi kết quả, trả thưởng) vào cùng
 * một transaction duy nhất, đảm bảo tính nguyên tử (all-or-nothing).
 *
 * Hỗ trợ:
 *   - Auto commit khi callback thành công
 *   - Auto rollback khi callback throw error
 *   - Deadlock retry (PostgreSQL error code 40P01)
 *   - Nested call detection (tránh BEGIN lồng BEGIN)
 */
export class TransactionManager {
  static MAX_DEADLOCK_RETRIES = 3;
  static DEADLOCK_RETRY_DELAY_MS = 50;

  /**
   * Chạy callback bên trong một transaction PostgreSQL.
   * Client được truyền vào callback — dùng client.query() thay vì query() toàn cục.
   *
   * @param {Function} callback - async (client) => result
   * @param {object}   [options]
   * @param {object}   [options.client] - Nếu đã có client từ transaction cha, truyền vào để tránh BEGIN lồng
   * @param {number}   [options.maxRetries] - Số lần retry khi deadlock (mặc định 3)
   * @returns {*} Giá trị callback trả về
   *
   * @example
   * const result = await TransactionManager.withinTransaction(async (client) => {
   *   await client.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, userId]);
   *   await client.query('INSERT INTO wallet_transactions ...');
   *   return { success: true };
   * });
   */
  static async withinTransaction(callback, options = {}) {
    // Nếu đã có client từ transaction cha → chạy thẳng, không BEGIN lồng
    if (options.client) {
      return callback(options.client);
    }

    const maxRetries = options.maxRetries ?? TransactionManager.MAX_DEADLOCK_RETRIES;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');

        // PostgreSQL deadlock detected → retry
        if (error.code === '40P01' && attempt < maxRetries) {
          lastError = error;
          const delay = TransactionManager.DEADLOCK_RETRY_DELAY_MS * attempt;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      } finally {
        client.release();
      }
    }

    throw lastError;
  }
}
