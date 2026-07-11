#!/usr/bin/env bash
#
# Tạo một droplet DigitalOcean đã cài sẵn Map-Share (Node + nginx + systemd).
#
# Yêu cầu trên MÁY CỦA BẠN:
#   1. doctl đã cài:      https://docs.digitalocean.com/reference/doctl/how-to/install/
#   2. Đã xác thực:       doctl auth init      (dán API token của DigitalOcean)
#   3. Đã thêm SSH key vào DigitalOcean:  doctl compute ssh-key list
#      (nếu chưa: doctl compute ssh-key import my-key --public-key-file ~/.ssh/id_rsa.pub)
#
# Dùng:
#   ./create-droplet.sh
#   REGION=sgp1 SIZE=s-1vcpu-1gb NAME=yourmap-live ./create-droplet.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REGION="${REGION:-sgp1}"                 # sgp1 = Singapore (gần VN nhất)
SIZE="${SIZE:-s-1vcpu-1gb}"              # gói nhỏ nhất, ~6$/tháng
IMAGE="${IMAGE:-ubuntu-24-04-x64}"
NAME="${NAME:-yourmap-live}"
CLOUD_INIT="${CLOUD_INIT:-$SCRIPT_DIR/cloud-init.yaml}"

command -v doctl >/dev/null 2>&1 || { echo "Lỗi: chưa cài doctl."; exit 1; }

# Lấy tất cả SSH key đã đăng ký (để có thể ssh vào droplet).
SSH_KEYS="${SSH_KEYS:-$(doctl compute ssh-key list --format ID --no-header | paste -sd, -)}"
if [ -z "$SSH_KEYS" ]; then
  echo "Lỗi: chưa có SSH key nào trên DigitalOcean."
  echo "  Thêm bằng: doctl compute ssh-key import my-key --public-key-file ~/.ssh/id_rsa.pub"
  exit 1
fi

echo "Đang tạo droplet '$NAME' ($SIZE, $REGION, $IMAGE)…"
doctl compute droplet create "$NAME" \
  --region "$REGION" \
  --size "$SIZE" \
  --image "$IMAGE" \
  --ssh-keys "$SSH_KEYS" \
  --user-data-file "$CLOUD_INIT" \
  --tag-name mapshare \
  --wait \
  --format ID,Name,PublicIPv4,Status

IP="$(doctl compute droplet list --tag-name mapshare --format PublicIPv4 --no-header | tail -1)"

echo
echo "==============================================================="
echo " Droplet đã tạo. IP: $IP"
echo " Cloud-init đang cài Node/nginx/app trong ~1-3 phút."
echo
echo " Kiểm tra tiến trình cài đặt:"
echo "   ssh root@$IP 'tail -f /var/log/cloud-init-output.log'"
echo
echo " Khi xong, mở:  http://$IP/"
echo
echo " Trỏ tên miền yourmap.live -> $IP (bản ghi A), rồi bật HTTPS:"
echo "   ssh root@$IP 'bash /opt/mapshare/deploy/digitalocean/setup-https.sh yourmap.live'"
echo "==============================================================="
