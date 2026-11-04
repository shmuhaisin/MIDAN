# Handoff

**Branch:** `main`. **Remote:** https://github.com/shmuhaisin/MIDAN (public).

## What exists
- `apps/web`: 7 public page types in 2 languages, on port 3100. Not yet connected to the API or Supabase Auth.
- `apps/api`: Prisma on the live database as restricted role `midan_api`. Endpoints: `/v1/health`, `/v1/health/db`, `/v1/me`, `/v1/me/candidate-profile`, `/v1/me/applications`, `/v1/jobs`, `/v1/jobs/:id`, `/v1/jobs/:id/applications`, `/v1/organizations`, `/v1/organizations/:id/jobs`, `/v1/organizations/:id/applications`, `/v1/applications/:id/status`. Swagger at `/docs`. No rate limiting yet.
- `services/ai`: `GET /health` and a LangGraph wiring check only. **Not** Graph A or B, and its in-memory checkpointer must not be reused for them.

## Supabase
Project `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`, region `eu-central-1`, $0/month. See [docs/database/README.md](docs/database/README.md). The unrelated project `ALNADA` in the same organization must not be touched.

27 tables, all with RLS. 3 buckets. 5 test accounts (`midan.test.*@example.com`) whose passwords exist only in the local `.env.test.local`. `.env` and `.env.test.local` are git-ignored and exist only on this machine: a new checkout must regenerate them with `scripts/provision-db-credentials.mjs`.

Not reachable with the available tools; needs the dashboard: custom SMTP (required before real sign-up), leaked password protection, Auth redirect URLs.

## Tests that were run
- API, live database: 31 end-to-end tests, passing on 3 consecutive runs.
- API: real server boot, `/v1/health/db`, `/v1/jobs`, 401 on `/v1/me` without a token, Swagger 200.
- API unit: 1. Web: type check, message parity (3). AI: pytest (2).
- Browser: `/ar/how-it-works` rendered; all 14 locale routes return 200 from the dev server.
- Supabase security advisor: no RLS findings. 4 expected warnings for deliberate RPCs, 1 for leaked password protection.

## Not checked
- Not every page was inspected by eye in all four combinations; the home page was.
- No automated accessibility audit or end-to-end suite. Arabic copy has not been reviewed by a native editor.

## Known gaps
Sign-up with email confirmation is untested. `npm audit` reports a high-severity finding in the Prisma CLI's `deepmerge-ts` (see docs/DECISIONS.md). Candidate account deletion is blocked once they've applied, pending a PDPL erasure design. An evaluation result can currently be created before the attempt is submitted, within the same organization. Section reveals start at opacity 0, so that content needs JavaScript to appear; fix before launch. No ESLint (`lint` runs `tsc`), no CI, no `packages/*`, no docker-compose. See PROJECT_STATUS.md.

## Next
Milestone 3: connect the web app to Supabase Auth and replace `/get-started` with real registration. See NEXT_SESSION_PROMPT.md.
