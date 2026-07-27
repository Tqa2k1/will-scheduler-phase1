# WHILL Scheduler — Phase 0 + Phase 1

Nền tảng hệ thống + màn hình nhập lịch chính (Master Roster, Daily Assignment) thay thế việc gõ tay trên Excel. Tính năng tự động phân công (auto-assign) sẽ được thêm ở Phase 3-4.

## Hệ thống gồm những gì

**Phase 0 — Nền tảng**
- Đăng nhập bằng email/mật khẩu, phân quyền **Admin** (toàn quyền) và **INC** (chỉ xem).
- Trang Dashboard hiển thị số liệu tổng quan.
- Trang quản lý nhân viên (Admin thêm được, ai đăng nhập cũng xem được).
- Database đầy đủ 14 bảng theo đúng thiết kế đã chốt.

**Phase 1 — Nhập liệu & xuất file**
- **`/roster`** — Master Roster dạng lưới tháng (nhân viên × ngày), chọn loại ca hoặc 有休/調整休 cho từng ô, lưu tự động khi đổi. Nút "Xuất Excel" tải về file .xlsx của cả tháng.
- **`/schedule/[date]`** (vd `/schedule/2026-07-01`) — Daily Assignment dạng lưới slot 30 phút (nhân viên × giờ, từ 04:00 đến 03:30 hôm sau), chọn vị trí (A/B/全/BF/休憩/移動/WHILL準備/WHILL片付け/MTG) cho từng ô, có màu phân biệt. Nút "Xuất Excel" / "Xuất PDF" tải file theo ngày.
- Click vào số ngày trong Master Roster sẽ mở thẳng Daily Assignment của ngày đó.
- File xuất ra giữ đúng **cấu trúc và nội dung** (tên cột, ký hiệu A/B/全/BF...) như file gốc — không cần khớp pixel-perfect (font/màu/merge cell) theo yêu cầu.

**Phase 2 — Giờ làm cơ bản, Rotation Pattern, giao diện tiếng Nhật hoàn chỉnh**
- Mỗi nhân viên có **giờ làm cơ bản** (基本勤務時間) riêng, tự động áp dụng cho mọi ngày làm việc — không cần nhập tay từng ngày.
- Có thể **ghi đè giờ làm cho 1 ngày cụ thể** (ví dụ đổi giờ ngày 15/8) mà không ảnh hưởng các ngày khác.
- **Áp dụng Pattern (パターン適用)**: chọn 1 hoặc nhiều nhân viên, chọn 4勤2休/3勤2休/5勤2休, chọn ngày mốc → hệ thống tự tính và điền出勤/公休 cho cả khoảng thời gian, **không đè lên** các ngày đã xin 有休/調整休.
- Master Roster giờ hiển thị **toàn bộ ngày trong tháng kèm thứ (月火水木金土日)**, mỗi ô hiện đúng dạng `8-17`, `13-22`, `公休`, `有休`, `調整休` giống bảng chấm công thật.
- Toàn bộ giao diện chuyển sang **tiếng Nhật tự nhiên** (従業員管理, 月間勤務表, 日別スケジュール, Excel出力...) và **nền trắng, chữ đen/xám** theo phong cách hệ thống nghiệp vụ.
- Excel/PDF xuất ra giờ có thêm cột **giờ làm việc thực tế** đã tính toán.
- Không xoá/động vào dữ liệu nhân viên, Roster, DailyAssignment đã nhập trước đó — chỉ thêm field mới (nullable).

## Bạn cần chuẩn bị (đều có gói miễn phí để bắt đầu)

1. Tài khoản **GitHub** (github.com) — nơi chứa code.
2. Tài khoản **Neon** (neon.tech) hoặc **Supabase** (supabase.com) — database PostgreSQL miễn phí, không cần tự cài đặt server.
3. Tài khoản **Vercel** (vercel.com) — nơi host website, kết nối thẳng với GitHub, tự động deploy mỗi khi code cập nhật.

## Các bước triển khai (làm 1 lần)

### Bước A — Đưa code lên GitHub
1. Tạo 1 repository mới trên GitHub (private, để không ai ngoài công ty xem được), ví dụ tên `whill-scheduler`.
2. Tải toàn bộ code này lên (kéo-thả folder vào GitHub web, hoặc dùng GitHub Desktop — không cần biết dòng lệnh).

### Bước B — Tạo database
1. Vào Neon.tech (hoặc Supabase) → tạo project mới → copy **connection string** (dạng `postgresql://...`).
2. Lưu chuỗi này lại, sẽ dùng ở Bước D.

### Bước C — Kết nối GitHub với Vercel
1. Vào vercel.com → "Add New Project" → chọn repository `whill-scheduler` vừa tạo.
2. Vercel sẽ tự nhận diện đây là project Next.js.

### Bước D — Khai báo biến môi trường trên Vercel
Trong màn hình cấu hình project trên Vercel, thêm các biến (Environment Variables):

| Tên biến | Giá trị |
|---|---|
| `DATABASE_URL` | Connection string từ Bước B |
| `NEXTAUTH_URL` | URL website Vercel cấp cho bạn (vd `https://whill-scheduler.vercel.app`) |
| `NEXTAUTH_SECRET` | Một chuỗi bí mật ngẫu nhiên bất kỳ (vào https://generate-secret.vercel.app/32 để tạo) |

### Bước E — Deploy
1. Bấm "Deploy" trên Vercel.
2. Vercel sẽ **tự động tạo bảng trong database và tạo tài khoản Admin đầu tiên** trong lúc build (đã cấu hình sẵn trong code, không cần bạn hay tôi chạy lệnh gì thêm). Vài phút sau sẽ có link website chạy thật.

### Bước F — Đăng nhập lần đầu
- Email: `admin@pacificcrew.jp`
- Mật khẩu: `ChangeMe123!`
- **Đổi mật khẩu này ngay** sau khi đăng nhập lần đầu (tính năng đổi mật khẩu sẽ thêm ở Phase sau; tạm thời có thể nhờ tôi đổi trực tiếp trong database nếu cần gấp).

## Cấu trúc thư mục

```
whill-scheduler/
├── prisma/
│   ├── schema.prisma     # Toàn bộ cấu trúc database (14 bảng)
│   └── seed.ts           # Dữ liệu khởi tạo (Admin, loại ca, vị trí công việc)
├── src/
│   ├── app/
│   │   ├── login/        # Trang đăng nhập
│   │   ├── dashboard/    # Trang tổng quan
│   │   ├── employees/    # Quản lý nhân viên
│   │   └── api/          # API backend (auth, employees...)
│   ├── lib/               # Kết nối database + cấu hình đăng nhập
│   └── middleware.ts      # Chặn truy cập khi chưa đăng nhập
└── README.md              # File này
```

## Phase tiếp theo sẽ thêm gì
- **Phase 1**: màn hình Master Roster (lịch tháng) + Daily Assignment (lịch ngày theo slot 30 phút), xuất Excel/PDF.
- **Phase 2**: cảnh báo thiếu người/xung đột tự động.
- **Phase 3-4**: tự động tạo lịch (auto-assign) bằng thuật toán tối ưu.
