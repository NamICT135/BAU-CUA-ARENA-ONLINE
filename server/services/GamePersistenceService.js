import { getClient, query as databaseQuery } from '../db/connection.js';

const DATABASE_UNAVAILABLE_CODES = new Set([
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  '53300', '57P01', '57P02', '57P03',
  'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT',
]);

export class PersistenceError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

function normalizePersistenceError(error) {
  if (error instanceof PersistenceError) return error;
  if (DATABASE_UNAVAILABLE_CODES.has(error?.code) || error?.code?.startsWith?.('08')) {
    return new PersistenceError(
      'DATABASE_UNAVAILABLE',
      'Database tạm thời không khả dụng. Vui lòng thử lại sau.',
      { cause: error }
    );
  }
  return error;
}

async function query(text, params) {
  try {
    return await databaseQuery(text, params);
  } catch (error) {
    throw normalizePersistenceError(error);
  }
}

async function requireBettingMember(client, userId, roomId) {
  const user = await client.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [userId]);
  if (user.rows[0]?.status !== 'active') throw new PersistenceError('ACCOUNT_DISABLED', 'Tài khoản không được cược.');
  const room = await client.query('SELECT status FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
  if (room.rows[0]?.status !== 'active') throw new PersistenceError('BETTING_CLOSED', 'Phòng không đang nhận cược.');
  const member = await client.query('SELECT id FROM room_members WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL', [roomId, userId]);
  if (!member.rowCount) throw new PersistenceError('NOT_IN_ROOM', 'Tài khoản không còn trong phòng.');
}

function toSafeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new PersistenceError('DATABASE_VALUE_OUT_OF_RANGE', `${field} vượt giới hạn số nguyên an toàn.`);
  }
  return number;
}

function normalizePagination(limit = 20, offset = 0) {
  const requestedLimit = Number(limit);
  const requestedOffset = Number(offset);
  return {
    limit: Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 20,
    offset: Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0,
  };
}

async function inTransaction(work) {
  let client;
  try {
    client = await getClient();
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original transaction error. A broken connection will
        // be discarded by pg when it is released.
      }
    }
    throw normalizePersistenceError(error);
  } finally {
    client?.release();
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

async function ensureNoPlacedBets(client, userId) {
  const result = await client.query(
    `SELECT id FROM bets
     WHERE user_id = $1 AND status = 'placed'
     LIMIT 1`,
    [userId]
  );
  if (result.rowCount > 0) {
    throw new PersistenceError(
      'UNSETTLED_BET',
      'Tài khoản còn cược đang chờ xử lý. Hãy xóa cược hoặc chờ kết quả.'
    );
  }
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
      (wallet_id, user_id, transaction_type, amount, balance_before, balance_after,
       room_id, round_id, idempotency_key, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      walletId,
      userId,
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

async function refundPlacedBetsForRound(client, {
  roundId,
  roomId,
  idempotencyPrefix,
  reason,
}) {
  const betsResult = await client.query(
    `SELECT user_id, COALESCE(SUM(amount), 0) AS refund
     FROM bets
     WHERE round_id = $1 AND status = 'placed'
     GROUP BY user_id
     ORDER BY user_id`,
    [roundId]
  );

  let refundedPlayers = 0;
  for (const betGroup of betsResult.rows) {
    const refund = BigInt(betGroup.refund);
    if (refund <= 0n) continue;
    const idempotencyKey = `${idempotencyPrefix}:${roundId}:${betGroup.user_id}`;
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
      roomId,
      roundId,
      idempotencyKey,
      reason,
    });
    refundedPlayers += 1;
  }

  await client.query(
    `UPDATE bets SET status = 'cancelled', payout = 0
     WHERE round_id = $1 AND status = 'placed'`,
    [roundId]
  );
  await client.query(
    `UPDATE rounds
     SET status = 'cancelled', settled_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status IN ('waiting', 'betting', 'revealing', 'result')`,
    [roundId]
  );
  return refundedPlayers;
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
        refundedPlayers += await refundPlacedBetsForRound(client, {
          roundId: round.id,
          roomId: round.room_id,
          idempotencyPrefix: 'restart_refund',
          reason: 'Refund after server restart',
        });
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
      `SELECT p.user_id, p.username, p.email, p.display_name, p.avatar_key,
              p.role, p.status, p.balance, p.created_at, p.email_verified_at,
              GREATEST(
                p.balance,
                COALESCE((
                  SELECT MAX(ledger.balance_after)
                  FROM wallet_transactions ledger
                  WHERE ledger.user_id = p.user_id
                ), p.balance)
              ) AS highest_balance,
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
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      avatarKey: row.avatar_key,
      role: row.role,
      joinedAt: row.created_at,
      emailVerified: Boolean(row.email_verified_at),
      balance: toSafeInteger(row.balance, 'balance'),
      stats: {
        gamesPlayed: row.games_played,
        wins: row.wins,
        losses: row.losses,
        breakEven: row.break_even,
        highestBalance: toSafeInteger(row.highest_balance, 'highest_balance'),
        totalBet: toSafeInteger(row.total_bet, 'total_bet'),
        totalReturned: toSafeInteger(row.total_returned, 'total_returned'),
      },
    };
  }

  async getPlayerHistory({ userId, limit = 20, offset = 0 }) {
    const { limit: safeLimit, offset: safeOffset } = normalizePagination(limit, offset);
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
    const { limit: safeLimit, offset: safeOffset } = normalizePagination(limit, offset);
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
    const { limit: safeLimit, offset: safeOffset } = normalizePagination(limit, offset);
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
    try {
      return await inTransaction(async client => {
        await ensureNoPlacedBets(client, hostUserId);
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
    } catch (error) {
      if (error?.code === '23505' && error?.constraint === 'rooms_code_key') {
        throw new PersistenceError('ROOM_CODE_CONFLICT', 'Mã phòng vừa được sử dụng. Vui lòng thử mã khác.', { cause: error });
      }
      if (error?.code === '23505' && error?.constraint === 'idx_unique_active_membership') {
        throw new PersistenceError('ALREADY_IN_ROOM', 'Tài khoản đang có một phòng hoạt động.', { cause: error });
      }
      throw error;
    }
  }

  async joinRoom({ roomId, userId }) {
    try {
      await inTransaction(async client => {
        const roomResult = await client.query(
          'SELECT id, status, capacity, locked FROM rooms WHERE id = $1 FOR UPDATE',
          [roomId]
        );
        const room = roomResult.rows[0];
        if (!room || room.status === 'closed') {
          throw new PersistenceError('ROOM_NOT_FOUND', 'Không tìm thấy phòng đang hoạt động.');
        }
        if (room.locked) throw new PersistenceError('ROOM_LOCKED', 'Phòng đã khóa người chơi mới.');
        const memberCount = await client.query(
          `SELECT COUNT(*)::int AS count FROM room_members
           WHERE room_id = $1 AND left_at IS NULL`,
          [roomId]
        );
        if (memberCount.rows[0].count >= room.capacity) {
          throw new PersistenceError('ROOM_FULL', 'Phòng đã đủ người chơi.');
        }
        await ensureNoPlacedBets(client, userId);
        await client.query(
          `INSERT INTO room_members (room_id, user_id, role)
           VALUES ($1, $2, 'player')`,
          [roomId, userId]
        );
      });
    } catch (error) {
      if (error?.code === '23505' && error?.constraint === 'idx_unique_active_membership') {
        throw new PersistenceError('ALREADY_IN_ROOM', 'Tài khoản đang có một phòng hoạt động.', { cause: error });
      }
      throw error;
    }
  }

  async hostKickMember({ actorId, roomId, userId, roundId, requestId }) {
    const commandKey = `host:kick:${roomId}:${actorId}:${requestId}`;
    return inTransaction(async client => {
      const duplicate = await findProcessedCommand(client, commandKey);
      if (duplicate) {
        if (duplicate.userId !== userId) throw new PersistenceError('REQUEST_ID_CONFLICT', 'Mã kick đã dùng cho người khác.');
        return { ...duplicate, isDuplicate: true };
      }
      const room = (await client.query('SELECT host_id,status,paused_at FROM rooms WHERE id=$1 FOR UPDATE', [roomId])).rows[0];
      const repeated = await findProcessedCommand(client, commandKey);
      if (repeated) {
        if (repeated.userId !== userId) throw new PersistenceError('REQUEST_ID_CONFLICT', 'Mã kick đã dùng cho người khác.');
        return { ...repeated, isDuplicate: true };
      }
      if (!room || room.status === 'closed') throw new PersistenceError('ROOM_NOT_FOUND', 'Phòng đã đóng.');
      if (room.host_id !== actorId || userId === actorId) throw new PersistenceError('HOST_REQUIRED', 'Không có quyền kick thành viên này.');
      const target = (await client.query('SELECT role FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (target?.role === 'admin') throw new PersistenceError('ADMIN_TARGET_FORBIDDEN', 'Host không được kick admin hệ thống.');
      const member = await client.query('SELECT id FROM room_members WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL FOR UPDATE', [roomId, userId]);
      if (!member.rowCount) throw new PersistenceError('PLAYER_NOT_FOUND', 'Thành viên đã rời phòng.');
      const round = roundId ? (await client.query('SELECT status,betting_deadline FROM rounds WHERE id=$1 AND room_id=$2 FOR UPDATE', [roundId, roomId])).rows[0] : null;
      const bets = round ? await client.query("SELECT amount FROM bets WHERE round_id=$1 AND user_id=$2 AND status='placed' FOR UPDATE", [roundId, userId]) : { rows: [] };
      const total = bets.rows.reduce((sum, bet) => sum + BigInt(bet.amount), 0n);
      const bettingClock = room.status === 'paused' && room.paused_at ? new Date(room.paused_at) : new Date();
      const refundAllowed = round?.status === 'betting' && (!round.betting_deadline || new Date(round.betting_deadline) > bettingClock);
      const wallet = await lockWallet(client, userId);
      let balance = toSafeInteger(wallet.balance, 'balance');
      if (total > 0n && refundAllowed) {
        const update = await updateWallet(client, wallet, total);
        await client.query("UPDATE bets SET status='cancelled',payout=0 WHERE round_id=$1 AND user_id=$2 AND status='placed'", [roundId, userId]);
        await insertLedger(client, { walletId: wallet.id, userId, transactionType: 'BET_REFUND', amount: total,
          balanceBefore: update.balanceBefore, balanceAfter: update.balanceAfter, roomId, roundId,
          idempotencyKey: commandKey, reason: 'Host kicked player during betting' });
        balance = toSafeInteger(update.wallet.balance, 'balance');
      }
      await client.query('UPDATE room_members SET left_at=CURRENT_TIMESTAMP WHERE id=$1', [member.rows[0].id]);
      const result = { userId, balance, refunded: refundAllowed ? toSafeInteger(total, 'refund') : 0, retainedBets: total > 0n && !refundAllowed, isDuplicate: false };
      await recordProcessedCommand(client, { commandKey, roomId, userId: actorId, commandType: 'host:kick', result });
      return result;
    });
  }

  async leaveRoom({ roomId, userId, newHostUserId = null }) {
    await inTransaction(async client => {
      const roomResult = await client.query(
        'SELECT id, host_id, status FROM rooms WHERE id = $1 FOR UPDATE',
        [roomId]
      );
      const room = roomResult.rows[0];
      if (!room || room.status === 'closed') {
        throw new PersistenceError('ROOM_NOT_FOUND', 'Không tìm thấy phòng đang hoạt động.');
      }

      await ensureNoPlacedBets(client, userId);

      const leaving = await client.query(
        `UPDATE room_members SET left_at = CURRENT_TIMESTAMP
         WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
         RETURNING role`,
        [roomId, userId]
      );
      if (leaving.rowCount !== 1) {
        throw new PersistenceError('DATABASE_CONFLICT', 'Thành viên không còn ở trong phòng.');
      }

      if (room.host_id === userId) {
        if (!newHostUserId) {
          throw new PersistenceError('DATABASE_CONFLICT', 'Phòng cần host mới trước khi host hiện tại rời đi.');
        }
        const promoted = await client.query(
          `UPDATE room_members SET role = 'host'
           WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
           RETURNING id`,
          [roomId, newHostUserId]
        );
        if (promoted.rowCount !== 1) {
          throw new PersistenceError('DATABASE_CONFLICT', 'Host mới không còn ở trong phòng.');
        }
        await client.query('UPDATE rooms SET host_id = $1 WHERE id = $2', [newHostUserId, roomId]);
      }
    });
  }

  async closeRoom({ roomId, reason = 'Room closed' }) {
    await inTransaction(async client => {
      const roomResult = await client.query(
        'SELECT id, status FROM rooms WHERE id = $1 FOR UPDATE',
        [roomId]
      );
      const room = roomResult.rows[0];
      if (!room || room.status === 'closed') return;

      const activeRounds = await client.query(
        `SELECT id, room_id
         FROM rounds
         WHERE room_id = $1
           AND status IN ('waiting', 'betting', 'revealing', 'result')
         ORDER BY id
         FOR UPDATE`,
        [roomId]
      );
      for (const round of activeRounds.rows) {
        await refundPlacedBetsForRound(client, {
          roundId: round.id,
          roomId,
          idempotencyPrefix: 'room_close_refund',
          reason,
        });
      }

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
      const room = await client.query(
        `SELECT id FROM rooms
         WHERE id = $1 AND status IN ('active', 'paused')
         FOR UPDATE`,
        [roomId]
      );
      if (room.rowCount !== 1) {
        throw new PersistenceError('ROOM_NOT_FOUND', 'Không tìm thấy phòng đang hoạt động.');
      }
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

  async createRound({ roomId, roundId, roundNumber, bettingDeadline = null }) {
    return inTransaction(async client => {
      const room = await client.query(
        `SELECT id FROM rooms
         WHERE id = $1 AND status IN ('active', 'paused')
         FOR UPDATE`,
        [roomId]
      );
      if (room.rowCount !== 1) {
        throw new PersistenceError('ROOM_NOT_FOUND', 'Không tìm thấy phòng đang hoạt động.');
      }
      await client.query(
        `INSERT INTO rounds (id, room_id, round_number, status, betting_deadline)
         VALUES ($1, $2, $3, 'betting', $4)`,
        [roundId, roomId, roundNumber, bettingDeadline]
      );
      return { roundId };
    });
  }

  async markRoundRevealing({ roomId, roundId }) {
    const result = await query(
      `UPDATE rounds
       SET status = 'revealing'
       WHERE id = $1 AND room_id = $2 AND status = 'betting'
       RETURNING id`,
      [roundId, roomId]
    );
    if (result.rowCount === 1) return;

    const current = await query(
      'SELECT status FROM rounds WHERE id = $1 AND room_id = $2',
      [roundId, roomId]
    );
    if (!current.rows[0]) throw new PersistenceError('ROUND_NOT_FOUND', 'Không tìm thấy vòng chơi.');
    if (current.rows[0].status !== 'revealing') {
      throw new PersistenceError('BETTING_CLOSED', 'Vòng cược không còn ở trạng thái có thể mở bát.');
    }
  }

  async placeBet({ userId, roomId, roundId, symbol, amount, requestId }) {
    const commandKey = `bet:add:${roundId}:${userId}:${requestId}`;
    return inTransaction(async client => {
      const duplicate = await findProcessedCommand(client, commandKey);
      if (duplicate) return duplicateResultWithCurrentBalance(client, userId, duplicate);
      await requireBettingMember(client, userId, roomId);

      const roundResult = await client.query(
        `SELECT id, status, betting_deadline FROM rounds WHERE id = $1 AND room_id = $2 FOR UPDATE`,
        [roundId, roomId]
      );
      const round = roundResult.rows[0];
      if (!round) throw new PersistenceError('ROUND_NOT_FOUND', 'Không tìm thấy vòng chơi.');
      if (round.status !== 'betting') throw new PersistenceError('BETTING_CLOSED', 'Vòng cược đã đóng.');
      if (round.betting_deadline && new Date(round.betting_deadline) <= new Date()) throw new PersistenceError('BETTING_CLOSED', 'Đã hết thời gian cược.');
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
          `UPDATE bets SET status = 'cancelled', payout = 0
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

  async settleRound({ roomId, roundId, dice }) {
    return inTransaction(async client => {
      const roundResult = await client.query(
        `SELECT id, status, dice, final_result, admin_override_result
         FROM rounds
         WHERE id = $1 AND room_id = $2
         FOR UPDATE`,
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
          dice: round.final_result ?? round.dice,
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

      // The database row is locked before choosing the result. A future admin
      // command can safely store admin_override_result in the same row; if it
      // commits first, that result wins. Otherwise the engine-provided dice is
      // committed as the immutable final_result.
      const committedDice = Array.isArray(round.admin_override_result)
        ? round.admin_override_result
        : dice;
      const allowedSymbols = new Set(['bau', 'cua', 'tom', 'ca', 'ga', 'nai']);
      if (!Array.isArray(committedDice) || committedDice.length !== 3 ||
          !committedDice.every(symbol => allowedSymbols.has(symbol))) {
        throw new PersistenceError('DATABASE_CONFLICT', 'Kết quả vòng chơi không hợp lệ.');
      }

      const diceCounts = new Map();
      for (const symbol of committedDice) {
        diceCounts.set(symbol, (diceCounts.get(symbol) ?? 0) + 1);
      }

      // Bets in PostgreSQL are authoritative. This also settles a bet whose
      // COMMIT succeeded but whose acknowledgement/RAM update was interrupted.
      const betsResult = await client.query(
        `SELECT id, user_id, symbol, amount
         FROM bets
         WHERE round_id = $1 AND status = 'placed'
         ORDER BY user_id, id
         FOR UPDATE`,
        [roundId]
      );
      const totalsByUser = new Map();
      for (const bet of betsResult.rows) {
        const amount = BigInt(bet.amount);
        const matches = diceCounts.get(bet.symbol) ?? 0;
        const payout = matches > 0 ? amount * BigInt(matches + 1) : 0n;
        await client.query(
          `UPDATE bets SET payout = $1, status = $2 WHERE id = $3`,
          [payout.toString(), payout > 0n ? 'won' : 'lost', bet.id]
        );
        const totals = totalsByUser.get(bet.user_id) ?? { totalBet: 0n, totalReturn: 0n };
        totals.totalBet += amount;
        totals.totalReturn += payout;
        totalsByUser.set(bet.user_id, totals);
      }

      const settledPlayers = [];
      const orderedResults = [...totalsByUser.entries()].sort(([left], [right]) => left.localeCompare(right));
      for (const [userId, totals] of orderedResults) {
        const wallet = await lockWallet(client, userId);
        const payout = totals.totalReturn;
        let updatedWallet = wallet;
        if (payout > 0n) {
          const update = await updateWallet(client, wallet, payout);
          updatedWallet = update.wallet;
          await insertLedger(client, {
            walletId: wallet.id,
            userId,
            transactionType: 'ROUND_PAYOUT',
            amount: payout,
            balanceBefore: update.balanceBefore,
            balanceAfter: update.balanceAfter,
            roomId,
            roundId,
            idempotencyKey: `round_payout:${roundId}:${userId}`,
            reason: 'Round payout',
          });
        }

        const netGain = totals.totalReturn - totals.totalBet;
        const outcome = netGain > 0n ? 'win' : netGain < 0n ? 'loss' : 'draw';
        await client.query(
          `INSERT INTO player_round_results
             (round_id, user_id, room_id, total_bet, total_return, net_gain, outcome)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            roundId,
            userId,
            roomId,
            totals.totalBet.toString(),
            totals.totalReturn.toString(),
            netGain.toString(),
            outcome,
          ]
        );
        settledPlayers.push({
          userId,
          balance: toSafeInteger(updatedWallet.balance, 'balance'),
          totalBet: toSafeInteger(totals.totalBet, 'total_bet'),
          totalReturn: toSafeInteger(totals.totalReturn, 'total_return'),
        });
      }

      await client.query(
        `UPDATE rounds
         SET dice = $1,
             final_result = $1,
             result_mode = $2,
             status = 'settled',
             settled_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [
          JSON.stringify(committedDice),
          round.admin_override_result ? 'admin_scheduled' : 'random',
          roundId,
        ]
      );
      return { roundId, dice: committedDice, players: settledPlayers, isDuplicate: false };
    });
  }
}
