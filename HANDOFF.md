# Handoff

**Branch:** `feat/job-requirements-foundation`, local and unmerged. `main` doesn't have this work, but the live database already has its migration. **Remote:** https://github.com/shmuhaisin/MIDAN (public).

## What exists
- `apps/web` (port 3100): public pages, role-aware auth, opportunities, candidate dashboard, profile, branded assessment experience, candidate report, organization dashboard, branding settings, job workspace, review.
- `apps/api` (port 4000): the Core API, on the live database as restricted role `midan_api`, rate limited. Swagger at `/docs`.
- `services/ai` (port 8000): private FastAPI and LangGraph service, reached only by the API with a shared token. Graph A drafts from approved templates and no LLM. Graph B has Gemini and OpenAI providers, never run for lack of a key, and otherwise a labeled demo heuristic. Checkpoints are in a local SQLite file, not production-ready.

All three must run together. Humaidan rules are in `apps/web/src/lib/humaidan.ts`.

## Supabase
Project `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`, region `eu-central-1`, $0/month. See [docs/database/README.md](docs/database/README.md). The unrelated project `ALNADA` in the same organization must not be touched.

30 tables, all with RLS. 3 buckets. 5 test accounts (`midan.test.*@example.com`) whose passwords exist only in the local `.env.test.local`. `.env` and `.env.test.local` are git-ignored and exist only on this machine: a new checkout must regenerate them with `scripts/provision-db-credentials.mjs`.

Not reachable with the available tools; needs the dashboard: custom SMTP, leaked password protection, Auth Site URL and redirect URLs. The owner chose to continue without SMTP for now, so confirmation email reaches only Supabase project team members, a few per hour. The default Site URL points at localhost:3000, which is a different app on this machine, so confirmation links land there until it's changed to port 3100.

## Tests that were run
- API, live database, real AI service: 59 end-to-end, 7 of them for job requirements. API unit: 7.
- Browser (Playwright, live database): 16 journeys, including the whole flow from job to released report and the requirements flow from form to public page, and 6 character tests covering all 17 Humaidan scenarios by checking the actual image files. Forms against a local Auth stand-in: 6.
- AI: 23, including interrupt and resume, bounded repair, deterministic scoring, invented evidence, prompt injection.
- Web: type check, production build, 7 unit tests.
- By eye: job requirements in Arabic, profile, applicant profile, login, employer login, assessment screens (legal, technology on mobile), home, review, report.

## Not checked
- **A complete real sign-up with a real email and link.** Automation doesn't type passwords into pages that send them to hosted Auth, and doesn't email real inboxes. Forms are tested against a local stand-in in `apps/web/e2e-forms`, and the rest against real Supabase separately.
- Any real LLM provider; no key is configured.
- The cause of intermittent 20-second database stalls on the local connection to Frankfurt. A single retry handles them; a second expiry returns 503. Long test runs also failed when the Mac slept (`ERR_NETWORK_IO_SUSPENDED`, connect timeouts); they pass when it stays awake. Hosted reliability hasn't been measured.
- Session renewal in `proxy.ts` has not been exercised with a truly expired token.
- No automated accessibility audit. Arabic copy has not been reviewed by a native editor.

## Known gaps
`npm audit` reports a high-severity finding in the Prisma CLI's `deepmerge-ts` (see docs/DECISIONS.md). Candidate account deletion is blocked once they've applied, pending a PDPL erasure design. The Humaidan chat is postponed by the owner. Section reveals start at opacity 0, so that content needs JavaScript to appear; fix before launch. No ESLint (`lint` runs `tsc`), no CI, no `packages/*`, no docker-compose. See PROJECT_STATUS.md.

## Next
The job data work continues: several assessments per job in the API and screens, assessment drafts built from requirements, then imports. See NEXT_SESSION_PROMPT.md.
