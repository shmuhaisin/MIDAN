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
