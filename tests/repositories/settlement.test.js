import { test, describe } from 'node:test';
import assert from 'node:assert';
import { UserRepository } from '../../server/repositories/UserRepository.js';
import { RoomRepository } from '../../server/repositories/RoomRepository.js';
import { BetRepository } from '../../server/repositories/BetRepository.js';
import { WalletService } from '../../server/services/WalletService.js';
import { query } from '../../server/db/connection.js';

describe('BetRepository.settleBets() & calculateRoundResults() Test Suite', () => {
  const userRepo = new UserRepository();
  const roomRepo = new RoomRepository();
  const betRepo = new BetRepository();

  let host = null;
  let player1 = null;
  let player2 = null;
  let room = null;
  let round = null;

  test('Setup: create users, room and round', async () => {
    const ts = Date.now();
    host = await userRepo.createUser({
      username: 'settle_host_' + ts,
      email: `settle_host_${ts}@example.com`,
      passwordHash: 'hash',
      displayName: 'Host',
    });
    player1 = await userRepo.createUser({
      username: 'settle_p1_' + ts,
      email: `settle_p1_${ts}@example.com`,
      passwordHash: 'hash',
      displayName: 'Player 1',
    });
    player2 = await userRepo.createUser({
      username: 'settle_p2_' + ts,
      email: `settle_p2_${ts}@example.com`,
      passwordHash: 'hash',
      displayName: 'Player 2',
    });
    await WalletService.createWalletWithWelcomeGrant(host.id);
    await WalletService.createWalletWithWelcomeGrant(player1.id);
    await WalletService.createWalletWithWelcomeGrant(player2.id);

    room = await roomRepo.createRoom({
      code: 'T' + Math.floor(1000 + Math.random() * 9000),
      name: 'Settlement Room',
      hostId: host.id,
    });
    await query(`INSERT INTO room_members(room_id,user_id,role) VALUES($1,$2,'player'),($1,$3,'player')`, [room.id, player1.id, player2.id]);

    round = await betRepo.createRound(room.id, 1);
  });

  test('Should place bets for multiple users', async () => {
    // Player 1: cược 10000 vào CUA, 5000 vào BAU
    await betRepo.placeBet({ roundId: round.id, userId: player1.id, symbol: 'cua', amount: 10000, requestId: 'r1' });
    await betRepo.placeBet({ roundId: round.id, userId: player1.id, symbol: 'bau', amount: 5000, requestId: 'r2' });

    // Player 2: cược 20000 vào TOM
    await betRepo.placeBet({ roundId: round.id, userId: player2.id, symbol: 'tom', amount: 20000, requestId: 'r3' });

    const bets = await betRepo.getRoundBets(round.id);
    assert.strictEqual(bets.length, 3);
  });

  test('calculateRoundResults should compute correct payouts (pure calculation, no DB write)', async () => {
    const dice = ['cua', 'cua', 'tom'];
    const results = await betRepo.calculateRoundResults(round.id, dice);

    // Player 1 cược CUA 10000 → 2 matches → return = 10000 × 3 = 30000 (win)
    const cuaBet = results.find(r => r.bet.symbol === 'cua');
    assert.strictEqual(cuaBet.totalReturn, 30000);
    assert.strictEqual(cuaBet.outcome, 'win');

    // Player 1 cược BAU 5000 → 0 matches → return = 0 (loss)
    const bauBet = results.find(r => r.bet.symbol === 'bau');
    assert.strictEqual(bauBet.totalReturn, 0);
    assert.strictEqual(bauBet.outcome, 'loss');

    // Player 2 cược TOM 20000 → 1 match → return = 20000 × 2 = 40000 (win)
    const tomBet = results.find(r => r.bet.symbol === 'tom');
    assert.strictEqual(tomBet.totalReturn, 40000);
    assert.strictEqual(tomBet.outcome, 'win');
  });

  test('settleBets should atomically settle entire round', async () => {
    const dice = ['cua', 'cua', 'tom'];
    const { round: settledRound, playerResults, isDuplicate } = await betRepo.settleBets(round.id, dice);

    assert.strictEqual(isDuplicate, false);
    assert.strictEqual(settledRound.status, 'settled');
    assert.deepStrictEqual(settledRound.dice, dice);

    // Player 1: totalBet=15000, totalReturn=30000 (CUA 30000 + BAU 0), net=+15000 → win
    const p1 = playerResults.find(r => r.user_id === player1.id);
    assert.strictEqual(parseInt(p1.total_bet, 10), 15000);
    assert.strictEqual(parseInt(p1.total_return, 10), 30000);
    assert.strictEqual(parseInt(p1.net_gain, 10), 15000);
    assert.strictEqual(p1.outcome, 'win');

    // Player 2: totalBet=20000, totalReturn=40000, net=+20000 → win
    const p2 = playerResults.find(r => r.user_id === player2.id);
    assert.strictEqual(parseInt(p2.total_bet, 10), 20000);
    assert.strictEqual(parseInt(p2.total_return, 10), 40000);
    assert.strictEqual(parseInt(p2.net_gain, 10), 20000);
    assert.strictEqual(p2.outcome, 'win');

    const wallets = await query(
      'SELECT user_id, balance FROM wallets WHERE user_id = ANY($1::uuid[]) ORDER BY user_id',
      [[player1.id, player2.id]]
    );
    const balances = new Map(wallets.rows.map(wallet => [wallet.user_id, Number(wallet.balance)]));
    assert.strictEqual(balances.get(player1.id), 115000);
    assert.strictEqual(balances.get(player2.id), 120000);
  });

  test('settleBets should prevent double-settlement (idempotent)', async () => {
    const { isDuplicate, playerResults } = await betRepo.settleBets(round.id, ['cua', 'cua', 'tom']);
    assert.strictEqual(isDuplicate, true);
    assert.strictEqual(playerResults.length, 2);
  });
});
