# Database Integration Contract

This document defines the integration points between part the PostgreSQL and data-query layer—and part the database integration layer for the game. It serves as a working contract that allows both parts to be developed in parallel. File names and function names may change when sql is implemented, but the inputs, outputs, and transaction boundaries must be agreed upon before connecting them to `GameService`.

## Responsibility Scope

Part Sql owns migrations, the database schema, connection pool, SQL queries, transactions, and database tests. Part back-end, Socket.IO is responsible for retrieving authenticated identities, calling data-layer functions from Socket.IO and `GameService`, updating RAM only after a transaction has been committed, broadcasting `room:state` and writing integration tests.

Part back-end, Socket.IO must not write SQL directly inside `server/game.js`. Part SQL must not move game rules or payout calculations into repositories.

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
getOrCreateProfile(userId)

getWallet(userId)

placeBet({
  userId,
  roomId,
  roundId,
  bets,
  requestId,
})

settleRound({
  roomId,
  roundId,
  result,
  playerResults,
})

getPlayerHistory({
  userId,
  limit,
  offset,
})

getPlayerStatistics(userId)
```

Phần A cần cung cấp tên module, tên export, cấu trúc input, cấu trúc dữ liệu trả về và danh sách lỗi cho từng hàm. Các hàm thay đổi balance phải tự quản lý transaction; Phần B không tự mở transaction quanh nhiều repository call rời rạc.

## Kết quả tối thiểu của wallet

```js
{
  userId: 'uuid',
  balance: 100000,
  updatedAt: '2026-09-25T00:00:00.000Z',
}
```

Balance từ database là giá trị chính thức. Balance trong room chỉ là bản sao dùng để phát snapshot sau khi database commit thành công.

## Transaction đặt cược

`placeBet` phải kiểm tra balance, trừ tiền và lưu bet trong cùng một transaction. Khi thành công, hàm trả về bet đã chấp nhận và balance mới.

```js
{
  roundId: 'uuid',
  acceptedBets: [{ symbol: 'cua', amount: 10000 }],
  balance: 90000,
}
```

Phần B chỉ cập nhật state trong RAM và gửi acknowledgment sau khi transaction commit. Nếu transaction thất bại, state trong RAM phải giữ nguyên.

## Transaction settlement

`settleRound` phải lưu kết quả round, kết quả từng người chơi và payout trong cùng một transaction. Database cần ngăn cùng một player nhận payout hai lần cho cùng round.

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

## Error codes dự kiến

- `WALLET_NOT_FOUND`
- `INSUFFICIENT_BALANCE`
- `DUPLICATE_REQUEST`
- `ROUND_NOT_FOUND`
- `ROUND_ALREADY_SETTLED`
- `DATABASE_UNAVAILABLE`

Phần B chuyển các lỗi nghiệp vụ này thành Socket.IO acknowledgment. Lỗi không xác định dùng `INTERNAL_ERROR` và không gửi chi tiết SQL hoặc stack trace cho client.

## Quy tắc thứ tự xử lý

```text
Nhận Socket.IO command
  -> xác thực userId và quyền
  -> validate payload và trạng thái round
  -> gọi database transaction
  -> cập nhật bản sao RAM
  -> phát room state
  -> gửi acknowledgment
```

Socket.IO handler phải chấp nhận `GameService.handle()` trả về Promise. Điều này cho phép thêm database I/O sau mà không thay đổi protocol acknowledgment của client.

## Bàn giao theo từng mốc

1. Phần A gửi contract `users.id`, schema draft và interface dự kiến.
2. Phần B dùng mock theo interface để chuẩn bị integration point và tests.
3. Phần A gửi migration, connection pool và các hàm đọc profile hoặc wallet.
4. Phần B nối create hoặc join room với account và wallet.
5. Phần A gửi transaction đặt cược và settlement.
6. Phần B nối bet, settlement và xử lý lỗi.
7. Phần A gửi history, statistics, fixtures và database tests.
8. Hai phần chạy integration test và restart test cùng nhau.

## Trạng thái triển khai Phần B

Đã triển khai các điểm nối sau:

- `GameService.handle()` là async và chỉ cập nhật RAM sau khi persistence trả về thành công.
- `createGameServer()` nhận `authenticateSocket(socket)` và chuyển identity tin cậy vào `GameService`.
- Persistent resume tìm membership đang hoạt động bằng `socket.data.identity.userId`; token RAM chỉ còn dùng cho RAM mode.
- `authorizeSocketCommand(socket, event, payload, identity)` cho phép module login kiểm tra lại session, logout hoặc ban ở từng lệnh sau khi socket đã kết nối.
- Khi bật persistence, create/join lấy display name, avatar và balance từ account; client không được tự gửi `userId` hoặc balance.
- `GamePersistenceService.placeBet()` ghi bet, trừ wallet, ghi ledger và processed command trong một transaction.
- `GamePersistenceService.clearBets()` hoàn cược và ghi ledger trong một transaction.
- `GamePersistenceService.settleRound()` khóa round/wallet, ghi payout, player result và final dice trong một transaction.
- Các lệnh kinh tế/quản trị cũ của Host bị từ chối khi chạy persistent mode; kick và chuyển Host vẫn được giữ.
- Kick thu hồi quyền phòng ngay nhưng giữ người có accepted bet trong settlement; membership chỉ đóng sau khi payout đã commit.
- API đọc dữ liệu nhận `authenticateHttp(req)` và chỉ lấy userId từ identity server: `/api/me`, `/api/me/wallet`, `/api/me/wallet/transactions`, `/api/me/history`, `/api/me/stats`, room history và symbol statistics.
- `tests/database-game-integration.test.js` kiểm tra auth bắt buộc, DB-before-RAM và rollback không broadcast.

Runtime chỉ bật persistent mode khi server được truyền đồng thời `persistence` và `authenticateSocket`. Phần login cần cung cấp adapter xác thực session trả về `{ userId, role }`; không thêm fallback tin `userId` từ client.

Sau khi phần login bàn giao session verifier, entry point có thể dùng:

```js
import { createPersistentGameServer } from '../server/persistent.js';

const app = await createPersistentGameServer({
  authenticateSocket: socket => loginService.authenticateSocket(socket),
  authorizeSocketCommand: (socket, event, payload, identity) =>
    loginService.authorizeSocketCommand(socket, event, payload, identity),
  authenticateHttp: req => loginService.authenticateHttp(req),
});
```

## Checklist khi Phần A bàn giao

- Branch hoặc Pull Request và commit cần dùng.
- Migration files và lệnh chạy migration.
- `.env.example` chỉ chứa tên biến, không chứa mật khẩu thật.
- Module export và chữ ký hàm.
- Error codes và transaction guarantee.
- Seed hoặc fixtures cho integration test.
- Lệnh chạy database tests và kết quả hiện tại.
- Các quyết định chưa chốt về wallet, round dở và refund.

## Phạm vi Phần B độc lập đã hoàn tất

Các hạng mục dưới đây không phụ thuộc giao diện hoặc cách module login phát hành session:

- Database transaction hoàn tất trước khi cập nhật RAM, broadcast và acknowledgment.
- Cược, xóa cược, settlement và khôi phục round dở đều có transaction boundary rõ ràng.
- Retry cùng `requestId` không trừ tiền lần hai và trả về balance hiện tại thay vì balance cũ trong payload đã lưu.
- Các thao tác async trong cùng một room được xử lý tuần tự; shake/settlement không chạy chồng lên một bet đang chờ database.
- Hai yêu cầu settlement đồng thời chỉ cập nhật payout, statistics và room history một lần.
- Trạng thái `bets.status` được ghi theo từng symbol thắng hoặc thua, không đánh dấu toàn bộ bet là thắng chỉ vì người chơi có payout.
- Mock integration tests kiểm tra DB-before-RAM, rollback, recovery và concurrency.
- Mock integration tests kiểm tra resume theo account, kick vẫn settlement, HTTP data API không nhận userId từ client và session socket có thể bị revoke giữa kết nối.
- PostgreSQL integration test kiểm tra trọn luồng create room -> place bets -> idempotent retry -> settle -> history/statistics/ledger.
- Quy tắc kick hiện tại thu hồi quyền truy cập ngay nhưng giữ mọi accepted bet tới settlement, sau đó mới đóng membership.

## Hạng mục tạm hoãn vì phụ thuộc thành viên khác

- Bật persistent mode trong `server.js`: chờ module login cung cấp `authenticateSocket(socket)` và quy tắc logout/session expiry.
- Cắm session verifier thật vào các seam `authenticateSocket`, `authorizeSocketCommand` và `authenticateHttp`; hiện repository chưa có module login backend.
- Admin grant, rewarded ads, audit UI và các thao tác quản trị mở rộng.
- Nhóm cần xác nhận quy tắc kick “giữ cược tới settlement” có đúng sản phẩm cuối cùng hay muốn hoàn cược khi còn ở pha betting.

Trước khi bật persistent mode mặc định, cần chạy trên PostgreSQL test sạch:

```bash
npm run db:migrate
npm run test:db
npm run test:all
```
