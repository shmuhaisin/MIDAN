# MIDAN user experience: journeys and information architecture

Branch `feature/midan-full-ui-redesign`, 2026-11-08. Complements `MIDAN_UI_AUDIT.md` (the audit before the redesign).
Principle: every page answers *where am I, what can I do here, what should I do next*.

## 1. Route inventory (60 pages)

New pages are marked ★. Each new page reads only existing API endpoints; no backend change was made.

| Area | Route | Purpose | Data source |
| --- | --- | --- | --- |
| Public | `/` | The World of MIDAN (3D journey), flows, field explorer, levels, audiences | static copy |
| Public | `/about`, `/how-it-works`, `/for-candidates`, `/for-organizations`, `/faq` | Story, process, skill levels, audiences, questions | static copy |
| Public | `/opportunities`, `/opportunities/[id]` | Discovery with filters; job detail with apply panel | `GET /jobs`, `/jobs/external`, `/jobs/:id`, `/me/jobs/:id/match` |
| Public | `/employers`, `/employers/[id]` | Employer registry | `GET /reference/employers[/:id]` |
| Auth | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/check-email`, `/auth/confirmed`, `/auth/callback` | Sign-in, sign-up, recovery, verification | Supabase Auth via server actions |
| Candidate | `/onboarding` | Six guided steps (was four) | `GET /me`, `PUT /me/candidate-profile` (partial), `PATCH /me/onboarding` |
| Candidate | `/dashboard` | Overview: next step, journey road, attention list | `GET /me`, `/me/applications`, `/me/dashboard` |
| Candidate | ★ `/applications` | Every application, its stage and the one next action | `GET /me/applications` |
| Candidate | `/applications/[id]` | Application detail with history timeline | `GET /me/applications/:id` |
| Candidate | `/opportunities/[id]/apply` | Three-step apply | `GET /jobs/:id`, `/me`; `POST` apply |
| Candidate | ★ `/assessments` | Practical assessments by what they need now | `GET /me/applications` (attempts) |
| Candidate | `/experience/[orgSlug]/[jobSlug]/[version]` | Assessment workspace | `GET /experience/...` |
| Candidate | `/reports/[attemptId]` | Released results | `GET /attempts/:id/report` |
| Candidate | ★ `/interviews` | Upcoming and past interviews | `GET /me/interviews` |
| Candidate | `/interviews/[id]` | Interview detail, confirm, join | `GET /interviews/:id` |
| Candidate | `/profile`, `/profile/cv/[id]`, `/development`, `/notifications`, `/invitations`, `/settings` | Profile, CV review, development, notifications, invitations, settings | existing `/me/*` |
| Employer | `/organization/new` | Create organization | `POST /organizations` |
| Employer | `/organization/[orgId]` | Recruitment Command Center | `GET /organizations/:id`, `/jobs`, `/applications`, `/team`, per-application interviews |
| Employer | ★ `/organization/[orgId]/jobs` | Jobs by status; wizard entry | `GET /organizations/:id/jobs`, `/applications`, `/listings` |
| Employer | `/organization/[orgId]/jobs/[jobId]` (`?step=1..5`) | Job workspace; guided setup wizard | existing job endpoints |
| Employer | ★ `/organization/[orgId]/candidates` | Search and filter applicants | `GET /organizations/:id/applications` |
| Employer | `/organization/[orgId]/applicants/[applicationId]` | Applicant profile, status, hiring panel, previous/next | `GET .../applications/:id/review` |
| Employer | ★ `/organization/[orgId]/assessments` | Submissions to review; progress by job | `GET /organizations/:id/jobs/:jobId/report` |
| Employer | `/organization/[orgId]/review/[attemptId]` | Submission review | `GET /attempts/:id/evaluation` |
| Employer | ★ `/organization/[orgId]/interviews` | Agenda of interviews | per-application `GET .../applications/:id/interviews` |
| Employer | ★ `/organization/[orgId]/hiring` | Pipeline board with allowed status moves | `GET /organizations/:id/applications` |
| Employer | ★ `/organization/[orgId]/reports` | Volume, progression, job performance, interviews, outcomes | applications, job reports, interviews |
| Employer | `/organization/[orgId]/settings` | Branding, company type, team, employer claim | existing |
| Admin | `/admin` + 11 sections | Platform operations console | `GET /admin/*` |

## 2. Candidate journey

1. **Register / sign in.** Split screen: the form alone on one side, Humaidan on the other. Minimal fields; errors in plain words.
2. **Onboarding (six steps).** About you → CV (can prefill, nothing saved until approved) → Education → Experience → Skills → Review. A stepper shows progress and lets you go back; each step saves as you continue; education and experience are optional with *Skip for now*; inline validation (required field, year order, four-digit years); Humaidan explains *why* each step is asked. Finishing lands on the overview.
3. **Overview.** One dominant *next step*, the career journey road (real progress), *needs your attention* (deadlines, interviews), applications with stage tracks, recommendations, profile completeness.
4. **Discover.** Search, filters (employer, sector, city, type, level), result count, editorial rows with organization, title, facts, skills, deadline.
5. **Apply.** Review details → what happens next (assessments) → submit; profile reused; duplicate application redirects to the existing one; confirmation on the application page.
6. **Assessment.** Brief with scenario, facts, skills, rubric and rules → two-pane workspace (brief beside the answer, upload, save state, timer) → review checklist → submit → receipt.
7. **Results.** Overall score (when released), skill levels, criteria with evidence, strengths, next steps. Never shown before the organization releases them.
8. **Interviews.** List of upcoming and past; detail with date block, confirm or ask for another time, join window.
9. **Outcome.** The application page states the decision and message when the organization issues one.
10. **Profile and settings.** Sectioned profile with sticky CV panel; settings with section index.

Navigation (candidate): Overview · Opportunities · My applications · My assessments · Interviews · My profile, with notifications and settings as icons; phones get a five-tab bar and the rest in the menu.

## 3. Employer journey

1. **Create organization** (auth shell, name in two languages).
2. **Guided start.** A new organization sees five real setup steps (profile, logo, team, first job, publish) instead of empty zeros; afterwards a reminder shows until setup is complete.
3. **Command Center.** Eight KPIs (active jobs, applications, under review, shortlisted, submissions to review, upcoming and completed interviews, hired), action center, pipeline by stage, applications per week, applications by job, latest applications.
4. **Job wizard.** 1 Name (creates the draft) → 2 Details → 3 Requirements → 4 Skills → 5 Assessment → 6 Review & publish, with a stepper, Back / Continue / Exit setup, and a readiness checklist before publishing. The full workspace remains available.
5. **Candidates.** Search by name, email or headline; filter by job and stage; active filter chips; status control per row; previous / next on the applicant page.
6. **Assessment review.** Queue of submissions awaiting review, then progress by job.
7. **Interviews.** Agenda by day; the rule (shortlist first) is stated; shortlisted candidates are offered as ready to schedule.
8. **Hiring pipeline.** Six stage columns; each card's status menu offers only the transitions the database allows.
9. **Reports.** Volume (12 weeks), progression by stage, job performance table, interview activity, outcomes, and an explicit list of what isn't shown and why.
10. **Settings.** Branding, team and roles, unchanged permissions.

Navigation (employer): Overview · Jobs · Candidates · Assessments · Interviews · Hiring · Reports · Organization settings, in a sidebar that carries the organization's logo and colors (scoped to its own workspace).

## 4. Business rules (unchanged, now explained in the interface)

- An interview requires a shortlisted application (database-enforced).
- Hiring is allowed from *evaluated* or *shortlisted*, so a shortlist is not required; every assessment must be reviewed first (database returns 422). The brief's rule ("Hired without a previous Shortlisted state") matches this; hiring straight from *submitted* is not allowed by the existing rules and was not changed.
- Status menus offer only `statusOptions()` from `lib/application-status.ts`, which mirrors `private.manual_status_change_allowed`.

## 5. Data honesty and limitations

- Charts receive counts computed from the organization's own lists. No growth percentages, no conversion rates between stages (the list carries no status history), no time to hire, no score averages across assessment versions.
- There is no organization-wide interview endpoint; the workspace aggregates per-application interview lists for applications that can have interviews (capped at 80 per page load). A dedicated endpoint would be faster.
- The Continue button in the job wizard moves between steps; each step's own Save keeps working as before (nothing is auto-saved silently).
- Signed-in pages were checked visually against a local fixture API with fictional data, not against the real Core API.
