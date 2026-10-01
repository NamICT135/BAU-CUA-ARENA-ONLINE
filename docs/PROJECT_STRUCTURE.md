# Cấu trúc dự án

## Nơi đặt code

```text
bau-cua-arena/
├── index.html                    # Trang game, entry HTML của Vite
├── admin.html                    # Trang Admin, entry HTML của Vite
├── src/                          # Chỉ chứa code chạy trên trình duyệt
│   ├── main.js                   # Khởi tạo UI và kết nối Socket.IO
│   ├── styles/base.css           # CSS nền tảng dùng chung
│   └── features/
│       ├── game/                 # Bàn chơi, mở bát, lịch sử và CSS
│       ├── hub/                  # Sảnh, phát video và CSS
│       ├── auth/                 # Đăng nhập/đăng ký và CSS
│       ├── account/              # Hồ sơ, ví và CSS
│       └── admin/                # Giao diện quản trị, dialog và CSS
├── server/                       # Chỉ chứa code chạy trên Node.js
│   ├── index.js                  # Điểm khởi động, xử lý dừng server
│   ├── app.js                    # HTTP, Socket.IO, phục vụ bản build
│   ├── game.js                   # Luật chơi và trạng thái phòng
│   ├── persistent.js             # Kết nối game với PostgreSQL
│   ├── production.js             # Xác thực và API Admin
│   ├── media.js                  # Phục vụ video và byte ranges
│   ├── email.js                  # Email xác minh/khôi phục
│   ├── db/                       # Kết nối, transaction, repository nền, audit
│   ├── repositories/             # Truy vấn dữ liệu theo thực thể
│   └── services/                 # Nghiệp vụ ví, game, Auth, Admin và MFA
├── config/game-config.json       # Chip, biểu tượng và số dư ban đầu
├── migrations/                   # SQL theo thứ tự, giữ nguyên lịch sử migration
├── scripts/                      # Dev, migration và lệnh quản trị
├── tests/
│   ├── client/                   # Logic frontend có thể kiểm thử độc lập
│   ├── server/                   # Game, Socket.IO, HTTP và media
│   ├── db/                       # Kết nối và lớp nền PostgreSQL
│   ├── repositories/             # Truy vấn và thanh toán
│   ├── services/                 # Nghiệp vụ, Auth, Admin và khởi động dev
│   └── browser/                  # Kiểm tra trình duyệt thủ công và fixture QA
├── public/assets/                # Ảnh, video và âm thanh được phục vụ công khai
├── videos/                       # Nguồn video gốc và công cụ dựng lại
└── docs/
    ├── ASSET_CREDITS.md           # Nguồn và ghi chú tài nguyên
    └── archive/                  # Prompt thiết kế cũ để tham khảo
```

Các file `package.json`, `package-lock.json`, `vite.config.js`, `Dockerfile`, `render.yaml`, `.env.example` và HTML entry vẫn nằm ở gốc theo cách dùng của npm, Vite và công cụ triển khai. `.env` là cấu hình riêng trên máy; không đưa vào Git hoặc image Docker.

Đặt JS và CSS của một chức năng frontend cùng thư mục trong `src/features/`. Code truy cập PostgreSQL hoặc phụ thuộc Node.js đặt trong `server/`. Không import code backend vào frontend.

## Lệnh chạy

Các lệnh npm giữ nguyên: `npm run dev`, `npm start`, `npm test`, `npm run build`, `npm run db:migrate`, `npm run admin:create`, `npm run admin:mfa-reset`. Điểm khởi động trực tiếp đổi từ `node server.js` thành `node server/index.js`.

`npm test` chạy nhóm client/server và các kiểm thử PostgreSQL. Runner DB vẫn kiểm tra tên database dành cho test trước khi chạy migration và kiểm thử. `tests/browser/config-retry.cjs` là kiểm tra thủ công cần Playwright, Chrome và một ứng dụng đang chạy; nó không nằm trong `npm test`. Fixture quản trị thủ công nằm ở `tests/browser/admin-fixture.js` và vẫn bắt buộc database test.

Docker build cả hai trang HTML và đóng gói `server/`, `config/`, `scripts/`, `migrations/` cùng bản build. Tài liệu, kiểm thử, nguồn video, file tạm và công cụ cục bộ được loại khỏi build context.

## File đã dọn ngày 01/10/2026

Đã xóa các log cũ: `debug.log`, `.tools/vite.err.log`, `.tools/vite.out.log`, cùng các thư mục rỗng sau khi chuyển code. Tổng tài nguyên và log đã dọn khoảng 27 MiB. File build trong `dist/` được Vite tạo lại bằng `npm run build`; `node_modules/` chứa dependency được cài bằng npm.

26 tài nguyên dưới đây không được tham chiếu trong code hoặc tài liệu dự án khi dọn. Đã kiểm tra riêng các đường dẫn tạo động của chip và avatar/biểu tượng PNG để giữ các tài nguyên đó. Các file đã xóa vốn được theo dõi trong Git, nên có thể khôi phục từ lịch sử nếu cần dùng lại.

| Thư mục | File đã xóa |
| --- | --- |
| `public/assets/arena/` | `background-complete.png`, `betting-medallion.png`, `bowl-porcelain.png`, `bowl-porcelain1.png`, `bowl-tray.png` |
| `public/assets/arena/` | `chips-sheet.png`, `dice-3d.png`, `die-ca.png`, `die-ga.png`, `die-nai.png`, `die-nai1.png` |
| `public/assets/arena/` | `logo.png`, `scene.png` |
| `public/assets/arena/` | `mascot-bau.png`, `mascot-ca.png`, `mascot-cua.png`, `mascot-ga.png`, `mascot-nai.png`, `mascot-tom.png` |
| `public/assets/arena/` | `symbol-bau.jpg`, `symbol-ca.jpg`, `symbol-cua.jpg`, `symbol-ga.jpg`, `symbol-nai.jpg`, `symbol-tom.jpg` |
| `public/assets/audio/` | `tet1.mp3` |

Nguồn video có thể chỉnh sửa trong `videos/` và ghi chú nguồn tài nguyên trong `docs/ASSET_CREDITS.md` được giữ lại để tiếp tục phát triển.
