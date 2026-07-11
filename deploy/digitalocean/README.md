# Triển khai Map-Share lên DigitalOcean

Kết quả: một server chạy Node + nginx (reverse proxy hỗ trợ WebSocket) + systemd,
tự khởi động lại khi lỗi, sẵn sàng bật HTTPS cho tên miền `yourmap.live`.

Chọn 1 trong 2 cách.

---

## Cách A — Tự động bằng `doctl` (khuyến nghị)

Tạo droplet mới đã cài sẵn mọi thứ, chạy **từ máy của bạn**:

```bash
# 1. Cài doctl + xác thực (một lần):
#    https://docs.digitalocean.com/reference/doctl/how-to/install/
doctl auth init

# 2. Thêm SSH key (nếu chưa):
doctl compute ssh-key import my-key --public-key-file ~/.ssh/id_rsa.pub

# 3. Tạo droplet (mặc định: Singapore, gói 1vCPU/1GB ~6$/tháng):
cd deploy/digitalocean
./create-droplet.sh
# hoặc tùy chỉnh:
REGION=sgp1 SIZE=s-1vcpu-1gb NAME=yourmap-live ./create-droplet.sh
```

Script in ra IP droplet. Cloud-init cài Node/nginx/app trong ~1–3 phút.
Xong thì mở `http://<IP>/`.

## Cách B — Thủ công (tạo droplet qua web console)

1. Tạo droplet **Ubuntu 24.04** trên [cloud.digitalocean.com](https://cloud.digitalocean.com).
2. SSH vào rồi chạy 1 lệnh:

```bash
ssh root@<IP-droplet>
bash <(curl -fsSL https://raw.githubusercontent.com/MaiHongPhong1902/yourmap.live/main/deploy/digitalocean/setup-droplet.sh)
```

---

## Bật HTTPS cho yourmap.live

1. Trong DigitalOcean → Networking → Domains (hoặc nhà cung cấp domain của bạn),
   tạo bản ghi **A**: `yourmap.live` → `<IP-droplet>` (và `www` nếu muốn).
2. Chờ DNS lan truyền, rồi chạy **trên droplet**:

```bash
ssh root@<IP-droplet>
bash /opt/mapshare/deploy/digitalocean/setup-https.sh yourmap.live www.yourmap.live
```

certbot sẽ xin chứng chỉ Let's Encrypt, tự chuyển hướng HTTP→HTTPS và tự gia hạn.
WebSocket realtime tự dùng `wss://` khi đã có HTTPS (không cần chỉnh gì thêm).

---

## Vận hành

| Việc | Lệnh (trên droplet) |
|------|---------------------|
| Xem log app | `journalctl -u mapshare -f` |
| Xem log cài đặt cloud-init | `tail -f /var/log/cloud-init-output.log` |
| Khởi động lại app | `systemctl restart mapshare` |
| Cập nhật code | `cd /opt/mapshare && git pull && npm install --omit=dev && systemctl restart mapshare` |
| Trạng thái | `systemctl status mapshare` |

Dữ liệu phiên nằm ở `/opt/mapshare/data`, ảnh upload ở `/opt/mapshare/uploads`.

## Firewall (khuyến nghị)

```bash
doctl compute firewall create --name mapshare-fw \
  --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0 protocol:tcp,ports:80,address:0.0.0.0/0 protocol:tcp,ports:443,address:0.0.0.0/0" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0 protocol:udp,ports:all,address:0.0.0.0/0" \
  --tag-names mapshare
```

Cổng ứng dụng 3000 **không** cần mở ra ngoài — nginx đã proxy qua 80/443.
