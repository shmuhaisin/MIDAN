# MIDAN company journey: setting up to continue the work

Branch `feature/midan-company-journey`. Read [MIDAN_COMPANY_JOURNEY_AUDIT.md](MIDAN_COMPANY_JOURNEY_AUDIT.md) first, then
[MIDAN_COMPANY_JOURNEY_REPORT.md](MIDAN_COMPANY_JOURNEY_REPORT.md) for what was done, what was tested and what's still open.

Nothing machine-specific is in the repository: no `.env`, no keys, no Python environment and no model files. Each
developer creates them locally. `.env`, `.env.*` and `.local/` are git-ignored, so keep them that way.

## 1. Node dependencies
```bash
npm ci
```

## 2. Local stack (never Supabase Cloud for tests)
Follow `docs/local-development-windows.md` (Windows) or `docs/local-development.md`. In short, from Git Bash:
```bash
scripts/local-tools-windows.sh        # Windows only: auth.exe and postgrest.exe into .local/bin
scripts/local-db.sh start             # PostgreSQL + every migration, including the three new local-only ones
node scripts/local-supabase.mjs       # leave running (second window)
node scripts/local-env.mjs --force    # writes .env and .env.test.local with local test accounts
scripts/local-db.sh psql -f supabase/seed.sql
node scripts/import-data.mjs --sectors "data/source/بيانات القطاعات.zip" --employers data/source/ALMIDAN_Employer_Database_10_Entities.xlsx
```
If another MIDAN stack already uses the default ports, set `LOCAL_PG_PORT`, `LOCAL_SUPABASE_PORT`, `LOCAL_SMTP_PORT`,
`LOCAL_AUTH_PORT` and `LOCAL_REST_PORT` in `.env` before `local-db.sh start`, then rerun `node scripts/local-env.mjs --force`.

## 3. AI service with the existing Hugging Face matching model
The ATS matching model is `intfloat/multilingual-e5-base` (`services/ai/midan_ai/matching.py`, `E5Local`). It's an
optional extra: about 800 MB of packages and a model download of about 1.1 GB, kept outside git.

With `uv` (what the project's scripts use):
```bash
cd services/ai
uv sync --extra matching
```
Without `uv` (what was used on Windows, Python 3.12 or later; on Python 3.14 install torch from the CPU index):
```bash
python -m venv .local/ai-venv
# services/ai is not an installable package ([tool.uv] package = false): install its dependencies from pyproject.toml
.local/ai-venv/Scripts/python -m pip install "fastapi>=0.115" "uvicorn>=0.30" "langgraph>=0.2" "pydantic>=2.8" "httpx>=0.28.1" "langgraph-checkpoint-sqlite>=3.1.3" "pypdf>=6.21.4" "pypdfium2>=5.14.0" "pillow>=13.0.0" "defusedxml>=0.7.1" "langgraph-checkpoint-postgres>=2.0" "psycopg[binary]>=3.2" "pytest>=8"
.local/ai-venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.local/ai-venv/Scripts/python -m pip install "sentence-transformers==3.4.1"
```
(On macOS or Linux the interpreter is `.local/ai-venv/bin/python`.)

Download the model once into the git-ignored `.local/hf`:
```bash
HF_HOME="$PWD/.local/hf" .local/ai-venv/Scripts/python -c "from huggingface_hub import snapshot_download; snapshot_download('intfloat/multilingual-e5-base')"
```
Then add to your own `.env`:
```
EMBEDDING_PROVIDER=e5-local
HF_HOME=<absolute path to the repository>/.local/hf
HF_HUB_OFFLINE=1
```
Start the AI service from `services/ai` (`uv run --extra matching --env-file ../../.env uvicorn midan_ai.main:app --port 8000`,
or the venv's python with `-m uvicorn midan_ai.main:app`). `GET /health` must report `"matching":"e5-local"`. If it reports
`lexical`, the packages or the model files weren't found, and every match then says `fallback` in its provenance.

Live AI (generation, interview questions, evaluation forms, development reports, skill reasons) needs your own
`AI_PROVIDER` and key in your own `.env`. Never reuse the demo's keys. Without a key the service runs in labelled demo
mode, and the new interview and report features refuse (503) instead of writing anything.

## 4. API and web
```bash
cd apps/api && npx prisma generate && npm run start:dev    # http://localhost:4000/v1
npm run dev:web                                            # http://localhost:3100
```

## 5. Checks
```bash
cd services/ai && uv run --extra matching pytest -q                                  # or the venv's python -m pytest -q
cd apps/api && npx jest                                                              # unit
cd apps/api && npx jest --config jest.e2e.json --runInBand --forceExit src/company-journey   # needs the local stack
node scripts/company-journey-acceptance.mjs                                          # the 18 acceptance steps; evidence in .local/acceptance/
```

## What still needs someone
- Live-model runs of steps 3, 4, 13, 14 and 18 (needs a key the owner provides).
- Google Calendar: `GOOGLE_CALENDAR_REFRESH_TOKEN`, and the owner's approval before any real invitation is sent.
- The homepage hiring number: not found. Ask the owner for a screenshot.
- The new migrations `20261113090000`, `20261113100000` and `20261113110000` are local only. Applying them to Supabase
  Cloud needs the owner's approval.
