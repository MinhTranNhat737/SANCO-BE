# Stockfish và Fairy-Stockfish

Cờ vua dùng **Stockfish 19**, cờ tướng dùng **Fairy-Stockfish 14.0.1 XQ**, có NNUE tích hợp. Engine chạy ở backend qua UCI, không gửi binary hoặc quyền quyết định nước đi cho trình duyệt. Các môn khác tiếp tục dùng bot nội bộ.

```powershell
npm run engines:install
npm run test:engines
npm start
```

Trình cài hỗ trợ Windows/Linux x64, tải bản phát hành chính thức, kiểm tra SHA-256 rồi lưu trong `.engines/` (được Git/Docker ignore). Docker và Heroku tự chạy trình cài khi build. Không commit binary hoặc `.env`. Khi dùng nền tảng khác, cài engine tương thích và đặt `STOCKFISH_PATH`, `FAIRY_STOCKFISH_PATH` đến executable.

- `ENGINE_PROCESSES=1`: tối đa một native engine cùng lúc; tái sử dụng tiến trình khi cùng môn, đóng engine trước khi đổi môn. Có thể tăng 1–4 sau khi đo RAM/CPU. Mỗi engine dùng một luồng và `ENGINE_HASH_MB=16` MB bảng hash; NNUE còn dùng RAM riêng ngoài bảng hash.
- Tiến trình rảnh được đóng sau 30 giây. Đóng server, lỗi giao thức, timeout hoặc engine thoát đều dọn tiến trình; không để child process của worker bị bỏ lại.
- `NATIVE_ENGINES=false`: tắt engine ngoài. Thiếu executable, engine lỗi hoặc nước không hợp lệ sẽ dùng bot nội bộ. `botEngine` trong trạng thái ván chỉ ghi engine đã thực sự trả nước hợp lệ.
- Không dùng tên hiển thị hoặc dữ liệu từ người chơi làm lệnh shell. UCI chỉ nhận vị trí và nước đã có trong trạng thái server. Kết quả engine được lọc qua luật server trước khi ghi SQL.

## Đa dạng lối chơi

Engine phân tích tối đa bốn phương án bằng MultiPV. Server chỉ chọn giữa các nước trong khoảng điểm cho phép của mức khó; nước thắng chiếu hết được ưu tiên theo đánh giá engine. Mỗi ván dùng seed riêng, với thiên hướng cân bằng, chủ động, thế trận hoặc chắc chắn. Những nước lùi lại ngay và thế cờ đã xuất hiện được giảm trọng số, không cấm một nước lặp cần thiết để cứu hòa.

Các mức dễ/vừa/khó và hồ sơ bot Elo có ngân sách thời gian/độ sâu và khoảng sai số khác nhau. Elo bot vẫn là **ước lượng nội bộ**, chưa được hiệu chuẩn bằng thi đấu, không phải Elo chính thức của Stockfish hay Fairy-Stockfish. Engine có thể kết thúc tìm kiếm sớm khi đạt độ sâu hoặc thời gian đã đặt.

Ván mới lưu vị trí xuất phát và gửi cả lịch sử nước đi cho engine. Ván cờ vua cũ thiếu `initialFen` dùng FEN hiện tại; bộ luật server vẫn phân xử lặp thế, nhập thành, bắt tốt qua đường và phong cấp. Cờ tướng vẫn theo chính sách luyện tập hiện có của dự án, chưa có bộ phân xử chiếu dai/đuổi dai WXF.

## Kiểm tra

`npm test` chạy các luật, API và kiểm thử giao thức/lỗi/đóng tiến trình bằng engine mô phỏng, độc lập với binary đã cài. `npm run test:engines` dùng hai binary thật để kiểm tra đa dạng khai cuộc, nước hợp lệ, chiếu hết, phong cấp, API HTTP và đi lại. Không tự tải binary trong bộ kiểm thử.

## Nguồn và giấy phép

Hai engine là chương trình độc lập, được phát hành theo GPL-3.0. Trình cài giữ bản giấy phép đầy đủ và đường dẫn mã nguồn tương ứng cạnh executable:

- Stockfish 19: [release](https://github.com/official-stockfish/Stockfish/releases/tag/sf_19), [mã nguồn tương ứng](https://github.com/official-stockfish/Stockfish/tree/sf_19), [GPL](https://github.com/official-stockfish/Stockfish/blob/sf_19/Copying.txt).
- Fairy-Stockfish 14.0.1 XQ: [release](https://github.com/fairy-stockfish/Fairy-Stockfish/releases/tag/fairy_sf_14_0_1_xq), [mã nguồn tương ứng](https://github.com/fairy-stockfish/Fairy-Stockfish/tree/fairy_sf_14_0_1_xq), [GPL](https://github.com/fairy-stockfish/Fairy-Stockfish/blob/fairy_sf_14_0_1_xq/Copying.txt).
- Giao thức: [Stockfish UCI](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html), [Fairy-Stockfish coordinate/FEN conventions](https://fairy-stockfish.github.io/chess-variant-standards/).

Phiên bản, URL và checksum của từng nền tảng được khóa trong `scripts/engine-releases.mjs`. Binaries không được sửa mã nguồn.
