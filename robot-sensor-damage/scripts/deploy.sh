#!/usr/bin/env bash
# 서버에서 최신 코드로 업데이트: ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci --omit=dev
if command -v systemctl >/dev/null && systemctl list-unit-files | grep -q robot-sensor-damage; then
  sudo systemctl restart robot-sensor-damage
  echo "재시작 완료 (systemd)"
elif command -v pm2 >/dev/null; then
  pm2 reload robot-sensor-damage 2>/dev/null || pm2 start npm --name robot-sensor-damage -- start
  echo "재시작 완료 (pm2)"
else
  echo "코드는 받았습니다. 서버를 직접 다시 시작하세요: npm start"
fi
