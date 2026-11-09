# MIDAN frontend–backend handoff

Branch `feature/midan-full-ui-redesign`, 2026-11-09. This is a checklist for the backend phase. Feature status is in `MIDAN_FEATURE_COVERAGE.md`; the design language is in `MIDAN_DESIGN_SYSTEM.md`.

**How to read the status words:**
- **UI**: the screen exists.
- **Connected**: it calls a real Core API endpoint (`apps/api`) through `lib/api.ts` or a server action in `lib/*-actions.ts`.
- **Persisted**: what it writes is stored in the database.
- **Checked**: it was opened in a browser against the real local stack (local API, PostgreSQL, Supabase Auth, fictional accounts), on 2026-11-09.

**No endpoint was invented.** Every "proposed" endpoint below **does not exist**. The screens that would need one either show an honest empty state or leave the feature out.

## 1. Connected today

| Area | Screens | Endpoints | Persisted | Checked |
| --- | --- | --- | --- | --- |
| Auth | login, register (candidate and organization), forgot, reset, check email, confirmed | Supabase Auth via `lib/auth-actions.ts` | yes | sign-in, both roles |
| Onboarding | `/onboarding` (6 steps) | `GET /me`, `PUT /me/candidate-profile` (partial lists), `POST /me/cv`, `PATCH /me/onboarding` | yes | loads |
| Candidate home | `/dashboard` | `GET /me`, `/me/applications`, `/me/dashboard` | — | loads |
| Career journey | `/development` and `roles`, `roles/[sector]/[family]`, `skills`, `learning`, `practice`, `levels` | `GET /me/career`; `PUT /me/career/target`; `POST`, `PATCH`, `DELETE /me/career/plan[/:id]`; `POST`, `PATCH /me/career/practice[/:id]`; `GET /reference/job-families`, `/reference/skills?family&sector`, `/reference/job-titles` | yes | choosing a role and starting a practice task, both written through the API |
| Opportunities | `/opportunities`, `/opportunities/[id]`, `/apply` | `GET /jobs`, `/jobs/external`, `/jobs/:id`, `/me/jobs/:id/match`; `POST /jobs/:id/applications` (a duplicate opens the existing application) | yes | loads |
| Applications | `/applications`, `/applications/[id]` | `GET /me/applications[/:id]`, `POST /applications/:id/withdraw`, share CV | yes | loads |
| Assessments | `/assessments`, `/experience/...`, `/reports/[attemptId]` | attempts: start, responses, evidence, submit; `GET /attempts/:id/report` | yes | loads |
| Interviews (candidate) | `/interviews`, `/interviews/[id]` with the waiting room | `GET /me/interviews`, `/interviews/:id`; `POST /interviews/:id/respond`, `/interviews/:id/join` (Daily, verified against the real service) | yes | loads |
| Notifications | `/notifications` with filters | `GET /me/notifications`, `POST /me/notifications/:id/read`, `/read-all` | yes | loads |
| Profile and settings | `/profile`, `/profile/cv/[id]`, `/settings` | `/me/*`, CV analysis (real provider: Groq) | yes | loads |
| Employer | command center, jobs and wizard, candidates, applicant review, assessments, review, interviews, hiring, reports, settings | `/organizations/:id/*`, `/applications/:id/status`, `/attempts/:id/evaluation`, `/evaluations/:id/review`, interviews (Daily, Google Calendar verified real) | yes | all 15 pages load in both languages as the owner |
| Admin | `/admin/*` (11 sections) | `/admin/*` | yes | not rechecked in this pass |

## 1b. Added on 2026-11-09 (implementation brief A, C, H)

| Feature | Screens | Endpoints | Data | Tests |
| --- | --- | --- | --- | --- |
| Requirements match (ATS) | Applicant page, "Requirements match" panel | `GET /organizations/:orgId/applications/:id/match`; `POST …/match/reviews { requirement_key, status, proposed_status, note? }`; AI service `POST /match/requirements` | `application_match_reviews` (migration `20261109090000`, rollback in `supabase/rollback/`) | `services/ai/tests/test_matching*.py`, `apps/api/src/match.e2e-spec.ts` |
| Assistant | `/assistant` (candidate), `/organization/[orgId]/assistant` | `POST /me/assistant`, `POST /organizations/:orgId/assistant` `{ question, locale?, history? }`; AI service `POST /assistant/answer` | none stored: the conversation stays in the page | `services/ai/tests/test_assistant.py` |
| Showcase | `/showcase` (public) | none, static | — | build; browser smoke |
| Investor demo | the showcase organization | `scripts/investor-demo.mjs` (through the public API) | synthetic records in `midan-demo-showcase` | runs end to end |

Reply shapes:
- `/match`: `{ requirements: [{ key, kind, text_ar, text_en, mandatory, min_years, proposal: { status, score, evidence_text, evidence_source, reason_code, reason_params }, review }], summary: { counts, score, mandatory_missing }, evidence_lines, reviewed, provenance }`
- `/assistant`: `{ answer, facts: [{ id, text }], links: [{ key, href, label }], mode: 'live' | 'retrieval_only', grounded, provenance }`

## 2. UI-only, or derived in the browser (no endpoint needed)

- The career journey's counts, priorities and stations: derived from `GET /me/career` (`lib/career.ts`). No readiness percentage, by design.
- The L0–L4 ladder: the existing definitions (`how.scale`) and examples (`home.fields.*.levels`), with the candidate's released levels.
- Notification filters and day groups: done in the browser over the full list.
- Interview waiting room: countdown, camera and microphone check (the browser's own `getUserMedia`, stopped immediately), call timer, end screen.
- Employer charts: counts from the organization's own lists (see `MIDAN_UX_JOURNEYS.md` §5).

## 3. Missing backend capabilities (proposed, not built)

Each item names what the UI would show, what it needs, and what the screen does today.

| # | Capability | Proposed contract | Today |
| --- | --- | --- | --- |
| 1 | **Saved jobs** | `PUT /me/saved-jobs/:jobId` and `DELETE …` → `204`; `GET /me/saved-jobs` → `[{ job_id, saved_at, job }]`. Table `saved_jobs(candidate_id, job_id, saved_at)` with RLS for the owner | Not shown |
| 2 | **Role descriptions**: responsibilities, tools, typical experience per job family | `GET /reference/job-families/:sector/:family` → `{ summary_ar/en, responsibilities[], tools[], experience_note, source }`. Needs a licensed or official source; the sector workbooks don't have it | Role details say so, and show skills only |
| 3 | **English names for job families** | `job_family_en` on `reference_skill_contexts`, or a family table | Names stay in Arabic, and the English search says so |
| 4 | **Learning resource details**: difficulty, duration, outcomes | Columns on `learning_resources`: `difficulty`, `duration_hours`, `outcomes_ar/en[]`; returned in `/me/career` | Learning says they aren't recorded. The local catalogue is empty; admins add resources with `POST /admin/learning-resources` |
| 5 | **Due dates on planned activities** | `due_on` on `career_plan_items`; `PATCH /me/career/plan/:id { due_on }` | Not shown |
| 6 | **Development evidence files** | `POST /me/career/practice/:id/evidence` (multipart, private bucket, signed URL like attempt evidence) | Practice takes text and an https link only |
| 7 | **Verified development evidence** | A reviewer role and `verified_by`, `verified_at` on practice or evidence. Policy needed first: who may verify | Submitted work is labelled "not verified" |
| 8 | **Organization-wide interviews** | `GET /organizations/:id/interviews?from&to` → interviews with application and job | The employer agenda aggregates per-application lists (capped at 80) |
| 9 | **Application status history** (for conversion and time in stage) | `GET /organizations/:id/applications/:id/history`, or `status_history` in the list | Reports show counts only, and list what they can't show |
| 10 | **Report export** | `GET /organizations/:id/reports/export?format=csv&from&to` | No export button |
| 11 | **Notification paging and server filters** | `GET /me/notifications?unread=1&topic=&cursor=` | Filters work over the full list |
| 12 | **Email notifications** | An email provider and templates, with per-user preferences (there's a `deadline_reminders` preference already) | Not configured. Auth emails go to the local mail sink |
| 13 | **Agora** (if the owner later chooses it over Daily) | A token endpoint like `/interviews/:id/join`, returning `{ app_id, channel, token, uid, expires_at }` | Daily is in use and verified; nothing is built for Agora |
| 14 | **Logout confirmation** | None: frontend only | Signing out is immediate |

## 4. Authentication and authorization dependencies

- Every signed-in page redirects to `/login?next=…` without a session (`lib/session.ts`). The API enforces access with RLS and role checks; the UI only hides actions the rules forbid (`lib/application-status.ts` mirrors `private.manual_status_change_allowed`).
- An interview requires a shortlisted application (database-enforced). The UI explains this and offers scheduling only for shortlisted applicants.
- Hiring is allowed from *evaluated* or *shortlisted*, after every assessment is reviewed. People make every decision: nothing rejects a candidate automatically.
- Platform admin (`/admin`) is separate from organization settings and depends on the platform-admin role.
- An organization's branding is shown only inside its own workspace.

## 5. External integration dependencies

| Integration | State |
| --- | --- |
| AI provider (Groq, `openai/gpt-oss-120b`) | Verified real for CV analysis, generation and evaluation. Generation is limited by the account's 8,000 tokens a minute |
| Daily.co | Verified real: private rooms, per-participant tokens, refusals |
| Google Calendar | Verified real: create, reschedule, cancel, with `sendUpdates=none` in the demo |
| Email | Not configured |
| Agora | Not used (owner's decision: Daily) |
| External job sources | Imports and attribution through admin; no scraping |
