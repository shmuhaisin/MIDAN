#!/usr/bin/env bash
# Starts the whole local demo in the background, from this checkout only, and says where it is.
#   scripts/demo-up.sh          start (after a build: npm run build -w @midan/api && npm run build -w @midan/web)
#   scripts/demo-up.sh stop     stop what this script started (only processes running from this checkout)
# Local stack only: it refuses a .env that points anywhere but localhost. Logs: .local/demo/logs/.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
LOGS=.local/demo/logs
mkdir -p "$LOGS"

ours() { for pid in $(lsof -tnP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null); do lsof -a -p "$pid" -d cwd -Fn | grep -q "^n$ROOT" && echo "$pid"; done; }

if [ "${1:-}" = "stop" ]; then
  for port in 3100 4000 8000 54321; do for pid in $(ours $port); do kill "$pid" && echo "stopped port $port ($pid)"; done; done
  scripts/local-db.sh stop >/dev/null 2>&1 || true
  echo "Demo stopped."; exit 0
fi

grep -qE '^NEXT_PUBLIC_SUPABASE_URL=http://(localhost|127\.0\.0\.1)' .env && grep -qE '^API_URL=http://(localhost|127\.0\.0\.1)' .env \
  || { echo "This .env doesn't point at the local stack. Refusing."; exit 1; }
[ -f apps/api/dist/main.js ] && [ -d apps/web/.next ] || { echo "Build first: npm run build -w @midan/api && npm run build -w @midan/web"; exit 1; }

wait_for() { for _ in $(seq 1 90); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; echo "Not answering: $1 (see $LOGS)"; return 1; }
up() { curl -s -o /dev/null "$1"; }

scripts/local-db.sh start >/dev/null
up http://localhost:54321/auth/v1/health || nohup node scripts/local-supabase.mjs >"$LOGS/gateway.log" 2>&1 &
wait_for http://localhost:54321/auth/v1/health
up http://localhost:8000/health || (cd services/ai && nohup uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000 >"$ROOT/$LOGS/ai.log" 2>&1 &)
wait_for http://localhost:8000/health
up http://localhost:4000/v1/jobs || nohup node apps/api/dist/main.js >"$LOGS/api.log" 2>&1 &
wait_for http://localhost:4000/v1/jobs
up http://localhost:3100/ar || (cd apps/web && nohup npx next start -p 3100 >"$ROOT/$LOGS/web.log" 2>&1 &)
wait_for http://localhost:3100/ar

echo "Demo running: http://localhost:3100/ar"
echo "AI service: $(curl -s http://localhost:8000/health)"
echo "Logins: .local/demo/ACCOUNTS.md (run node scripts/demo-seed.mjs once to create the demo data)."
