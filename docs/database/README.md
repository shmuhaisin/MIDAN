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
| Job requirements: approved, active, on a published job | Yes | Yes | Yes | Yes |
| Job requirements: draft, AI-origin or retired | No | Yes | No | No |
| Which tasks measure which requirement | Never | Yes | No | No |
| Candidate profile, CV | Own | Only while they have an active application here | No | No |
| Applications | Own | Own organization | No | No |
| Tasks | After invitation | Yes | No | No |
| Rubric, answer keys | Never | Yes | No | No |
| Responses, evidence | Own | After submission | No | No |
| Evaluation results, scores | After release | Yes | No | No |
| Reviewer notes | Never | Yes | No | No |
| Audit log | No | Owner, admin | No | No |

## Job structure

```
Organization -> Jobs -> Job requirements and skills -> Assessments -> Versions -> Tasks -> Rubric criteria
```

- **`job_requirements`** holds one row per requirement, with `requirement_type`, `is_mandatory`, `origin` and `review_status`. `min_years` is only for experience.
- **`task_requirement_mappings`** says which tasks measure which requirements, and `rubric_criteria.requirement_id` links a criterion to one. A trigger refuses links to another job or to a retired requirement. Mappings lock with the version.
- **`assessment_versions.requirements_snapshot`** is written only at publish.
- **Several assessments per job** are allowed by the schema.

## Development registration

Sign-up needs `DEV_TEST_SIGNUP=true` for the form, and `DEV_TEST_ACCESS_CODE` in `.env` for the database gate. To set or rotate the code, generate a random value locally, put it in `.env`, and store only its hash:

```sql
insert into private.signup_access (code_hash, note)
values (encode(sha256(convert_to('<the code>', 'UTF8')), 'hex'), 'Local development server');
```

Supabase Auth settings live in the dashboard: Site URL and redirect URLs must include this app, and "Confirm email" stays on. The built-in sender only reaches members of the Supabase project's team, at a few emails an hour. Anyone else needs custom SMTP.

## Migrations

Files in `supabase/migrations` are the source of truth. They were applied with the Supabase MCP `apply_migration` tool, and each file's MD5 was checked against `supabase_migrations.schema_migrations`.

`supabase/seed.sql` holds fictional demo data, not test accounts.

## Credentials

Run from the repo root:

```bash
node scripts/provision-db-credentials.mjs /path/outside/repo/provision.sql
```

This writes the database password to `.env` and test passwords to `.env.test.local` (both git-ignored). The SQL file contains only a SCRAM verifier and bcrypt hashes. Running it again rotates the password but needs the `auth.users` inserts removed, as the accounts already exist. `midan.test.unverified@example.com` is a fixture added separately, and tests expect it never to verify.

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
