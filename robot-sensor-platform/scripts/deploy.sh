#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
node scripts/backup.js
git pull --ff-only
npm ci --omit=dev --no-audit --no-fund
pm2 reload deploy/ecosystem.config.cjs --update-env
