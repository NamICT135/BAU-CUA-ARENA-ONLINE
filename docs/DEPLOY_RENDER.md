# Triển khai Render

Chưa tạo dịch vụ và chưa phát sinh chi phí. Bạn cần tài khoản Render và quyền truy cập repository `xthien666/BAU-CUA-ARENA-ONLINE`. Đưa bản mã đã kiểm thử lên nhánh muốn triển khai trước.

## Thiết lập

Trên Render chọn **New → Web Service**, kết nối repository, chọn nhánh. Dùng cấu hình:

| Trường | Giá trị |
| --- | --- |
| Runtime | Node |
| Region | Singapore |
| Build | `npm ci --include=dev && npm run build` |
| Start | `npm start` |
| Health check | `/api/health` |
| NODE_VERSION | `24.20.0` |
| NODE_ENV | `production` |
| HOST | `0.0.0.0` |

Server tự đọc `PORT`. Giữ một instance. Có thể nhập cấu hình từ `render.yaml` bằng Blueprint; kiểm tra lựa chọn gói trước khi tạo.

Sau deploy, dùng URL HTTPS do Render cấp. Dịch vụ này nhận cả HTTP và WebSocket; không cần tạo Static Site riêng. [Tài liệu Web Service](https://render.com/docs/web-services), [WebSocket](https://render.com/docs/websocket).

## Diễn tập trước buổi trình bày

Mở link trên laptop và điện thoại dùng 4G/5G, tạo phòng, vào bằng link mời, cùng cược và xem kết quả. Reload điện thoại để kiểm tra khôi phục. Xác nhận `/api/health` trả JSON thành công.

Gói miễn phí có cơ chế ngủ khi không hoạt động; lần mở sau có thể phải chờ và phòng RAM sẽ mất khi tiến trình restart. Mở thử trước buổi demo; gói luôn chạy phù hợp hơn nếu cần tránh ngủ, nhưng chỉ chọn sau khi tự xem giá. [Giới hạn gói miễn phí](https://render.com/docs/free).

Không deploy/restart giữa buổi chơi. Nếu đổi sang nhiều instance, phải bổ sung kho trạng thái chung và thiết kế đồng bộ trước.
