# Handoff

**Branch:** `main`. **Remote:** https://github.com/shmuhaisin/MIDAN (public).

## What exists
- `apps/web` (port 3100): public pages, role-aware auth, opportunities, candidate dashboard, profile, branded assessment experience, candidate report, organization dashboard, branding settings, job workspace, review.
- `apps/api` (port 4000): the Core API, on the live database as restricted role `midan_api`, rate limited. Swagger at `/docs`.
- `services/ai` (port 8000): private FastAPI and LangGraph service, reached only by the API with a shared token. Graph A drafts from approved templates and no LLM. Graph B has Gemini and OpenAI providers, never run for lack of a key, and otherwise a labeled demo heuristic. Checkpoints are in a local SQLite file, not production-ready.

All three must run together. Humaidan rules are in `apps/web/src/lib/humaidan.ts`.

## Supabase
Project `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`, region `eu-central-1`, $0/month. See [docs/database/README.md](docs/database/README.md). The unrelated project `ALNADA` in the same organization must not be touched.

28 tables, all with RLS. 3 buckets. 5 test accounts (`midan.test.*@example.com`) whose passwords exist only in the local `.env.test.local`. `.env` and `.env.test.local` are git-ignored and exist only on this machine: a new checkout must regenerate them with `scripts/provision-db-credentials.mjs`.

Not reachable with the available tools; needs the dashboard: custom SMTP, leaked password protection, Auth Site URL and redirect URLs. The owner chose to continue without SMTP for now, so confirmation email is limited to what Supabase's built-in sender allows. The default Site URL points at localhost:3000, which is a different app on this machine, so confirmation links land there until it's changed to port 3100.

## Tests that were run
- API, live database, real AI service: 44 end-to-end. API unit: 2.
- Browser (Playwright, live database): 9 journeys, including the whole flow from job to released report, and 6 character tests covering all 17 Humaidan scenarios by checking the actual image files.
- AI: 23, including interrupt and resume, bounded repair, deterministic scoring, invented evidence, prompt injection.
- Web: type check, production build, 7 unit tests.
- By eye: login, employer login, assessment screens (legal, technology on mobile), home, review, report.

## Not checked
- **Signing in through the form with a real account, sign-up, and email confirmation.** Automation sets session cookies instead. Wrong-password and validation errors were tested.
- Any real LLM provider; no key is configured.
- A next-themes script warning can appear in development on client navigation. A red dev badge appeared in one earlier screenshot and did not recur once the journey failed on console errors, so its cause wasn't confirmed.
- Session renewal in `proxy.ts` has not been exercised with a truly expired token.
- No automated accessibility audit. Arabic copy has not been reviewed by a native editor.

## Known gaps
`npm audit` reports a high-severity finding in the Prisma CLI's `deepmerge-ts` (see docs/DECISIONS.md). Candidate account deletion is blocked once they've applied, pending a PDPL erasure design. The Humaidan chat assistant doesn't exist yet. Section reveals start at opacity 0, so that content needs JavaScript to appear; fix before launch. No ESLint (`lint` runs `tsc`), no CI, no `packages/*`, no docker-compose. See PROJECT_STATUS.md.

## Next
Build the Humaidan assistant. See NEXT_SESSION_PROMPT.md.
