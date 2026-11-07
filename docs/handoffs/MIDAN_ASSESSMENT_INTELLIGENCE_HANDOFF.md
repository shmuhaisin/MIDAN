# MIDAN — Assessment Intelligence: Handoff

Written 2026-11-07 for the developer who continues this work. The reference-based assessment intelligence task is **complete**;
this document records what exists, where, how it was tested, and what is left.

Nothing was merged, deployed, or applied to hosted Supabase.

## A. Git information

| | |
| --- | --- |
| Repository | https://github.com/shmuhaisin/MIDAN |
| Pushed branch (for the next developer) | **`feature/midan-assessment-intelligence-handoff`** — https://github.com/shmuhaisin/MIDAN/tree/feature/midan-assessment-intelligence-handoff |
| Local branch it was pushed from | `midan-assessment-intelligence` (same commits; not pushed under its own name) |
| Canonical baseline | `midan-phases-2-3-4` at `ba1d25c0259490244139ee96446bd035be0d2a89` |
| Direct base | `midan-assessment-editing-policy` at `0e0d1ff6814f022cc49d3d7eb2c163a04f2340f7` (already on GitHub, unchanged), which is `ba1d25c` plus the approved assessment editing policy. Built on it because the brief requires reusing that policy's audit, review and immutability |
| Commits added by this task | `c8480ea` Add the MIDAN Assessment Standard, its quality gate and the unseen-job benchmark · `d0c7bd0` Record the owner's decision: only generated versions must meet the standard · the commit that adds this handoff (the branch head; `git log -1` on the branch) |
| Push status | Pushed once, as a new branch, by the owner's explicit authorization. No force push. `main`, `midan-phases-2-3-4`, `midan-assessment-editing-policy` and every other remote branch are untouched |
| Not committed | `docs/handoffs/MIDAN_CURRENT_STATE_AND_NEXT_STEPS.md` (an earlier audit kept uncommitted on purpose) and the git-ignored `.local/` (the benchmark's confidential assessor material, section E) |

## B. Implementation summary

### B.1 The MIDAN Assessment Standard (MAS-1.0)

- **What:** a versioned standard derived from the reference library's structure: three separated layers (candidate brief,
  materials, assessor guide), nine job-family profiles that require different structures, a 100-point rubric on levels 0–4 with
  criterion-specific descriptors and evidence, content boundaries (fictional by default, sourced legal claims, no pass mark), and
  52 validation rules (errors block, warnings inform).
- **Files:** `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md` (prose); `services/ai/midan_ai/standard.py` (`STANDARD_VERSION`,
  `FAMILIES`, `COMPANY_TYPES`, `SECTORS`, `RULES`, `effort_range`, `requirements_for`).
- **Tests:** `test_the_standard_is_versioned_and_its_families_match_the_schema`, `test_job_families_require_different_structures`.

### B.2 Assessment package schema

- **What:** the package a model returns: `CandidateBrief`, `Material` (tables and logs with a data dictionary, policies,
  documents, provenance), `Deliverable`, `AssessorGuide` (task solutions, `Calculation` with a recompute `check`, decision points,
  verification steps, boundaries, what isn't scored, `Source` with verification status, approval notes, skill map), criterion
  `points`, level descriptors and evidence. All optional, so earlier tasks-only drafts still validate (and are "not standardized").
- **Files:** `services/ai/midan_ai/schemas.py`; storage mapping `services/ai/midan_ai/package.py` (`normalize`, `to_stored`,
  `from_stored`, `instructions`).
- **Tests:** `test_the_stored_candidate_side_holds_no_guide_content_and_the_round_trip_keeps_the_report`,
  `test_a_levelled_criterion_scores_out_of_4_and_a_task_weighs_its_points`.

### B.3 Company type, sector and level in generation (the known gap, fixed)

- **What:** `JobInput` gains `company_type`, `sector`, `experience_level`. The API sends the job's `sector` and
  `experience_level` and the organization's `company_type` (or one given in the generate request). The company's name is never
  sent: an assessment's company is fictional, of that type and sector.
- **Files:** `services/ai/midan_ai/schemas.py`; `apps/api/src/assessments/assessment-quality.ts` (`loadJobInput`, `contextFor`);
  `apps/api/src/assessments/assessments.controller.ts` (`GenerateDto.company_type`); `apps/api/src/organizations/organizations.controller.ts`
  (`PATCH /organizations/:orgId/company-type`); `apps/api/src/common/fields.ts` (`COMPANY_TYPES`).
- **Database:** `organizations.company_type` (checked against the 8 types).
- **Tests:** `test_company_type_and_sector_must_shape_the_context`; `test_mock_provider_package_is_stored_apart_and_checked_with_the_jobs_context`
  (the model receives company type, sector, level, the standard, and no company name); API `assessment-quality.spec.ts`; database
  "Company type" block.

### B.4 Generation (Graph A)

- **What:** prompt `gen-v2-mas1` asks for the full package with the three layers kept apart; the model receives every stated
  responsibility (the templates' limit of four doesn't apply to it); drafts are normalized (level criteria scored out of 4, task
  weight = sum of points), mapped to storage, and checked by a new `assess_quality` step before human review. The review payload
  carries `version` (candidate-facing fields), `guide` and `quality`. The template fallback is unchanged and labelled `demo`.
- **Files:** `services/ai/midan_ai/providers.py` (`GENERATION_PROMPT`, `GENERATION_PROMPT_VERSION`);
  `services/ai/midan_ai/assessment_builder.py` (`make_generator`, `standard_summary`, `_stated`, `check_generated`, `assess_quality`).
- **Tests:** `services/ai/tests/test_model_generation.py` (existing, all pass), the `mock_` and `template_` tests in
  `test_assessment_standard.py`.

### B.5 Quality evaluator

- **What:** deterministic, 14 dimensions with evidence, missing elements, errors and warnings; reference figures recomputed from
  the materials; verdict `ready` / `needs_revision` / `blocked`; required revisions. No similarity input.
- **Files:** `services/ai/midan_ai/quality.py` (`evaluate`, `recompute`, `QualityReport`); endpoint `POST /quality/evaluate` in
  `services/ai/midan_ai/main.py` (service token, no model call).
- **Tests:** the evaluator tests in `services/ai/tests/test_assessment_standard.py` (section F).

### B.6 Protected assessor guide

- **What:** the guide lives in its own table. Readable by members of the organization (owner, admin, recruiter, reviewer) only;
  never by a candidate, another organization or an anonymous caller. Writable by owners, admins and recruiters on drafts only; no
  delete grant. Edits are audited with before and after and must be reviewed before approval (editing policy). Kept in MIDAN's
  snapshots; carried into revisions.
- **Database:** `public.assessment_assessor_guides`, `private.guard_assessor_guide()`, replaced `private.write_assessment_audit()`,
  `private.is_reviewable_change()`, `private.assessment_version_content()`, `private.carry_standard_into_revision()`.
- **API:** `GET /organizations/:orgId/assessment-versions/:versionId/guide` (staff), `PUT …/guide` (builders; reason recorded).
- **Tests:** database "Who can read the assessor guide", "Guide and package edits are recorded and reviewed", revision block.

### B.7 Quality validation and the publish gate

- **What:** reports are written only by MIDAN's service role (`midan_worker`) with the content digest they judged. A version under
  the standard (it has a guide, or an earlier version of its assessment had one) is approved only with a `ready` report on its
  current digest. The API's publish checks first and answers 422 with a summary; the database refuses regardless.
  **Owner decision 2026-11-07:** only generated versions are gated; employer-authored and template drafts are not.
- **Database:** `public.assessment_quality_reports`, `private.record_quality_report()`, `private.assessment_content_digest()`,
  `public.assessment_content_digest()`, `private.is_under_standard()`, `private.guard_quality_gate()` and trigger `quality_gate`.
- **API:** `POST …/assessment-versions/:versionId/quality` (check and record), `GET …/quality` (latest report and whether it is
  current), `publish` checks first; `AiClient.evaluateQuality`; new 422 mappings in `database-exception.filter.ts`.
- **Tests:** database "Quality reports come only from MIDAN's service role", "The gate…", "Approved…"; API filter spec.

### B.8 Candidate package on the version

- **What:** `assessment_versions.candidate_package` holds the structured brief and materials (candidate-facing). Scenario,
  instructions, effort and window are also written to the version's existing fields so today's screens show them.
- **Files:** `supabase/migrations/20261107160000_assessment_intelligence.sql`; `apps/api/prisma/schema.prisma`.

### B.9 Files changed by this task (`ba1d25c..HEAD` minus the editing policy's `0e0d1ff`)

AI service: `midan_ai/standard.py` (new), `quality.py` (new), `package.py` (new), `schemas.py`, `providers.py`,
`assessment_builder.py`, `main.py`; `benchmarks/run_benchmark.py` (new); `tests/package_fixture.py`, `tests/test_assessment_standard.py`,
`tests/test_cyber_benchmark.py` (new).
API: `src/assessments/assessment-quality.ts` and `.spec.ts` (new), `src/assessments/assessments.controller.ts`, `src/ai/ai.client.ts`,
`src/common/database-exception.filter.ts` and `.spec.ts`, `src/common/fields.ts`, `src/organizations/organizations.controller.ts`,
`prisma/schema.prisma`.
Database: `supabase/migrations/20261107160000_assessment_intelligence.sql`, `supabase/rollback/20261107160000_assessment_intelligence.down.sql`,
`supabase/tests/assessment_intelligence.sql`.
Docs: `docs/assessment/*` (new), `docs/handoffs/MIDAN_ASSESSMENT_INTELLIGENCE_HANDOFF.md`, `docs/DECISIONS.md`, `PROJECT_STATUS.md`.
Web: none.

## C. Reference assessment library

### C.1 Files inspected (names only; contents are not in the repository)

22 distinct packages, 68 files. A 23rd archive (`SWE_Assessment_Simple (1).zip`) was byte-identical to `SWE_Assessment_Simple.zip`.

| Package | Files |
| --- | --- |
| SWE_Assessment_Simple | `01_Task_and_Deliverables.pdf`, `02_Support_Guide.md`, `03_Assessor_Only.pdf` |
| Data_Analyst_Assessment_Simple | `01_Task_and_Deliverables.pdf`, `02_Data.csv`, `03_Assessor_Only.pdf` |
| UI_UX_Designer_Assessment_Simple | `01_Task_and_Deliverables.pdf`, `02_Assessor_Only.pdf` |
| ML_Engineer_Assessment_Simple | `01_Task_and_Deliverables.pdf`, `02_Data.csv`, `03_Assessor_Only.pdf` |
| Midan_Accountant_Assessor_Guide_Revised | `Midan_Accountant_Assessor_Guide_Revised.pdf` |
| Midan_Consumer_Protection_Assessor_Guide_Green | `Midan_Consumer_Protection_Assessor_Guide_Green.pdf` |
| Midan_Credit_Analyst_Assessor_Guide_Green | `Midan_Credit_Analyst_Assessor_Guide_Green.pdf` |
| Midan_Data_Analyst_Assessor_Guide_Green | `Midan_Data_Analyst_Assessor_Guide_Green.pdf` |
| Midan_Financial_Analyst_Assessor_Guide_Green | `Midan_Financial_Analyst_Assessor_Guide_Green.pdf` |
| Midan_Trade_Compliance_Assessor_Guide_Green | `Midan_Trade_Compliance_Assessor_Guide_Green.pdf` |
| 19_Event_Coordinator … 24_Guest_Experience_Specialist (6 packages) | each `01_Task_Instructions.pdf`, `02_Data_and_References.pdf`, `03_Assessor_Guide_Answer_Key.pdf` |
| MIDAN_Group3_Civil_Engineer_Assessment_Package_v0.2 | `13_Civil_Engineer_Candidate_Brief.pdf`, `…_Input_Data.xlsx`, `…_Assessor_Guide_Answer_Key.pdf`, `…_Scoring_Rubric.xlsx`, `README_AR.txt` |
| MIDAN_Group3_Project_Planner / Real_Estate_Analyst / Production_Engineer / Quality_Engineer _v0.1 | the same five files, numbered 14, 15, 16, 17 |
| MIDAN_Group3_Maintenance_Engineer_Assessment_Package_v0.1 | the same, numbered 18, with `README_AR.md` |

How they were read, what each contains and their rubric weights: `docs/assessment/REFERENCE_LIBRARY_INVENTORY.md`. The packages
stay with the owner; they were extracted outside the repository and must never be committed (the repository is public).

### C.2 Standards extracted

The common skeleton (self-sufficient brief; sufficient fictional data with a dictionary; an internal guide with reference
solution, calculations, decision points, accepted alternatives and common mistakes; 100-point weighted rubric on 0–4; no pass mark;
dated sources) became MAS-1.0's mandatory sections. The packages' inconsistencies (a 1–4 scale, fractional weights, a version
mismatch, guides whose figures can't be re-derived, regulatory claims without articles) became validation rules. The variation
between families (60 minutes to 6 hours; code vs calculations vs plans vs findings) became the nine family profiles.

### C.3 Candidate-facing versus assessor-only

| Layer | Storage | Who reads it |
| --- | --- | --- |
| Brief, tasks, deliverables, materials | `assessment_versions` (scenario, instructions, timing, `candidate_package`), `assessment_tasks` (text and `config`) | The candidate |
| Rubric criteria and answer keys | `rubric_criteria` (as before) | Organization staff (criterion descriptions shared only if the employer chooses; answer keys never) |
| Assessor guide, level descriptors, evidence requirements | `assessment_assessor_guides` | Organization staff only |
| Quality reports | `assessment_quality_reports` | Organization staff only |

The evaluator's `separation` dimension also scans every candidate-facing text for reference results and guide-only phrases.

### C.4 How the standards produce original assessments

The standard is structure and rules, not content. Generation receives only the employer's job (description, requirements,
responsibilities, skills, workbook skills, company type, sector, level) and the standard's summary; no reference text is ever
sent to a model or used as a template. The evaluator never compares a draft with a reference and has no similarity input.

## D. Assessment generation

1. **Company type:** `organizations.company_type` (set with `PATCH /organizations/:orgId/company-type`), or `company_type` in
   `POST …/jobs/:jobId/assessment/generate`, which wins for that generation. Sent as `job.company_type`.
2. **Sector and level:** the job's existing `sector` and `experience_level`, sent as `job.sector` and `job.experience_level`.
3. **Job description and requirements:** title, descriptions and free-text requirements, plus the approved, non-retired
   `job_requirements`. Every responsibility and daily task becomes a coverage obligation: some task must name it.
4. **Skills:** the job's required skills and the taxonomy (`skill_ids`); workbook skills linked to the job (`reference_skill_ids`,
   required ones must be covered). A model may use only ids the job states (`check_generated`).
5. **Package:** the model returns brief, materials, tasks with criteria (points, levels, evidence) and the guide; `normalize` then
   `to_stored` produce the version fields, task rows (answers only in the rubric) and the guide row; the API writes them in the
   generation transaction (recorded as `generation`), and `record_generated_draft` keeps MIDAN's copy. Without a model: templates,
   provenance `demo`, no guide.
6. **Quality evaluator:** Graph A's `assess_quality`, and after storage the API's `checkQuality`: it reads the version, its guide,
   the job's context and the database's content digest in one transaction, sends them to `POST /quality/evaluate`, and records the
   report through `midan_worker`.
7. **Publishing gate:** for a version under the standard, `publish` re-checks and refuses unless `ready`; the `quality_gate`
   trigger refuses approval without a `ready` report on the current digest, after the editing policy's checks (validation errors,
   unreviewed changes).

## E. Cybersecurity Analyst benchmark

**Generated: yes, with an honest qualification.** No Gemini or OpenAI key exists here, so no live model produced it. The package
was **authored by Claude (the coding agent) to MAS-1.0** from a fictional job input (mid-level Cybersecurity Analyst at Thamar
Cloud, a fictional Saudi technology startup; `startup`, `digital`, `mid`), with data from a seeded script, and then **run through
MIDAN's Graph A via the mock provider path** and the evaluator. It shows the pipeline and the standard working on an unseen job; it
is not evidence of what a real model generates.

| Item | Location |
| --- | --- |
| Candidate-facing assessment | `docs/assessment/benchmarks/cybersecurity-analyst/candidate/` (`assessment.json`, `auth_events.csv`, `edr_alerts.csv`, `asset_inventory.csv`, `incident_response_policy.md`) and its `README.md` |
| Protected assessor guide | `.local/assessment-benchmarks/cybersecurity-analyst/package.json` — **git-ignored, not pushed**; SHA-256 `15a5e0a446843525b0513464d51b470142a1be60ccabd1a1336240f05ef59d17` |
| Job input, data generator | `.local/…/job.json` (`df71db6950ba98014b13787c5d6dfef3047bc485d304dc4769e5c385bd62876e`), `.local/…/generate.py` — git-ignored |
| Quality report | `.local/…/quality_report.json` (quotes guide findings, so kept private); summary in `docs/assessment/GENERATION_QUALITY_BENCHMARK.md` |

**Result (mock):** verdict **ready**, overall **98/100**; 13 dimensions 100, integrity 70. Reference figures recomputed from the
candidate's CSV files: **9 of 9 matching**. Errors: none. Warnings: 3 `source_unverified` (NCA ECC, PDPL, RFC 5737 — cited only as
unscored context; no web access was used to verify them). A hand review against every section of the standard found three
defects, fixed before that result. The same job through the template fallback: 5 generic tasks, `blocked` / not standardized.

**For the next developer:** `.local/` exists only on the owner's machine. Ask the owner for
`.local/assessment-benchmarks/cybersecurity-analyst/` through a private channel (not the repository) to run the two
guide-dependent tests; without it they are skipped and say so.

## F. Tests (exact commands and results)

Environment: Windows 11, Node 22.19, Python 3.14 virtual environment with `services/ai/pyproject.toml`'s dependencies,
PostgreSQL 18.3 scratch cluster (repository shim + minimal `auth` stand-in). No Docker, no local Supabase stack, no provider keys.
Code results are at `d0c7bd0`, which differs from `c8480ea` in documentation only; the rows marked † were run at `c8480ea`.

| Check | Command | Result |
| --- | --- | --- |
| AI service, all | `cd services/ai && python -m pytest -q` | **172 passed, 5 skipped**. Skips: 2 real-provider tests (no keys), 2 OCR tests (no tesseract), 1 Postgres checkpointer test (no `TEST_CHECKPOINT_DATABASE_URL`) |
| Benchmark and standard tests | `python -m pytest -q -rs tests/test_assessment_standard.py tests/test_cyber_benchmark.py` | **25 passed, 2 skipped** (the real-provider tests) |
| Provider tests (**mock**: stand-in OpenAI/Gemini) | `python -m pytest -q tests/test_model_generation.py` | **17 passed** |
| Provider-independence (**mock**) | `test_mock_openai_and_gemini_wire_formats_get_the_same_validation` | **Passed** (identical reports) |
| Template fallback | `test_template_fallback_is_labelled_and_not_standardized` | **Passed** |
| **Real Gemini / OpenAI** | `MIDAN_REAL_PROVIDER_TESTS=1 python -m pytest -q tests/test_assessment_standard.py -k real` | **NOT RUN** — no keys |
| API unit tests | `npm test -w @midan/api` | **73 / 73**, 10 suites |
| API and web lint / type checks | `npm run lint` | **Passed** |
| Web unit tests | `npm test -w @midan/web` | **23 / 23** |
| API build | `npm run build -w @midan/api` | **Succeeded** |
| Web production build † | `npm run build -w @midan/web` | **Succeeded** |
| Database: assessment intelligence † | `scripts/local-db.sh psql -f supabase/tests/assessment_intelligence.sql` (run on the PG18 scratch cluster after all 41 migrations) | **All checks passed** |
| Database: editing policy, Phase 1 security † | `supabase/tests/assessment_editing_policy.sql`, `supabase/tests/security_phase1.sql` | **All checks passed** |
| Migration and rollback † | apply 41 migrations; dump schema with 40 vs after apply + `supabase/rollback/20261107160000_assessment_intelligence.down.sql` | **Applied; schema identical** (apart from `pg_dump`'s session token) |
| Benchmark run (**mock**) † | `python services/ai/benchmarks/run_benchmark.py <package> <job> docs/assessment/benchmarks/cybersecurity-analyst/candidate <out>` | **ready, 98**, 9/9 figures recomputed |
| API end-to-end, browser, forms | `npm run test:e2e …` | **Not run** — need the local Supabase stack; no new end-to-end tests were written |
| PostgreSQL 17 rehearsal | `scripts/rehearse-migrations.sh` | **Not run** |

## G. Outstanding work (priority order)

1. **Real providers.** Add `GEMINI_API_KEY`/`GEMINI_MODEL` or `OPENAI_API_KEY`/`OPENAI_MODEL` to your own local `.env`, run the
   real tests, and record what a real model's package scores. Expect early drafts to be `blocked`; the report lists revisions.
2. **Web screens.** No screen shows the guide or quality report; candidates' screens don't render `candidate_package` materials,
   and there is no way yet to attach material files (such as CSV logs) to a version for candidates to download.
3. **End-to-end tests** for generate → guide → quality → publish on the local stack, then browser checks.
4. **Migration rehearsal** on PostgreSQL 17 as a non-superuser before any hosted window. Hosted would need it after the editing
   policy's migration, released together with this branch's API and AI service.
5. **Specialist review** of the benchmark's reference solution and its three unverified sources; pilot the 180-minute estimate.
6. **Owner decisions still open:** whether employers may edit assessor guides or only MIDAN; whether the guide's narrative must be
   in Arabic; whether the candidate-facing benchmark files stay in the public repository.
7. **Known limitations:** the evaluator is heuristic for realism and relevance (keyword and structural proxies) and can't confirm a
   reference solution beyond its recomputable figures; the benchmark guide's narrative is English only (criteria, levels and
   evidence are bilingual); the change-review screen lists guide edits by stored field names.

## H. Next developer instructions

```bash
git clone --branch feature/midan-assessment-intelligence-handoff https://github.com/shmuhaisin/MIDAN.git
cd MIDAN
npm install
```

AI service (Python 3.12+):

```bash
cd services/ai
python -m venv .venv
.venv/bin/pip install -e ".[dev]"   # Windows: .venv\Scripts\pip install -e ".[dev]"
.venv/bin/python -m pytest -q
```

API and web:

```bash
npm run lint
npm test -w @midan/api
npm test -w @midan/web
```

Database (local only; see `docs/local-development.md` for the local Supabase stack, `scripts/local-db.sh`):

```bash
scripts/local-db.sh psql -f supabase/tests/assessment_intelligence.sql
```

Benchmark, once the owner has given you `.local/assessment-benchmarks/cybersecurity-analyst/` privately:

```bash
python services/ai/benchmarks/run_benchmark.py .local/assessment-benchmarks/cybersecurity-analyst/package.json .local/assessment-benchmarks/cybersecurity-analyst/job.json docs/assessment/benchmarks/cybersecurity-analyst/candidate .local/assessment-benchmarks/cybersecurity-analyst
```

Work on a new branch from `feature/midan-assessment-intelligence-handoff`. Never commit `.local/`, reference packages, source
workbooks, keys or `.env` files. Read first: `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md`,
`docs/assessment/GENERATION_QUALITY_BENCHMARK.md`, `docs/handoffs/MIDAN_ASSESSMENT_EDITING_POLICY.md`, `docs/DECISIONS.md`.
