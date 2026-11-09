# MIDAN — candidate experience progress

Statuses: NOT_STARTED · IN_PROGRESS · IMPLEMENTED (code exists, not walked end to end this round) · VERIFIED (exercised by a
passing automated test or a recorded browser run) · BLOCKED. Update this file after every milestone; the repository, not any
chat, is the source of truth. Current state and next steps: `MIDAN_CANDIDATE_CURRENT_STATE.md`.

| Feature | Status | Where (main files) | Evidence / remaining |
| --- | --- | --- | --- |
| Registration, verification, sign-in, sign-out, recovery, reset, sessions | VERIFIED | `apps/web/src/lib/auth-actions.ts`, `proxy.ts`, `app/[locale]/{register,login,check-email,auth,forgot-password,reset-password}` | Browser auth run 50/50 (2026-11-09); `e2e/journeys.spec.ts` sessions and fresh-account tests. Access code kept. |
| Role routing; candidate pages refuse organization accounts | VERIFIED | `lib/account.ts`, `*/layout.tsx`, migration `20261109120000_account_type_separation` | `e2e/roles.spec.ts`, `apps/api/src/accounts.e2e-spec.ts` |
| Onboarding (guided steps, progress saved) | IMPLEMENTED | `app/[locale]/onboarding`, `components/onboarding.tsx` | Walked 2026-11-09 in the fresh-account test (profile name step). Portfolio/LinkedIn links: NOT_STARTED (no field; needs a shared-schema decision). |
| Profile (education, experience, projects, courses, certifications, languages, skills) | VERIFIED | `app/[locale]/profile`, `PUT /me/candidate-profile` | `e2e/journeys.spec.ts` "a candidate builds a full profile and CV". Reordering sections: NOT_STARTED. |
| CV upload, analysis for review, replace, remove, download | VERIFIED | `app/[locale]/profile/cv`, `apps/api/src/me/cv.controller.ts` | `foundation.e2e-spec.ts` candidate profiles; extraction proposals need the candidate's confirmation. |
| Job discovery: search, sector, location, type, level, employer | VERIFIED | `components/jobs-browser.tsx`, `GET /jobs` | `e2e/phase3.spec.ts` search. |
| Discovery: closed jobs hidden, deadline states, sort by deadline | VERIFIED | `GET /jobs?sort=deadline&include_closed=1`, `lib/deadline.ts` | `candidate-discovery.e2e-spec.ts`, `lib/deadline.test.ts`. "Not yet open" needs an opening date (no field). Work arrangement filter: no field. |
| Saved jobs | VERIFIED (API) / IMPLEMENTED (UI) | migration `20261110150000_candidate_saved_jobs_and_deadlines`, `GET/PUT/DELETE /me/saved-jobs`, `components/save-job.tsx`, `/opportunities?saved=1` | API e2e; browser walk pending. |
| Job details (description, requirements, skills and levels, deadline, assessment, apply) | VERIFIED | `app/[locale]/opportunities/[id]` | `e2e/roles.spec.ts`; closed jobs show "Applications … closed" instead of Apply. |
| Application (one per job, deadline enforced, assessment assigned) | VERIFIED | `POST /jobs/:id/applications`, DB triggers | `roles.spec.ts`, `candidate-discovery.e2e-spec.ts`, `foundation.e2e-spec.ts`. |
| Assessment: brief, tasks, answers saved, files, submit | VERIFIED | `app/[locale]/experience/...`, `components/experience.tsx` | Browser runs 2026-11-09 (Arabic and English); `journeys.spec.ts` MVP journey. |
| Application tracking and timeline | VERIFIED | `app/[locale]/applications`, `applications/[id]` | Uses `application_status_history`; covered by journeys and candidate-journey specs. |
| Released results only | VERIFIED | `app/[locale]/reports/[attemptId]`, `GET /attempts/:id/report` | Reviewer notes never shown (`journeys.spec.ts`). |
| Career journey (role, gaps L0–L4, plan `skill_goal`/`project`/`course`/`certification`, practice) | VERIFIED | `app/[locale]/development/*` | `e2e/candidate-journey.spec.ts`. |
| My Interviews: list, details, accept, request new time, join (Daily) | VERIFIED | `app/[locale]/interviews`, `interviews/[id]`, `components/candidate.tsx`, `apps/api/src/interviews/*` | `recruitment.spec.ts`, `foundation.e2e-spec.ts` interviews. Decline: not supported by `respond_to_interview` (accept, request_reschedule only). Released interview feedback field: NOT_STARTED (coordinate). |
| Notifications (in-app, read/unread) | VERIFIED | `app/[locale]/notifications`, `GET /me/notifications` | Email delivery BLOCKED (no SMTP). |
| Ask MIDAN (candidate assistant) | VERIFIED | `app/[locale]/assistant`, `POST /me/assistant` | Live answers need Groq quota; labelled fallback otherwise. |
| Settings (password, notification preferences, language, theme) | IMPLEMENTED | `app/[locale]/settings` | Account deletion BLOCKED (PDPL retention decision). |
