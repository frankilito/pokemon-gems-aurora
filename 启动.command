#!/bin/bash
# 宝可梦 宝石 · 极光大陆 — 本地启动
cd "$(dirname "$0")"
PORT=8944
if ! lsof -i :$PORT >/dev/null 2>&1; then
  (python3 -m http.server $PORT >/dev/null 2>&1 &)
  sleep 1
fi
open "http://localhost:$PORT/"
echo "游戏已启动: http://localhost:$PORT/  (关闭此窗口不影响游戏)"
