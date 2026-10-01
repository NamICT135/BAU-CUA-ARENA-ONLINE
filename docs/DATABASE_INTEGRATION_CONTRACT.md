# Database Integration Contract

This document defines the integration points between the **PostgreSQL Data Layer Task** and the **Game Persistence Integration Task**. It serves as a working contract that allows both tasks to be developed in parallel.

File names and function names may change during implementation, but the inputs, outputs, error codes, and transaction boundaries must be agreed upon before connecting the data layer to `GameService`.

## Responsibility Scope

The **PostgreSQL Data Layer Task** owns:

- Database migrations and schema.
- PostgreSQL connection pool.
- SQL queries and repositories.
- Transaction management.
- Database integration tests.

The **Game Persistence Integration Task** owns:

- Retrieving authenticated user identities.
- Calling data-layer functions from Socket.IO and `GameService`.
- Updating the in-memory state only after the database transaction has been committed.
- Broadcasting `room:state`.
- Writing game–database integration tests.

The Game Persistence Integration Task must not write SQL directly inside `server/game.js`.

The PostgreSQL Data Layer Task must not move game rules or payout calculations into repositories.

## Identity Contract Required from the Login Module

Before integrating user accounts, the team must agree on:

- The data type of `users.id`.
- Whether HTTP retrieves the authenticated identity from `req.user.id` or an equivalent field.
- Whether Socket.IO retrieves the authenticated identity from `socket.data.userId` or an equivalent field.
- When `player_profile` and `wallet` records are created for a new account.
- How logout, account bans, or expired sessions revoke permission to send commands through the socket.

The server must never directly trust a `userId`, role, or balance supplied by the client.

## Proposed Data Interfaces

```js
getPlayerProfile(userId)

getWallet(userId)

placeBet({
  userId,
  roomId,
  roundId,
  symbol,
  amount,
  requestId,
})

clearBets({
  userId,
  roomId,
  roundId,
  requestId,
})

settleRound({
  roomId,
  roundId,
  dice,
})

getPlayerHistory({
  userId,
  limit,
  offset,
})

getPlayerStatistics(userId)
```

The PostgreSQL Data Layer Task must provide the module name, exported function name, input structure, return-data structure, and error codes for each function.

Functions that modify balances must manage their own transactions. The Game Persistence Integration Task must not open a transaction around multiple independent repository calls.

## Minimum Wallet Result

```js
{
  userId: 'uuid',
  balance: 100000,
  updatedAt: '2026-09-25T00:00:00.000Z',
}
```

The balance stored in the database is the authoritative value.

The balance stored in a room is only an in-memory copy used for broadcasting snapshots after the database transaction has been committed successfully.

## Bet Transaction

`placeBet` must validate the balance, deduct the stake, and save the bet within the same transaction.

After the transaction succeeds, the function must return the accepted bets and the updated balance.

```js
{
  roundId: 'uuid',
  acceptedBets: [{ symbol: 'cua', amount: 10000 }],
  balance: 90000,
}
```

The Game Persistence Integration Task must update the in-memory state and send the acknowledgment only after the transaction has been committed.

If the transaction fails, the in-memory state must remain unchanged.

## Settlement Transaction

`settleRound` must save the round result, each player’s result, and all payouts within the same transaction.

The database must prevent the same player from receiving a payout more than once for the same round.

```js
{
  roundId: 'uuid',
  status: 'completed',
  result: ['bau', 'cua', 'tom'],
  players: [
    {
      userId: 'uuid',
      totalBet: 10000,
      payout: 20000,
      balance: 110000,
    },
  ],
}
```

## Proposed Error Codes

- `WALLET_NOT_FOUND`
- `INSUFFICIENT_BALANCE`
- `DUPLICATE_REQUEST`
- `ROUND_NOT_FOUND`
- `ROUND_ALREADY_SETTLED`
- `DATABASE_UNAVAILABLE`

The Game Persistence Integration Task converts these business errors into Socket.IO acknowledgments.

Unknown errors must use `INTERNAL_ERROR`. SQL details and stack traces must never be sent to the client.

## Processing Order

```text
Receive a Socket.IO command
  → authenticate userId and permissions
  → validate the payload and round state
  → execute the database transaction
  → update the in-memory copy
  → broadcast the room state
  → send the acknowledgment
```

The Socket.IO handler must support `GameService.handle()` returning a `Promise`.

This allows database I/O to be added without changing the client acknowledgment protocol.

## Milestone-Based Handover

1. The PostgreSQL Data Layer Task provides the `users.id` contract, schema draft, and proposed interfaces.
2. The Game Persistence Integration Task uses mocks based on those interfaces to prepare integration points and tests.
3. The PostgreSQL Data Layer Task provides migrations, the connection pool, and profile or wallet query functions.
4. The Game Persistence Integration Task connects room creation and room joining to accounts and wallets.
5. The PostgreSQL Data Layer Task provides bet-placement and settlement transactions.
6. The Game Persistence Integration Task connects betting and settlement operations and implements error handling.
7. The PostgreSQL Data Layer Task provides history queries, statistics queries, fixtures, and database tests.
8. Both tasks run integration tests and restart-recovery tests together.

## Game Persistence Integration Task — Implementation Status

The following integration points have been implemented:

- `GameService.handle()` is asynchronous and updates the in-memory state only after persistence operations succeed.
- `createGameServer()` accepts `authenticateSocket(socket)` and passes the trusted identity to `GameService`.
- Persistent resume finds active membership through `socket.data.identity.userId`. RAM tokens are used only in RAM mode.
- `authorizeSocketCommand(socket, event, payload, identity)` allows the login module to revalidate the session, logout state, or ban status for every command after the socket has connected.
- When persistence is enabled, room creation and joining retrieve the display name, avatar, and balance from the account. The client cannot provide a trusted `userId` or balance.
- `GamePersistenceService.placeBet()` saves the bet, deducts the wallet balance, writes the ledger entry, and records the processed command within one transaction.
- `GamePersistenceService.clearBets()` refunds bets and writes the corresponding ledger entries within one transaction.
- `GamePersistenceService.settleRound()` locks the round, reads the accepted bets back from PostgreSQL as the authoritative stake set, locks wallets in user-id order, records per-bet payouts, saves player results, and commits `final_result` within one transaction.
- Legacy Host economy and administration commands are rejected in persistent mode. Kick and Host transfer operations remain available.
- Kicking during betting refunds accepted stakes before membership closes. Kicking during revealing revokes access immediately but preserves accepted bets until payout commits.
- Data APIs use `authenticateHttp(req)` and obtain `userId` only from the server-side identity. These APIs include `/api/me`, `/api/me/wallet`, `/api/me/wallet/transactions`, `/api/me/history`, `/api/me/stats`, room history, and symbol statistics.
- `tests/server/database-game-integration.test.js` verifies authentication requirements, database-before-RAM ordering, and that failed transactions do not broadcast state changes.

Persistent mode is enabled only through `createPersistentGameServer()` and requires
`authenticateSocket`, `authorizeSocketCommand`, and `authenticateHttp`. The default
`server/index.js` entry point remains RAM-only until the login module supplies all three;
there is no fallback that trusts client identity.

The login module must provide a session-authentication adapter that returns:

```js
{
  userId,
  role,
}
```

There must be no fallback that trusts a `userId` supplied by the client.

After the login module provides the session verifier, the entry point can use:

```js
import { createPersistentGameServer } from '../server/persistent.js';

const app = await createPersistentGameServer({
  authenticateSocket: socket =>
    loginService.authenticateSocket(socket),

  authorizeSocketCommand: (socket, event, payload, identity) =>
    loginService.authorizeSocketCommand(
      socket,
      event,
      payload,
      identity,
    ),

  authenticateHttp: req =>
    loginService.authenticateHttp(req),
});
```

## PostgreSQL Data Layer Handover Checklist

The PostgreSQL Data Layer Task must provide:

- The branch, Pull Request, and required commit.
- Migration files and the command used to run migrations.
- An `.env.example` containing variable names only, without real passwords.
- Module exports and function signatures.
- Error codes and transaction guarantees.
- Seed data or fixtures for integration tests.
- The command used to run database tests and the current test results.
- Unresolved decisions concerning wallets, interrupted rounds, and refunds.

## Independently Completed Game Persistence Integration Work

The following items do not depend on the user interface or on how the login module issues sessions:

- Database transactions complete before RAM updates, broadcasts, and acknowledgments.
- Bet placement, bet clearing, settlement, and interrupted-round recovery have clearly defined transaction boundaries.
- Retrying the same `requestId` does not deduct money twice and returns the current balance instead of an outdated balance stored in the original response payload.
- Asynchronous operations within the same room are processed sequentially. Shake and settlement operations cannot overlap with a bet that is still waiting for the database.
- Two concurrent settlement requests update payouts, statistics, and room history only once.
- A bet whose database commit succeeded but whose RAM update/acknowledgment was interrupted is still included when settlement reads the authoritative bet rows.
- The `bets.status` value is stored separately for each winning or losing symbol. All bets are not marked as won merely because the player received a payout.
- Mock integration tests verify database-before-RAM ordering, rollback, recovery, and concurrency.
- Mock integration tests verify account-based resume, settlement after kick, HTTP data APIs that reject client-supplied `userId` values, and socket sessions that can be revoked after connection.
- PostgreSQL integration tests cover the complete flow: create room → place bets → idempotent retry → settle → history/statistics/ledger.
- Kick tests cover both branches: refund-and-remove during betting, and preserve-then-settle during revealing.

## Deferred Items That Depend on Other Team Members

- Enabling persistent mode in `server/index.js`: waiting for the login module to provide `authenticateSocket(socket)` and the logout/session-expiration rules.
- Connecting a real session verifier to `authenticateSocket`, `authorizeSocketCommand`, and `authenticateHttp`. The repository does not currently contain a backend login module.
- Admin grants, rewarded advertisements, audit UI, and additional administration operations.
- Kick semantics now follow the project plan: during betting the player's accepted stakes are refunded atomically before membership closes; during revealing the stake remains for settlement and membership closes afterward.

Before enabling persistent mode by default, the following commands must be run against a clean PostgreSQL test database:

```bash
npm run db:migrate
npm run test:db
npm run test:all
```
