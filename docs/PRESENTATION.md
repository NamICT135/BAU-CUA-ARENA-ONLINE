# Kịch bản thuyết trình — 7 phút

Mục tiêu: cho thấy một sản phẩm chơi được cùng nhóm, đồng bộ và có xử lý lỗi. Không cần liệt kê tất cả công nghệ hoặc đọc mã dài.

| Thời gian | Nội dung trình bày | Thao tác |
| --- | --- | --- |
| 0:00–0:40 | “Em đưa trò bầu cua quen thuộc lên web để bạn bè chơi cùng một phòng trên điện thoại và laptop. Mọi điểm số đều là xu ảo.” | Mở trang chủ. |
| 0:40–1:30 | Tạo phòng và mời người chơi. Chủ phòng điều khiển ván; tối đa 20 người. | Tạo phòng trên laptop, mở link trên điện thoại. |
| 1:30–2:50 | Cược được cập nhật theo thời gian thực. Mọi người xem chung xúc xắc nhưng nhận số xu theo cược riêng. | Mở cược; hai thiết bị chọn khác nhau; lắc; xem kết quả và bảng xếp hạng. |
| 2:50–3:40 | Server là nơi quyết định số xu và kết quả, không tin số dư do trình duyệt gửi. | Thử cược vượt số xu; chỉ ra thông báo từ server. |
| 3:40–4:40 | Luồng: người chơi gửi lệnh → server kiểm tra → cập nhật phòng → phát trạng thái cho mọi người. | Giải thích sơ đồ trong README hoặc giao thức phòng. |
| 4:40–5:30 | Mạng có thể chập chờn. Token phiên khôi phục đúng người; requestId tránh xử lý cược hai lần; roundId tránh cược nhầm ván. | Reload điện thoại trong cùng tab, xem tên và xu được giữ. |
| 5:30–6:30 | Kiểm thử 20 kết nối đồng thời; thêm kiểm tra người thứ 21, quyền chủ phòng, cược sai và tính thưởng. | Cho xem kết quả `npm test` đã chạy trước đó. |
| 6:30–7:00 | Giới hạn và bước tiếp: dữ liệu hiện ở RAM, một instance; phát triển tiếp có thể thêm lưu trữ và giám sát. | Kết thúc bằng giao diện phòng thật. |

## Nếu chỉ có 5 phút

Giữ demo hai thiết bị và sơ đồ server. Gộp kiểm thử/lỗi mạng vào một phút, không mở mã nguồn trực tiếp.

## Nếu có 10 phút

Mời thêm vài người trong lớp tham gia. Giải thích một tình huống cược 50 vào Cua: không ra → nhận 0; ra 2 lần → nhận 150, lãi 100. Giải thích tại sao host không được gửi kết quả xúc xắc tùy ý.

## Câu hỏi thường gặp

**Tại sao Socket.IO?** Cần giao tiếp hai chiều và cập nhật liên tục theo từng phòng, cùng cơ chế kết nối lại. Ứng dụng vẫn tự quản lý phiên, chống lặp và đồng bộ toàn bộ trạng thái; thư viện không thay thế các quy tắc này. [Rooms](https://socket.io/docs/v4/rooms/), [Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/).

**Tại sao chưa dùng database?** Dữ liệu được giới hạn trong buổi chơi để giữ triển khai gọn. Đổi lại, restart server sẽ mất phòng; muốn lưu lâu dài cần bổ sung lưu trữ và phục hồi giao dịch.

**Có chống gian lận không?** Server kiểm tra danh tính phiên, quyền host, mệnh giá, số dư, ván hiện tại và lệnh lặp. Xúc xắc được sinh trên server bằng crypto. Đây chưa phải sản phẩm có kiểm toán an ninh độc lập.

**Chứng minh hỗ trợ 20 người như thế nào?** Bài kiểm thử tạo 20 socket client thật, cùng gửi cược và so sánh kết quả/số dư. Đây là kiểm thử cục bộ; trước khi thuyết trình vẫn cần diễn tập qua Internet.

**Có chơi tiền thật không?** Không. Không có nạp, rút, quy đổi hoặc giải thưởng tiền tệ.

## Chuẩn bị trước giờ trình bày

- Deploy bản đã kiểm thử; thử Wi-Fi và mạng di động.
- Chuẩn bị laptop, một điện thoại, link mời; bật chế độ không làm phiền.
- Tạo phòng mới, không để tên người chơi thử hoặc lịch sử cũ gây nhầm lẫn.
- Lưu sẵn ảnh kết quả test và một đoạn quay demo dự phòng nếu mạng lớp yếu.
- Không cập nhật/restart server giữa buổi demo.
