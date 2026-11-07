# MIDAN — Local workflow status

Written 2026-11-07, on `midan-security-completion`. What works on the local stack for the journey
**Browse Jobs → Apply → Generate a job-specific assessment → Complete it → Evaluate performance → Employer reviews results**,
and what each remaining item waits for. All data here is fictional.

## Phase 3 state, 2026-11-07

Built on `midan-security-completion`: CSV and JSON upload with preview, duplicate detection, record-to-draft-job conversion, search over title, description and requirements with pages, employer claims reviewed by a person, and team invitations with roles. Four new migrations (`20261107130000` to `20261107130300`), so **fifteen** are pending on hosted, all rehearsed with rollback on PostgreSQL 17. `apps/api/src/phase3.e2e-spec.ts` passed 31 of 31. Screens and `apps/web/e2e/phase3.spec.ts` may still need fixes: check the latest run. No real job data has been imported. Email delivery of invitations needs SMTP.

## The journey today

| Step | State | Evidence |
| --- | --- | --- |
| Browse jobs | Works | `pipeline.e2e-spec.ts`, `journeys.spec.ts` |
| Apply | Works, with a CV copy per application and explicit sharing if there's none | `foundation.e2e-spec.ts`, `journeys.spec.ts` |
| Generate an assessment | Works from the job's stated responsibilities and linked workbook skills. **Two paths:** a configured model, or labeled templates when there's none or it can't give a valid draft | `test_model_generation.py`, `test_requirements_builder.py` |
| Company reviews and edits the draft, then approves | Works: tasks, rubric, objective questions and answer key are editable before approval, edits are audited, and the screen warns about anything left unmeasured | `pipeline.e2e-spec.ts`, `journeys.spec.ts` |
| Complete it | Works: saved answers, server-side timer, one submission | `foundation.e2e-spec.ts`, `journeys.spec.ts` |
| Evaluate | Works: rubric scores with evidence, always waiting for a person. A reviewer starts it | `test_graphs.py`, `pipeline.e2e-spec.ts` |
| Employer reviews | Works: review, release to the candidate, shortlist, hire | `pipeline.e2e-spec.ts`, `live-journey.live-spec.ts` |

**With a model behind it:** `npm run test:live -w @midan/api` runs the whole journey in live mode, 4 of 4 passing against a local
stand-in for OpenAI (`services/ai/tests/stub_provider.py`). That proves the plumbing and the records, not the quality of a real
model's assessments. **No real provider has been called yet.**

## What the model path does

Generation and evaluation stay separate engines. Both providers answer to one contract (`GeneratedAssessment`, `OpenScore`) and the
same checks. A draft is refused if it uses an ID that isn't in the job, misses a stated responsibility or required workbook skill,
has too few criteria, or has an answer that isn't one of its options. The model is told why and tried again. After that, the
templates run and the draft is labeled demo. Answer keys stay in the rubric and never reach the candidate. Only job details are
sent, as untrusted data; nothing about a candidate is part of generation.

## What can continue locally

| Task | Needs |
| --- | --- |
| Try a real model on real job text and judge the quality | A key the owner adds to the local `.env` themselves, never in chat |
| Better demo templates for objective questions, which are still general and not job-specific | Nothing. Low priority once a model is available |
| Start the evaluation automatically when a candidate submits, through the queue | Nothing, but it needs a way for the worker to act for the organization |
| Real job listings | An authorized job data source |

## What waits for deployment only

Hosting provider, `TRUST_PROXY`, HSTS, SMTP, Google sign-in, real Daily and Calendar, the first platform administrator, and applying
the migrations. None of these blocks local work. See `MIDAN_PHASE_2_PREPARATION.md`.

## Running it

```bash
cd services/ai && uv run python tests/stub_provider.py 8099
```

```bash
cd services/ai && AI_PROVIDER=openai OPENAI_API_KEY=stub OPENAI_MODEL=stub-model OPENAI_API_URL=http://127.0.0.1:8099 uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000
```

```bash
npm run test:live -w @midan/api
```

The regular suites expect demo mode, so restart the AI service without those variables afterwards.
