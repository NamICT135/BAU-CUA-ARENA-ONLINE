import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../server/db/connection.js';
import { AdminService } from '../../server/services/AdminService.js';
import { WalletService } from '../../server/services/WalletService.js';
import { GamePersistenceService } from '../../server/services/GamePersistenceService.js';

const adminService = new AdminService();
const fixtureUsers = new Set();
const fixtureRooms = new Set();
let admin;
let ordinaryUser;

function suffix() {
  return randomUUID().replaceAll('-', '').slice(0, 18);
}

async function createUser({ role = 'player', displayName = 'Admin service test' } = {}) {
  const idPart = suffix();
  const result = await query(
    `INSERT INTO users (username, email, password_hash, display_name, role)
     VALUES ($1, $2, 'test-only-hash', $3, $4)
     RETURNING id, username, email, role, status`,
    [`adm_${idPart}`, `adm_${idPart}@example.com`, displayName, role]
  );
  const user = result.rows[0];
  fixtureUsers.add(user.id);
  await WalletService.createWalletWithWelcomeGrant(user.id, 100_000);
  return user;
}

async function createRoom({ host, member = null, status = 'active' } = {}) {
  const code = `A${suffix().slice(0, 8)}`.toUpperCase();
  const result = await query(
    `INSERT INTO rooms (code, name, host_id, status)
     VALUES ($1, 'Admin integration room', $2, $3)
     RETURNING id, code, status`,
    [code, host.id, status]
  );
  const room = result.rows[0];
  fixtureRooms.add(room.id);
  await query(
    `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'host')`,
    [room.id, host.id]
  );
  if (member) {
    await query(
      `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'player')`,
      [room.id, member.id]
    );
  }
  return room;
}

async function createRound(room, status = 'betting') {
  const result = await query(
    `INSERT INTO rounds (room_id, round_number, status, betting_deadline)
     VALUES ($1, 1, $2, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
     RETURNING id, room_id, status`,
    [room.id, status]
  );
  return result.rows[0];
}

async function placePersistedBet({ user, room, round, amount, symbol = 'cua' }) {
  const requestId = `fixture-bet-${suffix()}`;
  await WalletService.debitBet({
    userId: user.id,
    amount,
    roomId: room.id,
    roundId: round.id,
    requestId,
    reason: 'Admin service fixture bet',
  });
  const result = await query(
    `INSERT INTO bets (round_id, user_id, symbol, amount, request_id, status)
     VALUES ($1, $2, $3, $4, $5, 'placed')
     RETURNING id`,
    [round.id, user.id, symbol, amount, requestId]
  );
  return result.rows[0];
}

async function createSession(user) {
  const result = await query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 day')
     RETURNING id`,
    [user.id, `test-token-${suffix()}`]
  );
  return result.rows[0];
}

async function cleanupFixtures() {
  const roomIds = [...fixtureRooms];
  const userIds = [...fixtureUsers];
  if (roomIds.length > 0) {
    await query('DELETE FROM rooms WHERE id = ANY($1::uuid[])', [roomIds]);
  }
  if (userIds.length > 0) {
    await query(
      `DELETE FROM admin_audit_logs
       WHERE admin_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])`,
      [userIds]
    );
    await query('DELETE FROM processed_commands WHERE user_id = ANY($1::uuid[])', [userIds]);
    await query('DELETE FROM ad_reward_sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await query('DELETE FROM account_tokens WHERE user_id = ANY($1::uuid[])', [userIds]);
    await query('DELETE FROM wallet_transactions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await query('DELETE FROM wallets WHERE user_id = ANY($1::uuid[])', [userIds]);
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }
}

describe('AdminService PostgreSQL integration', { concurrency: false }, () => {
  before(async () => {
    admin = await createUser({ role: 'admin', displayName: 'Integration admin' });
    ordinaryUser = await createUser({ displayName: 'Ordinary caller' });
  });

  after(async () => {
    await cleanupFixtures();
  });

  test('requires a currently active DB admin and exposes only safe user fields', async () => {
    await assert.rejects(
      () => adminService.getOverview({ actorId: ordinaryUser.id }),
      error => error?.code === 'ADMIN_REQUIRED'
    );

    const overview = await adminService.getOverview({ actorId: admin.id });
    assert.ok(overview.users.total >= 2);
    assert.ok(overview.rooms.active >= 0);
    assert.ok(overview.pendingBets.amount >= 0);

    const listed = await adminService.listUsers({
      actorId: admin.id,
      search: ordinaryUser.email,
    });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].id, ordinaryUser.id);
    assert.equal(listed.items[0].wallet.balance, 100_000);
    assert.equal(Object.hasOwn(listed.items[0], 'passwordHash'), false);
    assert.equal(Object.hasOwn(listed.items[0], 'password_hash'), false);

    const detail = await adminService.getUser({ actorId: admin.id, userId: ordinaryUser.id });
    assert.equal(detail.user.email, ordinaryUser.email);
    assert.deepEqual(detail.pendingBets, []);
    assert.equal(Object.hasOwn(detail.user, 'password_hash'), false);
  });

  test('grants through WalletService exactly once and audits the same transaction', async () => {
    const target = await createUser({ displayName: 'Grant target' });
    const requestId = `grant-${suffix()}`;
    const input = {
      actorId: admin.id,
      userId: target.id,
      amount: 25_000,
      requestId,
      reason: 'Integration grant',
    };

    const granted = await adminService.grantCoins(input);
    assert.equal(granted.isDuplicate, false);
    assert.equal(granted.balanceBefore, 100_000);
    assert.equal(granted.balanceAfter, 125_000);

    const replay = await adminService.grantCoins(input);
    assert.equal(replay.isDuplicate, true);
    assert.equal(replay.balanceAfter, 125_000);
    await assert.rejects(adminService.grantCoins({ ...input, amount: 30_000 }), { code: 'REQUEST_ID_CONFLICT' });

    const persisted = await query(
      `SELECT
         (SELECT balance FROM wallets WHERE user_id = $1) AS balance,
         (SELECT COUNT(*)::int FROM wallet_transactions
          WHERE user_id = $1 AND transaction_type = 'ADMIN_GRANT') AS grants,
         (SELECT COUNT(*)::int FROM admin_audit_logs
          WHERE admin_id = $2 AND request_id = $3) AS audits`,
      [target.id, admin.id, requestId]
    );
    assert.equal(Number(persisted.rows[0].balance), 125_000);
    assert.equal(persisted.rows[0].grants, 1);
    assert.equal(persisted.rows[0].audits, 1);

    await assert.rejects(
      () => adminService.banUser({
        actorId: admin.id,
        userId: target.id,
        requestId,
        reason: 'Must not reuse a grant request id',
      }),
      error => error?.code === 'REQUEST_ID_CONFLICT'
    );
  });

  test('ban revokes sessions, refunds betting stakes, removes membership, and can be undone', async () => {
    const host = await createUser({ displayName: 'Ban room host' });
    const target = await createUser({ displayName: 'Ban target' });
    const room = await createRoom({ host, member: target });
    const round = await createRound(room);
    await placePersistedBet({ user: target, room, round, amount: 12_000 });
    const session = await createSession(target);
    const requestId = `ban-${suffix()}`;

    const banned = await adminService.banUser({
      actorId: admin.id,
      userId: target.id,
      requestId,
      reason: 'Integration policy violation',
    });
    assert.equal(banned.status, 'banned');
    assert.equal(banned.revokedSessions, 1);
    assert.equal(banned.membership.refunded, 12_000);
    assert.equal(banned.membership.cancelledBets, 1);

    const replay = await adminService.banUser({
      actorId: admin.id,
      userId: target.id,
      requestId,
      reason: 'Integration policy violation',
    });
    assert.equal(replay.isDuplicate, true);

    const persisted = await query(
      `SELECT usr.status, wallet.balance, member.left_at, bet.status AS bet_status,
              session.revoked_at,
              (SELECT COUNT(*)::int FROM wallet_transactions txn
               WHERE txn.user_id = usr.id AND txn.transaction_type = 'BET_REFUND') AS refunds
       FROM users usr
       JOIN wallets wallet ON wallet.user_id = usr.id
       JOIN room_members member ON member.user_id = usr.id AND member.room_id = $2
       JOIN bets bet ON bet.user_id = usr.id AND bet.round_id = $3
       JOIN auth_sessions session ON session.id = $4
       WHERE usr.id = $1`,
      [target.id, room.id, round.id, session.id]
    );
    assert.equal(persisted.rows[0].status, 'banned');
    assert.equal(Number(persisted.rows[0].balance), 100_000);
    assert.ok(persisted.rows[0].left_at);
    assert.equal(persisted.rows[0].bet_status, 'cancelled');
    assert.ok(persisted.rows[0].revoked_at);
    assert.equal(persisted.rows[0].refunds, 1);

    const unbanned = await adminService.unbanUser({
      actorId: admin.id,
      userId: target.id,
      requestId: `unban-${suffix()}`,
      reason: 'Review completed',
    });
    assert.equal(unbanned.status, 'active');
  });

  test('kick retains locked-phase bets for later settlement', async () => {
    const host = await createUser({ displayName: 'Locked room host' });
    const target = await createUser({ displayName: 'Locked kick target' });
    const room = await createRoom({ host, member: target });
    const round = await createRound(room);
    await placePersistedBet({ user: target, room, round, amount: 10_000, symbol: 'tom' });
    await query("UPDATE rounds SET status = 'revealing' WHERE id = $1", [round.id]);

    const kicked = await adminService.kickMember({
      actorId: admin.id,
      roomId: room.id,
      userId: target.id,
      requestId: `kick-${suffix()}`,
      reason: 'Remove disruptive member',
    });
    assert.equal(kicked.refunded, 0);
    assert.equal(kicked.cancelledBets, 0);
    assert.equal(kicked.roomClosed, false);

    const persisted = await query(
      `SELECT wallet.balance, member.left_at, bet.status
       FROM wallets wallet
       JOIN room_members member ON member.user_id = wallet.user_id AND member.room_id = $2
       JOIN bets bet ON bet.user_id = wallet.user_id AND bet.round_id = $3
       WHERE wallet.user_id = $1`,
      [target.id, room.id, round.id]
    );
    assert.equal(Number(persisted.rows[0].balance), 90_000);
    assert.ok(persisted.rows[0].left_at);
    assert.equal(persisted.rows[0].status, 'placed');
  });

  test('operates a room and atomically schedules or clears the current result', async () => {
    const host = await createUser({ displayName: 'Managed room host' });
    const player = await createUser({ displayName: 'Managed room player' });
    const room = await createRoom({ host, member: player });
    const round = await createRound(room);
    await placePersistedBet({ user: player, room, round, amount: 7_000, symbol: 'bau' });

    const scheduleInput = {
      actorId: admin.id,
      roomId: room.id,
      roundId: round.id,
      dice: ['bau', 'cua', 'nai'],
      requestId: `schedule-${suffix()}`,
      reason: 'Approved research schedule',
    };
    const scheduled = await adminService.scheduleRoundResult(scheduleInput);
    assert.equal(scheduled.resultMode, 'admin_scheduled');
    assert.deepEqual(scheduled.adminOverrideResult, ['bau', 'cua', 'nai']);
    assert.equal((await adminService.scheduleRoundResult(scheduleInput)).isDuplicate, true);

    const cleared = await adminService.clearRoundResult({
      actorId: admin.id,
      roomId: room.id,
      roundId: round.id,
      requestId: `clear-${suffix()}`,
      reason: 'Return this round to random mode',
    });
    assert.equal(cleared.resultMode, 'random');
    assert.equal(cleared.adminOverrideResult, null);

    assert.equal((await adminService.pauseRoom({
      actorId: admin.id,
      roomId: room.id,
      requestId: `pause-${suffix()}`,
      reason: 'Operator inspection',
    })).room.status, 'paused');
    assert.equal((await adminService.resumeRoom({
      actorId: admin.id,
      roomId: room.id,
      requestId: `resume-${suffix()}`,
      reason: 'Inspection complete',
    })).room.status, 'active');

    const rooms = await adminService.listRooms({ actorId: admin.id, search: room.code });
    assert.equal(rooms.total, 1);
    assert.equal(rooms.items[0].currentRound.resultMode, 'random');
    assert.equal(rooms.items[0].memberCount, 2);

    const closed = await adminService.closeRoom({
      actorId: admin.id,
      roomId: room.id,
      requestId: `close-${suffix()}`,
      reason: 'End integration room',
    });
    assert.equal(closed.room.status, 'closed');
    assert.equal(closed.refunded, 7_000);
    assert.equal(closed.cancelledBets, 1);
    assert.equal(closed.cancelledRounds, 1);

    const persisted = await query(
      `SELECT room.status AS room_status, round.status AS round_status,
              bet.status AS bet_status, wallet.balance,
              (SELECT COUNT(*)::int FROM room_members
               WHERE room_id = room.id AND left_at IS NULL) AS active_members
       FROM rooms room
       JOIN rounds round ON round.room_id = room.id
       JOIN bets bet ON bet.round_id = round.id AND bet.user_id = $2
       JOIN wallets wallet ON wallet.user_id = $2
       WHERE room.id = $1`,
      [room.id, player.id]
    );
    assert.equal(persisted.rows[0].room_status, 'closed');
    assert.equal(persisted.rows[0].round_status, 'cancelled');
    assert.equal(persisted.rows[0].bet_status, 'cancelled');
    assert.equal(Number(persisted.rows[0].balance), 100_000);
    assert.equal(persisted.rows[0].active_members, 0);
  });

  test('room locking, duration, pause deadline and round cancellation are durable and replay-safe', async () => {
    const host = await createUser();
    const member = await createUser();
    const room = await createRoom({ host, member });
    const round = await createRound(room);
    const common = { actorId: admin.id, roomId: room.id, reason: 'Room control integration' };
    await adminService.setRoomLock({ ...common, locked: true, requestId: `lock-${suffix()}` });
    await assert.rejects(new GamePersistenceService().joinRoom({ roomId: room.id, userId: ordinaryUser.id }), { code: 'ROOM_LOCKED' });
    await adminService.setBettingDuration({ ...common, durationSeconds: 45, requestId: `duration-${suffix()}` });
    assert.equal((await query('SELECT betting_duration FROM rooms WHERE id=$1', [room.id])).rows[0].betting_duration, 45);
    await adminService.pauseRoom({ ...common, requestId: `pause-${suffix()}` });
    await assert.rejects(new GamePersistenceService().placeBet({ userId: member.id, roomId: room.id, roundId: round.id, symbol: 'cua', amount: 1000, requestId: suffix() }), { code: 'BETTING_CLOSED' });
    const before = (await query('SELECT betting_deadline FROM rounds WHERE id=$1', [round.id])).rows[0].betting_deadline;
    await query("UPDATE rooms SET paused_at=paused_at-INTERVAL '30 seconds' WHERE id=$1", [room.id]);
    await adminService.resumeRoom({ ...common, requestId: `resume-${suffix()}` });
    const deadline = (await query('SELECT betting_deadline FROM rounds WHERE id=$1', [round.id])).rows[0].betting_deadline;
    assert.ok(deadline - before >= 30000);
    await placePersistedBet({ user: member, room, round, amount: 8000 });
    const cancel = { ...common, roundId: round.id, requestId: `cancel-${suffix()}` };
    const result = await adminService.cancelCurrentRound(cancel);
    assert.equal(result.refunded, 8000);
    assert.equal((await adminService.cancelCurrentRound(cancel)).isDuplicate, true);
    assert.equal(Number((await query('SELECT balance FROM wallets WHERE user_id=$1', [member.id])).rows[0].balance), 100000);
    await assert.rejects(adminService.cancelCurrentRound({ ...cancel, requestId: `later-${suffix()}` }), { code: 'ROUND_RESULT_FINAL' });
  });

  test('host kick refunds atomically, retains locked stakes and rejects admin targets', async () => {
    const persistence = new GamePersistenceService();
    const host = await createUser();
    const target = await createUser();
    const room = await createRoom({ host, member: target });
    const round = await createRound(room);
    await placePersistedBet({ user: target, room, round, amount: 5000 });
    const input = { actorId: host.id, roomId: room.id, userId: target.id, roundId: round.id, requestId: suffix() };
    const kicked = await persistence.hostKickMember(input);
    assert.equal(kicked.refunded, 5000);
    assert.equal(kicked.balance, 100000);
    assert.equal(kicked.retainedBets, false);
    assert.equal((await persistence.hostKickMember(input)).isDuplicate, true);
    assert.equal((await query('SELECT id FROM room_members WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL', [room.id, target.id])).rowCount, 0);
    const lockedHost = await createUser();
    const lockedTarget = await createUser();
    const lockedRoom = await createRoom({ host: lockedHost, member: lockedTarget });
    const lockedRound = await createRound(lockedRoom, 'revealing');
    await placePersistedBet({ user: lockedTarget, room: lockedRoom, round: lockedRound, amount: 7000 });
    const retained = await persistence.hostKickMember({ actorId: lockedHost.id, roomId: lockedRoom.id, userId: lockedTarget.id, roundId: lockedRound.id, requestId: suffix() });
    assert.equal(retained.retainedBets, true);
    assert.equal(retained.refunded, 0);
    assert.equal((await query("SELECT id FROM bets WHERE round_id=$1 AND status='placed'", [lockedRound.id])).rowCount, 1);
    await query("INSERT INTO room_members(room_id,user_id,role) VALUES($1,$2,'player')", [lockedRoom.id, admin.id]);
    await assert.rejects(persistence.hostKickMember({ actorId: lockedHost.id, roomId: lockedRoom.id, userId: admin.id, roundId: lockedRound.id, requestId: suffix() }), { code: 'ADMIN_TARGET_FORBIDDEN' });
  });

  test('soft delete revokes sessions without deleting the wallet ledger', async () => {
    const target = await createUser({ displayName: 'Soft delete target' });
    await createSession(target);
    const deleted = await adminService.softDeleteUser({
      actorId: admin.id,
      userId: target.id,
      requestId: `delete-${suffix()}`,
      reason: 'User deletion request',
    });
    assert.equal(deleted.status, 'deleted');
    assert.equal(deleted.revokedSessions, 1);

    const persisted = await query(
      `SELECT usr.status, usr.deleted_at, wallet.balance,
              COUNT(txn.id)::int AS ledger_count,
              COUNT(session.id) FILTER (WHERE session.revoked_at IS NULL)::int AS active_sessions
       FROM users usr
       JOIN wallets wallet ON wallet.user_id = usr.id
       LEFT JOIN wallet_transactions txn ON txn.user_id = usr.id
       LEFT JOIN auth_sessions session ON session.user_id = usr.id
       WHERE usr.id = $1
       GROUP BY usr.id, wallet.id`,
      [target.id]
    );
    assert.equal(persisted.rows[0].status, 'deleted');
    assert.ok(persisted.rows[0].deleted_at);
    assert.equal(Number(persisted.rows[0].balance), 100_000);
    assert.ok(persisted.rows[0].ledger_count >= 1);
    assert.equal(persisted.rows[0].active_sessions, 0);
  });

  test('paginates private audit logs after rechecking the admin in DB', async () => {
    const logs = await adminService.listAuditLogs({
      actorId: admin.id,
      action: 'ADMIN_GRANT',
      limit: 1,
      offset: 0,
    });
    assert.ok(logs.total >= 1);
    assert.equal(logs.items.length, 1);
    assert.equal(logs.items[0].adminId, admin.id);
    assert.equal(logs.items[0].action, 'ADMIN_GRANT');
    assert.ok(logs.items[0].requestId);
  });
});
