# MIDAN — Employer ↔ Candidate integration contract

From the Employer + Admin branch `feature/midan-employer-experience`, for the Candidate branch
`feature/midan-candidate-experience`. Both start from `feature/midan-teammate-completion` @ `67a0c20`. One database, one
API, one Supabase Auth. This lists what the employer side **added or changed** that the candidate side relies on, and what
the candidate contract (`MIDAN_CANDIDATE_INTEGRATION_CONTRACT.md`) states that this branch confirms or corrects.

## 1. Shared entities (unchanged identifiers)
`users`, `organizations`, `organization_members`, `jobs`, `job_*` skills, `applications` (+ `profile_snapshot`,
`application_status_history`), `assessments`/`assessment_versions`/`assessment_tasks`, `assessment_attempts`,
`task_responses`, `evidence_files`, `evaluation_results`, `criterion_scores`, `interviews`, `interview_participants`,
`interview_events`, `hiring_outcomes`, `notifications`. No table, column or status value of these was renamed or removed.

## 2. New: organization review (migration `20261111090000_organization_verification`)
- `organizations.verification_status`: `draft | pending_review | changes_requested | rejected | approved | suspended`
  (+ profile columns: `commercial_registration`, `website`, `business_email`, `contact_phone`, `city`, `description_ar`,
  `description_en`, `representative_name`, `representative_title`). Existing organizations were set to `approved`.
- New tables `organization_documents` (private bucket `organization-documents`) and `organization_verification_requests`.
- **What it means for candidates (enforced in the database):**
  - Only `approved` organizations can publish jobs (`guard_job_publication_org`).
  - `POST /jobs/:id/applications` is refused (**422**) when the job's organization isn't `approved` (`guard_applicant_org`,
    a `before insert` trigger on `applications`; name order: `guard_applicant` → `guard_applicant_deadline` (candidate
    branch) → `guard_applicant_org` → `guard_application`).
  - A **suspended** organization's published jobs disappear from `GET /jobs`, `GET /jobs/:id` (404) and the Data API for
    anon and for candidates who have **not** applied. Candidates who already applied still see the job
    (`private.has_applied_to`), so "My applications" keeps working.
- Candidate UI should treat 422 on apply as "this job isn't open for applications" (the candidate branch already shows a
  deadline message for the same status).

## 3. Changed: interviews need a shortlisted application (migration `20261111100000_interview_requires_shortlist`)
- The candidate contract §7 says creation is "refused unless the application is shortlisted". **Before this branch that
  was not enforced** (only withdrawn applications were refused). It is now: `before insert` trigger
  `guard_interview_shortlist`, **422** otherwise. Existing interviews and rescheduling (`PATCH`) are unaffected.
- Candidate-side reads are unchanged: `GET /me/interviews`, `GET /interviews/:id`, `POST /interviews/:id/respond`
  (`accept | decline | reschedule` with note), `POST /interviews/:id/join`.

## 4. Employer APIs added (all under `/v1`, bearer token)
| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/organizations/:orgId/verification` | org owner/admin | profile, documents, every request and decision |
| PATCH | `/organizations/:orgId/profile` | org owner/admin | names + CR locked while pending/approved/suspended (422) |
| POST | `/organizations/:orgId/verification/documents` | org owner/admin | multipart `file` (PDF/PNG/JPEG by content, ≤10 MB) + `kind` |
| DELETE | `/organizations/:orgId/verification/documents/:id` | org owner/admin | only while editable |
| GET | `/organizations/:orgId/verification/documents/:id/url` | org owner/admin | 5-minute signed link |
| POST | `/organizations/:orgId/verification/submit` | org owner/admin | 422 until complete |
| GET | `/admin/organizations?status=&q=` | platform admin | queue, waiting first |
| GET | `/admin/organizations/:id` | platform admin | detail, members, jobs, requests, audit |
| GET | `/admin/organizations/:id/documents/:docId/url` | platform admin | signed link |
| POST | `/admin/organizations/:id/decision` | platform admin | `approve` / `reject` / `request_changes`; note required except approve |
| POST | `/admin/organizations/:id/suspension` | platform admin | `{ suspend, reason }`, reason required |
| POST | `/organizations/:orgId/translate` | owner/admin/recruiter | `{ source, target, fields:[{key,text}] }` → `{ ok, translations }` or `{ ok:false, reason }` |

## 5. Notifications (in-app, `notifications`, deduplicated by `dedupe_key`)
New kinds: `organization_review_requested` (to platform admins), `organization_approved`, `organization_rejected`,
`organization_changes_requested`, `organization_suspended`, `organization_reactivated` (to the org's owners/admins), all
linking to `/organization/:id/verification` or `/admin/organizations/:id`. Candidate-facing kinds are unchanged.
Both branches add keys to `apps/web/src/messages/*.json`; merge by keeping both sides.

## 6. Calendar references
Unchanged: `interviews.calendar_event_id` (deterministic `midan<uuid-without-dashes>`), `calendar_status`. Per-organization
Google OAuth is **not** built yet; when it is, the candidate side keeps reading the same fields.

## 7. Merge notes
- Migrations in filename order: candidate `20261110150000_*` before employer `20261111090000_*`, `20261111100000_*`.
- `apps/api/prisma/schema.prisma`: both add models at the end — keep both.
- `apps/api/src/app.module.ts`: both register controllers — keep both.
- API e2e suites now approve their test organizations through `apps/api/src/test-support/approve-organization.ts`;
  candidate-branch suites that create organizations and publish jobs must call it too
  (`await approveOrganization(app.getHttpServer(), owner.token, orgId)`), or publishing returns 422.
- Run the full API e2e on a **fresh** database after merging (several older tests assume fresh fixture accounts).
