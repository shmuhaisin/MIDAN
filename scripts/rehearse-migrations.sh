#!/usr/bin/env bash
# Rehearses Phase 2 on a throwaway local PostgreSQL 17 cluster. Nothing here connects to a hosted project.
#
#   scripts/rehearse-migrations.sh            the full rehearsal, then stops the cluster
#   scripts/rehearse-migrations.sh --keep     stops after the migrations, without test data, and leaves it running on port 54417
#   scripts/rehearse-migrations.sh --stop     stops the cluster
#
# Postgres runs as a non-superuser with hosted's powers, Auth's real migrations build the auth schema, and the starting point
# must match what hosted reported (supabase/rehearsal/hosted-baseline.txt). See docs/handoffs/MIDAN_PHASE_2_PREPARATION.md.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PG17BIN:-/opt/homebrew/opt/postgresql@17/bin}"
DATA="$ROOT/.local/rehearsal"
WORK="$ROOT/.local/rehearsal-work"
PORT=54417
HOSTED_APPLIED=23
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

admin() { "$PGBIN/psql" -h 127.0.0.1 -p $PORT -U supabase_admin -d "${DB:-midan}" -v ON_ERROR_STOP=1 -q "$@"; }
owner() { "$PGBIN/psql" -h 127.0.0.1 -p $PORT -U postgres -d midan -v ON_ERROR_STOP=1 -q "$@"; }
stop() { "$PGBIN/pg_ctl" -D "$DATA" -w -m fast stop >/dev/null 2>&1; }
fail() { echo "FAILED: $*"; [ "$MODE" = keep ] || stop; exit 1; }
# Sorted, because a dump's order shifts when objects come and go. What matters is that every statement is back.
schema() { "$PGBIN/pg_dump" -h 127.0.0.1 -p $PORT -U postgres -d midan -s -n public -n private -n storage --no-comments | grep -vE '^\\(un)?restrict|^-- |^--$|^$' | sort; }
roles() { admin -At -c "select rolname from pg_roles where rolname like 'midan%' order by 1"; }
data() { admin -At -f "$ROOT/supabase/rehearsal/data_fingerprint.sql"; }
snapshot() { schema > "$WORK/$1.schema"; roles > "$WORK/$1.roles"; data > "$WORK/$1.data"; }
same() {
  diff "$WORK/$1.schema" "$WORK/$2.schema" > "$WORK/diff.schema" || { sed -n 1,20p "$WORK/diff.schema" | cut -c1-150; fail "schema differs between $1 and $2"; }
  diff "$WORK/$1.roles" "$WORK/$2.roles" || fail "roles differ between $1 and $2"
  diff "$WORK/$1.data" "$WORK/$2.data" > "$WORK/diff.data" || { cut -c1-90 "$WORK/diff.data" | sed -n 1,10p; fail "data differs between $1 and $2"; }
}
checks() { admin -At -f "$ROOT/supabase/rehearsal/post_checks.sql" > "$WORK/checks"; ! grep -q '^FAIL' "$WORK/checks" || { grep '^FAIL' "$WORK/checks"; fail "post-change checks"; }; echo "post-change checks: $(wc -l < "$WORK/checks" | tr -d ' ') ok"; }

MODE=full
case "${1:-}" in --keep) MODE=keep ;; --stop) stop; echo "Stopped."; exit 0 ;; "") ;; *) echo "usage: $0 [--keep|--stop]" >&2; exit 2 ;; esac
[ -x "$PGBIN/postgres" ] || { echo "Needs PostgreSQL 17: brew install postgresql@17"; exit 1; }
[ -x "$ROOT/.local/bin/auth" ] || { echo "Needs the local Auth binary: see docs/local-development.md"; exit 1; }
"$PGBIN/postgres" --version | grep -q ' 17\.' || { echo "Not PostgreSQL 17"; exit 1; }

stop; rm -rf "$DATA" "$WORK"; mkdir -p "$DATA" "$WORK"
"$PGBIN/initdb" -D "$DATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$DATA" -l "$WORK/server.log" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -w start >/dev/null || exit 1
DB=postgres admin -f "$ROOT/supabase/rehearsal/01_hosted_roles.sql" || fail "roles"
admin -f "$ROOT/supabase/local/00_supabase_shim.sql" >/dev/null 2>&1 || fail "shim"
(cd "$ROOT" && LOCAL_PG_PORT=$PORT node scripts/local-supabase.mjs migrate >/dev/null 2>&1) || fail "Auth's migrations"
admin -f "$ROOT/supabase/local/05_auth_functions.sql" >/dev/null 2>&1 || fail "auth functions"
admin -f "$ROOT/supabase/rehearsal/02_hosted_grants.sql" >/dev/null 2>&1 || fail "grants"
# A policy of the local shim that hosted doesn't have.
admin -c 'drop policy if exists "buckets are readable" on storage.buckets' >/dev/null 2>&1

FILES=("$ROOT"/supabase/migrations/*.sql)
[ "${#FILES[@]}" -gt $HOSTED_APPLIED ] || fail "no pending migrations"
for f in "${FILES[@]:0:$HOSTED_APPLIED}"; do owner -1 -f "$f" >/dev/null 2>"$WORK/err" || { grep -oE 'ERROR.*' "$WORK/err" | head -2; fail "baseline $(basename "$f")"; }; done
admin -At -f "$ROOT/supabase/rehearsal/fingerprint.sql" > "$WORK/baseline"
diff "$ROOT/supabase/rehearsal/hosted-baseline.txt" "$WORK/baseline" || fail "the starting point doesn't match hosted"
echo "starting point: matches hosted ($HOSTED_APPLIED migrations; tables, columns, policies and functions)"
PENDING=("${FILES[@]:$HOSTED_APPLIED}")

if [ "$MODE" = keep ]; then
  for f in "${PENDING[@]}"; do owner -1 -f "$f" >/dev/null 2>"$WORK/err" || { grep -oE 'ERROR.*' "$WORK/err" | head -2; fail "$(basename "$f")"; }; done
  checks
  echo "Applied ${#PENDING[@]} pending migrations as a non-superuser. Left running on port $PORT, with no test data."
  exit 0
fi

admin -f "$ROOT/supabase/rehearsal/03_synthetic_hosted_shape.sql" >/dev/null 2>"$WORK/err" || { grep -oE 'ERROR.*' "$WORK/err" | head -3; fail "synthetic data"; }
echo "synthetic data: $(admin -At -c "select (select count(*) from auth.users) || ' accounts, ' || (select count(*) from public.organizations) || ' organizations, ' || (select count(*) from public.jobs) || ' jobs, ' || (select count(*) from public.reference_skills) || ' skills, ' || (select count(*) from public.applications) || ' applications'")"

# The backup, as the owner would make it, then restored into a separate database.
"$PGBIN/pg_dump" -h 127.0.0.1 -p $PORT -U postgres -d midan -Fc -n public -n private -n auth -n storage -f "$WORK/backup.dump" 2>"$WORK/err" || { cut -c1-160 "$WORK/err" | head -3; fail "backup"; }
snapshot 00
DB=postgres admin -c 'create database restore_check owner postgres' || fail "restore database"
DB=restore_check admin -c 'drop schema if exists public cascade' >/dev/null 2>&1
"$PGBIN/pg_restore" -h 127.0.0.1 -p $PORT -U supabase_admin -d restore_check "$WORK/backup.dump" >/dev/null 2>"$WORK/restore.err" || true
DB=restore_check admin -At -f "$ROOT/supabase/rehearsal/data_fingerprint.sql" > "$WORK/restored.data"
diff "$WORK/00.data" "$WORK/restored.data" > "$WORK/diff.restore" || { cut -c1-90 "$WORK/diff.restore" | sed -n 1,10p; fail "the restored backup differs"; }
echo "backup: restored into a separate database, every table identical ($(wc -l < "$WORK/00.data" | tr -d ' ') tables)"
DB=postgres admin -c 'drop database restore_check' >/dev/null

# One at a time: forward, back, compare with the state before, then forward again.
i=0
for f in "${PENDING[@]}"; do
  i=$((i + 1)); name="$(basename "$f" .sql)"; down="$ROOT/supabase/rollback/$name.down.sql"; before=$(printf '%02d' $((i - 1))); after=$(printf '%02d' $i)
  [ -f "$down" ] || fail "no rollback for $name"
  owner -1 -f "$f" >/dev/null 2>"$WORK/err" || { grep -oE 'ERROR.*' "$WORK/err" | head -2; fail "apply $name"; }
  owner -1 -f "$down" >/dev/null 2>"$WORK/err" || { grep -oE 'ERROR.*|LINE.*' "$WORK/err" | head -3 | cut -c1-170; fail "rollback $name"; }
  snapshot back; same "$before" back
  owner -1 -f "$f" >/dev/null 2>"$WORK/err" || { grep -oE 'ERROR.*' "$WORK/err" | head -2; fail "re-apply $name"; }
  snapshot "$after"
  echo "ok $after apply, roll back to identical, apply again: $name"
done
checks
admin -f "$ROOT/supabase/local/10_local_logins.sql" >/dev/null 2>&1 || fail "local logins"
admin -c 'create policy "buckets are readable" on storage.buckets for select using (true)' >/dev/null
admin -f "$ROOT/supabase/tests/security_phase1.sql" 2>"$WORK/err" | tail -1 | grep -q 'All Phase 1' || { grep -oE 'ERROR.*' "$WORK/err" | head -2; fail "security checks"; }
echo "security checks: passed, as a rolled-back transaction"
admin -c 'drop policy "buckets are readable" on storage.buckets' >/dev/null
data > "$WORK/final.data"; roles > /dev/null

# All of them back together, newest first, to the starting point.
for ((n = ${#PENDING[@]} - 1; n >= 0; n--)); do
  name="$(basename "${PENDING[$n]}" .sql)"
  owner -1 -f "$ROOT/supabase/rollback/$name.down.sql" >/dev/null 2>"$WORK/err" || { grep -oE 'ERROR.*' "$WORK/err" | head -2; fail "full rollback $name"; }
done
schema > "$WORK/full.schema"; admin -At -f "$ROOT/supabase/rehearsal/fingerprint.sql" > "$WORK/full.baseline"
diff "$WORK/00.schema" "$WORK/full.schema" > "$WORK/diff.schema" || { sed -n 1,20p "$WORK/diff.schema" | cut -c1-150; fail "full rollback differs"; }
diff "$ROOT/supabase/rehearsal/hosted-baseline.txt" "$WORK/full.baseline" || fail "full rollback doesn't match hosted's starting point"
echo "full rollback: all ${#PENDING[@]} reversed, schema back to the starting point and to hosted's fingerprint"
stop
echo "Rehearsal passed."
