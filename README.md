# Chia sẻ vị trí bản đồ — Backend

Backend cho ứng dụng *Chia sẻ vị trí bản đồ*. Trước đây app chỉ đồng bộ giữa
các tab **cùng một trình duyệt** (qua `localStorage` + `BroadcastChannel`).
Backend này biến nó thành ứng dụng chia sẻ **thật giữa các thiết bị khác nhau**:
người tạo phiên gửi link, người ở máy/điện thoại khác mở link sẽ thấy bản đồ,
đường đi và vị trí chủ phiên **cập nhật realtime**.

- **REST API** — tạo/đọc phiên, upload ảnh bản đồ.
- **WebSocket** — đồng bộ thời gian thực (vị trí chủ phiên, đường đi, kết thúc phiên).
- **Serve frontend tĩnh** — phục vụ luôn file HTML, `support.js`, ảnh mẫu.
- **Chạy cross-platform** — chỉ cần Node.js ≥ 18 trên Linux hoặc Windows.
- **Lưu trữ file JSON** — mỗi phiên là một file trong `data/`, không cần database.

Khi mở app bằng `file://` (không có server), app tự động quay về chế độ
`localStorage` + `BroadcastChannel` như cũ — nên vẫn dùng offline được.

## Yêu cầu

- [Node.js](https://nodejs.org/) phiên bản 18 trở lên (khuyến nghị 20+).

## Chạy nhanh

### Linux / macOS
```sh
./start.sh
```

### Windows
```powershell
.\start.ps1
```
hoặc nhấp đúp `start.bat`.

Sau đó mở trình duyệt tại **http://localhost:3000**.

> Script sẽ tự `npm install` lần đầu. Nếu muốn tự làm:
> `npm install` rồi `npm start`.

## Truy cập từ thiết bị khác (điện thoại, máy khác trong LAN)

1. Tìm địa chỉ IP nội bộ của máy chủ (ví dụ `192.168.1.20`):
   - Linux/macOS: `ip addr` hoặc `ifconfig`
   - Windows: `ipconfig`
2. Trên thiết bị khác, mở `http://192.168.1.20:3000`.
3. Tạo phiên và chia sẻ link — thiết bị khác mở link sẽ đồng bộ realtime.

> Nhớ mở cổng 3000 trên tường lửa (xem `deploy/windows-service.md` cho Windows).
> Realtime dùng WebSocket cùng cổng, không cần cấu hình thêm.

## Cấu hình (biến môi trường)

| Biến           | Mặc định     | Ý nghĩa                                   |
|----------------|--------------|-------------------------------------------|
| `PORT`         | `3000`       | Cổng lắng nghe                            |
| `HOST`         | `0.0.0.0`    | Địa chỉ bind (`0.0.0.0` = mọi giao diện)  |
| `DATA_DIR`     | `./data`     | Nơi lưu file JSON của phiên               |
| `UPLOAD_DIR`   | `./uploads`  | Nơi lưu ảnh bản đồ được upload            |
| `MAX_UPLOAD_MB`| `10`         | Giới hạn dung lượng ảnh upload (MB)       |
| `AUTH_SECRET`  | *(tự sinh)*  | Khóa ký token đăng nhập. Nếu bỏ trống, tự sinh & lưu `data/.authsecret`. Đặt cố định khi chạy nhiều tiến trình/instance. |
| `TRUST_PROXY`  | `loopback`   | Cấu hình `trust proxy` của Express. Mặc định chỉ tin proxy loopback (nginx cùng máy) để client ngoài không giả mạo `X-Forwarded-For` né rate-limit. Đặt `true` nếu đứng sau proxy tin cậy khác, hoặc `false` khi expose trực tiếp. |
| `WS_MAX_PER_IP`| `60`         | Trần số kết nối WebSocket đồng thời cho mỗi IP (chống cạn socket). |

> Tài khoản người dùng lưu ở `data/users.json` (mật khẩu băm bằng scrypt).
> Cần **đăng nhập để tạo phiên**; người xem mở link không cần đăng nhập.

Ví dụ: `PORT=8080 node server.js`

## Docker

```sh
docker compose up -d --build
# hoặc thủ công:
docker build -t mapshare .
docker run -d -p 3000:3000 -v mapshare-data:/data mapshare
```
Dữ liệu phiên nằm trong volume `mapshare-data` (mount tại `/data`), không mất khi rebuild.

## Chạy nền như dịch vụ

- **Linux (systemd):** xem `deploy/mapshare.service`.
- **Windows (NSSM / Task Scheduler):** xem `deploy/windows-service.md`.

## Triển khai lên DigitalOcean

Script tạo server tự động (Node + nginx + systemd + HTTPS) nằm trong
`deploy/digitalocean/` — xem `deploy/digitalocean/README.md`.

```bash
# Cách nhanh nhất (cần doctl đã xác thực):
cd deploy/digitalocean && ./create-droplet.sh
```

## API tham khảo

| Method | Đường dẫn                | Mô tả                                          |
|--------|--------------------------|------------------------------------------------|
| GET    | `/api/health`            | Kiểm tra sống                                  |
| POST   | `/api/sessions`          | Tạo phiên (body = object phiên do client sinh) |
| GET    | `/api/sessions/:token`   | Đọc phiên (dùng để nạp lần đầu ở thiết bị khác)|
| PUT    | `/api/sessions/:token`   | Cập nhật phiên (cần header `x-owner-token`)    |
| POST   | `/api/upload`            | Upload ảnh bản đồ (multipart, field `image`)   |
| WS     | `/ws?token=…&ot=…`       | Kênh realtime (`ot` = owner token nếu là chủ)  |

### Mô hình bảo mật

Mặc định **ai có link người xem đều xem được phiên** — trừ khi chủ phiên **đặt
mật khẩu**: khi đó người xem phải nhập đúng mật khẩu thì server mới trả nội dung
phiên (`GET`) và cho mở kênh realtime (`WS`). Chủ phiên (có owner token) không cần
mật khẩu. Các điểm an toàn khác:

- Lệnh đặc quyền qua WebSocket (`owner` / `graph` / `end`) chỉ chấp nhận từ kết nối
  có **owner token hợp lệ** (băm `cyrb53` khớp frontend). Owner token nằm trong link
  chủ phiên — **giữ bí mật**.
- WebSocket chỉ nhận các loại message đã biết, có **rate-limit theo socket** và
  **trần kết nối theo IP** (`WS_MAX_PER_IP`) để chống flood/cạn tài nguyên.
- **Upload ảnh cần đăng nhập** — tránh người ẩn danh spam làm đầy đĩa.
- Người xem mở link vào phiên đã **kết thúc/hết hạn/xóa** sẽ bị chặn (kể cả khi còn
  bản cache cũ, app tự làm tươi trạng thái từ server).

## Lab: bản đồ thật miễn phí (thử nghiệm)

Ngoài chế độ ảnh tùy chỉnh hiện tại, dự án đang thử nghiệm **bản đồ thật** bằng các
thư viện/dịch vụ **miễn phí, không cần API key**: Leaflet + OpenStreetMap/Carto/Esri
(vệ tinh) + Geoman (vẽ) + OSRM (chỉ đường) + Nominatim (tìm địa chỉ) + Geolocation API (GPS).

- Mở thử tại **`http://localhost:3000/labs/map-libraries.html`** (server đã có route `/labs`).
  Demo: đổi lớp nền, lấy/gửi vị trí GPS + QR, tìm địa chỉ, chỉ đường A→B, vẽ & đo.
- Đánh giá thư viện + lộ trình tích hợp vào app chính: xem **`docs/MAP-LIBRARIES.md`**.
- ⚠️ Máy chủ công cộng OSRM/Nominatim chỉ dùng cho thử nghiệm (giới hạn tần suất);
  GPS cần **HTTPS**.

## Cấu trúc

```
server.js            # HTTP + REST + WebSocket + serve tĩnh
labs/map-libraries.html         # Lab thử bản đồ thật miễn phí (Leaflet+OSM+OSRM+Nominatim)
docs/MAP-LIBRARIES.md           # Đánh giá thư viện bản đồ miễn phí + lộ trình tích hợp
lib/store.js         # Lưu phiên dạng file JSON (ghi atomic, dọn hết hạn)
lib/hash.js          # cyrb53 — khớp chính xác hàm băm của frontend
package.json
Dockerfile, docker-compose.yml, .dockerignore
start.sh, start.bat, start.ps1
deploy/mapshare.service, deploy/windows-service.md
data/                # (tự tạo) file JSON của các phiên
uploads/             # ảnh bản đồ được upload
maps/aerial.jpg      # ảnh mẫu
Chia sẻ vị trí bản đồ.dc.html   # frontend (đã wire vào backend, có fallback offline)
support.js           # runtime render của frontend
```
