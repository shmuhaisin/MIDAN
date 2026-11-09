# MIDAN — candidate experience: current state

Read this first, then `MIDAN_CANDIDATE_PROGRESS.md` and `MIDAN_CANDIDATE_INTEGRATION_CONTRACT.md`, then check the actual Git
state. Nothing here depends on any previous chat.

## Ownership and branches
- **Candidate experience (this work):** `feature/midan-candidate-experience` on `origin` (`shmuhaisin/MIDAN`).
- **Employer + Admin:** another developer, branch `feature/midan-employer-experience` (not yet on `origin` when this was
  written). Never modify it. Shared database and API changes go through the integration contract.
- Base: `feature/midan-teammate-completion` at `67a0c20`. Never push to `main`, never force-push, never commit `.env`.
- Latest commit: see `git log -1` (this file is updated with each checkpoint; the commit that adds a line here is the
  checkpoint it describes).

## Architecture (one platform)
- `apps/web` Next.js 16 (next-intl, Arabic/English, RTL/LTR, light/dark). `apps/api` NestJS + Prisma, every query runs as
  the signed-in user under Postgres RLS (`db.asUser`). `services/ai` FastAPI (Groq `openai/gpt-oss-120b`, local e5 for
  matching and skill ranking). Supabase: Auth (GoTrue), Postgres, Storage. Locally a gateway (`scripts/local-supabase.mjs`)
  serves Auth, REST, Storage and a mail sink at `http://localhost:54321`.
- Migrations: `supabase/migrations/*.sql` own the schema (filename timestamps must be unique: the tracker keys on them);
  rollbacks in `supabase/rollback/`. `apps/api/prisma/schema.prisma` mirrors the schema (edit by hand for new tables;
  `db pull` needs the env file).

## This round (2026-11-10)
- Saved jobs: table `saved_jobs` (own rows only, published jobs only), `GET /me/saved-jobs`, `PUT|DELETE /me/saved-jobs/:jobId`,
  save buttons on listings and job pages, `/opportunities?saved=1`.
- Application deadline enforced by the database (trigger `guard_applicant_deadline`, Riyadh date, inclusive); discovery
  hides closed jobs (`include_closed=1` shows them); `sort=deadline`; "Closing soon" (≤7 days) and "Closed" labels; closed
  job pages show no Apply.
- Migration `20261110150000_candidate_saved_jobs_and_deadlines` (renumbered from `20261110120000`, which the employer
  branch already uses for `assessment_task_order`).
- Tests: `apps/api/src/candidate-discovery.e2e-spec.ts` 4/4, web unit 33/33 (`lib/deadline.test.ts` added).

## Next steps (in order)
1. Done 2026-11-10: saved jobs and closed-job pages walked in the browser, Arabic and English.
2. Interview portal polish: show the reschedule request state clearly on the list; decline only if the backend adds it.
3. Profile links (portfolio/LinkedIn): needs a shared-schema decision (columns on `candidate_profiles`).
4. Run the full suites (`run-ui.sh … unit ai e2e browser`) and record results here.

## Run (Windows, PowerShell; see `docs/local-development.md` for details)
```
npm install
cd services\ai; uv sync --extra matching; cd ..\..
node scripts\local-supabase.mjs        # Auth, REST, Storage, mail sink on :54321
npm run build -w @midan/api; node apps\api\dist\main.js     # API on :4000
cd services\ai; uv run --extra matching --env-file ..\..\.env uvicorn midan_ai.main:app --port 8000
cd apps\web; npx next build; npx next start -p 3100
```
Postgres 16 on 127.0.0.1:54322 (`scripts/local-db.sh start` on macOS/Linux; on Windows run Postgres 16 and apply
`supabase/migrations` in order with psql).

## Environment variable names (values never in Git)
`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `API_URL`, `APP_URL`, `AI_SERVICE_URL`, `AI_SERVICE_TOKEN`, `AI_PROVIDER`,
`GROQ_API_KEY`, `GROQ_MODEL`, `EMBEDDING_PROVIDER`, `HF_HOME`, `HF_HUB_OFFLINE`, `DEV_TEST_SIGNUP`, `DEV_TEST_ACCESS_CODE`,
`DAILY_API_KEY`, `GOOGLE_CALENDAR_*`. Test accounts: `.env.test.local` (`TEST_*_EMAIL`, `TEST_*_PASSWORD`).

## Blockers
- Email delivery: no SMTP provider configured (verification and invitations go to the local mail sink only).
- Groq free tier: 8,000 tokens/minute and 200,000/day; live AI falls back (labelled) when exhausted.
- Candidate account deletion: needs a PDPL retention decision.
