# Sân Cờ — Backend Node.js

Kiểm tra đăng ký, đăng nhập, tạo phòng, đồng bộ nước đi và lưu dữ liệu sau
khởi động lại bằng `npm run test:online`. Script dùng HTTP/WebSocket thật
với database tạm riêng, tự dọn khi xong. Xem kết quả đo và giới hạn tại
[báo cáo ngày 17/11/2026](ONLINE-TEST-2026-11-17.md).

Chạy độc lập với thư mục `fe/`:

```sh
npm install
npm run dev
```

API mặc định: `http://127.0.0.1:3001`. `npm test` kiểm tra luật, tài khoản, quyền phòng, kết nối và bot.

## Database

- Không đặt `DATABASE_URL`: dùng PostgreSQL nhúng PGlite, lưu bền vững trong `be/.data/postgres/`.
- Có `DATABASE_URL`: kết nối PostgreSQL riêng qua `pg`.
- Sao chép `.env.example` thành `.env` nếu cần đổi cấu hình.
- `npm run db:migrate` áp dụng các file SQL đánh số trong `sql/`. Khởi động API áp dụng migration chưa chạy trong giao dịch, có bảng schema_migrations và khóa advisory cho PostgreSQL.
- `001_initial.sql`: tài khoản, người chơi, phiên, phòng online, kết quả và góp ý.
- `002_practice.sql`: ván luyện tập với máy và biên nhận thao tác.
- `003_more_games.sql`: mở rộng loại cờ, tương thích với bản nâng cấp.
- `004_party_and_grid.sql`: đủ 10 loại cờ, room_members và match_members cho quyền 2–4 người.

Mật khẩu dùng scrypt, cookie phiên HttpOnly; database chỉ giữ hash của token phiên và lời mời. Dùng HTTPS, `COOKIE_SECURE=true` và cấu hình `FRONTEND_ORIGIN` đúng khi triển khai.

## Chơi với máy

```text
GET  /api/practice
POST /api/practice                  { kind, difficulty, side }
GET  /api/practice/:id
POST /api/practice/:id/actions      { actionId, version, action, from?, to?, promotion? }
```

`kind`: `caro`, `chess`, `xiangqi`, `reversi`, `connect4`, `go`, `ludo`, `monopoly`, `checkers`, `tictactoe`. `difficulty`: `easy`, `medium`, `hard`. `side`: `first`, `second`, `random`. Thao tác: `move`, `undo`, `resign`.

Các endpoint yêu cầu phiên người chơi. Chỉ chủ ván xem và thao tác được. Nước đi được kiểm tra và lưu trong giao dịch SQL. Biên nhận bền vững ngăn yêu cầu gửi lại ghi trùng. Socket.IO phát sự kiện `practice` đến đúng người chơi; GET đồng bộ lại nếu kết nối bị ngắt.

Bot chạy trong Node worker threads, tối đa hai tác vụ cùng lúc, có giới hạn thời gian tính. Khi máy chủ khởi động lại, ván đang đến lượt bot được đưa lại vào hàng đợi. Ba mức khó là mức tìm kiếm của bot nội bộ, không đại diện cho Elo.

## Bộ luật luyện tập

- **Caro:** bàn 15×15, X đi trước, từ 5 quân trở lên thắng, không xét chặn hai đầu.
- **Cờ vua:** `chess.js` 1.4.0 kiểm tra nước, nhập thành, bắt tốt qua đường, phong cấp, chiếu hết và hòa. Chính sách luyện tập tự động hòa khi lặp thế ba lần hoặc đủ 50 nước mỗi bên không đi tốt/ăn quân.
- **Cờ tướng:** kiểm tra bảy loại quân, cản Mã/Tượng, ngòi Pháo, cung, sông, an toàn Tướng và lộ mặt Tướng. Hết nước hợp lệ là thua. Lặp thế ba lần hoặc 120 lượt không ăn quân là hòa. **Chưa có bộ phân xử chiếu dai/đuổi dai WXF; không dùng chế độ này cho xếp hạng hoặc giải đấu.**
- **Cờ lật:** 8×8, Đen đi trước. Phải kẹp được quân đối phương; lật tất cả hướng hợp lệ. Hết nước tự bỏ lượt; cả hai hết nước thì đếm quân phân thắng bại, kể cả khi bàn chưa kín.
- **Nối bốn:** 7×6, Đỏ đi trước. Máy chủ chỉ nhận ô thấp nhất còn trống trong cột. Từ 4 quân ngang, dọc, chéo thì thắng; kín bàn không ai thắng thì hòa.

Các ván bot không tính giờ, không xếp hạng. Đi lại khôi phục bàn trước nước gần nhất của người chơi và bỏ cả nước trả lời sau đó của máy.

## Phòng riêng cho 10 môn

```text
POST /api/rooms                    { minutes: 3|5|10|15, kind, side: first|second|random, capacity?: 2|3|4 }
GET  /api/rooms
GET  /api/rooms/:id
POST /api/rooms/:id/join            { token }
POST /api/rooms/:id/invite          {}
POST /api/rooms/:id/actions         { actionId, version, action, cell?, from?, to?, promotion?, pass?, command? }
GET  /api/history
GET  /api/matches/:id
```

Mặc định `kind=caro`, `side=random` để tương thích client và phòng cũ. Caro dùng `cell`; các môn khác dùng `from/to/promotion` (Cờ lật và Nối bốn có `from=null`). `ready`, `move`, `resign`, `rematch` dùng chung; `draw/decline` chỉ cho các môn hai bên. Tất cả ghế được chọn phải vào đủ và sẵn sàng mới bắt đầu. Đấu lại đổi bên, tạo ván mới và giữ nguyên kết quả cũ. Nước không hợp lệ bị từ chối trước khi lưu; cùng actionId không tạo thêm nước. Socket.IO trả đúng góc nhìn từng người, GET đồng bộ khi tải lại. Lịch sử có loại cờ, snapshot từng nước và chỉ những người đã tham gia có quyền xem.

`src/room-game.js` điều phối phòng nhiều môn và đồng hồ. `src/disc-games.js` chứa luật hai trò chơi mới. Cờ tướng online áp dụng cùng quy ước lặp thế/không ăn quân như luyện tập, không phân xử giải đấu.

Tài liệu nguồn: [chess.js](https://jhlywa.github.io/chess.js/), [WXF rules](https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_XiangQi_Rules_English2018.pdf), [World Othello Federation](https://www.worldothello.org/about/about-othello/othello-rules/official-rules/english), [Connect Four — Hasbro](https://www.hasbro.com/common/instruct/ConnectFour.PDF).

## Nhóm trò mới

- go: 9×9, khí/bắt quân/tự sát/superko, pass=true/to=-1, hai pass tính diện tích + komi 6,5; không đánh dấu quân chết, không phân xử thi đấu.
- checkers: Đam Anh, bắt buộc ăn, ăn liên tiếp và phong Vua dừng lượt.
- tictactoe: 3×3, bot minimax.
- ludo: 2–4 người, 4 quân, 52 ô + đường về, xuất chuồng bằng 6, ô an toàn, về đủ số.
- monopoly: bản mini riêng 20 ô, 1 xúc xắc, vốn 1.500, nhóm đất, tối đa 3 nhà, bán tài sản/trả nợ/phá sản, giới hạn 30 vòng. Không thay thế bộ luật Monopoly tiêu chuẩn.

Trò xúc xắc gửi action=move và command=roll|move|buy|build|sell|end|bankrupt, to là quân/tài sản hoặc -1. Máy chủ tự gieo crypto.randomInt; không tin die từ client. Hết giờ/đầu hàng loại một người, các bên còn lại tiếp tục. Practice dùng hai bên; không cho undo các trò xúc xắc.

## Realtime và deploy

room-action / practice-action nhận {id,body}, trả ack {room|game} hoặc {error,status}. Cùng pipeline giao dịch/idempotency với HTTP. Live state gửi movesAppend + moveCount, không gửi toàn replay; GET/watch-room ack trả snapshot đầy đủ. Client phải resync khi thiếu index hoặc reconnect. Phiên và quyền được kiểm tra cả qua socket; người ngoài không nhận trạng thái phòng.

GET /api/ready kiểm tra database. SERVE_FRONTEND=true phục vụ fe/dist cùng origin. Production bắt buộc DATABASE_URL. Xem [hướng dẫn Docker/Nginx và giới hạn một replica](../deploy/README.md). npm run bench đo 80 ack sau SQL trên loopback/PGlite; không phải kết quả internet.
