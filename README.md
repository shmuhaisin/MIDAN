# الميدان يا حميدان | Al-Midan Ya Hamidan

AI-assisted talent assessment and development through practical work simulations. Bilingual (Arabic first), B2B2C.

Current state: **core MVP workflows work with fictional data, in demo AI mode**. Public registration is closed; development sign-up uses real Supabase Auth. The Humaidan chat is postponed. See [PROJECT_STATUS.md](PROJECT_STATUS.md).


## Layout

| Path | What | Stack |
| --- | --- | --- |
| `apps/web` | Public site and, later, the product UI | Next.js 16, React 19, Tailwind 4, next-intl, next-themes, Motion |
| `apps/api` | Core API: auth, organizations, jobs, assessments, attempts, evaluations, reports | NestJS 11, Prisma 6, Swagger |
| `services/ai` | Private AI service: assessment builder and evaluation graphs | Python 3.12, FastAPI, LangGraph |
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
cd services/ai && uv sync && uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000
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

Browser journeys, with the web app, API and AI service running:

```bash
npm run test:e2e -w @midan/web
```

The sign-up and sign-in forms, which start their own servers against a local Auth stand-in:

```bash
npm run test:forms -w @midan/web
```

## Design tokens

All colors live in `apps/web/src/app/globals.css`. Components use semantic tokens (`bg-background`, `text-muted`, `bg-primary`), which are defined separately for light and dark. The five brand colors are never referenced directly except for the `mint`, `ivory` and `forest` utilities on surfaces that stay deep in both themes.

Humaidan's images are in `apps/web/public/assets/humaidan/` with their original filenames. Always render them through the `Humaidan` component, and get a variant only from `resolveHumaidan` in `apps/web/src/lib/humaidan.ts`. Specialized outfits appear only inside assessments. Rules: [docs/product/humaidan-assets-readme.txt](docs/product/humaidan-assets-readme.txt).
