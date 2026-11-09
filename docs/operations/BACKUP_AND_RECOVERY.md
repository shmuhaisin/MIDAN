# Backup and recovery

**Scope:** what MIDAN holds, where it lives, how it's backed up, and how to restore it. The local demo has no backups:
it's rebuilt from migrations and fictional seed data. Production must have them before launch
(`docs/deployment.md`, "Before calling it production ready").

## 1. What holds data

| Store | Contents | Recovery source |
| --- | --- | --- |
| PostgreSQL (Supabase) | All records: accounts, organizations, jobs, applications, attempts, evaluations, reviews, interviews, notes, audit logs, reference data | Point-in-time recovery plus daily backups |
| Supabase Storage | CVs (private), attempt evidence (private), employer-claim evidence (private), logos | Storage backup or replication; files are referenced by path from the database |
| AI service checkpoints | LangGraph state of runs awaiting human review (Postgres in production; `CHECKPOINT_DATABASE_URL`) | Same database backup. A lost checkpoint only means re-running the generation or evaluation |
| Reference data | Sector skills workbooks, the employer registry | Re-import from source files (`scripts/import-reference-data.mjs`) |
| Secrets | API keys, OAuth client, refresh tokens | The secret manager of the host. Never in backups of code |

## 2. Targets (proposed; the owner sets the final values)

- **RPO (data that may be lost):** 5 minutes, with point-in-time recovery on the database.
- **RTO (time to restore service):** 4 hours for a full regional failure; 1 hour for a bad deploy or migration.

## 3. Backups

1. **Database:**
   - enable Supabase PITR (Pro plan or above);
   - keep 7 days of PITR and 30 daily logical backups;
   - copy the daily backups to a second region or provider: `pg_dump --format=custom` from a read replica, encrypted at rest.
2. **Storage:** daily sync of the private buckets to a second, encrypted bucket with versioning; keep 30 days.
3. **Migrations:** the repository is the source of the schema. Every migration has a rollback in `supabase/rollback/`, and `scripts/rehearse-migrations.sh` replays all of them up and down on a scratch cluster.
4. **Test monthly:** restore the latest backup into a scratch project, then run
   - `supabase/tests/security_phase1.sql`;
   - the API end-to-end suite, against the restored copy (local-only guard adjusted for that copy).

   Record the time taken. A backup that was never restored isn't a backup.

## 4. Restore procedures

**A bad migration:**
1. Stop the API (maintenance page).
2. Run the matching `supabase/rollback/<migration>.down.sql`.
3. Redeploy the previous release, check `/health` and the smoke tests, then reopen.

**Data deleted or corrupted by mistake:**
1. Restore with PITR to a new project, to the minute before the event.
2. Export the affected rows from it and re-insert them into production in one transaction, with an audit entry.
3. Never restore over production.

**Database lost:**
1. Restore the latest PITR or backup into a new project.
2. Point `DATABASE_URL`, `SUPABASE_URL` and the keys at it.
3. Run migrations to bring it to the current version, restore storage from the copy, re-import reference data if needed, and run the smoke tests.

**Storage lost:** restore the buckets from the copy. Files missing after the last sync are listed by comparing database paths with stored objects, and the affected candidates are asked to upload again.

**A secret exposed:** follow `INCIDENT_RESPONSE.md`. Rotate the secret first, then look for misuse.

## 5. Local demo

Rebuild:
1. `scripts/local-db.sh start` and `scripts/local-db.sh migrate`.
2. `node scripts/demo-seed.mjs`.
3. `node scripts/investor-demo.mjs --reset`.

Test leftovers: `supabase/test-cleanup.sql`.
