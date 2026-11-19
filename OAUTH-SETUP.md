# Đăng nhập Google và Facebook cho Sân Cờ

Luồng OAuth và giao diện đã có sẵn. Cần tạo ứng dụng trên Google/Meta, điền khóa vào backend và đăng ký chính xác callback. Không điền secret vào `fe/.env` hoặc biến `VITE_*`.

## 1. Chọn URL callback

Ứng dụng dùng proxy `/api` cùng origin với frontend. Callback local đi qua Vite cổng **5173**, không dùng cổng 3001 trong cấu hình dưới đây.

| Môi trường | Google callback | Facebook callback |
| --- | --- | --- |
| Local HTTP | `http://127.0.0.1:5173/api/auth/google/callback` | Dùng local HTTPS bên dưới khi thử Facebook |
| Local HTTPS | `https://127.0.0.1:5173/api/auth/google/callback` | `https://127.0.0.1:5173/api/auth/facebook/callback` |
| Production | `https://sanco.games/api/auth/google/callback` | `https://sanco.games/api/auth/facebook/callback` |

Nếu website thực tế chuyển sang `www.sanco.games`, dùng `https://www.sanco.games` cho `FRONTEND_ORIGIN`, `PUBLIC_API_URL` và hai callback. Không để callback chuyển hướng từ domain này sang domain khác: cookie kiểm tra OAuth thuộc host đã bắt đầu đăng nhập. Khi dùng `localhost` thay vì `127.0.0.1`, cũng phải đổi đồng bộ URL mở trình duyệt, env và callback đã đăng ký.

## 2. Tạo Google OAuth Client

1. Mở [Google Cloud Console](https://console.cloud.google.com/), tạo/chọn project **Sân Cờ**.
2. Vào **Google Auth Platform**. Hoàn thiện **Branding** (tên, email hỗ trợ), **Audience** (External nếu cho người ngoài tổ chức), **Data Access** với `openid`, `email`, `profile`.
3. Khi app còn Testing, thêm Gmail của bạn vào **Test users**.
4. Vào **Clients → Create client → Web application**. Tạo client cho local và client riêng cho production để tách khóa.
5. Trong **Authorized redirect URIs**, thêm callback Google của môi trường tương ứng ở bảng trên. Có thể thêm cả HTTP/HTTPS cho client local. URL phải khớp cả giao thức, host, cổng và đường dẫn.
6. Sao chép **Client ID** và **Client secret** vào `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` trong `be/.env` (local) hoặc `deploy/.env` (production).

Dự án chuyển hướng bằng backend, không dùng Google JavaScript SDK; không cần thêm secret hay mã SDK vào frontend. Đối chiếu [tài liệu OAuth web server của Google](https://developers.google.com/identity/protocols/oauth2/web-server).

## 3. Tạo ứng dụng Facebook Login

1. Mở [Meta for Developers → My Apps](https://developers.facebook.com/apps/), tạo ứng dụng **Sân Cờ**, chọn use case xác thực người dùng bằng **Facebook Login**. Tên/vị trí menu có thể khác tùy dashboard của tài khoản.
2. Thêm nền tảng **Website**, đặt Site URL là `https://sanco.games/` cho production; App Domains là `sanco.games` (và `www.sanco.games` nếu dùng).
3. Trong **Use cases → Facebook Login → Permissions and features**, kiểm tra `public_profile` và thêm quyền tùy chọn `email`. Vào cấu hình **Facebook Login**, bật **Client OAuth Login**, **Web OAuth Login** và thêm callback Facebook vào **Valid OAuth Redirect URIs**. Dùng callback HTTPS cho local.
4. Trong **App settings → Basic**, lấy **App ID**, **App secret** và điền vào `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`. Để `FACEBOOK_GRAPH_VERSION=v26.0`.
5. Khi app còn Development, thử bằng tài khoản có vai trò admin/developer/tester trong app. Nên dùng app/test app riêng cho local, với Site URL local HTTPS.
6. Trước khi mở cho mọi người, hoàn thiện các mục Meta yêu cầu trong dashboard, bao gồm URL chính sách quyền riêng tư và thông tin/hướng dẫn xóa dữ liệu; hoàn tất điều kiện truy cập quyền và chuyển app sang Live. Dự án hiện chưa có trang chính sách hoặc hướng dẫn xóa dữ liệu công khai; cần chuẩn bị nội dung thật trước khi điền các URL này.

Ứng dụng chỉ yêu cầu `public_profile,email`; vẫn đăng nhập được nếu Facebook không trả email. Tham khảo [cấu hình use case Facebook Login](https://developers.facebook.com/documentation/development/create-an-app/facebook-login-use-case), [luồng đăng nhập thủ công](https://developers.facebook.com/docs/facebook-login/manually-build-a-login-flow/) và [lịch phiên bản Graph API](https://developers.facebook.com/docs/graph-api/changelog/versions/). v20.0 cũ đã hết hỗ trợ ngày 24/09/2026; cấu hình hiện dùng v26.0.

## 4. Điền cấu hình local

File `be/.env` đã được chuẩn bị với khóa ký OAuth ngẫu nhiên. Điền bốn giá trị từ Google/Meta:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
```

Nếu cài dự án trên máy mới, sao chép `be/.env.example` thành `be/.env`, rồi sinh `OAUTH_STATE_SECRET` bằng lệnh sau trong `be/` và lưu kết quả vào file:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Để thử Google bằng HTTP, giữ `PUBLIC_API_URL=http://127.0.0.1:5173`, `COOKIE_SECURE=false` và mở đúng `http://127.0.0.1:5173`.

### HTTPS local cho Facebook

Tạo chứng chỉ local đáng tin cậy bằng [mkcert](https://github.com/FiloSottile/mkcert) theo hướng dẫn cài đặt Windows của dự án đó. Sau khi cài, chạy trong thư mục `fe/`:

```powershell
New-Item -ItemType Directory -Force .certs
mkcert -install
mkcert -key-file .certs/localhost-key.pem -cert-file .certs/localhost.pem localhost 127.0.0.1 ::1
```

Tạo/sửa `fe/.env`:

```dotenv
VITE_API_URL=
DEV_HTTPS_KEY=.certs/localhost-key.pem
DEV_HTTPS_CERT=.certs/localhost.pem
```

Đổi trong `be/.env`:

```dotenv
PUBLIC_API_URL=https://127.0.0.1:5173
FRONTEND_ORIGIN=https://127.0.0.1:5173,https://localhost:5173
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
```

Khởi động lại cả backend và frontend. Mở **https://127.0.0.1:5173** và đăng ký callback local HTTPS ở cả Google/Meta. Backend vẫn dùng HTTP nội bộ cổng 3001; Vite kết thúc TLS và proxy `/api`, `/socket.io`. Không đưa private key hoặc CA của mkcert lên Git/máy chủ.

Chạy ở hai terminal:

```powershell
cd be
npm run oauth:check
npm run dev
```

```powershell
cd fe
npm run dev
```

`oauth:check` kiểm tra cấu hình và in callback, không in secret và không xác minh khóa với Google/Meta. Cả hai server phải chạy khi thử đăng nhập.

## 5. Cấu hình sanco.games qua Docker

**Triển khai hiện tại dùng Vercel + Heroku:** frontend ở `https://www.sanco.games`, backend ở `https://api.sanco.games` (Heroku app `sanco-be-api`). File `deploy/.env` trên máy không tự cập nhật Config Vars của Heroku. Đặt các khóa Google/Facebook và `OAUTH_STATE_SECRET` trong Config Vars của app backend, với `PUBLIC_API_URL=https://api.sanco.games` và giữ `FRONTEND_ORIGIN` cho hai domain website. Callback cần đăng ký trên nhà cung cấp là:

```text
https://api.sanco.games/api/auth/google/callback
https://api.sanco.games/api/auth/facebook/callback
```

Frontend Vercel dùng `VITE_API_URL=https://api.sanco.games`; các secret chỉ đặt trên backend Heroku. Cấu hình Docker bên dưới dành cho cách triển khai cả frontend/API cùng origin, khác với hệ thống hiện tại.

Sao chép `deploy/.env.example` thành `deploy/.env` nếu chưa có. Giữ mật khẩu/database hiện tại nếu đang triển khai. Điền:

```dotenv
FRONTEND_ORIGIN=https://sanco.games
PUBLIC_API_URL=https://sanco.games
OAUTH_STATE_SECRET=<khóa ngẫu nhiên riêng cho production, ít nhất 32 ký tự>
GOOGLE_CLIENT_ID=<client ID production>
GOOGLE_CLIENT_SECRET=<client secret production>
FACEBOOK_APP_ID=<app ID production>
FACEBOOK_APP_SECRET=<app secret production>
FACEBOOK_GRAPH_VERSION=v26.0
```

Giữ nguyên `OAUTH_STATE_SECRET` khi khởi động lại. Hai biến `GOOGLE_REDIRECT_URI`, `FACEBOOK_REDIRECT_URI` thường để trống: backend tự ghép `PUBLIC_API_URL` với đường dẫn callback. Docker Compose đã truyền các biến OAuth vào container; không cần build khóa vào frontend.

Kiểm tra file deploy từ `be/`, sau đó triển khai từ `deploy/`:

```powershell
npm run oauth:check -- --env ../deploy/.env
```

```powershell
docker compose up -d --build web
```

Thiết lập TLS/Nginx theo [hướng dẫn deploy](../deploy/README.md). Chưa có khóa, DNS và quyền máy chủ thì chưa thể xác minh đăng nhập production.

## 6. Xác nhận và xử lý lỗi

- Mở `/api/auth/providers` trên origin đang thử: `google`/`facebook` chỉ là `true` khi backend có đủ ID và secret tương ứng. `true` không có nghĩa khóa đã được nhà cung cấp xác minh.
- Thử Google và Facebook lần lượt: tạo phiên khách, đăng nhập, kiểm tra tên/tài khoản, tạo phòng, đăng xuất rồi đăng nhập lại. Danh tính và lịch sử khách được giữ khi nâng cấp thành tài khoản mới.
- `redirect_uri_mismatch` / URL blocked: đối chiếu callback từ `oauth:check` với dashboard; kiểm tra cả `www`, cổng, HTTPS và dấu `/` cuối.
- Lỗi kiểm tra trạng thái: mở cùng host đã cấu hình, không chuyển giữa `localhost`/`127.0.0.1`/`www`, cho phép cookie rồi bắt đầu đăng nhập lại.
- Facebook app chưa khả dụng: kiểm tra vai trò test, chế độ Development/Live và yêu cầu còn thiếu trong Meta dashboard.
- Provider vẫn `false`: điền khóa trong đúng file của môi trường và khởi động lại backend/container.

File `.env` và thư mục chứng chỉ local đã được ignore. Không gửi secret vào chat hay commit chúng.
