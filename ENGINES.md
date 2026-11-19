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

Mức Dễ/Vừa phân tích tối đa bốn phương án bằng MultiPV. Server chỉ chọn giữa các nước trong khoảng điểm cho phép, với seed riêng và thiên hướng cân bằng, chủ động, thế trận hoặc chắc chắn. Những nước lùi lại ngay và thế cờ đã xuất hiện được giảm trọng số, không cấm một nước lặp cần thiết để cứu hòa.

Mức Khó và bot từ 2.200 Elo dùng **MultiPV 1**, Skill Level 20, không bật UCI_LimitStrength, không cố tình chọn nước yếu hơn. Server lấy `bestmove` cuối cùng của engine thay vì chọn từ điểm MultiPV của vòng tìm kiếm cũ. Đây cũng là cách cấu hình MultiPV được [Stockfish khuyến nghị để đạt hiệu năng tốt nhất](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html#multipv).

| Hồ sơ | Thời gian tối đa/nước | Giới hạn độ sâu |
| --- | ---: | --- |
| Dễ | 100 ms | 5 |
| Vừa | 500 ms | 12 |
| Khó | 3.000 ms | Không chặn theo độ sâu |
| 2.200 Elo nội bộ | 1.800 ms | Không chặn theo độ sâu |
| 2.500 Elo nội bộ | 2.760 ms | Không chặn theo độ sâu |
| 2.800 Elo nội bộ | 3.720 ms | Không chặn theo độ sâu |
| 3.200 Elo nội bộ | 5.000 ms | Không chặn theo độ sâu |

Cờ vua/cờ tướng giữ nguyên 12 ID bot cũ và thêm 4 đối thủ 2.200, 2.500, 2.800, 3.200. Các môn khác vẫn dùng thang Elo cũ; mức Khó tăng ngân sách/độ sâu tìm kiếm cho các bot có tìm kiếm, mở rộng các ứng viên chiến thuật Caro/Tư lệnh. Bot nội bộ từ 1.700 Elo không cố tình chọn nước ngẫu nhiên để nhường người chơi. Cờ xúc xắc vẫn phụ thuộc xác suất; tăng Elo không thay đổi kết quả xúc xắc.

Các mức dễ/vừa/khó và hồ sơ bot Elo có ngân sách thời gian/độ sâu và khoảng sai số khác nhau. Elo bot vẫn là **ước lượng nội bộ**, chưa được hiệu chuẩn bằng thi đấu, không phải Elo chính thức của Stockfish hay Fairy-Stockfish. Engine có thể kết thúc tìm kiếm sớm khi đạt giới hạn hoặc xác định kết quả. Một process engine xử lý tuần tự nên bàn đông có thể phải chờ thêm trong hàng đợi. Khi phải dùng bot dự phòng, chất lượng phụ thuộc thuật toán nội bộ; mức Elo hiển thị không phải chứng nhận sức mạnh của bot dự phòng.

Ván mới lưu vị trí xuất phát và gửi cả lịch sử nước đi cho engine. Ván cờ vua cũ thiếu `initialFen` dùng FEN hiện tại; bộ luật server vẫn phân xử lặp thế, nhập thành, bắt tốt qua đường và phong cấp. Cờ tướng vẫn theo chính sách luyện tập hiện có của dự án, chưa có bộ phân xử chiếu dai/đuổi dai WXF.

## Kiểm tra

`npm test` chạy các luật, API và kiểm thử giao thức/lỗi/đóng tiến trình bằng engine mô phỏng, độc lập với binary đã cài. `npm run test:engines` dùng hai binary thật để kiểm tra đa dạng khai cuộc, nước hợp lệ, chiếu hết, phong cấp, thắng vật chất, phòng thủ bắt buộc, API HTTP và đi lại; ghi số node, độ sâu và thời gian thực tế của một số vị trí. Không tự tải binary trong bộ kiểm thử.

## Nguồn và giấy phép

Hai engine là chương trình độc lập, được phát hành theo GPL-3.0. Trình cài giữ bản giấy phép đầy đủ và đường dẫn mã nguồn tương ứng cạnh executable:

- Stockfish 19: [release](https://github.com/official-stockfish/Stockfish/releases/tag/sf_19), [mã nguồn tương ứng](https://github.com/official-stockfish/Stockfish/tree/sf_19), [GPL](https://github.com/official-stockfish/Stockfish/blob/sf_19/Copying.txt).
- Fairy-Stockfish 14.0.1 XQ: [release](https://github.com/fairy-stockfish/Fairy-Stockfish/releases/tag/fairy_sf_14_0_1_xq), [mã nguồn tương ứng](https://github.com/fairy-stockfish/Fairy-Stockfish/tree/fairy_sf_14_0_1_xq), [GPL](https://github.com/fairy-stockfish/Fairy-Stockfish/blob/fairy_sf_14_0_1_xq/Copying.txt).
- Giao thức: [Stockfish UCI](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html), [Fairy-Stockfish coordinate/FEN conventions](https://fairy-stockfish.github.io/chess-variant-standards/).

Phiên bản, URL và checksum của từng nền tảng được khóa trong `scripts/engine-releases.mjs`. Binaries không được sửa mã nguồn.
