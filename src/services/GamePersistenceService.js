import { getClient, query } from '../db/connection.js';

export class PersistenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

function toSafeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new PersistenceError('DATABASE_VALUE_OUT_OF_RANGE', `${field} vượt giới hạn số nguyên an toàn.`);
  }
  return number;
}

async function inTransaction(work) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findProcessedCommand(client, commandKey) {
  const result = await client.query(
    'SELECT result_payload FROM processed_commands WHERE command_key = $1',
    [commandKey]
  );
  return result.rows[0]?.result_payload ?? null;
}

async function duplicateResultWithCurrentBalance(client, userId, result) {
  const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
  const wallet = walletResult.rows[0];
  if (!wallet) throw new PersistenceError('WALLET_NOT_FOUND', 'Không tìm thấy ví của tài khoản.');
  return {
    ...result,
    balance: toSafeInteger(wallet.balance, 'balance'),
    isDuplicate: true,
  };
}

async function recordProcessedCommand(client, { commandKey, roomId, userId, commandType, result }) {
  await client.query(
    `INSERT INTO processed_commands (command_key, room_id, user_id, command_type, result_payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [commandKey, roomId, userId, commandType, JSON.stringify(result)]
  );
}

async function lockWallet(client, userId) {
  const result = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
  const wallet = result.rows[0];
  if (!wallet) throw new PersistenceError('WALLET_NOT_FOUND', 'Không tìm thấy ví của tài khoản.');
  return wallet;
}

async function updateWallet(client, wallet, delta) {
  const balanceBefore = BigInt(wallet.balance);
  const balanceAfter = balanceBefore + BigInt(delta);
  if (balanceAfter < 0n) throw new PersistenceError('INSUFFICIENT_BALANCE', 'Số dư không đủ để thực hiện thao tác.');

  const result = await client.query(
    `UPDATE wallets
     SET balance = $1, version = version + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND version = $3
     RETURNING *`,
    [balanceAfter.toString(), wallet.id, wallet.version]
  );
  if (result.rowCount !== 1) {
    throw new PersistenceError('DATABASE_CONFLICT', 'Ví vừa được thay đổi bởi thao tác khác.');
  }
  return {
    wallet: result.rows[0],
    balanceBefore,
    balanceAfter,
  };
}

async function insertLedger(client, {
  walletId,
  userId,
  transactionType,
  amount,
  balanceBefore,
  balanceAfter,
  roomId = null,
  roundId = null,
  idempotencyKey,
  reason,
}) {
  await client.query(
    `INSERT INTO wallet_transactions
      (wallet_id, user_id, type, transaction_type, amount, balance_before, balance_after,
       room_id, round_id, idempotency_key, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      walletId,
      userId,
      transactionType.toLowerCase(),
      transactionType,
      BigInt(amount).toString(),
      balanceBefore.toString(),
      balanceAfter.toString(),
      roomId,
      roundId,
      idempotencyKey,
      reason,
    ]
  );
}

export class GamePersistenceService {
  async recoverInterruptedGames() {
    return inTransaction(async client => {
      const roundsResult = await client.query(
        `SELECT r.id, r.room_id
         FROM rounds r
         JOIN rooms room ON room.id = r.room_id
         WHERE room.status IN ('active', 'paused')
           AND r.status IN ('waiting', 'betting', 'revealing', 'result')
         ORDER BY r.id
         FOR UPDATE OF r`
      );

      let refundedPlayers = 0;
      for (const round of roundsResult.rows) {
        const betsResult = await client.query(
          `SELECT user_id, COALESCE(SUM(amount), 0) AS refund
           FROM bets
           WHERE round_id = $1 AND status = 'placed'
           GROUP BY user_id
           ORDER BY user_id`,
          [round.id]
        );

        for (const betGroup of betsResult.rows) {
          const refund = BigInt(betGroup.refund);
          if (refund <= 0n) continue;
          const idempotencyKey = `restart_refund:${round.id}:${betGroup.user_id}`;
          const existing = await client.query(
            `SELECT id FROM wallet_transactions
             WHERE user_id = $1 AND idempotency_key = $2`,
            [betGroup.user_id, idempotencyKey]
          );
          if (existing.rowCount > 0) continue;

          const wallet = await lockWallet(client, betGroup.user_id);
          const update = await updateWallet(client, wallet, refund);
          await insertLedger(client, {
            walletId: wallet.id,
            userId: betGroup.user_id,
            transactionType: 'BET_REFUND',
            amount: refund,
            balanceBefore: update.balanceBefore,
            balanceAfter: update.balanceAfter,
            roomId: round.room_id,
            roundId: round.id,
            idempotencyKey,
            reason: 'Refund after server restart',
          });
          refundedPlayers += 1;
        }

        await client.query(
          `UPDATE bets SET status = 'cancelled'
           WHERE round_id = $1 AND status = 'placed'`,
          [round.id]
        );
        await client.query(
          `UPDATE rounds SET status = 'cancelled', settled_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [round.id]
        );
      }

      const closedRooms = await client.query(
        `UPDATE rooms SET status = 'closed', closed_at = CURRENT_TIMESTAMP
         WHERE status IN ('active', 'paused')
         RETURNING id`
      );
      if (closedRooms.rowCount > 0) {
        await client.query(
          `UPDATE room_members SET left_at = CURRENT_TIMESTAMP
           WHERE left_at IS NULL AND room_id = ANY($1::uuid[])`,
          [closedRooms.rows.map(room => room.id)]
        );
      }

      return {
        cancelledRounds: roundsResult.rowCount,
        refundedPlayers,
        closedRooms: closedRooms.rowCount,
      };
    });
  }

  async getPlayerProfile(userId) {
    const result = await query(
      `SELECT p.user_id, p.display_name, p.avatar_key, p.role, p.status, p.balance,
              COALESCE(s.games_played, 0)::int AS games_played,
              COALESCE(s.wins, 0)::int AS wins,
              COALESCE(s.losses, 0)::int AS losses,
              COALESCE(s.break_even, 0)::int AS break_even,
              COALESCE(s.total_bet, 0) AS total_bet,
              COALESCE(s.total_returned, 0) AS total_returned
       FROM player_profiles p
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS games_played,
                COUNT(*) FILTER (WHERE outcome = 'win') AS wins,
                COUNT(*) FILTER (WHERE outcome = 'loss') AS losses,
                COUNT(*) FILTER (WHERE outcome = 'draw') AS break_even,
                COALESCE(SUM(total_bet), 0) AS total_bet,
                COALESCE(SUM(total_return), 0) AS total_returned
         FROM player_round_results
         WHERE user_id = p.user_id
       ) s ON TRUE
       WHERE p.user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) throw new PersistenceError('WALLET_NOT_FOUND', 'Tài khoản chưa có hồ sơ hoặc ví.');
    if (row.status !== 'active') throw new PersistenceError('ACCOUNT_DISABLED', 'Tài khoản hiện không thể tham gia trò chơi.');
    return {
      userId: row.user_id,
      displayName: row.display_name,
      avatarKey: row.avatar_key,
      role: row.role,
      balance: toSafeInteger(row.balance, 'balance'),
      stats: {
        gamesPlayed: row.games_played,
        wins: row.wins,
        losses: row.losses,
        breakEven: row.break_even,
        highestBalance: toSafeInteger(row.balance, 'balance'),
        totalBet: toSafeInteger(row.total_bet, 'total_bet'),
        totalReturned: toSafeInteger(row.total_returned, 'total_returned'),
      },
    };
  }

  async getPlayerHistory({ userId, limit = 20, offset = 0 }) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const result = await query(
      `SELECT result.round_id, result.room_id, room.code AS room_code,
              round.round_number, round.dice, result.total_bet, result.total_return,
              result.net_gain, result.outcome, result.settled_at
       FROM player_round_results result
       JOIN rounds round ON round.id = result.round_id
       JOIN rooms room ON room.id = result.room_id
       WHERE result.user_id = $1
       ORDER BY result.settled_at DESC, result.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    );
    return result.rows.map(row => ({
      roundId: row.round_id,
      roomId: row.room_id,
      roomCode: row.room_code,
      roundNumber: row.round_number,
      dice: row.dice,
      totalBet: toSafeInteger(row.total_bet, 'total_bet'),
      totalReturn: toSafeInteger(row.total_return, 'total_return'),
      netGain: toSafeInteger(row.net_gain, 'net_gain'),
      outcome: row.outcome,
      settledAt: row.settled_at,
    }));
  }

  async getPlayerStatistics(userId) {
    const result = await query(
      `SELECT COUNT(*)::int AS games_played,
              COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins,
              COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
              COUNT(*) FILTER (WHERE outcome = 'draw')::int AS break_even,
              COALESCE(SUM(total_bet), 0) AS total_bet,
              COALESCE(SUM(total_return), 0) AS total_returned,
              COALESCE(SUM(net_gain), 0) AS net_gain
       FROM player_round_results
       WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    return {
      gamesPlayed: row.games_played,
      wins: row.wins,
      losses: row.losses,
      breakEven: row.break_even,
      totalBet: toSafeInteger(row.total_bet, 'total_bet'),
      totalReturned: toSafeInteger(row.total_returned, 'total_returned'),
      netGain: toSafeInteger(row.net_gain, 'net_gain'),
    };
  }

  async getWalletTransactions({ userId, limit = 20, offset = 0 }) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const result = await query(
      `SELECT id, transaction_type, amount, balance_before, balance_after,
              actor_id, room_id, round_id, reason, created_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    );
    return result.rows.map(row => ({
      id: row.id,
      transactionType: row.transaction_type,
      amount: toSafeInteger(row.amount, 'amount'),
      balanceBefore: toSafeInteger(row.balance_before, 'balance_before'),
      balanceAfter: toSafeInteger(row.balance_after, 'balance_after'),
      actorId: row.actor_id,
      roomId: row.room_id,
      roundId: row.round_id,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  async getRoomHistory({ roomCode, limit = 20, offset = 0 }) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const result = await query(
      `SELECT round.id, round.round_number, round.dice, round.settled_at,
              COALESCE(SUM(result.total_bet), 0) AS total_bet,
              COALESCE(SUM(result.total_return), 0) AS total_return
       FROM rounds round
       JOIN rooms room ON room.id = round.room_id
       LEFT JOIN player_round_results result ON result.round_id = round.id
       WHERE room.code = $1 AND round.status = 'settled'
       GROUP BY round.id, round.round_number, round.dice, round.settled_at
       ORDER BY round.settled_at DESC, round.id DESC
       LIMIT $2 OFFSET $3`,
      [roomCode, safeLimit, safeOffset]
    );
    return result.rows.map(row => ({
      roundId: row.id,
      roundNumber: row.round_number,
      dice: row.dice,
      totalBet: toSafeInteger(row.total_bet, 'total_bet'),
      totalReturn: toSafeInteger(row.total_return, 'total_return'),
      settledAt: row.settled_at,
    }));
  }

  async getSymbolStatistics({ roomCode }) {
    const [roundsResult, symbolsResult] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS completed_rounds
         FROM rounds round
         JOIN rooms room ON room.id = round.room_id
         WHERE room.code = $1 AND round.status = 'settled'`,
        [roomCode]
      ),
      query(
        `SELECT die.symbol, COUNT(*)::int AS appearances
         FROM rounds round
         JOIN rooms room ON room.id = round.room_id
         CROSS JOIN LATERAL jsonb_array_elements_text(round.dice) AS die(symbol)
         WHERE room.code = $1 AND round.status = 'settled' AND round.dice IS NOT NULL
         GROUP BY die.symbol
         ORDER BY die.symbol`,
        [roomCode]
      ),
    ]);
    const symbols = Object.fromEntries(
      symbolsResult.rows.map(row => [row.symbol, row.appearances])
    );
    return {
      completedRounds: roundsResult.rows[0]?.completed_rounds ?? 0,
      totalDice: Object.values(symbols).reduce((sum, count) => sum + count, 0),
      symbols,
    };
  }

  async createRoom({ roomId, code, name, hostUserId, capacity, bettingDurationSeconds }) {
    return inTransaction(async client => {
      await client.query(
        `INSERT INTO rooms (id, code, name, host_id, capacity, betting_duration, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
        [roomId, code, name, hostUserId, capacity, bettingDurationSeconds]
      );
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES ($1, $2, 'host')`,
        [roomId, hostUserId]
      );
      return { roomId };
    });
  }

  async joinRoom({ roomId, userId }) {
    await query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'player')`,
      [roomId, userId]
    );
  }

  async leaveRoom({ roomId, userId }) {
    await query(
      `UPDATE room_members SET left_at = CURRENT_TIMESTAMP
       WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [roomId, userId]
    );
  }

  async closeRoom({ roomId }) {
    await inTransaction(async client => {
      await client.query(
        `UPDATE room_members SET left_at = CURRENT_TIMESTAMP
         WHERE room_id = $1 AND left_at IS NULL`,
        [roomId]
      );
      await client.query(
        `UPDATE rooms SET status = 'closed', closed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [roomId]
      );
    });
  }

  async transferHost({ roomId, fromUserId, toUserId }) {
    await inTransaction(async client => {
      const room = await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
      if (room.rowCount !== 1) throw new PersistenceError('ROUND_NOT_FOUND', 'Không tìm thấy phòng chơi.');
      await client.query(
        `UPDATE room_members SET role = 'player'
         WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [roomId, fromUserId]
      );
      const promoted = await client.query(
        `UPDATE room_members SET role = 'host'
         WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
         RETURNING id`,
        [roomId, toUserId]
      );
      if (promoted.rowCount !== 1) {
        throw new PersistenceError('DATABASE_CONFLICT', 'Người chơi mới không còn ở trong phòng.');
      }
      await client.query('UPDATE rooms SET host_id = $1 WHERE id = $2', [toUserId, roomId]);
    });
  }

  async createRound({ roomId, roundId, roundNumber }) {
    await query(
      `INSERT INTO rounds (id, room_id, round_number, status)
       VALUES ($1, $2, $3, 'betting')`,
      [roundId, roomId, roundNumber]
    );
    return { roundId };
  }

  async placeBet({ userId, roomId, roundId, symbol, amount, requestId }) {
    const commandKey = `bet:add:${roundId}:${userId}:${requestId}`;
    return inTransaction(async client => {
      const duplicate = await findProcessedCommand(client, commandKey);
      if (duplicate) return duplicateResultWithCurrentBalance(client, userId, duplicate);

      const roundResult = await client.query(
        `SELECT id, status FROM rounds WHERE id = $1 AND room_id = $2 FOR UPDATE`,
        [roundId, roomId]
      );
      const round = roundResult.rows[0];
      if (!round) throw new PersistenceError('ROUND_NOT_FOUND', 'Không tìm thấy vòng chơi.');
      if (round.status !== 'betting') throw new PersistenceError('BETTING_CLOSED', 'Vòng cược đã đóng.');
      const duplicateAfterLock = await findProcessedCommand(client, commandKey);
      if (duplicateAfterLock) return duplicateResultWithCurrentBalance(client, userId, duplicateAfterLock);

      const wallet = await lockWallet(client, userId);
      const update = await updateWallet(client, wallet, -BigInt(amount));
      const betResult = await client.query(
        `INSERT INTO bets (round_id, user_id, symbol, amount, request_id, status)
         VALUES ($1, $2, $3, $4, $5, 'placed')
         RETURNING *`,
        [roundId, userId, symbol, amount, requestId]
      );
      await insertLedger(client, {
        walletId: wallet.id,
        userId,
        transactionType: 'BET_DEBIT',
        amount: -BigInt(amount),
        balanceBefore: update.balanceBefore,
        balanceAfter: update.balanceAfter,
        roomId,
        roundId,
        idempotencyKey: commandKey,
        reason: `Bet on ${symbol}`,
      });
      const result = {
        acceptedBet: { id: betResult.rows[0].id, symbol, amount },
        balance: toSafeInteger(update.wallet.balance, 'balance'),
        isDuplicate: false,
      };
      await recordProcessedCommand(client, {
        commandKey,
        roomId,
        userId,
        commandType: 'bet:add',
        result,
      });
      return result;
    });
  }

  async clearBets({ userId, roomId, roundId, requestId }) {
    const commandKey = `bet:clear:${roundId}:${userId}:${requestId}`;
    return inTransaction(async client => {
      const duplicate = await findProcessedCommand(client, commandKey);
      if (duplicate) return duplicateResultWithCurrentBalance(client, userId, duplicate);

      const roundResult = await client.query(
        `SELECT id, status FROM rounds WHERE id = $1 AND room_id = $2 FOR UPDATE`,
        [roundId, roomId]
      );
      const round = roundResult.rows[0];
      if (!round) throw new PersistenceError('ROUND_NOT_FOUND', 'Không tìm thấy vòng chơi.');
      if (round.status !== 'betting') throw new PersistenceError('BETTING_CLOSED', 'Vòng cược đã đóng.');
      const duplicateAfterLock = await findProcessedCommand(client, commandKey);
      if (duplicateAfterLock) return duplicateResultWithCurrentBalance(client, userId, duplicateAfterLock);

      const betsResult = await client.query(
        `SELECT id, amount FROM bets
         WHERE round_id = $1 AND user_id = $2 AND status = 'placed'
         FOR UPDATE`,
        [roundId, userId]
      );
      const refund = betsResult.rows.reduce((sum, bet) => sum + BigInt(bet.amount), 0n);
      let balance;
      if (refund > 0n) {
        const wallet = await lockWallet(client, userId);
        const update = await updateWallet(client, wallet, refund);
        await client.query(
          `UPDATE bets SET status = 'cancelled'
           WHERE round_id = $1 AND user_id = $2 AND status = 'placed'`,
          [roundId, userId]
        );
        await insertLedger(client, {
          walletId: wallet.id,
          userId,
          transactionType: 'BET_REFUND',
          amount: refund,
          balanceBefore: update.balanceBefore,
          balanceAfter: update.balanceAfter,
          roomId,
          roundId,
          idempotencyKey: commandKey,
          reason: 'Player cleared bets',
        });
        balance = toSafeInteger(update.wallet.balance, 'balance');
      } else {
        const wallet = await lockWallet(client, userId);
        balance = toSafeInteger(wallet.balance, 'balance');
      }

      const result = { refunded: toSafeInteger(refund, 'refund'), balance, isDuplicate: false };
      await recordProcessedCommand(client, {
        commandKey,
        roomId,
        userId,
        commandType: 'bet:clear',
        result,
      });
      return result;
    });
  }

  async settleRound({ roomId, roundId, dice, playerResults }) {
    return inTransaction(async client => {
      const roundResult = await client.query(
        `SELECT id, status, dice FROM rounds WHERE id = $1 AND room_id = $2 FOR UPDATE`,
        [roundId, roomId]
      );
      const round = roundResult.rows[0];
      if (!round) throw new PersistenceError('ROUND_NOT_FOUND', 'Không tìm thấy vòng chơi.');
      if (round.status === 'settled') {
        const existingResults = await client.query(
          `SELECT result.user_id, result.total_bet, result.total_return, wallet.balance
           FROM player_round_results result
           JOIN wallets wallet ON wallet.user_id = result.user_id
           WHERE result.round_id = $1
           ORDER BY result.user_id`,
          [roundId]
        );
        return {
          roundId,
          dice: round.dice,
          players: existingResults.rows.map(result => ({
            userId: result.user_id,
            balance: toSafeInteger(result.balance, 'balance'),
            totalBet: toSafeInteger(result.total_bet, 'total_bet'),
            totalReturn: toSafeInteger(result.total_return, 'total_return'),
          })),
          isDuplicate: true,
        };
      }
      if (!['betting', 'revealing', 'result'].includes(round.status)) {
        throw new PersistenceError('ROUND_ALREADY_SETTLED', 'Vòng chơi không thể thanh toán lại.');
      }

      const settledPlayers = [];
      const orderedResults = [...playerResults].sort((a, b) => a.userId.localeCompare(b.userId));
      for (const playerResult of orderedResults) {
        const wallet = await lockWallet(client, playerResult.userId);
        const payout = BigInt(playerResult.totalReturn);
        let updatedWallet = wallet;
        if (payout > 0n) {
          const update = await updateWallet(client, wallet, payout);
          updatedWallet = update.wallet;
          await insertLedger(client, {
            walletId: wallet.id,
            userId: playerResult.userId,
            transactionType: 'ROUND_PAYOUT',
            amount: payout,
            balanceBefore: update.balanceBefore,
            balanceAfter: update.balanceAfter,
            roomId,
            roundId,
            idempotencyKey: `round_payout:${roundId}:${playerResult.userId}`,
            reason: 'Round payout',
          });
        }

        const netGain = BigInt(playerResult.totalReturn) - BigInt(playerResult.totalBet);
        const outcome = netGain > 0n ? 'win' : netGain < 0n ? 'loss' : 'draw';
        await client.query(
          `INSERT INTO player_round_results
            (round_id, user_id, room_id, total_bet, total_return, net_gain, outcome)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (round_id, user_id) DO NOTHING`,
          [
            roundId,
            playerResult.userId,
            roomId,
            BigInt(playerResult.totalBet).toString(),
            BigInt(playerResult.totalReturn).toString(),
            netGain.toString(),
            outcome,
          ]
        );
        await client.query(
          `UPDATE bets
           SET status = CASE WHEN symbol = ANY($3::varchar[]) THEN 'won' ELSE 'lost' END
           WHERE round_id = $1 AND user_id = $2 AND status = 'placed'`,
          [roundId, playerResult.userId, dice]
        );
        settledPlayers.push({
          userId: playerResult.userId,
          balance: toSafeInteger(updatedWallet.balance, 'balance'),
          totalBet: playerResult.totalBet,
          totalReturn: playerResult.totalReturn,
        });
      }

      await client.query(
        `UPDATE rounds
         SET dice = $1, status = 'settled', settled_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify(dice), roundId]
      );
      return { roundId, dice, players: settledPlayers, isDuplicate: false };
    });
  }
}
