# MIDAN — complete implementation audit

Audited 2026-11-09 against the working tree of `feature/midan-auth-jobs-ai-assessments` (checkpoint `b3ad0a8`, made from
`feature/midan-full-ui-redesign` at `8f405fc` plus all uncommitted work), on the local stack: Postgres 16 with the project's
migrations, the local Supabase gateway (GoTrue, PostgREST, storage, mail sink), the NestJS API, the FastAPI AI service and
the Next.js web app. Hosted Supabase was not touched.

Status words used below: **Works (tested)**, **Works (not fully tested)**, **Partial**, **Missing**, **Blocked
(credentials/external)**, **Needs a decision**.

## 1. Git and parallel work

| Item | Finding |
| --- | --- |
| Checkout | `scratchpad/ui`, a git worktree of `shmuhaisin/MIDAN`. Branch `feature/midan-auth-jobs-ai-assessments` (pushed), created from `feature/midan-full-ui-redesign`. |
| Other worktrees | The main checkout (`candidate-portal`, one untracked `MAC_SETUP_NOTES.md`) and `scratchpad/wt` (`midan-platform-p0`, clean). Neither was modified. |
| Remote branches | `main`, `candidate-portal`, `feat/company-workflow`, `feature/midan-assessment-intelligence-handoff`, `feature/midan-complete-data-jobs-assessment`, `feature/midan-phase-1-security`, `midan-assessment-editing-policy`, `midan-phases-2-3-4`, `midan-platform-p0`, `midan-security-completion`, and this branch. |
| Work in progress | No other session was editing these files when the audit ran. `e86932b` (an older handoff reference) is history only. |

## 2. Feature map

### Authentication and roles — Works (tested)
- Supabase Auth (GoTrue) only; no second auth system. Sign-up, verification by email, sign-in, sign-out, password
  recovery and reset, cookie sessions renewed from the refresh token (`apps/web/src/proxy.ts`).
- Landing "I'm hiring" / "I'm looking for opportunities" → `/register?as=organization|candidate`; signed-in visitors go to
  their area. Verified in fresh browsers: 50/50 checks (`docs/testing/MIDAN_E2E_RESULTS.md`).
- Registration is closed to the public: a server-held access code (`DEV_TEST_ACCESS_CODE`, hashed in
  `private.signup_access`) is required; the database refuses anything else.
- **Fixed 2026-11-09:** account type was taken from Auth user metadata, which the user can edit; the API trusted nothing
  from it, but the database let an organization member create a candidate profile and apply, and a candidate create an
  organization. Migration `20261109120000_account_type_separation` now keeps them apart and lets only candidate
  accounts apply. Candidate pages send organization accounts to their workspace (`apps/web/src/lib/account.ts`).
- **Fixed:** an expired session without a refresh token looped between `/dashboard` and `/login`;
  `/[locale]/auth/ended` clears it (after asking the API, so a link can't sign anyone out).
- Email links: GoTrue's site URL and allow list come from `APP_URL` (`scripts/local-supabase.mjs`), and the web app builds
  redirect URLs from `APP_URL`. The old "port 3000" problem is not present: links point at `APP_URL` (3100 locally).
- **Blocked (credentials):** real email delivery. Locally, Auth's emails go to a mail sink (`/__mail`). No SMTP provider is
  configured for hosted use.

### Employer registry and organization verification — Partial
- `employer_registry` holds the 10 supported organizations from the workbook, all `partnership_status = not_partner`,
  with aliases, sources and brand fields. Imports are idempotent (admin import screens, `docs/database/`).
- Verification exists as **employer claims** (`employer_claims`): a representative's organization asks to be linked to a
  registry record, with role title, evidence and an email-domain check; a platform admin approves or refuses.
- **Gap:** employer sign-up creates a *new* organization from the names typed at sign-up (`private.provision_account`).
  That tenant is not linked to the registry until a claim is approved, so selecting a registry name grants nothing.
  The brief's "select a supported organization at registration" step isn't in the sign-up form: **Needs a decision** on
  whether representatives of a registry organization should join one shared tenant (approval by an admin) or keep
  separate tenants linked by claims.

### Jobs and job descriptions — Works (tested)
- **Fixed:** wizard step one asked for a "Job link" (URL slug). It now asks for the description (Arabic and/or English,
  at least one), saved to `jobs.description_ar/en`, shown on the public job page, editable in step two, and read by job
  analysis, assessment generation and matching. The API derives the slug from the English title.
- The wizard: name and description → details → requirements → skills → assessment → review and publish, each step saved
  to the database and reopenable.

### Job skills — Partial (root cause found; fix in progress on this branch)
- **Root cause of "the same suggested skills for every job":** the "Required skills" checkboxes in the details step list
  every row of `public.skills`, a draft taxonomy of exactly six skills (critical thinking, data analysis, problem solving,
  spreadsheets, SQL, written communication). Every job is offered the same six.
- The 5,074 sector skills (`reference_skills`) are only reached through "Analyze against the workbooks"
  (`public.analyze_job`), which looks for each skill's Arabic name inside the job's text. English job text, or wording
  that differs from the workbook, finds nothing.
- Accept/reject of proposals (`accept_job_analysis`, `dismiss_job_analysis`) works and must be kept.
- Missing: suggestions that read the job's meaning, catalog search, employer-defined skills, and a proficiency level per
  accepted skill. See `docs/product/MIDAN_DYNAMIC_SKILLS.md`.

### Assessments — Works (tested), live approval not verified in the browser
- Generation through the LangGraph builder with Groq `openai/gpt-oss-120b`; templates only when the model is unavailable,
  labelled "Demo mode". The button reads "Generate assessment with AI".
- Editing: title, instructions, scenario, duration, deadline, tasks (add, edit, delete), questions and answer keys, rubric
  criteria (add, edit, delete), weights; every change recorded and reviewed before approval; approved versions never change
  (new versions instead). Assessor guide stored apart and never shown to candidates.
- **Added:** regenerate one task with the live model (`POST /organizations/:orgId/assessment-tasks/:taskId/regenerate`).
- **Fixed:** Groq replies were cut off by the output limit; a repair round fixes drafts the quality standard blocks.
- Missing: reordering tasks (positions are renumbered on delete, but there is no move up/down).
- **Blocked (external):** Groq's free tier (200,000 tokens/day) was exhausted during verification, so approving a live
  draft in the browser wasn't completed. A live draft passed the standard ("ready") in a direct run.

### Applications, submissions, evaluation — Works (tested, Arabic and English)
- Apply once (unique per job and candidate; a second click returns the same application), the approved assessment is
  assigned on applying, answers save as they go, files upload, submission is final.
- Evaluation: AI proposals with evidence quotes; criteria the model couldn't score are left with "No proposal" and a
  reason (`model_failed:*`) and must be scored by a person; approval, release to the candidate, hiring decisions.
- "View evaluation" 404s were stale links after a demo reset, not a broken page (section 2, demo data).

### ATS matching — Works (tested)
- `intfloat/multilingual-e5-base` locally, requirement by requirement, with the evidence line and a lexical fallback;
  staff confirm or correct (`docs/ai/ATS_MATCHING.md`). BGE-M3 is not measured: it needs a Hugging Face token.

### Career journey, assistant, admin — Works (tested)
- Career: roles, skills by evidence source, learning plan (`skill_goal`, `project`, `course`, `certification`), L0–L4.
- Ask MIDAN: permission-scoped retrieval, in-app links only, never acts, labelled fallback without a model.

### Demo data and stable links — Fixed
- `scripts/investor-demo.mjs --reset` used to delete the showcase organization, so every address in it changed and old
  links showed the not-found page. `--reset` now keeps the organization, job and approved assessment (their ids stay);
  `--rebuild` replaces everything. Published assessment versions can't be deleted except with their organization (a
  database guard), which is why the job and assessment are kept rather than recreated with fixed ids.

## 3. Open issues

| # | Issue | Root cause | Status |
| --- | --- | --- | --- |
| 1 | Same skills for every job | Six-row draft taxonomy; name-matching analysis | Fix in progress (this branch) |
| 2 | No employer-defined skills or per-skill proficiency on workbook skills | Not built | Fix in progress |
| 3 | Employer sign-up doesn't select a registry organization | Sign-up creates a new tenant; claims link it later | Needs a decision |
| 4 | Palette: the master brief lists `#0F5B46 #1F7A5C #DCEEE5 #F7F4EE #1F2A26` and "no gold"; the branch implements the gold palette the owner approved on 2026-11-08/09 (`docs/DECISIONS.md`) | Two different instructions | Needs a decision; nothing changed |
| 5 | Task reordering | Not built | Missing |
| 6 | Real email | No SMTP credentials | Blocked (credentials) |
| 7 | Live AI throughput | Groq free tier: 8,000 tokens/min, 200,000/day | Blocked (external, paid tier is the user's decision) |
| 8 | Prisma CLI advisory (`deepmerge-ts`, high) | Prisma 6's config loader; dev tooling, not request handling | Open; upgrade to Prisma 7 needs ESM work (`docs/DECISIONS.md`) |
| 9 | Not-found pages return HTTP 200 | Streaming from the site-wide `loading.tsx` | Open (users see the right screen) |
| 10 | Candidate deletion (PDPL) | Deleting a candidate with applications is blocked; no anonymization process | Needs a retention decision |
| 11 | BGE-M3 hosted | Needs `HF_TOKEN` | Blocked (credentials) |

## 4. Tests at the checkpoint

API e2e 177/177 · API unit 80/80 · web unit 31/31 · browser 44/44 · forms 9/9 · AI 235 passed, 9 skipped (provider and
model-file tests) · database security, editing-policy and intelligence checks pass · migration rehearsal 28/28 forward and
back · lint, types, builds and the bundle secret scan pass. Earlier figures in older handoffs (108/108, 27/28, 91/91) are
superseded.
