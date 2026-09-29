import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { GameService, calculateReturn, totalBets } from '../server/game.js';

const config = JSON.parse(await readFile(new URL('../game-config.json', import.meta.url), 'utf8'));

test('payout includes stake for 1/2/3 matches; zero matches loses only the stake', () => {
  for (let count = 0; count <= 3; count += 1) {
    const dice = Array(3).fill('bau').map((id, index) => index < count ? 'cua' : id);
    assert.equal(calculateReturn({ cua: 50 }, dice), count === 0 ? 0 : 50 * (count + 1));
  }
  assert.equal(calculateReturn({ cua: 50, tom: 100, nai: 50 }, ['cua', 'cua', 'tom']), 350);
  assert.equal(totalBets({ cua: 50, tom: 100, nai: 50 }), 200);
});
function gameFor(t, options = {}) {
  const game = new GameService(config, { autoStart: false, revealMs: 10, ...options });
  t.after(() => game.close());
  return game;
}

async function ok(game, socketId, event, payload = {}) {
  const reply = await game.handle(socketId, event, payload);
  assert.equal(reply.ok, true, JSON.stringify(reply.error));
  return reply;
}

test('dedupe retains accepted IDs beyond 200 edits; exhausted cache never reapplies a bet', async () => {
  const game = new GameService(config, { autoStart: false });
  try {
    const created = await ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
    const opened = await ok(game, 'host', 'round:open', { requestId: 'open', gameId: created.state.gameId, roundNumber: 0 });
    const roundId = opened.state.roundId;
    const first = { requestId: 'first', roundId, symbol: 'cua', amount: 10 };
    await ok(game, 'host', 'bet:add', first);
    for (let index = 0; index < 210; index += 1) await ok(game, 'host', 'bet:clear', { requestId: `clear-${index}`, roundId });
    assert.equal((await ok(game, 'host', 'bet:add', first)).state.you.bets.cua, 0);
    for (let index = 210; index < 998; index += 1) await ok(game, 'host', 'bet:clear', { requestId: `clear-${index}`, roundId });
    const limited = await game.handle('host', 'bet:add', { requestId: 'after-cap', roundId, symbol: 'cua', amount: 10 });
    assert.equal(limited.ok, false);
    assert.equal((await ok(game, 'host', 'bet:add', first)).state.you.bets.cua, 0);
    // An empty round can be reset, including when everybody has run out of coins.
    const reset = await ok(game, 'host', 'room:reset', { requestId: 'recover', gameId: created.state.gameId, roundNumber: 1 });
    assert.equal(reset.state.phase, 'waiting');
    assert.equal(reset.state.you.balance, config.initialBalance);
  } finally { game.close(); }
});

test('reset rotates gameId so delayed open/reset cannot affect a new game', async t => {
  const game = gameFor(t);
  const created = await ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
  const oldGameId = created.state.gameId;
  const reset = await ok(game, 'host', 'room:reset', { requestId: 'reset', gameId: oldGameId, roundNumber: 0 });
  assert.notEqual(reset.state.gameId, oldGameId);
  for (const event of ['round:open', 'room:reset']) {
    const delayed = await game.handle('host', event, { requestId: `delayed-${event}`, gameId: oldGameId, roundNumber: 0 });
    assert.equal(delayed.ok, false);
    assert.equal(delayed.error.code, 'STALE_ROUND');
  }
});

test('all configured symbols/chips work; clear is personal and double settle does nothing', async t => {
  const game = gameFor(t, { randomIntFn: () => 1 });
  const host = await ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
  await ok(game, 'guest', 'room:join', { name: 'Bạn chơi', code: host.state.code });
  const open = await ok(game, 'host', 'round:open', { requestId: 'open', gameId: host.state.gameId, roundNumber: 0 });
  const roundId = open.state.roundId;
  let sequence = 0;
  const extraFunds = Math.max(0, Math.max(...config.chips) - config.initialBalance);
  if (extraFunds > 0) {
    await ok(game, 'host', 'host:grant', {
      requestId: 'fund-configured-chips', gameId: open.state.gameId, roundNumber: open.state.roundNumber,
      playerId: game.memberships.get('guest').playerId, amount: extraFunds,
    });
  }
  for (const symbol of config.symbols) {
    for (const amount of config.chips) {
      await ok(game, 'guest', 'bet:clear', { requestId: `clear${sequence++}`, roundId });
      assert.equal((await ok(game, 'guest', 'bet:add', { requestId: `add${sequence++}`, roundId, symbol: symbol.id, amount })).state.you.bets[symbol.id], amount);
    }
  }
  await ok(game, 'host', 'bet:add', { requestId: 'host-bet', roundId, symbol: 'cua', amount: 50 });
  await ok(game, 'guest', 'bet:clear', { requestId: 'clear-final', roundId });
  assert.equal((await ok(game, 'host', 'room:sync')).state.you.bets.cua, 50);
  await ok(game, 'host', 'round:shake', { requestId: 'shake', roundId });
  await delay(30);
  const result = (await ok(game, 'host', 'room:sync')).state;
  assert.equal(result.you.balance, config.initialBalance + 150);
  assert.equal(result.you.lastResult.totalReturn, 200);
  assert.equal(result.you.stats.wins, 1);
  assert.equal((await ok(game, 'guest', 'room:sync')).state.you.stats.gamesPlayed, 0);
  await game.settle(game.rooms.get(host.state.code));
  assert.equal((await ok(game, 'host', 'room:sync')).state.history.length, 1);
  assert.equal((await ok(game, 'host', 'room:sync')).state.you.balance, config.initialBalance + 150);
});

test('disconnected empty seats expire while accepted bets remain available for settlement', async t => {
  const game = gameFor(t, { disconnectTtlMs: 0 });
  const host = await ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
  const idle = await ok(game, 'idle', 'room:join', { name: 'Không cược', code: host.state.code });
  const betting = await ok(game, 'betting', 'room:join', { name: 'Có cược', code: host.state.code });
  const open = await ok(game, 'host', 'round:open', { requestId: 'open', gameId: host.state.gameId, roundNumber: 0 });
  await ok(game, 'betting', 'bet:add', { requestId: 'bet', roundId: open.state.roundId, symbol: 'cua', amount: 50 });
  game.disconnect('idle');
  game.disconnect('betting');
  await game.cleanup();
  assert.equal(game.sessions.has(idle.session.token), false);
  assert.equal(game.sessions.has(betting.session.token), true);
  assert.equal((await ok(game, 'host', 'room:sync')).state.players.length, 2);
});

test('kicking a bettor revokes access without deleting the accepted stake before settlement', async t => {
  const winningIndex = config.symbols.findIndex(symbol => symbol.id === 'cua');
  const game = gameFor(t, { randomIntFn: () => winningIndex, revealMs: 100000 });
  const host = await ok(game, 'host', 'room:create', { name: 'Chủ phòng' });
  const guest = await ok(game, 'guest', 'room:join', { name: 'Người cược', code: host.state.code });
  const open = await ok(game, 'host', 'round:open', {
    requestId: 'open', gameId: host.state.gameId, roundNumber: 0,
  });
  await ok(game, 'guest', 'bet:add', {
    requestId: 'bet', roundId: open.state.roundId, symbol: 'cua', amount: 100,
  });
  await ok(game, 'host', 'host:kick', {
    requestId: 'kick', gameId: open.state.gameId, roundNumber: open.state.roundNumber,
    playerId: guest.session.playerId,
  });

  assert.equal((await game.handle('guest', 'room:sync', {})).error.code, 'NOT_IN_ROOM');
  const room = game.rooms.get(host.state.code);
  assert.equal(room.players.get(guest.session.playerId).pendingRemoval, true);

  await ok(game, 'host', 'round:shake', { requestId: 'shake', roundId: open.state.roundId });
  await game.settle(room);
  assert.equal(room.players.has(guest.session.playerId), false);
  assert.equal(room.history[0].results.find(result => result.playerId === guest.session.playerId).totalReturn, 400);
});
