# Project status

Only what has been run is marked Tested. The milestone table was last updated 2026-11-05; several of its "Not Started"
rows were since built on `feature/midan-complete-data-jobs-assessment`. The verified state as of 2026-11-07 is in
[docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md](docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md).

## Platform stabilization (2026-11-08, branch `midan-platform-p0`, local only)

P0: employers read application snapshots, never live profiles; only an interview's participants get a video token. The
seven failing tests were traced and fixed (six test faults, one duplicate warning on screen). Added: one applicant review
page, undoable shortlist, in-app notifications for shortlisted, rejected and cancelled interviews, staff notes, interview
feedback, grounded CV analysis (languages, achievements, quoted evidence, rule-based suggestions), target job titles,
practice tasks, quality report and assessor guide screens, candidate materials, and calendar events that can't be
duplicated. Verified locally with the whole stack; **no real AI provider, Google Calendar, Daily.co or email was used**:
no credentials exist here. Hosted is unchanged, with 25 migrations waiting. See
[docs/handoffs/MIDAN_PLATFORM_STABILIZATION_HANDOFF.md](docs/handoffs/MIDAN_PLATFORM_STABILIZATION_HANDOFF.md).

## Phase 1 security fixes (2026-11-07, branch `feature/midan-phase-1-security`)

Verified on 2026-11-07 on branch `midan-security-completion`, with the whole local stack: API end-to-end 113 / 113,
browser 35 / 35, forms 9 / 9. This proves the code on a local stack. It doesn't mean production is ready: real Daily, Google,
AI providers and HTTPS hosting are untested. The branch is pushed but not merged. Nothing was applied to hosted Supabase, where the old S1 and
S2 rules are still live (no applications exist there yet).

| Finding | Fix | Status |
| --- | --- | --- |
| S1 Staff could read every file in an applicant's folder, including CV copies sent to other employers | Storage policy limited to the CV submitted to the organization | Verified locally, end to end |
| S2 Staff could set any application status, including hired without a reviewed assessment | `public.set_application_status` with fixed moves; hiring needs reviewed assessments, also through outcomes; direct update revoked | Verified locally, end to end. Hired is now final for outcomes too |
| S3 Made-up bearer tokens got their own rate limits | Verified account or trusted address only; `TRUST_PROXY` | Verified with a stand-in for Auth. Rejected tokens no longer reach Auth past a budget. `TRUST_PROXY` waits for hosting |
| S4 One Supabase Auth call per authenticated request | Not changed; the limiter and guards now share one call | Accepted trade-off by owner decision: no cache. Failures now give 503 and keep tokens out of logs |
| S5 Signed CV link kept in the queue payload | Kept by owner decision (accepted trade-off): only while the job waits or runs, deleted when it finishes, never logged, not readable through the Data API; an expired link gives `file_unavailable` and a retry | Verified locally, after closing a link leak and an arbitrary-URL fetch in the queue function (handoff B.0b) |
| S6 AI service token compared with `!=` | `hmac.compare_digest` on bytes | Verified locally |
| S7 No security headers | Nonce CSP and headers on web; strict headers on API; HSTS on HTTPS | Verified in a production build across candidate, organization, assessment and admin screens. Real Daily, real Google sign-in and HTTPS not verified |
| S8 Sign-up access code in the Next.js `env` map, written into builds | Runtime server variable only; build check script | Verified locally, with the build scanned using a canary value |

Owner decisions, implemented: reopening a rejected application is for owners and admins, and is audited; hiring through an
outcome needs a shortlist; without a CV snapshot, an employer sees no CV until the candidate shares one. `TRUST_PROXY` stays
unset until hosting is chosen. The external job platform is out of the code and the import. Hosted Supabase is unchanged, with
seventeen migrations waiting for approval. The first sixteen were rehearsed locally on PostgreSQL 17 with their rollback; the seventeenth (the assessment editing policy) was applied and rolled back on a scratch PostgreSQL 18 only. The job-to-review journey works locally, including with a stand-in model, and real providers are still untested: see [docs/handoffs/MIDAN_LOCAL_WORKFLOW_STATUS.md](docs/handoffs/MIDAN_LOCAL_WORKFLOW_STATUS.md) and [docs/handoffs/MIDAN_PHASE_2_PREPARATION.md](docs/handoffs/MIDAN_PHASE_2_PREPARATION.md). See
[docs/handoffs/MIDAN_PHASE_1_SECURITY_HANDOFF.md](docs/handoffs/MIDAN_PHASE_1_SECURITY_HANDOFF.md).

Owner decisions for later phases, in [docs/DECISIONS.md](docs/DECISIONS.md): Gemini and OpenAI behind one provider
interface; hybrid employer management; MIDAN owns assessment design, with the editing policy below.

## Assessment intelligence (2026-11-07, branch `feature/midan-assessment-intelligence-handoff`, pushed, not merged)

The MIDAN Assessment Standard (MAS-1.0), derived from the structure of 22 reference packages (no reference content in the
repository). Generation now receives company type, sector and level, and asks for a full package: candidate brief, materials and
an assessor guide kept apart. A deterministic quality evaluator scores 14 dimensions and recomputes reference figures. Assessor
guides are readable by organization staff only; quality reports are written only by MIDAN's service role; a generated version is
approved only with a `ready` report on its current content (owner decision: only generated versions are gated). Unseen-job
benchmark: Cybersecurity Analyst, authored to the standard and run through the pipeline with a stand-in provider: ready, 98/100.
Tested locally: AI 172 passed / 5 skipped, API 73/73, web 23/23, database suites and rollback passed, builds succeeded. Real
Gemini/OpenAI, end-to-end tests, web screens for the guide and materials, and the hosted migration are not done. See
[docs/handoffs/MIDAN_ASSESSMENT_INTELLIGENCE_HANDOFF.md](docs/handoffs/MIDAN_ASSESSMENT_INTELLIGENCE_HANDOFF.md).

## Assessment editing policy (2026-11-07, branch `midan-assessment-editing-policy`, pushed at `0e0d1ff`, not merged)

Owners, admins and recruiters may add, edit and delete a draft's tasks, questions, instructions, criteria, options and answer
keys. Every change is recorded with its state before and after; an owner or admin reviews the changes beside MIDAN's original
and MIDAN's validation before approving; approved versions never change, and a new version leaves existing attempts alone.
See [docs/handoffs/MIDAN_ASSESSMENT_EDITING_POLICY.md](docs/handoffs/MIDAN_ASSESSMENT_EDITING_POLICY.md).

| Part | Status |
| --- | --- |
| Audit of every create, update and delete, with before and after, actor, organization, version, reason; immutable to employers | Tested on a scratch PostgreSQL 18 (`supabase/tests/assessment_editing_policy.sql`) |
| Review before approval, stale reviews refused, owners and admins only | Tested on the database. API end-to-end tests written, **not run** (they need the Linux/macOS local stack) |
| MIDAN validation (coverage, mapping, rubric, scoring, objective answers, duplicates): errors block, warnings recorded | Tested on the database |
| Generated, revision-base and approved versions kept; published versions immutable; revisions leave attempts alone | Tested on the database. End-to-end tests written, not run |
| Review screen: changes with before and after, coverage-weakening changes flagged, MIDAN's version beside the draft | Unit-tested helpers, type-checked and built. **Not opened in a browser** (needs the local stack) |
| Migration `20261107150000` and its rollback | Applied, and rolled back to an identical schema, on PostgreSQL 18. Not on hosted |

Still open: generation doesn't receive the job's sector or the company's type; provenance has no separate provider field.

| Milestone | Item | Status |
| --- | --- | --- |
| 1 | Design tokens, themes, Arabic and English, RTL and LTR | Tested |
| 1 | Public pages: home, how it works, candidates, organizations, about, FAQ, opportunities, job details | Tested |
| 1 | Public pages: contact, privacy, terms | Not Started (legal pages need review) |
| 1 | ESLint, CI, shared packages, docker-compose | Not Started |
| 2 | Supabase project, 47 tables, RLS, migrations, storage, signed URLs | Tested |
| 2 | Tenant isolation, role permissions, API rate limiting | Tested |
| 2 | Sign-up gate: direct calls refused at the database without the server-held access code | Tested |
| 2 | Profile or organization created automatically on email verification | Tested with real triggers |
| 2 | Tables for occupations and development plans | Not Started |
| 3 | Sessions, candidate dashboard, create organization | Tested |
| 3 | Candidate profile: basics, experience, education, skills, CV upload, replace and removal | Tested |
| 3 | Applicant profile for the organization applied to, ending on withdrawal | Tested |
| 3 | Organization logo, colors, welcome message, industry | Tested |
| 3 | Sign-up and sign-in forms, role redirects, sign-out, session renewal | Tested (forms against a local Auth stand-in; sessions against real Supabase) |
| 3 | A complete real sign-up with a real email and verification link | Implemented, awaiting the owner's own test |
| 3 | Team invitations, role management UI | Not Started |
| 3 | Sharing a profile beyond applications (consent is recorded, sharing isn't built) | Not Started |
| 4 | Job details and skills, browsing, applying, withdrawing, status tracking | Tested |
| 4 | Structured job requirements, employment details, public display | Tested |
| 4 | Linking tasks and rubric criteria to requirements, coverage on the job screen, snapshot at publish | Tested (the screen links tasks; rubric links are API only) |
| 4 | Several assessments per job: drafts, invitations, candidate view, status, comparison | Tested |
| 4 | Assessment drafts built from requirements | Not Started: every draft starts from the same templates, so a second assessment needs editing to differ |
| 4 | CSV and JSON imports, external employers, review queue, AI extraction | Not Started |
| 4 | 30 to 50 reviewed skills, occupations | Not Started (6 draft skills exist) |
| 5 | Assessment drafts, editing, publishing, preview, branded experience, autosave, evidence, submission | Tested |
| 5 | Humaidan by saved professional field (all rule scenarios) | Tested |
| 5 | Manually adding or removing tasks; timing enforcement; expiry | Not Started |
| 6 | Graph A: assessment builder | Tested, template-based: no LLM generates drafts yet |
| 7 | Graph B: evaluation, interrupt and resume, deterministic scoring | Tested in demo mode |
| 7 | Graph B with a real model | Implemented, never run: no API key configured |
| 7 | Production checkpointer | Not Started: uses a local SQLite file |
| 8 | Candidate report, organization review, candidate comparison | Tested |
| 8 | Learning recommendations beyond next-level descriptors; analytics | Not Started |
| 11 | Approved logo and reusable component | Tested on light and dark, phone and desktop |
| 11 | Skills reference and employer registry | Imported and checked against each workbook's stated totals. No proficiency scale or skill IDs exist in the sources |
| 11 | Separation of test and demo data from normal views | Tested |
| 11 | Skills step, CV suggestions, job cards and filters, employer directory | Tested |
| 11 | Password recovery, return path, onboarding | Tested (forms against a local Auth stand-in) |
| 11 | Google sign-in | Implemented, tested against a stand-in. Not switched on: needs an OAuth client. New accounts are refused until registration opens |
| 11 | CV pipeline: extraction, OCR, redaction, outbound check, review | Tested with fictional data. Real AI provider never run: no key. Arabic OCR not run: language pack not installed here |
| 11 | Job filters, match, apply with review, snapshots, application page | Tested |
| 11 | External listings | Implemented with no data: none exist, and none were invented |
| 11 | Deadlines, timers, drafts, receipts, resubmission, results by criterion | Tested. Task materials and accepted formats display if present, with no company screen to enter them |
| 11 | Interviews and Daily Prebuilt | API tested against a stand-in. The embedded call has never run: no key |
| 11 | Google Calendar | Tested against a stand-in, including failures. Never run for real: no credentials |
| 11 | Outcomes, notifications, settings | Tested. Notifications are in-app only: no email sender |
| 11 | Career development | Tested. No course or certification links: no verified catalog exists |
| 11 | Deployment | Not Started: nothing deployed. See docs/deployment.md |
| 9 | Humaidan AI chat | Postponed by the owner until knowledge and instructions are prepared. His visual character stays. |
| 10 | Accessibility audit | Not Started |
