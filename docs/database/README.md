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
- **Several assessments per job:** each has its own versions, numbered from 1. A candidate takes each assessment once.
- **Application status** follows every attempt through `private.sync_application_status`, and stops at a person's decision or a withdrawal.

## Reference data

Two official sources, placed in `data/source/` exactly as supplied and not in the repository, since there is no permission to publish them (see [data/source/README.md](../../data/source/README.md)): `ALMIDAN_Employer_Database_10_Entities.xlsx` (employer registry) and `بيانات القطاعات.zip` (seven sector skills workbooks, also extracted to `data/source/sector-skills/`).

```bash
node scripts/import-data.mjs --sectors "data/source/بيانات القطاعات.zip" --employers data/source/ALMIDAN_Employer_Database_10_Entities.xlsx
```

- **Lineage records each file's name and SHA-256.** Importing from `data/source/` keeps the original names.
- **It connects as `midan_importer`,** which can only call the import functions. Locally its password is set by `scripts/local-db.sh`; elsewhere set `IMPORT_DATABASE_URL`. The old temporary grant to `midan_api` is no longer needed.
- **Repeatable.** Re-running changes nothing that didn't change: rows report `unchanged`, and no row is duplicated.
- **Lineage.** `import_runs` holds each run, its files, every sheet and how it was handled, and statistics. `import_records` holds every row: source file, sheet, row, the raw cell value, what was stored, and a status (`imported`, `updated`, `unchanged`, `duplicate`, `rejected`, `ambiguous`, `warning`). Reference rows point back to their last run.
- **Nothing is merged or dropped silently.** Near-identical spellings, skills found only in a sub-sector sheet, priority-list disagreements and descriptions without a listed skill are kept as written and sent to review (`/admin/review`).
- **Priority is kept both ways the workbooks state it:** `is_priority` (the flag in the skill list) and `priority_listed` (the separate priority sheet).
- **The workbooks hold no proficiency levels, skill identifiers or English names,** so none exist here.
- **The employer workbook is read for identity only.** Its job sheet has no rows and isn't read. Job listings come only from authorized sources, through `--listings`.

| Workbook | Technical | General | Sub-sector and family links | Job families |
| --- | --- | --- | --- | --- |
| Digital | 955 | 22 | 3,504 | 17 |
| Culture and entertainment | 899 | 25 | 4,138 | 33 |
| Tourism and hospitality | 669 | 23 | 7,543 | 26 |
| Manufacturing | 918 | 22 | 15,272 | 10 |
| Construction and real estate | 652 | 27 | 1,960 | 14 |
| Financial services and insurance | 357 | 17 | 2,774 | 13 |
| Wholesale and retail | 467 | 21 | 4,247 | 20 |
| **Total** | **4,917** | **157** | **39,438** | |

Financial services shows 357 technical skills, one more than its skill list: a priority skill listed on the priority sheet but missing from the skill list, kept from the priority sheet and sent to review.

### Employers in the application

- `employer_registry`, `employer_aliases`, `employer_sources`: the ten entities as the workbook states them, with brand profile fields and the source row of every value.
- **Directory and search** (`/employers`, `GET /reference/employers?q=`): official Arabic and English names, aliases and company IDs, tolerant of Arabic spelling. Each result says whether it matched an official name or an alias, and the alias keeps the status the workbook gives it.
- **Profile** (`/employers/:id`, `GET /reference/employers/:id`): identity, verification and its source, partnership status, aliases apart from official names, sources with their check dates, and lineage. Brand assets are returned only when the source establishes permission; today none does, so profiles use Midan's neutral identity. Missing values show as missing.
- **Employers and jobs.** An organization account is linked to its registry entity only by a platform administrator (`organizations.employer_registry_id`), never for demo or test organizations. Its published jobs then carry the employer, appear on the profile and can be filtered with `GET /jobs?registry=`. Reviewed external listings link through their employer match. `public.employer_jobs` returns both.
- **Aliases the workbook marks for review** (`ambiguous_manual_review`, `common_manual_review`) never produce an automatic match; a listing using one goes to review.

### Where the sector workbooks are used

- **Job analysis** (`public.analyze_job`) and **listing classification** (`private.classify_text`) find reference skills a job names and propose a sector, job family and skills, with the matched words as evidence.
- **Candidate skills** are chosen from the reference, and CV skills are matched to it.
- **Match** on a job: required reference skills with evidence, divided by required reference skills.
- **Assessment drafts** turn required reference skills into tasks whose rubric uses the workbook's description.
- **Career development** uses sector, job family and skill gaps from the workbooks.

## Test data

Automated tests run against this same database. Organizations created by test accounts, or with a `midan-test-` slug, are marked `organizations.is_test` by a trigger when they're created, and nobody can change the mark. `listableJobs` in `apps/api/src/common/test-data.ts` keeps them out of job listings and recommendations for everyone except the test accounts, whose own tests need them. Demo jobs have their own listing at `/jobs?demo=1`. `supabase/test-cleanup.sql` still removes fixtures after a run.

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
