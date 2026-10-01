## Dự án Bầu Cua Arena — Tầng Dữ Liệu PostgreSQL

Tài liệu này bàn giao toàn bộ nền tảng Database, Schema chuẩn hóa và các Service/Repository của **Phần A** để người phụ trách **Phần B (Game Integration)** sử dụng.

---

## 1. Nguyên Tắc Cốt Lõi (Đã Thống Nhất Theo Contract)

- **Xu ảo giải trí:** Toàn bộ `balance` trong ví và giao dịch (`amount`) là tiền xu ảo trong game, không có giá trị quy đổi và tuyệt đối không tích hợp cổng thanh toán.
- **Mỗi User đúng 1 Wallet:** Một tài khoản chỉ có một ví duy nhất (`wallets.user_id` UNIQUE). Đổi phòng hoặc đăng nhập lại không cấp lại ví mới.
- **Mỗi User tối đa 1 Active Room Membership:** Một tài khoản chỉ được tham gia 1 phòng chơi tại một thời điểm (`idx_unique_active_membership` trên `room_members WHERE left_at IS NULL`).
- **Ledger chuẩn & Idempotent:** Mọi thao tác đổi xu phải ghi sổ cái `wallet_transactions` kèm `idempotency_key`, `balance_before`, `balance_after`, và `transaction_type` thuộc danh sách cố định:
  `WELCOME | BET_DEBIT | BET_REFUND | ROUND_PAYOUT | ADMIN_GRANT | AD_REWARD`
- **Không tin Client:** Server quyết định số dư cuối cùng; ACK và Room Broadcast chỉ được gửi **sau khi** Database transaction đã commit thành công.
- **Admin Override:** Tách biệt `admin_override_result` (admin có thể đặt trước khi chốt) khỏi `final_result` (kết quả bất biến khi commit settlement).

---

## 2. Cấu Trúc Bảng CSDL (Schema Reference)

Hệ thống có **13 bảng chính + 1 view + 1 bảng migrations**:

| Tên Bảng / View | Mục Đích | Ràng Buộc Quan Trọng |
|---|---|---|
| `users` | Tài khoản người chơi | email lowercase, username duy nhất không phân biệt hoa/thường, trạng thái và metadata xác minh/ban |
| `wallets` | Ví xu ảo duy nhất của từng user | `user_id` UNIQUE, `0 <= balance <= 1.000.000.000.000`, `version` |
| `wallet_transactions` | Sổ cái lưu lịch sử biến động xu | `idempotency_key NOT NULL`, `user_id + idempotency_key` UNIQUE INDEX, `amount != 0`, `balance_after = balance_before + amount`, `transaction_type CHECK` |
| `player_profiles` *(VIEW)* | Alias kết hợp `users` + `wallets` | Dùng cho Phần B lấy nhanh profile + balance + version |
| `auth_sessions` | Phiên đăng nhập | `token_hash` UNIQUE, `expires_at`, `revoked_at` (soft-revoke), `last_activity_at` |
| `account_tokens` | Token verify / reset password | `type CHECK ('email_verify', 'password_reset')` |
| `rooms` | Phòng chơi | `code` UNIQUE, `mode CHECK ('normal', 'auto')`, `status CHECK ('active', 'paused', 'closed')` |
| `room_members` | Thành viên tham gia phòng | một active room mỗi user và một active host mỗi room |
| `rounds` | Ván cược bầu cua | một ván chưa hoàn tất mỗi room; `final_result`/override phải là mảng ba mặt |
| `bets` | Chi tiết cược xu ảo | `request_id NOT NULL`, `symbol CHECK ('bau','cua','tom','ca','ga','nai')`, `amount > 0`, `payout >= 0`, `status CHECK` |
| `player_round_results` | Tổng kết thắng/thua từng ván của mỗi user | `round_id + user_id` UNIQUE, `net_gain = total_return - total_bet`, `outcome CHECK ('win','loss','draw')` |
| `processed_commands` | Chống trùng lặp lệnh Socket.IO | `command_key` UNIQUE |
| `ad_reward_sessions` | Phiên xem quảng cáo nhận xu ảo | `provider`, `nonce`, `expires_at`, `provider_transaction_id` UNIQUE, `status CHECK ('pending','completed','claimed','rejected','expired')` |
| `admin_audit_logs` | Nhật ký thao tác quản trị | `target_type`, `target_id`, `reason`, `changes JSONB`, `details JSONB`, `ip_address` |
| `schema_migrations` | Quản lý phiên bản migration | `filename` UNIQUE, `checksum` SHA256 |

---

## 3. Hướng Dẫn Cài Đặt & Migration

### Cấu hình môi trường (`.env`)
```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME_DEV=bau_cua_dev
DB_NAME_TEST=bau_cua_test
# Hoặc dùng chuỗi kết nối đơn:
# DATABASE_URL=postgresql://postgres:your_password@localhost:5432/bau_cua_dev
```

### Lệnh Quản Lý CSDL
```bash
# Chạy lần lượt 001 (schema gốc) và 002 (hardening)
npm run db:migrate

# Chạy test không cần PostgreSQL
npm run test:core

# Chạy migration và toàn bộ database tests trên DB_NAME_TEST/TEST_DATABASE_URL
npm run test:db

# Chạy cả core tests và database tests
npm run test:all
```

`test:db` từ chối chạy nếu tên database không chứa `test`, nhằm tránh ghi dữ liệu
fixture vào database development hoặc production. Có thể đặt cấu hình test riêng
trong `.env.test`; file này không được commit.

Không sửa migration đã áp dụng. Mọi thay đổi tiếp theo phải thêm file migration
mới để checksum và quá trình nâng cấp database hiện hữu còn đáng tin cậy.

---

## 4. API & Repositories

### 4.1. `WalletService` (`server/services/WalletService.js`)
Service dùng cho welcome/admin/reward. Luồng game runtime đi qua
`GamePersistenceService`; `BetRepository` và `WalletRepository` cũng ủy quyền cho
các service chuẩn để không còn đường ghi ví/settlement không có ledger hoặc khóa
chống lặp.
```js
import { WalletService } from './server/services/WalletService.js';

// Cấp 100.000 xu chào mừng (chỉ thực hiện đúng 1 lần / user)
await WalletService.createWalletWithWelcomeGrant(userId);

// Trừ xu khi cược (chống trừ 2 lần nếu retry cùng requestId)
await WalletService.debitBet({ userId, amount: 20000, roomId, roundId, requestId });

// Hoàn xu khi huỷ ván
await WalletService.refundBet({ userId, amount: 20000, roomId, roundId, requestId });

// Trả thưởng khi ván có kết quả
await WalletService.payoutRound({ userId, amount: 60000, roomId, roundId });

// Admin cấp xu (BẮT BUỘC có requestId để đảm bảo idempotency)
await WalletService.adminGrant({ userId, amount: 50000, actorId: adminUserId, requestId, reason: 'Event reward' });
```

### 4.2. `ProcessedCommandRepository` (`server/repositories/ProcessedCommandRepository.js`)
Đảm bảo lệnh Socket.IO chỉ chạy đúng một lần:
```js
import { ProcessedCommandRepository } from './server/repositories/ProcessedCommandRepository.js';
const cmdRepo = new ProcessedCommandRepository();

const { isDuplicate, command } = await cmdRepo.recordCommand({
  commandKey: `bet:add:${roundId}:${userId}:${requestId}`,
  roomId,
  userId,
  commandType: 'bet:add',
  resultPayload: { success: true },
});
if (isDuplicate) return command.result_payload;
```

### 4.3. `HistoryRepository` & `StatisticsRepository`
```js
import { HistoryRepository } from './server/repositories/HistoryRepository.js';
import { StatisticsRepository } from './server/repositories/StatisticsRepository.js';

// Lưu kết quả ván cho người chơi sau settlement
const historyRepo = new HistoryRepository();
await historyRepo.recordPlayerRoundResult({ roundId, userId, roomId, totalBet, totalReturn, outcome: 'win' });

// Lấy lịch sử cược cá nhân (phân trang, mới nhất xếp trước)
const history = await historyRepo.getUserRoundHistory(userId, limit, offset);

// Thống kê cá nhân (gamesPlayed, wins, losses, breakEven, totalBet, totalReturned, netProfit)
const userStats = await StatisticsRepository.getUserStatistics(userId);

// Thống kê tần suất mặt xúc xắc từ các ván ĐÃ HOÀN TẤT (dùng cho frontend)
const symbolStats = await StatisticsRepository.getSymbolStatistics(roomId);
```

### 4.4. `AuditLogger` (`server/db/AuditLogger.js`)
```js
import { AuditLogger } from './server/db/AuditLogger.js';

await AuditLogger.logAdminAction({
  adminId,
  action: 'grant_coins',
  targetType: 'user',
  targetId: userId,
  reason: 'Sự kiện',
  changes: { amount: 50000 },
  requestId,
  ipAddress: '127.0.0.1',
}, transactionClient);
```

Khi audit là bắt buộc, truyền cùng transaction client với thao tác admin. Lỗi ghi
audit phải làm transaction thất bại; không được nuốt lỗi và vẫn cấp xu/ban user.

---

## 5. Danh Sách Unit & Integration Tests

- `tests/db/connection.test.js`: Kết nối PostgreSQL & kiểm tra đủ 13 bảng nghiệp vụ.
- `tests/db/repository.test.js`: CRUD chuẩn với Base Repository.
- `tests/db/audit.test.js`: Thao tác ghi nhật ký admin (target_type, reason, changes).
- `tests/db/transactionManager.test.js`: Transaction commit, rollback, deadlock retry.
- `tests/repositories/user.test.js`: Tạo user, tìm kiếm case-insensitive, đổi trạng thái.
- `tests/repositories/wallet.test.js`: Thao tác ví nguyên tử ủy quyền qua WalletService.
- `tests/repositories/history_stats.test.js`: Lịch sử ván, thống kê thắng/thua & tần suất xúc xắc.
- `tests/repositories/integration.test.js`: Chuỗi luồng người chơi gia nhập phòng -> đặt cược -> chốt kết quả.
- `tests/repositories/settlement.test.js`: Atomic round settlement, double-settle prevention.
- `tests/services/walletService.test.js`: Idempotency chào mừng, trừ/hoàn/trả thưởng, adminGrant idempotency.

`npm run test:core` không cần PostgreSQL. Chỉ công bố database tests đã pass sau
khi `npm run test:db` chạy thành công trên database sạch có tên chứa `test`.

---

## 6. Trạng thái tích hợp đến Giai đoạn 3 (01/10/2026)

Auth, ví bền vững và Admin service/API/UI đã được nối vào server mặc định.
Migration hiện tại là `001`–`007`; các bảng phụ trợ auth rate limit và MFA bổ sung
cho 13 bảng nghiệp vụ ban đầu. Test local: 49 core + 56 DB; không skip.
SMTP và rewarded ads thật chưa cấu hình. Hướng dẫn vận hành và các điều kiện
trước phát hành nằm ở [PHASE_3_ADMIN.md](PHASE_3_ADMIN.md).

## 7. Trình tự triển khai đã dùng và bước tiếp theo

1. **Đã làm local:** Cấp một PostgreSQL test riêng, cấu hình `TEST_DATABASE_URL`, chạy
   `npm run db:migrate` và `npm run test:db`. Đây là cổng nghiệm thu cuối của
   phần database; không dùng database development/production để chạy fixture.
2. **Đã nối code/UI, SMTP còn cần cấu hình:** Làm module Auth: đăng ký tạo user + ví + WELCOME trong một transaction,
   session cookie, logout/revoke, đổi/quên mật khẩu, email verification và
   middleware HTTP/Socket.IO.
3. **Đã làm:** `server/index.js` mặc định dùng `createProductionGameServer()` và Auth cung cấp
   đủ `authenticateSocket`, `authorizeSocketCommand` và `authenticateHttp`.
4. **Đã làm local:** Admin service/API/UI; mỗi lệnh cấp xu, ban, điều hành phòng và đặt
   kết quả phải ghi `admin_audit_logs` trong cùng transaction nghiệp vụ.
5. **Chưa làm — Giai đoạn 4:** Chỉ làm rewarded ads sau khi chọn được provider web và cơ chế xác minh;
   callback cấp `AD_REWARD` phải đi qua WalletService và khóa chống lặp.
