# Handoff

**Branch:** `main`. **Remote:** https://github.com/shmuhaisin/MIDAN (public).

## What exists
- `apps/web` (port 3100): public pages, sign-in, registration, opportunities, job details, candidate dashboard, profile, organization creation and dashboard. Talks only to the API and, on the server, to Supabase Auth.
- `apps/api` (port 4000): Prisma on the live database as restricted role `midan_api`, rate limited. Endpoints for health, `me`, profile, jobs, applications, organizations and job status. Swagger at `/docs`.
- `services/ai`: `GET /health` and a LangGraph wiring check only. **Not** Graph A or B, and its in-memory checkpointer must not be reused for them.

## Supabase
Project `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`, region `eu-central-1`, $0/month. See [docs/database/README.md](docs/database/README.md). The unrelated project `ALNADA` in the same organization must not be touched.

27 tables, all with RLS. 3 buckets. 5 test accounts (`midan.test.*@example.com`) whose passwords exist only in the local `.env.test.local`. `.env` and `.env.test.local` are git-ignored and exist only on this machine: a new checkout must regenerate them with `scripts/provision-db-credentials.mjs`.

Not reachable with the available tools; needs the dashboard: custom SMTP, leaked password protection, Auth Site URL and redirect URLs. The owner chose to continue without SMTP for now, so confirmation email is limited to what Supabase's built-in sender allows. The default Site URL points at localhost:3000, which is a different app on this machine, so confirmation links land there until it's changed to port 3100.

## Tests that were run
- API, live database: 33 end-to-end tests. API unit: 2, including rate limiting. Real server boot.
- Browser (Playwright, live database): 7 journeys, including the full organization and candidate journey, cross-tenant refusal, and product screens in all 4 language and theme combinations at desktop and phone width with no console errors.
- Web: type check, production build, message parity (3). AI: pytest (2).
- By eye: dashboard, organization and job screens; the error page with the API stopped.

## Not checked
- **Signing in through the form with a real account, sign-up, and email confirmation.** Automation sets session cookies instead. Wrong-password and validation errors were tested.
- Session renewal in `proxy.ts` has not been exercised with a truly expired token.
- No automated accessibility audit. Arabic copy has not been reviewed by a native editor.

## Known gaps
`npm audit` reports a high-severity finding in the Prisma CLI's `deepmerge-ts` (see docs/DECISIONS.md). Candidate account deletion is blocked once they've applied, pending a PDPL erasure design. Jobs have titles only in the UI. Section reveals start at opacity 0, so that content needs JavaScript to appear; fix before launch. No ESLint (`lint` runs `tsc`), no CI, no `packages/*`, no docker-compose. See PROJECT_STATUS.md.

## Next
Finish the profile and organization details, then Milestone 5, the assessment engine. See NEXT_SESSION_PROMPT.md.
