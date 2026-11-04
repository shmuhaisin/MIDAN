# Changelog

## 2026-11-05: Product experience correction and Humaidan rules
- Humaidan's outfit now follows a saved professional field: assessment, then organization, then Original.
- Removed outfit swapping from the homepage, and the Finance, Legal, Healthcare and Engineering figures from general pages, the assessment builder and reports.
- Candidate login and sign-up feature Original Humaidan; employer pages are formal with no mascot, on the same auth logic.
- Organization branding screen: logo, colors, welcome message, field, with a live preview.
- Branded assessment intro with logo, colors, welcome message, field and the right variant.
- Homepage now explains both journeys; progress rails on the candidate dashboard and job workspace use real state.

## 2026-11-05: Core MVP workflows
- LangGraph assessment builder and evaluation graphs with human-review interrupts, labeled demo mode and a provider abstraction.
- Job details, draft editing, human-approved publishing, candidate preview.
- Candidate experience: task navigation, autosave, CSV data, evidence upload, submission.
- AI-assisted evaluation with mandatory human review, release, candidate report and candidate comparison.
- Sign-up refused at the database outside an allowlist, keeping real candidate data out.
- Fixed: a closed job broke the dashboard of candidates who had applied.
- Fixed: autosave could lose an edit when moving between tasks quickly or submitting right after typing.

## 2026-11-05: Milestone 3 and part of 4, accounts and first product screens
- Sign-in, registration and sign-out with httpOnly session cookies and automatic renewal.
- Opportunities list with search and city filter, job details, apply.
- Candidate dashboard with a next step, application tracking, withdraw, and profile.
- Organization creation and dashboard: real counts, jobs with draft and publish, applicants with status changes.
- API rate limiting per signed-in user, or per IP when signed out.
- Evaluations now require a submitted attempt.
- Fixed: an organization could still read a candidate's profile and CV after they withdrew. Found by the tests.
- Browser journey suite with Playwright, including the four language and theme combinations.

## 2026-11-05: Milestone 2, database foundation
- 27 tables with RLS, 72 policies, triggers and versioned migrations in `supabase/migrations`.
- Private storage buckets for CVs and evidence, with path-based policies.
- Restricted `midan_api` database role; NestJS connected through Prisma.
- Endpoints for profile, organizations, jobs and applications; all under real auth.
- End-to-end suite of 31 tests against the live project, covering auth and tenant isolation with and without the backend.
- Fixed: a policy with an unqualified `id` hid every organization from public view. Found by the tests.
- Web dev server moved to port 3100, as 3000 is in use on this machine.

## 2026-11-05: Milestone 1, brand and foundation
- Monorepo with `apps/web`, `apps/api`, `services/ai`.
- Design tokens for the official palette, designed light and dark themes, system preference.
- Arabic (RTL) and English (LTR) routing with a persisted language choice.
- Original Najdi-inspired parapet, arch and triangle motifs.
- Public pages, including an interactive field and skill-level explorer using the original Humaidan outfits.
- NestJS and FastAPI services with health endpoints; LangGraph wiring check.
- Supabase project `al-midan-ya-hamidan` created (no schema yet).
