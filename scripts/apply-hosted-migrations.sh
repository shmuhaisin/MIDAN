#!/usr/bin/env bash
# Applies the pending migrations to the Supabase Cloud project in .env.cloud, ONLY with the owner's approval.
#
#   scripts/apply-hosted-migrations.sh --check                        read-only: where the project stands, nothing changes
#   scripts/apply-hosted-migrations.sh --backup                       read-only on the project: steps 1 and 2 below
#   scripts/apply-hosted-migrations.sh --apply --approved-by-owner <project-ref>
#
# --apply, in order, stopping at the first problem:
#   1. Confirms the project is exactly the rehearsed starting point: its migration history is the repository's first
#      $HOSTED_APPLIED, and its tables, columns, policies and functions match supabase/rehearsal/hosted-baseline.txt.
#   2. Backs it up with pg_dump 17 (schemas public, private, auth, storage, supabase_migrations) into .local/backups, and
#      verifies the backup by restoring it into a throwaway local database: every table's row count must match the project.
#   3. Applies each pending migration in its own transaction (a failure leaves that migration out entirely) and records it
#      in supabase_migrations.schema_migrations, as the Supabase CLI does.
#   4. Runs the read-only post-change checks and prints the new migration count.
# Rehearsed beforehand by scripts/rehearse-migrations.sh. To undo: the files in supabase/rollback, newest first (rehearsed
# to return to the starting point exactly), or pg_restore of the backup. Connection strings are never printed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PG17BIN:-/opt/homebrew/opt/postgresql@17/bin}"
ENV_FILE="$ROOT/.env.cloud"
HOSTED_APPLIED=23
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

MODE="${1:-}"
case "$MODE" in
  --check|--backup) ;;
  --apply) [ "${2:-}" = "--approved-by-owner" ] && [ -n "${3:-}" ] || { echo "usage: $0 --apply --approved-by-owner <project-ref>" >&2; exit 2; } ;;
  *) echo "usage: $0 --check | --backup | --apply --approved-by-owner <project-ref>" >&2; exit 2 ;;
esac
[ -f "$ENV_FILE" ] || { echo "Missing .env.cloud" >&2; exit 1; }
"$PGBIN/psql" --version | grep -q ' 17\.' || { echo "Needs PostgreSQL 17 client tools: brew install postgresql@17" >&2; exit 1; }

# The URL goes to psql through the environment, never the command line.
getenv() { node -e "const {parseEnv}=require('node:util');process.stdout.write(parseEnv(require('node:fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]]||'')" "$ENV_FILE" "$1"; }
DB_URL="$(getenv DIRECT_URL)"; SUPA="$(getenv NEXT_PUBLIC_SUPABASE_URL)"
REF="$(node -e "console.log(new URL(process.argv[1]).hostname.replace(/\.supabase\.co$/,''))" "$SUPA")"
[ "$(node -e "console.log(new URL(process.argv[1]).hostname)" "$DB_URL")" = "db.$REF.supabase.co" ] || { echo "DIRECT_URL isn't the database of $REF" >&2; exit 1; }
[ "$MODE" != --apply ] || [ "$3" = "$REF" ] || { echo "Approval names '$3' but .env.cloud is project $REF" >&2; exit 1; }
# libpq reads these from the environment, so no part of the URL appears in a process list.
{ IFS= read -r -d '' PGHOST; IFS= read -r -d '' PGPORT; IFS= read -r -d '' PGUSER; IFS= read -r -d '' PGPASSWORD; IFS= read -r -d '' PGDATABASE; } < <(
  node -e "const u=new URL(process.argv[1]);process.stdout.write([u.hostname,u.port||'5432',decodeURIComponent(u.username),decodeURIComponent(u.password),u.pathname.slice(1)||'postgres'].join('\0')+'\0')" "$DB_URL")
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE=require
unset DB_URL
q() { "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -q "$@"; }

FILES=("$ROOT"/supabase/migrations/*.sql)
APPLIED="$(q -At -c "select version from supabase_migrations.schema_migrations order by version")" || { echo "Can't read the migration history" >&2; exit 1; }
EXPECTED="$(for f in "${FILES[@]:0:$HOSTED_APPLIED}"; do basename "$f" | cut -d_ -f1; done)"
PENDING=("${FILES[@]:$HOSTED_APPLIED}")
echo "Project $REF: $(echo "$APPLIED" | grep -c .) migrations applied, ${#PENDING[@]} pending in the repository."
[ "$APPLIED" = "$EXPECTED" ] || { echo "The history isn't the rehearsed starting point; stopping." >&2; exit 1; }
q -At -f "$ROOT/supabase/rehearsal/fingerprint.sql" > "$ROOT/.local/hosted-fingerprint.txt" || exit 1
diff -q "$ROOT/supabase/rehearsal/hosted-baseline.txt" "$ROOT/.local/hosted-fingerprint.txt" >/dev/null \
  || { echo "The schema differs from the rehearsed starting point; stopping." >&2; exit 1; }
echo "Schema: matches the rehearsed starting point."
if [ "$MODE" = --check ]; then for f in "${PENDING[@]}"; do echo "  pending $(basename "$f" .sql)"; done; exit 0; fi

# 2. Backup, and proof that it restores.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; BK="$ROOT/.local/backups"; mkdir -p "$BK"; chmod 700 "$BK"
DUMP="$BK/$REF-$STAMP.dump"
counts() { "$@" -At -c "select n.nspname || '.' || c.relname || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('public', 'private', 'auth', 'storage') order by 1"; }
counts q > "$BK/$REF-$STAMP.counts" || { echo "Couldn't count rows" >&2; exit 1; }
"$PGBIN/pg_dump" -Fc -n public -n private -n auth -n storage -n supabase_migrations -f "$DUMP" || { echo "Backup failed; nothing changed." >&2; exit 1; }
chmod 600 "$DUMP"
SCR="$(mktemp -d)"; PORT=54419
# The throwaway server is local: none of the cloud connection settings above may reach it.
local_pg() { env -u PGPASSWORD -u PGDATABASE PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres PGSSLMODE=disable "$@"; }
"$PGBIN/initdb" -D "$SCR/data" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$SCR/data" -l "$SCR/log" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -w start >/dev/null || exit 1
L() { local_pg "$PGBIN/psql" -X -d restore -q "$@"; }
local_pg "$PGBIN/psql" -X -d postgres -qc 'create database restore'
for r in anon authenticated service_role supabase_admin supabase_auth_admin supabase_storage_admin authenticator midan_api midan_worker midan_importer midan_ai dashboard_user pgsodium_keyiduser; do
  local_pg "$PGBIN/psql" -X -d postgres -qc "create role $r" 2>/dev/null; done
L -qc 'create extension if not exists pgcrypto; create extension if not exists "uuid-ossp"; create extension if not exists pg_trgm; create extension if not exists unaccent' 2>/dev/null
local_pg "$PGBIN/pg_restore" -d restore --no-owner --no-acl "$DUMP" 2>"$SCR/restore.err"
counts L > "$BK/$REF-$STAMP.restored-counts"
"$PGBIN/pg_ctl" -D "$SCR/data" -w -m fast stop >/dev/null; rm -rf "$SCR"
diff "$BK/$REF-$STAMP.counts" "$BK/$REF-$STAMP.restored-counts" >/dev/null \
  || { echo "The backup didn't restore with identical row counts; stopping, nothing changed." >&2; diff "$BK/$REF-$STAMP.counts" "$BK/$REF-$STAMP.restored-counts" | head -5 >&2; exit 1; }
echo "Backup: $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1)), restored into a throwaway database with identical row counts in $(wc -l < "$BK/$REF-$STAMP.counts" | tr -d ' ') tables."

[ "$MODE" = --backup ] && exit 0

# 3. One migration per transaction, recorded with it.
for f in "${PENDING[@]}"; do
  base="$(basename "$f" .sql)"; version="${base%%_*}"; name="${base#*_}"
  { echo "begin;"; cat "$f"; echo; echo "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');"; echo "commit;"; } > "$BK/apply.sql"
  if q -f "$BK/apply.sql" > /dev/null 2>"$BK/apply.err"; then echo "applied $base"
  else echo "FAILED $base (rolled back; earlier ones stay applied):" >&2; grep -oE 'ERROR.*' "$BK/apply.err" | head -2 >&2; rm -f "$BK/apply.sql"; exit 1; fi
done
rm -f "$BK/apply.sql" "$BK/apply.err"

# 4. Read-only checks.
q -At -f "$ROOT/supabase/rehearsal/post_checks.sql" > "$BK/$REF-$STAMP.checks"
if grep -q '^FAIL' "$BK/$REF-$STAMP.checks"; then echo "Post-change checks failed:" >&2; grep '^FAIL' "$BK/$REF-$STAMP.checks" >&2; exit 1; fi
echo "Post-change checks: $(wc -l < "$BK/$REF-$STAMP.checks" | tr -d ' ') ok. Migrations now applied: $(q -At -c 'select count(*) from supabase_migrations.schema_migrations')."
