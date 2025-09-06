#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== Stopping previous dev servers (if any) =="
if [ -f .next-dev.pid ]; then
  nd=$(cat .next-dev.pid || true)
  if [ -n "${nd:-}" ] && ps -p "$nd" >/dev/null 2>&1; then kill "$nd" || true; fi
fi
uvp=$(lsof -ti tcp:8000 || true)
if [ -n "${uvp:-}" ]; then kill $uvp || true; fi

echo "== Starting Next.js (pnpm dev) =="
: > .next-dev.log
nohup pnpm -s dev >> .next-dev.log 2>&1 &
echo $! > .next-dev.pid

echo "== Starting Python server (uvicorn) =="
: > .python-server.log

# Prefer project venv if available
PY_EXE="python3"
if [ -x python-server/.venv/bin/python ]; then
  PY_EXE="$(pwd)/python-server/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY_EXE="python3"
elif command -v python >/dev/null 2>&1; then
  PY_EXE="python"
else
  echo "ERROR: Neither python3 nor python found in PATH" >&2
  exit 1
fi

( cd python-server && nohup "$PY_EXE" -m uvicorn app:app \
    --host 0.0.0.0 --port 8000 --reload --log-level info \
    >> ../.python-server.log 2>&1 & echo $! > ../.python-server.pid )

echo -n "Waiting for servers"; tries=0
until curl -sS -m 1 -o /dev/null -w '%{http_code}' http://localhost:3000 | rg -q '200'; do
  sleep 1; echo -n .; tries=$((tries+1)); [ $tries -ge 25 ] && break
done
tries=0
until curl -sS -m 1 http://localhost:8000/health | rg -q '"status"\s*:\s*"healthy"'; do
  sleep 1; echo -n .; tries=$((tries+1)); [ $tries -ge 25 ] && break
done
echo

echo "Next.js pid: $(cat .next-dev.pid)"
echo "Python  pid: $(cat .python-server.pid 2>/dev/null || echo '-')"
echo "Public URL:  ${PUBLIC_BASE_URL:-'(not set)'}"
