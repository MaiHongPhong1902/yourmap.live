#!/usr/bin/env bash
#
# Cài Map-Share trên một Ubuntu droplet CÓ SẴN. CHẠY TRÊN DROPLET (quyền root).
#
# Dùng khi bạn tự tạo droplet Ubuntu 22.04/24.04 qua web console DigitalOcean,
# rồi SSH vào và chạy:
#
#   ssh root@<IP-droplet>
#   bash <(curl -fsSL https://raw.githubusercontent.com/MaiHongPhong1902/yourmap.live/main/deploy/digitalocean/setup-droplet.sh)
#
# hoặc clone repo rồi chạy trực tiếp file này.
#
set -euo pipefail

REPO="${REPO:-https://github.com/MaiHongPhong1902/yourmap.live.git}"
APP_DIR="${APP_DIR:-/opt/mapshare}"

echo ">> Cài gói hệ thống…"
apt-get update
apt-get install -y git nginx curl ca-certificates

echo ">> Cài Node.js 20 LTS…"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo ">> Lấy mã nguồn…"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi

echo ">> Cài dependencies…"
cd "$APP_DIR"
npm install --omit=dev

echo ">> Cấu hình dịch vụ systemd…"
cp "$APP_DIR/deploy/mapshare.service" /etc/systemd/system/mapshare.service
systemctl daemon-reload
systemctl enable --now mapshare

echo ">> Cấu hình nginx reverse proxy (hỗ trợ WebSocket)…"
cp "$APP_DIR/deploy/digitalocean/nginx-mapshare.conf" /etc/nginx/sites-available/mapshare
ln -sf /etc/nginx/sites-available/mapshare /etc/nginx/sites-enabled/mapshare
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

IP="$(curl -fsSL https://ipv4.icanhazip.com 2>/dev/null || echo '<IP-droplet>')"
echo
echo "==============================================================="
echo " Xong! Mở:  http://$IP/"
echo
echo " Bật HTTPS (sau khi trỏ tên miền về IP này):"
echo "   bash $APP_DIR/deploy/digitalocean/setup-https.sh yourmap.live"
echo
echo " Cập nhật code sau này:"
echo "   cd $APP_DIR && git pull && npm install --omit=dev && systemctl restart mapshare"
echo "==============================================================="
