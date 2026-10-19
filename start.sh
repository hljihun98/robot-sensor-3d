#!/usr/bin/env sh
# 실행 관리 홈페이지 열기 (macOS·Linux): ./start.sh  → http://127.0.0.1:8080
set -eu
cd "$(dirname "$0")"
exec node launcher/server.js --open
