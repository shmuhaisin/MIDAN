# MIDAN — Complete Implementation Handoff

Branch `feature/midan-complete-data-jobs-assessment`. Written 2026-11-06 at the end of the session that produced it.
Everything below describes what exists and was run, not what was planned. Where something wasn't verified, it says so.

---

## 1. Project overview

**MIDAN (الميدان يا حميدان)** is an Arabic-first, bilingual recruitment and skills-assessment platform for the Saudi market.
It connects employers and candidates through practical, job-specific assessments rather than CV keyword matching, and
supports career development. It is not a job board, a CV analyzer or a chatbot (the Humaidan AI chat is postponed by the
owner; only his visual character is used).

**Core journey (the original concept, kept unchanged):**

```
Browse Jobs → Apply → Job-Specific Assessment → Evaluation
```

- **Candidate:** register, build a profile (optionally from a CV through a privacy pipeline), browse jobs, see employer
  identity and a skills match, apply, receive the job's approved assessment immediately, complete and submit it, see
  released results, attend interviews, receive decisions, and use career development.
- **Employer (organization members):** create jobs, state requirements, link skills from the official sector workbooks,
  generate and edit an assessment draft, approve (publish) it, receive applications, review answers and AI-proposed
  scores against their own rubric, review and release results, shortlist, interview, decide.
- **Platform administrator:** imports and lineage, review queue, employer registry, job listings, accounts, audit log,
  background jobs, learning catalog.

**Scope of the work on this branch** (on top of the earlier MIDAN work it inherits): a fully local stack; integration of
the two official data sources with row-level lineage; platform administration; employer directory, search and profiles;
job analysis against the seven sector workbooks; assessment drafts built from stated requirements and workbook skills;
manual task editing; a durable job queue; persistent AI checkpoints; and end-to-end tests of the complete journey.

---

## 2. Repository and Git state

| Item | Value |
| --- | --- |
| Repository | https://github.com/shmuhaisin/MIDAN (public) |
| Base branch | `candidate-portal` (local head `10068b0`; remote `origin/candidate-portal` at `2523115`) |
| New branch | `feature/midan-complete-data-jobs-assessment`, created from local `candidate-portal` |
| `main` | Not modified. Remote `main` is at `8f0235b`. |
| Push status | **Not pushed.** `git push -u origin feature/midan-complete-data-jobs-assessment` failed: `remote: Claude doesn't have GitHub access to shmuhaisin/MIDAN for your organization` / `fatal: unable to access 'https://github.com/shmuhaisin/MIDAN/': The requested URL returned error: 403`. Nothing was overwritten remotely. |
| GitHub branch URL (once pushed) | https://github.com/shmuhaisin/MIDAN/tree/feature/midan-complete-data-jobs-assessment |

To publish: give the Claude GitHub App access to the repository (or reconnect GitHub at https://claude.ai/connect-github),
then from the repository root:

```bash
git push -u origin feature/midan-complete-data-jobs-assessment
```

### Commit history

Inherited from earlier sessions (already on `origin/candidate-portal`):

| Hash | Message |
| --- | --- |
| e928da8 | Add Midan brand foundation, public site and service skeletons |
| 37ed8ed | Add Supabase database foundation and connect NestJS to it |
| bc4da06 | Add accounts, job browsing and first candidate and organization screens |
| 7990302 | Add core MVP workflows: assessments, submissions, evaluation and reports |
| 37f4383 | Correct the product experience and make Humaidan follow saved context |
| f30898c | Complete candidate profiles and fix reliability issues found while testing |
| 8f0235b | Enable real development registration and fix the database connection |
| 48ff56f | Add structured job requirements and link them to assessments |
| c2219ff | Support several assessments for one job |
| a53b984 | Add approved logo, palette, reference data import and account recovery |
| bcc0c46 | Build the candidate journey: CV privacy pipeline, applications, interviews, development |
| af9e1fd | Finish candidate journey tests, deployment checklist and privacy data flow |
| da8d0ce | Repair the import, separate test data, and rebuild candidate screens |
| 2523115 | Update browser tests for the repaired screens, and show own-words skills to organizations |

Added in this session (local only until pushed):

| Hash | Message |
| --- | --- |
| 959aa73 | Run the whole stack locally: Postgres, real Supabase Auth and PostgREST, local Storage |
| 8c261d3 | Add platform administration, a lineage-tracking import pipeline, job listing ingestion and a durable job queue |
| 2958f8f | Test administration, imports, listing ingestion, job analysis and the queue end to end |
| 62afa02 | Add the platform administration screens, and send aliases the source marks for review to a person |
| 482a373 | Build assessment drafts from stated requirements and linked workbook skills; persist AI checkpoints in Postgres; read Arabic scanned CVs |
| 59b2f3d | Integrate the official employer registry into the application |
| f90a71c | Make local test accounts match the hosted fixtures, and update the requirements browser test |
| 29a45e6 | Note that the queue retry test needs to be the only worker on the database |
| 10068b0 | Add the official source files to the repository, unmodified, with checksums |
| b82e0b4 | Complete the job-specific assessment journey on the sector workbooks, with the employer screens it needs |
| (head) | This handoff document |

---

## 3. Prepared data sources

Both files are in the repository **exactly as supplied**, with SHA-256 checksums (`data/source/SHA256SUMS`;
verify with `cd data/source && sha256sum -c SHA256SUMS`). See `data/source/README.md`.

| Path | SHA-256 |
| --- | --- |
| `data/source/ALMIDAN_Employer_Database_10_Entities.xlsx` | `b0fe8409…afbf9` |
| `data/source/بيانات القطاعات.zip` | `49d26533…93308` |
| `data/source/sector-skills/*.xlsx` | the seven workbooks extracted byte for byte (CRC-checked), original names kept |

The uploaded copies were byte-identical to the files imported earlier in the session.

### Employer workbook — every sheet

| Sheet | Rows | Columns / content |
| --- | --- | --- |
| Employers | 10 | `company_id, name_ar, name_en, entity_type, sector, official_website, career_url, verification_source, verification_status, partnership_status, notes` |
| Brand Profiles | 10 | `company_id, name_ar, official_website, logo_asset_url, primary_hex, secondary_hex, official_font, identity_status, usage_permission, notes`. **No logo, colour or font for any employer**; all `not_verified` / `permission_not_verified`; note: "Use neutral ALMIDAN template until brand assets and usage permission verified". |
| Employer Aliases | 11 | `company_id, name_variant, language, alias_status` |
| Sources | 10 | `company_id, source_url, source_type, checked_on` (all `official_source`, checked 2026-11-05) |
| Jadarat Jobs | **0** | Header only: `jadarat_job_id, employer_name_raw, company_id, job_title, job_description, requirements, job_url, scraped_at, match_status`. **There are no job records.** |
| README | 8 distinct notes | Scope ("Employer identity registry only; jobs to be scraped from Jadarat separately"), "Diriyah: DGDA only; do not confuse with Diriyah Company", "All entities marked not_partner; no affiliation claimed", brand rights note. Three notes are repeated in the sheet; each is kept once. |

### The 10 employers (all `not_partner`)

| ID | Arabic name | English name | Verification |
| --- | --- | --- | --- |
| ALM-001 | وزارة التجارة | Ministry of Commerce | verified_official |
| ALM-002 | الهيئة العامة للترفيه | General Entertainment Authority | verified_official (career URL not verified, empty) |
| ALM-003 | شركة علم | Elm Company | verified_official |
| ALM-004 | هيئة تطوير بوابة الدرعية | Diriyah Gate Development Authority | verified_official |
| ALM-005 | شركة الاتصالات السعودية (stc) | Saudi Telecom Company (stc) | pending_live_verification |
| ALM-006 | الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا) | Saudi Data and Artificial Intelligence Authority (SDAIA) | pending_live_verification |
| ALM-007 | شركة الصحراء العالمية للبتروكيماويات (سبكيم) | Sahara International Petrochemical Company (Sipchem) | pending_live_verification |
| ALM-008 | الهيئة السعودية للبحر الأحمر | Saudi Red Sea Authority | pending_live_verification |
| ALM-009 | وزارة المالية | Ministry of Finance | pending_live_verification |
| ALM-010 | صندوق التنمية الصناعية السعودي | Saudi Industrial Development Fund | pending_live_verification |

**Aliases needing a person:** ALM-004 «بوابة الدرعية» (`ambiguous_manual_review`) and ALM-008 «هيئة البحر الأحمر»
(`common_manual_review`). An exact hit on either never produces an automatic match.

### The seven sector workbooks

الصناعة التحويلية (manufacturing), السياحة والضيافة (tourism_hospitality), التشييد والأنشطة العقارية
(construction_real_estate), الخدمات المالية والتأمين (financial_services), القطاع الرقمي (digital), الثقافة والترفيه
(culture_entertainment), تجارة الجملة والتجزئة (wholesale_retail).

Structure (not identical across workbooks; the extractor finds headers wherever they are): cover, index and
introduction (informational); a **priority sheet** (stated totals plus an explicit list of priority skills with
sub-sectors and job families); a **skill list** (skill, priority yes/no, sub-sectors, job families); one **matrix sheet
per sub-sector** (columns = sub-sector × job family × technical/general; cells = skills); and **description sheets** for
technical and general skills. One hidden sheet (`FuzzyLookup_AddIn_Undo_Sheet`, construction) isn't read.

| Workbook | Technical | General | Sub-sector × family links | Job families |
| --- | --- | --- | --- | --- |
| Digital | 955 | 22 | 3,504 | 17 |
| Culture and entertainment | 899 | 25 | 4,138 | 33 |
| Tourism and hospitality | 669 | 23 | 7,543 | 26 |
| Manufacturing | 918 | 22 | 15,272 | 10 |
| Construction and real estate | 652 | 27 | 1,960 | 14 |
| Financial services and insurance | 357 | 17 | 2,774 | 13 |
| Wholesale and retail | 467 | 21 | 4,247 | 20 |
| **Total** | **4,917** | **157** | **39,438** | |

The workbooks hold no proficiency levels, skill identifiers or English skill names; none are invented.

### Missing data

- **Job records:** none. The Jadarat Jobs sheet is empty, no other job file was supplied, and neither database holds any
  prepared jobs. **The job dataset is still missing.**
- **Brand assets:** none, and no permission. Every employer shows MIDAN's neutral identity.
- **Employer → MIDAN organization:** no organization account represents any of the 10 employers yet (see §5).

---

## 4. Data import and database state

### Import pipeline

```bash
node scripts/import-data.mjs --sectors "data/source/بيانات القطاعات.zip" --employers data/source/ALMIDAN_Employer_Database_10_Entities.xlsx
node scripts/import-data.mjs --listings <file.json> --source-type employer_provided|employer_career_site|jadarat|other_authorized
```

- Extractors: `scripts/extract-reference-data.py`, `scripts/extract-employers.py` (run by the importer in an isolated
  interpreter with only `openpyxl`). They stop on unreadable sheets and report everything else as issues.
- Writes go through `private.begin_import`, `private.import_skill_batch`, `private.import_employer_batch`,
  `private.import_listing_batch`, `private.record_import_issues`, `private.finish_import`, called as the
  **`midan_importer`** role, which can do nothing else.
- **Lineage:** `import_runs` (files, SHA-256, every sheet and how it was handled, statistics, the extractor's report) and
  `import_records` (one row per source row: file, sheet, row, raw value, stored value, status `imported | updated |
  unchanged | duplicate | rejected | ambiguous | warning`, issue kind, review status). `reference_skills` and
  `employer_registry` keep `source_file`, `source_sheet`, `source_row`, `source_value` and `last_import_run_id`.
- **Duplicate prevention:** upserts keyed by `company_id` and by `(sector_code, skill_kind, name_ar)`; repeats inside a run
  are recorded as `duplicate`; names that differ only in spelling are kept apart and sent to review, never merged.
  Re-running reports `unchanged` and adds no rows (verified repeatedly).

**Records pending review** (latest local run): 225 ambiguous — 118 near-identical spellings, 89 skills found only in a
sub-sector sheet, 15 descriptions without a listed skill, 1 priority skill missing from the skill list, 2 skills flagged
priority but not on the priority list; plus 1 duplicate row and 18 stated-total warnings. Nothing was rejected.

### Local vs hosted (verified 2026-11-06, read-only on hosted)

Hosted project: `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`, region eu-central-1. (Never touch the unrelated
`ALNADA` project.) There is one hosted database for every git branch.

| | Source files | Local | Hosted Production |
| --- | --- | --- | --- |
| Migrations | — | 27 (all) | 23 (the four below are missing) |
| employer_registry / aliases / sources | 10 / 11 / 10 | 10 / 11 / 10 | 10 / 11 / 10 — every field identical to local |
| reference_skills | 5,074 | 5,074 | **5,073** |
| reference_skill_contexts | 39,438 | 39,438 | 39,438 — identical |
| organizations | — | 2 demo | 2 demo (`demo-najd-analytics`, `demo-sahel-finance`) |
| jobs | 0 prepared | 2 demo | 2 demo (published, 0 applications) |
| external_job_listings | 0 | 0 | 0 |

- Comparison method: per-sector MD5 fingerprints over content, lineage and links with `COLLATE "C"` ordering on both
  sides (hosted's default collation sorts Arabic differently, which made naive fingerprints differ).
- **The only data difference:** hosted lacks «إدارة علاقات الأعمال» (financial services, technical), which appears only
  on that workbook's priority sheet (row 34). Six sectors are identical in every field; financial services matches
  exactly once that skill is excluded.
- Hosted also lacks everything the four migrations add (lineage tables, brand columns, admin, queue, job analysis,
  organization ↔ employer link).

### Migrations added on this branch (local only)

| File | Adds |
| --- | --- |
| `20261106140000_platform_admin_and_data_pipeline.sql` | `private.platform_admins`, admin read policies and functions; `midan_importer` role; `import_runs`, `import_records`; lineage and brand columns; external listing ingestion columns, `external_job_skills`; `private.match_employer`, `private.match_text`, `private.mentions`, `private.classify_text`; listing review functions |
| `20261106150000_background_jobs_and_job_analysis.sql` | `background_jobs`, `midan_worker` role, claim/settle/retry functions; `midan_ai` role and `ai_checkpoints` schema; admin-managed `learning_resources`; `job_analyses`, `public.analyze_job`, `accept_job_analysis`, `dismiss_job_analysis` |
| `20261106160000_assessment_reference_skills.sql` | `assessment_tasks.reference_skill_ids`, `rubric_criteria.reference_skill_id`, guard that a task names only skills linked to its job |
| `20261106170000_employer_profiles_and_job_links.sql` | `organizations.employer_registry_id` (admin-only), `public.search_employers`, `public.employer_jobs`, `public.admin_link_organization_employer` |

All four are additive: no existing row changes meaning, and nothing is dropped.

### Exact hosted changes awaiting approval (not done)

1. Apply the four migrations above, in order (Supabase `apply_migration`), then check `supabase_migrations.schema_migrations`.
2. Set a password for `midan_importer` (owner does this; never in the repository) and run the import against hosted with
   `IMPORT_DATABASE_URL` set. This adds the one missing skill, lineage and brand fields; everything else reports
   `unchanged`.
3. Set passwords for `midan_ai` (checkpoints) where the AI service is hosted; `midan_worker` needs none (assumed by `midan_api`).
4. Add the first platform administrator: `insert into private.platform_admins (user_id) select id from public.users where email = '<owner email>';`
5. Demo organizations: delete nothing. Optionally set the two demo jobs to `draft` once real jobs exist.
6. Deciding how employers get organization accounts (§5, §13) and importing job data come after.

---

## 5. Employer integration

- **Directory** `/[locale]/employers` → `GET /v1/reference/employers?q=`: all 10, with verification, partnership
  ("Not a Midan partner"), aliases ("Also known as") and open-opportunity counts.
- **Search** (`public.search_employers`): official Arabic and English names, aliases, company IDs, tolerant of Arabic
  spelling (ة/ه, hamza forms, diacritics, article). Each result says whether it matched the official name, an alias
  (with the alias's source status) or the company ID.
- **Profile** `/[locale]/employers/[id]` → `GET /v1/reference/employers/:id`: identity, verification and its source,
  partnership, notes as stated, official names and aliases kept apart, brand status, sources with check dates, lineage
  (file, sheet, row), and connected opportunities. Missing values are shown as "Not provided in the source".
- **Branding:** the API returns logo, colours and font only when `usage_permission = 'permission_verified'` and
  `identity_status = 'verified'`. Today no employer qualifies, so all use a neutral building mark and MIDAN colours.
- **Organization ↔ employer:** `organizations.employer_registry_id`, set only by a platform administrator through
  `public.admin_link_organization_employer` (admin Accounts screen, `POST /v1/admin/organizations/:id/employer`).
  Demo and test organizations can never be linked. Linking never changes partnership status. A linked organization's
  published jobs carry the employer (`GET /v1/jobs/:id` → `organizations.employer_registry`), appear on the profile, and
  can be filtered with `GET /v1/jobs?registry=<id>`; job pages link to the employer profile.
- **Admin:** `/[locale]/admin/employers` shows every field with lineage and lets an administrator add confirmed aliases.
- **Limitation:** no organization is linked to any of the 10 yet; that needs real organization accounts (see §13).

---

## 6. Job integration

- **Data source:** none prepared (§3). MIDAN-native jobs come from organizations; imported listings come from
  `scripts/import-data.mjs --listings` or the workbook's Jadarat sheet.
- **Native jobs:** `jobs` (title/description/requirements in both languages, sector, experience level, employment type,
  salary, deadline, status `draft | published | closed`, `is_demo`), `job_requirements` (typed, mandatory flag,
  origin, review status), `job_skills` (internal draft skills), **`job_reference_skills`** (workbook skills, required or
  preferred).
- **Imported listings:** `external_job_listings` keep the collected record unchanged (`raw_record`, original title,
  description, requirements, employer name, source URL, collection time), match the employer
  (`match_status`, `match_confidence`, `match_evidence`), classify against the workbooks (`sector_code`,
  `job_family_ar`, `classification`, `external_job_skills` with the matched words), detect duplicates, and publish only
  after review (`/[locale]/admin/listings`). By the original design they link out to their source and can't be applied
  to inside MIDAN.
- **Browsing:** `/[locale]/opportunities` (filters: text, city, employer, sector, type, level; demo jobs only at
  `?demo=1`; test fixtures never shown), job detail `/[locale]/opportunities/[id]` with requirements, workbook skills,
  the candidate's match and the employer link.
- **Classification logic** (`private.classify_text`): literal whole-word mentions of workbook skill names (multi-word or
  8+ letters) after punctuation removal and Arabic normalization, also after the conjunction «و»/«وال» for names long
  enough to be unambiguous. Sector = most-mentioned; confidence = its share; job family and sub-sector = most frequent
  pairing in the workbooks; fewer than two mentions = unclassified.
- **Job analysis** (`public.analyze_job`, `/v1/organizations/:orgId/jobs/:jobId/analyses`): proposes `mentioned` skills
  (with the matched words; required when a mandatory requirement names them) and `family` priority skills (never
  required). The employer's own sector choice wins over the classifier. Nothing changes until the employer accepts.

---

## 7. Candidate application workflow

| Step | Frontend | API | Tables |
| --- | --- | --- | --- |
| Profile, skills | `/profile`, `/onboarding` | `PUT /v1/me/candidate-profile`, `PUT /v1/me/reference-skills`, `PUT /v1/me/own-skills` | `candidate_profiles`, `candidate_reference_skills`, `candidate_skills` |
| CV (optional) | `/profile/cv/[id]` | `POST /v1/me/cv`, `/v1/me/cv/analyses/*` | `cv_documents`, `cv_analyses`, `background_jobs` |
| Browse | `/opportunities`, `/opportunities/[id]` | `GET /v1/jobs`, `GET /v1/jobs/:id`, `GET /v1/me/jobs/:id/match` | `jobs`, `job_reference_skills` |
| Apply | `/opportunities/[id]/apply` | `POST /v1/jobs/:id/applications` (idempotent: a repeat returns the same application) | `applications` (`candidate_id`, `job_id`, `org_id`, `profile_snapshot`, `cv_snapshot_path`) |
| Track | `/dashboard`, `/applications/[id]` | `GET /v1/me/applications`, `GET /v1/me/applications/:id` | `application_status_history`, `notifications` |
| Withdraw | `/applications/[id]` | `POST /v1/applications/:id/withdraw` | ends the organization's access to the profile and CV |

**Statuses** (`application_status`): `submitted, under_review, assessment_invited, assessment_in_progress,
assessment_submitted, evaluated, shortlisted, rejected, hired, withdrawn`. `private.sync_application_status` moves an
application through the assessment stages from its attempts and never overrides a person's decision.

**Match** (`calculateMatch`, `apps/api/src/me/candidate.controller.ts`): required skills (workbook and internal) for
which the candidate has evidence, divided by required skills; evidence is either assessed (released results) or
self-reported, labelled separately. No percentage without required skills.

---

## 8. Assessment workflow

1. **Skills for the job:** stated requirements (`job_requirements`) plus workbook skills accepted through job analysis
   (`job_reference_skills`).
2. **Generation** (`POST /v1/organizations/:orgId/jobs/:jobId/assessment/generate` → AI service Graph A,
   `services/ai/midan_ai/assessment_builder.py`): one written case study per stated responsibility/daily task (linked
   through `task_requirement_mappings`, rubric criteria carry `requirement_id`); one task per **required** workbook skill
   (`assessment_tasks.reference_skill_ids`) whose first rubric criterion is the workbook's own description of the skill
   (`rubric_criteria.reference_skill_id`; without a description it says so instead of inventing one); data-analysis and
   objective-question tasks from approved templates. It validates coverage, repairs up to twice, and **stops for a
   person**: the result is a draft. No LLM writes drafts today (provenance `templates-v2-requirements`).
3. **Employer edits and approval:** edit titles, instructions, weights and criteria; **add or remove tasks and criteria**
   on drafts (`POST …/assessment-versions/:id/tasks`, `DELETE …/assessment-tasks/:id`, `POST …/assessment-tasks/:id/criteria`,
   `DELETE …/rubric-criteria/:id`); set deadline and timing; publish (`POST …/assessment-versions/:id/publish`, owner or
   admin). A published version is immutable and snapshots the requirements.
4. **Assignment:** applying assigns every **published** assessment of the job immediately (database trigger
   `private.assign_published_assessments`), whichever route created the application. Unpublished drafts are never sent.
5. **Candidate:** `/experience/[orgSlug]/[jobSlug]/[version]` → `GET /v1/experience/...` returns instructions only:
   no rubric, answer keys or measured-skill IDs. `POST /v1/attempts/:id/start`, autosaved `PUT /v1/attempts/:id/responses/:taskId`,
   evidence uploads, `POST /v1/attempts/:id/submit` (receipt code; answers lock).
6. **Evaluation** (`POST /v1/attempts/:id/evaluate`, Graph B `services/ai/midan_ai/evaluation.py`): objective questions
   scored deterministically from the answer key; open answers scored by the AI provider against the rubric, or in
   **labelled demo mode** (no API key configured) by a length-and-structure heuristic at low confidence. Prompt-injection
   attempts and low confidence are flagged. Results are `needs_human_review` with provenance per score.
7. **Review and release:** a person reviews and may change every score (`POST /v1/evaluations/:id/review`), adds internal
   notes (never shown to the candidate), then releases (`POST /v1/evaluations/:id/release`). The candidate sees the report
   at `/reports/[attemptId]`.

**Separation of candidate and internal material:** RLS never lets candidates read `rubric_criteria`, answer keys or
`evaluation_reviews`; the experience payload is stripped; rubric sharing is an explicit per-version setting
(`rubric_shared`). There are no "reference solutions" beyond answer keys for objective questions.

**Relationships:** `applications (candidate_id, job_id, org_id)` → `assessment_attempts (application_id, version_id,
candidate_id, org_id)` → `task_responses`, `evidence_files` → `evaluation_results (attempt_id)` → `criterion_scores`,
`skill_scores`, `evaluation_reviews`. The job's employer is `jobs.org_id → organizations.employer_registry_id`.

---

## 9. Employer-side evaluation

| Need | Screen | API |
| --- | --- | --- |
| Jobs | `/organization/[orgId]` | `GET /v1/organizations/:orgId/jobs` |
| Job workspace (details, requirements, workbook skills, assessment, candidates) | `/organization/[orgId]/jobs/[jobId]` | `GET /v1/organizations/:orgId/jobs/:jobId` (+ requirements, analyses, assessment) |
| Applications | job workspace, `/organization/[orgId]/applicants/[applicationId]` | `GET /v1/organizations/:orgId/applications`, `GET /v1/applications/:id/profile`, `GET /v1/applications/:id/cv-url` |
| Answers and evaluation | `/organization/[orgId]/review/[attemptId]` | `GET /v1/attempts/:id/evaluation` (answers, evidence, scores with provenance) |
| Compare | job workspace | `GET /v1/organizations/:orgId/jobs/:jobId/report` |
| Shortlist, interview, decide | applicant page | `PATCH /v1/applications/:id/status`, interviews and outcome endpoints |

Roles (`org_role`): `owner`, `admin` (publish, branding), `recruiter` (build), `reviewer` (evaluate). Other
organizations get 403/404 everywhere; tested.

---

## 10. Technical architecture

| Layer | Implementation |
| --- | --- |
| Web | `apps/web`: Next.js 16, React 19, Tailwind 4, next-intl (`/ar`, `/en`), next-themes; server actions call the API; session in httpOnly cookies |
| API | `apps/api`: NestJS 11, Prisma 6 (schema pulled from the database, never migrated by Prisma), Swagger at `/docs`; logs in as `midan_api`, which assumes `authenticated`/`anon` per transaction so RLS applies |
| Database | Supabase Postgres; schema owned by `supabase/migrations`; 52 public tables locally; RLS on all |
| Auth | Supabase Auth; the API verifies tokens with `/auth/v1/user`; sign-up gated by a server-held access code |
| Storage | Supabase Storage with policies on `storage.objects`; signed URLs |
| AI | `services/ai`: FastAPI + LangGraph; Graph A (assessment builder), Graph B (evaluation), CV privacy pipeline (local extraction, OCR with tesseract `ara+eng`, redaction, outbound check); checkpoints in Postgres (`ai_checkpoints`, role `midan_ai`) when `CHECKPOINT_DATABASE_URL` is set |
| Background jobs | `background_jobs`; worker inside the API (`apps/api/src/jobs-queue/worker.ts`) claims with `FOR UPDATE SKIP LOCKED` as `midan_worker`, acts as the queuing user, retries with backoff; CV analysis runs through it |
| Admin | `private.platform_admins`; `PlatformAdminGuard` asks the database |

Roles: `midan_api` (API), `midan_importer` (imports only), `midan_worker` (queue only), `midan_ai` (checkpoints only).
No service-role key is used anywhere.

---

## 11. Files changed (this session)

Added:
- `data/source/**` — official files, extracted workbooks, `SHA256SUMS`, `README.md`.
- `supabase/migrations/20261106140000_…`, `…150000_…`, `…160000_…`, `…170000_…` — §4.
- `supabase/local/00_supabase_shim.sql`, `05_auth_functions.sql`, `10_local_logins.sql` — local-only Supabase compatibility and fixed local passwords.
- `scripts/local-db.sh`, `local-supabase.mjs`, `local-tools.sh`, `local-env.mjs`, `local-setup.sh` — local stack.
- `scripts/import-data.mjs` — import pipeline.
- `apps/api/src/admin/admin.controller.ts`, `admin/integrations.ts` — administration.
- `apps/api/src/jobs/analysis.controller.ts` — job analysis.
- `apps/api/src/jobs-queue/worker.ts`, `errors.ts` — background worker.
- `apps/api/src/pipeline.e2e-spec.ts` — 28 end-to-end tests.
- `apps/web/src/app/[locale]/admin/**`, `components/admin.tsx`, `lib/admin-actions.ts` — admin screens.
- `apps/web/src/app/[locale]/employers/[id]/page.tsx` — employer profile.
- `apps/web/src/components/job-analysis.tsx` — job analysis panel.
- `services/ai/tests/test_requirements_builder.py`; `docs/local-development.md`; this file.

Modified (main ones):
- `scripts/extract-reference-data.py`, `extract-employers.py` — sheet inventory, priority list, raw values, issues.
- `apps/api/src/me/career.controller.ts` — employer search and profile; `jobs/jobs.controller.ts` — employer on jobs, registry filter; `me/cv.controller.ts` — queue; `assessments/assessments.controller.ts` — requirements and workbook skills into Graph A, task and criterion add/remove; `attempts/attempts.controller.ts` — candidate payload stripped; `organizations/organizations.controller.ts` — job's workbook skills; `db/db.service.ts` — `asWorker`; `common/database-exception.filter.ts` — 404/400 mapping; `prisma/schema.prisma` — regenerated.
- `apps/web/src/app/[locale]/employers/page.tsx` — search; `opportunities/[id]/page.tsx` — employer link; `organization/[orgId]/jobs/[jobId]/page.tsx` — workbook skills section; `components/workspace.tsx` — task/criterion editing; `messages/ar.json`, `en.json`.
- `services/ai/midan_ai/assessment_builder.py`, `schemas.py`, `templates.py`, `main.py`, `cv.py` — requirement-driven drafts, Postgres checkpoints, bidi-mark fix for Arabic OCR.
- `apps/web/e2e/*.spec.ts`, `playwright.config.ts` (`CHROMIUM_PATH`), `supabase/test-cleanup.sql`, `docs/DECISIONS.md`, `docs/database/README.md`, `README.md`, `.gitignore`, `.gitattributes`.

Removed: nothing.

---

## 12. Tests and verification

All run in this session against the **local** stack (local Postgres, real GoTrue and PostgREST, AI service in demo mode).
Nothing was run against hosted Production.

| Suite | Command | Result |
| --- | --- | --- |
| API end-to-end | `npm run test:e2e -w @midan/api` | **108 / 108 passed** (80 foundation + 28 pipeline) |
| API unit | `npm test -w @midan/api` | 7 / 7 passed |
| Web unit (messages parity, Humaidan rules) | `npm test -w @midan/web` | 7 / 7 passed |
| Type checks | `npm run lint` | passed (api and web) |
| AI service | `cd services/ai && TEST_CHECKPOINT_DATABASE_URL=… uv run pytest` | **91 passed** (includes Postgres checkpoints and a scanned Arabic CV through OCR and redaction) |
| Web production build | `MIDAN_DIST_DIR=.next-build npm run build -w @midan/web` | succeeded |
| Browser (Playwright) | `CHROMIUM_PATH=<headless shell> npm run test:e2e -w @midan/web` | **27 / 28 passed**; the failure is known and pre-existing (below) |

End-to-end scenarios covered by the API tests include: the complete journey on workbook skills (job analysis → draft
from requirements and workbook skills → approval → browse with match → apply with immediate assignment → instructions
without rubric → submit → evaluation against the employer's rubric → review → release → application `evaluated`, and
isolation from other organizations and candidates); employer directory, alias and spelling search, profile accuracy,
admin-only linking, listing-to-profile; each of the seven workbooks classifying a job correctly; import lineage and
review; listing matching, duplicates and publish rules; the queue's retry and dedupe; the existing foundation suite
(tenant isolation, RLS without the backend, roles, assessment lifecycle, CV privacy, interviews with Daily and Calendar
stand-ins, sign-up gate, storage policies).

**Known failures and caveats:**
- Browser test `a candidate builds a full profile and CV…` fails in a full run because an earlier test adds skills to the
  same account; it passes alone after `supabase/test-cleanup.sql`. Pre-existing ordering dependency.
- The API queue-retry test needs its worker to be the only one: stop any running dev API (or run it with
  `BACKGROUND_WORKER=off`) before the API suite.
- Use a Playwright *headless shell* binary for `CHROMIUM_PATH`; with full Chromium an off-screen lazy image never loads
  and one character test waits forever.

**Manual verification still required:** a real AI provider (no key configured); real Daily and Google Calendar
(stand-ins only); a complete real sign-up with a real inbox on hosted Auth; anything on hosted Production; native
Arabic copy review; an accessibility audit.

---

## 13. Remaining work (priority order)

1. **Publish this branch** — needs GitHub write access for Claude (§2).
2. **Job data** — supply the prepared job database. The importer already handles Jadarat-format rows. Blocks
   "browse jobs of the 10 employers".
3. **Owner decision: employer organizations.** Who reviews applications for each of the 10? Proposed: one MIDAN
   organization per employer, linked by a platform administrator, reviewers added as members; imported jobs then become
   applicable jobs under it. Needs one small admin function and a listing → job conversion step. Not built, pending the
   decision; no registration or verification system is involved.
4. **Hosted changes** in §4, once approved.
5. Brand assets with permission, if they exist.
6. Resolve the 225 review items in `/admin/review`.
7. Earlier backlog not touched here: team invitations UI, configurable interview evaluation criteria, ESLint and CI,
   legal pages, real integrations, accessibility audit, PDPL review before real candidate data.

---

## 14. Setup and continuation

**Tools:** Node 20+ (tested 22), npm 10, PostgreSQL 16 binaries, uv (Python 3.12+; tested 3.13), tesseract with `ara`
for OCR, Linux x86-64 for the downloaded Auth/PostgREST binaries.

**Environment variable names** (values never committed; `scripts/local-env.mjs` writes local ones):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, `API_URL`,
`AI_SERVICE_URL`, `AI_SERVICE_TOKEN`, `CHECKPOINT_DATABASE_URL`, `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
`OPENAI_API_KEY`, `OPENAI_MODEL`, `DEV_TEST_SIGNUP`, `DEV_TEST_ACCESS_CODE`, `APP_URL`, `DAILY_API_KEY`,
`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`,
`IMPORT_DATABASE_URL`, `BACKGROUND_WORKER`, `BACKGROUND_WORKER_POLL_MS`, `CHROMIUM_PATH`, `TEST_CHECKPOINT_DATABASE_URL`.
Test account variables `TEST_*_EMAIL` / `TEST_*_PASSWORD` live in `.env.test.local`.

The fixed passwords and JWT secret in `supabase/local/*.sql` and `scripts/local-*.mjs` are **local-only development
values** for a database bound to 127.0.0.1; they are not used by, and give no access to, any hosted service.

```bash
npm install
```

```bash
scripts/local-setup.sh
```

(Database, migrations, local Auth/PostgREST/Storage gateway, `.env`, test accounts, demo seed and the official data
import from `data/source/`.)

Daily:

```bash
scripts/local-db.sh start
```

```bash
node scripts/local-supabase.mjs
```

```bash
cd services/ai && uv sync && uv run --env-file ../../.env uvicorn midan_ai.main:app --port 8000
```

```bash
npm run dev:api
```

```bash
npm run dev:web
```

New migrations: `scripts/local-db.sh migrate`. Database shell: `scripts/local-db.sh psql`. Prisma schema refresh:
`docs/database/README.md` ("Updating the Prisma schema"). Admin area: `/ar/admin` as `midan.test.platform-admin@example.com`.

Tests: see §12. After API tests: `scripts/local-db.sh psql -f supabase/test-cleanup.sql`.

**Read first:** `docs/local-development.md`, `docs/database/README.md`, `docs/DECISIONS.md`, `data/source/README.md`,
`supabase/migrations/20261106140000_platform_admin_and_data_pipeline.sql`, `…150000_…`, `…170000_…`,
`apps/api/src/pipeline.e2e-spec.ts` (the journey as executable documentation),
`services/ai/midan_ai/assessment_builder.py`, `apps/api/src/me/candidate.controller.ts` (match),
`apps/web/src/components/job-analysis.tsx`, `HANDOFF.md` and `PROJECT_STATUS.md` (earlier sessions).
