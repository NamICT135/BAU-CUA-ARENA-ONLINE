import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { GameService } from '../server/game.js';

const config = JSON.parse(await readFile(new URL('../game-config.json', import.meta.url), 'utf8'));
let sequence = 0;
function setup(t, options = {}) {
  const game = new GameService(config, { revealMs: 5, ...options });
  t.after(() => game.close());
  const created = game.handle('host', 'room:create', { name: 'Chủ phòng' });
  const joined = game.handle('guest', 'room:join', { name: 'Khách chơi', code: created.state.code });
  assert.ok(created.ok && joined.ok);
  const room = game.rooms.get(created.state.code);
  const cmd = (event, payload = {}, socket = 'host') => game.handle(socket, event, {
    requestId: `test-${++sequence}`, gameId: room.gameId, roundNumber: room.roundNumber, roundId: room.roundId, ...payload,
  });
  return { game, room, created, joined, cmd };
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail('Expected state was not reached');
}

test('default room opens immediately with 30 seconds; new arrivals can bet', t => {
  const { room, joined, cmd } = setup(t);
  assert.equal(room.phase, 'betting');
  assert.equal(room.roundNumber, 1);
  assert.ok(room.deadline - Date.now() > 29_000);
  assert.equal(joined.state.you.eligible, true);
  assert.equal(cmd('bet:add', { symbol: 'cua', amount: 37 }, 'guest').ok, true);
  const allIn = cmd('bet:add', { symbol: 'bau', allIn: true }, 'guest');
  assert.equal(allIn.state.you.bets.bau, 963);
  assert.equal(cmd('bet:add', { symbol: 'bau', allIn: true }, 'guest').ok, false);
});

test('automatic round settles once, including an empty round, and starts the next round', async t => {
  const { room, cmd } = setup(t, { bettingMs: 40, resultMs: 50, randomIntFn: () => 1 });
  assert.equal(cmd('bet:add', { symbol: 'cua', amount: 100 }, 'guest').ok, true);
  await until(() => room.phase === 'result');
  assert.equal(room.history.length, 1);
  assert.equal(room.history[0].results[0].balance, 1300);
  await until(() => room.roundNumber === 2);
  assert.equal(room.phase, 'betting');
  await until(() => room.history.length === 2);
  assert.equal(room.history[0].totalBet, 0);
  assert.equal(room.history[0].results.length, 0);
});

test('pause preserves time and stakes, closes betting, then resumes without duplicate timers', async t => {
  const { room, cmd } = setup(t, { bettingMs: 80, resultMs: 1000 });
  cmd('bet:add', { symbol: 'cua', amount: 100 });
  assert.equal(cmd('host:pause', { paused: true }).ok, true);
  assert.equal(room.deadline, null);
  const remaining = room.remainingMs;
  await delay(100);
  assert.equal(room.phase, 'betting');
  assert.equal(room.remainingMs, remaining);
  assert.equal(cmd('bet:add', { symbol: 'cua', amount: 10 }).ok, false);
  cmd('host:pause', { paused: false });
  await until(() => room.phase === 'result');
  assert.equal(room.history.length, 1);
  assert.equal(room.history[0].totalBet, 100);
});

test('deadline is enforced before timer callback; stale admin commands cannot change a later round', t => {
  const { room, cmd } = setup(t);
  room.deadline = Date.now() - 1;
  assert.equal(cmd('bet:add', { symbol: 'cua', amount: 10 }).ok, false);
  assert.equal(cmd('host:grant', { roundNumber: 0, playerId: room.hostId, amount: 1 }).error.code, 'STALE_ROUND');
});

test('host authorization, grants with dedupe, locked joins, kick revokes session, transfer revokes old host', t => {
  const kicked = [];
  const { game, room, joined, cmd } = setup(t, { onKick: id => kicked.push(id) });
  for (const event of ['host:pause', 'host:lock', 'host:grant', 'host:kick', 'host:result', 'host:cancel', 'host:transfer', 'host:betting-duration']) {
    assert.equal(cmd(event, {}, 'guest').error.code, 'HOST_ONLY');
  }
  const grant = { playerId: joined.session.playerId, amount: 125, requestId: 'grant-once' };
  assert.equal(cmd('host:grant', grant).ok, true);
  assert.equal(cmd('host:grant', grant).ok, true);
  assert.equal(room.players.get(joined.session.playerId).balance, 1125);
  for (const amount of [0, -1, 0.5, '100', 1e20]) assert.equal(cmd('host:grant', { ...grant, requestId: `bad-${amount}`, amount }).ok, false);
  cmd('host:lock', { locked: true });
  assert.equal(game.handle('new', 'room:join', { name: 'Người mới', code: room.code }).error.code, 'ROOM_LOCKED');
  assert.equal(game.handle('guest', 'room:resume', { token: joined.session.token }).ok, true);
  cmd('bet:add', { symbol: 'cua', amount: 100 }, 'guest');
  assert.equal(cmd('host:kick', { playerId: joined.session.playerId }).ok, true);
  assert.deepEqual(kicked, ['guest']);
  assert.equal(game.handle('guest', 'room:resume', { token: joined.session.token }).ok, false);
  assert.equal(cmd('bet:add', { symbol: 'cua', amount: 1 }, 'guest').error.code, 'NOT_IN_ROOM');
  cmd('host:lock', { locked: false });
  const next = game.handle('new', 'room:join', { name: 'Người mới', code: room.code });
  cmd('host:transfer', { playerId: next.session.playerId });
  assert.equal(cmd('host:lock', { locked: true }).error.code, 'HOST_ONLY');
  assert.equal(cmd('host:lock', { locked: true }, 'new').ok, true);
});

test('host sets the betting duration for following rounds only', t => {
  const { game, room, cmd } = setup(t);
  const currentDeadline = room.deadline;
  assert.equal(cmd('host:betting-duration', { durationSeconds: 15 }).ok, true);
  assert.equal(room.bettingMs, 15_000);
  assert.equal(room.deadline, currentDeadline);
  assert.equal(game.handle('guest', 'room:sync', {}).state.bettingMs, 15_000);
  for (const durationSeconds of [5, 31, 60.5, '30']) {
    assert.equal(cmd('host:betting-duration', { durationSeconds }).error.code, 'INVALID_DURATION');
  }
  assert.equal(cmd('host:cancel').ok, true);
  assert.ok(room.deadline - Date.now() > 14_000);
  assert.ok(room.deadline - Date.now() <= 15_000);
});

test('demo is per round, private selection only goes to host, cancel releases bets', async t => {
  const { game, room, joined, cmd } = setup(t, { resultMs: 1000, randomIntFn: () => 0 });
  const dice = ['cua', 'cua', 'tom'];
  assert.equal(cmd('host:result', { dice: ['invalid'] }).ok, false);
  assert.equal(cmd('host:result', { dice }).ok, true);
  const guestState = game.handle('guest', 'room:sync', {}).state;
  assert.equal(guestState.demo, undefined);
  assert.equal(guestState.admin, undefined);
  assert.deepEqual(guestState.dice, []);
  cmd('bet:add', { symbol: 'cua', amount: 100 }, 'guest');
  cmd('round:shake');
  assert.equal(cmd('host:kick', { playerId: joined.session.playerId }).ok, false);
  assert.equal(cmd('host:result', { dice: null }).ok, false);
  await until(() => room.phase === 'result');
  assert.deepEqual(room.dice, dice);
  assert.equal(room.history[0].demo, true);
  assert.equal(game.handle('guest', 'room:sync', {}).state.history[0].demo, undefined);
  assert.equal(game.handle('host', 'room:sync', {}).state.history[0].demo, true);
  assert.equal(room.players.get(joined.session.playerId).balance, 1200);
  cmd('round:open');
  assert.equal(room.forcedDice, null);
  cmd('bet:add', { symbol: 'cua', amount: 123 }, 'guest');
  assert.equal(cmd('host:cancel').ok, true);
  const state = game.handle('guest', 'room:sync', {}).state;
  assert.equal(state.you.bets.cua, 0);
  assert.equal(state.you.balance, 1200);
});

test('room expiry and close remove automatic timers even when rounds update timestamps', async t => {
  const { game, room } = setup(t, { roomTtlMs: 0, bettingMs: 20 });
  game.disconnect('host');
  game.disconnect('guest');
  game.cleanup();
  assert.equal(game.rooms.size, 0);
  assert.equal(room.phaseTimer, null);
  await delay(40);
  assert.equal(game.rooms.size, 0);
});
