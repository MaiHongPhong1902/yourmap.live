#!/usr/bin/env bash
#
# Bật HTTPS (Let's Encrypt) cho Map-Share. CHẠY TRÊN DROPLET.
#
# Điều kiện: tên miền đã trỏ bản ghi A về IP của droplet này.
#
# Dùng:
#   bash setup-https.sh yourmap.live
#   bash setup-https.sh yourmap.live www.yourmap.live
#
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Cách dùng: $0 <domain> [domain2 ...]"
  exit 1
fi

DOMAINS=("$@")
EMAIL="${EMAIL:-admin@${DOMAINS[0]}}"

# Cập nhật server_name trong config nginx theo domain.
NAMES="${DOMAINS[*]}"
sed -i "s/server_name _;/server_name ${NAMES};/" /etc/nginx/sites-available/mapshare
nginx -t && systemctl reload nginx

# Cài certbot và xin chứng chỉ (tự sửa nginx để redirect 80 -> 443).
apt-get update
apt-get install -y certbot python3-certbot-nginx

CERTBOT_ARGS=()
for d in "${DOMAINS[@]}"; do CERTBOT_ARGS+=(-d "$d"); done

certbot --nginx "${CERTBOT_ARGS[@]}" \
  --non-interactive --agree-tos -m "$EMAIL" --redirect

echo
echo "HTTPS đã bật. Mở: https://${DOMAINS[0]}/"
echo "Chứng chỉ tự gia hạn qua systemd timer của certbot."
