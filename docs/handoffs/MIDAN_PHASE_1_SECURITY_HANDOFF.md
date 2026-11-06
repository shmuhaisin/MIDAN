# MIDAN — Phase 1 Security Handoff

Written 2026-11-07. Phase 1 covers the security and data-integrity findings of
[docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md](../audits/MIDAN_PHASE_0_GAP_ANALYSIS.md) (S1–S3, S5–S8). Nothing was pushed or
merged, and nothing was applied to hosted Supabase.

## 1. Branch and commits

| Item | Value |
| --- | --- |
| Repository | https://github.com/shmuhaisin/MIDAN, cloned fresh (the earlier audit looked at a ZIP export) |
| Base | `feature/midan-complete-data-jobs-assessment` at `e86932b`, clean and level with `origin` when cloned |
| Branch | `feature/midan-phase-1-security` (local only, not pushed) |
| Remote branches seen | `main` `8f0235b`, `candidate-portal` `2523115`, `feature/midan-complete-data-jobs-assessment` `e86932b`, and `feat/company-workflow`, which appeared on the remote during this session and wasn't touched or reviewed |

| Commit | Contents |
| --- | --- |
| `037afdf` | Add the Phase 0 repository audit and gap analysis |
| `16dd598` | Scope candidate documents to their organization and enforce application status moves (S1, S2, S5 part) |
| `8141bfc` | Harden requests: verified rate-limit keys, constant-time AI token, security headers (S3, S6, S7, S8) |
| (last) | Phase 1 documentation and this handoff |

## 2. What was fixed

### S1 — Candidate documents (HIGH) · fixed and tested at the database; end-to-end test written, not run

**Problem.** The `candidate-documents` read policy for staff checked only the first folder of the path
(`private.can_view_candidate_path`). Any organization with an active application from a candidate could read everything
in that candidate's folder, including CV copies attached to applications to **other employers**
(`{candidate}/applications/{jobId}/…`), and list them, which revealed the other jobs.

**Fix.** `supabase/migrations/20261107090000_scope_candidate_document_access.sql` adds
`private.can_view_candidate_document(name)` and replaces the policy. Staff of an organization read an object only if it is
the `cv_snapshot_path` of an active application to that organization. If that application has no copy, they read the
candidate's current `cv_path` instead, which is the same fallback the API already uses in
`GET /v1/applications/:id/cv-url`. Any member of the organization qualifies, as before. A withdrawal ends access
(the copy is also cleared).

**Product rule kept, and worth confirming:** the current-CV fallback. An application made before the candidate uploaded a
CV lets that employer see a CV the candidate uploaded later. Removing the fallback would mean those applications show no
CV at all.

### S2 — Application status (MEDIUM) · fixed and tested at the database and API mapping; end-to-end tests written, not run

**Problem.** `PATCH /v1/applications/:id/status` wrote any status straight to the table, so "hired" could be set with no
evaluation, and "evaluated" with nothing evaluated.

**Fix.** `supabase/migrations/20261107090100_application_status_transitions.sql`:
- `public.set_application_status(application, status)` is now the only way staff change a status. It runs for
  owners, admins and recruiters of the application's organization; anyone else gets "not found" (404). Moves:

  | From | Allowed by hand |
  | --- | --- |
  | submitted | under_review, shortlisted, rejected |
  | under_review | shortlisted, rejected |
  | assessment_invited / _in_progress / _submitted | shortlisted, rejected |
  | evaluated | shortlisted, rejected, hired |
  | shortlisted | rejected, hired |
  | rejected | under_review, shortlisted |
  | hired, withdrawn | nothing |

  Re-sending the current status changes nothing. Anything else gets a 422.
- **Hiring needs reviewed assessments:** every non-expired attempt of the application must have an evaluation with
  status `reviewed` (`private.assessments_reviewed`). This applies to the manual change and to a hiring outcome
  (`private.guard_outcome`, so `POST …/applications/:id/outcome` with `hired` also gets a 422 until then). A job with no
  assessment has nothing to wait for.
- Assessment stages and "evaluated" are never set by hand: they come from `private.sync_application_status`, which is
  unchanged and still the only way to "evaluated".
- The `org updates status` policy is dropped, and `update` on `applications` is revoked from `authenticated`. The
  system's own changes (assessment progress, outcomes, withdrawal) run in security definer functions and are unaffected,
  which the database test confirms.

API: `apps/api/src/applications/applications.controller.ts` calls the function; `common/database-exception.filter.ts`
maps "not allowed until" to 422. Web: `apps/web/src/lib/application-status.ts` mirrors the moves and
`components/forms.tsx` (`ApplicantStatus`) offers only those; a unit test compares it with the SQL.

**Derived from the existing workflow, not invented:** no new statuses. The interview outcome path already hired from
"evaluated", so "evaluated → hired" stays allowed.

### S3 — Rate limiting (MEDIUM) · fixed and tested

**Problem.** The limiter keyed on a hash of whatever `Authorization` header arrived, so each made-up token got a new
300-request limit.

**Fix.**
- `apps/api/src/auth/auth.guard.ts`: new `authenticate(request)` verifies the token with Supabase Auth once per request
  and caches the answer on the request. `AuthGuard`, `OptionalAuthGuard` and the limiter share it, so there's still one
  Auth call per request.
- `common/token-throttler.guard.ts`: a verified account is limited as `user:<id>`; everything else (no token, a rejected
  token, Auth unavailable) by `req.ip`.
- `common/configure-app.ts`: `TRUST_PROXY` sets Express "trust proxy" (hop count, `loopback`, or addresses/CIDRs). It's
  off by default, so `X-Forwarded-For` is ignored unless configured.
- `apps/web/src/lib/api.ts` forwards the browser's `x-forwarded-for` to the API.

When `TRUST_PROXY` is safe is spelled out in `docs/deployment.md`. Next.js keeps an `X-Forwarded-For` the browser sent,
so it's safe only behind a hosting proxy that appends the client address. Unset, signed-out visitors share the web
server's limit.

### S5 — Signed CV link in the queue (LOW) · partly fixed; the rest needs an owner decision

**Done.** `supabase/migrations/20261107090200_clear_finished_job_links.sql` removes `file_url` from a job's payload when it
succeeds or fails, and from jobs that had already finished. The payload was already unreadable through the Data API
(column grants), and the database test confirms it. The worker logs only job id, kind, outcome and an error class or a
short permanent code, never the payload or an error message that might contain the link (`jobs-queue/worker.spec.ts`).

**Not done: "store the path and sign when the worker runs".** The worker acts as the candidate through the database, but
Storage needs the candidate's token or a privileged key to sign a link, and the design deliberately has neither
(`docs/DECISIONS.md`: no service-role key). The options are below (section 6). Until one is chosen, the link stays in the
payload for up to 30 minutes while the job is queued or running.

### S6 — AI service token (LOW) · fixed and tested

`services/ai/midan_ai/main.py`: `hmac.compare_digest` on UTF-8 bytes. A missing, empty, wrong, prefixed, padded,
differently cased or non-ASCII token gets a 401 on every protected route, and so does any call while no token is
configured. `/health` stays open.

### S7 — Security headers (LOW) · fixed and tested (browser check of public pages; Daily and Google sign-in not checked)

- **Web pages** (`src/proxy.ts`, `src/lib/csp.ts`): a fresh nonce per request. Policy: `script-src 'self' 'nonce-…'
  'strict-dynamic'` (plus `'unsafe-eval'` in development only); `style-src 'self' 'unsafe-inline'` (React style
  attributes can't take a nonce); images from self, data, blob and the Supabase project; `frame-src https://*.daily.co`;
  `connect-src` self and Daily; `form-action` self and Supabase (Google sign-in); `frame-ancestors 'none'`;
  `object-src 'none'`; `base-uri 'self'`; `upgrade-insecure-requests` when `APP_URL` is HTTPS. The request passed on
  carries the policy, so Next.js stamps its scripts, and the layout gives the nonce to the next-themes script.
- **Every web response** (`next.config.ts`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, no `X-Powered-By`, and HSTS for a production build whose `APP_URL`
  is HTTPS.
- **API** (`common/security-headers.ts`): `Content-Security-Policy: default-src 'none'; frame-ancestors 'none';
  base-uri 'none'` (not on `/docs`, Swagger), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Resource-Policy: same-origin`, no `X-Powered-By`, HSTS only when the request is HTTPS.

### S8 — Development access code (LOW) · fixed and tested

`DEV_TEST_ACCESS_CODE` was in `next.config.ts`'s `env` map, which Next.js writes into the built code (server files at
least). It's now set as a runtime variable of the server process only, read by the server action in
`lib/auth-actions.ts`. `apps/web/scripts/check-bundle-secrets.mjs` (`npm run check:bundle -w @midan/web`) fails if a
secret's value appears anywhere in a build, or a secret's name, or the sign-up field `midan_test_access`, appears in a
browser file.

## 3. Migrations created (not applied to hosted)

| File | Adds | Notes |
| --- | --- | --- |
| `20261107090000_scope_candidate_document_access.sql` | `private.can_view_candidate_document`; replaces policy "org reads applicant documents" on `storage.objects` | Additive apart from the policy |
| `20261107090100_application_status_transitions.sql` | `private.manual_status_change_allowed`, `private.assessments_reviewed`, `public.set_application_status`; replaces `private.guard_outcome`; drops policy "org updates status"; revokes `update` on `applications` from `authenticated` | **Deploy with the matching API**: the old API writes the table directly and would get 403 |
| `20261107090200_clear_finished_job_links.sql` | Replaces `private.settle_background_job`; clears `file_url` from finished jobs | Data change limited to finished jobs' payloads |

Hosted `al-midan-ya-hamidan` has 23 migrations; it is also missing `20261106140000`–`20261106170000` from the base
branch. Apply all seven in order once the owner approves.

## 4. Tests and exact results

Environment: Windows 11, Node 22.19.0, npm 10.9.3, Python 3.14.6 (scratch venv with the `pyproject.toml` dependencies;
the lock file targets 3.13), PostgreSQL 18.3 binaries for a scratch cluster. Not available: `uv`, tesseract, Docker, WSL,
the Linux binaries of the local Supabase stack, and `.env` / `.env.test.local`.

| What | Command | Result |
| --- | --- | --- |
| API unit tests | `npm test -w @midan/api` | **22 passed / 22**, 6 suites (was 7). New: S2 error mapping (4), rate limiting (5 + 2 setting), headers (2), worker (3) |
| Web unit tests | `npm test -w @midan/web` | **15 passed / 15** (was 7). New: status moves vs SQL (2), CSP (6) |
| AI tests | `pytest` in `services/ai` | **124 passed, 3 skipped** (was 88 + 3). New: 36 token cases. Skipped as before: 2 OCR (no tesseract), 1 Postgres checkpoint (no `TEST_CHECKPOINT_DATABASE_URL`) |
| Type checks | `npm run lint` | **Passed** (api and web, including the e2e specs) |
| API build | `npm run build -w @midan/api` | **Succeeded** |
| Web build | `DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run build -w @midan/web` | **Succeeded** |
| Build secret check | `DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run check:bundle -w @midan/web` | **Passed**: 990 files, no value, no names in browser files. Control: the script exits 1 on a planted value and a planted name |
| Database security checks | all 30 migrations on a scratch PostgreSQL 18 with `supabase/local/00_supabase_shim.sql`, a stand-in `auth.users`/`auth.identities`, `05_auth_functions.sql`, `10_local_logins.sql`; then `supabase/tests/security_phase1.sql` | **All passed** (S1, S2, S5 sections). Control: the same run without `20261107090000` **fails** at "S1: organization A sees exactly its own application's CV copy" |
| Production web in a browser | `next start` of that build, built-in browser, API deliberately down | `/en/about`, `/en/how-it-works`, `/ar/login`, `/en/opportunities` (error page, as the API was down): **no CSP violations**; all 17 scripts on a page carried the nonce; theme script ran; client navigation and the theme switch worked; headers as specified, no HSTS over HTTP |
| API end-to-end | `npm run test:e2e -w @midan/api` | **Not run (blocked)**: needs the Linux local stack or hosted test accounts; never run against hosted, which would write data |
| Browser end-to-end | `npm run test:e2e -w @midan/web`, `test:forms` | **Not run (blocked)**, same reason |

New and changed end-to-end cases (written, type-checked, **not run**):
- `foundation.e2e-spec.ts`: "allows only the status moves the workflow has"; "stores files privately: a file that isn't an
  application's CV is the candidate's alone" (replaces a test that expected the old, too-wide access); "gives each
  organization only the CV copy submitted to it, never another employer's" (copies, cv-url, listing, other candidate,
  signed-out visitor, withdrawal).
- `pipeline.e2e-spec.ts`: hiring refused before review, by status and by outcome; "hires only once the assessment has been
  reviewed, and only by the owning organization".

## 5. Every changed file

Code and tests (commits `16dd598`, `8141bfc`):
- `supabase/migrations/20261107090000_scope_candidate_document_access.sql`, `20261107090100_application_status_transitions.sql`, `20261107090200_clear_finished_job_links.sql` (new)
- `supabase/tests/security_phase1.sql` (new)
- `apps/api/src/applications/applications.controller.ts`, `auth/auth.guard.ts`, `common/configure-app.ts`, `common/database-exception.filter.ts`, `common/token-throttler.guard.ts`
- `apps/api/src/common/security-headers.ts` (new), `common/security-headers.spec.ts` (new), `jobs-queue/worker.spec.ts` (new)
- `apps/api/src/common/database-exception.filter.spec.ts`, `throttle.spec.ts`, `foundation.e2e-spec.ts`, `pipeline.e2e-spec.ts`
- `apps/web/next.config.ts`, `package.json`, `tsconfig.json`, `src/proxy.ts`, `src/app/[locale]/layout.tsx`, `src/components/chrome.tsx`, `src/components/forms.tsx`, `src/lib/api.ts`
- `apps/web/src/lib/application-status.ts`, `application-status.test.ts`, `csp.ts`, `csp.test.ts`, `apps/web/scripts/check-bundle-secrets.mjs` (new)
- `services/ai/midan_ai/main.py`, `services/ai/tests/test_service_token.py` (new)
- `scripts/local-supabase.mjs` (Storage stand-in: folder listing, needed by the cross-employer test; restart it after pulling)
- `.env.example` (`TRUST_PROXY`)

Documentation (last commit): `docs/handoffs/MIDAN_PHASE_1_SECURITY_HANDOFF.md` (new), `docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md`
(Phase 1 update section), `docs/DECISIONS.md`, `docs/deployment.md`, `docs/local-development.md`, `PROJECT_STATUS.md`,
`HANDOFF.md` (marked superseded). The audit report itself was added in `037afdf`.

## 6. Owner decisions required

1. **S5, how the worker reads CVs.** Options:
   - (a) Keep the current approach: a 30-minute link, cleared when the job finishes, never logged or readable through the
     Data API. No new credential. This is what's in place.
   - (b) A storage-only server credential (for example Supabase Storage S3 access keys restricted to
     `candidate-documents`), used by the worker to sign at run time. It bypasses storage policies, so it is privileged and
     changes the "no service-role key" decision.
   - (c) Hand the file to the AI service at upload time, with no queue retries for the file itself. That loses
     retry-after-restart.
   Recommendation: (a) now, and (b) only if the queue must survive outages longer than 30 minutes.
2. **S2 status rules.** Whether rejection should be reversible (it is: rejected → under review or shortlisted), and
   whether hiring through an interview outcome should also need a shortlist (it doesn't: outcomes follow evaluation).
3. **S1 current-CV fallback** (section 2, S1).
4. **`TRUST_PROXY` for the chosen host**, once hosting is decided.
5. Approval to apply the seven pending migrations to hosted (section 3).

Approved requirements recorded for later phases (not implemented in Phase 1; see `docs/DECISIONS.md`):
- Gemini and OpenAI behind one provider interface, chosen by configuration, with provider and model recorded per
  evaluation, the same validation, retries and evidence rules, and each verified with real credentials.
- Hybrid employer management: MIDAN runs the ten registry pages first; employers claim or receive access through a claim
  and ownership-transfer workflow that never grants access automatically; MIDAN keeps platform administration; employer
  users get role-based permissions; no partnership claimed without approval.

## 7. Remaining issues and risks

- **End-to-end suites not run** on this branch (API 108+ cases, browser 28, forms 9). They need the Linux local stack.
  Run them before merging (section 8).
- **CSP not checked** with a Daily interview, Google sign-in, an assessment page or the admin area. Daily runs inside its
  iframe; daily-js might still call an origin the policy doesn't list. Check the browser console on those screens.
- **`style-src 'unsafe-inline'`** remains (React style attributes).
- **S4**: the API still calls Supabase Auth on every request with a token (now once, shared). Verifying JWTs locally would
  stop catching revoked sessions, which a test relies on.
- **S9–S11** unchanged: no magic-byte check on evidence uploads and no malware scanning; leaked password protection off
  on hosted; 11 SECURITY DEFINER RPCs to review; `npm audit` (4 high via Prisma's `deepmerge-ts`).
- The database checks ran on PostgreSQL 18 with a stand-in `auth` schema; hosted is PostgreSQL 17 with real Supabase Auth
  and Storage. The SQL uses nothing version-specific, but the end-to-end run is the real confirmation.
- `scripts/local-db.sh` and the stack scripts remain Linux-only. `scripts/import-data.mjs` uses `URL.pathname`, which
  breaks on Windows. There's no CI. These belong to a later phase.
- `NEXT_SESSION_PROMPT.md` still describes the `candidate-portal` session and should be rewritten when the next phase is
  planned.

## 8. Exact next steps

1. Review the three commits on `feature/midan-phase-1-security`.
2. On a Linux machine (or WSL) with the local stack:

   ```bash
   scripts/local-setup.sh
   ```

   ```bash
   scripts/local-db.sh psql -f supabase/tests/security_phase1.sql
   ```

   Then start the AI service, `node scripts/local-supabase.mjs` and the API with `BACKGROUND_WORKER=off`, and run:

   ```bash
   npm run test:e2e -w @midan/api
   ```

   ```bash
   npm run test:e2e -w @midan/web
   ```

   ```bash
   npm run test:forms -w @midan/web
   ```

   Afterwards: `scripts/local-db.sh psql -f supabase/test-cleanup.sql`.
3. Open an interview with Daily, an assessment and Google sign-in in a production build (`npm run build` then
   `npm run start -w @midan/web`), and check the console for CSP violations.
4. Decide the open points in section 6.
5. With approval: push the branch, open a pull request into `feature/midan-complete-data-jobs-assessment`, and only then
   plan hosted migration (all seven, in order, with the matching API deployed at the same time).
