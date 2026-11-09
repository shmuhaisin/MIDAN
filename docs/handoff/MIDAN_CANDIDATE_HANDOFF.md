# MIDAN — candidate experience handoff

Branch `feature/midan-candidate-experience` (`origin`). Status per feature: `MIDAN_CANDIDATE_PROGRESS.md`. Current state,
run commands, env variable names and next steps: `MIDAN_CANDIDATE_CURRENT_STATE.md`. Shared contract with Employer + Admin:
`MIDAN_CANDIDATE_INTEGRATION_CONTRACT.md`.

## Candidate pages (`apps/web/src/app/[locale]/…`)
| Route | Purpose |
| --- | --- |
| `register?as=candidate`, `login`, `check-email`, `auth/confirmed`, `auth/callback`, `auth/ended`, `forgot-password`, `reset-password` | Supabase Auth flows (access code required to sign up) |
| `onboarding` | Guided profile building, progress saved per step |
| `dashboard` | Next action, applications lane, interviews, plan, recommendations (real records only) |
| `profile`, `profile/cv` | Profile sections; CV upload, analysis for the candidate to confirm, replace, remove |
| `opportunities`, `opportunities?saved=1`, `opportunities/[id]`, `opportunities/[id]/apply` | Discovery (search, filters, sort, deadline states, saved jobs), job details, apply |
| `applications`, `applications/[id]` | Tracking with the real status history |
| `assessments`, `experience/[org]/[job]/[version]` | Assigned assessments; brief, tasks, answers saved as they go, files, submit |
| `reports/[attemptId]` | Released results only |
| `interviews`, `interviews/[id]` | My Interviews: upcoming, past, accept, request a new time, join (Daily) |
| `development/*` | Career journey: target role, skills by evidence, L0–L4, learning plan, practice |
| `notifications`, `assistant`, `settings` | In-app notifications, Ask MIDAN, account settings |

## Candidate-owned APIs (`apps/api/src`)
`/me` (profile, skills, reference skills, own skills, dashboard, applications, notifications, saved jobs, career, plan,
practice, CV), `POST /jobs/:id/applications`, `GET /jobs`, `GET /jobs/:id`, `GET /me/jobs/:id/match`, attempts
(`/attempts/:id/...` start, responses, files, submit, report), `GET /me/interviews`, `GET /interviews/:id`,
`POST /interviews/:id/respond` (`accept` | `request_reschedule`), `POST /interviews/:id/join`, `POST /me/assistant`.

## Database changes by the candidate side
- `20261109120000_account_type_separation` — candidate and organization accounts kept apart; only candidates apply.
- `20261110150000_candidate_saved_jobs_and_deadlines` — `saved_jobs`; application deadline enforced.
Both have rollbacks in `supabase/rollback/`.

## Workflows verified end to end
Register → verify (mail sink link) → sign in → onboarding; discover → save → apply (once; refused after the deadline) →
assessment assigned → answer and upload → submit → track → released result; interview invitation → accept or request a
new time; career role → gaps → plan. See the progress file for the tests and browser runs behind each.

## Known issues and blockers
- No SMTP provider: emails reach the local mail sink only; nothing is emailed to candidates.
- Groq free-tier limits: live AI (CV analysis, assistant, scoring) falls back, labelled, when the daily quota is used.
- Not built: profile links (portfolio/LinkedIn), section reordering, an interview "decline" (the database supports accept
  and request_reschedule only), a released interview-feedback field, "not yet open" (no opening date), work-arrangement
  filter (no field). Each needs a shared-schema decision with the employer side.
- Candidate account deletion awaits a PDPL retention decision.
