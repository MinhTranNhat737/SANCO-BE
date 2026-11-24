# Audit bảo mật và request storm ngày 24 tháng 11 năm 2026

Đối chiếu BE `1f35d6b` trước 20/11 với HEAD ban đầu `4b7c577`: thay đổi đồng hồ Monopoly, không thay tuyến mạng. Báo cáo tổng hợp và số đo FE/BE nằm ở [SANCO-FE NETWORK-AUDIT](https://github.com/MinhTranNhat737/SANCO-FE/blob/main/NETWORK-AUDIT.md).

## Bản sửa backend

- `src/app.js:27`, `src/traffic-guard.js:3`: ngân sách HTTP 1.200 request/IP/phút trước SQL; handshake và socket-auth 120/IP/phút; Socket.IO event 360/user/phút, watch-room 60/user/phút. IP được phân giải theo cấu hình trusted proxy của Express. Giữ hạn mức login/register/actions cũ.
- `src/app.js:53,69`: giới hạn HTTP đồng thời 128 toàn tiến trình, 16/IP; hash mật khẩu tối đa 4 toàn tiến trình và 2/IP, giữ slot tới khi phép tính hoàn tất kể cả client bỏ kết nối. Trả Retry-After khi bị chặn. Giới hạn chỉ trong từng tiến trình; nhiều replica cần chính sách chung tại edge/store.
- `src/app.js:206,231`: Socket.IO trả terminal status 401 cho phiên sai; watch-room kiểm tra phiên còn hiệu lực trước đọc phòng. SQL receipts/version vẫn đảm bảo retry cùng actionId không gửi trùng nước đi.
- `src/traffic-guard.js:9`: map tối đa 20.000 bucket, log guard tối đa một dòng/phút, không ghi IP/ID/cookie/token. Không phát sinh telemetry HTTP.
- `src/oauth.js:27`: deadline 10 giây cho fetch token/profile Google/Facebook, không có vòng retry.
- `package-lock.json`: cập nhật body-parser và qs; bỏ zod không được dùng. `npm audit` toàn dependency sau sửa báo 0 vulnerabilities.

## Xác minh

`npm test`: **147 pass**. `npm run lint`: pass. `npm run test:online`: **16 loại cờ, 127 nước đi, 0 lỗi**, thử lại từng action qua HTTP không tạo thêm nước đi, reconnect và restart khôi phục SQL. `npm run test:engines`: **3 pass**, kiểm tra native Stockfish và Fairy-Stockfish thực. Bộ test mới gửi 1.200 GET health hợp lệ rồi xác nhận GET ready kế tiếp bị 429 trước SQL; xác nhận socket không có phiên trả status 401.

Phép đo đều trên localhost/PGlite tách biệt. Không ghi vào dữ liệu production, không đổi luật, Elo, schema SQL hay bộ máy cờ. Không có log Vercel ngày 20–21/11 hoặc biến VITE_API_URL của deployment cũ nên chưa thể gán 4.861.075 CDN Requests cho lỗi cụ thể. FE đã tái hiện vòng `acceptRoom` bằng code cũ và sửa độc lập; home cả trước/sau đều có 0 HTTP mới trong ít nhất 5 phút.

## Giới hạn và vận hành

Hai repo không có GitHub Actions/cron lịch chạy. Timer cleanup chạy SQL; OAuth gọi nhà cung cấp, không gọi frontend. Docker HEALTHCHECK ngoài repo gọi localhost `/api/ready` mỗi 30 giây, không đi qua CDN. Backend guard không ngăn CDN đếm request HTML/assets đã tới Vercel; bot đánh tài nguyên tĩnh cần chặn tại CDN dựa trên log thực tế.

`src/database.js:14` vẫn dùng `rejectUnauthorized:false` cho PostgreSQL từ xa. Cần CA/chính sách TLS của nhà cung cấp để bật xác minh chứng thư mà không làm đứt DB hiện có; chưa xác minh cấu hình PostgreSQL production. CORS/robots không phải chống bot. Không thực hiện DDoS phân tán hoặc thay thiết lập cloud.

Các file workspace Docker/nginx ngoài `be/` và `fe/` không có remote, không được đưa vào commit hoặc tuyên bố push. Không commit env thật, database, engine binary, dependency hay build output.
