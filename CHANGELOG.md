# Changelog

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
