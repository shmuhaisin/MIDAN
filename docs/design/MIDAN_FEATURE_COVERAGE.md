# MIDAN feature coverage against the complete UI/UX brief

Branch `feature/midan-full-ui-redesign`, 2026-11-09. This continues the work in `MIDAN_UI_AUDIT.md` and `MIDAN_UX_JOURNEYS.md`. Those two were written before this checklist, from the redesign received as a handoff (base `d8ea977`, with uncommitted work). The branch now sits on `8f405fc`, which adds backend-only fixes and the real-service checks.

**Decisions taken for this branch (owner, 2026-11-09):**
- the brief's palette, `#0B3D2E / #1F7A4D / #A7E3C2 / #F7F4E9 / #D4AF37`, replaces the 2026-11-08 palette;
- live interviews stay on Daily.co, which is verified against the real service. The brief mentions Agora, but nothing is built for it.

**Legend:**
- **UI**: the screen exists.
- **API**: it reads or writes real Core API endpoints. Otherwise it's UI-only and says so.
- **Real**: checked in a browser against the real local stack (local API, database and auth, fictional accounts).
- **Gap**: what's missing. "Backend" means the frontend can't honestly complete it without a new endpoint (see `MIDAN_FRONTEND_BACKEND_HANDOFF.md`).

Status is ✅ done, ◐ partial, ✗ missing.

| # | Brief section | UI | API | Real | Gap / next |
| --- | --- | --- | --- | --- | --- |
| A | Design foundation: tokens, type, shared classes, shells, RTL/LTR, themes | ✅ | n/a | ◐ | `MIDAN_DESIGN_SYSTEM.md` written. Dark mode still to check screen by screen |
| 4 | Public landing (3D journey, Humaidan, sections, CTAs) | ✅ | static | ◐ | Visual check with the pane visible, on desktop and phone |
| 5 | Auth: sign in, register (candidate/organization), verify, forgot/reset | ✅ | ✅ Supabase Auth | ✅ sign-in as candidate and owner | Password show/hide added to every password field. Logout confirmation not added (signing out is immediate) |
| 6 | Candidate onboarding (6 steps) | ✅ | ✅ `/me`, `/me/candidate-profile`, `/me/cv` | ✅ loads | Run through with a fictional account |
| 7 | Candidate dashboard | ✅ | ✅ | ✅ loads in both languages | — |
| 8.1 | Role discovery (search, filter, choose a target) | ✅ | ✅ `/reference/job-families`, `PUT /me/career/target` | ✅ chosen through the API | `/development/roles`: 133 real families in 7 sectors, Arabic-tolerant search, sector filter. Family names are Arabic only: backend #3 |
| 8.2 | Role details | ✅ | ✅ `/reference/skills?family&sector` | ✅ | `/development/roles/[sector]/[family]`: technical and general skills, descriptions, priority. Responsibilities and tools: backend #2 |
| 8.3 | Skill gap analysis | ✅ | ✅ `GET /me/career` | ✅ | `/development/skills`: grouped by evidence; released results kept apart; no percentage |
| 8.4 | Course recommendations | ✅ | ✅ verified `learning_resources` | ✅ empty state | `/development/learning`: reason, provider, verified date, add to plan. Local catalogue empty; difficulty, duration and outcomes: backend #4 |
| 8.5 | Practical projects | ✅ | ✅ practice tasks | ✅ started through the API | `/development/practice`: brief, instructions, deliverables, submission, MIDAN checklist |
| 8.6 | Activities `skill_goal` / `project` / `course` / `certification` | ✅ | ✅ plan items | ✅ | Board by status, filter by kind. Due dates: backend #5 |
| 8.7 | Development workspace | ✅ | ✅ | ✅ | Six places under the career sub-navigation |
| 8.8 | Evidence and achievements | ◐ | ◐ | ✅ | Evidence panel: submitted and completed work, labelled not verified. Files and verification: backend #6–7 |
| 8.9 | Progress tracking | ✅ | ✅ counts | ✅ | Tallies of goals, courses, certifications, projects, practice and resources |
| 8.10 | Role readiness | ✅ | ✅ counts | ✅ | Evidence summary (listed, nothing yet, shown) plus the journey road. Never a percentage |
| 8.11 | Opportunities linked to development | ✅ | ✅ `/jobs?q=&sector=` | ✅ | Links to jobs with a similar title and to the target sector |
| 9 | L0–L4 progression | ✅ | static, existing definitions | ✅ | `/development/levels`: a ladder with keyboard support, the step from the level below, a field example, the candidate's released levels, how to progress |
| 10 | Job discovery and details | ✅ | ✅ | ◐ | Saved jobs don't exist: backend |
| 11 | Application journey and timeline | ✅ | ✅ | ✅ loads | Check with the demo application |
| 12 | Candidate assessments | ✅ | ✅ | ◐ | The workspace was verified earlier; recheck the new list |
| 13 | Assessment design and review (employer) | ✅ | ✅ `needs_human_review` / `human_reviewed` | ◐ | Check the review screen |
| 14 | Employer command center | ✅ | ✅ counts from the organization's lists | ✅ loads | The demo organization has no applicants yet, so charts show their empty states |
| 15 | Job management and wizard | ✅ | ✅ | ✅ loads | Check the wizard end to end |
| 16 | Candidate management | ✅ | ✅ | ✅ loads | Check |
| 17 | Interviews (employer), shortlist rule | ✅ | ✅ Daily + Google Calendar verified real | ◐ | Calendar view: agenda by day exists |
| 18 | Live interview room | ✅ | ✅ Daily (`/interviews/:id/join`) | ◐ | Waiting room (countdown, device check, what to expect), call timer, end screen. Daily Prebuilt provides the device picker and controls. Not joined in a browser in this pass |
| 19 | Hiring decisions | ✅ | ✅ allowed moves only | ✅ loads | Check |
| 20 | Notifications | ✅ | ✅ list, read, read-all | ✅ loads | Filters (unread, applications, assessments, interviews, decisions, account), day groups, mark-all-read |
| 21 | Reports | ✅ | ✅ | ✅ loads | Export doesn't exist: backend |
| 22 | Organization settings and branding | ✅ | ✅ | ✅ loads | Check that branding stays inside its own workspace |
| 23 | Platform administration | ✅ redesigned overview: queues that need a person, platform at a glance, service status | ✅ `/admin/*` | ✅ loads | Organization and account management pages unchanged from the teammate's console |
| 24 | External data and imports | ✅ admin imports, external listings | ✅ | ✗ | No scraping. Sources are attributed |
| 25 | No visible AI wording | ✅ | n/a | ◐ | Re-scan the copy after new screens |
| 26 | Profile and settings | ✅ | ✅ | ✅ loads | Check |
| 27 | Loading, empty, error, permission states | ◐ | n/a | ✗ | Check per screen |
| 29 | Frontend–backend handoff document | ✅ | — | — | `MIDAN_FRONTEND_BACKEND_HANDOFF.md` |
| 30 | QA: types, lint, unit tests, build, screenshots in both languages | ◐ | — | — | Types, lint, 31 unit tests and the build pass as received. Screenshots still to take |


## Added on 2026-11-09 (owner's implementation brief)

| Area | UI | API | Real | Notes |
| --- | --- | --- | --- | --- |
| Semantic requirements match (ATS), employer | ✅ applicant page panel: status per requirement, evidence line, contradicting line, reason, confirm or correct | ✅ `GET /organizations/:orgId/applications/:id/match`, `POST …/match/reviews` | ✅ API e2e | Model: `intfloat/multilingual-e5-base` locally (measured); lexical fallback. `docs/ai/ATS_MATCHING.md` |
| Semantic requirements match, candidate | ✅ job page: "How your profile meets each requirement" | ✅ `GET /me/jobs/:id/match` (adds `semantic`; `calculateMatch` unchanged) | ✅ API e2e, including the AI service down | A guide only, never proof |
| Assistant ("Ask MIDAN") | ✅ `/assistant`, `/organization/[orgId]/assistant`, entries in both navigations | ✅ `POST /me/assistant`, `POST /organizations/:orgId/assistant` (20 a minute) | ✅ AI tests; live answers need Groq | Answers only from the asker's own records, cites them, never acts |
| Showcase | ✅ `/showcase` | static | ✅ build | Works today, real services, not built yet |
| Investor demo | — | `scripts/investor-demo.mjs` | — | `docs/investor/INVESTOR_DEMO.md` |
| Humaidan in the car | ✅ whole image at its own proportions; the car hides what a car hides | — | ✅ screenshots | `components/journey/world.ts` |
| Security, recovery, incidents | — | — | — | `docs/security/`, `docs/operations/` |
