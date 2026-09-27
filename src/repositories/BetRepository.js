import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';
import { TransactionManager } from '../db/TransactionManager.js';

/**
 * Quy tắc trả thưởng Bầu Cua (lấy từ server/game.js):
 *   matches = số xúc xắc trùng biểu tượng cược
 *   0 matches → mất cược (return 0)
 *   1 match   → return = amount × 2  (gốc + thắng 1x)
 *   2 matches → return = amount × 3  (gốc + thắng 2x)
 *   3 matches → return = amount × 4  (gốc + thắng 3x)
 */
function calculateBetReturn(betAmount, symbol, dice) {
  const matches = dice.filter(d => d === symbol).length;
  return matches > 0 ? betAmount * (matches + 1) : 0;
}

export class BetRepository extends Repository {
  constructor() {
    super('bets');
  }

  async createRound(roomId, roundNumber) {
    const res = await query(
      `INSERT INTO rounds (room_id, round_number, status) VALUES ($1, $2, 'betting') RETURNING *`,
      [roomId, roundNumber]
    );
    return res.rows[0];
  }

  async getCurrentRound(roomId) {
    const res = await query(
      `SELECT * FROM rounds WHERE room_id = $1 ORDER BY round_number DESC LIMIT 1`,
      [roomId]
    );
    return res.rows[0] || null;
  }

  // Place bet with duplicate prevention via requestId
  async placeBet({ roundId, userId, symbol, amount, requestId }) {
    const res = await query(
      `INSERT INTO bets (round_id, user_id, symbol, amount, request_id, status)
       VALUES ($1, $2, $3, $4, $5, 'placed')
       ON CONFLICT (round_id, user_id, symbol, request_id) DO NOTHING
       RETURNING *`,
      [roundId, userId, symbol, amount, requestId]
    );
    return res.rows[0] || null;
  }

  async getRoundBets(roundId) {
    const res = await query(`SELECT * FROM bets WHERE round_id = $1`, [roundId]);
    return res.rows;
  }

  async updateRoundResult(roundId, dice, status = 'settled') {
    const res = await query(
      `UPDATE rounds SET dice = $1, status = $2, settled_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
      [JSON.stringify(dice), status, roundId]
    );
    return res.rows[0];
  }

  /**
   * Tính toán kết quả trả thưởng cho toàn bộ cược trong một ván.
   * Trả về mảng { bet, totalReturn } cho từng bet row.
   * Hàm này chỉ TÍNH, không ghi DB — dùng cho preview hoặc truyền vào settleBets().
   */
  async calculateRoundResults(roundId, dice) {
    const bets = await this.getRoundBets(roundId);
    const results = [];

    for (const bet of bets) {
      const totalReturn = calculateBetReturn(Number(bet.amount), bet.symbol, dice);
      results.push({
        bet,
        totalReturn,
        outcome: totalReturn > Number(bet.amount)
          ? 'win'
          : totalReturn === 0
            ? 'loss'
            : 'draw',
      });
    }

    return results;
  }

  /**
   * Settlement nguyên tử cho toàn bộ ván:
   *   1. Lock round → kiểm tra chưa settled
   *   2. Ghi dice + chuyển status → 'settled'
   *   3. Tính payout cho từng bet
   *   4. Update từng bet (payout, status won/lost)
   *   5. Ghi player_round_results cho từng user
   *
   * Toàn bộ trong 1 transaction — nếu bất kỳ bước nào lỗi, rollback tất cả.
   * Gọi lại với cùng roundId đã settled → trả về kết quả cũ (chống double-settle).
   *
   * @param {string} roundId
   * @param {string[]} dice - Ví dụ ['cua', 'bau', 'tom']
   * @returns {{ round, playerResults: Array }}
   */
  async settleBets(roundId, dice) {
    return TransactionManager.withinTransaction(async (client) => {
      // 1. Lock round + kiểm tra chưa settled
      const roundRes = await client.query(
        `SELECT * FROM rounds WHERE id = $1 FOR UPDATE`,
        [roundId]
      );
      const round = roundRes.rows[0];

      if (!round) {
        throw new Error(`Round not found: ${roundId}`);
      }

      // Chống double-settlement: nếu đã settled → trả kết quả cũ
      if (round.status === 'settled') {
        const existingResults = await client.query(
          `SELECT * FROM player_round_results WHERE round_id = $1`,
          [roundId]
        );
        return { round, playerResults: existingResults.rows, isDuplicate: true };
      }

      // 2. Ghi dice + chuyển status settled
      const settledRound = await client.query(
        `UPDATE rounds SET dice = $1, status = 'settled', settled_at = CURRENT_TIMESTAMP
         WHERE id = $2 RETURNING *`,
        [JSON.stringify(dice), roundId]
      );

      // 3. Lấy tất cả bets của round này
      const betsRes = await client.query(
        `SELECT * FROM bets WHERE round_id = $1 AND status = 'placed'`,
        [roundId]
      );

      // 4. Tính payout + cập nhật từng bet
      // Gộp theo user để ghi player_round_results
      const userTotals = new Map(); // userId → { totalBet, totalReturn }

      for (const bet of betsRes.rows) {
        const betAmount = Number(bet.amount);
        const totalReturn = calculateBetReturn(betAmount, bet.symbol, dice);
        const betStatus = totalReturn > 0 ? 'won' : 'lost';

        await client.query(
          `UPDATE bets SET payout = $1, status = $2 WHERE id = $3`,
          [totalReturn, betStatus, bet.id]
        );

        // Gộp tổng theo user
        if (!userTotals.has(bet.user_id)) {
          userTotals.set(bet.user_id, { totalBet: 0, totalReturn: 0 });
        }
        const ut = userTotals.get(bet.user_id);
        ut.totalBet += betAmount;
        ut.totalReturn += totalReturn;
      }

      // 5. Ghi player_round_results cho từng user
      const playerResults = [];

      for (const [userId, totals] of userTotals) {
        const netGain = totals.totalReturn - totals.totalBet;
        const outcome = netGain > 0 ? 'win' : netGain < 0 ? 'loss' : 'draw';

        const prr = await client.query(
          `INSERT INTO player_round_results
            (round_id, user_id, room_id, total_bet, total_return, net_gain, outcome)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (round_id, user_id) DO UPDATE
           SET total_bet = EXCLUDED.total_bet,
               total_return = EXCLUDED.total_return,
               net_gain = EXCLUDED.net_gain,
               outcome = EXCLUDED.outcome,
               settled_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [roundId, userId, round.room_id, totals.totalBet, totals.totalReturn, netGain, outcome]
        );

        playerResults.push(prr.rows[0]);
      }

      return { round: settledRound.rows[0], playerResults, isDuplicate: false };
    });
  }
}
