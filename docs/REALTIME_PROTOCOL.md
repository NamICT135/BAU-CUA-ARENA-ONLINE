# Bau Cua Arena — Multiplayer protocol

Current design: automatic private rooms, up to 20 players including host, shared dice, virtual coins only. Browser = Vite + vanilla JavaScript. Single authoritative Node HTTP + Socket.IO process serves the built frontend in production. Creating a room opens a 30-second betting round; results stay visible for 5 seconds before the next round. See [automatic room and admin protocol](AUTOMATIC_ROOMS.md) for host commands and timer fields.

## Client commands and acknowledgments

Every Socket.IO command uses an acknowledgment. Success: `{ ok: true, state, session? }`. Failure: `{ ok: false, error: { code, message } }`, messages in Vietnamese. Never put a session token in a broadcast.

- `room:create` `{ name }` — player display name, 2–24 trimmed characters. Creates room and host.
- `room:join` `{ name, code }` — six uppercase alphanumeric room code; fail beyond 20 seats. Unique case-insensitive names per room. Joining during betting/revealing waits until the next round.
- `room:resume` `{ token }` — opaque server-issued bearer token. Restore the same player/balance/bets, replacing an older socket for that identity.
- `room:sync` `{}` — obtain a fresh personalized snapshot and private session for the current membership; recovers a lost create/join acknowledgment without creating another player.
- `room:leave` `{}` — explicit exit; reject while that player has an unsettled nonzero bet. A disconnected player's accepted bet still settles.
- `round:open` `{ requestId, gameId, roundNumber }` — optional host override in waiting/result phase, compare current roundNumber then increment; new server roundId, clear bets, eligible connected players, 30-second server deadline.
- `bet:add` `{ requestId, roundId, symbol, amount }` — eligible player before the betting deadline, positive integer amount, valid symbol, total cannot exceed server balance. Use `allIn: true` instead of amount to stake the server-computed available balance. Paused rooms reject bets.
- `bet:clear` `{ requestId, roundId }` — own bets, betting phase only.
- `round:shake` `{ requestId, roundId }` — optional host override in active betting phase. Lock synchronously, reveal after about 1600ms and settle once. Ordinary rounds use crypto randomInt; a host-selected demo round uses its validated triple and is marked as demo. Empty rounds also settle automatically.
- `room:reset` `{ requestId, gameId, roundNumber }` — host only, waiting/result phase or an empty betting round with no accepted bets; reset every balance/statistic/history, rotate gameId and start round 1. Preserve room lock/pause. UI must confirm this action.

Accepted mutations with requestId are deduplicated for the whole current round. At 1,000 cached requests, further bet edits are rejected until a new round; accepted IDs are never evicted mid-round. Caches clear on new rounds/resets, where old roundId/gameId guards apply. Round IDs and roundNumber reject stale commands. A UUID gameId changes on room reset and is required for open/reset to reject commands from an earlier game. Do not silently replay offline clicks; a timeout should request fresh state rather than add the chip again. Cached mutation acks return current state rather than stale snapshots.

Session returned on create/join/resume: `{ token, playerId, roomCode }`. Store only the session token/room code/display name in per-tab sessionStorage; no balance or game authority in browser storage. Server restart invalidates memory sessions; show a clear join/create prompt. No automatic replay of uncertain join/create commands.

## Personalized `room:state` event / ack state

```
{
  code, gameId, capacity: 20, phase: 'waiting' | 'betting' | 'revealing' | 'result',
  hostId, roundNumber, roundId: string | null, revision,
  players: [{ id, name, balance, connected, betTotal, eligible }],
  boardTotals: { bau, cua, tom, ca, ga, nai },
  dice: [], // three symbol IDs in result; never leak upcoming dice
  history: [{ id, number, dice, createdAt, totalBet, totalReturn,
    results: [{ playerId, name, totalBet, totalReturn, profit, balance }] }],
  you: { id, balance, bets: { bau, cua, tom, ca, ga, nai }, eligible,
    stats: { gamesPlayed, wins, losses, breakEven, highestBalance, totalBet, totalReturned },
    lastResult: null | { playerId, name, totalBet, totalReturn, profit, balance } }
}
```

Snapshots are complete, small and personalized. revision increases on each room mutation; clients ignore older revisions for the same room. Do not broadcast tokens or all players' individual bet selections. Board totals are public. History holds at most 20 rounds. Only players with nonzero bets count as a played game. Profit = totalReturn - totalBet; for a selected symbol appearing k>0 times return = stake*(k+1), otherwise 0. Balance is unchanged while betting, then balance - totalBet + totalReturn at settlement.

## Availability and bounds

- Auto-transfer disconnected host to another connected player after a short grace (about 5 seconds); explicit leaving transfers immediately. Never block round settlement on host presence.
- Disconnected seats reserved about 5 minutes, except unsettled bets must settle before removal. Empty inactive rooms expire. Bound room count, players, history, dedupe cache and event payload/rate. One room membership per socket.
- Replacing a resumed socket must invalidate its authority before disconnecting it; its disconnect event cannot mark the new socket offline. Notify old socket with `session:replaced`.
- `/api/config` preserves config; `/api/state` may preserve compatibility but is not multiplayer authority; `/api/health` exposes only health and aggregate counts. Unknown API routes return JSON 404.
- Production `PORT` defaults 3000, `HOST` defaults 0.0.0.0; serve only dist files, never source/config/session files. Vite proxies `/api` and `/socket.io` including WebSocket. Use same-origin connections; deployment uses one always-on instance with HTTPS/WebSocket support. Memory rooms do not survive process restart; document this clearly.

## Required validation

Deterministic payout cases, 20 simultaneous clients shared round, 21st rejection, host role enforcement, illegal amounts/symbols/over-balance rejection, stale round and duplicate command handling, mid-round join, private token boundaries, resume/disconnect/host transfer, no double settlement, HTTP/proxy/build, mobile/keyboard and browser multi-tab flow.
