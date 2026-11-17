# Cờ tư lệnh tại Sân Cờ

`commander` là trò thứ 16. Có phòng riêng hai người, bot ba mức, đi lại trong
luyện tập, replay, đấu lại, đồng hồ phòng và lưu trạng thái PostgreSQL.
Migration `007_commander.sql` mở rộng loại ván; không thêm dữ liệu mẫu.

## Hồ sơ luật

Áp dụng **tổng lực, dàn quân sẵn**, kết thúc khi Tư lệnh bị diệt; không phải
bản hải chiến/không chiến hay bản tự bố trí đội hình. Đỏ đi trước theo quy ước
của ứng dụng. Bàn 11 cột × 12 hàng; tọa độ ghi hàng trước, cột sau, gốc 0,0
ở góc dưới trái phía Đỏ. Hai bên có cùng 19 quân, bố trí đối xứng theo hàng.

Quân được lưu thành chuỗi có màu và loại: `rK`, `bN`; tổ hợp dạng
`rN+rF+rK`, quân anh hùng thêm `*`. Máy chủ xác nhận toàn bộ lệnh trước khi
thay đổi trạng thái. Một lượt phối hợp nhiều quân vẫn chỉ tạo một bản ghi
nước đi và một phiên bản trạng thái. Các lệnh đi, lên quân, bắn tại chỗ và
ném bom là những lựa chọn tách biệt, không suy diễn từ ô đích.

## Quy ước cần biết

- Biển mở ở cột 0–1, bờ biển ở cột 2. Bờ sông là hàng 5 và 6; ngầm tại
  cột 5 và 7. Tàu vào cửa sông đến trước ngầm đầu tiên, tức cột 3–4.
- Đi không ăn quân không được nhảy qua vật cản, trừ máy bay. Pháo được
  vượt vật cản khi ăn. Trên đường bờ biển, tàu và quân đất không chặn nhau
  nhưng không đứng chung giao điểm nếu không phải tổ hợp chở quân.
- Công binh chỉ nhận một quân nặng khi ở bờ sông; khi cõng chỉ được đi
  thẳng qua bờ đối diện. Quân nặng phải rời lưng trước khi công binh đi tiếp.
- Tàu, máy bay, xe tăng chở tối đa hai quân thuộc nhóm được phép. Quân trên
  lưng có thể tách ra bằng tầm đi riêng tính từ giao điểm chung. Phối hợp
  tối đa ba lệnh từ một tổ hợp, đích khác nhau; quân chưa tách đi cùng quân
  chở. Không phối hợp vừa dời quân chở vừa cho khách bắn/ném bom trở về.
- Vùng phòng không tính theo khoảng cách Euclid giữa các giao điểm. Nếu
  đường bay chạm vùng không bảo vệ mục tiêu, máy bay cháy trước khi đánh.
  Đánh mục tiêu trong vùng bảo vệ thì một đổi một. Máy bay anh hùng miễn
  phòng không. Máy bay chỉ dừng trên đất liền hoặc lên tàu; có thể ném bom
  mục tiêu trên biển rồi trở về. Tổ hợp trên máy bay bị diệt cùng máy bay.
- Tư lệnh đi bộ không được xuyên giao điểm bị kiểm soát. Tư lệnh lộ mặt
  có thể bị Tư lệnh đối phương bắt theo trục thoáng. Quân chở/công sự che
  Tư lệnh. Ứng dụng cảnh báo nguy hiểm, không bắt buộc đáp chiếu và không
  tự xử chiếu hết; đối phương có thể bắt Tư lệnh nếu người chơi bỏ qua.
- Quân trực tiếp chiếu được phong anh hùng sau khi Tư lệnh bị đe dọa thực
  sự đổi giao điểm. Quân chiến đấu cuối cùng, không tính Tư lệnh/công sự,
  cũng được phong. Anh hùng thêm một bước và có hướng chéo.
- Nếu một đổi một diệt cả hai Tư lệnh trong cùng lệnh thì hòa. Hết nước
  thì thua. Lặp thế ba lần, 120 lượt không ăn hoặc 1.000 lượt thì hòa theo
  quy ước của Sân Cờ. Đồng hồ phòng dùng thời gian mỗi bên đã chọn và xử
  thua khi hết giờ; chưa dùng tính điểm kết thúc trận 30 phút.

Đây là hồ sơ luật chơi trong ứng dụng, không tuyên bố là bộ luật trọng tài
cho mọi giải. Chưa có dàn quân tự chọn hoặc các mục tiêu hải chiến/không chiến.
Giao diện 2D/3D có sáng/tối, đế quân vuông, tọa độ, vùng phòng không,
chọn khách trên lưng, lập lệnh phối hợp và bảng tra 11 loại quân.

## Bàn 3D

Chọn **3D** tại bàn online hoặc luyện tập. Xoay, zoom, đổi bên nhìn và góc
từ trên dùng chung hệ camera của các trò còn lại. Khi thiếu WebGL hoặc model
không tải được, ứng dụng trở về 2D và giữ nguyên ván.

Bộ quân mặc định hiện là 11 model GLB cách điệu theo quân phục/khí tài Việt
Nam tại `fe/public/models/commander/vietnam/`, tổng khoảng 1,17 MB. Các model
này được dựng riêng, không đổi tên model dân sự hay model phương Tây thành
khí tài Việt Nam. Danh mục tham chiếu ảnh tư liệu có trong `vietnam-profile.ts`
và manifest; có thể tạo lại GLB bằng `npm run models:vietnam` tại `fe/`.
Màu ô liu/ngụy trang, xám hải quân và xanh xám máy bay được giữ cho cả hai
phe; màu Đỏ/Xanh chỉ dùng trên đế/nhãn. Đây là mô hình phục vụ bàn cờ, không
phải bản sao kỹ thuật chính xác. Các model tải mạng trước đó cùng nguồn và
giấy phép vẫn được giữ ở thư mục cha, không dùng làm bộ quân mặc định.

Ngoại cảnh mặc định có tre, dừa, ruộng nhỏ, đá và bờ biển. Mặt biển/sông dùng
shader sóng nhẹ; vùng nước trên bàn giữ nguyên các giao điểm luật chơi và
hai ngầm. Cây/đá ngoài khung bàn không tham gia chọn ô hoặc tính luật. Nút
**Ngoại cảnh** ẩn/hiện phần bao quanh và nới/thu khung camera, không đổi thế
cờ hay góc xoay. Nước dừng chuyển động khi bật reduced motion; ngoại cảnh
đổi màu theo theme sáng/tối. Các mesh cây/đá được gộp theo vật liệu để giảm
số lượt vẽ; không có tải thêm ảnh texture hay model cây từ mạng.

Mesh được gộp theo vật liệu; pose tĩnh được bake trước khi clone, không nhân
bản skeleton cho 38 quân. Mỗi quân có màu phe, đế vuông và nhãn; tổ hợp có
đủ các model khách. Hoạt ảnh dựa vào `effects` và snapshot do máy chủ chấp
nhận: cõng/tách, phối hợp nhiều hướng, đạn bắn tại chỗ, ném bom rồi quay về,
máy bay bị chặn giữa đường và một đổi một. Trường hợp delta không giải
thích được hoặc nhảy replay thì đồng bộ thẳng về snapshot, không bịa nước đi.

## Nguồn

- [Luật và sơ đồ do tác giả Nguyễn Quý Hải công bố (2017)](https://haiduongblog.wordpress.com/2017/07/22/3394/).
  Đối chiếu sơ đồ Hình 3, hệ tọa độ và hồ sơ tổng lực; ký hiệu quân trong
  ứng dụng là SVG tự vẽ, không dùng ảnh quân của nguồn.
- [Tác giả giải đáp các tình huống (2014)](https://haiduongblog.wordpress.com/2014/04/).
  Đối chiếu việc lên tàu, tách quân và công binh chở qua sông.
- [Tác giả giới thiệu các bài học từng quân (2023)](https://haiduongblog.wordpress.com/2023/03/).
- [Hướng dẫn triển khai trên Board Game Arena](https://vi.doc.boardgamearena.com/Gamehelpcommanderchess).
  Đối chiếu các nhóm cơ chế, không dùng điều kiện chiếm căn cứ ba lượt của
  bản Community Edition khác.

## Kiểm tra

`node --test test/commander.test.js` kiểm tra luật, hành động giả không làm
biến đổi trạng thái, phối hợp nguyên tử, bot, undo, HTTP thật, worker bot,
dedup, replay và rematch. Test frontend dùng cùng engine để kiểm chứng
lệnh ném bom/phối hợp từ thao tác giao diện. `npm run test:online` thử đủ
16 trò qua HTTP/WebSocket và mở lại database tạm trên đĩa.
