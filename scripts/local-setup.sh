#!/usr/bin/env bash
# One-time (or start-over) setup of the whole local stack. Local data is replaced.
#
#   scripts/local-setup.sh [sector workbooks folder or .zip] [employer workbook .xlsx]
#
# Without arguments it imports the official files in data/source/.
# Afterwards, run the services as described in docs/local-development.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

scripts/local-tools.sh
scripts/local-db.sh reset

# Accounts are created through real Auth, so the gateway runs. It's restarted: its connections were to the old database.
pkill -f "scripts/local-supabase.mjs" 2>/dev/null || true
pkill -f ".local/bin/auth serve" 2>/dev/null || true
pkill -f ".local/bin/postgrest" 2>/dev/null || true
sleep 1
mkdir -p .local
nohup node scripts/local-supabase.mjs > .local/supabase.log 2>&1 &
for _ in $(seq 1 60); do curl -fs http://localhost:54321/auth/v1/health >/dev/null 2>&1 && break; sleep 0.25; done

node scripts/local-env.mjs --force
scripts/local-db.sh psql -f supabase/seed.sql >/dev/null
# The official files in data/source/ unless others are given.
node scripts/import-data.mjs --sectors "${1:-data/source/بيانات القطاعات.zip}" --employers "${2:-data/source/ALMIDAN_Employer_Database_10_Entities.xlsx}"
echo "Local stack ready. The Supabase gateway is running (log: .local/supabase.log)."
