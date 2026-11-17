# Kiểm tra tài khoản và phòng online — 17/11/2026

## Dữ liệu ứng dụng

Ứng dụng dùng PostgreSQL nhúng PGlite, lưu tại `be/.data/postgres/`.
Schema có tài khoản, mật khẩu scrypt, phiên đăng nhập, người chơi, phòng,
biên nhận thao tác, lịch sử và ván luyện tập. Migration tự chạy khi khởi động.
Không có dữ liệu mẫu được chèn khi khởi động ứng dụng.

Đã dọn 5 người chơi khách, 5 phiên, 3 phòng và 24 ván luyện tập cũ.
Không có tài khoản đã đăng ký trước khi dọn. Bản sao trước khi dọn:
`be/.data/backups/before-demo-clean-2026-11-17/`.
Không đưa dữ liệu kiểm thử mới vào cơ sở dữ liệu ứng dụng.

## Kiểm tra tích hợp thật

Chạy `npm run test:online` trong `be/`. Script tạo database tạm trên đĩa,
gọi API và WebSocket thật, rồi xóa database tạm sau khi kiểm tra.

- 2 tài khoản, 10 phòng thuộc đủ 10 môn, 79 nước đi, không lỗi.
- Đăng ký, từ chối email trùng, sai mật khẩu, lưu hash scrypt.
- Mời vào phòng, sẵn sàng, kiểm tra nước đi lưu SQL và tới đối thủ.
- Gửi lại cùng thao tác qua HTTP không tạo nước đi trùng.
- Kết nối lại socket khôi phục đầy đủ ván.
- Đóng/mở lại máy chủ và database; đăng nhập trên phiên mới vẫn mở được phòng.
- Đăng xuất thu hồi quyền dùng phiên.

| Phép đo | Trung vị | p95 | Cao nhất |
| --- | ---: | ---: | ---: |
| Xác nhận nước đi sau ghi SQL | 3,52 ms | 5,01 ms | 5,91 ms |
| Đối thủ nhận sự kiện nước đi | 3,49 ms | 5,04 ms | 5,83 ms |

Đo từ client gửi tới nhận ack/sự kiện, chưa gồm thời gian trình duyệt vẽ và animation.
HTTP, client Socket.IO và server đều chạy trên cùng máy; database có lưu đĩa.

## Thử tải

`npm run bench:rooms`: 100 phòng, 240 kết nối, 970 thao tác, không lỗi.
Khoảng 246,2 thao tác/giây; ack p50 240,36 ms, p95 274,53 ms,
p99 280,12 ms. Event-loop lag p95 233,44 ms.
Database PGlite trong RAM, client/server cùng tiến trình, gửi dồn đồng thời.

Ván thông thường có độ trễ thấp trên localhost. Khi dồn 100 phòng,
độ trễ khoảng 0,27 giây ở p95 có thể cảm nhận được. Các kết quả này
chưa đánh giá mạng Internet, PostgreSQL riêng hoặc tốc độ dựng hình 3D.

## Các kiểm tra khác

- Backend: 64/64 test đạt.
- Frontend: 49/49 test đạt, gồm mở đăng ký/đăng nhập từ thanh tài khoản.
- TypeScript và production build đạt.
- `/api/ready` trả `ok: true` sau khi khởi động lại backend.
- Chưa kiểm tra giao diện bằng trình duyệt thật trong lần chạy này;
  công cụ kết nối trình duyệt không khả dụng.
