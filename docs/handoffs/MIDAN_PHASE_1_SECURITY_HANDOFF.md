# MIDAN — Phase 1 Security Handoff

Written 2026-11-07 for the developer who continues the work. It assumes no access to the conversation that produced it.
Phase 1 covers the security and data-integrity findings S1–S8 of
[docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md](../audits/MIDAN_PHASE_0_GAP_ANALYSIS.md) (section 7). Read that report for
the architecture and the state of every feature.

Status words used below: **Completed** (implemented, and tested here), **Partial** (some of it done), **Unverified**
(written but not run). "Tested here" means run in this environment, described in section B.0.

---

## A. Project and Git state

| Item | Value |
| --- | --- |
| Repository | https://github.com/shmuhaisin/MIDAN (public) |
| Branch | `feature/midan-phase-1-security` |
| GitHub branch URL | https://github.com/shmuhaisin/MIDAN/tree/feature/midan-phase-1-security |
| Base branch | `feature/midan-complete-data-jobs-assessment` (itself not merged into `candidate-portal` or `main`) |
| Base commit | `e86932b` "Add the complete implementation handoff for this branch" |
| Current HEAD | The commit that adds this version of this document (the last one in the list below). Check with `git log -1` |
| Push | Pushed with `git push -u origin feature/midan-phase-1-security` when this handoff was made, with the owner's authorization. The local branch tracks `origin/feature/midan-phase-1-security`. Nothing was force-pushed, and nothing was merged |
| Other remote branches | `main` `8f0235b`, `candidate-portal` `2523115`, `feature/midan-complete-data-jobs-assessment` `e86932b`, `feat/company-workflow` `c5cb1af`. The last was created by someone else during this work; it wasn't reviewed or touched, and may overlap with this branch |

Phase 1 commits, oldest first:

| Commit | Message | Contents |
| --- | --- | --- |
| `037afdf` | Add the Phase 0 repository audit and gap analysis | `docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md` |
| `16dd598` | Scope candidate documents to their organization and enforce application status moves | S1, S2, S5 code, migrations and tests |
| `8141bfc` | Harden requests: verified rate-limit keys, constant-time AI token, security headers | S3, S6, S7, S8 code and tests |
| `3d15261` | Document Phase 1: handoff, decisions, deployment and status | First version of this document; DECISIONS, deployment, local development, PROJECT_STATUS, HANDOFF |
| `99874db` | Record the owner's decision to keep the 30-minute CV link (S5) | Documentation |
| (HEAD) | Complete the Phase 1 handoff and record the confirmed decisions | This document, DECISIONS, PROJECT_STATUS, audit update |

No commit was reset, rebased or amended. Inspected before pushing: no `.env` file, credential, real candidate data or
build output is tracked. The test data in `supabase/tests/security_phase1.sql` and the end-to-end specs is fictional
(`@example.com`, fixed UUIDs, placeholder tokens).

---

## B. Implemented work

### B.0 Where and how it was tested

Windows 11, Node 22.19.0, npm 10.9.3, Python 3.14.6 in a virtual environment with the dependencies from
`services/ai/pyproject.toml` (the lock file targets 3.13; `uv` wasn't installed), and the PostgreSQL 18.3 binaries.
**Not available:** Docker, WSL, tesseract, the Linux binaries of the local Supabase stack (GoTrue, PostgREST), and
`.env` / `.env.test.local`. So:
- Unit tests, type checks and builds ran normally.
- **Database tests** ran on a throwaway PostgreSQL 18 cluster with every migration applied, using the repository's own
  Supabase shim plus a minimal stand-in for Supabase Auth's tables (recipe in F.3).
- **The API end-to-end suite (108+ cases) and the browser suites were not run**: they need the Linux local stack. The new
  end-to-end cases are written and type-checked only. **Nothing ran against hosted Supabase.**

Results (final run, on the code as pushed):

| Check | Command | Result |
| --- | --- | --- |
| API unit tests | `npm test -w @midan/api` | **22 / 22 passed**, 6 suites (7 before Phase 1) |
| Web unit tests | `npm test -w @midan/web` | **15 / 15 passed** (7 before) |
| AI service tests | `cd services/ai && pytest` | **124 passed, 3 skipped** (88 + 3 before). Skipped, as before Phase 1: two OCR tests (no tesseract), one Postgres-checkpoint test (no `TEST_CHECKPOINT_DATABASE_URL`) |
| Type checks | `npm run lint` | **Passed** (api and web, including the end-to-end specs) |
| API build | `npm run build -w @midan/api` | **Succeeded** |
| Web build | `DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run build -w @midan/web` | **Succeeded** |
| Build secret scan | `DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run check:bundle -w @midan/web` | **Passed** (no secret value in the build, no secret name in browser files). Control: the script fails on a planted value and a planted name |
| Database security checks | `supabase/tests/security_phase1.sql` after all 30 migrations | **All passed** (S1, S2, S5 sections). Control: without migration `20261107090000` the run **fails** at "S1: organization A sees exactly its own application's CV copy", so the test catches the original leak |
| Production web build in a browser | `next start` + browser, API intentionally down | `/en/about`, `/en/how-it-works`, `/ar/login`, `/en/opportunities` (error page because the API was down): **no CSP violations**; all 17 scripts on a page carried the nonce; theme script, client navigation and theme switch worked; headers as specified, no HSTS over HTTP. Run once, during implementation |
| API end-to-end | `npm run test:e2e -w @midan/api` | **Not run** (blocked: needs the local stack) |
| Browser end-to-end and forms | `npm run test:e2e -w @midan/web`, `npm run test:forms -w @midan/web` | **Not run** (blocked: same) |

### S1 — Cross-employer candidate documents (HIGH) · Completed at the database; end-to-end Unverified

- **Original issue.** The staff read policy on the `candidate-documents` bucket checked only the first folder of an
  object's path (`private.can_view_candidate_path`). Any organization with an active application from a candidate could
  read every file in that candidate's folder. That included the CV copies attached to applications to **other employers**
  (`{candidate}/applications/{jobId}/…`), and listing the folder revealed which other jobs the candidate had applied to.
- **Files.** `supabase/migrations/20261107090000_scope_candidate_document_access.sql` (new).
- **Implemented.** `private.can_view_candidate_document(name)` replaces the policy "org reads applicant documents".
  Members of an organization (any role, as before) read an object only if it is the `cv_snapshot_path` of an active
  (non-withdrawn) application to their organization. When that application has no copy, they read the candidate's
  current `cv_path` instead: the same fallback `GET /v1/applications/:id/cv-url` already uses. A withdrawal clears the
  copy, which ends access. `private.can_view_candidate_path` is unchanged and still governs candidate rows.
- **Tests added.** `supabase/tests/security_phase1.sql`, section S1: employer A sees exactly its own copy; can't see,
  list or infer the application to employer B; a reviewer of A sees the same; B sees only its copy and nothing of a
  candidate who never applied to it; the candidate sees all their files; another candidate and a signed-out visitor see
  nothing; after a withdrawal the employer sees nothing. In `apps/api/src/foundation.e2e-spec.ts`: "gives each
  organization only the CV copy submitted to it, never another employer's" (storage reads, `cv-url`, folder listing,
  other candidate, signed-out visitor, withdrawal), plus "stores files privately: a file that isn't an application's CV is
  the candidate's alone", which replaces a test that expected the old, too-wide access.
- **Test support.** `scripts/local-supabase.mjs`: the local Storage stand-in gained `POST /storage/v1/object/list/:bucket`,
  answering through the caller's policies as Supabase does, for the listing test. Restart the stand-in after pulling.
- **Results.** Database checks passed, and the control run proves they detect the old policy. End-to-end: not run.
- **Limitations.** The current-CV fallback is kept provisionally (question D.3).

### S2 — Application status transitions (MEDIUM) · Completed at the database and API; end-to-end Unverified

- **Original issue.** `PATCH /v1/applications/:id/status` wrote any status straight to `applications`, so "hired" could
  be set without any evaluation, and "evaluated" with nothing evaluated.
- **Files.** `supabase/migrations/20261107090100_application_status_transitions.sql` (new);
  `apps/api/src/applications/applications.controller.ts`; `apps/api/src/common/database-exception.filter.ts`;
  `apps/web/src/lib/application-status.ts` (new); `apps/web/src/components/forms.tsx` (`ApplicantStatus`).
- **Implemented.**
  - `public.set_application_status(application, status)` is the only way staff change a status. Owners, admins and
    recruiters of the application's organization may call it; for anyone else the application "doesn't exist" (404).
  - Allowed moves (re-sending the current status changes nothing; anything else gets a 422):

    | From | To, by hand |
    | --- | --- |
    | submitted | under_review, shortlisted, rejected |
    | under_review | shortlisted, rejected |
    | assessment_invited, assessment_in_progress, assessment_submitted | shortlisted, rejected |
    | evaluated | shortlisted, rejected, hired |
    | shortlisted | rejected, hired |
    | rejected | under_review, shortlisted (provisional, D.1) |
    | hired, withdrawn | nothing |

  - **Hiring needs reviewed assessments** (`private.assessments_reviewed`): every non-expired assessment attempt of the
    application must have an evaluation in status `reviewed`. This applies to the manual change and to a hiring outcome
    (`private.guard_outcome`), so `POST /v1/organizations/:orgId/applications/:id/outcome` with `hired` also gets a 422
    until then. A job with no assessment has nothing to wait for.
  - "Evaluated" and the assessment stages are never set by hand. They still come only from
    `private.sync_application_status`, which is unchanged.
  - The policy "org updates status" is dropped and `update` on `applications` is revoked from `authenticated`. The
    system's own changes (assessment progress, outcomes, withdrawal) run in security definer functions and keep working,
    which the database test checks.
  - The API calls the function; database errors map to 404 (not found) and 422 (refused move, "not allowed until").
  - The status menu offers only allowed moves; a unit test compares the web copy with the SQL so they can't drift.
- **Derived from the existing workflow.** No new statuses. The interview-outcome path already hired from "evaluated",
  so evaluated → hired stays allowed.
- **Tests added.** `supabase/tests/security_phase1.sql`, section S2 (direct table update refused; system stages refused
  by hand; submitted → hired refused; the normal path; history records who changed it; hired is final; another
  organization's application looks missing; hiring refused before review, by hand and by outcome, and allowed after;
  a reviewer can't decide; withdrawn can't change). `apps/api/src/common/database-exception.filter.spec.ts` (4 new);
  `apps/web/src/lib/application-status.test.ts` (2); `foundation.e2e-spec.ts` "allows only the status moves the
  workflow has"; `pipeline.e2e-spec.ts` hiring refused before review, then "hires only once the assessment has been
  reviewed, and only by the owning organization".
- **Results.** Database, unit and web tests passed. End-to-end: not run.
- **Limitations.** D.1 and D.2 are open; the current behaviour is provisional. Deploy this migration together with the
  matching API: the old API writes the table directly and would get a 403.

### S3 — Rate-limit bypass (MEDIUM) · Completed

- **Original issue.** The limiter keyed on a hash of whatever `Authorization` header arrived, so every made-up token got
  a fresh 300-requests-a-minute limit.
- **Files.** `apps/api/src/auth/auth.guard.ts`, `apps/api/src/common/token-throttler.guard.ts`,
  `apps/api/src/common/configure-app.ts`, `apps/web/src/lib/api.ts`, `.env.example`, `docs/deployment.md`.
- **Implemented.** `authenticate(request)` verifies a token with Supabase Auth once per request and caches the answer on
  the request; the guards and the limiter share it, so there is still one Auth call per request. A verified account is
  limited as `user:<id>`. Everything else (no token, a rejected token, Auth down) is limited by address. `TRUST_PROXY`
  sets Express "trust proxy" (a hop count, `loopback`, or addresses and CIDR ranges); unset, it's off and
  `X-Forwarded-For` is ignored. The web server forwards the browser's `x-forwarded-for` to the API.
- **Tests added.** `apps/api/src/throttle.spec.ts`: no token; repeated made-up tokens (they share the address's limit);
  a verified account (its own limit, apart from the address); different client addresses behind a trusted proxy
  (separate limits, and a client-written prefix ignored); a forwarded address ignored without `TRUST_PROXY`; parsing of
  the setting.
- **Results.** Passed.
- **Limitations.** When `TRUST_PROXY` is safe depends on hosting (D.4, `docs/deployment.md`). Unset, all signed-out
  visitors share the web server's limit.

### S4 — Supabase Auth call per request · not changed (by design)

Kept: verifying JWTs locally would stop catching revoked sessions, which a foundation test relies on. Phase 1 only made
the limiter share the guards' single call.

### S5 — Signed CV link in the queue (LOW) · Completed under the owner's decision (section C.1)

- **Original issue.** CV analysis jobs carry a 30-minute signed Storage link in `background_jobs.payload`, which stayed
  there after the job finished.
- **Files.** `supabase/migrations/20261107090200_clear_finished_job_links.sql` (new); no change to
  `apps/api/src/me/cv.controller.ts` or `apps/api/src/jobs-queue/worker.ts`, whose logging already left the payload out.
- **Implemented.** `private.settle_background_job` removes `file_url` from the payload when a job succeeds or fails
  (not between retries), and the migration clears it from jobs that had already finished.
- **Tests added.** `supabase/tests/security_phase1.sql`, section S5 (the payload can't be read through the Data API; a
  finished job keeps no link). `apps/api/src/jobs-queue/worker.spec.ts` (3): the link reaches the work; logs and the
  settle call never contain it, even when an error message does; a permanent failure keeps its short code.
- **Results.** Passed.
- **Limitations.** None open: run-time signing was declined (C.1).

### S6 — AI service token comparison (LOW) · Completed

- **Original issue.** `services/ai/midan_ai/main.py` compared the shared token with `!=`.
- **Implemented.** `hmac.compare_digest` on UTF-8 bytes. Missing, empty, wrong, short, long, differently cased, padded
  and non-ASCII tokens are refused with 401 on every protected route, as is any call while no token is configured.
  `/health` stays open.
- **Tests added.** `services/ai/tests/test_service_token.py` (36 cases).
- **Results.** Passed.

### S7 — Security headers (LOW) · Completed; some screens Unverified

- **Original issue.** No CSP, HSTS or framing protection on web or API.
- **Files.** `apps/web/src/lib/csp.ts` (new), `apps/web/src/proxy.ts`, `apps/web/src/app/[locale]/layout.tsx`,
  `apps/web/src/components/chrome.tsx`, `apps/web/next.config.ts`, `apps/api/src/common/security-headers.ts` (new),
  `apps/api/src/common/configure-app.ts`.
- **Implemented.**
  - Web pages: a fresh nonce per request. Policy: scripts `'self' 'nonce-…' 'strict-dynamic'` (plus `'unsafe-eval'` in
    development only); styles `'self' 'unsafe-inline'` (React style attributes can't take a nonce); images from self,
    data, blob and the Supabase project; frames and connections to `https://*.daily.co`; forms to self and Supabase
    (Google sign-in); `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`; `upgrade-insecure-requests`
    when `APP_URL` is HTTPS. The request passed on carries the policy, so Next.js puts the nonce on its scripts, and the
    layout gives it to the next-themes script.
  - Every web response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
    `Referrer-Policy: strict-origin-when-cross-origin`, no `X-Powered-By`; HSTS for a production build whose `APP_URL`
    is HTTPS.
  - API: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'` (not on Swagger at
    `/docs`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
    `Cross-Origin-Resource-Policy: same-origin`, no `X-Powered-By`, HSTS on HTTPS requests only.
- **Tests added.** `apps/web/src/lib/csp.test.ts` (6), `apps/api/src/common/security-headers.spec.ts` (2), and the
  browser check in B.0.
- **Results.** Passed.
- **Limitations (Unverified).** A Daily interview, Google sign-in, an assessment page and the admin area haven't been
  opened under the CSP. Daily might call an origin the policy doesn't list. `style-src 'unsafe-inline'` stays.

### S8 — Development sign-up code in builds (LOW) · Completed

- **Original issue.** `DEV_TEST_ACCESS_CODE` was in `next.config.ts`'s `env` map, which Next.js writes into the built
  code.
- **Files.** `apps/web/next.config.ts`, `apps/web/scripts/check-bundle-secrets.mjs` (new), `apps/web/package.json`
  (`check:bundle`).
- **Implemented.** The code is now only a runtime variable of the server process, read by the server action in
  `apps/web/src/lib/auth-actions.ts`. The script fails if a secret's value appears anywhere in a build, or a secret's
  name (or the sign-up field `midan_test_access`) appears in a browser file.
- **Results.** Passed, including the control.

### Not in Phase 1

S9 (no magic-byte check on evidence uploads, no malware scanning), S10 (leaked password protection off on hosted; 11
SECURITY DEFINER functions callable through the Data API, to review) and S11 (`npm audit`: 4 high via Prisma's
`deepmerge-ts`) are unchanged. CI, the Windows path bug in `scripts/import-data.mjs` (`URL.pathname`) and a
non-Linux local stack were not part of the Phase 1 task list.

---

## C. Confirmed decisions

All of these are also in [docs/DECISIONS.md](../DECISIONS.md).

### C.1 CV analysis link (S5) — owner decision, option (a); an accepted trade-off, not an open issue

- Keep the existing 30-minute signed CV URL.
- Do not introduce a new storage credential.
- The URL stays in the queue job only while the job is waiting or running.
- It is deleted when the job finishes.
- It is never written to logs.
- It is not readable through the Supabase Data API.
- If the job waits beyond 30 minutes, it fails with a clear file-unavailable error (`file_unavailable`: "The file
  couldn't be reached." / «تعذر الوصول إلى الملف.»), and the candidate can retry, which creates a fresh link
  (`POST /v1/me/cv/analyses`).

The alternatives were weighed and declined: a storage-only server credential so the worker signs at run time (it would
bypass storage policies and reverse the "no service-role key" design), and handing the file to the AI service at upload
time (it loses retry after a restart).

### C.2 AI providers

- Support both Gemini and OpenAI.
- Use a unified provider abstraction, with the provider chosen by configuration.
- Keep assessment generation and evaluation logic, rubrics, schemas and scoring independent of the provider; record the
  provider and model of every evaluation; apply the same validation, retry, error and evidence rules to both.
- Do not claim either provider has passed real-credential integration tests unless that has been verified. **Neither
  has:** no key has ever been configured. `services/ai/midan_ai/providers.py` has OpenAI and Gemini HTTP clients
  exercised only with stand-ins, and the service runs in a labelled demo mode without a key. Generation is
  template-based today and uses no model.

### C.3 Employer management — hybrid model

- MIDAN initially creates and manages the ten employer registry pages.
- Employers may receive management access to their page later, through a claim or ownership-transfer workflow that never
  grants access automatically. Not built; today only a platform administrator links an organization account to a
  registry entry (`public.admin_link_organization_employer`).
- MIDAN retains platform-level administration.
- Employer users get role-based permissions for jobs, applicants, assessments and team management.
- Never claim partnerships or authorization without evidence. All ten registry entries are `not_partner` today.

### C.4 Assessment ownership

- MIDAN creates job-specific assessments using the company type, sector, job description, requirements and relevant
  skills.
- Employers provide job context; they do not own assessment design.
- Assessment generation and candidate evaluation are separate engines.
- Companies may review or approve generated assessments, but MIDAN remains responsible for generating them.

**The current implementation differs.** An organization's owners, admins and recruiters generate drafts, add, edit and
remove tasks and rubric criteria, and owners and admins publish (`apps/api/src/assessments/assessments.controller.ts`,
`apps/web/src/components/workspace.tsx`, `apps/web/src/app/[locale]/organization/[orgId]/jobs/[jobId]/page.tsx`).
Generation (Graph A, `services/ai/midan_ai/assessment_builder.py`) and evaluation (Graph B, `evaluation.py`) are already
separate engines. Aligning ownership is later-phase work; Phase 1 didn't change it.

---

## D. Outstanding questions for the owner

Each is implemented provisionally as stated, so nothing is blocked. None should be answered by the next developer.

1. **Should rejected applications be reopenable?** Today: yes (rejected → under_review or shortlisted). To change it,
   edit `private.manual_status_change_allowed` in a new migration and `apps/web/src/lib/application-status.ts` (a test
   keeps them in step).
2. **Should hiring through an interview outcome also require a shortlist?** Today: no. Both paths need every assessment
   reviewed, and manual hiring needs "shortlisted" or "evaluated". The outcome check is `private.guard_outcome`.
3. **Should employers keep access to the candidate's current CV when an application has no attached CV snapshot?**
   Today: yes, matching `GET /v1/applications/:id/cv-url`. It happens when someone applied before uploading a CV; the
   employer then sees a CV uploaded later. Removing it changes `private.can_view_candidate_document` and the API
   fallback in `apps/api/src/applications/applications.controller.ts` (`cvUrl`).
4. **What should `TRUST_PROXY` be once the hosting environment is chosen?** Today: unset. Safe only when every hop it
   names appends the address it received the request from; see `docs/deployment.md`, "Client addresses and rate
   limits".

---

## E. Hosted environment restrictions

- Hosted Supabase project `al-midan-ya-hamidan` (ref `squpszwbrqkflezfltoj`). The unrelated `ALNADA` project in the
  same organization must never be touched.
- **No hosted migration has been applied** during Phase 0 or Phase 1. Only read-only queries were run (2026-11-07):
  23 migrations applied, 47 public tables, all with RLS.
- **Pending there, none applied.** The four migrations identified earlier, from the base branch:
  `20261106140000_platform_admin_and_data_pipeline`, `20261106150000_background_jobs_and_job_analysis`,
  `20261106160000_assessment_reference_skills`, `20261106170000_employer_profiles_and_job_links`. Plus the three Phase 1
  migrations: `20261107090000_scope_candidate_document_access`, `20261107090100_application_status_transitions`,
  `20261107090200_clear_finished_job_links`. Seven in all, to be applied in that order.
- Do not apply them without the owner's explicit approval.
- Do not change hosted Supabase settings (auth, SMTP, URLs, storage, roles).
- Do not deploy anything.

---

## F. Exact next steps

### F.1 Remaining Phase 1 work, in order

1. **Run the end-to-end suites on the Linux local stack** (first task; F.2). That is the only Phase 1 verification
   still outstanding for S1 and S2. Fix any failures on this branch.
2. Open a Daily interview, Google sign-in, an assessment page and the admin area in a production build
   (`npm run build -w @midan/web`, then `npm run start -w @midan/web`), and check the browser console for CSP
   violations. Add any genuinely needed origin to `apps/web/src/lib/csp.ts` and its test.
3. Bring the owner the questions in section D. If an answer differs from the provisional behaviour, change it in a new
   migration (never edit an applied one) with tests.
4. Ask the owner whether `feat/company-workflow` (created by someone else during Phase 1) overlaps with this branch,
   before anything is merged.
5. With approval, open a pull request from `feature/midan-phase-1-security` into
   `feature/midan-complete-data-jobs-assessment`.

### F.2 Required tests

On Linux x86-64 (or WSL) with PostgreSQL 16 binaries, Node 20+, `uv`, and tesseract with Arabic for the OCR tests
(see `docs/local-development.md`):

```bash
npm install
```

```bash
scripts/local-setup.sh
```

```bash
scripts/local-db.sh psql -f supabase/tests/security_phase1.sql
```

Start the AI service, `node scripts/local-supabase.mjs`, the API with `BACKGROUND_WORKER=off` and the web app as
described in `docs/local-development.md`, then:

```bash
npm run test:e2e -w @midan/api
```

```bash
npm run test:e2e -w @midan/web
```

```bash
npm run test:forms -w @midan/web
```

```bash
scripts/local-db.sh psql -f supabase/test-cleanup.sql
```

Also on every change: `npm test`, `npm run lint`, `npm run build`, `cd services/ai && uv run pytest`, and the build
secret scan:

```bash
DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run build -w @midan/web
```

```bash
DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run check:bundle -w @midan/web
```

New end-to-end cases to watch: `foundation.e2e-spec.ts` "allows only the status moves the workflow has", "stores files
privately: a file that isn't an application's CV is the candidate's alone", "gives each organization only the CV copy
submitted to it, never another employer's"; `pipeline.e2e-spec.ts` hiring refused before review, and "hires only once
the assessment has been reviewed, and only by the owning organization". One older case now depends on the new
hiring rule: `foundation.e2e-spec.ts` "shows the decision the organization issued, to that candidate only" hires through
an outcome. Traced by reading (not run): its application has one assessment, reviewed in the earlier "shows released
scores by criterion" case, so it should still pass. If the suite runs that case on its own, it will get a 422 instead.

### F.3 Database checks without the Linux stack

The database checks can run on any PostgreSQL 16+ (this is how they ran in Phase 1). In a scratch cluster with a
database named `midan`, apply in order:
1. `supabase/local/00_supabase_shim.sql`
2. A minimal stand-in for Supabase Auth's tables:

   ```sql
   create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}',
     raw_app_meta_data jsonb default '{}', email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
   create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id) on delete cascade,
     provider text, identity_data jsonb default '{}');
   alter table auth.users owner to supabase_auth_admin;
   alter table auth.identities owner to supabase_auth_admin;
   ```

3. `supabase/local/05_auth_functions.sql`
4. Every file in `supabase/migrations/`, in name order, each in one transaction (`psql -1 -f`)
5. `supabase/local/10_local_logins.sql`
6. `supabase/tests/security_phase1.sql` (it rolls itself back)

### F.4 Files and modules to read first

- Security model: `apps/api/src/db/db.service.ts` (every query runs as the caller, so RLS applies),
  `apps/api/src/auth/auth.guard.ts`, `apps/api/src/common/roles.ts`, `supabase/migrations/20261104220035_rls_and_grants.sql`.
- Phase 1 changes: `supabase/migrations/20261107090000_scope_candidate_document_access.sql`,
  `20261107090100_application_status_transitions.sql`, `20261107090200_clear_finished_job_links.sql`, `supabase/tests/security_phase1.sql`,
  `apps/api/src/applications/applications.controller.ts`, `apps/api/src/common/token-throttler.guard.ts`,
  `apps/api/src/common/configure-app.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/csp.ts`, `apps/web/next.config.ts`.
- Workflow the status rules depend on: `private.sync_application_status`
  (`supabase/migrations/20261105153131_multiple_assessments.sql`), `private.apply_outcome`
  (`20261105231005_candidate_experience.sql`), `apps/api/src/interviews/interviews.controller.ts`.
- Queue and CV pipeline: `apps/api/src/jobs-queue/worker.ts`, `apps/api/src/me/cv.controller.ts`,
  `supabase/migrations/20261106150000_background_jobs_and_job_analysis.sql`, `docs/privacy/cv-data-flow.md`.
- Context: `docs/DECISIONS.md`, `docs/deployment.md`, `docs/local-development.md`, the audit report, and
  `docs/handoffs/MIDAN_COMPLETE_IMPLEMENTATION_HANDOFF.md` (the base branch). `HANDOFF.md` and `NEXT_SESSION_PROMPT.md`
  describe an older branch; `HANDOFF.md` is marked superseded, and `NEXT_SESSION_PROMPT.md` still needs rewriting.

### F.5 Phase 2 (hosted parity) prerequisites

Phase 2 brings hosted Supabase up to the repository. Before it starts:
1. Phase 1 merged (F.1.5), with the end-to-end suites green.
2. The owner's explicit approval to apply the seven migrations of section E, in order.
3. A deployment plan in which the API containing `set_application_status` goes live together with
   `20261107090100` (it revokes the direct update the old API uses).
4. Owner-held values set outside the repository: the `midan_importer` password (`IMPORT_DATABASE_URL`) to re-run the
   import, which adds the one skill hosted lacks («إدارة علاقات الأعمال», financial services) and lineage; the
   `midan_ai` password for Postgres checkpoints; the first platform administrator.
5. Dashboard changes only the owner can make, listed in `docs/deployment.md`: Site URL and redirect URLs, SMTP, leaked
   password protection, Google provider.

### F.6 Dependencies and blockers

| Blocker | Blocks | Owner |
| --- | --- | --- |
| A Linux machine or WSL with the local stack | End-to-end verification of S1 and S2 | Next developer |
| Answers to D.1–D.4 | Final status rules, CV fallback, rate limiting in production | Owner |
| Approval for hosted migrations | Phase 2 | Owner |
| Hosting choice | `TRUST_PROXY`, HSTS, real CSP check over HTTPS | Owner |
| Gemini and OpenAI keys | Any real AI verification (C.2) | Owner |
| Job dataset (the Jadarat sheet is empty) | Real job listings | Owner |
| Daily and Google credentials | Interview and calendar checks, including under the CSP | Owner |
