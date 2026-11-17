# Bộ sưu tập 15 trò

Đã thêm 5 trò chơi thật, dùng chung phòng riêng, lời mời, đồng hồ, WebSocket,
biên nhận chống ghi trùng, lịch sử và đấu lại. Chế độ chơi với máy có bot nội bộ
ở ba mức tìm kiếm, cùng chức năng đi lại và lưu ván.

| Trò mới | Bàn | Quy tắc chính |
| --- | --- | --- |
| Cờ gánh | 5×5 giao điểm | Đi theo đường, gánh đôi, vây và bắt buộc đáp Mở |
| Ataxx | 7×7 | Nhân quân kề, nhảy hai ô, đổi màu quân sát đích |
| Đột phá / Breakthrough | 8×8 | Trắng đi trước; tiến thẳng/chéo, chỉ ăn chéo; đến hàng cuối thắng |
| Liên quân / Lines of Action | 8×8 | Đếm quân trên đường để đi; kết nối toàn bộ quân thành một nhóm |
| Cô lập / Isolation bản trượt | 8×8 | Đi như Hậu, khóa ô vừa rời; hết nước thua |

## Biến thể được áp dụng

- Cờ gánh: có Mở; vây đổi màu đồng thời các nhóm hết điểm trống kề.
- Ataxx: tự bỏ lượt khi hết nước; hai bên hết nước thì đếm quân. Hòa khi lặp
  thế ba lần hoặc có 100 thao tác nhảy liên tiếp không nhân/đổi màu.
- Lines of Action: tiếp xúc chéo cũng nối nhóm; khi một nước nối cả hai bên,
  người vừa đi thắng. Hết nước tự bỏ lượt; ba lần lặp thế hòa.
- Isolation dùng biến thể trượt 8×8 được mô tả trong tài liệu Columbia,
  khác phiên bản bàn 6×8 có bước tháo ô riêng.
- Giới hạn bảo vệ các ván mới: 1.000 thao tác. Quy tắc đầy đủ có trong nút Luật.
- Bot nội bộ chạy trong worker, tối đa hai tác vụ cùng lúc; không đại diện Elo.

## Nguồn luật đã đối chiếu

- [Cờ gánh: hồ sơ luật của ChessPlayX](https://chessplayx.com/vi/co-ganh).
- [Ataxx: mô tả engine và luật của Connor Stephens](https://connorsteph.github.io/projects/ataxx.html).
- [Breakthrough: PlayStrategy](https://playstrategy.org/variant/breakthroughtroyka).
- [Lines of Action: Boardspace](https://www.boardspace.net/english/about_loa.html).
- [Isolation bản trượt: Columbia University](https://www.cs.columbia.edu/~sal/notes/assign3-isolation-game.htm).

## Thay đổi dữ liệu

Migration `006_abstract_games.sql` mở rộng ràng buộc loại trò của ván luyện tập,
giữ nguyên dữ liệu đã có. Khởi động backend áp dụng migration tự động.
Không chèn phòng, tài khoản hoặc ván mẫu vào database ứng dụng.

## Kiểm tra

- Unit test tình huống gánh/vây/Mở, clone/jump/đổi màu, chặn đường,
  đếm đường LOA, về đích, hết nước và từ chối nước giả.
- Bot ở cả ba mức trả nước hợp lệ, đi lại khôi phục bàn ban đầu.
- API thật kiểm tra tạo/vào phòng, sẵn sàng, nước đi, gửi lại, replay, đấu lại,
  và nước trả lời từ worker bot cho cả năm trò mới.
- Frontend kiểm tra mở phòng/chơi với máy, đổi theme cho đủ 15 môn;
  bộ lọc Mới, tìm kiếm không dấu, trạng thái rỗng và khôi phục danh sách.
- Chạy `npm run test:online` để thử HTTP/WebSocket thật và khởi động lại với
  database tạm trên đĩa; script tự xóa dữ liệu thử khi xong.
