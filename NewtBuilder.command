#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/.newtbuilder_logs"
URL="http://127.0.0.1:5174/"

cd "$ROOT_DIR"
mkdir -p "$LOG_DIR"

if ! lsof -ti tcp:3334 >/dev/null 2>&1; then
  npm run server > "$LOG_DIR/server.log" 2>&1 &
fi

if ! lsof -ti tcp:5174 >/dev/null 2>&1; then
  npm run client > "$LOG_DIR/client.log" 2>&1 &
fi

for _ in {1..80}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

open "$URL"
