#!/usr/bin/env bash
# Local PostgreSQL for development and tests. Nothing here touches the hosted Supabase project.
#
#   scripts/local-db.sh start     create the cluster if needed, start it, apply migrations
#   scripts/local-db.sh migrate   apply any migrations not yet applied
#   scripts/local-db.sh reset     drop and recreate the local database, then migrate (local data is lost)
#   scripts/local-db.sh stop
#   scripts/local-db.sh psql      open a superuser shell
#
# Needs PostgreSQL 16 binaries (initdb, pg_ctl, psql). The cluster lives in .local/pg, which git ignores.
# See docs/local-development.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.local/pg"
PORT="${LOCAL_PG_PORT:-54322}"
DB=midan
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WINDOWS=1 ;; *) WINDOWS=0 ;; esac
# On Windows, the newest installed PostgreSQL (17 or later, for the builtin C.UTF-8 locale) unless PGBIN says otherwise.
if [ "$WINDOWS" = 1 ] && [ -z "${PGBIN:-}" ]; then
  PGBIN="$(ls -d "/c/Program Files/PostgreSQL"/1[7-9]/bin 2>/dev/null | sort -V | tail -1)"
fi
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v pg_ctl)")}"
# PostgreSQL on macOS stops at startup ("postmaster became multithreaded") without a valid locale in the environment.
if [ "$(uname)" = "Darwin" ]; then export LC_ALL="${LC_ALL:-en_US.UTF-8}"; fi

# initdb refuses to run as root, so a root shell (as in some containers) runs the server as "postgres".
as_pg() {
  if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi
}
sql() { as_pg "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

init() {
  [ -f "$DATA/PG_VERSION" ] && return
  mkdir -p "$DATA"
  [ "$(id -u)" = "0" ] && chown -R postgres "$ROOT/.local"
  if [ "$WINDOWS" = 1 ]; then
    # Windows has no POSIX C.UTF-8 locale; PostgreSQL's own builtin provider gives the same Unicode-aware behaviour.
    "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C --locale-provider=builtin --builtin-locale=C.UTF-8 >/dev/null
  else
    as_pg "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  fi
  echo "Created local cluster in $DATA"
}

server() {
  init
  if ! as_pg "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
    local socket="-k /tmp"
    [ "$WINDOWS" = 1 ] && socket="-c unix_socket_directories="
    as_pg "$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -o "-p $PORT $socket -c listen_addresses=127.0.0.1" -w start >/dev/null
  fi
  if ! sql -d postgres -tAc "select 1 from pg_database where datname = '$DB'" | grep -q 1; then
    sql -d postgres -c "create database $DB"
  fi
}
start() { server; migrate; }

migrate() {
  sql -d "$DB" -f "$ROOT/supabase/local/00_supabase_shim.sql"
  # The real Supabase Auth server creates and migrates the auth schema itself, as on Supabase.
  node "$ROOT/scripts/local-supabase.mjs" migrate
  sql -d "$DB" -f "$ROOT/supabase/local/05_auth_functions.sql"
  local applied=0
  for file in "$ROOT"/supabase/migrations/*.sql; do
    local base version name md5
    base="$(basename "$file" .sql)"; version="${base%%_*}"; name="${base#*_}"
    if sql -d "$DB" -tAc "select 1 from supabase_migrations.schema_migrations where version = '$version'" | grep -q 1; then continue; fi
    md5="$( { command -v md5sum >/dev/null && md5sum "$file" || md5 -r "$file"; } | cut -d' ' -f1)"
    # Each migration runs in one transaction, as Supabase applies them.
    sql -d "$DB" -1 -f "$file"
    sql -d "$DB" -c "insert into supabase_migrations.schema_migrations (version, name, statements_md5) values ('$version', '$name', '$md5')"
    applied=$((applied + 1))
  done
  sql -d "$DB" -f "$ROOT/supabase/local/10_local_logins.sql"
  # Supabase reloads the Data API's schema cache after DDL by itself; locally, PostgREST is told to.
  sql -d "$DB" -c "notify pgrst, 'reload schema'"
  echo "Local database ready on 127.0.0.1:$PORT/$DB ($applied migrations applied this run)"
}

case "${1:-start}" in
  start) start ;;
  migrate) migrate ;;
  reset)
    server
    # Roles are cluster-wide, so the ones migrations create go too.
    sql -d postgres -c "drop database if exists $DB with (force)" -c "drop role if exists midan_api" -c "create database $DB"
    migrate ;;
  stop) as_pg "$PGBIN/pg_ctl" -D "$DATA" -w stop ;;
  psql) shift; sql -d "$DB" "$@" ;;
  *) echo "usage: $0 start|migrate|reset|stop|psql" >&2; exit 2 ;;
esac
