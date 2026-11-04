# الميدان يا حميدان | Al-Midan Ya Hamidan

AI-assisted talent assessment and development through practical work simulations. Bilingual (Arabic first), B2B2C.

Current state: **Milestones 1 to 3 in part: public site, database, accounts, job browsing and applications**. Assessments, reports and the Humaidan assistant aren't built yet. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for what is and isn't built.

## Layout

| Path | What | Stack |
| --- | --- | --- |
| `apps/web` | Public site and, later, the product UI | Next.js 16, React 19, Tailwind 4, next-intl, next-themes, Motion |
| `apps/api` | Core API: auth, profile, organizations, jobs, applications | NestJS 11, Prisma 6, Swagger |
| `services/ai` | AI service (health endpoint and a LangGraph wiring check) | Python 3.12, FastAPI, LangGraph |
| `supabase/migrations` | Database migrations ([docs](docs/database/README.md)) | Supabase Postgres, Auth, Storage |

## Run

Needs Node 20+ and [uv](https://docs.astral.sh/uv/).

```bash
npm install
```

```bash
npm run dev:web
```

Web runs on http://localhost:3100, with routes under `/ar` and `/en`. Job and account pages need the API running too.

```bash
npm run dev:api
```

API runs on http://localhost:4000: `/v1/health`, `/v1/health/db`, with Swagger at `/docs`. It needs a `.env`: see [docs/database/README.md](docs/database/README.md).

```bash
cd services/ai && uv sync && uv run uvicorn midan_ai.main:app --port 8000
```

## Test

```bash
npm test && npm run lint
```

```bash
cd services/ai && uv run pytest
```

Against the live database (see the database docs first):

```bash
npm run test:e2e -w @midan/api
```

Browser journeys, with the web app and API running:

```bash
npm run test:e2e -w @midan/web
```

## Design tokens

All colors live in `apps/web/src/app/globals.css`. Components use semantic tokens (`bg-background`, `text-muted`, `bg-primary`), which are defined separately for light and dark. The five brand colors are never referenced directly except for the `mint`, `ivory` and `forest` utilities on surfaces that stay deep in both themes.

Humaidan's images are in `apps/web/public/assets/humaidan/` with their original filenames. Always render them through the `Humaidan` component, which keeps the full figure in frame. Rules: [docs/product/humaidan-assets-readme.txt](docs/product/humaidan-assets-readme.txt).
