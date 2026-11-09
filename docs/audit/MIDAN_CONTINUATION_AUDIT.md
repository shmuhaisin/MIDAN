# MIDAN — continuation audit

Continuation of `feature/midan-auth-jobs-ai-assessments` at `c678c56d94285b17617d772bd751645e1feaa54c` on
`feature/midan-teammate-completion`, 2026-11-09. Read with `docs/audit/MIDAN_COMPLETE_IMPLEMENTATION_AUDIT.md`, which this
document doesn't repeat: it records what changed, what was verified here, and what could not be.

Status words: **Verified here**, **Implemented, not verified here**, **Partial**, **Missing**, **Blocked
(credentials/external)**, **Blocked (this machine)**, **Needs a decision**.

## 1. Git and preserved work

| Item | Finding |
| --- | --- |
| Source | `origin/feature/midan-auth-jobs-ai-assessments` fetched; its tip is exactly `c678c56d94285b17617d772bd751645e1feaa54c`. |
| This branch | `feature/midan-teammate-completion`, created from that commit in a separate git worktree (`MIDAN-teammate/`). The name was free locally and on GitHub. |
| Local checkout | `MIDAN/` is on `feature/midan-full-ui-redesign` (`d8ea977`) with 107 uncommitted or untracked files (UI redesign work done on this machine). **Not touched:** no reset, clean, stash or checkout. A worktree was used so the branch could start from the exact commit without moving that work. |
| Local work vs the checkpoint | Compared file by file, ignoring line endings: 76 of the 107 files are identical to `c678c56` (the checkpoint already contains them). 31 differ. In most the checkpoint is ahead (later development on the other machine); the lines that exist only locally are the last redesign rounds' refinements: right-to-left chevrons, the shared masthead on opportunities, development, invitations and the review page, the review title's direction isolation, the opportunity page header. They are **not** in this branch yet: re-applying them needs a reviewed port onto the checkpoint, not a merge (see section 6). |
| Remote branches touched | Only `feature/midan-teammate-completion` (new). `main` and `feature/midan-auth-jobs-ai-assessments` were not modified. |

## 2. This machine, and what it can verify

Windows 11, Node 22, Python 3.14, PostgreSQL 14 and 18 binaries, no Docker, no Go. WSL can't be installed: Windows
reports a corrupted component store (DISM error 14098), so WSL isn't a prerequisite for this work.

- **Blocked (this machine):** the local Supabase stack. `scripts/local-db.sh` and `scripts/local-supabase.mjs` run Linux
  x86-64 (or source-built) GoTrue and PostgREST, and the database migrations need the `auth` schema GoTrue creates. So
  the API e2e suite, the browser suites, the sign-up/verification/recovery journeys and the full migration chain can't run
  here yet. See section 2.2 for the Windows-native way to unblock them.
- **Runs here natively:** type checks, API and web unit tests, both builds, the bundle secret check, the AI service suite
  (Python environment from `uv.lock`, kept outside the repository), and SQL checks on a throwaway PostgreSQL 18 cluster
  for anything that doesn't need the `auth` schema.

### 2.1 Test matrix on Windows

| Suite | Command | Needs | Status here |
| --- | --- | --- | --- |
| API type check (includes e2e specs) | `npx tsc --noEmit` in `apps/api` | Node | **Pass** |
| API unit | `npx jest` in `apps/api` | Node | **80/80** |
| API build | `npm run build -w @midan/api` | Node | **Pass** |
| Web type check | `npx tsc --noEmit` in `apps/web` | Node | **Pass** |
| Web unit | `npm test -w @midan/web` | Node | **31/31** |
| Web build, bundle secret check | `npm run build`, `npm run check:bundle` | Node | **Pass** (75 routes; no secrets in 1,414 files) |
| AI service | `pytest` in `services/ai` with the `uv.lock` dependencies | Python ≥ 3.12 | **239 passed, 11 skipped**; plus the Postgres checkpoint test run separately on PostgreSQL 18: **1 passed**. Total **240 passed, 10 skipped** |
| AI skips that remain | | | E5 model extra (PyTorch + 1.1 GB model, optional), Tesseract OCR (2), the assessor guide kept out of the repository (2), real Groq/provider calls (would spend the free daily quota; `MIDAN_REAL_PROVIDER_TESTS=1` with a key) |
| New migration and rollback | psql on PostgreSQL 18 | Postgres only | **Pass** (section 4) |
| API e2e (incl. new reorder tests) | `npm run test:e2e -w @midan/api` | Postgres with all migrations, Supabase Auth, PostgREST, storage gateway, AI service | **Blocked** (no Auth) |
| API live | `npm run test:live -w @midan/api` | as above plus real provider keys | **Blocked** |
| Browser journeys | `npm run test:e2e -w @midan/web` | full local stack and seeded fixture accounts | **Blocked** |
| Browser forms | `npm run test:forms -w @midan/web` | its stub signs the fixture accounts in against the real local Auth to get real sessions | **Blocked** (no Auth; a scratchpad wrapper for the installed Chromium 1223 got as far as starting it) |
| Database checks | `supabase/tests/*.sql` | full migration chain (needs the `auth` schema) | **Blocked** |
| Migration rehearsal | `scripts/rehearse-migrations.sh` | PostgreSQL 17 + the Auth binary | **Blocked** |

None of these was pointed at a hosted project: every suite refuses non-local addresses by design (`apps/api/src/common/local-stack.ts`,
`apps/web/e2e/local-only.ts`) because they create and delete accounts and records.

### 2.2 The hosted project (read-only)

Checked through the Supabase connector, read-only. Nothing was written.

- MIDAN's hosted project is `al-midan-ya-hamidan` (`squpszwbrqkflezfltoj`, eu-central-1, PostgreSQL 17). There is no
  `.env` in either checkout on this machine, so the apps here aren't configured for it.
- **Hosted has 23 migrations applied, up to `20261106005827_org_reads_applicant_reference_skills`.** This branch has 53.
  Everything from 2026-11-06 onward is missing on hosted, including employer profiles, the editing policy, account-type
  separation, job descriptions, job skill suggestions and this branch's reordering. So the current code can't be tested
  against hosted without applying about 30 migrations to it, which is out of scope here (no hosted changes to make tests
  pass). Applying them is a deployment decision for the owner, with the rehearsal the repository prescribes.
- Security advisories on hosted (as of 2026-11-09): leaked-password protection is off (an Auth setting in the dashboard,
  the owner's call); ten `SECURITY DEFINER` RPCs callable by signed-in users, and `job_assessment_overview` callable by
  anonymous visitors. The last is granted to `anon` on purpose (`20261105233614`: the public job page shows a published
  job's assessment overview); the others check the caller inside and are the designed API surface. No change made.

### 2.3 Unblocking the stack on Windows, without WSL or Docker

Every piece has a native Windows form, all from official sources, none needing administrator rights:

1. PostgreSQL: the installed 18 (hosted runs 17; the scripts name 16). Needs `initdb` with the builtin `C.UTF-8` locale
   provider instead of the POSIX locale, and TCP instead of the `/tmp` socket.
2. PostgREST: the official Windows release (`postgrest-v*-windows-x64.zip`, GitHub).
3. Supabase Auth (GoTrue): built from its source (GitHub `supabase/auth`, the tag the previous session used) with the
   portable Go toolchain (`go.dev` zip, extracted locally), as the previous session did on macOS.
4. Small Windows fixes to the local development scripts (paths and `.exe` names in `scripts/local-supabase.mjs`,
   `scripts/local-db.sh` options). No migration changes.

That gives the real Auth, real PostgREST and every migration on this machine, so the blocked suites above can run.
Downloading those tools is pending the owner's go-ahead.

### Baseline at `c678c56` (before any change)

| Check | Result |
| --- | --- |
| API type check (`tsc --noEmit`, includes the e2e specs) | Pass |
| API unit tests (`jest`) | 80/80, 13 suites |
| Web type check | Pass |
| Web unit tests (`node --test`) | 31/31 |
| AI service | 239 passed, 11 skipped (then 1 more passed with a native Postgres, section 2.1) |
| API e2e, browser, forms | Not run: blocked on this machine (above). Historical: 182/182 e2e (previous session). |

## 3. Feature classification

| Area | Status | Evidence / note |
| --- | --- | --- |
| Supabase Auth: sign-up with access code, verification, sign-in/out, recovery, refresh, role redirects | Implemented, not verified here | Code paths read (`apps/web/src/proxy.ts`, `lib/account.ts`, `lib/auth-actions.ts`, `auth.guard.ts`). Live journeys need GoTrue. Previous session: 50/50 browser checks. |
| Candidate/organization separation (database) | Implemented, not verified here | `20261109120000_account_type_separation`. |
| Employer registry (10 entities) | Verified here (source) | The attached `ALMIDAN_Employer_Database_10_Entities.xlsx` matches `data/source/SHA256SUMS` byte for byte (`b0fe8409…`): it's the same official workbook already imported. All ten are `not_partner`. It stays out of git (no permission to publish). |
| Registry organization chosen at employer sign-up | Needs a decision | Unchanged: sign-up creates its own tenant; a claim links it to the registry after admin approval. |
| Job description persistence and use by AI | Implemented, not verified here | `jobs.description_ar/en`; read by analysis, generation and matching. |
| Dynamic job skills (`20261110090000_job_skill_suggestions`) | Implemented, not verified here | Migration and rollback present; latest migration before this branch's. Not rebuilt or changed. |
| Assessment generation with Groq | Implemented, not verified here | Needs the AI service and a Groq key; free-tier quota was exhausted in the previous session. |
| Assessment editing (title, instructions, tasks, rubric, weights, change review) | Implemented, not verified here | Unchanged. |
| **Task reordering** | **Implemented in this branch; database part verified here** | See section 4. |
| Versioning (published versions immutable, candidates keep their version) | Implemented, not verified here | Guard trigger `guard_version_content`; e2e coverage exists. |
| Applications, duplicates, submission, uploads, evaluation, release | Implemented, not verified here | Unchanged. |
| AI scoring failures (quota, rate limit, timeout, invalid reply) | **Completed in this branch; verified here (AI tests)** | No invented scores: a criterion the model can't score gets no proposal and `model_failed:<criterion>`, as before. Now the cause is named too (section 4). |
| ATS matching (multilingual E5) | Implemented, not verified here | Unchanged. |
| Demo reset with stable ids | Implemented, not verified here | Unchanged. |
| Email delivery (SMTP) | Blocked (credentials) | No SMTP credentials; local mail sink only. |
| Palette | Needs a decision | Unchanged (gold palette approved earlier vs the newer list `#0F5B46 #1F7A5C #DCEEE5 #F7F4EE #1F2A26`). |
| Candidate deletion (PDPL) | Needs a decision | Unchanged: retention policy required. |

## 3a. Outstanding requirements, one by one

As of `6637862`. "Verified" means run on this machine in this session; nothing below is marked done for having a screen or
a past test result. **Env** = blocked by this machine's environment until the local stack runs (section 2.3);
**Cred** = blocked by missing credentials.

| # | Requirement | Already implemented (code read) | Changed in this branch | Remaining / not verified | Files and APIs | Blocked |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Candidate and employer registration and sign-in (Supabase Auth) | Sign-up through Supabase Auth with the account type; the web refuses sign-up unless `DEV_TEST_SIGNUP=true`, and the database admits only the hashed access code or synthetic test domains (`private.guard_signup`); provisioning creates the candidate profile or the organization. Sign-in with password, optional Google. | Nothing. | Not run live: sign-up, sign-in and sign-out against a real Auth server. | `apps/web/src/lib/auth-actions.ts` (`signUp`, `signIn`, `signOut`), `app/[locale]/register`, `login`; `supabase/migrations/20261105122524_gated_real_signup_and_provisioning.sql`, `20261109120000_account_type_separation.sql`; Auth `/auth/v1/signup`, `/token`, `/logout` | Env |
| 2 | Email verification, password recovery, sessions, role redirects | Verification link back to `/auth/confirmed`, built from `APP_URL` (no port hardcoded); recovery (`requestPasswordReset`) and reset (`resetPassword`); cookies renewed from the refresh token in `proxy.ts`; `/auth/ended` clears a dead session; candidate pages send organization accounts to their workspace (`candidateOnly`). | Nothing. | Not run live. Real email delivery: no SMTP. | `apps/web/src/proxy.ts`, `lib/account.ts`, `lib/auth-actions.ts`, `app/[locale]/auth/{callback,confirmed,ended}`, `check-email`, `forgot-password`, `reset-password` | Env; Cred (SMTP) |
| 3 | Organization authorization and protected routes | Every organization endpoint calls `requireRole(tx, user, orgId, ...)` inside a transaction run as the user, and RLS scopes rows to members; private web routes are matched in `proxy.ts` (`PRIVATE`). Cross-tenant cases have e2e tests (`foundation.e2e-spec.ts`: tenant isolation, roles). | The new reorder endpoint follows the same rule, with 403 tests for another organization and for a candidate. | Not run: the cross-tenant e2e suite. | `apps/api/src/common/roles.ts`, `auth/auth.guard.ts`, `db/db.service.ts` (`asUser`); the RLS migrations | Env |
| 4 | Job description persistence and display | Saved to `jobs.description_ar/en` (step one of the wizard, editable in details), shown on the public job page, read by analysis, generation and matching (`loadJobInput`). | Nothing. | Not run: save, reload, display. | `POST/PATCH /organizations/:orgId/jobs[/:jobId]` (`organizations.controller.ts`), `GET /jobs/:id`; `apps/web/src/components/forms.tsx` (`JobForm`), `workspace.tsx` (`JobDetailsForm`) | Env |
| 5 | Dynamic skills and employer custom skills | Suggestions from the job's text (`POST .../jobs/:jobId/analyses/suggest`, AI `skills.py`), catalog search, required/preferred, L0-L4 levels, custom skills create/edit/delete, accept/dismiss; the accepted list feeds generation (`loadJobInput` adds custom skills and levels) and matching. | Nothing (preserved). | Not run: e2e and browser checks for different jobs (data vs cyber), persistence, no leakage between jobs. AI side: its tests pass here (part of the 251). | `apps/api/src/jobs/job-skills.controller.ts`, `analysis.controller.ts`; `services/ai/midan_ai/skills.py`; `supabase/migrations/20261110090000_job_skill_suggestions.sql`; `apps/web/src/components/job-analysis.tsx` | Env |
| 6 | Real AI assessment generation from the job | `POST .../jobs/:jobId/assessment/generate` sends the title, description, approved requirements, linked workbook skills with levels and the employer's custom skills (`loadJobInput`) to the AI service's builder (Groq `openai/gpt-oss-120b`); without a model it uses labelled templates ("Demo mode"); a quality standard and one repair round. | Nothing. | Not run against Groq here (free daily quota; real-provider tests are opt-in). Builder tests pass (AI suite). | `apps/api/src/assessments/assessments.controller.ts` (`generate`), `assessment-quality.ts` (`loadJobInput`), `ai/ai.client.ts`; `services/ai/midan_ai/` builder and `providers.py` | Env; Cred (Groq key and quota) |
| 7 | Editing: add, delete, reorder tasks, rubric, preview | Title, instructions, scenario, duration, deadline; add and delete tasks; edit and delete criteria; weights; questions and answer keys; regenerate one task; every change recorded for review; preview through the candidate experience link. | **Reorder** (database, API, web; section 4). | Reorder e2e tests not run. Preview of a draft not re-checked in a browser. | `assessments.controller.ts` (`addTask`, `removeTask`, `reorderTasks`, `updateTask`, criteria endpoints, `regenerate`); `apps/web/src/components/workspace.tsx` (`TaskList`, `TaskEditor`); `GET /experience/:orgSlug/:jobSlug/:version` | Env (e2e) |
| 8 | Employer approval before publication | `POST .../assessment-versions/:id/publish` for owners and admins only, after reviewing every change since the draft (`reviewed_through`); applying assigns only published versions. | Nothing. | Not run. | `assessments.controller.ts` (`review`, `publish`); `supabase/migrations/20261107150000_assessment_editing_policy.sql` | Env |
| 9 | Versions kept for existing applications | Published and archived versions are immutable (trigger `guard_version_content`); changes after publication go into a new version (`revise`); attempts keep their `version_id`, so submissions and evaluations stay on the version taken. e2e: "approved versions never change". | Reorder refuses published versions (same guard, with a test). | Not run. | `supabase/migrations/20261104220032_functions_and_triggers.sql`; `POST .../assessment-versions/:id/revise` | Env |
| 10 | Applications and assessment submission | `POST /jobs/:id/applications` returns the existing application instead of a second (an `existing` check and a unique index); the published assessment is assigned; answers save as they go; evidence uploads; submission is final. | Nothing. | Not run: apply, duplicate, submit, upload. | `apps/api/src/jobs/jobs.controller.ts`, `attempts/attempts.controller.ts` (`start`, `responses`, `evidence`, `submit`) | Env |
| 11 | Evaluation, cause of a failed criterion, manual scoring, approval, release | Proposals with evidence; criteria the model couldn't score are left for a person; `POST /evaluations/:id/review` (manual scores and approval, evaluators only); `POST /evaluations/:id/release` only after review. | **The cause of each failure** (rate limit, daily quota, unavailable, timeout, invalid reply, privacy) shown to the reviewer (section 4), with 12 tests. | Not run end to end: evaluate, score by hand, approve, release. | `apps/api/src/evaluations/evaluations.controller.ts`; `services/ai/midan_ai/evaluation.py`, `providers.py`; `apps/web/src/components/review.tsx` | Env |
| 12 | Stable demo ids and links | `--reset` keeps the organization, job and approved assessment ids; local stack only. | Nothing yet. | **Incomplete:** `--reset` recreates applications, attempts and evaluations with new ids, so a saved link to an application, a submission or an evaluation still 404s after a reset. Not run. | `scripts/investor-demo.mjs`, `docs/investor/INVESTOR_DEMO.md` | Env |
| 13 | Windows-compatible integration | The Node apps, builds and unit tests run on Windows; the AI suite runs with a Python environment from `uv.lock`. | Windows test matrix (section 2.1). In progress: a native Windows stack (Go 1.26.10, PostgREST 12.2.3, Auth 2.177.0 built from source). | The local scripts assume Linux or macOS (`scripts/local-db.sh`, `scripts/local-supabase.mjs`, `scripts/local-tools.sh`). | as named | - |

## 4. Changes in this branch

### Assessment task reordering

The brief asked for reordering that persists, survives reload, keeps task ids and evaluation references, and never
touches candidates' versions.

- **Database** `supabase/migrations/20261110120000_assessment_task_order.sql` (rollback
  `supabase/rollback/20261110120000_assessment_task_order.down.sql`): the unique `(version_id, position)` constraint
  becomes `DEFERRABLE INITIALLY IMMEDIATE` under the name `assessment_tasks_version_position_key`. Every statement still
  checks it at once; only a transaction that asks can defer the check to commit. The migration finds the old constraint
  by its columns, not by an assumed name.
- **API** `PUT /organizations/:orgId/assessment-versions/:versionId/task-order` with `{ task_ids, reason? }`: builders
  only (`BUILDERS`), the body must list every task of the version exactly once (else 422), each moved task is updated
  once to its final position, unchanged tasks aren't touched, and the change history records the moves with the reason
  (default "Tasks reordered"), for review before approval like any other edit. A published or archived version is refused
  by the existing guard (422).
- **Web** move up / move down controls on each task of an editable draft (`components/workspace.tsx`), saving the whole
  order through `reorderTasks` (`lib/actions.ts`); the page then shows the saved positions. Labels in Arabic and English.
- **Prisma** schema notes the constraint's new name.
- **Tests**
  - Verified here, on a throwaway PostgreSQL 18 cluster with the table's original constraint: the migration finds and
    replaces it; without `SET CONSTRAINTS` a duplicate position is still refused immediately; a full reverse succeeds in
    one deferred transaction; a real duplicate is still refused at commit; the rollback restores the original constraint.
  - Added, not run here: `foundation.e2e-spec.ts` → "reordering the tasks of a draft": persistence and reload, ids and
    rubrics kept, one history entry per real move (no temporary positions), a no-op order records nothing, 422 for
    missing/repeated/foreign tasks, 403 for another organization and for a candidate, 422 after approval.

### Naming why the AI couldn't score a criterion

- `services/ai/midan_ai/providers.py`: `LLMError` carries a `kind`, one of `rate_limited`, `quota_exhausted`,
  `unavailable`, `timeout`, `invalid_reply`, set where the error happens: a 429 that persists is a rate limit; Groq's
  daily limits (`per day`, `(TPD)`, `(RPD)` in its message, or a retry-after of an hour or more) are a used-up quota; a
  timeout is told apart from a dropped connection; 5xx and refused keys are "unavailable"; truncated or empty replies are
  "invalid". The kind survives the scorer's retries. Messages are unchanged and still hold nothing sent or received.
- `services/ai/midan_ai/evaluation.py`: besides `model_failed:<criterion>` (kept exactly as before, for compatibility),
  one reason per cause is added: `provider_<kind>`, or `privacy_blocked` when personal details stopped an answer from
  being sent. Still no score for those criteria, not even a zero; a person scores them, and manual evaluation works with
  the provider down.
- `apps/web`: the review page's existing "why this needs your attention" list shows each cause in Arabic and English.
  Older evaluations, without these reasons, display as before. Stored as before (`review_reasons` is JSON): no migration.
- Tests: 12 new in `services/ai/tests` (each kind, Groq's daily limit, retries keeping the kind, and the evaluation graph
  leaving a quota-hit criterion unscored with `provider_quota_exhausted`).

## 5. Test results at this checkpoint

| Check | Result |
| --- | --- |
| API type check (with specs) | Pass |
| API unit tests | 80/80 |
| API build | Pass |
| Web type check | Pass |
| Web unit tests | 31/31 |
| Web production build | Pass (75 routes) |
| Migration SQL on PostgreSQL 18 | Pass (section 4) |
| AI service (Windows, `uv.lock` versions) | 251 passed, 11 skipped (the 12 new tests included; the Postgres checkpoint test passes separately with a native PostgreSQL, section 2.1) |
| API e2e (including the new reorder tests), browser, forms, database checks | Not run: blocked on this machine (section 2.1) |

## 6. Open items

1. **Run the blocked suites** (API e2e with the new reorder tests, browser, forms, database checks) with the Windows-native
   stack described in section 2.3, or on the macOS machine the previous session used.
2. **Port this machine's last redesign refinements** (section 1) onto the checkpoint, file by file, with review.
3. Decisions for the owner: registry organization at sign-up, palette, candidate retention, SMTP provider, deploying the
   30 pending migrations to hosted, leaked-password protection on hosted Auth.
