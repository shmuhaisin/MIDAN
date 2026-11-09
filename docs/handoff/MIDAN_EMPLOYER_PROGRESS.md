# MIDAN — Employer + Admin progress checklist

Branch `feature/midan-employer-experience` (from `feature/midan-teammate-completion` @ `67a0c20`). Updated 2026-11-09.
Statuses: NOT_STARTED · IN_PROGRESS · IMPLEMENTED (code written, checks pass) · VERIFIED (exercised end to end against the
real local stack: real Supabase Auth, database, API, web) · BLOCKED. Nothing is VERIFIED only because code exists.
Feature labels marked *(pre-existing)* were built before this branch; their status here is what was re-checked this session.

| # | Feature | Status | Evidence / affected files | Remaining |
| --- | --- | --- | --- | --- |
| 1 | Inspect repository and branches | VERIFIED | `docs/handoff/MIDAN_EMPLOYER_CURRENT_STATE.md` §1, §4 | — |
| 2 | Employer registration + email verification *(pre-existing)* | VERIFIED | Browser: register → mail sink link → signed-in workspace (2026-11-09) | SMTP for real email (BLOCKED: credentials) |
| 3 | **Organization approval workflow** (re-verified on the owner's machine 2026-11-09, current state §24) (draft → pending_review → approved / changes_requested / rejected; suspended) | VERIFIED | Migration `20261111090000_organization_verification`; `organizations/organization-verification.controller.ts`; `admin/admin-organizations.controller.ts`; e2e `organization-review.e2e-spec.ts` 11/11; browser walk (register → profile → document → submit → admin approves) | Email notice of decisions (SMTP) |
| 4 | Approval gates recruitment (publish, applications, invitations, public listing) | VERIFIED | DB triggers `guard_job_publication_org`, `guard_applicant_org`, `guard_invitation_org`, restrictive RLS on `jobs`; e2e | — |
| 5 | Admin organization review UI (queue, filters, search, detail, documents, decisions, suspension, history, audit) | VERIFIED | `app/[locale]/admin/organizations/**`, `components/verification.tsx`; browser walk | Bulk actions (not required) |
| 6 | Admin overview counts (pending/approved/rejected/suspended/draft orgs, candidates, applications, upcoming interviews) | IMPLEMENTED | `GET /admin/overview` | Browser-checked for the pending queue only |
| 7 | Admin user management *(pre-existing list + platform-admin grant)* | IMPLEMENTED | `GET /admin/users`, `/admin/accounts` | Account suspension of a person (needs Auth admin API: BLOCKED by design decision, see current state §18) |
| 8 | Admin audit log *(pre-existing)* + review actions | VERIFIED | `audit_logs` rows for submit/approve/reject/request_changes/suspend/reactivate (e2e) | — |
| 9 | Employer dashboard *(pre-existing command center)* | IMPLEMENTED | `organization/[orgId]/page.tsx` | Re-walk with real data |
| 10 | Team management *(pre-existing; now gated by approval)* | IMPLEMENTED | `organizations/team.controller.ts`; invitations refused until approved (e2e) | Roles HR Manager / Hiring Manager / Interviewer map onto existing `owner/admin/recruiter/reviewer` + interview participants; new roles need an owner decision |
| 11 | Job creation and editing *(pre-existing wizard)* | VERIFIED (steps 1–2) | Browser, previous session | Steps 3–6 re-walk |
| 12 | **Automatic Arabic ↔ English translation** | IMPLEMENTED (plumbing VERIFIED; real model output BLOCKED) | AI `midan_ai/translate.py` + `POST /translate` (8 tests); API `POST /organizations/:orgId/translate`; web `components/bilingual.tsx`, `lib/translation.ts` (4 tests); browser: typing Arabic → request → "not available here" (no key) | Needs `GROQ_API_KEY`/`GROQ_MODEL` (or Gemini) to see real translations; then browser re-check |
| 13 | Dynamic skills *(pre-existing)* | IMPLEMENTED | `jobs/job-skills.controller.ts` (unchanged) | Browser re-walk |
| 14 | AI assessment generation + editor + reordering *(pre-existing)* | IMPLEMENTED | unchanged | Real inference BLOCKED without AI key |
| 15 | Application dates *(candidate branch adds DB deadline guard)* | IN_PROGRESS | Candidate branch `20261110150000` (not in this branch) | Merge both branches; opening date/time not modelled (owner decision) |
| 16 | Application management / ATS *(pre-existing)* | IMPLEMENTED | `applicants`, `candidates` pages | Browser re-walk |
| 17 | Evaluation + human review *(pre-existing; named failure causes)* | IMPLEMENTED | unchanged | Real model BLOCKED |
| 18 | **Shortlist before interview** | VERIFIED | Migration `20261111100000_interview_requires_shortlist`; e2e foundation "refuses an interview until the candidate is shortlisted" | — |
| 19 | Hiring rules *(pre-existing)* | IMPLEMENTED | `20261107110000_application_decision_rules`: manual hire from shortlisted or evaluated, after assessments are reviewed; outcome-hire needs shortlisted | Brief says manual hire needs no shortlist: today it needs shortlisted **or** evaluated — owner to confirm |
| 20 | Interviews *(pre-existing)* | IMPLEMENTED | `interviews/interviews.controller.ts` | AI interview questions: NOT_STARTED |
| 21 | Google Calendar | IN_PROGRESS | One platform calendar via refresh token (`video-and-calendar.ts`), idempotent event ids, sync status, retry | Per-organization OAuth connection: NOT_STARTED (needs Google OAuth client: BLOCKED credentials) |
| 22 | Notifications | IMPLEMENTED | New kinds `organization_*` (in-app, deduplicated) | — |
| 23 | Reports / analytics *(pre-existing reports page)* | IMPLEMENTED | `organization/[orgId]/reports` | Re-walk |
| 24 | Employer AI assistant *(pre-existing)* | IMPLEMENTED | `assistant` | Real model BLOCKED |
| 25 | Candidate integration contract | IMPLEMENTED | `docs/handoff/MIDAN_EMPLOYER_INTEGRATION_CONTRACT.md` | Candidate developer to review |
| 26 | Demo script follows the review | IMPLEMENTED | `scripts/investor-demo.mjs` | Run it on a fresh database |
| 27 | Configurable local ports + preflight (Windows) | VERIFIED | `scripts/local-ports.mjs` (+ test 4/4), `local-supabase.mjs check`; stack running on 54323/54321/54326 on the owner's machine (current state §24) | — |
| 28 | One-command Windows start-up | VERIFIED | `scripts/local-up-windows.ps1` started AI, API and web and waited for each | — |
| 29 | UTF-8 migrations on Windows | VERIFIED | `local-db.sh` sets `PGCLIENTENCODING=UTF8`; garbled `normalize_arabic` repaired; data checksums match a correct database | — |
