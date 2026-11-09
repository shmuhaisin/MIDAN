# MIDAN — Employer + Admin: current state (persistent handoff)

**Read this first, then `MIDAN_EMPLOYER_PROGRESS.md`, then check `git status` and `git log`. The repository is the source
of truth; if this file disagrees with the code, trust the code and fix this file.** Updated 2026-11-09.

## 1. Project and architecture
MIDAN (ميدان), bilingual Saudi recruitment platform. Monorepo:
- `apps/web` — Next.js 16 (App Router, next-intl ar/en, RTL/LTR, Tailwind 4). Server actions in `src/lib/*-actions.ts` call the API.
- `apps/api` — NestJS + Prisma. Every request runs as the signed-in user (`db.asUser`: role `authenticated` + JWT claims), so
  Postgres RLS applies; `requireRole` adds clear refusals. Routes under `/v1`.
- `services/ai` — FastAPI (Python ≥3.12): assessment builder, evaluation, skills, matching (E5), assistant, **translation**.
  Providers: Groq / OpenAI / Gemini (`AI_PROVIDER`), labelled demo mode without keys.
- `supabase/migrations` — the schema (55 migrations), rollbacks in `supabase/rollback/*.down.sql`. Local Windows stack:
  `docs/local-development-windows.md`.

## 2. Ownership
Employer + Admin (this branch): registration, organization onboarding/documents/approval, dashboard, team, jobs, translation,
skills, assessments, applications, evaluation, shortlisting/hiring, interviews, Google Calendar, notifications, analytics,
assistant; Admin console.

## 3. Candidate developer
Nada Al-Nashwan owns the Candidate experience on `feature/midan-candidate-experience` (at `e32f96e` when inspected; it adds
saved jobs and a database deadline guard, migration `20261110150000`). **Never modify that branch.** Contract:
`docs/handoff/MIDAN_EMPLOYER_INTEGRATION_CONTRACT.md` (this side) and her `MIDAN_CANDIDATE_INTEGRATION_CONTRACT.md`.

## 4. Git
- Branch: `feature/midan-employer-experience`, created locally from `feature/midan-teammate-completion` @
  `67a0c20eee266757d026c63a3ef81dc8ad1fbcd9`.
- Pushed to `origin/feature/midan-employer-experience`. Implementation commit: `dc7faf1b1bb232736dd6bd81a085a02f48f0094f`
  (2026-11-09, authorized by the owner); the next commit records this handoff update. See §9 for the file list.
- `main` (`8f0235b`) and both teammates' branches are untouched.

## 5. Status in one paragraph
Organization review is built end to end and verified (database, API, admin and employer screens, browser walk, 11 e2e
tests). Approval now gates publishing, applications, invitations and public listing. Automatic Arabic↔English translation
is built across AI service, API and web, and verified up to the model call; with no AI key locally it reports "not
available" instead of inventing text. The shortlist-before-interview rule, documented elsewhere as existing, was not
enforced; it now is. The rest of the employer and admin scope existed before this branch and is listed with its state in
`MIDAN_EMPLOYER_PROGRESS.md`.

## 6. Completed in this branch
1. Organization review: migration `20261111090000_organization_verification.sql` (+ rollback, tested: down → up).
2. Employer review page `/organization/[orgId]/verification`, workspace banner until approved, nav item.
3. Admin: `/admin/organizations` (status chips with counts, search), `/admin/organizations/[id]` (profile, private
   documents, decision with reason, suspension/reactivation with reason, review history, audit trail); overview queue.
4. Automatic bilingual translation (AI `translate.py`, API `TranslationController`, web `BilingualPair`) in the new-job form
   (title, description) and the job details step (title, description, requirements).
5. Interviews require a shortlisted application: migration `20261111100000_interview_requires_shortlist.sql`.
6. E2E suites approve their organizations through the real review (`apps/api/src/test-support/approve-organization.ts`);
   `scripts/investor-demo.mjs` and `supabase/seed.sql` updated likewise.

## 7. Incomplete (exact next steps in §8 and §23)
Per-organization Google Calendar OAuth; AI interview questions; job opening date/time and "closing soon" states (needs the
candidate branch's deadline guard merged first); account suspension of a person; extra team roles; real-model verification
of translation, generation and evaluation (needs keys); browser re-walk of job steps 3–6, applications, evaluation, hiring.

## 8. Current task and next steps
Last task: handoff documents. Next:
1. Done: committed and pushed (`dc7faf1`).
2. With a Groq key in the local `.env` (`AI_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL`), restart the AI service and check
   translation in the browser (type Arabic title → English fills in ~1 s; edit English; type more Arabic → English stays).
3. Merge plan with the candidate branch (see contract §7), then the full API e2e on a fresh database.
4. Google Calendar per-organization OAuth (see §16).

## 9. Files
Created: `supabase/migrations/20261111090000_organization_verification.sql`, `supabase/migrations/20261111100000_interview_requires_shortlist.sql`,
their rollbacks; `apps/api/src/organizations/organization-verification.controller.ts`, `apps/api/src/admin/admin-organizations.controller.ts`,
`apps/api/src/jobs/translation.controller.ts`, `apps/api/src/common/file-type.ts`, `apps/api/src/organization-review.e2e-spec.ts`,
`apps/api/src/test-support/approve-organization.ts`; `services/ai/midan_ai/translate.py`, `services/ai/tests/test_translate.py`;
`apps/web/src/components/verification.tsx`, `apps/web/src/components/bilingual.tsx`, `apps/web/src/lib/verification.ts`,
`apps/web/src/lib/verification-actions.ts`, `apps/web/src/lib/verification.test.ts`, `apps/web/src/lib/translation.ts`,
`apps/web/src/lib/translation-actions.ts`, `apps/web/src/lib/translation.test.ts`, `apps/web/src/app/[locale]/organization/[orgId]/verification/page.tsx`,
`apps/web/src/app/[locale]/admin/organizations/page.tsx`, `apps/web/src/app/[locale]/admin/organizations/[id]/page.tsx`; the four
`docs/handoff/MIDAN_EMPLOYER_*.md`.
Modified: `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`, `apps/api/src/admin/admin.controller.ts` (overview counts, org list
filters), `apps/api/src/ai/ai.client.ts` (`translate`), `apps/api/tsconfig.build.json`, e2e specs (accounts, career, foundation,
match, phase3, pipeline, recruitment, skills: approval helper; foundation: shortlist step), `services/ai/midan_ai/main.py`,
`apps/web/src/components/{forms,workspace,admin,org-shell}.tsx`, `apps/web/src/app/[locale]/admin/page.tsx`,
`apps/web/src/app/[locale]/organization/[orgId]/layout.tsx`, `apps/web/src/messages/{en,ar}.json`, `apps/web/package.json`,
`apps/web/tsconfig.json`, `scripts/investor-demo.mjs`, `supabase/seed.sql`. Deleted: none.

## 10. Backend APIs
See the contract §4 (11 routes added). `GET /admin/overview` gains `organizations_pending_review`,
`organizations_changes_requested`, `organizations_approved`, `organizations_rejected`, `organizations_suspended`,
`organizations_draft`, `candidates`, `applications`, `applications_last_7_days`, `upcoming_interviews`.
`GET /admin/organizations` gains `status` and `q` filters and review fields. AI service: `POST /translate`.

## 11. Database
- `organizations`: `verification_status` (default `draft`; existing rows set to `approved` with an `approved_before_review`
  audit row each), `verification_updated_at`, profile columns. Guard trigger: members can't set the status, and can't change
  names/CR while pending/approved/suspended.
- `organization_documents` (RLS: org owner/admin + platform admins; add/remove only while editable), private bucket
  `organization-documents` (PDF/PNG/JPEG, 10 MB).
- `organization_verification_requests` (snapshot of what was reviewed, decision, note, reviewer, time; one open per org).
- Functions: `submit_organization_verification`, `admin_decide_organization`, `admin_set_organization_suspension`,
  `private.org_is_active`, `private.has_applied_to`, `private.notify_org_admins`.
- Gates: triggers `guard_job_publication_org` (jobs), `guard_applicant_org` (applications), `guard_invitation_org`
  (organization_invitations), `guard_interview_shortlist` (interviews); restrictive select policies on `jobs`.
- **Hosted project**: has 23 of the earlier migrations; these two are not applied there. Deploying is the owner's decision.

## 12. Authentication and authorization
No change to Supabase Auth or the access-code gate. Admin = `private.platform_admins` (checked by `PlatformAdminGuard` and
again inside every admin function). Registration never grants admin. All gates are in the database, not only the UI.

## 13. AI providers
`AI_PROVIDER` selects Groq/OpenAI/Gemini; without keys the service is in labelled demo mode. Translation uses the configured
model, then Gemini as the alternate when it's configured and isn't the primary; failure kinds (`not_configured`,
`rate_limited`, `quota_exhausted`, `unavailable`, `timeout`, `invalid_reply`) reach the page. Evaluation and generation
provider orchestration is unchanged (no Gemini fallback there yet). E5 matching unchanged.

## 14. Translation behaviour (`components/bilingual.tsx`, rules in `lib/translation.ts`)
Typing in one language translates into the other after 900 ms, only if the other field is empty or was filled by
translation and not edited since; never while the other field has focus; late replies are dropped if the source changed;
saved text counts as the employer's own and is never replaced automatically; "Translate from Arabic/English" replaces on
request; machine-filled fields are tinted and labelled "Translated by AI. Review it before saving"; both languages are
saved by the form as before (no auto-publish). Not yet on: assessment task titles/instructions, requirement rows.

## 15. Organization approval workflow
Register (email verified) → organization exists as `draft` → owner completes profile + uploads commercial registration →
submit (`pending_review`, locked) → platform admin approves / requests changes (note) / rejects (reason) → organization sees
status and note, edits and resubmits → approved organizations recruit; admins can suspend (reason) and reactivate (reason).
Every step: audit row + in-app notification.

## 16. Google Calendar
Existing: one platform calendar via `GOOGLE_CALENDAR_*` refresh token; deterministic event ids (no duplicates on retry),
`calendar_status`, retry endpoint, `sendUpdates` control, failures keep the interview. Not built: per-organization OAuth
connection (needs a Google OAuth client and redirect URI from the owner, token encryption design).

## 17. Shared dependencies with the candidate side
See the contract. Key: apply returns 422 for unapproved/suspended organizations; suspended jobs hidden except to applicants;
interviews need shortlisted applications; e2e helper for approving organizations.

## 18. Known bugs and blockers
- No AI key locally → translation/generation/evaluation can't be checked with a real model (BLOCKED: credentials).
- No SMTP → decisions are in-app only (BLOCKED: credentials).
- Google OAuth client for per-organization calendars (BLOCKED: credentials).
- Suspending a person's account needs the Supabase Auth admin API (service role) in the API — not done; listed for an owner
  decision because it adds a privileged key to the API.
- API e2e reruns on the same database fail 9 older tests that assume fresh fixture accounts/listings (details §19).
- Hiring rule: manual hire needs shortlisted **or** evaluated (owner decision 2026-11-07); the brief says "no shortlist
  needed" — confirm.

## 19. Build and test results (2026-11-09, local Windows stack)
- AI: full suite 259 passed, 11 skipped (was 251 + 8 new translation tests; skips are optional E5 model, OCR, private
  guide, real-provider calls).
- API: type check clean; unit 80/80; `organization-review.e2e-spec.ts` 11/11; full e2e run (second run on the same database):
  190/199 — the 9 failures are rerun-state: candidate fixture profile already holds skills/languages from the previous run
  (foundation ×3, career ×2) and external listings from the previous run are now duplicates so publishing them is refused
  (pipeline ×4). Foundation after the shortlist rule: 96/99 (same 3 rerun-state failures).
- Web: type check clean; unit 38/38.
- Browser (real local stack): employer registration → verification link → draft banner → profile + document → submit →
  admin queue → refusal without reason refused → approve → approved; translation request path with "not available here".

## 20. Windows commands
One command starts everything that isn't running and leaves it running (see §24 and `docs/local-development-windows.md`):
`powershell -ExecutionPolicy Bypass -File scripts\local-up-windows.ps1`. After pulling new migrations:
`scripts/local-db.sh migrate`, then restart the API (and the AI service if it changed).

## 21. Environment variable names (never commit values)
`.env`: LOCAL_PG_PORT, LOCAL_SUPABASE_PORT, LOCAL_SMTP_PORT, LOCAL_AUTH_PORT, LOCAL_REST_PORT, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, DATABASE_URL, DIRECT_URL, API_URL, AI_SERVICE_URL,
AI_SERVICE_TOKEN, CHECKPOINT_DATABASE_URL, AI_PROVIDER, GROQ_API_KEY, GROQ_MODEL, GEMINI_API_KEY, GEMINI_MODEL,
OPENAI_API_KEY, OPENAI_MODEL, DEV_TEST_SIGNUP, DEV_TEST_ACCESS_CODE, APP_URL, DAILY_API_KEY, GOOGLE_CALENDAR_CLIENT_ID,
GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN, GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_SEND_UPDATES.
`.env.test.local`: TEST_<ACCOUNT>_EMAIL / _PASSWORD for ORG_A_OWNER, ORG_A_RECRUITER, ORG_B_OWNER, CANDIDATE_ONE,
CANDIDATE_TWO, UNVERIFIED, PLATFORM_ADMIN, UI_EMPLOYER, UI_CANDIDATE, UI_REVIEW_EMPLOYER.

## 22. Decisions and reasons
- Status lives on `organizations` (one place every gate reads) with requests as history, not a status per request.
- Gates are database triggers/RLS so no path (API, Data API, scripts, listing conversion) bypasses approval.
- Existing organizations grandfathered as approved so nothing running breaks; recorded in the audit log.
- Rejected organizations may resubmit (a new request), keeping the full history.
- Translation never falls back to non-model text; failure is shown and the employer writes the language.
- Interviews: shortlist rule in the database; rescheduling is an update and stays allowed.

## 23. Next recommended task
Per-organization Google Calendar OAuth (needs credentials), or — if credentials wait —
job opening/closing dates with Saudi-time states after merging the candidate branch's deadline guard, then AI interview
questions.

## 24. Local stack on the owner's Windows machine (verified 2026-11-09, evening)

**Checkout:** `D:\Downloads\MIDAN-feature-midan-employer-experience\MIDAN`, branch `feature/midan-employer-experience` at
`57339c8`, with the uncommitted changes listed below (not committed: the owner commits). Another checkout on the same
machine (`...\MIDAN-teammate`) has its own database on port 54322; it was left running and untouched.

**Running now (background processes, logs in `.local\logs` and `.local\supabase*.log`):**

| Service | Address | Process |
| --- | --- | --- |
| PostgreSQL 18.3 (cluster `.local\pg`) | 127.0.0.1:54323 | `postgres.exe -p 54323` |
| Local Supabase gateway | http://localhost:54321 (mail list `/__mail`) | `node scripts/local-supabase.mjs` |
| Mail sink (Auth's SMTP) | 127.0.0.1:54326 | same process |
| Supabase Auth / PostgREST | 54329 / 54328 | `.local\bin\auth.exe`, `.local\bin\postgrest.exe` |
| AI service (demo mode: no AI key) | http://127.0.0.1:8000 | `.local\ai-venv\Scripts\python.exe -m uvicorn` |
| API | http://localhost:4000/v1 | `node dist/main.js` |
| Web | http://localhost:3100 | `next dev -p 3100` |

**Database state:** 55/55 migrations; Auth migrations done; seed loaded; 5,074 reference skills and 10 registry
employers imported (identical, by checksum of names and normalized search text, to a correctly built database); 7 fixture
accounts plus one browser test employer (credentials only in `.env.test.local`).

**Fixed during start-up:**
1. Ports configurable (`scripts/local-ports.mjs`): database 54323, gateway 54321, SMTP 54326 used by both the mail sink
   and `GOTRUE_SMTP_PORT`, Auth 54329, PostgREST 54328; written to `.env` by `local-env.mjs`; `local-db.sh`,
   `import-data.mjs`, `investor-demo.mjs` follow. Preflight `node scripts/local-supabase.mjs check` names the program
   holding a taken port and stops nothing; the gateway stops cleanly with a reason if a listener or child process fails.
2. Arabic text garbled by migrations applied through psql in the WIN1252 code page: only `public.normalize_arabic` was
   affected (found by comparing every function, constraint, default, view and policy with a correctly built database);
   recreated from `20261106005417_fix_normalize_arabic.sql` with UTF-8; nothing depending on it held data yet.
   `local-db.sh` now sets `PGCLIENTENCODING=UTF8` so it can't recur.
3. `local-env.mjs --force` now keeps AI, calendar and video credentials already in `.env`.
4. `scripts/local-up-windows.ps1`: one command to start the stack (never stops other programs).
5. Document sizes under 1 KB show "<1 KB" (was "0 KB").

**Verified in the browser (real local stack):** employer registration -> verification email through SMTP 54326 ->
signed-in workspace with the review banner -> profile saved -> commercial registration uploaded -> submitted (under
review, documents locked) -> new job created (Arabic title; automatic translation reported "not available" because no AI
key is configured; English typed by hand) -> publishing refused while under review ("This change isn't allowed", job
stays draft) -> platform admin: overview counts (1 waiting), organization detail, approve -> employer: banner gone,
approval notification received, publishing succeeds -> job returned to draft afterwards so no test job is public.
No new browser console errors during the walk (the ones in the buffer date from switching servers).

**Checks:** web type check clean, web unit 38/38, API type check clean, `node --test scripts/local-ports.test.mjs` 4/4.

**Uncommitted changes in this checkout:** `scripts/local-ports.mjs` (new), `scripts/local-ports.test.mjs` (new),
`scripts/local-up-windows.ps1` (new), `scripts/local-supabase.mjs`, `scripts/local-env.mjs`, `scripts/local-db.sh`,
`scripts/import-data.mjs`, `scripts/investor-demo.mjs`, `apps/web/src/components/verification.tsx`,
`docs/local-development-windows.md`, `docs/handoff/MIDAN_EMPLOYER_CURRENT_STATE.md`, `docs/handoff/MIDAN_EMPLOYER_PROGRESS.md`.
Git-ignored local files created: `.env`, `.env.test.local`, `.local\ai-venv`, `.local\logs`, `data/source/*.xlsx|zip`.

**Still blocked:** real AI output (needs `GROQ_API_KEY`/`GROQ_MODEL` or Gemini in `.env`), email delivery (SMTP
provider), Google Calendar (OAuth client).

## 25. Supabase Cloud only (2026-11-09, late evening; owner's decision)

The owner decided MIDAN runs on the existing Supabase Cloud project **al-midan-ya-hamidan** (`squpszwbrqkflezfltoj`),
not local Supabase, and that no extra email provider (such as Resend) is added. Guide: `docs/supabase-cloud.md`.

Done (uncommitted in `D:\Downloads\MIDAN-feature-midan-employer-experience\MIDAN`):
- `.env` now points at the cloud project (URL, publishable key, Groq/Gemini/Daily/calendar settings reused from the earlier
  cloud checkout `MIDAN-midan-platform-p0/.env`); the local-mode files are kept as `.env.local-supabase-backup` and
  `.env.test.local-supabase-backup` (git-ignored).
- `scripts/local-up-windows.ps1`: cloud mode starts only AI, API and web, checks cloud Auth first, and doesn't start the API
  without `DATABASE_URL`; local Supabase starts only when `.env` points at localhost.
- `apps/api/src/main.ts`: refuses to start without `DATABASE_URL` (no fallback database).
- Local Supabase gateway, Auth, PostgREST and mail sink stopped; both local PostgreSQL clusters (54322, 54323) left running
  and untouched.
- Bilingual Auth email templates kept in `supabase/templates` for the dashboard; the unfinished Resend integration was set
  aside (not deleted) in `.local/set-aside/` (git-ignored).

Verified: cloud Auth healthy (GoTrue v2.197), sign-ups enabled, email confirmation on; Data API answers with the
publishable key; the web app's sign-in reaches cloud Auth (wrong password -> "Incorrect email or password", recorded in the
project's Auth log); AI service live with Groq; web running on http://localhost:3100.

Cloud project state (read only): 23 of 55 migrations applied (to `20261106005827`); 7 Auth users (6 fixture accounts on
example.com, 1 Gmail account); 2 demo organizations and jobs; 5,073 reference skills; roles `midan_api` and
`authenticator` exist (`midan_ai`, `midan_importer`, `midan_worker` come with later migrations).

Blocked on the owner (nothing applied to the cloud project):
1. Approval to apply migrations `20261106140000` ... `20261111100000` (32 files) to the cloud project — they change its
   schema (and set existing organizations to approved). Until then the employer/admin screens can't work on the cloud.
2. Approval to set the `midan_api` login (`scripts/provision-db-credentials.mjs`), which fills `DATABASE_URL`.
3. Registration: the access code the cloud accepts (or approval to add a new one), and `DEV_TEST_SIGNUP=true` locally.
4. Dashboard: `http://localhost:3100/**` in Auth Redirect URLs; the email sender (built-in reaches only team members).
5. A real recipient address, and approval, for the verification and recovery email tests.

### 25a. Cloud migration progress (2026-11-10, owner approved applying the migrations and setting the API login)

Done:
- **`midan_api` login set on the cloud project** (owner-approved): a new random password, generated on this machine,
  stored only in the git-ignored `.env` (`DATABASE_URL`, `DIRECT_URL`, session pooler `aws-1-eu-central-1`, port 5432);
  the cloud received only its SCRAM verifier. Checked: it connects, can't read tables directly, and can assume
  `authenticated` (RLS applies). The previous `.env` is kept as `.env.before-cloud-login-backup`.
- **Rehearsal passed** (`scripts/rehearse-migrations.sh`, now Windows-compatible): the cloud's live schema fingerprint still
  matches `supabase/rehearsal/hosted-baseline.txt`; all 32 pending migrations apply, roll back to identical and re-apply;
  29 post-change checks and the database security tests pass; the full rollback returns to the cloud's fingerprint.
- **Fixed before any cloud change**: `20261111090000_organization_verification` approved existing organizations with an
  UPDATE, which fired triggers (bumped `updated_at`, wrote audit rows) and couldn't be rolled back cleanly. It now sets
  them through the new column's default (no triggers), then makes `draft` the default. Local databases (54322, 54323) ran
  the earlier text; their schema is the same. `supabase/tests/security_phase1.sql` approves the organizations it creates.
- **`scripts/apply-cloud-migrations.mjs`**: applies the pending files exactly (LF, as the cloud stores them), each in its
  own transaction with its history row, refuses unless the cloud history matches the repository one for one, and checks
  every stored text afterwards. Tested against a throwaway cluster at the cloud's starting point: 55/55 recorded, 29/29
  checks, a second run finds nothing pending.

Not done — **no migration has been applied to the cloud yet**:
- `apply_migration` would need the 250 KB of SQL reproduced by hand into each tool call (no guarantee of exactness on a
  production schema), and a temporary in-database helper to run the files was refused by this environment's permission
  rules as remote-code-execution surface. The remaining step needs the project's postgres connection string as
  `MIGRATION_DATABASE_URL` in `.env` (owner's decision: one `.env` for all settings, no separate file), then
  `node scripts/apply-cloud-migrations.mjs --apply` after the owner approves the dry run's plan.
- The API is not started against the cloud until then (its screens need the new columns).

### 25b. The cloud was migrated from the integration branch (found 2026-11-10)

Before anything was applied from this branch, a read-only check showed the cloud project already at **57 migrations**:
this branch's 55, the candidate branch's `20261110150000_candidate_saved_jobs_and_deadlines`, and
`20261111110000_worker_role_for_hosted_login` from `feature/midan-integration` (commit `9317f24`, Nada Al-Nashwan,
`docs/handoff/MIDAN_CLOUD_MIGRATION_PLAN.md`, `scripts/apply-hosted-migrations.sh`). Those six newest history rows have no
stored statement text. Her version of `20261111090000_organization_verification` carries the same trigger-free fix as this
branch (identical SQL apart from one line break), and the cloud matches it: the 2 demo organizations are approved with 2
`approved_before_review` audit rows; all new triggers, buckets (`employer-claims`, `organization-documents`) and roles
(`midan_ai`, `midan_importer`, `midan_worker`, no login) exist; 67 tables, 156 functions, 1 platform administrator, and a
third organization `midan-test-cloud-mw9rcmqa` (approved) from her cloud test run. The `midan_api` login set from this
branch still connects.

So **nothing from this branch remains to apply**. `scripts/apply-cloud-migrations.mjs` (which now reads
`MIGRATION_DATABASE_URL` from `.env`, the owner's single configuration file) would refuse on this cloud, by design: its
history is ahead of this branch (two migrations this branch doesn't have). Bring this branch up to the integration branch
before using the script again.

### 25c. API tests against Supabase Cloud (2026-11-10, read-only)

The API runs from this branch against the cloud (`midan_api` login, session pooler), with the web app and the AI service
(Groq, live). No migration was run and no cloud data was written.

Passed (24 automated checks plus browser checks): API health; public jobs read from the cloud database (0 non-demo jobs, 2
demo jobs); paged search; job detail with skills and assessment overview; unknown job 404; skills catalog (6); registry
employers (10); `/me`, `/admin/overview`, `/admin/organizations`, organization review, organization jobs and translate all
refuse a missing session (401) and a forged token (401); web pages (home in both languages, opportunities, sign in,
register, forgot password) render; the demo job page renders from the cloud with its skills; sign-in reaches cloud Auth
(wrong password refused, logged by the cloud project). Schema: every table and column this branch's Prisma schema expects
exists in the cloud (the 15 `external_job_listings` columns hidden from `authenticated` are column-level grants, present
in the catalog). Compatible with the integration branch's two extra migrations: `saved_jobs` readable by signed-in
users; `midan_api` can still switch to `midan_worker`, `authenticated` and `anon`; no background-worker errors.

Fixed: `/admin` wasn't in the web proxy's private routes, so an anonymous visitor got the error page (the admin page's
API call threw 401 before the layout's redirect). Now `/admin/**` redirects to sign in with `next` (both languages).

Not tested — signed-in employer and admin flows: they need dedicated test accounts on the cloud. Creating them (confirmed
fictional users, no email) and granting one platform-admin access were refused by this environment's permission rules as
writes to a shared production resource and a permission grant. Options: the owner creates them (Supabase Dashboard >
Authentication > Add user, "Auto confirm"; then `insert into private.platform_admins` for the admin), or allows these
writes for this session.

### 25d. Signed-in tests on Supabase Cloud with dedicated QA accounts (2026-11-10, owner allowed the writes)

Created (fictional, already confirmed, no email; passwords only in the git-ignored `.env` as `TEST_CLOUD_QA_*`):
`midan.test.cloud-qa-mw9rz7iu-{employer,outsider,admin,candidate}@example.com`. The sign-up logic gave both employers
draft organizations flagged `is_test` (hidden from public listings) and the candidate a profile. The platform-admin grant
for the QA admin was refused by this environment's permission rules (a permission grant), so the QA admin has no
privileges.

**22/22 signed-in API tests passed:** cloud sign-in for three accounts; `/me`; the employer's organization is a draft with
role owner; tenant isolation (the other employer gets 403 on the organization, its review and its jobs); a candidate is
refused employer routes and organization creation; an employer is refused admin routes; draft job created; publishing
and team invitations refused while the organization is a draft (422; no invitation, no email); job details and a
requirement saved; jobs listed and opened; the draft job isn't public and can't be applied to; **live AI translation**
("محلل بيانات المبيعات" -> "Sales Data Analyst", Groq `openai/gpt-oss-120b`); review submission refused until complete;
profile saved; a non-PDF refused and a PDF stored privately in cloud Storage; the signed document link works for the
owner and is refused to the other employer; review state correct; team and applications pages answer.
**Browser (cloud):** QA employer signs in; draft banner; review page reflects the saved profile and document; typing an
Arabic title fills "Senior Software Engineer" in about a second; after editing the English by hand, more Arabic typing
leaves it untouched.

Not tested (need a platform administrator): submitting for review (it notifies every platform administrator, today the
owner's real account), admin decisions, suspension, publishing after approval, applications to a published job, and the
shortlist-before-interview rule end to end. To continue, the owner adds the QA admin in the Supabase SQL editor:
`insert into private.platform_admins (user_id, note) values ('b513e82d-e3ef-4022-92e6-0db7af45dec3', 'cloud QA; remove after testing');`
and removes it afterwards (`delete from private.platform_admins where user_id = 'b513e82d-e3ef-4022-92e6-0db7af45dec3';`).

QA records left in the cloud (all owned by the QA accounts): 4 accounts, 2 test organizations (`94fcbcb3-…`,
`f4e1bbd9-…`), 1 draft job (`7ccc3ce0-…`) with one requirement, 1 organization profile, 1 placeholder PDF in the
private `organization-documents` bucket.

### 25e. Admin flows on Supabase Cloud (2026-11-10; the owner granted the QA admin, removed again afterwards)

**20 of 21 passed:** admin overview counts; admin list filtered by status and searched; admin detail (profile, document,
member); no decision possible before submission (404); submission locks the identity, documents and publishing (422 for
each); the pending queue lists it and the signed document link opens for the admin; another employer is refused the admin
detail and decisions (403); refusing or requesting changes without a reason is refused (422), an unknown decision 400;
changes requested with a note -> the employer sees the note and an in-app notification -> adds the letter and resubmits ->
admin approves (a second decision finds nothing: 404); after approval names stay locked, the description is editable, and
an approval notification arrives; the approved organization publishes its job; a team invitation is created and revoked
(no email: none configured); the candidate applies (a repeat returns the same application); the employer sees it, the
other employer can't; **an interview is refused before shortlisting (422)**, then the candidate is shortlisted;
suspension needs a reason, a suspended organization can't publish, reactivation restores it; the audit trail reads
submit > request_changes > submit > approve > suspend > reactivate. Not run: creating the interview after shortlisting
(it would create a real Daily room).

**The one failure was the test's own expectation:** an anonymous visitor could open the published test job by its exact
ID (`GET /jobs/:id`). By design (`apps/api/src/common/test-data.ts`), test organizations are kept out of *listings*, which
held (the public list shows 0); a direct ID was never restricted. Worth deciding whether test organizations' jobs should
also 404 by ID.

**Clean-up done:** the QA job is back to draft (anonymous 404); the QA admin's platform-admin access is removed (1 admin
again, the owner's). Left in place, all QA-owned: 4 accounts, 2 test organizations (one approved, with profile, two
placeholder PDFs, one revoked invitation), 2 draft jobs, 1 shortlisted application from the QA candidate, and in-app
notifications (including one "organization submitted for review" notice to the owner's admin account, sent twice).

### 25f. Demo preparation (2026-11-10)

**Test organizations stay private by direct link too.** `GET /jobs/:id` and applying (`POST /jobs/:id/applications`) now use
`viewableJob` (`apps/api/src/common/test-data.ts`): a test organization's job is "not found" to anonymous visitors and to
real accounts, as listings already were; the test accounts still see it (their suites depend on it). Genuine and demo
organizations are unaffected. Suites that opened test jobs anonymously now open them as a test account. Not covered: the
Supabase Data API (`/rest/v1/jobs?id=eq.<id>` with the publishable key) still returns a published test job to anyone who
knows its ID; closing that needs an RLS migration and would also hide test jobs from the API's anonymous reads, so it is
an owner decision.

**Branches.** `feature/midan-integration` (`08161d9`, Nada Al-Nashwan) already contains every employer commit (merge base =
employer tip `940a311`) plus 16 commits: candidate saved jobs and deadlines, `scripts/dev-all.sh` (one command, `--cloud`),
cloud migration tooling (`scripts/apply-hosted-migrations.sh`, `scripts/with-env.mjs`, `MIDAN_CLOUD_MIGRATION_PLAN.md`),
the two migrations only the cloud and that branch have (`20261110150000_candidate_saved_jobs_and_deadlines`,
`20261111110000_worker_role_for_hosted_login`), a CV-analysis local fallback, and **a palette change recorded as the
owner's instruction (#0F5B46, #1F7A5C, #DCEEE5, #F7F4EE, #1F2A26, no gold)**. The employer branch can take it as a fast
forward. This checkout's uncommitted work overlaps it in three files: `jobs.controller.ts` merges cleanly;
`20261111090000_organization_verification.sql` and `supabase/tests/security_phase1.sql` conflict only because both sides
made the same fix — take the integration versions (the migration text is what the cloud ran). Duplicates to settle after
merging: two cloud migration scripts (`apply-cloud-migrations.mjs` here, which expects stored statement text that the
cloud's six newest history rows lack, vs `apply-hosted-migrations.sh` there) and two launchers (`local-up-windows.ps1` vs
`dev-all.sh`). The bilingual email templates use the old gold palette and need recolouring if the new palette stands.

**Email and redirects (Supabase dashboard, not readable from here).** Auth settings that are public: email sign-in on,
email confirmation required (`mailer_autoconfirm` false), sign-ups enabled (gated by the database). The cloud Auth log for
the past day shows only QA sign-ins: no email was sent during testing. What the owner sets:
- Authentication > Emails > SMTP Settings: enable custom SMTP with the chosen provider's host, port (465 or 587),
  username, password, sender email (on a domain verified with that provider) and sender name `MIDAN | ميدان`; then raise
  "Rate limit for sending emails" from the built-in default. Until then only the project team's addresses receive mail.
- Authentication > URL Configuration: Site URL = the production address (unknown yet); Redirect URLs =
  `http://localhost:3100/**` and `https://<production domain>/**`. The app's links: `/<locale>/auth/confirmed`
  (sign-up confirmation, `?as=organization` for employers), `/<locale>/reset-password` (recovery),
  `/<locale>/auth/callback` (Google sign-in). `APP_URL` in `.env` must equal the address in use.
- Optional: paste `supabase/templates/*.html` into Emails > Templates.

**QA cleanup plan:** `docs/handoff/MIDAN_CLOUD_QA_CLEANUP_PLAN.md` (inventory and SQL, not executed).

**Verified (2026-11-10).**
- Test-organization privacy against the cloud: after restarting the API with the fix, the integration branch's published
  test job (`4d7cfebc-…`) is 404 for anonymous visitors (and its web page renders "not found", no job content), the demo
  job still opens, a test account still sees the test job. API unit tests 83/83 (3 new for `viewableJob`).
- Interviews (local stack, fake Daily and Google Calendar on 127.0.0.1:54398, demo AI, no real rooms or invitations):
  refused until shortlisted; "not configured" said honestly; rescheduling keeps the appointment and asks again; join tokens
  checked for who and when, credentials server-side; calendar results reported as they happened; interviews scheduled with
  chosen participants, cancellation notified; shortlisting undone without rejecting; decisions left to a person.
- Regression (local): API e2e full run 1 (fresh database) — all suites passed except `pipeline`, whose setup failed once
  (cause not captured); full run 2 — 191/200, the 9 failures being the known rerun-state tests (fixture accounts/listings
  already used: foundation x3, career x2, pipeline listings x4); `pipeline` alone 27/31 (same 4). The 4 listing tests need a
  fresh database to confirm. API unit 83/83, web type check clean, web unit 38/38, AI 259 passed 11 skipped, port tests 4/4.
- Arabic/RTL in the cloud app: `dir=rtl lang=ar`, Arabic headings, statuses and dates in Arabic numerals, no untranslated
  English or missing keys; the bilingual job fields keep their own direction (Arabic RTL, English LTR).

### 25g. Branches reconciled locally (2026-11-10, owner approved; not committed, not pushed)

The local `feature/midan-employer-experience` was fast-forwarded to `origin/feature/midan-integration` (`08161d9`), and
this session's uncommitted work re-applied on top. Overlaps resolved as planned: the integration versions of
`20261111090000_organization_verification.sql` and `supabase/tests/security_phase1.sql` (what the cloud ran);
`jobs.controller.ts` merged cleanly (saved-jobs deadline filter and sort + `viewableJob`). Backups of the pre-merge work:
`.local/reconcile/` (patch of tracked files, archive of new files). Nada's `candidate-discovery.e2e-spec.ts` now approves
its organization first (it published from an unapproved one, refused by the approval rule).

Checks on the reconciled code: API type check clean, API unit 83/83, web type check clean, web unit 40/40, AI 261 passed
11 skipped, port tests 4/4, local database migrated with the two integration migrations; API e2e 191/204 before the
discovery fix (the 9 known rerun-state tests + 4 discovery tests), discovery suite 4/4 after it. Cloud smoke test
on the merged code: health, deadline-sorted jobs, demo job 200, test-organization job 404 anonymously, `/admin` -> sign in,
new palette (#0F5B46) active; a few old colours (#0B3D2E, #D4AF37) remain in the stylesheet.

Still to settle after this: retire `scripts/apply-cloud-migrations.mjs` (doesn't fit the cloud's history rows without
statement text; the integration branch's `apply-hosted-migrations.sh` applied them), choose one launcher
(`local-up-windows.ps1` or `dev-all.sh`), recolour `supabase/templates/*.html` if the new palette stands.
