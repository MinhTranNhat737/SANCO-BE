# Quản trị Sân Cờ

Dashboard nằm tại `/admin` trên frontend. API nằm tại `/api/admin/*` trên backend, dùng cùng cookie đăng nhập của website. Tài khoản thường và khách không được đọc hoặc sửa dữ liệu quản trị.

## Cấp admin đầu tiên

1. Triển khai cả backend và frontend đã cập nhật. Backend tự chạy migration `012_admin.sql` khi khởi động.
2. Đăng ký hoặc đăng nhập tài khoản của chủ website bằng email hoặc Google.
3. Trên máy chủ backend, dùng đúng môi trường/database của website và chạy:

   ```sh
   npm run admin:grant -- owner@example.com
   ```

4. Thay `owner@example.com` bằng email tài khoản đã đăng ký. Tải lại website và mở `/admin`. Liên kết **Quản trị website** cũng xuất hiện ở thanh bên của tài khoản admin.

Lệnh chỉ cấp quyền cho tài khoản hiện có, không tạo mật khẩu hay tài khoản mặc định. Không mở database PGlite đang được một tiến trình khác sử dụng: với PGlite, dừng backend trước khi chạy lệnh rồi khởi động lại. Với PostgreSQL, có thể chạy lệnh trực tiếp trên môi trường backend đang hoạt động. Không trỏ lệnh phát triển vào database production ngoài chủ đích của người vận hành.

## Chức năng

- **Tổng quan:** số người dùng/tài khoản, người có kết nối realtime, phòng hiện có/đang chơi, góp ý cần xử lý, tổng lịch sử ván và biểu đồ ván hoàn thành 14 ngày. Số phòng/luyện tập là dữ liệu hiện còn lưu sau cơ chế dọn phòng tự động của website. Nút Làm mới tải số liệu hiện tại.
- **Người dùng:** tìm theo tên/email/ID, lọc tài khoản/admin/đã khóa, đổi tên, cấp/gỡ admin, khóa/mở khóa có lý do và thu hồi tất cả phiên. Không thể tự khóa hoặc tự gỡ quyền. Khách không được cấp admin. Khóa admin khác yêu cầu gỡ quyền admin trong cùng thao tác.
- **Phòng chơi:** tìm kiếm, lọc trạng thái và hủy phòng có lý do. Hủy thông báo realtime cho tất cả thành viên, dừng timer và hủy hàng chờ liên quan. Ván đang chơi bị hủy, không ghi thắng thua hoặc thay đổi Elo. Lịch sử các ván đã hoàn thành vẫn được giữ. Hủy phòng không thể hoàn tác và cần xác nhận trong giao diện.
- **Lịch sử / luyện tập:** tìm kiếm, phân trang và xem dữ liệu ván đã lưu. Không chỉnh sửa kết quả hay Elo đã xác lập từ dashboard.
- **Góp ý & báo cáo:** đọc nội dung, lọc trạng thái, ghi chú và chuyển giữa Mới tiếp nhận / Đang xử lý / Đã xử lý / Đã bỏ qua.
- **Cấu hình:** thông báo văn bản trên trang chơi cờ (hiện khi người chơi tải lại trang), bật/tắt đăng ký mới bằng Email/Google/Facebook, bật/tắt tạo phòng và tìm trận mới. Đăng nhập tài khoản đã có và phòng đang tồn tại vẫn hoạt động. Luyện tập với máy vẫn hoạt động.
- **Nhật ký:** ghi người thực hiện, thời gian, đối tượng và thay đổi trước/sau; các thay đổi và nhật ký được ghi trong cùng transaction.
- **Danh sách:** 20 bản ghi/trang, tìm kiếm/lọc phía server và xuất CSV của trang đang xem. CSV vô hiệu hóa tiền tố công thức; không xuất mật khẩu, token phiên, khóa OAuth hay token mời.

Thời gian hiển thị theo Việt Nam. Trang quản trị có `noindex,nofollow`; kiểm soát truy cập thực sự nằm ở API. Thu hồi quyền được kiểm tra lại từ database trên mỗi yêu cầu; thao tác ghi kiểm tra lại cả phiên và quyền trong transaction. Khóa tài khoản chặn cấp phiên mới từ cả Email và OAuth, thu hồi phiên cũ và ngắt socket. Người chơi đã bị khóa vẫn có thể dùng phiên khách mới; đây là khóa tài khoản, không phải chặn thiết bị/IP.

## Kiểm tra

```sh
npm test
```

`test/admin.test.js` kiểm tra quyền truy cập HTTP, dữ liệu trả về, phân trang/tìm kiếm, cấp/gỡ quyền, khóa và thu hồi phiên/socket, xử lý góp ý, hủy phòng và bảo toàn Elo/lịch sử, cấu hình website và nhật ký. Frontend có kiểm thử riêng tại `test/admin.test.mjs`.
