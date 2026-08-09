#!/usr/bin/env bash
# restart_web.sh — 重启本地手语网页服务：停旧端口 → 起新端口（递增），
# 确保浏览器打开的一定是最新版本（无缓存/旧进程残留）。
# 端口记录在 /tmp/smoke/web_port，每次 +1。
set -euo pipefail

WEB_DIR="/data/WYC/sign-language-universe/apps/web"
PORT_FILE="/tmp/smoke/web_port"
CURRENT_PORT="$(cat "${PORT_FILE}" 2>/dev/null || echo 8090)"
NEW_PORT=$((CURRENT_PORT + 1))

# 1. 停旧端口（fuser 精确杀监听进程）
if fuser -k "${CURRENT_PORT}/tcp" >/dev/null 2>&1; then
  echo "已停旧服务: :${CURRENT_PORT}"
fi
sleep 1

# 2. 起新端口（serve_nocache：响应带 no-store，杜绝浏览器缓存旧版）
setsid nohup python3 "${WEB_DIR}/../../scripts/serve_nocache.py" --port "${NEW_PORT}" --dir "${WEB_DIR}" \
  > "/tmp/smoke/http_${NEW_PORT}.log" 2>&1 &
sleep 2

# 3. 验证 + 记录
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${NEW_PORT}/index.html")
if [ "${HTTP_CODE}" = "200" ]; then
  echo "${NEW_PORT}" > "${PORT_FILE}"
  echo "✅ 新服务已启动: http://127.0.0.1:${NEW_PORT}/index.html (HTTP ${HTTP_CODE})"
  echo "旧端口 :${CURRENT_PORT} 已停止"
else
  echo "❌ 新端口启动失败 (HTTP ${HTTP_CODE})，检查 /tmp/smoke/http_${NEW_PORT}.log"
  exit 1
fi
