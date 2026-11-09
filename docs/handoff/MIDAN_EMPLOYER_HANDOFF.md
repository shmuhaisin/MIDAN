# MIDAN — Employer + Admin handoff

For the next developer or coding agent (Claude Code, Codex, Cursor…). No earlier conversation is needed.

1. Open the repository, switch to `feature/midan-employer-experience`, run `git status` and `git log -5`.
2. Read, in order: `docs/handoff/MIDAN_EMPLOYER_CURRENT_STATE.md` (architecture, what's built, decisions, blockers,
   commands), `docs/handoff/MIDAN_EMPLOYER_PROGRESS.md` (per-feature status), `docs/handoff/MIDAN_EMPLOYER_INTEGRATION_CONTRACT.md`
   (what the candidate side relies on), then `docs/handoff/MIDAN_TEAMMATE_HANDOFF.md` §E (Windows setup).
3. Compare them with the code; the code wins. Continue from "Next recommended task" in the current-state file.

## Implemented here (details in the current-state file)
- **Organization approval**: draft → pending_review → approved / changes_requested / rejected; suspended and reactivated by
  platform admins, every decision with reviewer, time, reason, audit row and notification. Approval gates publishing,
  applications, team invitations and public listing — in the database.
- **Admin console**: organizations queue with status counts and search, detail with private documents, decisions,
  suspension, review history and audit trail; overview counts.
- **Employer**: review page (profile, documents, submit, history), workspace banner until approved.
- **Automatic Arabic ↔ English translation** of job title, description and requirements with the live model (Groq, Gemini
  alternate); never overwrites what the employer wrote; honest "not available" without a model.
- **Interviews require a shortlisted candidate** (database rule).

## Frontend pages
`/[locale]/organization/[orgId]/verification`, `/[locale]/admin/organizations`, `/[locale]/admin/organizations/[id]`;
translation inside `/[locale]/organization/[orgId]/jobs?new=1` and the job page's details step.

## Backend APIs, database, permissions
Contract §4 (routes), current state §10–§12 (database, auth). Admin = `private.platform_admins` only; checked by the API
guard and inside every admin database function.

## Environment variable names
Current state §21. For real translation: `AI_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL` (optional alternate:
`GEMINI_API_KEY`, `GEMINI_MODEL`).

## Windows run
```bash
scripts/local-db.sh start
```
```bash
node scripts/local-supabase.mjs
```
```bash
cd services/ai && uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000
```
```bash
npm run dev:api
```
```bash
npm run dev:web
```
Web on http://localhost:3100, API on :4000/v1, emails at http://localhost:54321/__mail.

## Tests
```bash
npm run test:e2e -w @midan/api
```
```bash
npm test -w @midan/web
```
```bash
cd services/ai && uv run pytest -q
```
Results and known rerun-state failures: current state §19.

## Known blockers
AI key, SMTP, Google OAuth client (credentials); person-level account suspension and extra team roles (owner decisions);
hosted database has neither new migration (owner decision). Branch and commit: see current state §4 — **not committed yet**.
