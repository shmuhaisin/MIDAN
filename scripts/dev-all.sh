#!/usr/bin/env bash
# One command for the whole MIDAN development platform, on ONE local environment:
#   Postgres (127.0.0.1, the port in DATABASE_URL) → local Supabase gateway (Auth, REST, Storage, mail sink :54321)
#   → AI service (:8000) → Core API (:4000) → web app (:3100, the address the verification emails link to).
#
#   scripts/dev-all.sh            build, start everything, wait until each service answers, then stay in the foreground
#   SKIP_BUILD=1 scripts/dev-all.sh   start without rebuilding the API and web app
#   scripts/dev-all.sh --stop     stop what this script started (by port)
#
# Safety: it refuses to run unless .env points the database at this machine, so local and hosted (production) data are
# never mixed. It never seeds, resets or migrates a hosted database. Logs: .local/logs/*.log.
set -euo pipefail
# Each service has a fixed port; a PORT set by the caller (a process manager) would move the API off 4000.
unset PORT
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOGS="$ROOT/.local/logs"; mkdir -p "$LOGS"
PORTS=(3100 4000 8000 54321)

stop_ports() {
  for p in "${PORTS[@]}"; do for pid in $(lsof -tnP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done; done
}
if [ "${1:-}" = "--stop" ]; then stop_ports; echo "Stopped MIDAN services on ${PORTS[*]}."; exit 0; fi

# Only the host part of the database URL is read; no value is printed.
db_host() { node -e "const {parseEnv}=require('node:util');const e=parseEnv(require('node:fs').readFileSync('.env','utf8'));try{console.log(new URL(e[process.argv[1]]||'').hostname)}catch{console.log('')}" "$1"; }
for key in DATABASE_URL DIRECT_URL; do
  host="$(db_host "$key")"
  if [ "$host" != "127.0.0.1" ] && [ "$host" != "localhost" ]; then
    echo "Refusing to start: $key in .env points to '$host', not this machine. This script runs the local development stack only." >&2
    exit 1
  fi
done

wait_url() { for _ in $(seq 1 120); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; echo "Timed out waiting for $1 (see $LOGS)" >&2; return 1; }
up() { curl -s -o /dev/null "$1"; }

echo "• Database"
# The database the app uses is the one the scripts start and migrate: its port comes from DATABASE_URL.
LOCAL_PG_PORT="$(node -e "const {parseEnv}=require('node:util');const e=parseEnv(require('node:fs').readFileSync('.env','utf8'));console.log(new URL(e.DATABASE_URL).port||5432)")"
export LOCAL_PG_PORT
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || echo /opt/homebrew/opt/postgresql@16/bin/pg_ctl)")}"
# Already running (for example started by another checkout): use it; otherwise start it.
if "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$LOCAL_PG_PORT" 2>/dev/null; then echo "already running on $LOCAL_PG_PORT" > "$LOGS/db.log"
else scripts/local-db.sh start > "$LOGS/db.log" 2>&1; fi
scripts/local-db.sh migrate >> "$LOGS/db.log" 2>&1
tail -1 "$LOGS/db.log"

echo "• Supabase gateway (Auth, REST, Storage, mail sink)"
if ! up http://localhost:54321/auth/v1/health; then nohup node scripts/local-supabase.mjs > "$LOGS/gateway.log" 2>&1 & fi
wait_url http://localhost:54321/auth/v1/health

if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "• Building the API and the web app"
  npm run build -w @midan/api > "$LOGS/build-api.log" 2>&1
  (cd apps/web && npx next build > "$LOGS/build-web.log" 2>&1)
fi

echo "• AI service"
if ! up http://localhost:8000/health; then
  (cd services/ai && nohup uv run --extra matching --env-file ../../.env uvicorn midan_ai.main:app --port 8000 > "$LOGS/ai.log" 2>&1 &)
fi
wait_url http://localhost:8000/health

echo "• Core API"
if ! up http://localhost:4000/v1/health; then nohup node apps/api/dist/main.js > "$LOGS/api.log" 2>&1 & fi
wait_url http://localhost:4000/v1/health

echo "• Web app"
if ! up http://localhost:3100/en; then (cd apps/web && nohup npx next start -p 3100 > "$LOGS/web.log" 2>&1 &); fi
wait_url http://localhost:3100/en

ai="$(curl -s http://localhost:8000/health)"
cat <<EOF

MIDAN is running on one local environment:
  Website        http://localhost:3100
  API            http://localhost:4000/v1   (docs: /v1/docs)
  AI service     http://localhost:8000      $(echo "$ai" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const h=JSON.parse(s);console.log('('+h.mode+(h.provider?' · '+h.provider:'')+(h.matching?' · matching '+h.matching:'')+')')}catch{console.log('')}})")
  Auth + storage http://localhost:54321
  Email inbox    http://localhost:54321/__mail   (verification and reset emails)
Logs: $LOGS. Stop with: scripts/dev-all.sh --stop
EOF

# Stay in the foreground so a process manager (or a terminal) keeps the stack alive; Ctrl+C stops it.
trap 'stop_ports; exit 0' INT TERM
while up http://localhost:3100/en && up http://localhost:4000/v1/health; do sleep 15; done
echo "A service stopped answering; see $LOGS." >&2
exit 1
