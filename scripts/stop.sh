#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== Stopping Next.js =="
if [ -f .next-dev.pid ]; then
  nd=$(cat .next-dev.pid || true)
  if [ -n "${nd:-}" ] && ps -p "$nd" >/dev/null 2>&1; then kill "$nd" || true; fi
fi

echo "== Stopping Python server =="
if [ -f .python-server.pid ]; then
  pd=$(cat .python-server.pid || true)
  if [ -n "${pd:-}" ] && ps -p "$pd" >/dev/null 2>&1; then kill "$pd" || true; fi
fi

# Force kill anything still on ports
sleep 1
for port in 3000 8000; do
  pids=$(lsof -ti tcp:$port || true)
  if [ -n "${pids:-}" ]; then kill -9 $pids || true; fi
done

echo "Done."

