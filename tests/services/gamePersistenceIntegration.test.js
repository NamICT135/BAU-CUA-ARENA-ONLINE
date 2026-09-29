import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GameService } from '../../server/game.js';
import { query } from '../../src/db/connection.js';
import { GamePersistenceService } from '../../src/services/GamePersistenceService.js';

const config = JSON.parse(await readFile(new URL('../../game-config.json', import.meta.url), 'utf8'));

async function accepted(game, socketId, event, payload, identity) {
  const reply = await game.handle(socketId, event, payload, identity);
  assert.equal(reply.ok, true, `${event}: ${JSON.stringify(reply.error)}`);
  return reply;
}

async function createAccountFixture() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const userResult = await query(
    `INSERT INTO users (username, email, password_hash, display_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [`partb_${suffix}`, `partb_${suffix}@example.com`, 'test-only-password-hash', 'Part B Player']
  );
  const userId = userResult.rows[0].id;
  await query('INSERT INTO wallets (user_id, balance) VALUES ($1, $2)', [userId, config.initialBalance]);
  return userId;
}

async function removeAccountFixture(userId) {
  if (!userId) return;
  await query('DELETE FROM processed_commands WHERE user_id = $1', [userId]);
  await query('DELETE FROM rooms WHERE host_id = $1', [userId]);
  await query('DELETE FROM users WHERE id = $1', [userId]);
}

test('Part B persists a complete GameService bet and settlement in PostgreSQL', async t => {
  let userId;
  let game;
  t.after(async () => {
    game?.close();
    await removeAccountFixture(userId);
  });

  userId = await createAccountFixture();
  const identity = { userId, role: 'player' };
  const persistence = new GamePersistenceService();
  const dice = ['cua', 'bau', 'ga'];
  let diceIndex = 0;
  game = new GameService(config, {
    autoStart: false,
    revealMs: 60_000,
    persistence,
    randomIntFn: () => config.symbols.findIndex(symbol => symbol.id === dice[diceIndex++]),
  });

  const created = await accepted(game, 'part-b-socket', 'room:create', { name: 'Client name is ignored' }, identity);
  assert.equal(created.state.players[0].name, 'Part B Player');
  assert.equal(created.state.you.balance, config.initialBalance);

  const opened = await accepted(game, 'part-b-socket', 'round:open', {
    requestId: 'part-b-open-1',
    gameId: created.state.gameId,
    roundNumber: 0,
  }, identity);

  const placed = await accepted(game, 'part-b-socket', 'bet:add', {
    requestId: 'part-b-bet-1',
    roundId: opened.state.roundId,
    symbol: 'cua',
    amount: 10_000,
  }, identity);
  assert.equal(placed.state.you.balance, config.initialBalance - 10_000);
  assert.equal(placed.state.you.bets.cua, 10_000);

  const secondBet = await accepted(game, 'part-b-socket', 'bet:add', {
    requestId: 'part-b-bet-2',
    roundId: opened.state.roundId,
    symbol: 'tom',
    amount: 5_000,
  }, identity);
  assert.equal(secondBet.state.you.balance, config.initialBalance - 15_000);
  assert.equal(secondBet.state.you.bets.tom, 5_000);

  const duplicate = await accepted(game, 'part-b-socket', 'bet:add', {
    requestId: 'part-b-bet-1',
    roundId: opened.state.roundId,
    symbol: 'cua',
    amount: 10_000,
  }, identity);
  assert.equal(duplicate.state.you.balance, config.initialBalance - 15_000);
  assert.equal(duplicate.state.you.bets.cua, 10_000);
  assert.equal(duplicate.state.you.bets.tom, 5_000);

  const persistedBet = await query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS total
     FROM bets WHERE round_id = $1 AND user_id = $2`,
    [opened.state.roundId, userId]
  );
  assert.equal(persistedBet.rows[0].count, 2);
  assert.equal(Number(persistedBet.rows[0].total), 15_000);

  await accepted(game, 'part-b-socket', 'round:shake', {
    requestId: 'part-b-shake-1',
    roundId: opened.state.roundId,
  }, identity);
  const room = game.rooms.get(created.state.code);
  await game.settle(room);

  const settled = await accepted(game, 'part-b-socket', 'room:sync', {}, identity);
  assert.deepEqual(settled.state.dice, dice);
  assert.equal(settled.state.you.balance, config.initialBalance + 5_000);
  assert.equal(settled.state.you.stats.gamesPlayed, 1);
  assert.equal(settled.state.you.stats.wins, 1);

  const restartedPersistence = new GamePersistenceService();
  const profile = await restartedPersistence.getPlayerProfile(userId);
  const history = await restartedPersistence.getPlayerHistory({ userId });
  const statistics = await restartedPersistence.getPlayerStatistics(userId);

  assert.equal(profile.balance, config.initialBalance + 5_000);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].dice, dice);
  assert.equal(history[0].totalBet, 15_000);
  assert.equal(history[0].totalReturn, 20_000);
  assert.equal(history[0].outcome, 'win');
  assert.deepEqual(statistics, {
    gamesPlayed: 1,
    wins: 1,
    losses: 0,
    breakEven: 0,
    totalBet: 15_000,
    totalReturned: 20_000,
    netGain: 5_000,
  });

  const betStatuses = await query(
    `SELECT symbol, status
     FROM bets
     WHERE round_id = $1 AND user_id = $2
     ORDER BY symbol`,
    [opened.state.roundId, userId]
  );
  assert.deepEqual(
    betStatuses.rows.map(row => [row.symbol, row.status]),
    [['cua', 'won'], ['tom', 'lost']]
  );

  const ledger = await query(
    `SELECT transaction_type, amount
     FROM wallet_transactions
     WHERE user_id = $1
     ORDER BY created_at, id`,
    [userId]
  );
  assert.deepEqual(
    ledger.rows.map(row => [row.transaction_type, Number(row.amount)]),
    [['BET_DEBIT', -10_000], ['BET_DEBIT', -5_000], ['ROUND_PAYOUT', 20_000]]
  );
});
