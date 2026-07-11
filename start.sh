#!/usr/bin/env sh
# Khởi động backend trên Linux/macOS.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Đang cài dependencies…"
  npm install --omit=dev
fi

export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"
echo "Khởi động Map-Share tại http://$HOST:$PORT"
exec node server.js
