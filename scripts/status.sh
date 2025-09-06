#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== PIDs =="
printf "Next.js:    "; [ -f .next-dev.pid ] && cat .next-dev.pid || echo "-"
printf "Python:     "; [ -f .python-server.pid ] && cat .python-server.pid || echo "-"

echo "\n== Health =="
printf "Frontend:   "; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000 || true
printf "Python:     "; curl -s http://localhost:8000/health || echo "(no response)"

