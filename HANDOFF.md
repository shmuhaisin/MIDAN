# Handoff

**Branch:** `feat/company-workflow` (baseline `c5cb1af`; members/invitations changes uncommitted). **Remote:** https://github.com/shmuhaisin/MIDAN (public).

## What exists
- `apps/web` (port 3100): public pages, role-aware auth, opportunities, candidate dashboard, profile, branded assessment experience, candidate report, organization dashboard, branding settings, job workspace, review.
- `apps/api` (port 4000): the Core API, on the live database as restricted role `midan_api`, rate limited. Swagger at `/docs`.
- `services/ai` (port 8000): private FastAPI and LangGraph service, reached only by the API with a shared token. Graph A drafts from approved templates and no LLM. Graph B has Gemini and OpenAI providers, never run for lack of a key, and otherwise a labeled demo heuristic. Checkpoints are in a local SQLite file, not production-ready.

All three must run together. Humaidan rules are in `apps/web/src/lib/humaidan.ts`.

## Supabase
Project `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`, region `eu-central-1`, $0/month. See [docs/database/README.md](docs/database/README.md). The unrelated project `ALNADA` in the same organization must not be touched.

28 tables, all with RLS. 3 buckets. 5 test accounts (`midan.test.*@example.com`) whose passwords exist only in the local `.env.test.local`. `.env` and `.env.test.local` are git-ignored and exist only on this machine: a new checkout must regenerate them with `scripts/provision-db-credentials.mjs`.

Not reachable with the available tools; needs the dashboard: custom SMTP, leaked password protection, and Auth redirect URLs. The owner chose to continue without SMTP for now, so confirmation email reaches only Supabase project team members, a few per hour. Confirmation returns to `{APP_URL}/{locale}/auth/confirmed`. Locally `APP_URL` is `http://localhost:3100` in `.env`, and the code has no fixed host. The Site URL was still `http://localhost:3000` at handoff, so an unlisted redirect falls back there. Add `http://localhost:3100/ar/auth/confirmed` and `http://localhost:3100/en/auth/confirmed` to Redirect URLs. Leave the Site URL and any production redirect unchanged.

## Baseline tests reported in the original handoff (not rerun against the team project)
- API, live database, real AI service: 50 end-to-end. API unit: 5.
- Browser (Playwright, live database): 11 journeys, including the whole flow from job to released report, and 6 character tests covering all 17 Humaidan scenarios by checking the actual image files.
- AI: 23, including interrupt and resume, bounded repair, deterministic scoring, invented evidence, prompt injection.
- Web: type check, production build, 7 unit tests.
- By eye: profile, applicant profile, login, employer login, assessment screens (legal, technology on mobile), home, review, report.

## Not checked
- **A complete real sign-up with a real email and link.** Automation doesn't type passwords into pages that send them to hosted Auth, and doesn't email real inboxes. Forms are tested against a local stand-in in `apps/web/e2e-forms`, and the rest against real Supabase separately.
- Any real LLM provider; no key is configured.
- The cause of intermittent 20-second database stalls on the local connection to Frankfurt. A single retry handles them; a second expiry returns 503. Long test runs also failed when the Mac slept (`ERR_NETWORK_IO_SUSPENDED`, connect timeouts); they pass when it stays awake. Hosted reliability hasn't been measured.
- Session renewal in `proxy.ts` has not been exercised with a truly expired token.
- No automated accessibility audit. Arabic copy has not been reviewed by a native editor.

## Known gaps
`npm audit` reports a high-severity finding in the Prisma CLI's `deepmerge-ts` (see docs/DECISIONS.md). Candidate account deletion is blocked once they've applied, pending a PDPL erasure design. The Humaidan chat is postponed by the owner. Section reveals start at opacity 0, so that content needs JavaScript to appear; fix before launch. No ESLint (`lint` runs `tsc`), no CI, no `packages/*`, no docker-compose. See PROJECT_STATUS.md.

## Next
Members and invitations implemented with local automated checks; see docs/organization-members.md for the migration, SMTP configuration, security behavior and validation limits. Full isolated Supabase/Auth/Prisma-JS/SMTP journey now passes; native-engine runtime and real provider delivery remain to verify. No team/production migration or email configuration was applied.

## Members & invitations — 2026-11-07

API, bilingual members screen and acceptance route are implemented. Fixed seven-day expiry; automatic configurable SMTP; failures remain visible and retries reuse one invitation. Existing roles only, with owner/admin management, tenant isolation, DB-confirmed email acceptance and serialized last-owner protection. New migration: `20261107090000_organization_members_and_invitations.sql`, applied only in disposable local PostgreSQL tests. No hosted database or SDAIA script was used. Local checks: 27 API, 12 DB, 7 web unit, 8 browser tests; API build and type checks passed. Native Prisma runtime remains blocked by binaries.prisma.sh. The final web production build now passes using the same approved font families hosted locally; see docs/organization-members-verification.md. See docs/organization-members.md before running tests or setup.

Follow-up review preserved all existing local work. Membership mutations now reject zero-row RLS results; role-change feedback survives list refresh. Invitation fragment changes are handled in the same tab, and invalid new links clear any older saved token. Added regression coverage and updated NEXT_SESSION_PROMPT.md to retain the feature branch and isolated testing scope. The 11 database tests were previously passed; SQL was unchanged in this follow-up.


Full local verification follow-up: all migrations/seed applied to a separate Supabase stack (`MIDAN_members_integration`), with no repository/shared Auth configuration changes. Eight connected checkpoints passed using actual Next/Nest, local Auth confirmation emails, Mailpit SMTP and restricted Prisma/PostgreSQL access. The opt-in `scripts/verify-members-local.cjs` runner records this workflow; read docs/organization-members.md for side effects, local-only guards and the JS-engine/error-adapter testing caveat. The native Prisma engine is still network-blocked; the production web build now passes with local approved fonts; external SMTP delivery remains untested.

Final verification: see docs/organization-members-verification.md. API 27, database 12 (including expiry while waiting on a lock), browser contracts 8, web unit 7, AI 23, and eight real local journey checkpoints passed. API/web builds and workspace type checks passed; production English/Arabic pages loaded the actual approved local font faces without external requests. Existing dependency audit findings match the baseline (24 total, 4 high); native Prisma, legacy team-fixture suites and real provider delivery remain explicitly unverified. No commit/push/merge.

## Invitation review fixes

The latest follow-up closes pre-accepted INSERTs at the DB trigger level and completes invited signup through real local email confirmation/new-tab return, without creating an independent organization. Context is held in an expiring HttpOnly cookie, validated server-side, and cleared on acceptance/invalidity/expiry. The limited anonymous inspection endpoint returns expiry only. See docs/organization-invitation-fixes.md for current checks and limits; native Prisma remains unverified. All application data/config changes were confined to isolated local Supabase. No commit/push/merge.
