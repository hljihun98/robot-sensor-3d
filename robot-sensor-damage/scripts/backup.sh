#!/usr/bin/env bash
# 매일 백업(crontab -e 에 추가):  0 3 * * * /srv/robot-sensor-damage/scripts/backup.sh >> /var/log/rsd-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
node --disable-warning=ExperimentalWarning server/backup.js 7
