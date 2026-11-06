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

Needs Node 20+, PostgreSQL 16 binaries, [uv](https://docs.astral.sh/uv/), and on Linux x86-64 nothing else (Auth and PostgREST are downloaded). For Arabic OCR of scanned CVs, install tesseract with the Arabic pack (`apt-get install tesseract-ocr tesseract-ocr-ara`).

```bash
npm install
```

```bash
scripts/local-setup.sh "<folder or .zip of sector workbooks>" "<ALMIDAN_Employer_Database_10_Entities.xlsx>"
```

This downloads Auth and PostgREST, creates the database and applies every migration, starts the Supabase gateway, writes `.env` and `.env.test.local`, creates the test accounts through real sign-up and verification, loads the demo seed and imports the official data. It replaces local data.

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

Stop the dev API first (or start it with `BACKGROUND_WORKER=off`): the queue test needs its own worker to be the only one.

```bash
cd services/ai && TEST_CHECKPOINT_DATABASE_URL=postgresql://midan_ai:midan-ai-local@127.0.0.1:54322/midan uv run pytest
```

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell npm run test:e2e -w @midan/web
```

`CHROMIUM_PATH` is only needed where Playwright's own browser download isn't available. Use a headless shell build: with full Chromium, off-screen lazy images never load and one character test waits forever. After API tests, `scripts/local-db.sh psql -f supabase/test-cleanup.sql` removes their fixtures.

## Local-only values

The passwords, keys and JWT secret in `supabase/local/` and `scripts/local-*.mjs` are public, fixed and local. They are never used by a hosted environment.
