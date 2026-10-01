import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const CAPACITY = 20;
const MUTATIONS = new Set(['round:open', 'bet:add', 'bet:clear', 'round:shake', 'room:reset',
  'host:pause', 'host:lock', 'host:grant', 'host:kick', 'host:transfer', 'host:cancel', 'host:result',
  'host:betting-duration']);
const BETTING_DURATION_SECONDS = new Set([15, 30, 45, 60]);
const MAX_AMOUNT = 1_000_000_000;
const MAX_BALANCE = 1_000_000_000_000;
const PERSISTENCE_ERROR_CODES = new Set([
  'ACCOUNT_DISABLED', 'ALREADY_IN_ROOM', 'AUTH_REQUIRED', 'BETTING_CLOSED', 'DATABASE_CONFLICT',
  'DATABASE_UNAVAILABLE', 'DATABASE_VALUE_OUT_OF_RANGE', 'INSUFFICIENT_BALANCE',
  'ROOM_FULL', 'ROOM_NOT_FOUND', 'ROUND_ALREADY_SETTLED', 'ROUND_NOT_FOUND', 'UNSETTLED_BET', 'WALLET_NOT_FOUND',
]);

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
    this.revealMs = options.revealMs ?? 2400;
    this.autoStart = options.autoStart ?? true;
    this.bettingMs = options.bettingMs ?? 30_000;
    this.resultMs = options.resultMs ?? 12000;
    this.onKick = options.onKick ?? (() => {});
    this.hostGraceMs = options.hostGraceMs ?? 5000;
    this.disconnectTtlMs = options.disconnectTtlMs ?? 5 * 60_000;
    this.roomTtlMs = options.roomTtlMs ?? 30 * 60_000;
    this.maxRooms = options.maxRooms ?? 100;
    this.randomIntFn = options.randomIntFn ?? randomInt;
    this.onState = options.onState ?? (() => {});
    this.onChatMessage = options.onChatMessage ?? (() => {});
    this.onReplace = options.onReplace ?? (() => {});
    this.persistence = options.persistence ?? null;
    this.roomOperations = new WeakMap();
    this.cleanupTimer = setInterval(() => {
      void this.cleanup().catch(error => console.error('Game cleanup failed:', error));
    }, options.cleanupIntervalMs ?? 30_000);
    this.cleanupTimer.unref();
  }

  async withRoomOperation(room, operation) {
    const previous = this.roomOperations.get(room) ?? Promise.resolve();
    let release;
    const turn = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => turn);
    this.roomOperations.set(room, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.roomOperations.get(room) === tail) this.roomOperations.delete(room);
    }
  }

  emptyBets() {
    return Object.fromEntries(this.symbolIds.map(id => [id, 0]));
  }

  emptyStats(highestBalance = this.config.initialBalance) {
    return {
      gamesPlayed: 0, wins: 0, losses: 0, breakEven: 0,
      highestBalance, totalBet: 0, totalReturned: 0,
    };
  }

  player(name, socketId, profile = null) {
    const balance = profile?.balance ?? this.config.initialBalance;
    return {
      id: randomUUID(), token: randomBytes(32).toString('base64url'), name,
      userId: profile?.userId ?? null,
      role: profile?.role ?? 'player',
      avatarKey: profile?.avatarKey ?? 'avatar_default',
      socketId, connected: true, disconnectedAt: null,
      pendingRemoval: false,
      balance, bets: this.emptyBets(), eligible: false,
      stats: profile?.stats ? { ...profile.stats } : this.emptyStats(balance),
      lastResult: null, requests: new Map(),
    };
  }

  async playerFor(name, socketId, identity) {
    if (!this.persistence) return this.player(this.name(name), socketId);
    requireCondition(typeof identity?.userId === 'string' && identity.userId.length > 0,
      'AUTH_REQUIRED', 'Bạn cần đăng nhập trước khi tham gia phòng.');
    const profile = await this.persistence.getPlayerProfile(identity.userId);
    requireCondition(profile?.userId === identity.userId,
      'AUTH_REQUIRED', 'Hồ sơ database không khớp với phiên đăng nhập.');
    return this.player(this.name(profile.displayName), socketId, profile);
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
      serverNow: Date.now(), deadline: room.deadline, paused: room.paused, bettingMs: room.bettingMs,
      locked: room.locked, remainingMs: room.remainingMs,
      ...(!this.persistence && player.id === room.hostId
        ? { admin: { forcedDice: room.forcedDice ? [...room.forcedDice] : null } }
        : {}),
      players: [...room.players.values()].map(entry => ({
        id: entry.id, name: entry.name, avatarKey: entry.avatarKey, connected: entry.connected,
        betTotal: totalBets(entry.bets), eligible: entry.eligible,
        ...(!this.persistence ? { balance: entry.balance } : {}),
      })),
      boardTotals, dice: room.phase === 'result' ? [...room.dice] : [],
      messages: room.messages ? [...room.messages] : [],
      history: structuredClone(room.history).map(round => {
        if (player.id !== room.hostId) delete round.demo;
        if (this.persistence) {
          round.results = round.results.map(({ balance: _privateBalance, ...result }) => result);
        }
        return round;
      }),
      you: {
        id: player.id, avatarKey: player.avatarKey, balance: player.balance, bets: { ...player.bets }, eligible: player.eligible,
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

  async handle(socketId, event, payload, identity = null) {
    try {
      requireCondition(payload && typeof payload === 'object' && !Array.isArray(payload),
        'INVALID_PAYLOAD', 'Dữ liệu gửi lên không hợp lệ.');
      if (event === 'room:create') return await this.create(socketId, payload, identity);
      if (event === 'room:join') return await this.join(socketId, payload, identity);
      if (event === 'room:resume') return await this.resume(socketId, payload, identity);
      const { room } = this.member(socketId);
      return await this.withRoomOperation(room, async () => {
        const activeMembership = this.member(socketId);
        requireCondition(activeMembership.room === room, 'SESSION_EXPIRED', 'Phiên đã hết hạn. Vui lòng vào phòng lại.');
        const player = activeMembership.player;

        // Enforce the deadline even if the event loop has not run its timer yet.
        if (!room.paused && room.deadline && Date.now() >= room.deadline) {
          if (room.phase === 'betting') await this.shake(room);
          else if (room.phase === 'result') await this.openRound(room);
          this.changed(room);
        }
        if (event === 'room:sync') return this.success(room, player, true);
        if (event === 'room:leave') return await this.leave(room, player);
        if (event === 'chat:send') return this.sendChat(room, player, payload);
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
        requireCondition(['room:reset', 'round:open', 'host:cancel'].includes(event) || player.requests.size < 1000,
          'ROUND_ACTION_LIMIT', 'Bạn đã thao tác quá nhiều trong vòng này. Vui lòng chờ vòng tiếp theo.');
        await this.mutate(room, player, event, payload);
        player.requests.set(payload.requestId, { fingerprint });
        this.changed(room);
        return this.success(room, player);
      });
    } catch (error) {
      const expectedPersistenceError = error?.name === 'PersistenceError' && PERSISTENCE_ERROR_CODES.has(error.code);
      if (!(error instanceof GameError) && !expectedPersistenceError) console.error('Game command failed:', error);
      return {
        ok: false,
        error: {
          code: error instanceof GameError || expectedPersistenceError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof GameError || expectedPersistenceError
            ? error.message
            : 'Có lỗi xảy ra. Vui lòng đồng bộ phòng rồi thử lại.',
        },
      };
    }
  }

  addPlayer(room, player) {
    room.players.set(player.id, player);
    this.sessions.set(player.token, { code: room.code, playerId: player.id });
    this.memberships.set(player.socketId, { code: room.code, playerId: player.id });
  }

  async create(socketId, payload, identity) {
    requireCondition(!this.memberships.has(socketId), 'ALREADY_IN_ROOM', 'Hãy rời phòng hiện tại trước.');
    await this.cleanup();
    requireCondition(this.rooms.size < this.maxRooms, 'SERVER_FULL', 'Máy chủ đang đầy. Vui lòng thử lại sau.');
    const player = await this.playerFor(payload.name, socketId, identity);
    const persistenceId = randomUUID();
    let code = null;
    for (let attempt = 0; attempt < 10 && !code; attempt += 1) {
      const candidate = Array.from(
        { length: 6 },
        () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]
      ).join('');
      if (this.rooms.has(candidate)) continue;
      if (this.persistence) {
        try {
          await this.persistence.createRoom({
            roomId: persistenceId,
            code: candidate,
            name: `Phòng ${candidate}`,
            hostUserId: player.userId,
            capacity: CAPACITY,
            bettingDurationSeconds: Math.round(this.bettingMs / 1000),
          });
        } catch (error) {
          if (error?.code === 'ROOM_CODE_CONFLICT') continue;
          throw error;
        }
      }
      code = candidate;
    }
    requireCondition(code, 'ROOM_CODE_EXHAUSTED', 'Không thể cấp mã phòng mới. Vui lòng thử lại.');
    const room = {
      code, gameId: randomUUID(), hostId: player.id, players: new Map(), phase: 'waiting',
      persistenceId,
      roundNumber: 0, roundId: null, revision: 0, dice: [], history: [],
      messages: [],
      revealTimer: null, hostTimer: null, updatedAt: Date.now(),
      phaseTimer: null, deadline: null, remainingMs: null, paused: false, locked: false,
      bettingMs: this.bettingMs,
      forcedDice: null, demoRound: false,
    };
    this.rooms.set(code, room);
    this.addPlayer(room, player);
    try {
      if (this.autoStart) await this.openRound(room);
    } catch (error) {
      this.deleteRoom(room);
      if (this.persistence) await this.persistence.closeRoom({ roomId: persistenceId });
      throw error;
    }
    this.changed(room);
    return this.success(room, player, true);
  }

  async join(socketId, payload, identity) {
    requireCondition(typeof payload.code === 'string' && /^[A-Z0-9]{6}$/.test(payload.code),
      'INVALID_CODE', 'Mã phòng gồm 6 chữ cái hoặc chữ số viết hoa.');
    const room = this.rooms.get(payload.code);
    requireCondition(room, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng. Kiểm tra lại mã phòng.');
    return this.withRoomOperation(room, async () => {
      requireCondition(this.rooms.get(payload.code) === room, 'ROOM_NOT_FOUND', 'Phòng không còn tồn tại.');
      requireCondition(!this.memberships.has(socketId), 'ALREADY_IN_ROOM', 'Hãy rời phòng hiện tại trước.');
      requireCondition(!room.locked, 'ROOM_LOCKED', 'Phòng đang khóa, chưa nhận người chơi mới.');
      requireCondition(room.players.size < CAPACITY, 'ROOM_FULL', 'Phòng đã đủ 20 người chơi.');
      const player = await this.playerFor(payload.name, socketId, identity);
      requireCondition(![...room.players.values()].some(entry => entry.name.toLocaleLowerCase('vi') === player.name.toLocaleLowerCase('vi')),
        'NAME_TAKEN', 'Tên này đã có trong phòng. Vui lòng chọn tên khác.');
      if (this.persistence) {
        requireCondition(![...room.players.values()].some(entry => entry.userId === player.userId),
          'ALREADY_IN_ROOM', 'Tài khoản này đã tham gia phòng. Hãy dùng chức năng kết nối lại.');
        await this.persistence.joinRoom({ roomId: room.persistenceId, userId: player.userId });
      }
      player.eligible = this.autoStart && room.phase === 'betting';
      this.addPlayer(room, player);
      this.scheduleHostTransfer(room);
      this.changed(room);
      return this.success(room, player, true);
    });
  }

  async resume(socketId, payload, identity) {
    let session = null;
    let room = null;
    if (this.persistence) {
      requireCondition(typeof identity?.userId === 'string' && identity.userId.length > 0,
        'AUTH_REQUIRED', 'Bạn cần đăng nhập trước khi kết nối lại.');
      for (const candidate of this.rooms.values()) {
        const player = [...candidate.players.values()].find(entry =>
          entry.userId === identity.userId && !entry.pendingRemoval
        );
        if (player) {
          room = candidate;
          session = { code: candidate.code, playerId: player.id };
          break;
        }
      }
    } else {
      requireCondition(typeof payload.token === 'string' && payload.token.length <= 100,
        'SESSION_EXPIRED', 'Phiên đã hết hạn. Vui lòng tạo hoặc vào phòng lại.');
      session = this.sessions.get(payload.token);
      room = session && this.rooms.get(session.code);
    }
    requireCondition(room, 'SESSION_EXPIRED', 'Phiên đã hết hạn. Vui lòng vào phòng lại.');
    return this.withRoomOperation(room, async () => {
      const activeSession = this.persistence
        ? session
        : this.sessions.get(payload.token);
      const player = activeSession && room.players.get(activeSession.playerId);
      requireCondition(player, 'SESSION_EXPIRED', 'Phiên đã hết hạn. Vui lòng vào phòng lại.');
      if (this.persistence) {
        requireCondition(identity.userId === player.userId && !player.pendingRemoval,
          'AUTH_REQUIRED', 'Phiên đăng nhập không khớp với người chơi trong phòng.');
      }
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
    });
  }

  hasUnsettledBet(room, player) {
    return ['betting', 'revealing'].includes(room.phase) && totalBets(player.bets) > 0;
  }

  async leave(room, player) {
    requireCondition(!this.hasUnsettledBet(room, player), 'UNSETTLED_BET', 'Hãy xóa cược hoặc chờ kết quả trước khi rời phòng.');
    const remainingPlayers = [...room.players.values()].filter(entry => entry !== player);
    const replacement = room.hostId === player.id
      ? remainingPlayers.find(entry => entry.connected && !entry.pendingRemoval) ??
        remainingPlayers.find(entry => !entry.pendingRemoval)
      : null;
    const shouldClose = remainingPlayers.length === 0 || (room.hostId === player.id && !replacement);

    if (this.persistence) {
      if (shouldClose) {
        await this.persistence.closeRoom({
          roomId: room.persistenceId,
          reason: 'Room closed after the last active player left',
        });
      } else {
        await this.persistence.leaveRoom({
          roomId: room.persistenceId,
          userId: player.userId,
          newHostUserId: replacement?.userId ?? null,
        });
      }
    }
    if (shouldClose) {
      this.deleteRoom(room);
      return { ok: true, state: null };
    }
    this.removePlayer(room, player);
    this.changed(room);
    return { ok: true, state: null };
  }

  sendChat(room, player, payload) {
    requireCondition(payload && typeof payload === 'object', 'INVALID_PAYLOAD', 'Dữ liệu gửi lên không hợp lệ.');
    const now = Date.now();
    if (player.lastChatAt && now - player.lastChatAt < 250) {
      throw new GameError('CHAT_RATE_LIMIT', 'Bạn gửi tin nhắn quá nhanh. Vui lòng chờ giây lát.');
    }
    player.lastChatAt = now;

    const rawText = typeof payload.text === 'string' ? payload.text.trim().normalize('NFC') : '';
    const rawEmotion = typeof payload.emotion === 'string' ? payload.emotion.trim() : '';

    requireCondition(rawText.length > 0 || rawEmotion.length > 0, 'INVALID_CHAT', 'Nội dung tin nhắn hoặc biểu cảm không được để trống.');
    requireCondition(rawText.length <= 120, 'INVALID_CHAT', 'Tin nhắn tối đa 120 ký tự.');
    requireCondition(rawEmotion.length <= 30, 'INVALID_CHAT', 'Biểu cảm không hợp lệ.');
    requireCondition(!/[\p{Cc}\p{Cf}]/u.test(rawText.replace(/\r|\n/g, '')), 'INVALID_CHAT', 'Tin nhắn chứa ký tự không hợp lệ.');
    requireCondition(!/[\p{Cc}\p{Cf}]/u.test(rawEmotion), 'INVALID_CHAT', 'Biểu cảm chứa ký tự không hợp lệ.');

    const message = {
      id: randomUUID(),
      senderId: player.id,
      senderName: player.name,
      isHost: player.id === room.hostId,
      text: rawText || null,
      emotion: rawEmotion || null,
      type: rawEmotion && !rawText ? 'emotion' : 'text',
      time: now,
    };

    if (!room.messages) room.messages = [];
    room.messages.push(message);
    if (room.messages.length > 50) room.messages.shift();

    for (const p of room.players.values()) {
      if (p.connected && p.socketId) {
        this.onChatMessage(p.socketId, message);
      }
    }

    return { ok: true, message };
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

  async mutate(room, player, event, payload) {
    if (event.startsWith('host:')) {
      this.host(room, player);
      this.currentNumber(room, payload);
      requireCondition(!this.persistence || event === 'host:kick',
        'ADMIN_ONLY', 'Chức năng này đã được chuyển sang trang quản trị hệ thống.');
      await this.administer(room, player, event, payload);
      return;
    }
    if (event === 'round:open' || event === 'room:reset') {
      this.host(room, player);
      requireCondition(!this.persistence || !this.autoStart || event !== 'round:open', 'ADMIN_ONLY', 'Ván được mở tự động bởi máy chủ.');
      requireCondition(!this.persistence || event !== 'room:reset',
        'ADMIN_ONLY', 'Reset dữ liệu phòng đã được chuyển sang quy trình quản trị có kiểm soát.');
      this.currentNumber(room, payload);
      const emptyBettingRound = event === 'room:reset' && room.phase === 'betting' &&
        [...room.players.values()].every(entry => totalBets(entry.bets) === 0);
      requireCondition(['waiting', 'result'].includes(room.phase) || emptyBettingRound,
        'WRONG_PHASE', 'Hãy chờ vòng hiện tại kết thúc hoặc xóa hết cược trước khi đặt lại.');
      if (event === 'room:reset') {
        this.clearPhaseTimer(room);
        room.forcedDice = null;
        room.demoRound = false;
        room.gameId = randomUUID();
        room.phase = 'waiting';
        if (!this.persistence) room.roundNumber = 0;
        room.roundId = null;
        if (!this.persistence) room.history = [];
        room.dice = [];
        for (const entry of room.players.values()) {
          if (!this.persistence) {
            entry.balance = this.config.initialBalance;
            entry.stats = this.emptyStats();
          }
          entry.bets = this.emptyBets();
          entry.lastResult = null;
          entry.eligible = false;
          entry.requests.clear();
        }
        if (this.autoStart) await this.openRound(room);
      } else {
        await this.openRound(room);
      }
      return;
    }

    this.currentRound(room, payload);
    requireCondition(room.phase === 'betting', 'BETTING_CLOSED', 'Hiện tại không thể thay đổi cược.');
    requireCondition(!room.paused && (!room.deadline || Date.now() < room.deadline),
      'BETTING_CLOSED', 'Đã hết thời gian cược hoặc phòng đang tạm dừng.');
    if (event === 'round:shake') {
      this.host(room, player);
      requireCondition(!this.persistence || !this.autoStart, 'ADMIN_ONLY', 'Máy chủ tự khóa cược và lắc khi hết giờ.');
      await this.shake(room);
      return;
    }

    requireCondition(player.eligible, 'WAIT_NEXT_ROUND', 'Bạn sẽ tham gia đặt cược từ vòng tiếp theo.');
    if (event === 'bet:clear') {
      if (this.persistence) {
        const result = await this.persistence.clearBets({
          userId: player.userId,
          roomId: room.persistenceId,
          roundId: room.roundId,
          requestId: payload.requestId,
        });
        player.balance = result.balance;
      } else {
        player.balance += totalBets(player.bets);
      }
      player.bets = this.emptyBets();
      return;
    }
    requireCondition(typeof payload.symbol === 'string' && this.symbolIds.includes(payload.symbol),
      'INVALID_SYMBOL', 'Biểu tượng cược không hợp lệ.');
    const amount = payload.allIn === true ? player.balance : payload.amount;
    requireCondition(Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_BALANCE,
      'INVALID_AMOUNT', 'Mệnh giá cược không hợp lệ.');
    requireCondition(amount <= player.balance,
      'INSUFFICIENT_BALANCE', 'Số xu còn lại không đủ để đặt cược này.');
    requireCondition(player.balance + 4 * totalBets(player.bets) + 3 * amount <= MAX_BALANCE,
      'BALANCE_LIMIT', 'Cược vượt giới hạn xu an toàn của phòng.');
    if (this.persistence) {
      const result = await this.persistence.placeBet({
        userId: player.userId,
        roomId: room.persistenceId,
        roundId: room.roundId,
        symbol: payload.symbol,
        amount,
        requestId: payload.requestId,
      });
      player.balance = result.balance;
      if (!result.isDuplicate) player.bets[payload.symbol] += amount;
    } else {
      player.balance -= amount;
      player.bets[payload.symbol] += amount;
    }
  }

  async removePendingPlayers(room) {
    for (const player of [...room.players.values()]) {
      if (!player.pendingRemoval) continue;
      if (this.persistence) {
        if (!player.membershipAlreadyRemoved) await this.persistence.leaveRoom({ roomId: room.persistenceId, userId: player.userId });
      }
      this.removePlayer(room, player);
    }
  }

  clearPhaseTimer(room) {
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
    room.deadline = null;
    room.remainingMs = null;
  }

  schedulePhase(room, duration) {
    this.clearPhaseTimer(room);
    room.remainingMs = duration;
    if (room.paused) return;
    room.deadline = Date.now() + duration;
    const roundId = room.roundId;
    const phase = room.phase;
    room.phaseTimer = setTimeout(async () => {
      try {
        await this.withRoomOperation(room, async () => {
          if (this.rooms.get(room.code) !== room || room.roundId !== roundId || room.phase !== phase || room.paused) return;
          if (phase === 'betting') await this.shake(room);
          else if (phase === 'result') await this.openRound(room);
          this.changed(room);
        });
      } catch (error) {
        console.error('Automatic phase transition failed:', error);
      }
    }, duration);
    room.phaseTimer.unref();
  }

  async openRound(room) {
    this.clearPhaseTimer(room);
    const roundNumber = room.roundNumber + 1;
    const roundId = randomUUID();
    if (this.persistence) {
      await this.persistence.createRound({
        roomId: room.persistenceId,
        roundId,
        roundNumber,
        bettingDeadline: this.autoStart && !room.paused
          ? new Date(Date.now() + room.bettingMs)
          : null,
      });
    }
    room.phase = 'betting';
    room.roundNumber = roundNumber;
    room.roundId = roundId;
    room.dice = [];
    room.demoRound = false;
    for (const entry of room.players.values()) {
      entry.bets = this.emptyBets();
      entry.eligible = entry.connected;
      entry.requests.clear();
    }
    if (this.autoStart) this.schedulePhase(room, room.bettingMs);
  }

  async shake(room) {
    if (this.persistence) {
      await this.persistence.markRoundRevealing({
        roomId: room.persistenceId,
        roundId: room.roundId,
      });
    }
    this.clearPhaseTimer(room);
    room.phase = 'revealing';
    const roundId = room.roundId;
    room.revealTimer = setTimeout(async () => {
      if (this.rooms.get(room.code) !== room || room.roundId !== roundId || room.phase !== 'revealing') return;
      room.revealTimer = null;
      try {
        await this.settle(room);
        this.changed(room);
      } catch (error) {
        console.error('Automatic settlement failed:', error);
      }
    }, this.revealMs);
    room.revealTimer.unref();
  }

  async administer(room, host, event, payload) {
    if (event === 'host:lock') {
      requireCondition(typeof payload.locked === 'boolean', 'INVALID_VALUE', 'Trạng thái khóa không hợp lệ.');
      room.locked = payload.locked;
      return;
    }
    if (event === 'host:pause') {
      requireCondition(typeof payload.paused === 'boolean', 'INVALID_VALUE', 'Trạng thái tạm dừng không hợp lệ.');
      if (room.paused === payload.paused) return;
      const remaining = room.deadline ? Math.max(0, room.deadline - Date.now()) : room.remainingMs;
      room.paused = payload.paused;
      const fallbackDuration = room.phase === 'betting' ? room.bettingMs : this.resultMs;
      if (['betting', 'result'].includes(room.phase)) this.schedulePhase(room, remaining ?? fallbackDuration);
      return;
    }
    if (event === 'host:betting-duration') {
      requireCondition(Number.isSafeInteger(payload.durationSeconds) && BETTING_DURATION_SECONDS.has(payload.durationSeconds),
        'INVALID_DURATION', 'Thời gian cược phải là 15, 30, 45 hoặc 60 giây.');
      room.bettingMs = payload.durationSeconds * 1000;
      return;
    }
    if (event === 'host:result') {
      requireCondition(room.phase === 'betting', 'WRONG_PHASE', 'Chỉ chọn kết quả demo khi đang mở cược.');
      requireCondition(payload.dice === null || (Array.isArray(payload.dice) && payload.dice.length === 3 &&
        payload.dice.every(id => this.symbolIds.includes(id))), 'INVALID_DICE', 'Hãy chọn đủ ba linh vật hợp lệ.');
      room.forcedDice = payload.dice ? [...payload.dice] : null;
      return;
    }
    if (event === 'host:cancel') {
      requireCondition(room.phase === 'betting', 'WRONG_PHASE', 'Chỉ hủy được ván chưa lắc.');
      room.forcedDice = null;
      for (const entry of room.players.values()) {
        entry.balance += totalBets(entry.bets);
      }
      await this.removePendingPlayers(room);
      await this.openRound(room);
      return;
    }
    const target = room.players.get(payload.playerId);
    requireCondition(target, 'PLAYER_NOT_FOUND', 'Người chơi đã rời phòng.');
    if (event === 'host:grant') {
      requireCondition(room.phase !== 'revealing', 'WRONG_PHASE', 'Chờ lắc xong để cấp xu.');
      requireCondition(Number.isSafeInteger(payload.amount) && payload.amount > 0 && payload.amount <= MAX_AMOUNT &&
        target.balance + payload.amount + 4 * totalBets(target.bets) <= MAX_BALANCE,
      'INVALID_AMOUNT', 'Số xu cấp phải là số nguyên từ 1 đến 1 tỷ và không vượt giới hạn ví.');
      target.balance += payload.amount;
      target.stats.highestBalance = Math.max(target.stats.highestBalance, target.balance);
    } else if (event === 'host:kick') {
      requireCondition(target.id !== host.id, 'INVALID_TARGET', 'Hãy dùng nút rời phòng để rời bàn.');
      requireCondition(!this.persistence || target.role !== 'admin', 'ADMIN_TARGET_FORBIDDEN', 'Host không được kick quản trị viên hệ thống.');
      const socketId = target.socketId;
      if (this.persistence?.hostKickMember) {
        const result = await this.persistence.hostKickMember({ actorId: host.userId, userId: target.userId,
          roomId: room.persistenceId, roundId: room.roundId, requestId: payload.requestId });
        target.balance = result.balance;
        if (result.retainedBets) {
          this.memberships.delete(socketId); this.sessions.delete(target.token);
          target.connected = false; target.socketId = null; target.disconnectedAt = Date.now();
          target.pendingRemoval = true; target.membershipAlreadyRemoved = true;
        } else { target.bets = this.emptyBets(); this.removePlayer(room, target); }
        if (socketId) this.onKick(socketId);
        return;
      }
      if (room.phase === 'betting' && this.hasUnsettledBet(room, target)) {
        if (this.persistence) {
          const refund = await this.persistence.clearBets({
            userId: target.userId,
            roomId: room.persistenceId,
            roundId: room.roundId,
            requestId: `kick_refund:${payload.requestId}`,
          });
          target.balance = refund.balance;
        } else {
          target.balance += totalBets(target.bets);
        }
        target.bets = this.emptyBets();
      }
      if (this.hasUnsettledBet(room, target)) {
        // Once revealing starts, the accepted stake remains in the round and
        // is settled even though room access is revoked immediately.
        this.memberships.delete(socketId);
        this.sessions.delete(target.token);
        target.connected = false;
        target.socketId = null;
        target.disconnectedAt = Date.now();
        target.pendingRemoval = true;
      } else {
        if (this.persistence) {
          await this.persistence.leaveRoom({ roomId: room.persistenceId, userId: target.userId });
        }
        this.removePlayer(room, target);
      }
      if (socketId) this.onKick(socketId);
    } else if (event === 'host:transfer') {
      requireCondition(target.id !== host.id && target.connected, 'INVALID_TARGET', 'Chọn một người chơi khác đang online.');
      if (this.persistence) {
        await this.persistence.transferHost({
          roomId: room.persistenceId,
          fromUserId: host.userId,
          toUserId: target.userId,
        });
      }
      clearTimeout(room.hostTimer);
      room.hostTimer = null;
      room.hostId = target.id;
    }
  }

  async settle(room) {
    return this.withRoomOperation(room, () => this.settleUnlocked(room));
  }

  async settleUnlocked(room) {
    if (!['revealing', 'betting'].includes(room.phase)) return;
    this.clearPhaseTimer(room);
    const demoRound = Boolean(room.forcedDice);
    const dice = room.forcedDice ?? Array.from({ length: 3 }, () => this.symbolIds[this.randomIntFn(this.symbolIds.length)]);
    const pendingResults = [];
    for (const player of room.players.values()) {
      const totalBet = totalBets(player.bets);
      if (totalBet === 0) continue;
      const totalReturn = calculateReturn(player.bets, dice);
      const profit = totalReturn - totalBet;
      pendingResults.push({ player, userId: player.userId, totalBet, totalReturn, profit });
    }

    let committedDice = dice;
    let resolvedResults = pendingResults;
    if (this.persistence) {
      const settlement = await this.persistence.settleRound({
        roomId: room.persistenceId,
        roundId: room.roundId,
        dice,
        playerResults: pendingResults.map(({ userId, totalBet, totalReturn }) => ({ userId, totalBet, totalReturn })),
      });
      committedDice = settlement.dice ?? dice;
      resolvedResults = settlement.players.map(persisted => {
        const player = [...room.players.values()].find(entry => entry.userId === persisted.userId);
        requireCondition(player, 'DATABASE_CONFLICT', 'Kết quả database chứa người chơi không còn trong vòng.');
        return {
          player,
          userId: persisted.userId,
          totalBet: persisted.totalBet,
          totalReturn: persisted.totalReturn,
          profit: persisted.totalReturn - persisted.totalBet,
          balance: persisted.balance,
        };
      });
    }

    room.demoRound = demoRound;
    room.forcedDice = null;
    const results = [];
    for (const pending of resolvedResults) {
      const { player } = pending;
      let { totalBet, totalReturn, profit } = pending;
      if (this.persistence) {
        player.balance = pending.balance;
      } else {
        player.balance += totalReturn;
      }
      player.stats.gamesPlayed += 1;
      player.stats[profit > 0 ? 'wins' : profit < 0 ? 'losses' : 'breakEven'] += 1;
      player.stats.highestBalance = Math.max(player.stats.highestBalance, player.balance);
      player.stats.totalBet += totalBet;
      player.stats.totalReturned += totalReturn;
      player.lastResult = { playerId: player.id, name: player.name, totalBet, totalReturn, profit, balance: player.balance };
      results.push({ ...player.lastResult });
    }
    room.dice = committedDice;
    room.phase = 'result';
    room.history.unshift({
      id: room.roundId, number: room.roundNumber, dice: [...committedDice], createdAt: new Date().toISOString(),
      demo: room.demoRound,
      totalBet: results.reduce((sum, result) => sum + result.totalBet, 0),
      totalReturn: results.reduce((sum, result) => sum + result.totalReturn, 0), results,
    });
    room.history = room.history.slice(0, 20);
    await this.removePendingPlayers(room);
    if (this.autoStart) this.schedulePhase(room, this.resultMs);
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
    room.hostTimer = setTimeout(async () => {
      room.hostTimer = null;
      try {
        await this.withRoomOperation(room, async () => {
          if (this.rooms.get(room.code) !== room || room.players.get(room.hostId)?.connected) return;
          const replacement = [...room.players.values()].find(player => player.connected);
          if (!replacement) return;
          if (this.persistence) {
            await this.persistence.transferHost({
              roomId: room.persistenceId,
              fromUserId: host.userId,
              toUserId: replacement.userId,
            });
          }
          room.hostId = replacement.id;
          this.changed(room);
        });
      } catch (error) {
        console.error('Automatic host transfer failed:', error);
      }
    }, remaining);
    room.hostTimer.unref();
  }

  async cleanup() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      await this.withRoomOperation(room, async () => {
        if (this.rooms.get(room.code) !== room) return;
        const hasConnectedPlayer = [...room.players.values()].some(player => player.connected);
        const lastDisconnect = Math.max(...[...room.players.values()].map(player => player.disconnectedAt ?? now));
        if (!hasConnectedPlayer && now - lastDisconnect >= this.roomTtlMs) {
          // Resolve accepted stakes before expiring an abandoned in-memory room.
          if (['betting', 'revealing'].includes(room.phase)) await this.settleUnlocked(room);
          if (this.persistence) await this.persistence.closeRoom({ roomId: room.persistenceId });
          this.deleteRoom(room);
          return;
        }
        let removed = false;
        for (const player of [...room.players.values()]) {
          if (!player.connected && now - player.disconnectedAt >= this.disconnectTtlMs && !this.hasUnsettledBet(room, player)) {
            const remainingPlayers = [...room.players.values()].filter(entry => entry !== player);
            const replacement = room.hostId === player.id
              ? remainingPlayers.find(entry => entry.connected && !entry.pendingRemoval) ??
                remainingPlayers.find(entry => !entry.pendingRemoval)
              : null;
            if (room.hostId === player.id && !replacement) {
              if (this.persistence) {
                await this.persistence.closeRoom({
                  roomId: room.persistenceId,
                  reason: 'Room closed after all reusable sessions expired',
                });
              }
              this.deleteRoom(room);
              return;
            }
            if (this.persistence) {
              await this.persistence.leaveRoom({
                roomId: room.persistenceId,
                userId: player.userId,
                newHostUserId: replacement?.userId ?? null,
              });
            }
            this.removePlayer(room, player);
            removed = true;
          }
        }
        if (room.players.size === 0) {
          if (this.persistence) await this.persistence.closeRoom({ roomId: room.persistenceId });
          this.deleteRoom(room);
        } else if (removed) {
          this.changed(room);
        }
      });
    }
  }

  deleteRoom(room) {
    this.clearPhaseTimer(room);
    clearTimeout(room.revealTimer);
    clearTimeout(room.hostTimer);
    for (const player of room.players.values()) {
      this.sessions.delete(player.token);
      this.memberships.delete(player.socketId);
    }
    this.rooms.delete(room.code);
  }

  /**
   * Reconcile an already-committed administrative database action with the
   * in-memory timers/sockets. PostgreSQL remains authoritative; these helpers
   * never write persistence themselves.
   */
  applyAdminRoomStatus(roomId, status) {
    const room = [...this.rooms.values()].find(entry => entry.persistenceId === roomId);
    if (!room) return false;
    if (status === 'closed') {
      for (const player of room.players.values()) {
        if (player.socketId) this.onKick(player.socketId);
      }
      this.deleteRoom(room);
      return true;
    }
    const paused = status === 'paused';
    if (room.paused !== paused) {
      const remaining = room.deadline ? Math.max(0, room.deadline - Date.now()) : room.remainingMs;
      room.paused = paused;
      const fallback = room.phase === 'betting' ? room.bettingMs : this.resultMs;
      if (['betting', 'result'].includes(room.phase)) this.schedulePhase(room, remaining ?? fallback);
      this.changed(room);
    }
    return true;
  }

  applyAdminUserRemoval(userId, roomId = null, removal = null) {
    for (const room of this.rooms.values()) {
      if (roomId && room.persistenceId !== roomId) continue;
      const player = [...room.players.values()].find(entry => entry.userId === userId);
      if (!player) continue;
      if (removal?.roomClosed) {
        this.applyAdminRoomStatus(room.persistenceId, 'closed');
        return true;
      }
      const socketId = player.socketId;
      if (totalBets(player.bets) > 0 && (room.phase === 'revealing' || (room.phase === 'betting' && removal?.refunded === 0))) {
        this.memberships.delete(socketId);
        this.sessions.delete(player.token);
        player.connected = false;
        player.socketId = null;
        player.disconnectedAt = Date.now();
        player.pendingRemoval = true;
        player.membershipAlreadyRemoved = true;
      } else {
        player.bets = this.emptyBets();
        this.removePlayer(room, player);
      }
      if (removal?.newHostId) room.hostId = [...room.players.values()].find(entry => entry.userId === removal.newHostId)?.id ?? room.hostId;
      if (socketId) this.onKick(socketId);
      if (room.players.size === 0) this.deleteRoom(room);
      else this.changed(room);
      return true;
    }
    return false;
  }

  applyAdminRoundOverride(roundId, dice) {
    const room = [...this.rooms.values()].find(entry => entry.roundId === roundId);
    if (!room) return false;
    room.forcedDice = Array.isArray(dice) ? [...dice] : null;
    this.changed(room);
    return true;
  }

  applyAdminRoomLock(roomId, locked) {
    const room = [...this.rooms.values()].find(entry => entry.persistenceId === roomId);
    if (!room) return false;
    room.locked = Boolean(locked);
    this.changed(room);
    return true;
  }

  applyAdminBettingDuration(roomId, durationSeconds) {
    const room = [...this.rooms.values()].find(entry => entry.persistenceId === roomId);
    if (!room) return false;
    room.bettingMs = durationSeconds * 1000;
    this.changed(room);
    return true;
  }

  async applyAdminRoundCancellation(roundId) {
    const room = [...this.rooms.values()].find(entry => entry.roundId === roundId);
    if (!room) return false;
    {
      this.clearPhaseTimer(room);
      clearTimeout(room.revealTimer);
      room.revealTimer = null;
      room.forcedDice = null;
      room.dice = [];
      for (const player of room.players.values()) {
        player.bets = this.emptyBets();
        player.lastResult = null;
        player.requests.clear();
        if (this.persistence) {
          if (player.pendingRemoval) continue;
          const profile = await this.persistence.getPlayerProfile(player.userId);
          player.balance = profile.balance;
        }
      }
      room.phase = 'waiting';
      await this.removePendingPlayers(room);
      room.roundId = null;
      if (this.autoStart && !room.paused) await this.openRound(room);
      this.changed(room);
      return true;
    }
  }

  async refreshPlayerProfile(userId) {
    if (!this.persistence) return;
    for (const room of this.rooms.values()) {
      const player = [...room.players.values()].find(entry => entry.userId === userId);
      if (!player || player.pendingRemoval) continue;
      const profile = await this.persistence.getPlayerProfile(userId);
      player.balance = profile.balance;
      player.name = profile.displayName;
      player.avatarKey = profile.avatarKey;
      this.changed(room);
    }
  }

  close() {
    clearInterval(this.cleanupTimer);
    for (const room of this.rooms.values()) this.deleteRoom(room);
  }
}
