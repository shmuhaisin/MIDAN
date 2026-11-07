# MIDAN — Full Platform Audit

Written 2026-11-07. Audit only: no feature was implemented, nothing was merged, pushed or deployed, and hosted Supabase was not
touched. Every test below ran on the local stack with fictional data.

## 0. What was audited

| | |
| --- | --- |
| Repository | https://github.com/shmuhaisin/MIDAN |
| Latest implementation | **`feature/midan-assessment-intelligence-handoff` at `4487597`** (pushed 2026-11-07). It builds on `midan-assessment-editing-policy` (`0e0d1ff`), which builds on `midan-phases-2-3-4` (`ba1d25c`). Each branch contains the one before it, so this one holds everything |
| Audited on | Local branch `midan-platform-audit`, cut from `4487597`. Only this report was added. Not pushed |
| Other branches | `main` (`8f0235b`, 2026-11-05) is far behind. `feat/company-workflow` (`063cc74`) branched from `main` and is not in the line above: its team and invitation work was rebuilt on this line in Phase 3 (see `MIDAN_PHASE_2_PREPARATION.md` §10). `candidate-portal`, `feature/midan-phase-1-security`, `feature/midan-complete-data-jobs-assessment` and `midan-security-completion` are all contained in the latest branch |
| Hosted Supabase | `al-midan-ya-hamidan`: 23 migrations applied (read-only check, 2026-11-07). **18 are pending**, `20261106140000` to `20261107160000` |
| Documents read | `PROJECT_STATUS.md`, `docs/DECISIONS.md`, `docs/deployment.md`, `docs/local-development.md`, `docs/privacy/cv-data-flow.md`, `docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md`, every file in `docs/handoffs/` and `docs/assessment/` |

**How to read the statuses.** *Verified* means a test ran today and passed (section I.1). *Stand-in* means a local fake answered
in place of Gemini, OpenAI, Google or Daily.co. That proves our side of the exchange, not the real service.

## A. Executive summary

MIDAN is a working **local** platform covering the core path: account, CV, application, job-specific assessment, human-reviewed
evaluation, interview and decision. Its security is unusually careful: row level security on every table, private storage, a
redaction pipeline before any AI call, audited assessment edits, and immutable published versions. The assessment engine is the
most mature part.

It is **not yet** a complete career development and recruitment platform:

1. **Nothing has met a real external service.** No Gemini or OpenAI key, no Google Calendar credentials and no Daily.co key have
   ever been used. CV structuring, assessment generation and open-answer scoring all fall back to local readings and labelled
   templates. The integrations are real code, tested only against stand-ins.
2. **Career intelligence is thin.**
   - CV analysis extracts and organizes sections. It gives no strengths, gaps, quality feedback or evidence per skill, and it
     never captures languages or achievements.
   - The target role is a workbook job family (Arabic only), not a job title such as "Data Analyst".
   - The course catalogue is empty by design, until verified entries exist.
   - A "practical project" is only a label on a plan item: there is no project brief, submission or feedback.
3. **The employer journey has a hole after the interview.**
   - Interview feedback can't be recorded at all.
   - Interviews can be scheduled for candidates who aren't shortlisted.
   - A shortlist can't be undone except by rejecting.
   - The candidate isn't notified when shortlisted or rejected.
4. **One privacy gap to fix first.** Employers read the candidate's *live* profile, through the API and directly through row
   level security. The application snapshot, which was built to leave out private fields, isn't used.
5. **Assessment intelligence has no screens.** The newest work (assessor guide, quality report, publish gate, candidate package)
   is backend only.
6. **Hosted is three phases behind.** 18 migrations wait for approval.
   - Today's PostgreSQL 17 rehearsal applied, rolled back and reapplied all 18 cleanly, the two newest included.
   - It then stopped at a stale post-change check, so its security checks and full rollback didn't run.
7. **The tests aren't green on the newest branch.** 7 failures (5 API end-to-end, 1 browser, 1 rehearsal check). All were traced to
   test code written without a local stack, not to the product (section I.1). Fix them before anything else.

## B. Feature status matrix

Status values follow the brief. Paths are relative to the repository root. "Tests" names the suites and points to section I.1 for
their results.

### B.1 Career intelligence

| Feature | Frontend | Backend | Database | Integration | Tests | Status |
|---|---|---|---|---|---|---|
| CV upload (PDF, DOCX; 10 MB; content check; file name not kept) | `profile/page.tsx`, `components/profile.tsx` | `POST /v1/me/cv` (`me/me.controller.ts`) | `cv_documents`, private bucket `candidate-documents` | Storage | `foundation.e2e-spec.ts` "accepts only real PDF or Word files…", `cv-process.spec.ts`, browser `candidate-journey.spec.ts` | IMPLEMENTED & VERIFIED |
| Text extraction: PDF, DOCX, scanned PDF (OCR `ara+eng`) | — | `services/ai/midan_ai/cv.py` `extract_text`, `_pdf_ocr` | — | Local `tesseract` | `test_cv_privacy.py` | VERIFIED for PDF, DOCX and English OCR. **Arabic scans not verified**: this Mac's `tesseract` has no `ara` pack |
| Privacy pipeline (personal fields apart, allowlisted sections, redaction, second check, blocking) | — | `cv.py`, `privacy.py` | `cv_analyses` (candidate only) | — | `test_cv_privacy.py`, `foundation.e2e-spec.ts` CV block | IMPLEMENTED & VERIFIED |
| Queued analysis (no in-process run) | Status on `profile/cv/[id]` | `jobs-queue/worker.ts`, `cv.controller.ts` | `background_jobs`, `enqueue_background_job` | — | `foundation.e2e-spec.ts` queue cases, `security_phase1.sql` | IMPLEMENTED & VERIFIED. `docs/privacy/cv-data-flow.md` "Known limits" still says the analysis runs inside the API process; that line is out of date |
| Structured extraction: experience, education, projects, skills, courses, certifications, summary, years | Review screen `profile/cv/[id]` | `cv.py` `local_proposal` (line split) or `external_proposal` (model, strict schema) | `cv_analyses.professional` until approved | Gemini/OpenAI | `test_cv_privacy.py` (local); model path only with stand-ins | Local reading VERIFIED. Its quality is low: each line becomes one item, with no dates or organizations. Model path **BLOCKED BY MISSING CREDENTIALS** |
| Languages, achievements | — | Not in `Proposal` (`cv.py`). The "languages" section is kept by the redactor but never mapped | — | — | — | NOT IMPLEMENTED |
| Technical vs general skills from the CV | Skill picker separates kinds for workbook skills | CV skills are one flat list, saved to `self_reported_skills` | `candidate_profiles.self_reported_skills` | — | — | PARTIALLY IMPLEMENTED: the kind appears only once a skill is matched to a workbook skill |
| Strengths, missing skills, CV quality feedback, recommendations, evidence per skill | — | — | — | — | — | NOT IMPLEMENTED for the CV. (Gaps against a target role exist separately; see "Target career") |
| Candidate approves before anything is saved | `profile/cv/[id]/page.tsx` | `POST /v1/me/cv/analyses/:id/apply`, `…/dismiss` | `candidate_profiles` | — | `foundation.e2e-spec.ts`, browser journey | IMPLEMENTED & VERIFIED |
| Matching CV skills to the workbook reference | Skill suggestions on profile | `GET /v1/me/skill-suggestions` | `reference_skills`, `candidate_reference_skills` | — | `foundation.e2e-spec.ts` | IMPLEMENTED & VERIFIED. Exact or partial Arabic name match only |
| Reuse in applications | Apply page attaches a CV copy | `POST /v1/jobs/:id/applications`, share-CV | `applications.profile_snapshot`, `cv_snapshot_path` | — | `foundation.e2e-spec.ts`, `security_phase1.sql` | Snapshot taken: VERIFIED. **Not used by employer views**; see C-1 |
| Target career | `development/page.tsx` (`CareerTargetPicker`) | `PUT /v1/me/career/target`, `GET /v1/me/career`, `GET /v1/reference/job-families` | `career_targets`, `reference_skill_contexts` | — | `foundation.e2e-spec.ts` career block, browser journey | IMPLEMENTED & VERIFIED, with limits: a sector plus a workbook job family (Arabic), not a job title; technical skills only; first 40 skills; posted jobs' requirements aren't used |
| Courses and certifications | `development/page.tsx`; admin `admin/learning/page.tsx` | `GET/POST /v1/admin/learning-resources`; plan `POST /v1/me/career/plan` refuses a course without a resource | `learning_resources` (https link and verification date required), `career_plan_items` | — | `foundation.e2e-spec.ts` (plan refuses an unverified course) | IMPLEMENTED; **empty by design**: no rows, no AI suggestions, nothing invented. The screen says no verified catalogue exists. The "why" is one fixed sentence per skill. No edit or delete for resources |
| Practical projects | "Practical project" button on each gap | `POST /v1/me/career/plan` `kind: project` | `career_plan_items` | — | `foundation.e2e-spec.ts` | PARTIALLY IMPLEMENTED: a self-reported label only. No brief, submission, evaluation, feedback or demonstrated skill. Simulated work isn't distinguished from real experience |
| Plan progress | `PlanItemControls` | `PATCH/DELETE /v1/me/career/plan/:id` | `career_plan_items.status` | — | `foundation.e2e-spec.ts` | IMPLEMENTED & VERIFIED (self-reported, and labelled so) |
| Demonstrated strengths and needs | `development/page.tsx` | `GET /v1/me/career` | `skill_scores` (released only) | — | `foundation.e2e-spec.ts` | IMPLEMENTED & VERIFIED for MIDAN's own skill framework. **Workbook skill percentages (`reference_skill_scores`) aren't used here or in matching** |
| Job match | Opportunity page, dashboard | `GET /v1/me/jobs/:id/match`, `GET /v1/me/recommended-jobs` (`calculateMatch`) | job and candidate skills | — | `foundation.e2e-spec.ts` | IMPLEMENTED & VERIFIED: a defined ratio of required skills with evidence, marked assessed or self-reported, never a prediction |

### B.2 Recruitment workflow

| Feature | Frontend | Backend | Database | Integration | Tests | Status |
|---|---|---|---|---|---|---|
| Create and manage jobs, requirements, skills | `organization/[orgId]/jobs/[jobId]`, `requirements.tsx`, `job-analysis.tsx` | `organizations.controller.ts`, `requirements.controller.ts`, `analysis.controller.ts` | `jobs`, `job_requirements`, `job_skills`, `job_reference_skills` | AI job analysis (demo without key) | `pipeline.e2e-spec.ts`, `phase3.e2e-spec.ts`, browser | IMPLEMENTED & VERIFIED |
| Job listings from authorized sources, conversion to jobs | `admin/listings`, organization listings | `admin.controller.ts` preview/import/convert | `job_listings`, `jobs.source_listing_id` | — | `phase3.e2e-spec.ts`, `listing-file.spec.ts` | IMPLEMENTED & VERIFIED. **No real listing data exists** |
| Browse and apply | `opportunities/*` | `jobs.controller.ts` | `applications` | — | `pipeline.e2e-spec.ts`, browser | IMPLEMENTED & VERIFIED |
| AI analysis of an applicant's CV against the job | — | — | — | — | — | NOT IMPLEMENTED. Employers see listed vs required skills only |
| Job-specific assessment assigned on applying | `experience/*` | `private.assign_published_assessments`, `attempts.controller.ts` | `assessment_attempts` | — | `foundation.e2e-spec.ts`, browser | IMPLEMENTED & VERIFIED |
| Evaluation (rubric, evidence, always human-reviewed) | `organization/[orgId]/review/[attemptId]` (`review.tsx`) | `evaluations.controller.ts`, `services/ai/midan_ai/evaluation.py` | `evaluation_results`, `criterion_scores`, `skill_scores`, `reference_skill_scores`, `evaluation_reviews` | Model for open answers | `test_graphs.py`, `test_evaluation_language_and_workbook_skills.py`, `pipeline.e2e-spec.ts`, live journey (stand-in) | VERIFIED with stand-ins and in demo mode. Real model **BLOCKED BY MISSING CREDENTIALS** |
| Applicant review screen | `organization/[orgId]/applicants/[applicationId]` | `GET /v1/applications/:id/profile`, `…/cv-url` | `candidate_profiles` (live), `applications` | — | `foundation.e2e-spec.ts`, browser | PARTIALLY IMPLEMENTED. Has: profile, skills (listed vs required), experience, education, the shared CV copy, links to submitted work, interviews and outcomes. Missing: structured CV analysis, CV-to-job relevance, assessment results on the page, status history, application notes |
| Compare applicants for one job | Job page table | `GET /v1/organizations/:orgId/jobs/:jobId/report` | `assessment_attempts`, `evaluation_results`, `skill_scores` | — | `foundation.e2e-spec.ts` (compare) | IMPLEMENTED & VERIFIED: overall score and skill levels, grouped by version. Workbook skill percentages aren't in it |
| Shortlist | `HiringPanel`, status actions | `PATCH /v1/applications/:id/status` → `public.set_application_status` | `applications`, `application_status_history` | — | `foundation.e2e-spec.ts`, `security_phase1.sql` | IMPLEMENTED & VERIFIED |
| Un-shortlist | — | `manual_status_change_allowed` allows shortlisted → rejected only | — | — | — | NOT IMPLEMENTED (only by rejecting) |
| Candidate notified of shortlist or rejection | — | No trigger on status changes | `notifications` | Email: none | — | NOT IMPLEMENTED. The candidate sees the new status on the application page |
| Status history | Candidate's application page only | `GET /v1/me/applications/:id` | `application_status_history` | — | `foundation.e2e-spec.ts` | IMPLEMENTED & VERIFIED for candidates. Not shown to employers |
| Reopening a rejected application: owner or admin, audited | Status actions (`canReopenApplications`) | `set_application_status` | `audit_logs` | — | `security_phase1.sql`, `foundation.e2e-spec.ts` | IMPLEMENTED & VERIFIED |
| AI never decides | — | Evaluations wait for a person; outcomes are written by staff | — | — | `test_graphs.py`, e2e | VERIFIED: nothing rejects or hires automatically |
| Interview scheduling | `HiringPanel` | `POST /v1/organizations/:orgId/applications/:applicationId/interviews`, `PATCH …/interviews/:id`, `POST /v1/interviews/:id/respond` | `interviews`, `interview_events` | Calendar | `foundation.e2e-spec.ts` interview block | IMPLEMENTED & VERIFIED locally. **No shortlist requirement**; no interview type (video only); no availability check |
| Interview feedback | — | — | — | — | — | NOT IMPLEMENTED. Status can only become `completed` or `no_show` |
| Final decision | `HiringPanel` | `POST …/applications/:applicationId/outcome` | `hiring_outcomes`, `private.apply_outcome` | — | `foundation.e2e-spec.ts`, `security_phase1.sql`, live journey | IMPLEMENTED & VERIFIED: a hire needs a shortlist and reviewed assessments, and is final |
| Candidate sees status and decision | `applications/[id]`, `dashboard`, `notifications` | `GET /v1/me/applications/:id`, `GET /v1/me/notifications` | `notifications` (in-app) | — | `foundation.e2e-spec.ts`, browser | IMPLEMENTED & VERIFIED (in-app only) |
| Team, invitations, employer claims | `organization-team.tsx`, `invitations`, `admin/claims` | `team.controller.ts`, `employer-claims.controller.ts` | `organization_invitations`, `employer_claims` | Email: none | `phase3.e2e-spec.ts`, browser `phase3.spec.ts` | IMPLEMENTED & VERIFIED. Invitations aren't emailed |

### B.3 Interview integrations

| Feature | Frontend | Backend | Database | Integration | Tests | Status |
|---|---|---|---|---|---|---|
| Google Calendar event on schedule, change, cancel | Status shown in `HiringPanel` and `interviews/[id]` | `interviews/video-and-calendar.ts` `CalendarClient`, `syncCalendar` | `interviews.calendar_status`, `calendar_event_id` | One MIDAN calendar, refresh token in environment | `foundation.e2e-spec.ts` "reports calendar results as they happened" (stand-in) | BLOCKED BY MISSING CREDENTIALS. Backend works against a stand-in |
| Calendar OAuth per employer, token storage and refresh | — | Access token fetched from one refresh token on every call | — | — | — | NOT IMPLEMENTED (single shared calendar by design) |
| Availability (free/busy) | — | — | — | — | — | NOT IMPLEMENTED |
| Meeting link in the event | — | Link to MIDAN's interview page in the description; no `conferenceData` | — | — | Stand-in test | IMPLEMENTED (as a page link) |
| Duplicate events, sync, webhooks | — | Event id reused on update. A failed create retried later creates a new event | — | — | — | PARTIAL: no idempotency key, no push channel |
| Time zones | Interview page | `time_zone` stored, default `Asia/Riyadh`, sent to Google | `interviews.time_zone` | — | e2e checks the default | IMPLEMENTED; value isn't validated as an IANA zone |
| Daily.co private room and token | `interviews/[id]/page.tsx`, `components/daily-room.tsx` (Daily Prebuilt, real SDK) | `DailyClient.ensureRoom` (private, expires at join window close), `token` (per user, at most 2 hours) | `interviews` | Daily.co | `foundation.e2e-spec.ts` "checks who and when before issuing a short-lived token…" (stand-in) | BLOCKED BY MISSING CREDENTIALS. Real client code, not a mock |
| Who may join | — | Candidate: only after accepting, inside the window. Staff: **any member of the organization**, any role | — | — | Same e2e | PARTIAL: invited participants aren't modelled |
| Meeting start and end | — | Leaving changes nothing; staff set completed | `interview_events` | No Daily webhooks | e2e | PARTIAL by design |

### B.4 Assessment intelligence

| Feature | Frontend | Backend | Database | Integration | Tests | Status |
|---|---|---|---|---|---|---|
| Reference library | — | — | — | — | — | Documentation only: `docs/assessment/REFERENCE_LIBRARY_INVENTORY.md`. The packages stay with the owner, never in the repository |
| MIDAN Assessment Standard (MAS-1.0): nine job families, 52 rules | — | `services/ai/midan_ai/standard.py` | — | — | `test_assessment_standard.py` | IMPLEMENTED & VERIFIED |
| Company type, sector and level in generation | **No screen sets the company type** | `PATCH /v1/organizations/:orgId/company-type`, `assessment-quality.ts` | `organizations.company_type` | — | `assessment-quality.spec.ts`, `assessment_intelligence.sql` | BACKEND ONLY |
| Job-specific generation (model package, template fallback labelled demo) | `workspace.tsx` | `POST …/jobs/:jobId/assessment/generate`, `assessment_builder.py`, `package.py` | `assessment_versions`, `assessment_tasks`, `rubric_criteria` | Gemini/OpenAI | `test_model_generation.py`, `test_assessment_standard.py`, live journey (stand-in) | VERIFIED with stand-ins. Real model **BLOCKED BY MISSING CREDENTIALS** |
| Candidate-facing brief and materials | Instructions shown; **`candidate_package` materials not rendered**; no way to attach material files | `GET /v1/experience/...` strips rubric and skill links | `assessment_versions.candidate_package` | — | Live journey checks no rubric or answer key reaches the candidate | PARTIALLY IMPLEMENTED |
| Assessor guide, answer keys apart | **No screen** | `GET/PUT …/assessment-versions/:versionId/guide` | `assessment_assessor_guides` (staff only), `rubric_criteria.answer_key` | — | `assessment_intelligence.sql` | BACKEND ONLY |
| Quality evaluator and publish gate | **No screen**; publishing returns a 422 summary | `POST/GET …/quality`, `quality.py`, `POST /quality/evaluate` | `assessment_quality_reports`, trigger `quality_gate` | — | `test_assessment_standard.py`, `assessment_intelligence.sql`, `database-exception.filter.spec.ts` | BACKEND ONLY (verified in the database and AI service) |
| Editing policy: every change recorded with who, when, action, before and after, version, reason; reviewed before approval | `change-review.tsx`, reason fields in `workspace.tsx` | `…/changes`, `…/review`, `publish` with `reviewed_through`, `…/revise` | `audit_logs` via `write_assessment_audit`, `assessment_change_reviews`, `assessment_version_snapshots` | — | `assessment_editing_policy.sql`, `foundation.e2e-spec.ts` editing policy block (first run today) | IMPLEMENTED & VERIFIED in the database suite. The API block failed 4 of 8, all from a test fault (I.1); its browser test has a stale selector |
| Publishing, versioning, immutability, attempts keep their version | Approve and revise buttons | `guard_version`, `guard_version_content`, `create_assessment_revision` | `assessment_versions`, `assessment_attempts.version_id` | — | `assessment_editing_policy.sql`, `foundation.e2e-spec.ts` | IMPLEMENTED & VERIFIED |
| Separate generation and evaluation engines; one contract for Gemini and OpenAI | — | `providers.py` `JsonLLMProvider`, graphs A and B | — | Gemini/OpenAI | `test_model_generation.py` (both wire formats, stand-ins) | VERIFIED with stand-ins only |

## C. Candidate journey

| # | Step | Works? | Where it breaks or thins out |
|---|---|---|---|
| 1 | Create an account | Yes, behind the development access code (`private.guard_signup`). Email verification and password reset work (forms suite) | Public registration is closed until the owner opens it, as decided. Google sign-in has no OAuth client |
| 2 | Upload a CV | Yes: PDF or DOCX, content-checked, private | No DOC, image or LinkedIn import |
| 3 | Extraction and analysis | Extraction and redaction yes. Analysis is only organizing sections | No model key, so each line becomes one item. No languages, achievements, strengths, gaps, feedback or evidence. Arabic scans untested |
| 4 | Choose a target job | Yes, as sector plus workbook job family | Not a job title; general skills excluded; posted jobs' requirements not used |
| 5 | Courses and practical projects | Plan items can be saved and tracked | No verified courses exist; projects are labels with no content or feedback |
| 6 | Apply | Yes, with a profile snapshot and a CV copy | — |
| 7 | Assessment assigned | Yes, the newest published version | Generation is template-based without a key; candidate materials (data files) can't be attached |
| 8 | Complete it | Yes: saved answers, file evidence, server timer, one submission | — |
| 9 | Evaluation | Yes, started by a reviewer and always reviewed by a person | Not started automatically on submission. Open answers get no model proposal without a key |
| 10–16 | Employer side, then the candidate's view of the outcome | See D | The candidate learns of a shortlist or rejection only by opening the application; interviews and decisions do send in-app notifications. Development recommendations don't change after an assessment unless MIDAN-framework skills were scored |

## D. Employer journey

| # | Step | Works? | Missing |
|---|---|---|---|
| 1 | Create and manage a job | Yes, including AI job analysis (demo without a key) and requirements | — |
| 2 | Candidates apply | Yes | — |
| 3 | CV and application analysis | **No** | Employers see the profile and listed skills against required ones. No CV-to-job relevance and no structured CV analysis |
| 4 | Job-specific assessments | Yes | Assessor guide and quality report have no screens |
| 5 | Evaluation | Yes, with evidence and explanations per criterion | Real model untested |
| 6 | Review the candidate | Partly | Results aren't on the applicant page (one link per submission). No employer notes on the application, no status timeline. The live profile is shown instead of the snapshot (F.1) |
| 7 | Shortlist | Yes | No un-shortlist; no candidate notification |
| 8 | Invite to interview | Yes, for any non-withdrawn application | No shortlist requirement, no interview type, no availability. Calendar and video untested for real |
| 9 | Interview feedback | **No** | Nothing to record it in |
| 10 | Final decision | Yes, with the hire rules the owner approved | — |

## E. Integration audit

| Dependency | What exists | What's needed to verify | Finding |
|---|---|---|---|
| **Gemini / OpenAI** | One provider contract for CV structuring, job analysis, generation and scoring (`providers.py`); stand-in tests for both wire formats | A key and model name in the owner's local `.env` (never in chat); `MIDAN_REAL_PROVIDER_TESTS=1` | Never called. Provider terms (retention, training) to be reviewed before use (`cv-data-flow.md`) |
| **Google Calendar** | `CalendarClient`: one calendar, refresh token from the environment, events with attendees and `sendUpdates=all`, delete on cancel, status reported honestly | A Google Cloud OAuth client, a refresh token for the MIDAN calendar, `GOOGLE_CALENDAR_ID` | Single shared calendar; no per-employer connection, no free/busy, no `conferenceData`, no push notifications. A reschedule by another staff member replaces the original interviewer in the attendee list (attendees are the candidate plus whoever saved last) |
| **Daily.co** | Private rooms, per-user tokens up to two hours, join window, Daily Prebuilt embed, CSP allowing `*.daily.co` | `DAILY_API_KEY` | Any staff member of the organization can get a token. Nobody is room owner. No webhooks; rooms expire but aren't deleted |
| **File processing** | `pypdf`, DOCX XML, `pypdfium2` and `tesseract` OCR, size and page limits | `tesseract` `ara` language pack for Arabic scans | Works locally; Arabic OCR untested |
| **Storage** | Private buckets `candidate-documents`, `assessment-evidence`, `employer-claims`; signed URLs; policies per file | — | Verified locally and in `security_phase1.sql` |
| **Notifications** | In-app `notifications`, written by database triggers: application received, assessment assigned, submission received, results released, interview invited or changed, hiring decision, deadline soon, team invitation, employer claim | An SMTP or email provider for anything outside the app | No email for any of these. Supabase Auth's own emails (verification, reset) need SMTP on hosted |
| **Background jobs** | `background_jobs` queue with leases, retries and dedupe; worker in the API process (`jobs-queue/worker.ts`) for CV and job analysis | — | Verified. Evaluation isn't queued |
| **Supabase Auth** | Per-request verification (owner decision, no cache), Google sign-in coded but off | OAuth client for Google | As decided |

## F. Critical issues

### F.1 Security and privacy

1. **Employers read the live profile, not the application snapshot (high).**
   - **The API:** `GET /v1/applications/:id/profile` (`applications/applications.controller.ts`) returns `users.candidate_profiles`
     whole, minus `cv_path`. That includes `notification_prefs`, `time_zone`, onboarding fields, `share_profile_consent` and every
     later edit.
   - **The database:** the row level security policy "org reads applicants" on `candidate_profiles` and `candidate_skills`
     (`private.can_view_candidate`) gives the same live rows to any member of the organization, in any role, while any
     non-withdrawn application exists. That covers rejected and hired applications too.
   - **What was meant:** `applications.profile_snapshot` was built at application time to leave those fields out. Only the
     candidate's own view uses it.
2. **Video tokens go to any staff member.** `POST /v1/interviews/:id/join` gives any organization member a token, reviewers
   included, at any time inside the window. "Allow only invited participants" isn't modelled.
3. **Before real candidates** (unchanged from `cv-data-flow.md`): a privacy review under PDPL, retention periods (applications,
   responses and evidence have none), an erasure process, a privacy policy, and data processing agreements with each provider.
   These are outside the code.
4. No other issue found. The Phase 1 controls were re-run today: link isolation, storage scoping, status transition rules, the
   token-in-logs fix and CSP.

### F.2 Functional blockers

1. No real AI, calendar or video credentials. The whole "intelligence" layer runs on fallbacks.
2. No interview feedback record.
3. No screens for the assessor guide, quality report, candidate materials or company type, so the newest assessment work can't be
   used from the app.
4. No verified course catalogue and no authorized job data, so recommendations and real listings are empty.
5. Hosted is 18 migrations behind; nothing new is usable there until the owner approves a window.

### F.3 Data integrity

1. **Two routes to "hired" with different conditions.**
   - A manual status change allows "hired" from `evaluated` (`manual_status_change_allowed`).
   - An interview outcome needs a shortlist, as the owner decided.

   Both need reviewed assessments. See J-3.
2. Interviews can exist for applications that are only `submitted` or even `rejected`; only `withdrawn` is refused
   (`private.guard_interview`).
3. A calendar create that times out after Google saved it leaves no event id, so a retry makes a duplicate.
4. `interviews.time_zone` accepts any string up to 60 characters.
5. Workbook skill scores (`reference_skill_scores`) are recorded but don't count as assessed evidence in matching or career gaps.

### F.4 UX

1. The approval panel shows the "not measured" warning twice: once in MIDAN's checks, once in the coverage list.
1. The applicant page spreads one candidate over several screens (profile, each review, hiring panel) and shows no results inline.
2. Un-shortlisting means rejecting.
3. The change-review screen lists fields by stored name (`title_en`, `answer_key`).
4. The career target list is long and in Arabic only. A job title search would be easier.
5. The CV review shows line-split items without a model, which can look broken to a candidate.

### F.5 Technical debt

1. `GET /v1/me/skill-suggestions` runs up to two queries per skill, for up to 50 skills (up to 100 round trips).
2. `recommendedJobs` loads up to 200 published jobs and scores them in memory on every dashboard load.
3. Job search uses `ilike` on generated `search_text` without a trigram index. That's fine now; at thousands of jobs it needs
   `pg_trgm`.
4. The background worker runs inside the API process; production should run it separately.
5. Learning resources have no edit or delete.
6. `docs/privacy/cv-data-flow.md` still describes in-process analysis.

## G. Development roadmap

Complexity: S (a day or two), M (about a week), L (more than a week).

### P0 — Critical blockers and security

| ID | Task | Why | Depends on | Files | Acceptance criteria | Size | External |
|---|---|---|---|---|---|---|---|
| P0-0 | Make the suites green on the newest branch | Seven test faults (I.1) hide real regressions, and the rehearsal stops before its security checks and full rollback | — | `foundation.e2e-spec.ts` (lines 1593, 1633, 1635: fetch `state()` before building the request), `pipeline.e2e-spec.ts:399` (use a key that differs from the template's, or expect no rubric row), `journeys.spec.ts:887` (scope the selector), `supabase/rehearsal/post_checks.sql` (look for `write_assessment_audit`), `MIDAN_PHASE_2_PREPARATION.md` (16 → 18) | API e2e 153/153, browser 39/39, rehearsal passes to the end, including full rollback to hosted's fingerprint | S | No |
| P0-1 | Employers read the application snapshot, not the live profile | F.1-1: data minimization, and what was agreed at application time | — | `applications/applications.controller.ts`, applicant page, a migration narrowing "org reads applicants" on `candidate_profiles` and `candidate_skills` (with rollback) | Staff see only `profile_snapshot` fields and the skills listed at application; a later profile edit doesn't change what they see; direct Data API reads of `candidate_profiles` by staff return nothing; existing e2e and browser suites pass | M | No |
| P0-2 | Restrict video tokens to the interview's participants | F.1-2 | J-4 | `interviews.controller.ts`, possibly `interviews.interviewer_ids` | A member who isn't a participant gets 403; the candidate rule is unchanged; e2e covers both | S | No |
| P0-3 | Verify real providers | Nothing "intelligent" has been verified | Owner adds keys locally | `services/ai`, `live-journey.live-spec.ts` | Real Gemini or OpenAI run of CV structuring, generation and scoring recorded with results; generated packages pass or fail the quality gate honestly; provider terms reviewed | M | **Yes**: an API key |
| P0-4 | Hosted Phase 2 window for all 18 migrations | Nothing since Phase 1 exists on hosted | Owner approval, backup | `MIDAN_PHASE_2_PREPARATION.md` (to be updated from 16 to 18) | Backup taken; 18 applied in order; `post_checks.sql` all ok; API, web and AI service released together | M | **Yes**: hosted access, owner approval |
| P0-5 | Privacy and legal readiness | F.1-3 | Counsel | `docs/privacy/` | Retention periods implemented as scheduled jobs; erasure process; reviewed consent and privacy text; agreements signed | L | **Yes**: legal review |

### P1 — Core candidate and employer journey

| ID | Task | Why | Depends on | Files | Acceptance criteria | Size | External |
|---|---|---|---|---|---|---|---|
| P1-1 | Interview feedback | Step 14 doesn't exist | P0-2 | New `interview_feedback` table (org-only RLS, audited), `interviews.controller.ts`, `HiringPanel` | A participant records structured feedback per interview; staff of the organization read it; candidates and other organizations can't; edits audited | M | No |
| P1-2 | Interview rules and type | F.3-2, brief §4 | J-1 | `private.guard_interview`, `ScheduleDto`, `HiringPanel` | Scheduling follows the owner's rule on status; type (video, in person, phone) stored and shown; IANA zone validated | S | No |
| P1-3 | Un-shortlist and candidate notifications on status | F.4-2, brief §3 | J-2 | `manual_status_change_allowed`, notification trigger, messages | Shortlisted → under review allowed and recorded; the agreed status changes notify the candidate in both languages | S | No |
| P1-4 | One applicant review page | D-6 | P0-1 | Applicant page, `applications.controller.ts` | Results per assessment (overall, criteria, skill levels, workbook skill percentages) on the page; status timeline; interview history; employer notes on the application (new table, org-only) | M | No |
| P1-5 | Assessment intelligence screens | F.2-3 | — | `workspace.tsx`, `change-review.tsx`, experience page, organization settings | Staff view and edit the guide; quality report with required revisions; candidates see brief and materials; material files attachable and downloadable; company type settable | L | No |
| P1-6 | Start evaluation on submission | Step 9 waits for a reviewer to press a button | — | `jobs-queue/worker.ts`, `evaluations.controller.ts` | Submitting queues an evaluation; result still waits for a person; retries and failures visible to the admin queue | M | No |
| P1-7 | Email delivery | Notifications and invitations reach no one outside the app | J-6 | API mailer, Supabase Auth SMTP | Interview invitations, decisions and team invitations emailed; failures recorded, never claimed as sent | M | **Yes**: SMTP provider |
| P1-8 | Real Google Calendar | Brief §4 | P1-2, J-5 | `video-and-calendar.ts` | Event created, moved and cancelled in a real calendar; meeting link present; Asia/Riyadh correct; no duplicate on retry (idempotency via `extendedProperties.private`) | M | **Yes**: Google OAuth client |
| P1-9 | Real Daily.co | Brief §5 | P0-2 | `video-and-calendar.ts`, `daily-room.tsx` | Both sides join a private room with tokens; expired token refused; interviewer is room owner | S | **Yes**: Daily key |

### P2 — Career intelligence

| ID | Task | Why | Depends on | Files | Acceptance criteria | Size | External |
|---|---|---|---|---|---|---|---|
| P2-1 | Richer CV extraction | B.1 gaps | P0-3 | `cv.py` `Proposal` and prompt, review screen, profile columns | Languages, achievements, skill kind and a quoted evidence line per skill; Arabic and English fixtures pass; candidate still approves everything | M | Model key for quality |
| P2-2 | CV feedback without a score | Brief §2A | P2-1, P2-3 | AI service, `profile/cv/[id]` | Strengths, gaps against the target role, writing and structure feedback and recommendations, each tied to evidence; no overall CV score | M | Model key |
| P2-3 | Job titles for targets | Brief §2B | J-6 | `career.controller.ts`, a curated title list mapped to workbook families | Choosing "Data Analyst" maps to defined families; gaps include general skills and published jobs' requirements for that title | M | Owner-approved title list |
| P2-4 | Workbook skill scores as evidence | F.3-5 | — | `candidateEvidence`, `career.controller.ts`, compare report | Released workbook percentages count as assessed (threshold agreed); compare shows them | S | No |
| P2-5 | Verified learning catalogue | Brief §2C | J-7 | `learning_resources`, admin screen | Real entries with checked links and dates; edit and retire; each says which skill and why | M | **Yes**: authorized course data |
| P2-6 | Practical projects | Brief §2D | P1-5, J-8 | Reuse the generation engine for a "practice" kind; new tables for practice attempts | Briefs per gap, labelled simulated; submission, evaluation and feedback; demonstrated skills recorded as practice evidence, never as employment | L | Model key |
| P2-7 | CV-to-job relevance for employers | D-3 | P0-1 | Applicant page | A defined calculation like `calculateMatch` over the snapshot, explained, never a ranking or rejection | S | No |

### P3 — Improvements and hardening

| ID | Task | Size | External |
|---|---|---|---|
| P3-1 | Calendar: free/busy, `conferenceData`, push notifications, keep the original interviewer as attendee | M | Google |
| P3-2 | Daily: webhooks into `interview_events`, delete expired rooms | S | Daily |
| P3-3 | Batch `skill-suggestions`; cache or index recommended jobs; `pg_trgm` on `search_text` | S | No |
| P3-4 | Run the worker as its own process; health and metrics | M | Hosting |
| P3-5 | Friendly field names in change review; Arabic narrative for guides (J-9) | S | No |
| P3-6 | Arabic OCR pack and tests with Arabic scans | S | No |
| P3-7 | Update `cv-data-flow.md`, Phase 2 doc (18 migrations) | S | No |

## H. Recommended implementation sequence

1. **New branch `midan-platform-p0`** from `feature/midan-assessment-intelligence-handoff` (`4487597`), or from
   `midan-platform-audit` to carry this report.
2. **P0-0 first**, so every later change is measured against green suites. Then **P0-1 and P0-2**, with their migrations rehearsed (`scripts/rehearse-migrations.sh`). Both are small, need nothing external,
   and change data access, so they come before any new screen reads candidate data.
3. **In parallel, owner actions:** keys for P0-3, decisions in J, counsel for P0-5. None of this blocks steps 2 and 4.
4. **P1-2 and P1-3** (rules and notifications), then **P1-1** (feedback, which needs P0-2's participant model), then **P1-4** (one
   review page, which needs P0-1's snapshot reads and P1-1's feedback).
5. **P1-5**, then **P1-6**: assessment screens before automatic evaluation, so staff can see what they approve.
6. **P0-4, the hosted window**, once steps 2–5 are rehearsed together. Releasing them in one window avoids a second API/schema
   coordination.
7. **P1-7 to P1-9** as each credential arrives. Each is independent.
8. **P2** in order: P2-4 (no dependencies), P2-1 → P2-2, P2-3, P2-7, then P2-5 and P2-6 once their data and decisions exist.
9. **P3** alongside, as capacity allows.

Don't parallelize steps 2 and 4: P1-1 and P1-4 build on the access model from step 2.

## I. Testing plan

### I.1 Results of today's run

Branch `midan-platform-audit` at `4487597` (code identical to `feature/midan-assessment-intelligence-handoff`). macOS, Node 22,
PostgreSQL 16 local stack, AI service in demo mode unless stated.

| Check | Command | Result |
| --- | --- | --- |
| Local database | `scripts/local-db.sh start` | Applied the branch's 2 new migrations (`20261107150000`, `20261107160000`) |
| Lint and type checks | `npm run lint` | **Passed** |
| Database: Phase 1 security | `psql -f supabase/tests/security_phase1.sql` | **All passed** |
| Database: editing policy | `psql -f supabase/tests/assessment_editing_policy.sql` | **All passed** |
| Database: assessment intelligence | `psql -f supabase/tests/assessment_intelligence.sql` | **All passed** |
| AI service | `uv run pytest -q -rs` (with the Postgres checkpointer) | **172 passed, 5 skipped**: 2 real-provider tests (no keys), 2 tests needing the private benchmark guide in `.local/`, 1 needing Arabic OCR |
| API unit | `npm test -w @midan/api` | **73 / 73** |
| Web unit | `npm test -w @midan/web` | **23 / 23** |
| API end-to-end | `npm run test:e2e -w @midan/api` | **148 / 153. 5 failures, all in tests, none in the product** (below) |
| Bundle secret scan | canary build + `npm run check:bundle` | **Clean**, 1,033 files |
| Browser, production build, CSP reporting | `npx playwright test` | **38 / 39. 1 failure, a selector** (below). CSP: only the 2 deliberate control reports |
| Forms | `npm run test:forms -w @midan/web` | **9 / 9** |
| Live journey, **stand-in** OpenAI | `npm run test:live -w @midan/api` | **4 / 4**. Proves the plumbing, not a real model |
| PostgreSQL 17 rehearsal, non-superuser | `scripts/rehearse-migrations.sh` | **All 18 migrations applied, rolled back to an identical schema, roles and data, and applied again.** Then stopped at one stale post-change check (below), so the security checks and full rollback in the same script **didn't run** |

**The seven failures.** The editing policy's end-to-end tests were written but never run by their author, who had no local stack.
Each failure was reproduced and traced:

| Failure | Cause | Product bug? |
|---|---|---|
| `foundation.e2e-spec.ts` editing policy: "refuses editing to other roles…" and "approves only after an owner or admin reviews…" (`TypeError: Cannot read properties of null (reading 'address')`) | The test runs a second request (`await state()`) while building the first one (lines 1593, 1633, 1635). Supertest closes the shared server when the inner request ends | No: test fault |
| Same block: "never changes an approved version" (200, expected 422) and "changes an assessment candidates already take…" (no attempt) | Knock-on effects: the version was never approved because the test before it failed | No |
| `pipeline.e2e-spec.ts:399` expects an `update` audit row for the answer key | The template's key is already `{q1: b, q2: a}`, exactly what the test sets, so nothing changes and the new trigger rightly records nothing. The question text edit is recorded on the task (checked in the database) | No: stale expectation |
| `journeys.spec.ts:887` strict-mode violation | The new change-review panel repeats the "not measured" warning inside a status region, so the selector matches two elements | No, though the duplicate warning is worth tidying (F.4) |
| Rehearsal post-check "Edits to assessment drafts are audited" | It looks for triggers named `write_audit`, which `20261107150000` deliberately replaced with `write_assessment_audit` | No: stale check |

**So:** the product passed every check today. The test suites aren't green on this branch, and a hosted window must not open until
they are (P0-0).

### I.2 What the complete journey needs

1. **One end-to-end spec for the whole journey** (`apps/api/src/journey.e2e-spec.ts`), with fictional fixtures only:
   - register with the development code, verify email (mail sink), upload generated Arabic and English CVs (PDF and DOCX), approve
     the analysis, match skills, set a target, save a plan item;
   - apply, complete the assessment, evaluate, review and release;
   - compare, shortlist, schedule (calendar stand-in), join (Daily stand-in), record feedback, decide;
   - the candidate's status, notifications and development page.
2. **Access checks at every step:** the candidate, another candidate, another organization, each organization role and an
   anonymous caller, through both the API and the Data API.
3. **Browser tests** for each screen in Arabic (RTL) and English (LTR), light and dark, with CSP reporting on.
4. **Contract tests with stand-ins** for Gemini, OpenAI, Google and Daily that check each request's body as well as its response.
5. **Real smoke tests**, skipped unless enabled: `MIDAN_REAL_PROVIDER_TESTS=1`, and new `MIDAN_REAL_CALENDAR_TESTS` and
   `MIDAN_REAL_DAILY_TESTS`. They use a test calendar and fictional attendees only.
6. **Database suites** (`supabase/tests/*.sql`) for every new table and rule, and the PostgreSQL 17 rehearsal for every migration.
7. **Privacy regression:** no personal field in AI payloads or logs (extend `test_cv_privacy.py`), and nothing assessor-only in any
   candidate response (extend the live journey's checks to `candidate_package` and the guide).

## J. Open decisions

Only questions that need the product owner. Approved decisions are not reopened: editing policy, CV sharing without a snapshot,
reopening rules, hire through an outcome needs a shortlist, no Auth cache, `TRUST_PROXY` unset, registration closed, job data only
from authorized sources, workbook skills as percentages, the quality gate only for generated versions.

1. **Interviews and shortlist.** Must a candidate be shortlisted before an interview can be scheduled? The brief's flow says so; the
   code doesn't require it.
2. **Status notifications.** Which status changes the candidate is told about, and in what words, especially rejection.
3. **Manual hire.** Should a manual "hired" status also require a shortlist, as an outcome-hire does (F.3-1)?
4. **Interview participants.** Who may join an interview room: the scheduler, named interviewers, or any staff member?
5. **Calendar model.** One MIDAN calendar for every interview (today), or each organization connects its own Google account?
6. **Email.** Which provider sends MIDAN's email, and from which address?
7. **Target roles.** Workbook job families only, or a curated list of job titles mapped to them? Who maintains it?
8. **Courses.** Who supplies verified courses and certifications? Are any provider partnerships planned? None may be implied until
   they exist.
9. **Practical projects.** Can employers see a candidate's completed practice projects, and how are they labelled?
10. **Interview feedback.** Is it ever shown to the candidate, or always internal?
11. **Retention periods** for applications, assessment responses and evidence (with counsel).
12. **Still open from the assessment intelligence handoff:**
    - may employers edit assessor guides, or only MIDAN;
    - must a guide's narrative be in Arabic;
    - should the candidate-facing benchmark files stay in the public repository? They are fictional, and contain no assessor
      material (checked).
