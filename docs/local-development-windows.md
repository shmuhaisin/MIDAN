# Local development on Windows (no WSL, no Docker)

The whole local stack runs natively on Windows 11: PostgreSQL, the real Supabase Auth (GoTrue) and PostgREST, the local
storage and mail gateway, the AI service, the API and the web app. Verified on 2026-11-09 with Node 22, Python 3.14,
PostgreSQL 18, Git Bash. Everything here is local; nothing touches a hosted project.

## One-time setup

From Git Bash at the repository root:

```bash
scripts/local-tools-windows.sh
```

It puts `postgrest.exe` (official Windows release) and `auth.exe` (Supabase Auth `v2.177.0`, built from its tagged
source with a portable Go whose checksum is checked) in `.local/bin`. Supabase doesn't ship Auth for Windows; the only
change needed is one Unix-only socket option (`SO_REUSEPORT`), moved into build-tagged files so Unix keeps it unchanged.

Then the database (PostgreSQL 17 or later is used on Windows for its builtin `C.UTF-8` locale; the newest one installed
under `C:\Program Files\PostgreSQL` unless `PGBIN` is set):

```bash
scripts/local-db.sh start
```

Run the gateway (Auth, PostgREST, storage, mail sink on `http://localhost:54321`):

```bash
node scripts/local-supabase.mjs
```

Then, once, the local `.env` files with test accounts, the seed and the official data (needs `uv` on `PATH`):

```bash
node scripts/local-env.mjs --force
```

```bash
scripts/local-db.sh psql -f supabase/seed.sql
```

```bash
node scripts/import-data.mjs --sectors "data/source/بيانات القطاعات.zip" --employers data/source/ALMIDAN_Employer_Database_10_Entities.xlsx
```

## Running the apps

AI service (a Python environment from `services/ai/uv.lock`; `uv sync` works too):

```bash
cd services/ai && uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000
```

API and web, from the repository root:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Emails Auth sends (verification, recovery) are at `http://localhost:54321/__mail`.

## What differs from Linux and macOS

- `scripts/local-db.sh`: on Git Bash it uses PostgreSQL's builtin `C.UTF-8` locale and TCP only (no `/tmp` socket).
- `scripts/local-supabase.mjs`: `.exe` names, and PostgreSQL's `bin` folder on PostgREST's `PATH` (it loads `libpq.dll`).
- `scripts/local-env.mjs`, `scripts/import-data.mjs`: file paths from `fileURLToPath`, and Python output forced to UTF-8
  (`-X utf8`), since Windows otherwise writes Arabic through a legacy code page.

Each change leaves Linux and macOS behaviour as it was.
