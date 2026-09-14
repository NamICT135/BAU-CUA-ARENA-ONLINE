# Kết quả kiểm thử multiplayer

Ngày kiểm tra: **14/09/2026**. Môi trường Windows, Node.js 24.x, Socket.IO 4.8.3, Vite 8.2.2. Đây là kết quả cục bộ; chưa triển khai Render hay đo trên mạng di động thật.

## Tự động

`npm test`: **9/9 bài kiểm thử đạt**, không bỏ qua bài nào.

| Bài kiểm tra | Kết quả |
| --- | --- |
| Tính trả xu | Đúng với 0, 1, 2, 3 lần xuất hiện; kiểm tra cả cược nhiều biểu tượng. |
| Chống cộng cược lặp | Replay cùng requestId chỉ có một tác dụng, kể cả sau hơn 200 lệnh; hết giới hạn bộ nhớ thì từ chối lệnh mới thay vì xóa ID rồi cộng lại. |
| Lệnh từ phiên cũ | gameId thay đổi khi reset; lệnh mở/đặt lại của phiên trước bị từ chối. |
| Biểu tượng, chip và chốt ván | Sáu biểu tượng × bốn chip; xóa cược riêng; không chốt ván hai lần; không tính ván chưa cược vào thống kê. |
| Ghế mất kết nối | Ghế trống hết hạn được dọn; cược đã nhận vẫn giữ để tính kết quả. |
| 20 người đồng thời | 20 Socket.IO client kết nối thật, gửi cược và cùng nhận kết quả; người thứ 21 nhận ROOM_FULL. Không lộ token trong snapshot. |
| Lệnh sai và quyền hạn | Từ chối amount sai kiểu/âm/lẻ, biểu tượng sai, vượt xu, lệnh ván cũ và người không phải host điều khiển ván. |
| Phòng và phiên | Hai phòng độc lập; vào trễ chờ ván sau; resume giữ danh tính/cược; thay socket không làm người mới bị đánh dấu offline; chuyển host và reset. |
| HTTP | Config/state/health JSON thành công; API không tồn tại trả 404; không phục vụ source, package.json, .env hoặc docs/archive. |

Ở lần chạy cuối, 20 yêu cầu cược đồng thời nhận acknowledgment trong **81ms tổng thời gian trên máy local**. Đây không phải cam kết độ trễ trên Internet, và không đại diện cho bài stress test hàng giờ.

## Trình duyệt

- Hai tab tạo/vào cùng phòng bằng link `?room=...`; hiển thị đúng 2/20 người.
- Chủ phòng mở cược; người chơi thường không có nút điều khiển ván.
- Mỗi tab cược riêng, số cược cả bàn cập nhật trên cả hai. Khi lắc, controls khóa và cả hai nhận cùng bộ ba xúc xắc.
- Một ván thực tế có kết quả Gà/Tôm/Nai: host cược Cua 100 còn 900 xu; khách cược Tôm 100 có 1.100 xu. Cả hai ghi đúng một ván vào lịch sử/thành tích.
- Reload khách giữ đúng tên, phòng và 1.100 xu, không cấp thêm số dư mới.
- Host rời phòng: khách nhận quyền host và có thể mở ván tiếp.
- Enter chọn chip, Space cược biểu tượng; focus được phục hồi sau acknowledgment. Xóa cược đưa tổng về 0.
- Link mời được tạo đúng origin và mã phòng, không chứa token; input readonly có phương án sao chép thủ công.
- Hộp thoại reset mở với focus ở nút hủy; hủy không đổi ván. Reset phía server được kiểm tra tự động.
- Tắt Node thật: controls khóa và thông báo mất kết nối. Khởi động lại: phiên RAM hết hạn được giải thích, giao diện về lobby và cho phép tạo/vào phòng mới.
- Vite tại cổng 5173 phục vụ giao diện và proxy Socket.IO thành công; tạo/mở phòng qua proxy hoạt động.
- Không có warning/error console trong các bước sử dụng bình thường. Các lỗi kết nối trong bước cố tình tắt server là dự kiến.

## Responsive / accessibility

| CSS viewport | Bàn chơi | Tràn ngang |
| --- | --- | --- |
| 1440px | 3 cột | Không |
| 1024px | 3 cột | Không |
| 768px | 3 cột | Không |
| 375px | 2 cột | Không |
| 320px | 2 cột | Không |

Lobby cũng kiểm tra ở 1440/768/375/320px. Ở 320px, ô mã phòng và nút vào phòng xếp dọc để đọc đủ mã. Nút host không vượt chiều rộng màn hình. Giao diện giữ label cho input, button thật, aria-pressed cho chip, status live region, focus bàn phím, tên đi cùng emoji và CSS giảm chuyển động theo tùy chọn hệ thống.

## Build và triển khai

`npm run build`: **đạt**, 34 modules. Bundle JavaScript khoảng 60.19kB, gzip 19.53kB; CSS khoảng 19.33kB, gzip 4.95kB.

Node phục vụ bản dist tại `http://localhost:3000`; Vite dev tại `http://localhost:5173`. Có Dockerfile và cấu hình/hướng dẫn Render, nhưng Docker build chưa chạy do máy không có Docker CLI; chưa có tài khoản Render nên chưa thực hiện deploy Internet.

## Giới hạn còn lại

Chưa đo bằng 20 thiết bị vật lý qua Internet, chưa thực hiện soak test dài hạn hoặc kiểm toán bảo mật độc lập. Phòng/phiên còn nằm trong bộ nhớ một tiến trình. Cần diễn tập trên hosting thật trước buổi thuyết trình.
