# Local development

Everything runs on one machine, with no hosted service and no Docker. Nothing here touches the Supabase project.

| Piece | Local | Port |
| --- | --- | --- |
| Database | PostgreSQL 16, with `supabase/local/*.sql` providing the Supabase roles, `storage` schema and `auth` helpers the migrations need | 54322 |
| Auth | The real Supabase Auth server (GoTrue), verification on, emails captured | via 54321 |
| Data API | The real PostgREST server | via 54321 |
| Storage | `scripts/local-supabase.mjs`, which writes rows as the caller so the storage policies decide | via 54321 |
| Mail | A sink in `scripts/local-supabase.mjs`; read verification links at http://localhost:54321/__mail | 54325 |
| Core API | NestJS | 4000 |
| AI service | FastAPI, with LangGraph checkpoints in Postgres | 8000 |
| Web | Next.js | 3100 |

## First time, or to start over

On macOS (tested on arm64 with Homebrew): `brew install postgresql@16 postgrest go`, then build Auth v2.177.0 from https://github.com/supabase/auth, and put the binary as `.local/bin/auth`, its `migrations` folder as `.local/bin/migrations`, and `postgrest` as `.local/bin/postgrest`. Run with `PGBIN=/opt/homebrew/opt/postgresql@16/bin`. Homebrew's PostgREST is newer than the v12.2.3 the Linux script pins. Keep the checkout on a path without spaces: several scripts read theirs from `URL.pathname`.

Needs Node 20+, PostgreSQL 16 binaries, [uv](https://docs.astral.sh/uv/), and on Linux x86-64 nothing else (Auth and PostgREST are downloaded). For Arabic OCR of scanned CVs, install tesseract with the Arabic pack (`apt-get install tesseract-ocr tesseract-ocr-ara`).

```bash
npm install
```

```bash
scripts/local-setup.sh
```

This downloads Auth and PostgREST, creates the database and applies every migration, starts the Supabase gateway, writes `.env` and `.env.test.local`, creates the test accounts through real sign-up and verification, loads the demo seed and imports the official data from `data/source/`. It replaces local data.

## Every day

```bash
scripts/local-db.sh start
```

```bash
node scripts/local-supabase.mjs
```

```bash
cd services/ai && uv sync && uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000
```

```bash
npm run dev:api
```

```bash
npm run dev:web
```

New migrations: `scripts/local-db.sh migrate`. A database shell: `scripts/local-db.sh psql`.

## Accounts

Test accounts and their passwords are in `.env.test.local`. `midan.test.platform-admin@example.com` is a platform administrator; the admin area is at `/ar/admin`. Development sign-up works with the access code in `.env`; the verification email appears at http://localhost:54321/__mail.

## Tests

```bash
npm test && npm run lint
```

```bash
npm run test:e2e -w @midan/api
```

Stop any dev API first, or start it with `BACKGROUND_WORKER=off`: the queue test needs its own worker to be the only one. Don't set `BACKGROUND_WORKER=off` on the test command itself, because the suite waits for its own worker to finish CV analyses. Start from clean test data, since a repeat run fails on what the last one left behind:

```bash
scripts/local-db.sh psql -f supabase/test-cleanup.sql
```

`npm run test:live -w @midan/api` runs the whole journey with a model behind the AI service: see `docs/handoffs/MIDAN_LOCAL_WORKFLOW_STATUS.md`. `scripts/rehearse-migrations.sh` rehearses the hosted migrations and their rollback on PostgreSQL 17: see `docs/handoffs/MIDAN_PHASE_2_PREPARATION.md`.

The database-level security checks (candidate documents, status transitions, queue links) run in one transaction and roll back, so they leave nothing behind. Local database only:

```bash
scripts/local-db.sh psql -f supabase/tests/security_phase1.sql
```

Restart `node scripts/local-supabase.mjs` after pulling this change: its Storage stand-in gained the folder listing that the cross-employer document test uses.

A production web build must not contain the development sign-up code:

```bash
DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run build -w @midan/web
```

```bash
DEV_TEST_ACCESS_CODE=bundle-canary-7f3a npm run check:bundle -w @midan/web
```

```bash
cd services/ai && TEST_CHECKPOINT_DATABASE_URL=postgresql://midan_ai:midan-ai-local@127.0.0.1:54322/midan uv run pytest
```

The CSP check needs a production build, because development relaxes the policy (`npm run build -w @midan/web`, then `npm run start -w @midan/web`):

```bash
cd apps/web && npx playwright test e2e/security-headers.spec.ts
```

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell npm run test:e2e -w @midan/web
```

`CHROMIUM_PATH` is only needed where Playwright's own browser download isn't available. Use a headless shell build: with full Chromium, off-screen lazy images never load and one character test waits forever. After API tests, `scripts/local-db.sh psql -f supabase/test-cleanup.sql` removes their fixtures.

## Local-only values

The passwords, keys and JWT secret in `supabase/local/` and `scripts/local-*.mjs` are public, fixed and local. They are never used by a hosted environment.
