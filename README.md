# Lịch trực nhật

Web phân công trực nhật: hiện người trực hôm nay, tuần này + tuần sau theo từng ngày. Không xoay vòng tự động — ai trực ngày nào do mọi người tự phân công.
Ai mở web cũng dùng được (không cần đăng nhập).

## Cấu trúc

```
public/        giao diện (HTML/CSS/JS thuần)
api/index.js   Vercel Function – nhận mọi request /api/*
lib/api.js     logic API (dùng chung cho Vercel và chạy ở máy)
lib/db.js      kết nối database (Turso trên Vercel, file SQLite khi chạy ở máy)
server.js      server chạy ở máy
database/      chứa file .sqlite khi chạy ở máy (không deploy)
```

## Deploy lên Vercel + Turso

1. **Tạo database Turso** (gói miễn phí) tại <https://app.turso.tech> → *Create Database*.
   Hoặc dùng CLI: `turso db create truc-nhat`, rồi
   `turso db show truc-nhat --url` và `turso db tokens create truc-nhat`.
2. **Đưa code lên GitHub** rồi *Import Project* trên Vercel (Framework Preset: **Other**, để trống Build Command).
3. Trong Vercel → *Settings → Environment Variables*, thêm:
   - `TURSO_DATABASE_URL` = `libsql://truc-nhat-<tên-bạn>.turso.io`
   - `TURSO_AUTH_TOKEN` = token vừa tạo
4. **Deploy** (hoặc *Redeploy* nếu đã deploy trước khi thêm biến). Bảng trong database tự tạo ở lần truy cập đầu.

Muốn xoá sạch dữ liệu trên Turso: xoá database rồi tạo lại (nhớ cập nhật URL/token), hoặc chạy `DROP TABLE` trong Turso shell.

## Chạy ở máy

Cần Node.js >= 20.

```bash
npm install
npm start            # http://localhost:3000, dữ liệu ở database/truc-nhat.sqlite
PORT=8080 npm start  # đổi cổng
```

Muốn chạy ở máy nhưng dùng chung dữ liệu với bản trên Vercel: đặt `TURSO_DATABASE_URL` và `TURSO_AUTH_TOKEN` trước khi `npm start`.
Xoá dữ liệu ở máy: tắt server rồi xoá các file `database/truc-nhat.sqlite*`.

## Cách dùng

- **Bấm vào một ngày** → chọn người trực (có thể tick “Áp dụng cho cả tuần”) và ghi chú.
- **Hôm nay ai trực?** → khi hôm nay đã có người trực, danh sách việc hiện ngay đây; tick/bỏ tick là tự lưu, không cần chọn người sửa.
- **Thành viên** → thêm, đổi tên/màu, sắp xếp, xoá.
- **Việc cần làm** → danh sách việc mỗi ngày (đổ rác, lau nhà…).
- **Cài đặt** → đổi tiêu đề.
- **Thêm** (thành viên, việc, phân công ngày còn trống) và tick/bỏ tick việc không cần nhập gì. **Sửa/xoá** mới cần *Người sửa* (chọn trong danh sách thành viên) và *Lý do*: đổi/bỏ người trực đã phân công, sửa/xoá/sắp xếp thành viên hoặc việc, đổi cài đặt. Sửa riêng ghi chú thì chỉ cần người sửa.
- **Lịch sử**: nút 🕘 trên đầu trang xem toàn bộ; ngày nào đã bị sửa có nút 🕘 bên cạnh để xem riêng ngày đó.
