# MIDAN — Phase 0: Repository Audit and Gap Analysis

Audit date: 2026-11-07. Audit only: no application code, migration, hosted resource or Git state was changed.
Everything below was checked in this session against the code, the source files, the test suites that could run here,
and read-only queries on the hosted database. Claims taken from earlier handoffs without re-verification are labelled.

**Status legend**

| Status | Meaning in this report |
| --- | --- |
| VERIFIED_COMPLETE | Implemented, and confirmed in this session by a test run, a build, or a direct data check |
| IMPLEMENTED_BUT_UNVERIFIED | Code (and usually tests) exists, but the tests need infrastructure that wasn't available here, so they were not re-run |
| PARTIALLY_IMPLEMENTED | Some of the capability exists; named parts are missing |
| NOT_IMPLEMENTED | No code for it |
| BLOCKED | Can't proceed without external data, credentials or access |
| NEEDS_DECISION | Waiting on a product or owner decision |

---

## Update after Phase 1 (2026-11-07)

The security findings in section 7 were worked on in branch `feature/midan-phase-1-security`. Details, tests and exact
results: [docs/handoffs/MIDAN_PHASE_1_SECURITY_HANDOFF.md](../handoffs/MIDAN_PHASE_1_SECURITY_HANDOFF.md). The rest of
this report is left as audited.

| Finding | Now | Evidence |
| --- | --- | --- |
| S1 cross-employer candidate documents | **Verified on the local stack**, end to end | `20261107090000_scope_candidate_document_access.sql`; `supabase/tests/security_phase1.sql` (fails without the fix); `foundation.e2e-spec.ts` "gives each organization only the CV copy submitted to it…" |
| S2 application status | **Verified on the local stack**, end to end; the owner's D.1 and D.2 open | `20261107090100_application_status_transitions.sql`; `security_phase1.sql`; `database-exception.filter.spec.ts`; `application-status.test.ts`; `foundation.e2e-spec.ts` "allows only the status moves the workflow has"; `pipeline.e2e-spec.ts` "hires only once the assessment has been reviewed…" |
| S3 rate-limit bypass | **Verified** with a stand-in for Auth; budget added for rejected tokens; `TRUST_PROXY` waits for hosting | `common/token-throttler.guard.ts`, `auth/auth.guard.ts`, `common/configure-app.ts` (`TRUST_PROXY`); `throttle.spec.ts` |
| S4 auth call per request | **Open**: unchanged, needs the owner's decision (handoff D.5) | — |
| S5 signed link in queue payload | **Kept by owner decision, verified on the local stack**, after closing a link leak and an arbitrary-URL fetch (handoff B.0b) | `20261107090200_clear_finished_job_links.sql`; `jobs-queue/worker.spec.ts`; `security_phase1.sql` |
| S6 AI token comparison | **Verified** | `services/ai/midan_ai/main.py`; `tests/test_service_token.py` |
| S7 security headers | **Verified** in a production build; real Daily, real Google sign-in and HTTPS not verified | `apps/web/src/lib/csp.ts`, `src/proxy.ts`, `next.config.ts`; `apps/api/src/common/security-headers.ts`; `csp.test.ts`, `security-headers.spec.ts` |
| S8 access code in Next.js `env` | **Verified** | `next.config.ts`; `apps/web/scripts/check-bundle-secrets.mjs` |
| S9 evidence uploads, malware scanning | Unchanged | — |
| S10 leaked password protection, SECURITY DEFINER RPCs | Unchanged (dashboard / later review) | — |
| S11 `npm audit` | Unchanged | — |

Owner decisions made since the audit, recorded in `docs/DECISIONS.md`:
- Gemini and OpenAI behind one provider interface (AI integration phase). Neither has passed a real-credential test.
- A hybrid employer-management model with a claim workflow (employer phase).
- MIDAN owns assessment design; employers provide job context and may review or approve. **This changes section 4E:**
  today organizations generate, edit and publish their own assessments, so the assessment features are built but
  assigned to the wrong party. Alignment is later-phase work.
- S5 as above.

Hosted is unchanged: 23 migrations. Pending there, none applied: the four from the base branch
(`20261106140000`–`20261106170000`) and the five Phase 1 migrations (`20261107090000`–`20261107100100`). The old S1 and S2 rules are still live there.

---

## 1. Executive summary

MIDAN is a working, well-structured three-service MVP (Next.js web, NestJS API, FastAPI/LangGraph AI service on Supabase
Postgres) with strong tenant isolation by design: the API never uses a service-role key and every query runs under the
caller's identity with RLS. The core journey **Browse → Apply → Job-specific assessment → Evaluation** is implemented end to
end and was reported passing in earlier sessions. This session confirmed everything that could run here: type checks, both
production builds, API and web unit tests, and 88 of 91 AI-service tests (3 skipped for lack of tesseract or Postgres).

What MIDAN does not yet have is **real content and real AI**:

- **No job records exist.** The employer workbook's `Jadarat Jobs` sheet holds a header row and nothing else. The database
  has only 2 demo jobs. Imported external listings, if supplied, cannot be applied to in MIDAN; no conversion to native jobs
  exists.
- **None of the 10 registry employers has an organization account.** How employers get organization accounts is an open
  owner decision.
- **No LLM has ever run.** Draft generation is template-only by design; open-answer evaluation runs a labelled length
  heuristic. Two design gaps would affect a real provider: the evaluator sends only English task, rubric and instruction
  text, and skill scores are computed only for the 6 internal draft skills, never for the 5,074 workbook skills that jobs
  and assessments are now built on.
- **The hosted database is 4 migrations behind the repository** (23 of 27 applied) and is missing one workbook skill.
- **Not production ready.** Nothing is deployed; there's no CI, no SMTP, and registration is gated closed. One likely
  cross-employer document exposure was found in a storage policy (section 7, S1).

**What to do first:** fix the storage-policy and status-transition issues (Phase 1), then get the owner's approval to
bring hosted up to date (Phase 2). In parallel, get two things from the owner: the job dataset, and the decision on
employer organizations (Phase 3).

---

## 2. Verified architecture

```
Browser ──HTTPS──▶ apps/web (Next.js 16, port 3100)
                     │  server actions + server components; session in httpOnly cookies midan_at / midan_rt
                     │  src/proxy.ts refreshes tokens against Supabase Auth
                     ▼  Bearer <Supabase access token>
                   apps/api (NestJS 11, port 4000, prefix /v1, Swagger /docs)
                     │  AuthGuard → GET {SUPABASE_URL}/auth/v1/user on every request
                     │  DbService.asUser/asAnon/asWorker: one transaction per call, SET role + request.jwt.claims → RLS
                     │  BackgroundWorker (in-process) polls private.claim_background_job (FOR UPDATE SKIP LOCKED)
                     ├──▶ Supabase Postgres (login midan_api, no table rights of its own)
                     ├──▶ Supabase Storage REST, called with the end user's token (storage policies decide)
                     └──▶ services/ai (FastAPI, port 8000), header x-service-token
                            Graph A assessment_builder (templates, no LLM) · Graph B evaluation (provider or demo)
                            CV pipeline (extract → OCR → redact → outbound check → provider or local)
                            Checkpoints: Postgres schema ai_checkpoints (role midan_ai) or local SQLite fallback
scripts/import-data.mjs ──▶ Postgres as midan_importer (private.import_* functions only)
```

| Component | Actual implementation | Evidence |
| --- | --- | --- |
| Web | Next.js 16, React 19, next-intl (`/ar`, `/en`), Tailwind 4; all data via server-side `api()` | `apps/web/src/lib/api.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts` |
| API | NestJS 11 + Prisma 6 client (schema pulled, never migrated by Prisma); global `ValidationPipe` (whitelist, forbidNonWhitelisted); DB error filter that hides SQL | `apps/api/src/main.ts`, `common/configure-app.ts`, `common/database-exception.filter.ts` |
| Database | 27 migrations in `supabase/migrations` own the schema; 55 tables across `public`/`private` locally; RLS enabled table by table | `supabase/migrations/*`, `apps/api/prisma/schema.prisma` |
| Auth | Supabase Auth (GoTrue). The API checks every token with `/auth/v1/user`. Sign-up is gated by an access code checked in `private.guard_signup` | `apps/api/src/auth/auth.guard.ts`, `supabase/migrations/20261105122524_gated_real_signup_and_provisioning.sql` |
| Authorization | RLS + `private.is_org_member(org, roles)`; API adds `requireRole` (`BUILDERS` = owner/admin/recruiter, `EVALUATORS` = owner/admin/reviewer); `PlatformAdminGuard` asks `private.platform_admins` | `apps/api/src/common/roles.ts`, `apps/api/src/admin/admin.controller.ts` |
| Storage | 3 buckets: `candidate-documents` (private, 10 MB, PDF/DOCX), `assessment-evidence` (private, 25 MB), `organization-assets` (public, 2 MB images); signed URLs, 300 s by default | `supabase/migrations/20261104220140_storage_and_api_role.sql`, `apps/api/src/common/storage.ts` |
| Queue | `public.background_jobs` + `private.claim/settle/retry` functions, `midan_worker` role; one handler, `cv_analysis` | `apps/api/src/jobs-queue/worker.ts`, `supabase/migrations/20261106150000_background_jobs_and_job_analysis.sql` |
| AI | FastAPI, LangGraph; Gemini/OpenAI HTTP providers; `DemoProvider` fallback; shared-token auth | `services/ai/midan_ai/main.py`, `providers.py`, `evaluation.py`, `assessment_builder.py`, `cv.py`, `privacy.py` |
| Imports | Node CLI + isolated Python extractors (openpyxl); lineage in `import_runs`/`import_records` | `scripts/import-data.mjs`, `scripts/extract-reference-data.py`, `scripts/extract-employers.py` |
| Local stack | Bash scripts that download Linux x86-64 GoTrue/PostgREST binaries and run Postgres 16 | `scripts/local-setup.sh`, `scripts/local-db.sh`, `scripts/local-supabase.mjs` |

**Not present:** Docker images for web and API (only `services/ai/Dockerfile`), docker-compose, CI (`.github/` absent),
ESLint (`lint` runs `tsc --noEmit`), shared `packages/*`, HTTP security headers (no CSP/HSTS in `next.config.ts`, no helmet
in the API), an email sender.

---

## 3. Git and branch status

The audited folder (`D:\Downloads\MIDAN-feature-midan-complete-data-jobs-assessment (1)\…`) is **a ZIP export with no
`.git` directory**. There is no local branch, HEAD, tracking or uncommitted state to report. To establish what it is, the
public remote was read with `git ls-remote` and a shallow clone in a scratch directory (no remote writes).

| Item | Finding |
| --- | --- |
| Remote | https://github.com/shmuhaisin/MIDAN (public) |
| Remote branches | `main` @ `8f0235b`, `candidate-portal` @ `2523115`, `feature/midan-complete-data-jobs-assessment` @ `e86932b` |
| This export | **Byte-identical** (ignoring line endings) to `feature/midan-complete-data-jobs-assessment` @ `e86932b` ("Add the complete implementation handoff for this branch"), 244 tracked files |
| Uncommitted changes | None relative to `e86932b` |
| Ahead or behind | Not applicable (no local repo). The feature branch is 11 commits ahead of `candidate-portal`, which is 6 ahead of `main`; neither is merged |
| Recent history | `e86932b` handoff · `b82e0b4` job-specific assessment on workbooks · `10068b0` source files · `29a45e6` · `f90a71c` · `59b2f3d` employer registry · `482a373` requirement-driven drafts, Postgres checkpoints · `62afa02` admin screens · `2958f8f` pipeline tests · `8c261d3` admin/import/queue · `959aa73` local stack |
| Matches the latest handoff? | **Yes for content.** The commit list matches `docs/handoffs/MIDAN_COMPLETE_IMPLEMENTATION_HANDOFF.md` §2. **But** the handoff says the branch was *not pushed* (403); it is on GitHub now, so that statement is out of date |

**Recommendation:** work from a real clone of the feature branch, not this ZIP, so later phases have history, diffs and
branches.

---

## 4. Feature-by-feature status

### A. Employer registry

| Capability | Status | Evidence |
| --- | --- | --- |
| Employer database (10 entities, aliases, sources) | **VERIFIED_COMPLETE** (data) | Hosted: `employer_registry` 10, `employer_aliases` 11, `employer_sources` 10 (read-only query, this session); tables in `20261106005341_reference_search_and_test_data.sql` and `…140000_platform_admin_and_data_pipeline.sql` |
| Employer profiles (directory, profile page, search) | IMPLEMENTED_BUT_UNVERIFIED | `apps/api/src/me/career.controller.ts` (`ReferenceController` `GET reference/employers`, `employers/:id`); `public.search_employers` in `20261106170000_…`; pages `apps/web/src/app/[locale]/employers/page.tsx`, `employers/[id]/page.tsx`; tests `pipeline.e2e-spec.ts` "finds employers by official name, alias…", "shows a profile as the source states it…". **Hosted lacks `search_employers` and the brand/lineage columns, so the search and profile endpoints would fail there** |
| Aliases and source verification | IMPLEMENTED_BUT_UNVERIFIED | Alias status kept; `ambiguous_manual_review`/`common_manual_review` never auto-match (`private.match_employer`, `20261106140000_…`); admin adds aliases `POST /v1/admin/employers/:id/aliases` |
| Organization accounts | IMPLEMENTED_BUT_UNVERIFIED | `public.create_organization`; `POST /v1/organizations` (`organizations.controller.ts:68`); `apps/web/src/app/[locale]/organization/new/page.tsx` |
| Employer ↔ organization relationship | PARTIALLY_IMPLEMENTED / **NEEDS_DECISION** | `organizations.employer_registry_id` + `public.admin_link_organization_employer` (`20261106170000_…`), `POST /v1/admin/organizations/:id/employer`. Mechanism exists; **no organization is linked** and the owner hasn't decided who operates each employer's account |
| Employer dashboard | PARTIALLY_IMPLEMENTED | Generic organization dashboard `organization/[orgId]/page.tsx`, job workspace, settings/branding. Missing: team invitations/role management (`organization_invitations` table exists, no API or UI references it), registry-employer-specific view |

### B. Jobs

| Capability | Status | Evidence |
| --- | --- | --- |
| Job schema | IMPLEMENTED_BUT_UNVERIFIED | `jobs`, `job_requirements`, `job_skills`, `job_reference_skills`, `external_job_listings`, `external_job_skills` (`core_schema`, `…142828_job_requirements`, `…140000_…`) |
| Listing and details | IMPLEMENTED_BUT_UNVERIFIED | `GET /v1/jobs`, `GET /v1/jobs/:id` (`jobs.controller.ts`); pages `opportunities/page.tsx`, `opportunities/[id]/page.tsx` |
| Search and filters | PARTIALLY_IMPLEMENTED | Filters: employer, location, sector, employment type, level, registry (`jobs.controller.ts:41-63`). Text search matches **titles only** (`jobs.controller.ts:54`), not description or requirements; `take: 100` with no pagination |
| Import pipeline (workbooks) | IMPLEMENTED_BUT_UNVERIFIED | `scripts/import-data.mjs --sectors/--employers`; lineage tables; `pipeline.e2e-spec.ts` "imports and their lineage". Runs only where `uv` and a local Postgres exist; `new URL('..', import.meta.url).pathname` gives `/D:/…` on Windows |
| CSV ingestion | **NOT_IMPLEMENTED** | Listings accept a JSON array only (`import-data.mjs:91-101`). No CSV parser, no upload endpoint, no admin upload screen |
| JSON ingestion | PARTIALLY_IMPLEMENTED | CLI only; validation is inside `private.import_listing_batch`; no API or UI upload |
| Duplicate detection | IMPLEMENTED_BUT_UNVERIFIED | Unique index `external_job_listings_dedupe` (`20261106140000_…:353`); test "updates a re-imported job in place and flags the same job from another source" |
| External source tracking | IMPLEMENTED_BUT_UNVERIFIED | `raw_record`, `source_type`, `source_url`, collection time, `import_records` lineage |
| Job ↔ employer | PARTIALLY_IMPLEMENTED | Native jobs: through `organizations.employer_registry_id` (none linked). Listings: `match_status`/`match_confidence`/`match_evidence` |
| Job ↔ skills | IMPLEMENTED_BUT_UNVERIFIED | `job_reference_skills`; job analysis `public.analyze_job` / `accept_job_analysis` (`analysis.controller.ts`); test "classifies a job to the sector whose workbook names its skills, for every one of the seven" |
| Job data itself | **BLOCKED** | 0 job rows in the source; hosted has 2 demo jobs, 0 listings |
| Listing → applicable native job | **NOT_IMPLEMENTED** / NEEDS_DECISION | Listings "link out and can't be applied to" by design (`jobs.controller.ts:65`); no conversion function exists |

### C. Candidate applications

| Capability | Status | Evidence |
| --- | --- | --- |
| Application flow | IMPLEMENTED_BUT_UNVERIFIED | `POST /v1/jobs/:id/applications` (`jobs.controller.ts:93`), CV snapshot copy, `private.guard_application` (insert sets org and status, builds profile snapshot); page `opportunities/[id]/apply/page.tsx` |
| CV upload and extraction | IMPLEMENTED_BUT_UNVERIFIED (API) / **VERIFIED_COMPLETE** (AI pipeline, except OCR) | Magic-byte check `me.controller.ts:121-147`; queue job `cv.controller.ts:126-135`; AI `cv.py` + `privacy.py` — `tests/test_cv_privacy.py` passed this session; 2 OCR tests skipped (no tesseract) |
| Candidate profile | IMPLEMENTED_BUT_UNVERIFIED | `PUT /v1/me/candidate-profile`, reference/own skills; `profile/page.tsx`, `onboarding/page.tsx` |
| Application status | PARTIALLY_IMPLEMENTED | History and notifications (`log_application_status`, `notify_application`); assessment stages synced by `private.sync_application_status`. **No transition rules for staff:** `PATCH /v1/applications/:id/status` (`applications.controller.ts:75`) lets a recruiter set any status (for example `submitted → hired`, or `evaluated` with no evaluation); only "withdrawn" is guarded |
| Duplicate application prevention | IMPLEMENTED_BUT_UNVERIFIED | `unique (job_id, candidate_id)` (`core_schema.sql:172`); idempotent handler catches P2002 (`jobs.controller.ts:120-126`) |
| Candidate dashboard | IMPLEMENTED_BUT_UNVERIFIED | `GET /v1/me/dashboard` (`candidate.controller.ts:129`); `dashboard/page.tsx`, `applications/[id]/page.tsx` |
| Account deletion and erasure | NOT_IMPLEMENTED / NEEDS_DECISION | No endpoint; blocked once a candidate has applied, pending a PDPL design (HANDOFF.md) |

### D. Skills (seven sector datasets)

| Capability | Status | Evidence |
| --- | --- | --- |
| Seven workbooks present, unmodified | **VERIFIED_COMPLETE** | `sha256sum -c data/source/SHA256SUMS`: all 9 OK |
| Extraction counts | **VERIFIED_COMPLETE** | Re-ran `scripts/extract-reference-data.py` here: 4,917 technical + 157 general = 5,074; 39,438 contexts (section 6) |
| Import status (hosted) | PARTIALLY_IMPLEMENTED | Hosted `reference_skills` = **5,073**; `financial_services/technical` = 356 against 357 in the source. Contexts 39,438 match |
| Skill ↔ sector and job family | IMPLEMENTED_BUT_UNVERIFIED | `reference_skills.sector_code`, `reference_skill_contexts` (sub-sector × job family); `GET /v1/reference/job-families` |
| Missing or invalid mappings | Documented | 54 skills with no sub-sector/family context; 116 without a description; 89 matrix-only skills; 15 descriptions without a listed skill (section 6) |
| Duplicate skills | IMPLEMENTED_BUT_UNVERIFIED | No exact duplicate keys. 57 spelling-variant groups by this audit's normalization (handoff: 118 near-identical pairs flagged by the DB matcher); sent to `/admin/review`, never merged |
| Proficiency levels / skill IDs | **BLOCKED** (source) | The sources don't contain them; extractor output has no id or level fields |
| Skill scoring against workbook skills | **NOT_IMPLEMENTED** | `skill_scores.skill_id` references `public.skills` (6 draft skills) only (`core_schema.sql:392-403`); see section F |

### E. Job-specific assessments

| Capability | Status | Evidence |
| --- | --- | --- |
| Job requirement analysis | IMPLEMENTED_BUT_UNVERIFIED | `public.analyze_job` (literal mentions of workbook skills); `components/job-analysis.tsx` |
| Assessment generation | IMPLEMENTED_BUT_UNVERIFIED (API) / **VERIFIED_COMPLETE** (graph logic) | `POST …/assessment/generate` (`assessments.controller.ts:135`); Graph A `assessment_builder.py`; `tests/test_requirements_builder.py` and `test_graphs.py` passed (1 Postgres checkpoint test skipped). **Template-based, no LLM** (`BUILDER_PROVENANCE` in `main.py`) |
| Drafts | IMPLEMENTED_BUT_UNVERIFIED | Versions `draft/in_review/published`; one draft at a time (`assessments.controller.ts:166`) |
| Manual task editing | IMPLEMENTED_BUT_UNVERIFIED | Add/remove tasks and criteria, edit weights and text (`assessments.controller.ts:258-356`); `components/workspace.tsx`; test "lets the organization add and remove tasks and criteria on a draft…". Manual tasks limited to `written_case_study`/`file_submission` |
| Publishing | IMPLEMENTED_BUT_UNVERIFIED | Owner/admin only, immutable after publish (DB triggers); auto-assignment on apply `private.assign_published_assessments` |
| Candidate execution | IMPLEMENTED_BUT_UNVERIFIED | `GET /v1/experience/...` strips `reference_skill_ids`; server timer `start_attempt`/`expire_my_overdue_attempts`; page `experience/[orgSlug]/[jobSlug]/[version]` |
| Answer persistence | IMPLEMENTED_BUT_UNVERIFIED | `PUT /v1/attempts/:id/responses/:taskId` upsert; evidence upload; `submit_attempt` receipt |
| Scoring and rubrics | PARTIALLY_IMPLEMENTED | Weighted scoring in code (`evaluation.py: compute_scores`, tested); objective tasks deterministic. Gaps: workbook-skill criteria have a placeholder English description (`assessment_builder.py:144`); file evidence is not read, only file names are passed |

### F. AI evaluation

| Capability | Status | Evidence |
| --- | --- | --- |
| Real LLM provider | IMPLEMENTED_BUT_UNVERIFIED / **BLOCKED** (no key) | `providers.py` `_openai`, `_gemini`; never run. No Anthropic provider |
| Demo/fallback mode | **VERIFIED_COMPLETE** | `DemoProvider` (confidence 0.3, labelled), `demo_mode` review reason; `test_graphs.py` passed |
| Prompt management | PARTIALLY_IMPLEMENTED | Prompts are inline constants (`providers.py` `SYSTEM_PROMPT`, `cv.py` `SYSTEM_PROMPT`); one version tag `eval-v1`; no registry, no evaluation dataset |
| Checkpoints and persistence | IMPLEMENTED_BUT_UNVERIFIED | Postgres `PostgresSaver` when `CHECKPOINT_DATABASE_URL` is set, else SQLite (`main.py:23-42`); the Postgres test was skipped here. One shared psycopg connection for all requests |
| CV analysis | **VERIFIED_COMPLETE** (local path) | Privacy pipeline tests passed; external path never run with a real provider |
| Assessment generation by AI | NOT_IMPLEMENTED | By design: templates only |
| Assessment evaluation | PARTIALLY_IMPLEMENTED | Graph B with interrupt for human review, evidence-quote check, injection flagging (tests passed). **Gaps:** (1) only `title_en`, `instructions_en`, `description_en` are sent (`evaluations.controller.ts:71`, `providers.py:72-75`), though tasks and answers are Arabic-first and workbook descriptions are Arabic; (2) skill levels come only from internal `task_skill_mappings`; workbook skills get no `skill_scores`; (3) evaluation runs synchronously inside the HTTP request, not through the queue |
| Error handling and retry | PARTIALLY_IMPLEMENTED | Retries twice with no backoff on bad JSON/`LLMError` (`providers.py:77`). `httpx` timeouts and connection errors aren't caught, so one network fault fails the whole evaluation request (AI returns 500 → API 503) rather than routing that criterion to a person. The API never retries AI calls (`ai.client.ts`) |

### G. Employer evaluation dashboard

| Capability | Status | Evidence |
| --- | --- | --- |
| Applicant lists | IMPLEMENTED_BUT_UNVERIFIED | `GET /v1/organizations/:orgId/applications`; job workspace "candidates" section `organization/[orgId]/jobs/[jobId]/page.tsx` |
| Candidate assessment reports | IMPLEMENTED_BUT_UNVERIFIED | `GET /v1/attempts/:id/evaluation`; `organization/[orgId]/review/[attemptId]/page.tsx`, `components/review.tsx`; candidate report `reports/[attemptId]/page.tsx` |
| Skill scores | PARTIALLY_IMPLEMENTED | Internal draft skills only (see F) |
| Comparisons | IMPLEMENTED_BUT_UNVERIFIED | `GET …/jobs/:jobId/report` (per version); used in the job workspace |
| Application decisions | PARTIALLY_IMPLEMENTED | Shortlist/interview/outcome (`interviews.controller.ts`, `components/hiring-panel.tsx`); no enforced transitions (see C); interview video and calendar tested only against stand-ins |

### H. Security and production readiness

| Capability | Status | Evidence |
| --- | --- | --- |
| Authentication | IMPLEMENTED_BUT_UNVERIFIED | Supabase Auth; httpOnly cookies, `secure` in production; token refresh in `proxy.ts`. Hosted: **leaked password protection disabled** (Supabase advisor) |
| Role-based access | IMPLEMENTED_BUT_UNVERIFIED | RLS + `requireRole`; tests in `foundation.e2e-spec.ts` "roles", "tenant isolation…" |
| Data isolation | PARTIALLY_IMPLEMENTED | Hosted: all 47 public tables have RLS (query this session). **Gap S1** (section 7): candidate-documents storage policy is scoped to the candidate's folder, not to the application |
| File security | PARTIALLY_IMPLEMENTED | MIME allow-lists, size limits, magic-byte check on CVs. No magic-byte check on evidence, no malware scanning |
| Sensitive data handling | PARTIALLY_IMPLEMENTED | Redaction before any outbound call; logs avoid content. A 30-minute signed CV URL is stored in `background_jobs.payload` (`cv.controller.ts:133`); profile endpoint returns the candidate's email and full profile to staff |
| Environment configuration | IMPLEMENTED_BUT_UNVERIFIED | `.env.example`; `scripts/local-env.mjs`; no `.env` in this export (expected) |
| Email and verification | **BLOCKED** | No SMTP; Supabase sender reaches team members only; Site URL points at localhost:3000 (HANDOFF.md). No application email sender |
| Vulnerabilities | Documented | `npm audit`: 4 high in the runtime chain (`deepmerge-ts` via `prisma`/`@prisma/client`), 24 overall (3 low, 17 moderate, 4 high). Supabase advisor: 11 SECURITY DEFINER RPCs callable by `anon`/`authenticated` (all appear intentional; each checks `auth.uid()`; worth a review) |
| Deployment readiness | **NOT_IMPLEMENTED** | Nothing deployed; no web/API images, no CI, no monitoring; registration gated closed (`guard_signup`); PDPL review pending |

---

## 5. Test results (this session)

Environment: Windows 11, Node 22.19.0, npm 10.9.3, Python 3.14.6. Not available: `uv`, PostgreSQL, Docker, tesseract,
Linux binaries for the local Supabase stack, `.env`, `.env.test.local`.

| Command | Result |
| --- | --- |
| `sha256sum -c data/source/SHA256SUMS` | 9/9 OK |
| `npm ci` (lockfile untouched, checked by SHA-256) | 567 packages installed |
| `npm test -w @midan/api` | **7/7 passed** (4 suites). Jest warns of an open handle at exit |
| `npm test -w @midan/web` | **7/7 passed** |
| `npm run lint` (`tsc --noEmit`, api + web) | **Passed** |
| `npm run build -w @midan/api` | **Succeeded** |
| `MIDAN_DIST_DIR=.next-audit npm run build -w @midan/web` | **Succeeded** (all routes built) |
| `pytest` in `services/ai` (scratch venv, `pyproject.toml` dependencies; Python 3.14, not the locked 3.13 environment) | **88 passed, 3 skipped**: `test_cv_privacy.py:326` (no tesseract), `test_cv_privacy.py:401` (no Arabic tesseract/font), `test_requirements_builder.py:73` (no `TEST_CHECKPOINT_DATABASE_URL`) |
| `npm audit` / `npm audit --omit=dev` | 24 vulnerabilities / 4 high |
| `npm run test:e2e -w @midan/api` (108 tests) | **BLOCKED**: needs the local Supabase stack (Linux) or hosted test accounts in `.env.test.local`; running against hosted would write data |
| `npm run test:e2e -w @midan/web` (28 tests) | **BLOCKED**: needs web + API + AI + database |
| `npm run test:forms -w @midan/web` (9 tests) | **BLOCKED**: the auth stub signs in real fixture accounts from `.env.test.local` |

Prior sessions reported 108/108 API e2e, 27/28 browser (one known ordering failure) and 91 AI tests. Those could not be
reproduced here.

Side effect note: the web build with a custom `distDir` made Next.js append two `include` entries to
`apps/web/tsconfig.json`; they were reverted, and the file again matches `e86932b`. Generated artifacts left in place (all
git-ignored): `node_modules/`, `apps/api/dist/`, `apps/web/.next-audit/`, `apps/web/next-env.d.ts`, `__pycache__/`.

---

## 6. Data audit

### Employer workbook (`ALMIDAN_Employer_Database_10_Entities.xlsx`)

| Sheet | Records | Findings |
| --- | --- | --- |
| Employers | 10 (ALM-001…010), no duplicate IDs | 4 `verified_official`, 6 `pending_live_verification`; all `not_partner`. **6 of 10 have no `career_url`** (ALM-002, 006–010); ALM-005's career URL is the stc homepage, not a careers page |
| Brand Profiles | 10 | Logo, colours, font empty for all 10; `not_verified` / `permission_not_verified` |
| Employer Aliases | 11 rows over 10 companies, all Arabic | 2 official, 7 common, 1 `ambiguous_manual_review` (ALM-004), 1 `common_manual_review` (ALM-008). No English aliases |
| Sources | 10 | **Only 4 are `official_source` with `checked_on` 2026-11-05; 6 are `official_domain_reference_pending_check` with no check date** |
| Jadarat Jobs | **0** (header only) | 9 columns defined; no job records |
| README | 7 notes + title row | Title contains a replacement character (`ALMIDAN � Saudi Employer Registry`), an encoding defect in the source |

Extractor (`extract-employers.py`) re-run here: 10 employers, 0 listings, 0 issues.

### Sector workbooks (re-extracted in this session)

| Sector | Technical | General | Total | Contexts | Priority | Sub-sectors | Job families | No description | No context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| construction_real_estate | 652 | 27 | 679 | 1,960 | 118 | 4 | 14 | 5 | 4 |
| culture_entertainment | 899 | 25 | 924 | 4,138 | 124 | 4 | 33 | 6 | 6 |
| digital | 955 | 22 | 977 | 3,504 | 134 | 2 | 17 | 36 | 23 |
| financial_services | 357 | 17 | 374 | 2,774 | 121 | 5 | 13 | 27 | 10 |
| manufacturing | 918 | 22 | 940 | 15,272 | 162 | 14 | 10 | 1 | 0 |
| tourism_hospitality | 669 | 23 | 692 | 7,543 | 127 | 8 | 26 | 40 | 9 |
| wholesale_retail | 467 | 21 | 488 | 4,247 | 98 | 3 | 20 | 1 | 2 |
| **Total** | **4,917** | **157** | **5,074** | **39,438** | **884** | 40 | 123 distinct | **116** | **54** |

- **Identifiers and proficiency levels:** none in any workbook (no id or level field is produced). Nothing was invented.
- **Extractor issues:** 89 `matrix_only_skill`, 18 `stated_count_mismatch`, 15 `description_without_listing`,
  2 `priority_flag_not_on_priority_list`, 1 `priority_skill_not_in_skill_list`, 1 `duplicate_row`.
- **Stated-versus-found totals** differ in 18 sub-sectors, mostly tourism (e.g. النقل البحري 384 stated, 400 found),
  financial services (التأمين 175/191) and digital (تقنية المعلومات 808/837).
- **Duplicates:** 0 exact; 57 spelling-variant groups within the same sector and kind; 407 skill names appear in more
  than one sector (expected, kept per sector).

### Source versus database

| | Source | Hosted (read-only, this session) | Local DB |
| --- | --- | --- | --- |
| Migrations | 27 files | **23** (missing `…140000`, `…150000`, `…160000`, `…170000`) | not available here |
| employer_registry / aliases / sources | 10 / 11 / 10 | 10 / 11 / 10 | — |
| reference_skills | 5,074 | **5,073** (financial_services technical 356 vs 357) | — |
| reference_skill_contexts | 39,438 | 39,438 | — |
| organizations / jobs / applications | — / 0 / — | 2 / 2 (demo, published) / 0 | — |
| external_job_listings | 0 | 0 | — |
| public tables / without RLS | — | 47 / 0 | — |

Field-level equality was not re-checked (the handoff reports MD5 fingerprints match). The missing skill is reported as
«إدارة علاقات الأعمال», which appears only on the financial-services priority sheet (not re-confirmed by name here).

---

## 7. Security and production gaps

| # | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| S1 | **High** | Storage policy on `candidate-documents` grants read to staff of *any* organization the candidate has an active application with, for *every* object under `{candidate_id}/…`. That includes CV snapshots attached to applications to **other employers** (`{candidate}/applications/{jobId}/…`). Through the Storage list API this would also reveal which other jobs the candidate applied to | `20261104220140_…:66`, `can_view_candidate_path` in `20261104223235_…`; the test `foundation.e2e-spec.ts:1374` covers a non-applied org but not this case | PLAUSIBLE (code reading; not exploited) |
| S2 | Medium | Staff can set any application status with no transition rules (`hired` with no evaluation, `evaluated` by hand) | `applications.controller.ts:75`; `guard_application` only guards withdrawal | Confirmed in code |
| S3 | Medium | Rate-limit bypass: the throttler keys on a hash of whatever `Authorization` header is sent, before auth is checked, so random bearer values get fresh buckets on public routes. `OptionalAuthGuard` then calls Supabase Auth for each one | `common/token-throttler.guard.ts:12`, `auth.guard.ts` | Confirmed in code |
| S4 | Medium | Every authenticated request makes a network call to Supabase Auth (no JWT verification or cache): latency, plus an Auth outage takes down the API | `auth/auth.guard.ts` | Confirmed in code |
| S5 | Low | A 30-minute signed CV URL (a bearer capability) is stored in `background_jobs.payload` | `cv.controller.ts:133` | Confirmed |
| S6 | Low | AI service token compared with `!=` (not constant-time); the AI service has no rate limit | `services/ai/midan_ai/main.py:55` | Confirmed |
| S7 | Low | No HTTP security headers (CSP, HSTS, frame-ancestors) in web or API | `next.config.ts`, `main.ts` | Confirmed |
| S8 | Low | `DEV_TEST_ACCESS_CODE` is in the Next.js `env` map, which inlines into any bundle that references it; safe only while referenced from `'use server'` files | `next.config.ts:24`, `lib/auth-actions.ts:165` | Risk |
| S9 | Info | Evidence uploads trust the declared MIME type (bucket allow-list only); no malware scanning of any upload | `attempts.controller.ts:123-156` | Confirmed |
| S10 | Info | Hosted: leaked password protection off; 11 SECURITY DEFINER RPCs exposed to `anon`/`authenticated` (intentional designs, but they should be reviewed) | Supabase security advisor, this session | Confirmed |
| S11 | Info | `npm audit`: 4 high via Prisma's `deepmerge-ts` (documented and accepted in `docs/DECISIONS.md`) | `npm audit` | Confirmed |

**Production gaps:** no deployment target or images for web and API; no CI; no SMTP or Site URL; registration closed by
an access code; Google sign-in not switched on; no real Daily or Calendar run; PDPL and data-residency review not done
(`docs/privacy/cv-data-flow.md`); no accessibility audit; no observability (structured logs, metrics, alerting); a single
in-process worker; a local stack that runs only on Linux x86-64.

---

## 8. Documentation inconsistencies

| Document | Says | Actually |
| --- | --- | --- |
| `docs/handoffs/MIDAN_COMPLETE_IMPLEMENTATION_HANDOFF.md` §2 | Branch "Not pushed" (403) | On GitHub at `e86932b` |
| Handoff §3 | Sources "all `official_source`, checked 2026-11-05" | 4 official with a date; 6 `official_domain_reference_pending_check`, no date |
| Handoff §3 | Only ALM-002's career URL is empty | 6 empty (ALM-002, 006–010) |
| Handoff §3 | README "8 distinct notes; three repeated" | 7 notes + title, no repeats read |
| `HANDOFF.md` | Branch `candidate-portal`, 47 tables, SQLite checkpoints, 80 e2e tests | Superseded: feature branch, 55 tables locally, Postgres checkpoints, 108 e2e |
| `PROJECT_STATUS.md` (2026-11-05) | "Not Started": drafts from requirements, manual add/remove tasks, CSV/JSON imports and review queue, production checkpointer | Drafts, task editing, JSON imports, review queue and Postgres checkpointer exist; CSV still doesn't |
| `NEXT_SESSION_PROMPT.md` | Next items 4, 5, 7, 8 (drafts, import pipeline, reference-skill picker, checkpointer, queue) | Mostly done on this branch |
| `docs/deployment.md` "Migrations" | "All files in `supabase/migrations` are applied to `al-midan-ya-hamidan`" | 23 of 27 applied |
| `apps/api/src/admin/integrations.ts` | "see docs/integrations.md" | File doesn't exist |
| Handoff §12 | Local tests run on "the Mac" / Linux binaries | No Windows path; `import-data.mjs` uses `URL.pathname`, which breaks on Windows |

---

## 9. Prioritized implementation roadmap

| Phase | Goal | Depends on |
| --- | --- | --- |
| **1. Safety fixes and a runnable test bed** | Close S1–S3; enforce application status transitions; add a Docker or WSL-based local stack and CI running unit tests, type checks, builds and AI tests | Nothing |
| **2. Hosted parity** (owner approval) | Apply 4 migrations; set `midan_importer`/`midan_ai` passwords; re-run import (adds the missing skill and lineage); add the first platform admin; enable leaked password protection | Owner approval and dashboard access |
| **3. Jobs and employers** | Owner decision on employer organizations; listing → native job conversion; CSV + JSON ingestion with validation reports via admin upload; full-text search over description and requirements; pagination | Job dataset (BLOCKED), decision (NEEDS_DECISION) |
| **4. Assessment and evaluation correctness** | Arabic-first evaluation payload (send `_ar` fields plus language); workbook-skill scoring (a `reference_skill_scores` table or a generalized `skill_scores`); real workbook descriptions in rubric text; read text evidence; queued, async evaluation; transport-error handling and backoff; prompt registry and versioning; provider choice and a key | AI key (BLOCKED), provider decision |
| **5. Employer evaluation dashboard** | Team invitations and role management; comparison by workbook skill; decision workflow on top of the transitions from Phase 1; registry-employer view | Phases 1, 3, 4 |
| **6. Production** | Web/API images, hosting, SMTP, Site URL, open registration, PDPL review, security headers, observability, accessibility audit, ESLint | Credentials, owner decisions |

---

## 10. Files and modules to modify, by phase

**Phase 1 — safety and test bed**
- New migration `supabase/migrations/<ts>_scope_candidate_document_access.sql`: replace the `candidate-documents` org read policy so staff read only `cv_snapshot_path` of their own org's active applications (and the current CV only where the product requires it); update `private.can_view_candidate_path` or add a path-to-application check.
- New migration `<ts>_application_status_transitions.sql`: extend `private.guard_application` with an allowed-transition table for staff updates.
- `apps/api/src/applications/applications.controller.ts` (`updateStatus`: `requireRole`, clear 422 on disallowed transitions).
- `apps/api/src/common/token-throttler.guard.ts` (track by IP before auth, or by verified user id after `AuthGuard`); `apps/api/src/auth/auth.guard.ts` (JWT verification against the project JWKS with a short cache).
- `apps/api/src/me/cv.controller.ts` + `apps/api/src/jobs-queue/worker.ts` (store the storage path in the payload; sign the URL when the job runs).
- `services/ai/midan_ai/main.py` (`hmac.compare_digest`).
- `apps/web/next.config.ts` (security headers; move `DEV_TEST_ACCESS_CODE` out of `env` into a server-only read).
- Tests: `apps/api/src/foundation.e2e-spec.ts` (cross-employer snapshot read, status transitions).
- New: `.github/workflows/ci.yml`, `docker-compose.yml` (Postgres + GoTrue + PostgREST + storage), `scripts/import-data.mjs` (`fileURLToPath` for Windows).

**Phase 2 — hosted parity** (no code; operational)
- Apply `20261106140000_…`, `…150000_…`, `…160000_…`, `…170000_…`; run `scripts/import-data.mjs` with `IMPORT_DATABASE_URL`; `insert into private.platform_admins …`. Update `docs/deployment.md` and `docs/database/README.md`.

**Phase 3 — jobs and employers**
- New migration: `private.convert_listing_to_job(listing_id, org_id)` (or `admin_create_employer_organization`), keeping `external_job_listings` lineage on the job; indexes for full-text search (`tsvector` over title, description and requirements, Arabic normalization via `private.normalize_arabic`).
- `scripts/import-data.mjs` (`--listings` accepting `.csv`; column mapping matching the Jadarat sheet header), plus a new API admin upload in `apps/api/src/admin/admin.controller.ts` (multipart, dry-run report).
- `apps/api/src/jobs/jobs.controller.ts` (search over description/requirements, pagination cursor).
- `apps/web/src/app/[locale]/admin/listings/page.tsx`, `admin/imports/page.tsx`, `components/admin.tsx`, `lib/admin-actions.ts` (upload, convert, link).
- `apps/web/src/components/jobs-browser.tsx`, `app/[locale]/opportunities/page.tsx` (paging).
- Tests: `apps/api/src/pipeline.e2e-spec.ts`.

**Phase 4 — assessment and evaluation**
- New migration: `reference_skill_scores (result_id, reference_skill_id, level, source)` with RLS mirroring `skill_scores`; extend `public.released_result_details`.
- `apps/api/src/evaluations/evaluations.controller.ts` (send `_ar` fields and language; reference-skill mappings; persist reference skill levels; enqueue instead of inline run).
- `apps/api/src/jobs-queue/worker.ts` (an `evaluation` handler).
- `services/ai/midan_ai/schemas.py`, `evaluation.py` (`compute_scores` over reference skills; bilingual criteria), `providers.py` (catch `httpx.HTTPError`, backoff, prompt files), `assessment_builder.py:144` (use the workbook description in `description_en` or a bilingual criterion), new `services/ai/midan_ai/prompts/`.
- `apps/web/src/components/review.tsx`, `app/[locale]/reports/[attemptId]/page.tsx`, `app/[locale]/organization/[orgId]/jobs/[jobId]/page.tsx` (workbook-skill scores and comparison).
- Tests: `services/ai/tests/test_graphs.py`, `test_requirements_builder.py`, `apps/api/src/pipeline.e2e-spec.ts`.

**Phase 5 — employer dashboard**
- New `apps/api/src/organizations/members.controller.ts` (invitations over the existing `organization_invitations` table, role changes); migration for invitation acceptance if needed.
- `apps/web/src/app/[locale]/organization/[orgId]/settings/page.tsx` (team), `organization/[orgId]/page.tsx`, `components/hiring-panel.tsx`, `components/workspace.tsx`.
- `apps/web/src/messages/ar.json`, `en.json`.

**Phase 6 — production**
- New `apps/api/Dockerfile`, `apps/web/Dockerfile`; hosting config; `apps/api/src/main.ts` (helmet, structured logging, graceful shutdown); `apps/api/src/admin/integrations.ts` + a `docs/integrations.md`; an email sender module if transactional email beyond Supabase Auth is wanted; ESLint configs; `docs/deployment.md`, `docs/privacy/cv-data-flow.md`; refresh `PROJECT_STATUS.md`, `HANDOFF.md`, `NEXT_SESSION_PROMPT.md`.

---

## Open decisions and external dependencies

| Item | Owner | Blocks |
| --- | --- | --- |
| Job dataset (Jadarat or employer-provided), and authorization to collect it | Owner | Phase 3, "jobs of the 10 employers" |
| Who operates each employer's organization account; whether imported listings become applicable jobs | Owner | Phase 3 |
| Approval to apply 4 migrations and re-import on hosted | Owner | Phase 2 |
| LLM provider and key (Gemini/OpenAI already wired; Anthropic would be new) and data-residency stance for sending redacted CVs and answers | Owner + privacy review | Phase 4, real evaluation |
| SMTP sender, Site URL, Google OAuth client, Daily key, Google Calendar credentials | Owner (dashboard) | Phase 6 |
| When to open public registration; PDPL erasure design for candidates who have applied | Owner + legal | Phase 6, account deletion |
| Proficiency scale and skill identifiers (absent from the workbooks) | Data owner | Level-based matching and reporting |
| Brand assets with usage permission for the 10 employers | Employers | Branded employer pages |
