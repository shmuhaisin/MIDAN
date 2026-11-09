# MIDAN architecture

## 1. Services

```
Browser ──► Web (Next.js 16, apps/web) ──► Core API (NestJS, apps/api) ──► PostgreSQL (Supabase) + Storage
                 │  server components and        │  /v1, Swagger at /docs          row-level security on every table
                 │  server actions only:          │
                 │  no keys in the browser        └──► AI service (FastAPI, services/ai), private, token-protected
                 └──► Supabase Auth (sign-in)              ├─ CV analysis (privacy filter first)
                                                           ├─ assessment generation + MIDAN Assessment Standard check
                                                           ├─ evaluation (proposals for human review)
                                                           ├─ requirement matching (lexical / e5-local / bge-m3-hosted)
                                                           └─ assistant answers (from supplied facts only)
External: Groq (LLM), Daily.co (video), Google Calendar, Hugging Face (only for bge-m3-hosted)
```

| Layer | Responsibility | Never does |
| --- | --- | --- |
| **Web** `apps/web` | Pages, interaction, Arabic/English, RTL/LTR, light/dark; calls the API with the session's token from the server | Talk to the database or the AI service directly; hold secrets |
| **Core API** `apps/api` | Authentication, roles, every read and write (`db.asUser` runs queries under the caller's RLS), integrations (Daily, Calendar), retrieval for the assistant, the background worker | Let the AI service decide anything |
| **AI service** `services/ai` | Analysis, proposals and answers from what it's given | Read the database (except its own checkpoints), act, or publish |
| **Database** `supabase/migrations` | Schema, RLS policies, guard triggers (status rules, hiring rules, shortlist for interviews), audit triggers | — |

## 2. Key flows

1. **Apply → assess:** `POST /jobs/:id/applications` snapshots the profile and assigns the job's approved assessments. Applying twice returns the existing application.
2. **Generate an assessment:**
   - `POST …/assessment/generate` runs the builder graph and stores a draft;
   - the Standard's quality report must be "ready" before people can approve it (`…/publish`).
3. **Evaluate:**
   - `POST /attempts/:id/evaluate` → proposals per criterion, with evidence quotes → `needs_human_review`;
   - a person reviews (`/evaluations/:id/review`) and releases.
4. **Match:** `GET …/applications/:id/match` → snapshot evidence and the job's requirements → AI `match/requirements` → proposals plus staff reviews.
5. **Ask:** `POST /me/assistant` or `/organizations/:id/assistant` → facts retrieved under RLS → AI `assistant/answer` → answer with cited facts and allow-listed links.
6. **Interview:** shortlisted only → Daily room on join (participants only) → Calendar event (`sendUpdates` set per environment).

## 3. Where to read more

| Topic | Document |
| --- | --- |
| API reference | Swagger at `/docs` on a running API (generated from the controllers) |
| Frontend ↔ backend contracts | `docs/design/MIDAN_FRONTEND_BACKEND_HANDOFF.md` |
| Feature coverage | `docs/design/MIDAN_FEATURE_COVERAGE.md` |
| Design system | `docs/design/MIDAN_DESIGN_SYSTEM.md` |
| Matching and model choice | `docs/ai/ATS_MATCHING.md` |
| Assessment standard | `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md` |
| Privacy (CV data flow) | `docs/privacy/cv-data-flow.md` |
| Security audit | `docs/security/SECURITY_AUDIT.md` |
| Backup, recovery, incidents | `docs/operations/` |
| Deployment | `docs/deployment.md` |
| Decisions | `docs/DECISIONS.md` |
| Investor demo | `docs/investor/INVESTOR_DEMO.md` |
