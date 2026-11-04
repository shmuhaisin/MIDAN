# Database

Supabase project `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`, region `eu-central-1`.

## How access works

```
Browser -> NestJS -> Postgres as midan_api -> SET LOCAL ROLE authenticated/anon + JWT claims -> RLS
```

- **`midan_api`** is the backend's login. It has no table access of its own and can't bypass RLS. `DbService.asUser` and `asAnon` assume a role for one transaction, so RLS applies to every backend query.
- **The backend doesn't use the service-role key** and doesn't need it.
- **Two layers:** controllers check roles for clear errors; RLS is the actual boundary and holds if a controller check is missing. Tests cover both.
- **Tenant integrity:** tenant rows carry `org_id`, and composite foreign keys on `(id, org_id)` stop rows linking across organizations.
- **Rules that hold however a row is written** live in triggers: published versions are immutable, publishing needs an owner or admin, responses lock on submit, AI scores need full provenance, results need human review before release.

## Who can see what

| Data | Candidate | Organization member | Other organization | Signed out |
| --- | --- | --- | --- | --- |
| Published jobs, their organizations | Yes | Yes | Yes | Yes |
| Draft jobs | No | Yes | No | No |
| Candidate profile, CV | Own | Only if they applied here | No | No |
| Applications | Own | Own organization | No | No |
| Tasks | After invitation | Yes | No | No |
| Rubric, answer keys | Never | Yes | No | No |
| Responses, evidence | Own | After submission | No | No |
| Evaluation results, scores | After release | Yes | No | No |
| Reviewer notes | Never | Yes | No | No |
| Audit log | No | Owner, admin | No | No |

## Migrations

Files in `supabase/migrations` are the source of truth. They were applied with the Supabase MCP `apply_migration` tool, and each file's MD5 was checked against `supabase_migrations.schema_migrations`.

`supabase/seed.sql` holds fictional demo data, not test accounts.

## Credentials

Run from the repo root:

```bash
node scripts/provision-db-credentials.mjs /path/outside/repo/provision.sql
```

This writes the database password to `.env` and test passwords to `.env.test.local` (both git-ignored). The SQL file contains only a SCRAM verifier and bcrypt hashes. Running it again rotates the password but needs the `auth.users` inserts removed, as the accounts already exist.

## Updating the Prisma schema

`prisma/schema.prisma` is generated. Prisma can't see table columns through `midan_api`, by design, so grant inheritance only for the pull, as an admin:

```sql
grant authenticated to midan_api with inherit true;
```

```bash
npm run db:pull -w @midan/api && npm run db:generate -w @midan/api
```

```sql
grant authenticated to midan_api with inherit false;
```

## Tests

```bash
npm run test:e2e -w @midan/api
```

This runs against the live project. Run `supabase/test-cleanup.sql` afterwards; it only touches `midan-test-*` organizations and the test accounts' data.
