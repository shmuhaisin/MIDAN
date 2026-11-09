# MIDAN — candidate ↔ employer integration contract

Branch `feature/midan-candidate-experience`, created from `feature/midan-teammate-completion` at `67a0c20` (which contains
`b49eb36` and `c678c56`). This records the contract as it **exists in the code today**; nothing here adds fields or statuses.
Anything marked **Coordinate** needs agreement with the employer-side developer before it changes.

## 1. Identity and roles
- One Supabase Auth identity per person; the API verifies the JWT on every request and runs queries as that user under RLS
  (`db.asUser`). Sign-up needs the server-held access code (`DEV_TEST_SIGNUP=true`, `DEV_TEST_ACCESS_CODE`).
- **Account type is decided by records, not by the token:** a candidate profile (`candidate_profiles`) makes a candidate
  account; an organization membership (`organization_members`) makes an organization account. Migration
  `20261109120000_account_type_separation` keeps them exclusive and lets only accounts with a candidate profile apply.
- Candidate pages (`/onboarding`, `/profile`, `/applications`, `/assessments`, `/development`, `/assistant`, `/reports`,
  `/interviews` list, `/opportunities/:id/apply`) send organization accounts to their workspace (`apps/web/src/lib/account.ts`).

## 2. Candidate profile (shared entity)
`candidate_profiles`: full name, headline, summary, city, education, experience, projects, courses, certifications,
self-reported skills (jsonb), CV path, onboarding step, consent. `PUT /me/candidate-profile` upserts it. When a candidate
applies, the database copies a **snapshot** into `applications.profile_snapshot`; employers read the snapshot, never the live
profile. CV analysis (`/me/cv/...`) proposes; the candidate confirms before anything is saved.

## 3. Jobs, skills, discovery
- Public: `GET /jobs` (published only, search and pages), `GET /jobs/:id` (with description, requirements, skills and the
  approved assessment overview). Drafts are never public (404).
- Job skills read by candidates: `job_requirements` (approved), `job_reference_skills` (workbook skills, `is_required`,
  `required_level` L1–L4), `job_custom_skills` (employer's own, per job). `GET /me/jobs/:id/match` returns the candidate's
  own profile against the job, with the semantic proposal per requirement.

### Saved jobs and deadlines (candidate-owned, added 2026-11-10)
- `saved_jobs (candidate_id, job_id, created_at)`: RLS lets a candidate read, add (published jobs only) and remove their own
  rows. `GET /me/saved-jobs`, `PUT /me/saved-jobs/:jobId` (404 for an unpublished job), `DELETE /me/saved-jobs/:jobId`.
- `GET /jobs` hides jobs whose `application_deadline` (a Riyadh date, inclusive) has passed unless `include_closed=1`, and
  accepts `sort=deadline` (soonest first, no deadline last). Default order is unchanged (newest first).
- The database refuses an application after the deadline (trigger `guard_applicant_deadline`, 422). **Employer side:** a
  job with a past deadline stays published but receives no applications; extend the deadline to reopen it.
- Migration `20261110150000_candidate_saved_jobs_and_deadlines`.

## 4. Application
- `POST /jobs/:id/applications` (candidate only, published job only). One application per candidate and job (unique); a
  repeat returns the same application. The DB trigger `assign_published_assessments` assigns the job's **published**
  assessment version(s) on insert; drafts are never assigned.
- Status values (enum `application_status`): `submitted`, `under_review`, `assessment_invited`, `assessment_in_progress`,
  `assessment_submitted`, `evaluated`, `shortlisted`, `hired`, `rejected`, `withdrawn`. History in
  `application_status_history` (real timestamps only). Only the candidate can withdraw.

## 5. Assessment and submission
- Attempts (`assessment_attempts`) link application, version and candidate. The candidate sees the brief, tasks,
  deliverables and materials of **their assigned version** only; the assessor guide and answer keys never reach them.
- Answers: `task_responses` (saved as they go); files: `evidence_files` in the private `assessment-evidence` bucket. Submit
  is final (`submit_attempt`).

## 6. Evaluation and results
- AI proposals per criterion (`criterion_scores`, provenance recorded); criteria the model couldn't score carry
  `model_failed:*` in `evaluation_results.review_reasons` and are scored by a person. Status `needs_human_review` →
  `human_reviewed`. The candidate sees a result only after `released_to_candidate = true` (`GET /attempts/:id/report`),
  never reviewer notes.

## 7. Interviews (candidate portal)
- **Creation (employer):** `POST /organizations/:orgId/applications/:applicationId/interviews`; refused unless the
  application is `shortlisted`. Row `interviews` holds `application_id`, `org_id`, `candidate_id`, `scheduled_at`,
  `duration_minutes`, `time_zone` (default `Asia/Riyadh`), `instructions_ar/en`, `status` (text, default `invited`),
  `reschedule_note`, `daily_room_name/url`, `calendar_status`, plus `interview_events` (history) and
  `interview_participants`.
- **Candidate visibility:** `GET /me/interviews` (own interviews only) and `GET /interviews/:id` (candidate or a member of the
  organization). Web: `/[locale]/interviews` (list) and `/[locale]/interviews/[id]` (details, also used by staff).
- **Candidate actions:** `POST /interviews/:id/respond` — confirm, decline or request a new time with a note. A request does
  not change `scheduled_at`; the employer reschedules with `PATCH /organizations/:orgId/interviews/:id`. The allowed
  response values and transitions are the ones validated in `apps/api/src/interviews/interviews.controller.ts`.
- **Joining:** `POST /interviews/:id/join` issues a short-lived Daily token for that interview's room, only for the
  candidate or participants and only around the scheduled time. Without Daily keys there is no room and no join action.
- **Notifications:** in-app (`notifications`) on invitation and changes. **Email is not configured** (no SMTP provider), so
  no invitation email is sent; Google Calendar invitations are sent only with calendar keys and `sendUpdates=none` locally.
- **Feedback:** interview feedback is staff-only. Candidates see only the decision the organization issues
  (`POST .../outcome`), never notes. **Coordinate:** there is no separate "released interview feedback" field today.

## 8. Authorization summary
Every candidate route filters by `auth.uid()` (RLS and controller checks); every organization route calls
`requireRole(tx, user, orgId, ...)`. Cross-tenant and cross-candidate reads return 403/404 (covered by the API e2e suites
`foundation`, `match`, `accounts`, `skills`, and browser `roles.spec.ts`).

## 9. Known gaps for the candidate side (not built yet)
- Saved jobs (no table or API) — **Coordinate** if a schema is added.
- A released-feedback field for interviews — **Coordinate**.
- Email delivery (SMTP credentials), PDPL deletion policy (owner decision).

## 10. Merge instructions
Both branches descend from `67a0c20`. Merge `feature/midan-teammate-completion` into this branch (or the reverse) with a
normal merge, resolve conflicts in shared files (`apps/web/src/messages/*.json`, `apps/api/src/app.module.ts`,
`prisma/schema.prisma`) by keeping both sides, apply migrations in filename order, then run the API e2e and browser
suites before anything goes near `main`.
