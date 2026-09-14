import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const CAPACITY = 20;
const MUTATIONS = new Set(['round:open', 'bet:add', 'bet:clear', 'round:shake', 'room:reset']);

class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireCondition(condition, code, message) {
  if (!condition) throw new GameError(code, message);
}

export function totalBets(bets) {
  return Object.values(bets).reduce((sum, amount) => sum + amount, 0);
}

// Return includes the original stake when a symbol appears at least once.
export function calculateReturn(bets, dice) {
  return Object.entries(bets).reduce((sum, [symbol, amount]) => {
    const matches = dice.filter(value => value === symbol).length;
    return sum + (matches > 0 ? amount * (matches + 1) : 0);
  }, 0);
}

export class GameService {
  constructor(config, options = {}) {
    this.config = config;
    this.symbolIds = config.symbols.map(symbol => symbol.id);
    this.rooms = new Map();
    this.sessions = new Map();
    this.memberships = new Map();
    this.revealMs = options.revealMs ?? 1600;
    this.hostGraceMs = options.hostGraceMs ?? 5000;
    this.disconnectTtlMs = options.disconnectTtlMs ?? 5 * 60_000;
    this.roomTtlMs = options.roomTtlMs ?? 30 * 60_000;
    this.maxRooms = options.maxRooms ?? 100;
    this.randomIntFn = options.randomIntFn ?? randomInt;
    this.onState = options.onState ?? (() => {});
    this.onReplace = options.onReplace ?? (() => {});
    this.cleanupTimer = setInterval(() => this.cleanup(), options.cleanupIntervalMs ?? 30_000);
    this.cleanupTimer.unref();
  }

  emptyBets() {
    return Object.fromEntries(this.symbolIds.map(id => [id, 0]));
  }

  emptyStats() {
    return {
      gamesPlayed: 0, wins: 0, losses: 0, breakEven: 0,
      highestBalance: this.config.initialBalance, totalBet: 0, totalReturned: 0,
    };
  }

  player(name, socketId) {
    return {
      id: randomUUID(), token: randomBytes(32).toString('base64url'), name,
      socketId, connected: true, disconnectedAt: null,
      balance: this.config.initialBalance, bets: this.emptyBets(), eligible: false,
      stats: this.emptyStats(), lastResult: null, requests: new Map(),
    };
  }

  name(value) {
    requireCondition(typeof value === 'string', 'INVALID_NAME', 'Vui lòng nhập tên người chơi.');
    const name = value.trim().normalize('NFC');
    requireCondition(name.length >= 2 && name.length <= 24 && !/[\p{Cc}\p{Cf}]/u.test(name),
      'INVALID_NAME', 'Tên cần có từ 2 đến 24 ký tự.');
    return name;
  }

  member(socketId) {
    const membership = this.memberships.get(socketId);
    requireCondition(membership, 'NOT_IN_ROOM', 'Bạn chưa tham gia phòng.');
    const room = this.rooms.get(membership.code);
    const player = room?.players.get(membership.playerId);
    requireCondition(player?.socketId === socketId, 'SESSION_EXPIRED', 'Phiên đã hết hạn. Vui lòng vào phòng lại.');
    return { room, player };
  }

  session(room, player) {
    return { token: player.token, playerId: player.id, roomCode: room.code };
  }

  snapshot(room, player) {
    const boardTotals = this.emptyBets();
    for (const entry of room.players.values()) {
      for (const symbol of this.symbolIds) boardTotals[symbol] += entry.bets[symbol];
    }
    return {
      code: room.code, gameId: room.gameId, capacity: CAPACITY, phase: room.phase, hostId: room.hostId,
      roundNumber: room.roundNumber, roundId: room.roundId, revision: room.revision,
      players: [...room.players.values()].map(entry => ({
        id: entry.id, name: entry.name, balance: entry.balance, connected: entry.connected,
        betTotal: totalBets(entry.bets), eligible: entry.eligible,
      })),
      boardTotals, dice: room.phase === 'result' ? [...room.dice] : [],
      history: structuredClone(room.history),
      you: {
        id: player.id, balance: player.balance, bets: { ...player.bets }, eligible: player.eligible,
        stats: { ...player.stats }, lastResult: player.lastResult ? { ...player.lastResult } : null,
      },
    };
  }

  changed(room) {
    room.revision += 1;
    room.updatedAt = Date.now();
    for (const player of room.players.values()) {
      if (player.connected) this.onState(player.socketId, this.snapshot(room, player));
    }
  }

  success(room, player, includeSession = false) {
    return {
      ok: true, state: this.snapshot(room, player),
      ...(includeSession ? { session: this.session(room, player) } : {}),
    };
  }

  handle(socketId, event, payload) {
    try {
      requireCondition(payload && typeof payload === 'object' && !Array.isArray(payload),
        'INVALID_PAYLOAD', 'Dữ liệu gửi lên không hợp lệ.');
      if (event === 'room:create') return this.create(socketId, payload);
      if (event === 'room:join') return this.join(socketId, payload);
      if (event === 'room:resume') return this.resume(socketId, payload);
      const { room, player } = this.member(socketId);
      if (event === 'room:sync') return this.success(room, player, true);
      if (event === 'room:leave') return this.leave(room, player);
      requireCondition(MUTATIONS.has(event), 'UNKNOWN_COMMAND', 'Lệnh không được hỗ trợ.');
      requireCondition(typeof payload.requestId === 'string' && payload.requestId.length > 0 && payload.requestId.length <= 100,
        'INVALID_REQUEST', 'Mã yêu cầu không hợp lệ.');

      const fingerprint = JSON.stringify([event, payload]);
      const previous = player.requests.get(payload.requestId);
      if (previous) {
        requireCondition(previous.fingerprint === fingerprint, 'REQUEST_CONFLICT', 'Mã yêu cầu đã được sử dụng.');
        return this.success(room, player);
      }
      // Keep every accepted bet request in this round; eviction could replay a stake.
      requireCondition(!['bet:add', 'bet:clear'].includes(event) || player.requests.size < 1000,
        'ROUND_ACTION_LIMIT', 'Bạn đã thao tác quá nhiều trong vòng này. Vui lòng chờ vòng tiếp theo.');
      this.mutate(room, player, event, payload);
      player.requests.set(payload.requestId, { fingerprint });
      this.changed(room);
      return this.success(room, player);
    } catch (error) {
      if (!(error instanceof GameError)) console.error('Game command failed:', error);
      return {
        ok: false,
        error: {
          code: error instanceof GameError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof GameError ? error.message : 'Có lỗi xảy ra. Vui lòng đồng bộ phòng rồi thử lại.',
        },
      };
    }
  }

  addPlayer(room, player) {
    room.players.set(player.id, player);
    this.sessions.set(player.token, { code: room.code, playerId: player.id });
    this.memberships.set(player.socketId, { code: room.code, playerId: player.id });
  }

  create(socketId, payload) {
    requireCondition(!this.memberships.has(socketId), 'ALREADY_IN_ROOM', 'Hãy rời phòng hiện tại trước.');
    const name = this.name(payload.name);
    this.cleanup();
    requireCondition(this.rooms.size < this.maxRooms, 'SERVER_FULL', 'Máy chủ đang đầy. Vui lòng thử lại sau.');
    let code;
    do {
      code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
    } while (this.rooms.has(code));
    const player = this.player(name, socketId);
    const room = {
      code, gameId: randomUUID(), hostId: player.id, players: new Map(), phase: 'waiting',
      roundNumber: 0, roundId: null, revision: 0, dice: [], history: [],
      revealTimer: null, hostTimer: null, updatedAt: Date.now(),
    };
    this.rooms.set(code, room);
    this.addPlayer(room, player);
    this.changed(room);
    return this.success(room, player, true);
  }

  join(socketId, payload) {
    requireCondition(!this.memberships.has(socketId), 'ALREADY_IN_ROOM', 'Hãy rời phòng hiện tại trước.');
    requireCondition(typeof payload.code === 'string' && /^[A-Z0-9]{6}$/.test(payload.code),
      'INVALID_CODE', 'Mã phòng gồm 6 chữ cái hoặc chữ số viết hoa.');
    const room = this.rooms.get(payload.code);
    requireCondition(room, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng. Kiểm tra lại mã phòng.');
    const name = this.name(payload.name);
    requireCondition(room.players.size < CAPACITY, 'ROOM_FULL', 'Phòng đã đủ 20 người chơi.');
    requireCondition(![...room.players.values()].some(player => player.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi')),
      'NAME_TAKEN', 'Tên này đã có trong phòng. Vui lòng chọn tên khác.');
    const player = this.player(name, socketId);
    this.addPlayer(room, player);
    this.scheduleHostTransfer(room);
    this.changed(room);
    return this.success(room, player, true);
  }

  resume(socketId, payload) {
    requireCondition(typeof payload.token === 'string' && payload.token.length <= 100,
      'SESSION_EXPIRED', 'Phiên đã hết hạn. Vui lòng tạo hoặc vào phòng lại.');
    const session = this.sessions.get(payload.token);
    const room = session && this.rooms.get(session.code);
    const player = room?.players.get(session.playerId);
    requireCondition(player, 'SESSION_EXPIRED', 'Phiên đã hết hạn. Vui lòng tạo hoặc vào phòng lại.');
    const current = this.memberships.get(socketId);
    requireCondition(!current || (current.code === room.code && current.playerId === player.id),
      'ALREADY_IN_ROOM', 'Hãy rời phòng hiện tại trước.');
    const oldSocketId = player.socketId;
    if (oldSocketId && oldSocketId !== socketId) this.memberships.delete(oldSocketId);
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = null;
    this.memberships.set(socketId, { code: room.code, playerId: player.id });
    if (room.hostId === player.id) {
      clearTimeout(room.hostTimer);
      room.hostTimer = null;
    }
    if (oldSocketId && oldSocketId !== socketId) this.onReplace(oldSocketId);
    this.scheduleHostTransfer(room);
    this.changed(room);
    return this.success(room, player, true);
  }

  hasUnsettledBet(room, player) {
    return ['betting', 'revealing'].includes(room.phase) && totalBets(player.bets) > 0;
  }

  leave(room, player) {
    requireCondition(!this.hasUnsettledBet(room, player), 'UNSETTLED_BET', 'Hãy xóa cược hoặc chờ kết quả trước khi rời phòng.');
    this.removePlayer(room, player);
    if (room.players.size === 0) this.deleteRoom(room);
    else this.changed(room);
    return { ok: true, state: null };
  }

  removePlayer(room, player) {
    this.memberships.delete(player.socketId);
    this.sessions.delete(player.token);
    room.players.delete(player.id);
    if (room.hostId === player.id) {
      clearTimeout(room.hostTimer);
      room.hostTimer = null;
      const players = [...room.players.values()];
      room.hostId = (players.find(entry => entry.connected) ?? players[0])?.id ?? null;
      this.scheduleHostTransfer(room);
    }
  }

  host(room, player) {
    requireCondition(room.hostId === player.id, 'HOST_ONLY', 'Chỉ chủ phòng được thực hiện thao tác này.');
  }

  currentRound(room, payload) {
    requireCondition(typeof payload.roundId === 'string' && payload.roundId === room.roundId,
      'STALE_ROUND', 'Vòng chơi đã thay đổi. Vui lòng đồng bộ phòng.');
  }

  currentNumber(room, payload) {
    requireCondition(payload.gameId === room.gameId && Number.isSafeInteger(payload.roundNumber) && payload.roundNumber === room.roundNumber,
      'STALE_ROUND', 'Vòng chơi đã thay đổi. Vui lòng đồng bộ phòng.');
  }

  mutate(room, player, event, payload) {
    if (event === 'round:open' || event === 'room:reset') {
      this.host(room, player);
      this.currentNumber(room, payload);
      const emptyBettingRound = event === 'room:reset' && room.phase === 'betting' &&
        [...room.players.values()].every(entry => totalBets(entry.bets) === 0);
      requireCondition(['waiting', 'result'].includes(room.phase) || emptyBettingRound,
        'WRONG_PHASE', 'Hãy chờ vòng hiện tại kết thúc hoặc xóa hết cược trước khi đặt lại.');
      if (event === 'room:reset') {
        room.gameId = randomUUID();
        room.phase = 'waiting';
        room.roundNumber = 0;
        room.roundId = null;
        room.history = [];
        room.dice = [];
        for (const entry of room.players.values()) {
          entry.balance = this.config.initialBalance;
          entry.stats = this.emptyStats();
          entry.bets = this.emptyBets();
          entry.lastResult = null;
          entry.eligible = false;
          entry.requests.clear();
        }
      } else {
        room.phase = 'betting';
        room.roundNumber += 1;
        room.roundId = randomUUID();
        room.dice = [];
        for (const entry of room.players.values()) {
          entry.bets = this.emptyBets();
          entry.eligible = entry.connected;
          entry.lastResult = null;
          entry.requests.clear();
        }
      }
      return;
    }

    this.currentRound(room, payload);
    requireCondition(room.phase === 'betting', 'BETTING_CLOSED', 'Hiện tại không thể thay đổi cược.');
    if (event === 'round:shake') {
      this.host(room, player);
      requireCondition([...room.players.values()].some(entry => totalBets(entry.bets) > 0),
        'NO_BETS', 'Cần có ít nhất một lượt cược trước khi lắc.');
      room.phase = 'revealing';
      const roundId = room.roundId;
      room.revealTimer = setTimeout(() => {
        if (this.rooms.get(room.code) !== room || room.roundId !== roundId || room.phase !== 'revealing') return;
        room.revealTimer = null;
        this.settle(room);
        this.changed(room);
      }, this.revealMs);
      room.revealTimer.unref();
      return;
    }

    requireCondition(player.eligible, 'WAIT_NEXT_ROUND', 'Bạn sẽ tham gia đặt cược từ vòng tiếp theo.');
    if (event === 'bet:clear') {
      player.bets = this.emptyBets();
      return;
    }
    requireCondition(typeof payload.symbol === 'string' && this.symbolIds.includes(payload.symbol),
      'INVALID_SYMBOL', 'Biểu tượng cược không hợp lệ.');
    requireCondition(Number.isSafeInteger(payload.amount) && this.config.chips.includes(payload.amount),
      'INVALID_AMOUNT', 'Mệnh giá cược không hợp lệ.');
    requireCondition(totalBets(player.bets) + payload.amount <= player.balance,
      'INSUFFICIENT_BALANCE', 'Số xu còn lại không đủ để đặt cược này.');
    player.bets[payload.symbol] += payload.amount;
  }

  settle(room) {
    if (!['revealing', 'betting'].includes(room.phase)) return;
    const dice = Array.from({ length: 3 }, () => this.symbolIds[this.randomIntFn(this.symbolIds.length)]);
    const results = [];
    for (const player of room.players.values()) {
      const totalBet = totalBets(player.bets);
      if (totalBet === 0) continue;
      const totalReturn = calculateReturn(player.bets, dice);
      const profit = totalReturn - totalBet;
      player.balance += profit;
      player.stats.gamesPlayed += 1;
      player.stats[profit > 0 ? 'wins' : profit < 0 ? 'losses' : 'breakEven'] += 1;
      player.stats.highestBalance = Math.max(player.stats.highestBalance, player.balance);
      player.stats.totalBet += totalBet;
      player.stats.totalReturned += totalReturn;
      player.lastResult = { playerId: player.id, name: player.name, totalBet, totalReturn, profit, balance: player.balance };
      results.push({ ...player.lastResult });
    }
    room.dice = dice;
    room.phase = 'result';
    room.history.unshift({
      id: room.roundId, number: room.roundNumber, dice: [...dice], createdAt: new Date().toISOString(),
      totalBet: results.reduce((sum, result) => sum + result.totalBet, 0),
      totalReturn: results.reduce((sum, result) => sum + result.totalReturn, 0), results,
    });
    room.history = room.history.slice(0, 20);
  }

  disconnect(socketId) {
    const membership = this.memberships.get(socketId);
    if (!membership) return;
    this.memberships.delete(socketId);
    const room = this.rooms.get(membership.code);
    const player = room?.players.get(membership.playerId);
    if (!player || player.socketId !== socketId) return;
    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();
    this.scheduleHostTransfer(room);
    this.changed(room);
  }

  scheduleHostTransfer(room) {
    const host = room.players.get(room.hostId);
    if (!host || host.connected || room.hostTimer) return;
    const remaining = Math.max(0, this.hostGraceMs - (Date.now() - host.disconnectedAt));
    room.hostTimer = setTimeout(() => {
      room.hostTimer = null;
      if (this.rooms.get(room.code) !== room || room.players.get(room.hostId)?.connected) return;
      const replacement = [...room.players.values()].find(player => player.connected);
      if (replacement) {
        room.hostId = replacement.id;
        this.changed(room);
      }
    }, remaining);
    room.hostTimer.unref();
  }

  cleanup() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const hasConnectedPlayer = [...room.players.values()].some(player => player.connected);
      if (!hasConnectedPlayer && now - room.updatedAt >= this.roomTtlMs) {
        // Resolve accepted stakes before expiring an abandoned in-memory room.
        if (['betting', 'revealing'].includes(room.phase)) this.settle(room);
        this.deleteRoom(room);
        continue;
      }
      let removed = false;
      for (const player of room.players.values()) {
        if (!player.connected && now - player.disconnectedAt >= this.disconnectTtlMs && !this.hasUnsettledBet(room, player)) {
          this.removePlayer(room, player);
          removed = true;
        }
      }
      if (room.players.size === 0) this.deleteRoom(room);
      else if (removed) this.changed(room);
    }
  }

  deleteRoom(room) {
    clearTimeout(room.revealTimer);
    clearTimeout(room.hostTimer);
    for (const player of room.players.values()) {
      this.sessions.delete(player.token);
      this.memberships.delete(player.socketId);
    }
    this.rooms.delete(room.code);
  }

  close() {
    clearInterval(this.cleanupTimer);
    for (const room of this.rooms.values()) this.deleteRoom(room);
  }
}
