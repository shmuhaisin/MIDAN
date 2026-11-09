# Local development on Windows (no WSL, no Docker)

The whole local stack runs natively on Windows 11: PostgreSQL, the real Supabase Auth (GoTrue) and PostgREST, the local
storage and mail gateway, the AI service, the API and the web app. Verified on 2026-11-09 with Node 22.19, Python 3.14,
PostgreSQL 18.3, Git Bash and Windows PowerShell 5.1. Everything here is local; nothing touches a hosted project.

## Every day: one command

From PowerShell at the repository root:

```bash
powershell -ExecutionPolicy Bypass -File scripts\local-up-windows.ps1
```

It loads `.env`, then starts whatever isn't running yet — PostgreSQL, local Supabase, the AI service, the API, the web
app — in the background (they keep running after the window closes), waits until each answers, and prints the URLs.
Anything already running is left alone, and **nothing else is ever stopped**: if a port is taken by another program, it
says which program (PID and command line) and stops. Logs are in `.local\logs`. Open http://localhost:3100.

## Ports

All ports come from `scripts/local-ports.mjs`: the environment, then `.env` (written by `scripts/local-env.mjs`), then:

| Setting | Default | What |
| --- | --- | --- |
| `LOCAL_PG_PORT` | 54323 | PostgreSQL (`scripts/local-db.sh`) |
| `LOCAL_SUPABASE_PORT` | 54321 | the gateway: Auth, Data API, Storage, `/__mail` (`NEXT_PUBLIC_SUPABASE_URL`) |
| `LOCAL_SMTP_PORT` | 54326 | the mail sink; Supabase Auth's `GOTRUE_SMTP_PORT` is the same value |
| `LOCAL_AUTH_PORT` | 54329 | Supabase Auth behind the gateway |
| `LOCAL_REST_PORT` | 54328 | PostgREST behind the gateway |
| — | 8000 / 4000 / 3100 | AI service / API / web |

54322 (the old database default) is often taken on Windows by another PostgreSQL; the default is now 54323. To check
the Supabase ports without starting anything:

```bash
node scripts/local-supabase.mjs check
```

It exits 0 when every port is free and the database answers; otherwise it lists each taken port with the program holding
it, and stops nothing. To use other ports, set them in `.env` (or the environment) and rerun `node scripts/local-env.mjs
--force` so the app's URLs follow.

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

Start the gateway in a second Git Bash window (or run the PowerShell launcher, which starts it in the background):

```bash
node scripts/local-supabase.mjs
```

Then, once, the local `.env` files with test accounts (each signs up and follows the real verification email from the
mail sink), the seed, and the official data:

```bash
node scripts/local-env.mjs --force
```

```bash
scripts/local-db.sh psql -f supabase/seed.sql
```

```bash
node scripts/import-data.mjs --sectors "data/source/بيانات القطاعات.zip" --employers data/source/ALMIDAN_Employer_Database_10_Entities.xlsx
```

`import-data.mjs` runs Python through `uv` (on `PATH`; the one in `.local\ai-venv\Scripts` works). `local-env.mjs --force`
keeps AI, calendar and video credentials already in `.env`.

The AI service uses `.local\ai-venv` when it exists (a Python 3.12+ environment with `services/ai` installed), otherwise
`uv run`. To check real AI inference (translation, assessment generation), add `AI_PROVIDER=groq`, `GROQ_API_KEY` and
`GROQ_MODEL` to `.env` and restart the AI service.

## Known Windows problems and their fixes

- **Arabic stored garbled / `normalize_arabic` fails with "invalid character range" / "byte sequence 0x81 ... WIN1252".**
  psql read the UTF-8 migrations in the console's legacy code page. `scripts/local-db.sh` now sets
  `PGCLIENTENCODING=UTF8`. A database migrated before that fix can hold garbled Arabic in the functions migrations
  created: compare it with a correctly built one, or recreate the affected function from its migration file with
  `scripts/local-db.sh psql -f supabase/migrations/<file>.sql` (2026-11-09: only `public.normalize_arabic`, from
  `20261106005417_fix_normalize_arabic.sql`, was affected).
- **"port 54325/54321 is already in use".** An earlier run of `local-supabase.mjs` is still running, or another program
  holds the port. `node scripts/local-supabase.mjs check` names it; end that run, or choose other ports.
- **PostgREST exits at once (exit 127).** It needs `libpq.dll`; `local-supabase.mjs` puts PostgreSQL's `bin` on its
  `PATH` automatically.
- **Python prints `UnicodeEncodeError`.** Run it with `-X utf8` (the scripts do).

## What differs from Linux and macOS

- `scripts/local-db.sh`: on Git Bash it uses PostgreSQL's builtin `C.UTF-8` locale and TCP only (no `/tmp` socket).
- `scripts/local-supabase.mjs`: `.exe` names, and PostgreSQL's `bin` folder on PostgREST's `PATH` (it loads `libpq.dll`).
- `scripts/local-env.mjs`, `scripts/import-data.mjs`: file paths from `fileURLToPath`, and Python output forced to UTF-8
  (`-X utf8`), since Windows otherwise writes Arabic through a legacy code page.
- `scripts/local-up-windows.ps1`: the Windows launcher (Linux and macOS use `scripts/demo-up.sh` or the commands above).

Each change leaves Linux and macOS behaviour as it was.
