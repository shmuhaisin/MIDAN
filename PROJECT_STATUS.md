# Project status

Only what has been run is marked Tested. The milestone table was last updated 2026-11-05; several of its "Not Started"
rows were since built on `feature/midan-complete-data-jobs-assessment`. The verified state as of 2026-11-07 is in
[docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md](docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md).

## Phase 1 security fixes (2026-11-07, branch `feature/midan-phase-1-security`)

"Tested here" means run on a Windows machine without the local Supabase stack: unit tests, a scratch PostgreSQL 18
with every migration and a stand-in `auth` schema, and the production web build in a browser. The API end-to-end and
browser suites were updated but **not run**: they need the Linux local stack. Nothing was applied to hosted Supabase.

| Finding | Fix | Status |
| --- | --- | --- |
| S1 Staff could read every file in an applicant's folder, including CV copies sent to other employers | Storage policy limited to the CV submitted to the organization | Tested here (database checks, with a control run that fails without the fix). End-to-end test written, not run |
| S2 Staff could set any application status, including hired without a reviewed assessment | `public.set_application_status` with fixed moves; hiring needs reviewed assessments, also through outcomes; direct update revoked | Tested here (database checks, API error mapping, screen/database parity). End-to-end tests written, not run |
| S3 Made-up bearer tokens got their own rate limits | Verified account or trusted address only; `TRUST_PROXY` | Tested here (unit tests) |
| S5 Signed CV link kept in the queue payload | Removed when the job finishes; never logged | Partly: tested here. Signing at run time is waiting for an owner decision on a storage credential |
| S6 AI service token compared with `!=` | `hmac.compare_digest` on bytes | Tested here |
| S7 No security headers | Nonce CSP and headers on web; strict headers on API; HSTS on HTTPS | Tested here (unit tests; production build in a browser, public pages, no CSP violations). Daily interview and Google sign-in under the CSP not checked |
| S8 Sign-up access code in the Next.js `env` map, written into builds | Runtime server variable only; build check script | Tested here (build scanned with a canary value; the check itself proven to catch a planted value) |

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
