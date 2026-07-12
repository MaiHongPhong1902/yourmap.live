# Thư viện & dịch vụ bản đồ MIỄN PHÍ — đánh giá cho dự án

> Mục tiêu: thử các thư viện bản đồ / vẽ map / chia sẻ vị trí **miễn phí** để cải thiện dự án.
> Toàn bộ URL/endpoint dưới đây đã được **kiểm tra trả HTTP 200** (không cần API key) tại thời điểm viết.

## 1. Hiện trạng & khoảng trống

App hiện dùng **ảnh tĩnh (`maps/aerial.jpg`) + đồ thị vẽ tay** (nodes/edges dạng tỉ lệ `xRatio,yRatio`) và
tự định tuyến trên đồ thị đó. Ưu điểm: hoạt động cho **bản đồ tùy chỉnh / trong nhà** (toà nhà, khuôn viên,
sự kiện) nơi bản đồ thật không có dữ liệu. Nhược điểm:

- **Không có GPS thật** — ảnh chưa georeference nên `getCurrentPosition` không map được sang toạ độ ảnh
  (chính là lý do có toast `gpsUnavailable`).
- Không tìm địa chỉ, không có đường phố/địa hình/vệ tinh thật, không định tuyến theo đường thật.

➡️ **Cải thiện chiến lược:** thêm **chế độ "bản đồ thật"** (Leaflet + OpenStreetMap) **song song** với chế độ
ảnh tùy chỉnh hiện có. Tất cả bằng dịch vụ miễn phí, không API key.

## 2. So sánh thư viện bản đồ (JS, mã nguồn mở)

| | **Leaflet** | **MapLibre GL JS** | **OpenLayers** |
|---|---|---|---|
| Phiên bản ổn định | 1.9.4 | 4.x | 9–10.x |
| Kích thước (gzip) | ~42 KB | ~200 KB+ | ~150 KB+ |
| Render | DOM/Canvas (tile raster) | WebGL (vector tiles) | Canvas/WebGL |
| Giấy phép | BSD-2 | BSD-3 | BSD-2 |
| Hệ sinh thái plugin | **Rất lớn** | Trung bình | Lớn |
| Hợp với app này | ✅ **Tốt nhất** | Nặng, cần vector tiles (thường cần key) | Mạnh nhưng API cồng kềnh |

**Chọn Leaflet** vì: nhẹ, không cần build step (nạp qua CDN như React hiện tại), API đơn giản khớp mô hình
marker/polyline sẵn có, và có sẵn plugin vẽ (Geoman) + routing.

## 3. Lớp nền (tiles) MIỄN PHÍ — không cần key ✅ (đã test 200)

| Lớp | URL mẫu | Ghi chú / điều khoản |
|---|---|---|
| OSM đường phố | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` | Chuẩn, **giới hạn dùng nhẹ**, không pre-fetch, cần `User-Agent`/`Referer`; ghi công OSM |
| Carto sáng/tối | `https://{s}.basemaps.cartocdn.com/{light,dark}_all/{z}/{x}/{y}{r}.png` | Không cần token NHƯNG **điều khoản hạn chế** (chính thức chỉ miễn phí cho non-profit/enterprise) — OK cho dev, cân nhắc khi production |
| **Vệ tinh (Esri)** | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | **Lựa chọn vệ tinh key-free duy nhất**; ToS: tài khoản ArcGIS free + app **phi lợi nhuận**; bản ArcGIS mới cần key |
| Địa hình | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` | CC-BY-SA, giới hạn tần suất |
| OSM-France/HOT | `https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png` | Key-free, style nhân đạo; ghi công OSM + HOT |

> Muốn ổn định/không lo điều khoản khi lên production: dùng **free tier có key** (MapTiler, Stadia, Thunderforest)
> hoặc tự host tiles. Cho dev/demo, các URL trên đủ dùng.

## 4. Dịch vụ miễn phí khác (không key) ✅ (đã test 200)

- **Định tuyến — OSRM demo** (FOSSGIS, mirror `routing.openstreetmap.de`): `https://router.project-osrm.org/route/v1/driving/{lon,lat};{lon,lat}?overview=full&geometries=geojson`
  → `routes[0].geometry` (GeoJSON), `distance` (m), `duration` (s). Profile: driving/bike/foot. ⚠️ Máy chủ demo
  **chỉ cho thử nghiệm/phi thương mại, ~1 req/s, không SLA**. Toạ độ theo thứ tự **lon,lat**. Production: self-host
  OSRM/Valhalla (Docker) hoặc dùng free-tier có key. (FOSSGIS cũng có demo Valhalla/GraphHopper key-free, cùng ràng buộc.)
- **Tìm địa chỉ — Nominatim**: `https://nominatim.openstreetmap.org/search?format=jsonv2&q=...&limit=5`
  (đảo ngược: `/reverse?format=jsonv2&lat=..&lon=..`). ⚠️ **Tối đa 1 request/giây**, phải có `Referer`/`User-Agent`
  nhận diện app (trình duyệt tự gửi `Referer`), **phải cache** kết quả, cấm bulk.
- **Vẽ/chỉnh sửa — Leaflet-Geoman (free)**: `@geoman-io/leaflet-geoman-free@2.20.0` — vẽ điểm/đường/vùng/hình,
  kéo chỉnh, snapping; MIT, **đang được bảo trì tích cực**. (Thay cho Leaflet.draw đã ngừng bảo trì từ 2019.)
- **Tìm địa chỉ thay thế — Photon (komoot)**: `https://photon.komoot.io/api/?q=...&limit=5` (GeoJSON), key-free,
  fair-use. Dùng khi cần phương án ngoài Nominatim.
- **GPS — Web Geolocation API**: `navigator.geolocation.getCurrentPosition` / `watchPosition`. Miễn phí, có sẵn,
  **yêu cầu HTTPS** (hoặc `localhost`) và người dùng cấp quyền. `watchPosition` = chia sẻ vị trí realtime.
- **QR**: `qrcode-generator@1.4.4` (app đã dùng) để tạo QR cho link chia sẻ.

## 5. Prototype đã dựng — `labs/map-libraries.html`

Mở tại: **`/labs/map-libraries.html`** (server đã thêm route tĩnh `/labs`). Trang tự chứa, demo **toàn bộ stack
miễn phí trên bản đồ thật**:

1. **Đổi lớp nền**: đường phố / sáng / tối / **vệ tinh** / địa hình.
2. **Chia sẻ vị trí (GPS)**: lấy vị trí + theo dõi realtime; nút **tạo link chia sẻ** (mã hoá `#loc=lat,lng&z=`) + **QR**;
   mở lại link sẽ đặt marker "vị trí được chia sẻ".
3. **Tìm địa chỉ** (Nominatim, tôn trọng giới hạn 1 req/s).
4. **Chỉ đường A→B** (OSRM) — vẽ tuyến, hiện **km + phút**; tự dùng vị trí GPS làm điểm A nếu có.
5. **Vẽ / đo** (Geoman) — vẽ đường/khu vực/điểm, hiện **độ dài / diện tích**.

> Đã kiểm chứng: route `/labs/...` trả HTTP 200; HTML + JS hợp lệ; mọi dịch vụ ngoài trả 200 khi probe.
> Chưa kiểm thử trực quan trong trình duyệt ở phiên nền (extension Chrome không kết nối) — hãy mở thử để xác nhận UI.

## 6. Lộ trình tích hợp vào app chính (đề xuất, theo giai đoạn)

**G1 — Thêm "nguồn bản đồ = Bản đồ thật":** ở bước chọn map (create), thêm lựa chọn thứ 3 ngoài "ảnh mẫu"/"tải ảnh".
Khi chọn, `mapMode='geo'`; render bằng Leaflet thay cho `<img>`+SVG.

**G2 — Mô hình toạ độ:** hiện dùng tỉ lệ ảnh `{xRatio,yRatio}`. Ở chế độ geo, dùng `{lat,lng}` trực tiếp. Thêm
trường `mapMode` vào session; các pin owner/viewer mang `lat,lng`. WebSocket giữ nguyên (chỉ đổi payload toạ độ) —
backend không cần đổi (đã cap mảng, không quan tâm nội dung điểm).

**G3 — GPS thật:** ở chế độ geo, `watchPosition` của viewer/owner phát vị trí realtime qua WS (đã có sẵn kênh
`owner`/`ping`). Đây là điểm nâng cấp lớn nhất so với chế độ ảnh.

**G4 — Chỉ đường:** thay thuật toán đồ thị tay bằng OSRM cho chế độ geo (giữ thuật toán cũ cho chế độ ảnh).

**G5 — Tìm địa chỉ:** thêm ô tìm Nominatim để owner đặt nhanh vị trí/điểm quan tâm.

**Lưu ý sản xuất:** (a) OSRM/Nominatim công cộng không dùng cho tải nặng → khi scale cần self-host hoặc free tier có key;
(b) bắt buộc ghi công theo từng nhà cung cấp tile; (c) GPS cần HTTPS (deploy đã có HTTPS theo `deploy/`).

## 7. Kết luận — stack miễn phí đề xuất

**Leaflet + OSM/Carto/Esri tiles + Geoman (vẽ) + OSRM (chỉ đường) + Nominatim (tìm địa chỉ) + Geolocation API (GPS) + qrcode (chia sẻ).**
Không API key cho dev/demo; khi lên production chỉ cần cân nhắc self-host hoặc free-tier-có-key cho OSRM/Nominatim/tiles
để đảm bảo điều khoản và độ ổn định.
