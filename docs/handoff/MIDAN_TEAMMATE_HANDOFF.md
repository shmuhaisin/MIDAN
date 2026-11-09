# MIDAN — teammate handoff

Written 2026-11-09 at the end of a development session, for the next developer. Read this first, then
`docs/audit/MIDAN_CONTINUATION_AUDIT.md` (per-requirement status with files and APIs) and
`docs/audit/MIDAN_COMPLETE_IMPLEMENTATION_AUDIT.md` (the previous developer's audit). **Continue from the latest commit of
`feature/midan-teammate-completion`. Don't rebuild anything listed under "Completed".**

---

## A. Git

| Item | Value |
| --- | --- |
| Repository | https://github.com/shmuhaisin/MIDAN |
| Original source branch | `feature/midan-auth-jobs-ai-assessments` (not modified by this session) |
| Original source commit | `c678c56d94285b17617d772bd751645e1feaa54c` |
| Development branch | `feature/midan-teammate-completion` — https://github.com/shmuhaisin/MIDAN/tree/feature/midan-teammate-completion |
| Latest pushed commit | the commit that adds this file (see `git log -1` on the branch; the session's final report names the SHA) |
| `main` | not touched |

Commits made in this session, oldest first, all on `feature/midan-teammate-completion`:

| Commit | What |
| --- | --- |
| `b49eb36` | Task reordering (migration, API, UI, e2e tests); continuation audit |
| `6637862` | Named causes for unscored criteria (AI service and review page); Windows test matrix |
| `b4e1bdd` | Continuation audit: status of each outstanding requirement |
| `d3f9859` | Sign-in from the verification email; labelled form fields; native Windows local stack |
| (this commit) | Job setup "Save and continue", draft six-skill list removed from the guided setup, `JobForm` render fix, labelled text areas, e2e expectation fix, this handoff |

Get started:

```bash
git clone https://github.com/shmuhaisin/MIDAN.git
```

```bash
cd MIDAN && git fetch origin && git switch feature/midan-teammate-completion && git pull --ff-only
```

Create your own branch from it (never push to `main`, never force-push):

```bash
git switch -c feature/midan-<your-name>-continuation
```

---

## B. Completed in this session (the code supports each claim)

1. **Assessment task reordering** — `supabase/migrations/20261110120000_assessment_task_order.sql` (+ rollback in
   `supabase/rollback/`): the unique `(version_id, position)` constraint is `DEFERRABLE INITIALLY IMMEDIATE`.
   API `PUT /organizations/:orgId/assessment-versions/:versionId/task-order` (`apps/api/src/assessments/assessments.controller.ts`,
   `reorderTasks`): builders only, every task exactly once or 422, moves recorded in the change history, published versions
   refused by the existing guard. Web: move up / move down per task in `apps/web/src/components/workspace.tsx` (`TaskList`,
   `TaskEditor`), action `reorderTasks` in `apps/web/src/lib/actions.ts`. Six e2e tests in `apps/api/src/foundation.e2e-spec.ts`.
2. **Named causes when the AI can't score a criterion** — `services/ai/midan_ai/providers.py` (`LLMError.kind`:
   `rate_limited`, `quota_exhausted`, `unavailable`, `timeout`, `invalid_reply`; Groq's daily limit detected),
   `services/ai/midan_ai/evaluation.py` (keeps `model_failed:<criterion>`, adds `provider_<kind>` or `privacy_blocked`).
   The review page explains each cause (`review.reason.*` messages, `apps/web/src/components/review.tsx` unchanged: it
   already shows one line per reason prefix). No score is invented, not even a zero. 12 AI tests added.
3. **Sign-in straight from the verification email** — `apps/web/src/app/[locale]/auth/confirmed/page.tsx` and
   `continueFromEmailLink` in `apps/web/src/lib/auth-actions.ts`: the session Supabase Auth put in the link's fragment is
   checked with Auth's `/auth/v1/user` (only an email-link session, `amr: otp`, for a confirmed address), stored in the
   app's cookies, and the person goes to onboarding (candidates) or their workspace (employers). Falls back to "Sign in".
4. **Accessible form fields** — `Field` (`apps/web/src/components/forms.tsx`), `TextArea` (`workspace.tsx`) and the job
   description boxes in `JobForm` use explicit `label for`/`id`; the registration and job forms' inputs had no
   accessible name.
5. **Job setup: details step** — `apps/web/src/app/[locale]/organization/[orgId]/jobs/[jobId]/page.tsx`,
   `JobDetailsForm` in `workspace.tsx`, `updateJob` in `lib/actions.ts`:
   - the setup bar's primary button on step 2 is "Save and continue" and submits the details form (`form="job-details"`);
     the next step opens only after a successful save. Before, "Continue" left without saving.
   - the old six-skill draft checklist (the "same six skills for every job" problem) isn't shown in the guided setup;
     a note points to the Skills step. `updateJob` sends `skills` only when the checklist is on the page, so saving the
     details never erases a job's skills. The full workspace (no `?step=`) still shows the checklist.
6. **`JobForm` render bug** — it called `router.push` during render (React warning "Cannot update a component while
   rendering a different component"); now in an effect after the create action returns.
7. **Native Windows local stack** — no WSL, no Docker: `scripts/local-tools-windows.sh` (PostgREST 12.2.3 Windows release,
   Supabase Auth v2.177.0 built from source with a checksum-verified portable Go 1.26.10, after moving one Unix-only
   socket option into build-tagged files), Windows fixes in `scripts/local-db.sh`, `scripts/local-supabase.mjs`,
   `scripts/local-env.mjs`, `scripts/import-data.mjs` (Linux and macOS unchanged). Guide: `docs/local-development-windows.md`.
8. **Audits** — `docs/audit/MIDAN_CONTINUATION_AUDIT.md`.

Verified in the browser against the real local stack (real Supabase Auth, real database): employer registration, email
verification through the mail sink, employer sign-in into the workspace, candidate registration → verification →
onboarding signed in, creating a job, saving details with "Save and continue" (values checked in the database).

---

## C. State of each feature

| Feature | State | Notes |
| --- | --- | --- |
| Supabase Auth: candidate and employer sign-up, verification, sign-in, sign-out | **Complete and verified** (local stack, browser) | Sign-up needs `DEV_TEST_SIGNUP=true` and the server-held access code (unchanged rule). |
| Password recovery and reset | Implemented, not fully tested this session | `requestPasswordReset`, `resetPassword`; covered by the API e2e suite. |
| Sessions, refresh, role redirects | Implemented; sign-in redirects verified in the browser | `apps/web/src/proxy.ts`, `lib/home.ts`, `lib/account.ts`. |
| Organization authorization and tenant isolation | **Verified** by the API e2e suite (part of 187 passing) | `requireRole`, RLS. |
| Job creation, description persistence | **Verified** (browser + database) | |
| Job setup steps 3–6 (requirements, skills, assessment, review and publish) | Implemented by the previous developer; **not walked through in the browser this session** | Step 3 reached and looked at only. |
| Dynamic skills and custom skills | Implemented (previous developer), preserved, not modified; AI side tested (in the 251) | Not walked in the browser. |
| AI assessment generation | Implemented; **live model not available locally** (no provider key in the local `.env`): drafts come from labelled demo templates | Needs a Groq key to test real inference. |
| Assessment editing (tasks, rubric, weights, regenerate one task) | Implemented (previous developer) | |
| Task reordering | **Complete**; 5 of its 6 e2e tests passed in the full run; the 6th had a wrong expectation (404, not 403, for another organization's own path), corrected in the last commit — **rerun the full suite to confirm** | |
| Approval before publication, version preservation | Implemented; covered by passing e2e tests | |
| Candidate application, submission, uploads | Implemented; covered by passing e2e tests ("the candidate journey") | Not walked in the browser this session. |
| Evaluation, manual scoring, approval, release; named failure causes | Implemented; failure causes verified by AI tests | Not walked in the browser. |
| Stable demo ids after `--reset` | **Partial** | `scripts/investor-demo.mjs --reset` keeps organization, job and approved assessment ids, but recreates applications, attempts and evaluations, so links to those still break after a reset. |
| Email delivery | **Blocked (credentials)** | No SMTP; locally Auth's emails go to the mail sink. |
| Real AI inference | **Blocked (credentials)** | No provider key locally; Groq's free tier is 200k tokens/day. |
| Palette change to `#0F5B46 …` | Not started — **needs the owner's decision** | |
| Registry organization chosen at employer sign-up | Not started — **needs the owner's decision** | |
| Candidate deletion / retention (PDPL) | Not started — **needs a retention decision** | |

---

## D. Unfinished work, in detail

1. **Rerun the whole API e2e suite** (`npm run test:e2e -w @midan/api`) to confirm 188/188 after the expectation fix.
   The reorder tests depend on organizations created by earlier blocks, so `-t "reordering"` alone fails; run the file.
2. **Requirements step (step 3) — designed, not started.** Employers retype what they wrote in step 2. Planned: a "Use
   what you wrote" panel that proposes structured requirements from the lines of `description_*` (as `responsibility`) and
   `requirements_*` (as `qualification`), pairing Arabic and English lines by position, with checkboxes, saved through
   the existing `POST /organizations/:orgId/jobs/:jobId/requirements` (`saveRequirement` in `apps/web/src/lib/actions.ts`;
   `RequirementsEditor` in `apps/web/src/components/requirements.tsx`). Types: `apps/web/src/lib/requirements.ts`.
3. **Walk steps 4–6 in the browser** (skills, assessment generation and editing, review and publish) and fix what blocks
   an employer. Files: `apps/web/src/app/[locale]/organization/[orgId]/jobs/[jobId]/page.tsx`,
   `apps/web/src/components/job-analysis.tsx`, `workspace.tsx`, `change-review.tsx`.
4. **The "Publish" button in the job header** shows from step 2 on a draft with no assessment; consider showing it only
   at the review step (owner's product call).
5. **Select boxes' accessible names** in `JobDetailsForm` (sector, experience level, employment type) are wrapped labels;
   give them explicit `id`/`htmlFor` like the text fields.
6. **Candidate journey in the browser**: discovery → apply → assessment → submit → result (`apps/web/src/app/[locale]/opportunities`,
   `experience`, `applications`, `reports`).
7. **Employer evaluation in the browser**: `apps/web/src/app/[locale]/organization/[orgId]/review/[attemptId]`,
   `apps/web/src/components/review.tsx`, `applicant-review.tsx`.
8. **Demo reset ids** (`scripts/investor-demo.mjs`): keep application/attempt/evaluation ids across `--reset`.
9. **Port the UI refinements left on the owner's machine** (uncommitted, in the `MIDAN/` checkout on
   `feature/midan-full-ui-redesign`): right-to-left chevrons, mastheads on a few pages, the review title's direction
   isolation, the opportunity header. Listed in `docs/audit/MIDAN_CONTINUATION_AUDIT.md`, section 1. Port by hand, with
   review; don't merge that branch.

**Database migrations:** none pending in the repository. Locally all 53 apply. **Hosted** (`al-midan-ya-hamidan`) has only
23 of them (up to `20261106005827`); deploying the other 30 is the owner's decision, after `scripts/rehearse-migrations.sh`.

---

## E. Development environment

Verified on Windows 11 with Git Bash, Node 22.19.0, PostgreSQL 18.3, Python 3.14. Full guide:
`docs/local-development-windows.md`. Linux and macOS: `docs/local-development.md`.

Not in git (get them from the owner, place them in `data/source/`, check with `SHA256SUMS`):
`ALMIDAN_Employer_Database_10_Entities.xlsx`, `بيانات القطاعات.zip`.

One-time setup (Git Bash, repository root):

```bash
npm ci
```

```bash
scripts/local-tools-windows.sh
```

```bash
scripts/local-db.sh start
```

```bash
node scripts/local-supabase.mjs
```

(keep that one running; in a second terminal:)

```bash
node scripts/local-env.mjs --force
```

```bash
node scripts/import-data.mjs --sectors "data/source/بيانات القطاعات.zip" --employers data/source/ALMIDAN_Employer_Database_10_Entities.xlsx
```

`supabase/seed.sql` adds six draft skills; if its first statement fails (categories already there), run the file from
its second statement. `import-data.mjs` needs `uv` on `PATH`.

Services that must be running:

| Service | Command | Port |
| --- | --- | --- |
| PostgreSQL | `scripts/local-db.sh start` | 54322 |
| Supabase gateway (Auth 54329, PostgREST 54328, mail sink 54325, storage) | `node scripts/local-supabase.mjs` | 54321 |
| AI service | `cd services/ai && uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000` | 8000 |
| API | `npm run dev:api` | 4000 (routes under `/v1`) |
| Web | `npm run dev:web` | 3100 |

Emails (verification, recovery): `http://localhost:54321/__mail`.

Environment variables, **names only** (written by `scripts/local-env.mjs`; never commit `.env`):
`.env`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, `API_URL`,
`AI_SERVICE_URL`, `AI_SERVICE_TOKEN`, `CHECKPOINT_DATABASE_URL`, `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
`OPENAI_API_KEY`, `OPENAI_MODEL`, `DEV_TEST_SIGNUP`, `DEV_TEST_ACCESS_CODE`, `APP_URL`, `DAILY_API_KEY`,
`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`.
For real AI with Groq add `GROQ_API_KEY`, `GROQ_MODEL` and set `AI_PROVIDER=groq`.
`.env.test.local`: `TEST_<ACCOUNT>_EMAIL` / `TEST_<ACCOUNT>_PASSWORD` for `ORG_A_OWNER`, `ORG_A_RECRUITER`, `ORG_B_OWNER`,
`CANDIDATE_ONE`, `CANDIDATE_TWO`, `UNVERIFIED`, `PLATFORM_ADMIN`, plus `UI_EMPLOYER`, `UI_CANDIDATE` (browser testing).

Known errors and quirks:

- PostgREST exits silently on Windows unless PostgreSQL's `bin` is on its `PATH` (`libpq.dll`); `local-supabase.mjs` now
  adds it.
- Python prints Arabic through cp1252 when piped on Windows; `import-data.mjs` runs Python with `-X utf8`.
- Files in a Windows checkout have CRLF line endings (`core.autocrlf`); multi-line text replacements must match `\r\n`.
- `tsc --noEmit` in `apps/web` is incremental: use `--incremental false` to avoid stale results.
- Playwright 1.64 expects Chromium build 1248 (`npx playwright install chromium`).
- Next.js dev server may show stale errors after big edits; restart it if a page reports a missing export that exists.

---

## F. Testing

All runs were **local** (local PostgreSQL, the real Supabase Auth and PostgREST built for Windows). The hosted project
was only **read** (migrations list, security advisories), never written.

| Suite | Command | Result |
| --- | --- | --- |
| API type check | `npx tsc --noEmit` in `apps/api` | pass |
| API unit | `npx jest` in `apps/api` | **80/80** |
| API e2e | `npm run test:e2e -w @midan/api` | **187/188** before the last commit; the failure was the reorder test's expectation (fixed); rerun pending |
| Web type check | `npx tsc --noEmit --incremental false` in `apps/web` | pass |
| Web unit | `npm test -w @midan/web` | **31/31** |
| Web build, bundle secret check | `npm run build -w @midan/web`, `npm run check:bundle -w @midan/web` | pass (75 routes; no secrets) — at `6637862` |
| API build | `npm run build -w @midan/api` | pass — at `b49eb36` |
| AI service | `pytest` in `services/ai` | **251 passed, 11 skipped**; the Postgres checkpoint test passes with `TEST_CHECKPOINT_DATABASE_URL` |
| Migration + rollback (reorder) | psql on PostgreSQL 18 | pass |

Not run: browser suites (`npm run test:e2e -w @midan/web`, `npm run test:forms -w @midan/web`), `supabase/tests/*.sql`,
`scripts/rehearse-migrations.sh`, API live tests. They can run now on the local stack (the forms suite needs Chromium 1248).
AI skips: optional E5 model, Tesseract OCR, a private assessor guide, real-provider calls (opt-in).

---

## G. Priorities for the next developer

1. Pull the branch, start the stack (section E), **rerun the API e2e suite** and confirm 188/188.
2. Walk the **employer job setup end to end** in the browser (steps 3–6): build the requirements "use what you wrote"
   panel (D.2), then fix whatever blocks skills → assessment → review → publish (D.3, D.4).
3. With a Groq key in the local `.env`, check **real AI assessment generation** and **real evaluation**, including the
   named failure causes when the quota runs out.
4. Walk the **candidate journey** (D.6) and the **employer evaluation** (D.7) in the browser, Arabic and English, desktop
   and mobile; fix what blocks.
5. Run the browser suites and database checks (section F, "Not run").
6. Demo reset ids (D.8), select labels (D.5), the redesign refinements (D.9).
7. Owner decisions before building: palette, registry organization at sign-up, retention, SMTP provider, hosted
   migrations.

Rules that still hold: never push to `main` or force-push; never commit `.env` or the `data/source` files; keep the
access-code gate, Supabase Auth, tenant isolation, versioning and the dynamic skills implementation; never invent AI
scores; no fake companies or activity outside clearly labelled test data.
