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
| Candidate profile, CV | Own | Only while they have an active application here | No | No |
| Applications | Own | Own organization | No | No |
| Tasks | After invitation | Yes | No | No |
| Rubric, answer keys | Never | Yes | No | No |
| Responses, evidence | Own | After submission | No | No |
| Evaluation results, scores | After release | Yes | No | No |
| Reviewer notes | Never | Yes | No | No |
| Audit log | No | Owner, admin | No | No |

## Development registration

Sign-up needs `DEV_TEST_SIGNUP=true` for the form, and `DEV_TEST_ACCESS_CODE` in `.env` for the database gate. To set or rotate the code, generate a random value locally, put it in `.env`, and store only its hash:

```sql
insert into private.signup_access (code_hash, note)
values (encode(sha256(convert_to('<the code>', 'UTF8')), 'hex'), 'Local development server');
```

Supabase Auth settings live in the dashboard, and "Confirm email" stays on. The app builds the return link from `APP_URL` as `/{locale}/auth/confirmed`, for `ar` and `en`. Local development sets `APP_URL=http://localhost:3100` in `.env` (see `.env.example`). Add these under Auth → Redirect URLs, and leave the existing Site URL and any production redirect unchanged:

- `http://localhost:3100/ar/auth/confirmed`
- `http://localhost:3100/en/auth/confirmed`

The built-in sender only reaches members of the Supabase project's team, at a few emails an hour. Anyone else needs custom SMTP.

## SDAIA demo employer account

The repository includes `scripts/provision-sdaia-demo.mjs` for creating one pre-confirmed demo owner account. It marks the resulting organization with `is_demo = true` and does not change the project's email-confirmation setting. The script never reads `.env`; it reads credentials only from the git-ignored `.env.sdaia-demo.local` file.

Copy `.env.sdaia-demo.example` to `.env.sdaia-demo.local`, then fill the local Supabase URL, local service-role key, password, and access code. The target must be `local` and use `localhost` or `127.0.0.1`. The Supabase database must already contain the matching hash in `private.signup_access`. Obtain local API keys from `npx supabase status`; never copy keys from the team's production project.

For a future isolated staging project, set `SDAIA_DEMO_TARGET=staging`, set `SDAIA_DEMO_PROJECT_REF` to the staging project's exact ref, and set `SDAIA_DEMO_CONFIRM_STAGING=yes`. The script rejects the team's production project ref. The staging database must have the matching `private.signup_access` hash installed by its owner before running the script.

Run from the repository root with `node scripts/provision-sdaia-demo.mjs`. It creates `sdaia.demo@example.com` with a confirmed email, provisions the organization through the existing Auth trigger, and marks it as demo. It does not create a job, upload a logo, or invent branding. The script does not delete accounts and refuses to overwrite an existing account.

## Migrations

Files in `supabase/migrations` are the source of truth. They were applied with the Supabase MCP `apply_migration` tool, and each file's MD5 was checked against `supabase_migrations.schema_migrations`.

`supabase/seed.sql` holds fictional demo data, not test accounts.

## Local Supabase

`supabase/config.toml` is the local stack only. Its `project_id` is the directory name `MIDAN`. Do not run `npx supabase login` or `npx supabase link`, and do not put the hosted project ref or any hosted key in this file.

Local Auth in that file uses `site_url = "http://localhost:3100"` and allows these exact return URLs:

- `http://localhost:3100/ar/auth/confirmed`
- `http://localhost:3100/en/auth/confirmed`

Docker Desktop has to be installed and running before the stack starts. The CLI does not start Docker. On Windows, install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) and leave the engine running.

The CLI is the pinned dev dependency `supabase@3.0.0`. From the repo root, install dependencies and start the local containers:

```bash
npm install
npx supabase start
```

`npx supabase start` runs Postgres, Auth, and the other local services in Docker. It does not change the hosted project.

`npx supabase db reset` drops and recreates that local database only. It applies every file in `supabase/migrations`, then loads `supabase/seed.sql`. It does not connect to the hosted project.

Stop the containers with `npx supabase stop`.

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
