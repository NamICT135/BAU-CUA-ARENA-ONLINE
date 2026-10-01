import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';
import { GamePersistenceService } from '../services/GamePersistenceService.js';

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
    this.persistence = new GamePersistenceService();
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
    const roundResult = await query('SELECT room_id FROM rounds WHERE id = $1', [roundId]);
    const round = roundResult.rows[0];
    if (!round) throw new Error(`Round not found: ${roundId}`);
    const result = await this.persistence.placeBet({
      roomId: round.room_id,
      roundId,
      userId,
      symbol,
      amount,
      requestId,
    });
    const betResult = await query('SELECT * FROM bets WHERE id = $1', [result.acceptedBet.id]);
    return result.isDuplicate ? null : betResult.rows[0];
  }

  async getRoundBets(roundId) {
    const res = await query(`SELECT * FROM bets WHERE round_id = $1`, [roundId]);
    return res.rows;
  }

  async updateRoundResult(roundId, dice, status = 'settled') {
    if (status !== 'settled') {
      throw new Error('Round results may only be committed through atomic settlement');
    }
    const roundResult = await query('SELECT room_id FROM rounds WHERE id = $1', [roundId]);
    const round = roundResult.rows[0];
    if (!round) throw new Error(`Round not found: ${roundId}`);
    await this.persistence.settleRound({ roomId: round.room_id, roundId, dice });
    const settled = await query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    return settled.rows[0];
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
    const roundResult = await query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    const round = roundResult.rows[0];
    if (!round) throw new Error(`Round not found: ${roundId}`);

    const settlement = await this.persistence.settleRound({
      roomId: round.room_id,
      roundId,
      dice,
    });
    const [settledRound, playerResults] = await Promise.all([
      query('SELECT * FROM rounds WHERE id = $1', [roundId]),
      query('SELECT * FROM player_round_results WHERE round_id = $1 ORDER BY user_id', [roundId]),
    ]);
    return {
      round: settledRound.rows[0],
      playerResults: playerResults.rows,
      isDuplicate: settlement.isDuplicate,
    };
  }
}
