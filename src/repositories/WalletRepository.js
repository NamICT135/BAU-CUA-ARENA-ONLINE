import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';
import { WalletService, TRANSACTION_TYPES } from '../services/WalletService.js';

export class WalletRepository extends Repository {
  constructor() {
    super('wallets');
  }

  async findByUserId(userId) {
    const res = await query(`SELECT * FROM wallets WHERE user_id = $1`, [userId]);
    return res.rows[0] || null;
  }

  async createWallet(userId, initialBalance = 100000) {
    const res = await query(
      `INSERT INTO wallets (user_id, balance, version) VALUES ($1, $2, 1) RETURNING *`,
      [userId, initialBalance]
    );
    return res.rows[0];
  }

  /**
   * Trừ xu cược — ủy quyền cho WalletService để đảm bảo ledger chuẩn + idempotency.
   * @param {string} userId
   * @param {number} amount
   * @param {string} transactionType — TRANSACTION_TYPES value (mặc định BET_DEBIT)
   * @param {string} reason
   * @param {string} referenceId — dùng làm phần idempotency key
   * @returns {object} wallet row sau khi trừ
   */
  async deductBalance(userId, amount, transactionType = TRANSACTION_TYPES.BET_DEBIT, reason = null, referenceId = null) {
    const result = await WalletService._executeTransaction({
      userId,
      amount: -Math.abs(amount),
      transactionType,
      idempotencyKey: referenceId ? `deduct:${userId}:${referenceId}` : null,
      reason,
      allowNegative: false,
    });
    return result.wallet;
  }

  /**
   * Cộng xu — ủy quyền cho WalletService để đảm bảo ledger chuẩn + idempotency.
   * @param {string} userId
   * @param {number} amount
   * @param {string} transactionType — TRANSACTION_TYPES value (mặc định ROUND_PAYOUT)
   * @param {string} reason
   * @param {string} referenceId — dùng làm phần idempotency key
   * @returns {object} wallet row sau khi cộng
   */
  async addBalance(userId, amount, transactionType = TRANSACTION_TYPES.ROUND_PAYOUT, reason = null, referenceId = null) {
    const result = await WalletService._executeTransaction({
      userId,
      amount: Math.abs(amount),
      transactionType,
      idempotencyKey: referenceId ? `add:${userId}:${referenceId}` : null,
      reason,
      allowNegative: true,
    });
    return result.wallet;
  }

  async getTransactionHistory(walletId, limit = 20, offset = 0) {
    const res = await query(
      `SELECT * FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [walletId, limit, offset]
    );
    return res.rows;
  }
}
