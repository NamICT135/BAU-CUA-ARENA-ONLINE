import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { io as createClient } from 'socket.io-client';
import { GameService } from '../server/game.js';
import { createGameServer } from '../server/app.js';
import { PersistenceError } from '../src/services/GamePersistenceService.js';
import { WalletService } from '../src/services/WalletService.js';

const config = JSON.parse(await readFile(new URL('../game-config.json', import.meta.url), 'utf8'));

class FakePersistence {
  constructor(events = []) {
    this.events = events;
    this.balances = new Map();
    this.failNextBet = false;
    this.failNextSettlement = false;
    this.betBarrier = null;
    this.settlementCalls = 0;
  }

  addProfile(userId, displayName, balance = 100000, role = 'player') {
    this.balances.set(userId, balance);
    this[userId] = {
      userId,
      displayName,
      avatarKey: 'avatar_default',
      role,
      balance,
      stats: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        breakEven: 0,
        highestBalance: balance,
        totalBet: 0,
        totalReturned: 0,
      },
    };
  }

  async getPlayerProfile(userId) {
    const profile = this[userId];
    if (!profile) throw new PersistenceError('WALLET_NOT_FOUND', 'Không tìm thấy ví.');
    return { ...profile, balance: this.balances.get(userId), stats: { ...profile.stats } };
  }

  async getPlayerHistory({ userId, limit, offset }) {
    this.lastHistoryQuery = { userId, limit, offset };
    return [{ roundId: 'round-1', userId }];
  }

  async getPlayerStatistics(userId) {
    this.lastStatisticsUserId = userId;
    return { gamesPlayed: 1, wins: 1, losses: 0, breakEven: 0 };
  }

  async getWalletTransactions({ userId, limit, offset }) {
    this.lastTransactionQuery = { userId, limit, offset };
    return [{ id: 'transaction-1', userId }];
  }

  async getRoomHistory({ roomCode, limit, offset }) {
    this.lastRoomHistoryQuery = { roomCode, limit, offset };
    return [{ roundId: 'round-1', roomCode }];
  }

  async getSymbolStatistics({ roomCode }) {
    this.lastRoomStatisticsCode = roomCode;
    return { completedRounds: 1, totalDice: 3, symbols: { cua: 3 } };
  }

  async createRoom() { this.events.push('db:create-room'); }
  async joinRoom() { this.events.push('db:join-room'); }
  async leaveRoom() { this.events.push('db:leave-room'); }
  async closeRoom() { this.events.push('db:close-room'); }
  async transferHost() { this.events.push('db:transfer-host'); }
  async createRound() { this.events.push('db:create-round'); }

  async placeBet({ userId, amount }) {
    this.events.push('db:place-bet:start');
    if (this.betBarrier) await this.betBarrier;
    if (this.failNextBet) {
      this.failNextBet = false;
      throw new PersistenceError('DATABASE_UNAVAILABLE', 'Database tạm thời không khả dụng.');
    }
    const balance = this.balances.get(userId) - amount;
    this.balances.set(userId, balance);
    this.events.push('db:place-bet:commit');
    return { balance, isDuplicate: false };
  }

  async clearBets({ userId }) {
    const balance = this.balances.get(userId);
    return { balance, refunded: 0, isDuplicate: false };
  }

  async settleRound({ playerResults }) {
    this.settlementCalls += 1;
    this.events.push('db:settle:start');
    if (this.failNextSettlement) {
      this.failNextSettlement = false;
      throw new PersistenceError('DATABASE_UNAVAILABLE', 'Database tạm thời không khả dụng.');
    }
    const players = playerResults.map(result => {
      const balance = this.balances.get(result.userId) + result.totalReturn;
      this.balances.set(result.userId, balance);
      return { ...result, balance };
    });
    this.events.push('db:settle:commit');
    return { players, isDuplicate: false };
  }
}

async function success(game, socketId, event, payload, identity) {
  const reply = await game.handle(socketId, event, payload, identity);
  assert.equal(reply.ok, true, `${event}: ${JSON.stringify(reply.error)}`);
  return reply;
}

test('admin grants require a caller-provided idempotency requestId', async () => {
  await assert.rejects(
    () => WalletService.adminGrant({ userId: 'user-1', amount: 1000, actorId: 'admin-1' }),
    /requires a requestId for idempotency/
  );
});

test('persistent rooms require authenticated identity and load trusted profile/wallet data', async t => {
  const persistence = new FakePersistence();
  persistence.addProfile('user-1', 'Tên từ tài khoản', 345678);
  const game = new GameService(config, { autoStart: false, persistence });
  t.after(() => game.close());

  const unauthenticated = await game.handle('anonymous', 'room:create', { name: 'Tên client' });
  assert.equal(unauthenticated.ok, false);
  assert.equal(unauthenticated.error.code, 'AUTH_REQUIRED');

  const created = await success(
    game,
    'socket-1',
    'room:create',
    { name: 'Tên client không được tin' },
    { userId: 'user-1' }
  );
  assert.equal(created.state.you.balance, 345678);
  assert.equal(created.state.players[0].name, 'Tên từ tài khoản');
});

test('persistent resume uses authenticated account identity and replaces the old socket', async t => {
  const replaced = [];
  const persistence = new FakePersistence();
  persistence.addProfile('user-1', 'Người chơi', 100000);
  persistence.addProfile('user-2', 'Người khác', 100000);
  const game = new GameService(config, {
    autoStart: false,
    persistence,
    onReplace: socketId => replaced.push(socketId),
  });
  t.after(() => game.close());

  const created = await success(game, 'old-socket', 'room:create', { name: 'ignored' }, { userId: 'user-1' });
  const resumed = await success(game, 'new-socket', 'room:resume', {}, { userId: 'user-1' });

  assert.equal(resumed.session.playerId, created.session.playerId);
  assert.deepEqual(replaced, ['old-socket']);
  assert.equal((await game.handle('old-socket', 'room:sync', {}, { userId: 'user-1' })).error.code, 'NOT_IN_ROOM');
  assert.equal((await game.handle('other-socket', 'room:resume', {}, { userId: 'user-2' })).error.code, 'SESSION_EXPIRED');
});

test('bet transaction commits before RAM update/broadcast and failure leaves RAM unchanged', async t => {
  const events = [];
  const persistence = new FakePersistence(events);
  persistence.addProfile('user-1', 'Người chơi', 100000);
  const game = new GameService(config, {
    autoStart: false,
    persistence,
    onState: () => events.push('broadcast'),
  });
  t.after(() => game.close());

  const created = await success(game, 'socket-1', 'room:create', { name: 'ignored' }, { userId: 'user-1' });
  const opened = await success(game, 'socket-1', 'round:open', {
    requestId: 'open-1',
    gameId: created.state.gameId,
    roundNumber: 0,
  }, { userId: 'user-1' });
  events.length = 0;

  const accepted = await success(game, 'socket-1', 'bet:add', {
    requestId: 'bet-1',
    roundId: opened.state.roundId,
    symbol: 'cua',
    amount: 10000,
  }, { userId: 'user-1' });
  assert.equal(accepted.state.you.balance, 90000);
  assert.equal(accepted.state.you.bets.cua, 10000);
  assert.deepEqual(events, ['db:place-bet:start', 'db:place-bet:commit', 'broadcast']);

  persistence.failNextBet = true;
  events.length = 0;
  const rejected = await game.handle('socket-1', 'bet:add', {
    requestId: 'bet-2',
    roundId: opened.state.roundId,
    symbol: 'tom',
    amount: 5000,
  }, { userId: 'user-1' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'DATABASE_UNAVAILABLE');
  assert.deepEqual(events, ['db:place-bet:start']);

  const unchanged = await success(game, 'socket-1', 'room:sync', {}, { userId: 'user-1' });
  assert.equal(unchanged.state.you.balance, 90000);
  assert.equal(unchanged.state.you.bets.tom, 0);
});

test('persistent mode blocks former host-only economy/admin commands', async t => {
  const persistence = new FakePersistence();
  persistence.addProfile('user-1', 'Chủ phòng', 100000);
  const game = new GameService(config, { autoStart: false, persistence });
  t.after(() => game.close());

  const created = await success(game, 'socket-1', 'room:create', { name: 'ignored' }, { userId: 'user-1' });
  const blocked = await game.handle('socket-1', 'host:grant', {
    requestId: 'grant-1',
    gameId: created.state.gameId,
    roundNumber: 0,
    playerId: created.session.playerId,
    amount: 50000,
  }, { userId: 'user-1' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'ADMIN_ONLY');
});

test('failed settlement keeps balances/history unchanged until database commit', async t => {
  const persistence = new FakePersistence();
  persistence.addProfile('user-1', 'Chủ phòng', 100000);
  const game = new GameService(config, { autoStart: false, revealMs: 100000, persistence });
  t.after(() => game.close());

  const created = await success(game, 'socket-1', 'room:create', { name: 'ignored' }, { userId: 'user-1' });
  const opened = await success(game, 'socket-1', 'round:open', {
    requestId: 'open-1', gameId: created.state.gameId, roundNumber: 0,
  }, { userId: 'user-1' });
  await success(game, 'socket-1', 'bet:add', {
    requestId: 'bet-1', roundId: opened.state.roundId, symbol: 'cua', amount: 10000,
  }, { userId: 'user-1' });
  await success(game, 'socket-1', 'round:shake', {
    requestId: 'shake-1', roundId: opened.state.roundId,
  }, { userId: 'user-1' });

  const room = game.rooms.get(created.state.code);
  persistence.failNextSettlement = true;
  await assert.rejects(() => game.settle(room), { code: 'DATABASE_UNAVAILABLE' });
  assert.equal(room.phase, 'revealing');
  assert.equal(room.history.length, 0);
  assert.equal(room.players.get(created.session.playerId).balance, 90000);

  await game.settle(room);
  assert.equal(room.phase, 'result');
  assert.equal(room.history.length, 1);
});

test('room operations serialize an in-flight bet before shake and apply concurrent settlement once', async t => {
  const events = [];
  const persistence = new FakePersistence(events);
  persistence.addProfile('user-1', 'Chủ phòng', 100000);
  let releaseBet;
  persistence.betBarrier = new Promise(resolve => { releaseBet = resolve; });
  const winningSymbol = config.symbols[0].id;
  const game = new GameService(config, {
    autoStart: false,
    revealMs: 100000,
    persistence,
    randomIntFn: () => 0,
  });
  t.after(() => game.close());

  const created = await success(game, 'socket-1', 'room:create', { name: 'ignored' }, { userId: 'user-1' });
  const opened = await success(game, 'socket-1', 'round:open', {
    requestId: 'open-1', gameId: created.state.gameId, roundNumber: 0,
  }, { userId: 'user-1' });
  const room = game.rooms.get(created.state.code);

  const betPromise = success(game, 'socket-1', 'bet:add', {
    requestId: 'bet-1', roundId: opened.state.roundId, symbol: winningSymbol, amount: 10000,
  }, { userId: 'user-1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(events.includes('db:place-bet:start'));

  const shakePromise = success(game, 'socket-1', 'round:shake', {
    requestId: 'shake-1', roundId: opened.state.roundId,
  }, { userId: 'user-1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(room.phase, 'betting');

  releaseBet();
  await Promise.all([betPromise, shakePromise]);
  assert.equal(room.phase, 'revealing');
  assert.equal(room.players.get(created.session.playerId).bets[winningSymbol], 10000);

  await Promise.all([game.settle(room), game.settle(room)]);
  const player = room.players.get(created.session.playerId);
  assert.equal(persistence.settlementCalls, 1);
  assert.equal(room.history.length, 1);
  assert.equal(player.stats.gamesPlayed, 1);
  assert.equal(player.balance, 130000);
});

test('kick revokes room access but an accepted persistent bet still settles before membership removal', async t => {
  const persistence = new FakePersistence();
  persistence.addProfile('host-user', 'Chủ phòng', 100000);
  persistence.addProfile('guest-user', 'Người cược', 100000);
  const winningIndex = config.symbols.findIndex(symbol => symbol.id === 'cua');
  const kickedSockets = [];
  const game = new GameService(config, {
    autoStart: false,
    revealMs: 100000,
    persistence,
    randomIntFn: () => winningIndex,
    onKick: socketId => kickedSockets.push(socketId),
  });
  t.after(() => game.close());

  const host = await success(game, 'host-socket', 'room:create', { name: 'ignored' }, { userId: 'host-user' });
  const guest = await success(game, 'guest-socket', 'room:join', {
    name: 'ignored',
    code: host.state.code,
  }, { userId: 'guest-user' });
  const opened = await success(game, 'host-socket', 'round:open', {
    requestId: 'open-1', gameId: host.state.gameId, roundNumber: 0,
  }, { userId: 'host-user' });
  await success(game, 'guest-socket', 'bet:add', {
    requestId: 'bet-1', roundId: opened.state.roundId, symbol: 'cua', amount: 10000,
  }, { userId: 'guest-user' });

  await success(game, 'host-socket', 'host:kick', {
    requestId: 'kick-1', gameId: opened.state.gameId, roundNumber: opened.state.roundNumber,
    playerId: guest.session.playerId,
  }, { userId: 'host-user' });
  const room = game.rooms.get(host.state.code);
  const pendingPlayer = room.players.get(guest.session.playerId);
  assert.equal(pendingPlayer.pendingRemoval, true);
  assert.equal(pendingPlayer.connected, false);
  assert.deepEqual(kickedSockets, ['guest-socket']);
  assert.equal((await game.handle('guest-socket', 'room:sync', {}, { userId: 'guest-user' })).error.code, 'NOT_IN_ROOM');

  await success(game, 'host-socket', 'round:shake', {
    requestId: 'shake-1', roundId: opened.state.roundId,
  }, { userId: 'host-user' });
  await game.settle(room);

  assert.equal(persistence.balances.get('guest-user'), 130000);
  assert.equal(room.players.has(guest.session.playerId), false);
  assert.ok(persistence.events.includes('db:leave-room'));
});

test('authenticated HTTP data APIs use server identity and preserve pagination', async t => {
  const persistence = new FakePersistence();
  persistence.addProfile('user-1', 'Người chơi', 456789);
  const app = await createGameServer({
    autoStart: false,
    persistence,
    authenticateHttp: async req => req.headers.authorization === 'Bearer valid-session'
      ? { userId: 'user-1', role: 'player' }
      : null,
  });
  const address = await app.listen(0, '127.0.0.1');
  t.after(async () => app.close());
  const base = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${base}/api/me/history`);
  assert.equal(unauthorized.status, 401);

  const headers = { Authorization: 'Bearer valid-session' };
  const wallet = await fetch(`${base}/api/me/wallet`, { headers });
  assert.deepEqual(await wallet.json(), { data: { userId: 'user-1', balance: 456789 } });

  const history = await fetch(`${base}/api/me/history?limit=7&offset=3`, { headers });
  assert.equal(history.status, 200);
  assert.deepEqual(persistence.lastHistoryQuery, { userId: 'user-1', limit: 7, offset: 3 });

  const roomStats = await fetch(`${base}/api/rooms/abc123/symbol-statistics`, { headers });
  assert.equal(roomStats.status, 200);
  assert.equal(persistence.lastRoomStatisticsCode, 'ABC123');
});

test('Socket.IO command authorization can revoke an already connected session', async t => {
  const persistence = new FakePersistence();
  persistence.addProfile('user-1', 'Người chơi', 100000);
  let revoked = false;
  const app = await createGameServer({
    autoStart: false,
    persistence,
    authenticateSocket: async socket => ({ userId: socket.handshake.auth.userId, role: 'player' }),
    authorizeSocketCommand: async (_socket, _event, _payload, identity) => revoked ? null : identity,
  });
  const address = await app.listen(0, '127.0.0.1');
  const socket = createClient(`http://127.0.0.1:${address.port}`, {
    auth: { userId: 'user-1' },
    transports: ['websocket'],
    reconnection: false,
  });
  t.after(async () => { socket.disconnect(); await app.close(); });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const command = (event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));

  const created = await command('room:create', { name: 'ignored' });
  assert.equal(created.ok, true);
  revoked = true;
  const rejected = await command('room:sync', {});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'AUTH_REQUIRED');
});

test('server completes interrupted-round recovery before it starts accepting players', async t => {
  let recovered = false;
  const persistence = {
    async recoverInterruptedGames() { recovered = true; },
  };
  const app = await createGameServer({ persistence, autoStart: false });
  t.after(async () => app.close());
  assert.equal(recovered, true);
  await app.listen(0, '127.0.0.1');
});
