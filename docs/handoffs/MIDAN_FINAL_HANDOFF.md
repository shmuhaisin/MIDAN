# MIDAN final handoff (2026-11-10)

Branch `feature/midan-product-experience`. Final commit: see the last section. Machine: the owner's Mac (Apple M2, 8 GB),
worktree `~/MIDAN-product-experience`, local stack only. Nothing was deployed and nothing was changed in Supabase Cloud.

**How to read this.** "Verified" means it was run on this machine in this session and the result is quoted. "Reported"
means another session recorded it in `docs/handoff/MIDAN_PRODUCT_EXPERIENCE_STATUS.md` (written in a different environment,
author not confirmed; its database port and integration keys differ from this machine's) and it was not re-run here. "Not
verified" means nobody has run it. All test data is fictional; assessment sample data is synthetic and labelled so.

Three sessions worked on this branch today: this one ("MIDAN developer handoff"), a local session ("MIDAN product
experience continuation", which made `5e4fe70` … `cfdb088` and is idle), and a claude.ai cloud session (commits signed with a
`Claude-Session` link, from `855154e` to `72619bf`), which could not be reached to coordinate. Every merge kept both sides;
nothing was forced, reset or rewritten.

## 1. Architecture and services

| Service | Code | Local URL | Run |
| --- | --- | --- | --- |
| Web (Next.js 16, React 19, next-intl, Tailwind 4) | `apps/web` | http://localhost:3100/ar, http://localhost:3100/en | `npm run dev:web` |
| Core API (NestJS 11, Prisma 6, Swagger) | `apps/api` | http://localhost:4000/v1/health, docs at http://localhost:4000/docs | `npm run dev:api` (rebuilds, doesn't reload: restart after API changes) |
| AI service (FastAPI, LangGraph, Python 3.12) | `services/ai` | http://localhost:8000/health (token-protected otherwise) | `cd services/ai && uv run --extra matching --env-file ../../.env uvicorn midan_ai.main:app --port 8000` |
| PostgreSQL 16 (Supabase schema, roles and RLS) | `supabase/migrations` (65), `supabase/local` | 127.0.0.1:54533 | `scripts/local-db.sh start` |
| Supabase gateway: real GoTrue Auth, PostgREST, Storage stand-in, mail sink | `scripts/local-supabase.mjs` | http://localhost:54521, mail at http://localhost:54521/__mail | `node scripts/local-supabase.mjs` |

Ports on this machine come from `.local/ports.env` and `.env` (`LOCAL_PG_PORT`, `LOCAL_SUPABASE_PORT`, …). **One command
for everything on this machine: `bash .local/up.sh`** (starts what isn't running and waits until each answers).
`scripts/dev-all.sh` is the repository's general launcher (`--stop` to stop). The API reaches the AI service with
`AI_SERVICE_TOKEN` in the `x-service-token` header; the web app reaches only the API.

## 2. AI models and providers

| Use | Provider / model | State on this machine |
| --- | --- | --- |
| ATS stage 1: retrieval | `intfloat/multilingual-e5-base`, local CPU, offline (`.local/hf`, git-ignored) | **Verified** |
| ATS stage 2: rerank | `BAAI/bge-reranker-v2-m3` (Apache-2.0), local CPU, offline | **Verified**; default (`EMBEDDING_PROVIDER=e5-rerank`) |
| ATS stage 3, assessment generation, requirement suggestions, interview questions and form, development reports, career readiness, Humaidan | Groq `openai/gpt-oss-120b` (`AI_PROVIDER=groq`) | **Live**, free (`on_demand`) tier: 8,000 tokens a minute, 200,000 a day, shared by every feature and possibly by other sessions using the same key |
| Without a model | none | Each live feature answers 503 / "not available" and stores nothing; no template or fake result is shown as AI |

Benchmark of stage 2 (this machine, `services/ai/bench/reranker_bench.py`): top-1 evidence 0.889 vs e5's 0.667, MRR 0.944 vs
0.779, cross-language AUC 0.966 vs 0.919, false positives/negatives 17/21 vs 26/25, about 1.5 GB, 0.3 to 0.4 s per 8-line
request. Details and decisions: `docs/ai/ATS_MATCHING.md`. The Docker image (`services/ai/Dockerfile`) installs CPU-only
PyTorch and bakes both models in at pinned revisions (`services/ai/fetch_models.py`); **`docker build` was not run** (no Docker
on this machine).

## 3. Feature status

Columns: **Impl.** Implemented / Partial / Not implemented. **State** Working / Broken / Blocked / Not verified. FE, BE, AI, DB:
the layer's state. Paths are the main ones.

### Employer

| Feature | Impl. | State | FE | BE | AI | DB | Tests performed and actual results | Errors / blockers | Next action | Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Representative registration, admin approval, shared workspace | Implemented | Working | ok | ok | n/a | ok | **Verified**: acceptance step 1 passed (two representatives approved by a platform admin share one STC workspace, registry name and website). E2E: see §6 | Real email delivery not configured (sink only) | — | `apps/api/src/admin`, `apps/api/src/organizations`, migration `20261112090000` |
| Company onboarding (save and advance, inputs kept, real errors) | Implemented | Working (reported) | ok | ok | n/a | ok | Reported: `company-setup.spec` (Chromium) passes; a logo chosen while loading was dropped, fixed `9f6546a` | — | Re-run `npx playwright test e2e/company-setup.spec.ts` in `apps/web` | `apps/web/src/app/[locale]/organization/[orgId]/setup` |
| Logo palette extraction, light/dark, approval | Implemented | Working (reported) | ok | ok | n/a | ok | Reported: same suite, two companies, each in its own palette | — | — | migration `20261114090000`, `apps/web/src/lib` |
| Company-specific branding (jobs, assessments, charts) | Implemented | Working | ok | ok | n/a | ok | **Verified**: acceptance step 5 "published with the workspace's logo and colour"; reported theme audit 160 renders, 0 contrast failures | — | — | `05ff0fd`, `apps/web/src/components` |
| Company dashboard and pages | Implemented | Working (smoke) | ok | ok | n/a | ok | **Verified**: every `organization/*` route answers (307 to login when signed out, no 500) | Signed-in rendering not re-checked here | Browser pass signed in | `apps/web/src/app/[locale]/organization` |
| Job creation | Implemented | Working | ok | ok | n/a | ok | **Verified**: acceptance step 2 (job with 4 approved requirements) | — | — | `apps/api/src/jobs` |
| AI requirement suggestions with reasons; edit, remove, approve | Implemented | **Working live** | ok | ok | live | ok | **Verified live**: acceptance step 3 passed: 6 suggestions, 6 with reasons (`ai_suggestions_v1`), 5 kept, 1 removed, 1 own skill added | Groq quota | — | `bab5141`, `services/ai/midan_ai/skills.py`, migration `20261116100000` |
| Assessment generation (company-specific case, bilingual, rubric) | Implemented | **Blocked** | ok | ok | blocked | ok | **Verified live, twice**: (1) STC Data Analyst generated live; MIDAN's MAS-1.0 gate **blocked** it, 8 errors (rubric 95 not 100, calculations without inputs, reference figures that don't match, no churn column in the synthetic data); repair refused because the whole draft can't fit 8,000 tokens a minute. (2) In the acceptance run, part 1 stopped at Groq's output limit twice: no draft | Groq free-tier per-minute limit; generation quality (`gpt-oss-120b`) | Owner: Groq Dev tier or another provider. Code: a targeted repair for rubric totals; the 4-part generation (`c7aecdb`, `7ff659a`, `6bb3afb`) arrived after run (2) and is untested live | `services/ai/midan_ai/assessment_builder.py`, `providers.py`, `standard.py`, `scripts/stc-assessment-live.mjs` |
| Assessment approval before publishing | Implemented | Working | ok | ok | n/a | ok | **Verified** (demo run): publishing before approval refused (422), after approval published. E2E: §6 | — | — | migration `20261113090000` |
| Applications and CV management (CV library, chosen CV, per-application copy) | Implemented | Working | ok | ok | local reading | ok | **Verified** (demo run): 4 fictional CVs read, approved by each candidate, 4 applications. Reported: CV library e2e | — | — | `apps/api/src/me`, `apps/web/src/components/candidate.tsx` |
| Hybrid ATS stages 1+2 | Implemented | **Working** | ok | ok | live (local models) | ok | **Verified**: trace with real models, 1 e5 call and 12 cross-encoder pairs; acceptance step 7 passes with both models, no fallback; evidence-selection fix `16e384a` (Reem 33% → 60%, first) | Reranker "matched" threshold 0.02 lets a few weak lines confirm (needs the owner's recalibration decision) | Owner decision on 0.02 | `services/ai/midan_ai/matching.py`, `apps/api/src/applications/cv-match-store.ts` |
| Hybrid ATS stage 3 (structured, evidence-cited AI reading) | Implemented | **Working live** (AI service) | ok | ok | live | ok | **Verified live**: 2 fictional CVs × 5 requirements, 10 of 10 readings cite only real CV lines; trap requirements (Tableau 5 years, CCNA) read "missing"; disagreements with the matcher flagged for a person. Score untouched. Output `.local/stage3-live.txt` | Background store → applicant page not run live (acceptance stopped at step 4) | Re-run acceptance once generation works | `services/ai/midan_ai/cv_review.py`, `f96b871` |
| Candidate ranking (all applicants, missing ≠ 0, deterministic ties) | Implemented | Working | ok | ok | n/a | ok | **Verified** (demo-model run with real e5+reranker): 4 of 4 ranked, Reem 60, Omar 50, Faisal 50, Lama 0; no overall % (owner's decision: stages side by side) | — | — | `apps/api/src/applications/ranking.controller.ts` |
| Shortlisting and hiring decisions | Implemented | Working | ok | ok | n/a | ok | **Verified** (demo run): 2 shortlisted by a person; interview for a non-shortlisted candidate refused (422); hired and rejected by a person, others untouched | — | — | `apps/api/src/applications` |
| Interview scheduling (Riyadh time, shortlist only, no duplicates, reschedule, cancel) | Implemented | Working (stand-ins) | ok | ok | n/a | ok | **Verified** (demo run): interviews created, `calendar_status: not_configured` stated. Reported: reschedule/cancel against Google and Daily stand-ins | — | — | `apps/api/src/interviews`, `apps/web/src/lib/zoned-time.ts` |
| Google Calendar events and invitations | Implemented | **Blocked by configuration** | ok | ok | n/a | ok | Not run: `GOOGLE_CALENDAR_CLIENT_ID`, `_SECRET`, `_REFRESH_TOKEN` empty in this `.env` | Credentials, owner's approval for real invitations | `node scripts/google-calendar-token.mjs` | `apps/api/src/interviews` |
| Interview questions and evaluation form per candidate | Implemented | Not verified live | ok | ok | live, untested | ok | Demo run: refused with 503 `not_configured` (correct without a model). Live: not reached | Groq quota; acceptance stopped at step 4 | One live call after generation works | `services/ai/midan_ai/interview.py`, `apps/api/src/interviews/preparation.controller.ts` |
| Interviewer feedback form and ranking by interview | Implemented | Working | ok | ok | n/a | ok | **Verified** (demo run): 2 interviewers submitted per candidate, change after submit refused (422), ranking by interview updated | — | — | `apps/api/src/interviews` |
| Development report per candidate | Implemented | Not verified live | ok | ok | live, untested | ok | Demo run: 503 without a model (correct) | Groq quota | — | migration `20261113110000` |
| Notifications | Implemented (in-app) | Working (in-app) | ok | ok | n/a | ok | Reported: in-app notices for application, shortlist, interview, decision. No email is claimed | No SMTP provider | Configure SMTP (Brevo chosen in `docs/handoffs/MIDAN_EMAIL_DELIVERY_REPAIR.md`) | `apps/api/src/me`, `apps/web/src/app/[locale]/notifications` |

### Candidate

| Feature | Impl. | State | FE | BE | AI | DB | Tests performed and actual results | Errors / blockers | Next action | Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Registration and email verification (address shown, resend, cooldown) | Implemented | Working locally | ok | ok | n/a | ok | **Verified**: acceptance sign-ups verify through real local GoTrue (mail sink). Reported: forms suite 14 of 15 | Real inbox delivery: no SMTP | SMTP | `apps/web/src/app/[locale]/check-email`, `register` |
| Profile and CV library | Implemented | Working | ok | ok | local reading | ok | **Verified**: acceptance step 6; route smoke | — | — | `apps/web/src/app/[locale]/profile` |
| Job discovery (company logo and colours) | Implemented | Working | ok | ok | n/a | ok | **Verified**: `/opportunities` 200 in ar and en; branded posting in acceptance | — | — | `apps/web/src/app/[locale]/opportunities` |
| Application with chosen CV, cover letter, review | Implemented | Working | ok | ok | n/a | ok | **Verified** (acceptance step 6). Reported: apply page 0 console/page errors (hydration error not present) | — | — | `opportunities/[id]/apply` |
| Practical assessment and submission | Implemented | Working (demo-generated assessment) | ok | ok | n/a | ok | **Verified** (demo run, step 8): 3 attempts submitted, reviewed and scored by a fictional reviewer | Live-generated assessment not approvable yet (see generation) | — | `apps/api/src/attempts`, `experience/[orgSlug]/[jobSlug]/[version]` |
| Application tracking and feedback | Implemented | Working | ok | ok | n/a | ok | **Verified**: `/applications` route; acceptance reads `/me/applications`. Development report (AI) not live | — | — | `apps/web/src/app/[locale]/applications` |
| Career readiness and roadmap (any typed target role) | Implemented | Not verified live | ok | ok | live, untested | ok | Reported: AI tests 4, page renders. Not run live here (quota kept for other checks) | Groq quota | One live readiness check | `cd1dad4`, `development/readiness`, migration `20261116090000` |
| Real course and certification recommendations | Implemented | Working (catalog) | ok | ok | constrained | ok | Reported: `scripts/verify-learning-catalog.mjs` 25 of 28 verified on official pages; the model may only cite catalog ids | 3 entries unverified | Re-run the script, retire failures | `scripts/verify-learning-catalog.mjs` |
| Humaidan contextual assistant | Implemented | **Working live** | ok | ok | live | ok | **Verified live**: one Arabic question with candidate facts; grounded answer citing the readiness gap and course facts, English digits, `assistant-v3-humaidan` on Groq | Quota | — | `services/ai/midan_ai/assistant.py`, `830ff88`, `apps/web/src/lib/humaidan.ts` |

### Admin and platform

| Feature | Impl. | State | FE | BE | AI | DB | Tests performed and actual results | Errors / blockers | Next action | Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Company and representative approvals, self-approval safeguard | Implemented | Working | ok | ok | n/a | ok | **Verified**: acceptance step 1 through the admin approval. E2E: §6. Reported: employer-access e2e 11/11 | — | — | `apps/api/src/admin`, migration `20261112090000` |
| Authorization, company and candidate isolation (RLS) | Implemented | Working | ok | ok | n/a | ok | E2E: §6 (foundation, employer-access, recruitment). API runs as the restricted `midan_api` role (`/v1/health/db`: `bypass_rls: false`) | — | — | `supabase/migrations`, `apps/api/src/db` |
| Arabic and English, RTL/LTR | Implemented | Working | ok | n/a | ok | n/a | **Verified**: 53 routes × 2 locales, no 500. Reported: `dir` checked on every page, message parity unit test | — | — | `apps/web/src/messages` |
| English digits everywhere | Implemented | Working | ok | n/a | ok | n/a | Reported: theme audit 0 Arabic-Indic digits; **verified** in the live Humaidan reply and stage 3 output | — | — | `7c0b158` |
| Light and dark mode | Implemented | Working (reported) | ok | n/a | n/a | n/a | Reported: theme audit 160 renders, 0 contrast failures | — | — | `apps/web/src/app/globals.css` |
| Responsive layouts | Implemented | Not verified here | ? | n/a | n/a | n/a | Not run in this session | — | Browser pass at 375 px | — |

## 4. Database migrations

65 migrations in `supabase/migrations`, all applied to the local database (`supabase_migrations.schema_migrations`: 65).
Added on this branch and **local only** (Cloud needs the owner's approval): `20261112090000_employer_access_requests`,
`20261113090000_company_journey_rules`, `20261113100000_interview_preparation`, `20261113110000_candidate_development_reports`,
`20261114090000_brand_palette`, `20261115090000_application_cv_matches`, `20261116090000_career_readiness`,
`20261116100000_requirement_suggestions`. Rollbacks in `supabase/rollback/`. Rehearsal: `scripts/rehearse-migrations.sh`.

## 5. Environment variables (names only)

`.env` (git-ignored; template `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`,
`DIRECT_URL`, `MIGRATION_DATABASE_URL`, `CHECKPOINT_DATABASE_URL`, `API_URL`, `APP_URL`, `TRUST_PROXY`, `AI_SERVICE_URL`,
`AI_SERVICE_TOKEN`, `AI_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_REASONING_EFFORT`, `GROQ_MAX_COMPLETION_TOKENS`,
`GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `EMBEDDING_PROVIDER`, `RERANKER_MODEL`, `RERANK_BUDGET_S`,
`HF_HOME`, `HF_HUB_OFFLINE`, `HF_TOKEN`, `DAILY_API_KEY`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`,
`GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_SEND_UPDATES`, `DEV_TEST_SIGNUP`, `DEV_TEST_ACCESS_CODE`,
local ports `LOCAL_PG_PORT`, `LOCAL_SUPABASE_PORT`, `LOCAL_SMTP_PORT`, `LOCAL_AUTH_PORT`, `LOCAL_REST_PORT`, and
`BACKGROUND_WORKER` (set `off` only while running the API e2e suite). Test accounts: `.env.test.local` (git-ignored).

## 6. Tests run in this session (actual results)

| Suite | Result |
| --- | --- |
| AI service (`uv run --extra matching pytest`) | 323 passed, 10 skipped (merged HEAD) |
| AI real-e5 tests (`HF_HOME=.local/hf`) | 5 passed |
| API unit (`npm test -w @midan/api`) | 105/105 in 8 of 10 runs; 2 runs had 1–2 failures that passed on rerun, both right after heavy CPU load; the failing test was not captured |
| Web type check and unit | clean; 59/59 |
| API e2e (`npm run test:e2e -w @midan/api`, AI service in demo mode on 8100, lexical matching, no Groq) | **13 of 13 suites, 224 of 224 tests passed** (188.6 s): `accounts`, `candidate-discovery`, `career`, `company-journey`, `employer-access`, `employer-access-concurrency`, `foundation`, `match`, `organization-review`, `phase3`, `pipeline`, `recruitment`, `skills` (`apps/api/src/*.e2e-spec.ts`); fixtures removed afterwards with `supabase/test-cleanup.sql` |
| Route smoke, signed out (`.local/route-smoke.sh`) | 53 routes × ar/en: 34 × 200, 72 × 307 to login, 0 errors |
| Acceptance, demo model + real e5/reranker (`node scripts/company-journey-acceptance.mjs`) | 11 of 18 (3, 4, 13, 14, 18 need a live model; 11, 12 need Calendar) |
| Acceptance, live Groq | 3 of 18: steps 1–3 passed (3 with live reasons); step 4 stopped at Groq's output limit, so 5–18 didn't run |
| Live Groq calls (minimal) | stage 3 (2 calls), STC generation (1 run, blocked by the quality gate), Humaidan (1 call) |
| Reranker benchmark | see §2 |

## 7. External integrations

| Integration | State |
| --- | --- |
| Supabase (local GoTrue, PostgREST, Storage stand-in) | Working locally; Cloud not touched |
| Groq | Live, free tier; the binding limit (see §8) |
| Hugging Face e5 + reranker | Working, offline, local CPU |
| Google Calendar | Blocked: client id, secret and refresh token empty |
| Daily.co video | `DAILY_API_KEY` empty in this `.env`: interview pages say video isn't switched on |
| Email | Local mail sink only; no SMTP configured; nothing claims delivery |
| Official data (employer and sector workbooks) | Not in the checkout (`data/source/README.md`); STC exists locally as a labelled `local-fixture` row |

## 8. Known bugs and unfinished work (priority order)

1. **Assessment generation can't produce an approvable live draft on Groq's free tier.** Per-minute limit 8,000 tokens; one
   generation needs about 20,000; the whole-draft repair can't fit at all. The one complete live draft was blocked by the
   quality gate for real defects (rubric 95, no churn column, mismatched reference figures, USD). The cloud session's
   4-part generation and resume (`c7aecdb`, `7ff659a`, `6bb3afb`) is merged and unit-tested, not run live. **Needs the owner's
   decision on a paid tier or provider**; then `node scripts/stc-assessment-live.mjs`.
2. Everything downstream of a live assessment in the acceptance journey (steps 5–18 live, stage 3 stored and shown on the
   applicant page, interview questions and form, development reports) is unverified live.
3. Reranker "matched" threshold 0.02: a few weak lines confirm requirements (e.g. "Prepared Excel summaries" for "SQL reports
   and dashboards"). Recalibration needs the owner's approval.
4. Intermittent API unit-test failure (2 of 10 runs), not identified.
5. Google Calendar, Daily and SMTP credentials.
6. `docker build` of the AI image not run.
7. The API keys stored CV matches on its own `EMBEDDING_PROVIDER`; it must equal the AI service's (documented in `.env.example`
   and `docs/deployment.md`).
8. Responsive layouts not re-verified in this session.

## 9. Remaining acceptance tests

After the generation blocker: `node scripts/stc-assessment-live.mjs` (writes `.local/stc-assessment/assessment.json`), then
`node scripts/company-journey-acceptance.mjs` (all 18 steps live), a career readiness check on `/en/development/readiness`, then
Calendar with credentials. Browser suites in `apps/web/e2e` with the stack running (`npm run test:e2e -w @midan/web`,
`npm run test:forms -w @midan/web`).

## 10. Commands

```bash
bash .local/up.sh
```

```bash
scripts/dev-all.sh --stop
```

```bash
cd services/ai && uv run --extra matching pytest
```

```bash
npm test && npm run lint
```

API e2e without spending Groq quota (stop or restart the dev API with `BACKGROUND_WORKER=off` first, clean test data first):

```bash
scripts/local-db.sh psql -f supabase/test-cleanup.sql
```

```bash
AI_SERVICE_URL=http://localhost:8100 AI_PROVIDER=demo EMBEDDING_PROVIDER=lexical npm run test:e2e -w @midan/api
```

with a demo AI service on 8100: `cd services/ai && AI_PROVIDER=demo EMBEDDING_PROVIDER=lexical uv run --extra matching --env-file ../../.env uvicorn midan_ai.main:app --port 8100`.

Test accounts are in `.env.test.local`; the platform admin is `midan.test.platform-admin@example.com` (`/ar/admin`).

## 11. Final branch and commit

Branch `feature/midan-product-experience` on `origin` (https://github.com/shmuhaisin/MIDAN). This file is added by the
branch's final commit of this session; its hash is `git log -1 --format=%H -- docs/handoffs/MIDAN_FINAL_HANDOFF.md`. It
builds on `00769c2` (the merge of the cloud session's 14 commits). This session's commits: `16e384a` (evidence selection),
`bcb26f4` (hybrid default), `2e860d7` (Docker image), `de17574` and `00769c2` (merges), `3a9a287` (stage 3 note), `5475de1`
(STC script fix), and this handoff.

Left running at handoff: web http://localhost:3100 (`/ar`, `/en`), API http://localhost:4000 (`/v1/health`, `/docs`), AI
http://localhost:8000/health (live, Groq, e5-rerank), gateway http://localhost:54521, PostgreSQL 127.0.0.1:54533.
