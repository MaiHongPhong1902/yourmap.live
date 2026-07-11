# Chạy Map-Share như dịch vụ nền trên Windows

Node không tự đăng ký làm Windows Service, nên dùng một trong các cách sau.

## Cách 1 — NSSM (khuyến nghị, đơn giản nhất)

[NSSM](https://nssm.cc/) bọc `node server.js` thành một Windows Service thật.

```powershell
# Tải nssm.exe rồi (chạy PowerShell với quyền Administrator):
nssm install MapShare "C:\Program Files\nodejs\node.exe" "C:\path\to\server.js"
nssm set MapShare AppDirectory "C:\path\to\Ứng dụng chia sẻ vị trí bản đồ"
nssm set MapShare AppEnvironmentExtra PORT=3000 HOST=0.0.0.0
nssm start MapShare

# Quản lý:
nssm restart MapShare
nssm stop MapShare
nssm remove MapShare confirm
```

## Cách 2 — Task Scheduler (không cần cài thêm)

1. Mở **Task Scheduler** → **Create Task**.
2. Tab **General**: chọn *Run whether user is logged on or not*.
3. Tab **Triggers**: New → *At startup*.
4. Tab **Actions**: New → Program = `node`, Arguments = `server.js`,
   Start in = thư mục dự án.
5. Lưu lại và nhập mật khẩu tài khoản khi được hỏi.

## Cách 3 — Chạy tay (thử nhanh / phát triển)

```powershell
.\start.ps1
```

Mở tường lửa nếu muốn truy cập từ máy/điện thoại khác trong mạng LAN:

```powershell
New-NetFirewallRule -DisplayName "MapShare 3000" -Direction Inbound `
  -Protocol TCP -LocalPort 3000 -Action Allow
```
