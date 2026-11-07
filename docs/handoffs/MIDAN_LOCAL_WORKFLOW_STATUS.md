# MIDAN — Local workflow status

Written 2026-11-07, on `midan-security-completion`. What works on the local stack for the journey
**Browse Jobs → Apply → Generate a job-specific assessment → Complete it → Evaluate performance → Employer reviews results**,
and what each remaining item waits for. All data here is fictional.

## Phase 3: jobs and employers (2026-11-07)

| Requirement | State | Evidence |
| --- | --- | --- |
| 1. Import authorized job records as CSV or JSON | Done. An administrator uploads, names the source and what permits using it, and both are kept with the import | `listing-file.spec.ts` (18), `phase3.e2e-spec.ts`, `phase3.spec.ts` |
| 2. Validate, preview before saving, detect duplicates | Done. The preview saves nothing, and only the previewed file can be saved. Flags rows that are invalid, repeated in the file, the same job from another source, or unchanged | Same |
| 3. Turn records into jobs | Done. An approved record whose employer is confirmed becomes a **draft** of the organization managing that employer. Only stated details are copied. Once the job is published, it replaces the record in search and on the employer page | Same |
| 4. Link jobs to companies and workbook skills | Done. The job belongs to the employer's organization, and skills the text mentions are linked as not required, for the organization to confirm | Same |
| 5. Search title, description and requirements, with pages | Done. Either language, Arabic spelling normalized, every word required, filters kept in the address, works before JavaScript loads | Same |
| 6. Prove the right to manage an employer's profile and jobs | Done. An owner or admin sends evidence, optionally a private file. A platform administrator approves or rejects with a reason. Nothing is automatic, and approval never makes the employer a partner | Same |
| 7. Team invitations, roles and permissions | Done. Invitation by email, accepted from the account with that verified email. Roles: owner, admin, recruiter, reviewer. The last owner always stays | Same |

Also fixed: a published listing exposed its raw source record, review notes and reviewer through the Data API.

**Tests:** API end-to-end 145 / 145 (31 of them Phase 3). Browser 39 / 39, with the only CSP reports being the two deliberate controls. Forms 9 / 9. Unit tests: API 65 / 65, web 19 / 19. AI service 143 passed, 1 skipped. Rehearsal of all 15 pending migrations and their rollback on PostgreSQL 17 passed.

**What's not done, or not real yet:**
- **No real job data has been imported.** The tools wait for an authorized dataset. Each record needs a job title and an https link. Also read when present: employer name or company ID, description, requirements, the source's job ID, location, employment type and collection date. A file up to 5 MB and 5,000 records, UTF-8.
- Invitation emails aren't sent: that needs SMTP. The invitation appears in the invited account, and the inviter is told to let them know.
- Someone without an account can't accept, because registration stays closed.
- Claims, conversion and search ran only on the local stack, with fictional data and fixture accounts.
- Search compares text, which is fine at this size. Many thousands of jobs would need an index.

## Phase 4 started before Phase 3 was complete

Model-backed generation and the draft review only use what a job states: its responsibilities and linked workbook skills. They work the
same on a job typed in by an organization or converted from a record, so they didn't depend on Phase 3. The converted-job journey
above now feeds them, and the live journey test covers generation, review, evaluation and the employer's decision.

## The journey today

| Step | State | Evidence |
| --- | --- | --- |
| Browse jobs | Works | `pipeline.e2e-spec.ts`, `journeys.spec.ts` |
| Apply | Works, with a CV copy per application and explicit sharing if there's none | `foundation.e2e-spec.ts`, `journeys.spec.ts` |
| Generate an assessment | Works from the job's stated responsibilities and linked workbook skills. **Two paths:** a configured model, or labeled templates when there's none or it can't give a valid draft | `test_model_generation.py`, `test_requirements_builder.py` |
| Company reviews and edits the draft, then approves | Works: tasks, rubric, objective questions and answer key are editable before approval, edits are audited, and the screen warns about anything left unmeasured. **Since the editing policy (branch `midan-assessment-editing-policy`):** tasks can be added and deleted too, every change is recorded with its state before and after, an owner or admin reviews the changes beside MIDAN's original and validation before approving, and a new version can start from an approved one. Tested on the database; its end-to-end tests are written but not run | `pipeline.e2e-spec.ts`, `journeys.spec.ts`, `supabase/tests/assessment_editing_policy.sql`, `foundation.e2e-spec.ts` (editing policy) |
| Complete it | Works: saved answers, server-side timer, one submission | `foundation.e2e-spec.ts`, `journeys.spec.ts` |
| Evaluate | Works: rubric scores with evidence, always waiting for a person. A reviewer starts it. The model reads the task and criteria in Arabic and English, and judges an answer in its own language | `test_graphs.py`, `test_evaluation_language_and_workbook_skills.py`, `pipeline.e2e-spec.ts` |
| Employer reviews | Works: review, release to the candidate, shortlist, hire. Reviewing records a percentage for each workbook skill the tasks measured, shown to the reviewer and, once released, to the candidate | `pipeline.e2e-spec.ts`, `live-journey.live-spec.ts` |

**With a model behind it:** `npm run test:live -w @midan/api` runs the whole journey in live mode, 4 of 4 passing against a local
stand-in for OpenAI (`services/ai/tests/stub_provider.py`). That proves the plumbing and the records, not the quality of a real
model's assessments. **No real provider has been called yet.**

## What the model path does

Generation and evaluation stay separate engines. Both providers answer to one contract (`GeneratedAssessment`, `OpenScore`) and the
same checks. A draft is refused if it uses an ID that isn't in the job, misses a stated responsibility or required workbook skill,
has too few criteria, or has an answer that isn't one of its options. The model is told why and tried again. After that, the
templates run and the draft is labeled demo. Answer keys stay in the rubric and never reach the candidate. Only job details are
sent, as untrusted data; nothing about a candidate is part of generation.

Evaluation sends the task, instructions and criteria in Arabic first, then English, and the stand-in model refuses a prompt without
the Arabic, so the live journey fails if the API stops sending it. A provider that can't be reached counts as a failed attempt: it's
tried again after a pause, then the criterion goes to the reviewer as `model_failed`. Workbook skills get a percentage over the tasks
that measure them, worked out in code from the reviewed criterion scores. **Never a level:** the workbooks define none.

## What can continue locally

| Task | Needs |
| --- | --- |
| Try a real model on real job text and judge the quality | A key the owner adds to the local `.env` themselves, never in chat |
| Better demo templates for objective questions, which are still general and not job-specific | Nothing. Low priority once a model is available |
| Start the evaluation automatically when a candidate submits, through the queue | Nothing, but it needs a way for the worker to act for the organization |
| Read evidence in uploaded files, not only typed answers | An owner decision on what may be sent to a model |
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
