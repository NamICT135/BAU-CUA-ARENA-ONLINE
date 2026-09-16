# Bàn chơi tự động và quản trị host

- Tạo phòng mở ngay ván 1, nhận cược 30 giây; server khóa cược, lắc và tính xu một lần. Giữ kết quả 5 giây rồi mở ván mới, kể cả ván không có cược.
- Người vào trong giai đoạn cược được tham gia ngay. Người vào lúc lắc đợi ván sau.
- Đồng hồ trình duyệt dựa trên `serverNow` và `deadline`. Máy chủ quyết định hạn cược; chỉnh giờ hoặc sửa giao diện không thể kéo dài ván.
- All-in đặt toàn bộ số dư còn có thể cược vào linh vật vừa chọn. Cược tùy chọn nhận số nguyên dương; máy chủ kiểm tra số dư và giới hạn số học.

## Bảng host

Tạm dừng giữ thời gian và cược. Nếu đang lắc, ván vẫn được chốt rồi dừng trước ván mới. Khóa phòng chỉ chặn người mới, không chặn phiên cũ kết nối lại.

Host có thể cấp 1–1.000.000.000 xu ảo mỗi lần, đuổi người chơi, chuyển quyền cho người online, hủy ván chưa lắc để giải phóng cược, hoặc đặt lại phòng khi không còn cược chưa chốt. Không cấp xu/đuổi người trong lúc đang lắc.

Đuổi thu hồi phiên hiện tại và hủy cược chưa lắc của người đó. Đây không phải cấm vĩnh viễn: không có tài khoản, nên người đó có thể vào lại như người mới nếu phòng chưa khóa.

Host có thể chọn ba linh vật cho **một ván demo** đang mở cược. Ba giá trị đã chọn và nhãn demo trong lịch sử chỉ được gửi riêng cho host; người chơi nhận kết quả khi công bố. Ván kế tiếp trở về ngẫu nhiên. Các thao tác quản trị không bật thông báo cho toàn phòng; người bị đuổi được đưa về sảnh với lý do. Số xu và trạng thái phòng vẫn cập nhật bình thường.

## Giao thức bổ sung

Các lệnh `host:pause`, `host:lock`, `host:grant`, `host:kick`, `host:transfer`, `host:cancel`, `host:result` đều cần `requestId`, `gameId`, `roundNumber`. Máy chủ xác thực host theo phiên Socket.IO, không tin vai trò do client gửi lên.

`host:pause` nhận `paused`; `host:lock` nhận `locked`; `host:grant` nhận `playerId`, `amount`; kick/transfer nhận `playerId`; result nhận `dice` gồm 3 ID hoặc `null` để trả về ngẫu nhiên.

`bet:add` nhận `amount` nguyên dương hoặc `allIn: true`; vẫn cần `roundId`, `symbol`, `requestId`. Lệnh gửi lặp không được tính thêm lần nữa.

## Kiểm tra

Chạy `npm test`, `npm run build`, `npm start`, mở http://localhost:3000. Tạo phòng và quan sát ván tự lắc sau 30 giây. Mở tab khác để kiểm tra người chơi thường không thấy bảng host; thử All-in, cược 37 xu, cấp xu, khóa phòng, tạm dừng, chuyển host, đuổi và kết nối lại.

Phòng và số xu lưu trong RAM; khởi động lại server sẽ xóa phiên. Chạy một instance server cho bản triển khai hiện tại. Không có nạp/rút tiền hoặc đổi thưởng.
