#!/usr/bin/env bash
# One command for the whole MIDAN development platform, on ONE environment at a time.
#
# Local (default): Postgres (127.0.0.1, the port in DATABASE_URL) → local Supabase gateway (Auth, REST, Storage, mail sink
#   :54321) → AI service (:8000) → Core API (:4000) → web app (:3100). Reads .env, which must point at this machine.
# Cloud (--cloud): Supabase Cloud for the database, Auth and Storage; only the AI service, API and web app run here.
#   Reads .env.cloud (git-ignored), whose database and Supabase URL must belong to the same cloud project. Nothing local
#   (Postgres, gateway, mail sink) is started, and it never migrates, seeds or resets the cloud database.
#
#   scripts/dev-all.sh                 local: build, start everything, wait until each service answers, stay in the foreground
#   scripts/dev-all.sh --cloud         the same against Supabase Cloud
#   SKIP_BUILD=1 scripts/dev-all.sh    start without rebuilding (the build is redone anyway when the mode changed)
#   scripts/dev-all.sh --stop          stop what this script started (by port)
#
# Logs: .local/logs/*.log.
set -euo pipefail
# Each service has a fixed port; a PORT set by the caller (a process manager) would move the API off 4000.
unset PORT
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOGS="$ROOT/.local/logs"; mkdir -p "$LOGS"
PORTS=(3100 4000 8000 54321)

stop_ports() {
  for p in "${PORTS[@]}"; do for pid in $(lsof -tnP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done; done
  # lsof doesn't always see next-server's socket (seen in a Linux container): a web server left running would keep serving
  # the previous build's pages, whose scripts and styles the new build has replaced (404). This checkout's own Next.js
  # processes are stopped by their working directory as well (Linux /proc; elsewhere this finds nothing).
  for pid in $(pgrep -f 'next-server|next start -p 3100' 2>/dev/null); do
    [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$ROOT/apps/web" ] && kill "$pid" 2>/dev/null || true
  done
}
MODE=local
case "${1:-}" in
  --stop) stop_ports; echo "Stopped MIDAN services on ${PORTS[*]}."; exit 0 ;;
  --cloud) MODE=cloud ;;
  "") ;;
  *) echo "usage: $0 [--cloud|--stop]" >&2; exit 2 ;;
esac
ENV_FILE="$ROOT/.env"; [ "$MODE" = cloud ] && ENV_FILE="$ROOT/.env.cloud"
[ -f "$ENV_FILE" ] || { echo "Missing $(basename "$ENV_FILE")." >&2; exit 1; }

# Only host names are read; no value is printed.
envhost() { node -e "const {parseEnv}=require('node:util');const e=parseEnv(require('node:fs').readFileSync(process.argv[1],'utf8'));try{console.log(new URL(e[process.argv[2]]||'').hostname)}catch{console.log('')}" "$ENV_FILE" "$1"; }
db_user() { node -e "const {parseEnv}=require('node:util');const e=parseEnv(require('node:fs').readFileSync(process.argv[1],'utf8'));try{console.log(decodeURIComponent(new URL(e[process.argv[2]]||'').username))}catch{console.log('')}" "$ENV_FILE" "$1"; }
is_local() { [ "$1" = "127.0.0.1" ] || [ "$1" = "localhost" ]; }

if [ "$MODE" = local ]; then
  for key in DATABASE_URL DIRECT_URL NEXT_PUBLIC_SUPABASE_URL; do
    is_local "$(envhost "$key")" || { echo "Refusing to start: $key in .env points away from this machine. For Supabase Cloud use --cloud." >&2; exit 1; }
  done
else
  # Database, Auth and Storage must be one cloud project: never local Auth with cloud records, or the other way round.
  api="$(envhost NEXT_PUBLIC_SUPABASE_URL)"; ref="${api%%.supabase.co}"
  [ "$ref" != "$api" ] && [ -n "$ref" ] || { echo "Refusing to start: NEXT_PUBLIC_SUPABASE_URL in .env.cloud isn't a supabase.co project." >&2; exit 1; }
  for key in DATABASE_URL DIRECT_URL; do
    host="$(envhost "$key")"; user="$(db_user "$key")"
    if [ "$host" = "db.$ref.supabase.co" ] || { [[ "$host" == *.pooler.supabase.com ]] && [ "$user" = "postgres.$ref" ]; }; then continue; fi
    echo "Refusing to start: $key in .env.cloud isn't the database of project $ref." >&2; exit 1
  done
  if grep -qE '^[[:space:]]*CHECKPOINT_DATABASE_URL=.+' "$ENV_FILE"; then
    is_local "$(envhost CHECKPOINT_DATABASE_URL)" && { echo "Refusing to start: CHECKPOINT_DATABASE_URL in .env.cloud is local." >&2; exit 1; }
  fi
fi
run() { node "$ROOT/scripts/with-env.mjs" "$ENV_FILE" -- "$@"; }

wait_url() { for _ in $(seq 1 120); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; echo "Timed out waiting for $1 (see $LOGS)" >&2; return 1; }
up() { curl -s -o /dev/null "$1"; }

# A service already answering on its port may belong to the other mode: stop them all when the mode changes.
MODE_FILE="$ROOT/.local/dev-all.mode"
if [ "$(cat "$MODE_FILE" 2>/dev/null || echo none)" != "$MODE" ]; then
  stop_ports; rm -f "$MODE_FILE"; FORCE_BUILD=1; sleep 1
fi

if [ "$MODE" = local ]; then
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
else
  echo "• Supabase Cloud project $ref (database, Auth, Storage): nothing local is started"
fi

if [ "${SKIP_BUILD:-}" != "1" ] || [ "${FORCE_BUILD:-}" = "1" ]; then
  echo "• Building the API and the web app"
  run npm run build -w @midan/api > "$LOGS/build-api.log" 2>&1
  (cd apps/web && run npx next build > "$LOGS/build-web.log" 2>&1)
fi
echo "$MODE" > "$MODE_FILE"

echo "• AI service"
if ! up http://localhost:8000/health; then
  # Through with-env, like the API and web app: uv's --env-file doesn't replace variables already in the shell, so a
  # shell that exports its own AI_SERVICE_TOKEN (or provider settings) would give the AI service different values from the API.
  (cd services/ai && nohup node "$ROOT/scripts/with-env.mjs" "$ENV_FILE" -- uv run --extra matching uvicorn midan_ai.main:app --port 8000 > "$LOGS/ai.log" 2>&1 &)
fi
wait_url http://localhost:8000/health

echo "• Core API"
if ! up http://localhost:4000/v1/health; then nohup node scripts/with-env.mjs "$ENV_FILE" -- node apps/api/dist/main.js > "$LOGS/api.log" 2>&1 & fi
wait_url http://localhost:4000/v1/health

echo "• Web app"
if ! up http://localhost:3100/en; then (cd apps/web && nohup node ../../scripts/with-env.mjs "$ENV_FILE" -- npx next start -p 3100 > "$LOGS/web.log" 2>&1 &); fi
wait_url http://localhost:3100/en

ai="$(curl -s http://localhost:8000/health)"
if [ "$MODE" = local ]; then
  DATA="one local environment"; AUTH="  Auth + storage http://localhost:54321
  Email inbox    http://localhost:54321/__mail   (verification and reset emails)"
else
  DATA="Supabase Cloud project $ref"; AUTH="  Auth + storage https://$ref.supabase.co   (emails are sent by the cloud project)"
fi
cat <<EOF

MIDAN is running on $DATA:
  Website        http://localhost:3100
  API            http://localhost:4000/v1   (docs: /v1/docs)
  AI service     http://localhost:8000      $(echo "$ai" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const h=JSON.parse(s);console.log('('+h.mode+(h.provider?' · '+h.provider:'')+(h.matching?' · matching '+h.matching:'')+')')}catch{console.log('')}})")
$AUTH
Logs: $LOGS. Stop with: scripts/dev-all.sh --stop
EOF

# Stay in the foreground so a process manager (or a terminal) keeps the stack alive; Ctrl+C stops it.
trap 'stop_ports; exit 0' INT TERM
while up http://localhost:3100/en && up http://localhost:4000/v1/health; do sleep 15; done
echo "A service stopped answering; see $LOGS." >&2
exit 1
