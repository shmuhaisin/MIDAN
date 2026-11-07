# MIDAN Assessment Standard — MAS-1.0

| | |
| --- | --- |
| Version | **MAS-1.0** (2026-11-07) |
| Status | Draft for owner approval. Implemented in `services/ai/midan_ai/standard.py` and enforced by `services/ai/midan_ai/quality.py` |
| Derived from | The structure of 22 reference packages (`docs/assessment/REFERENCE_LIBRARY_INVENTORY.md`). No reference content is reproduced |
| Applies to | Every assessment MIDAN generates. Employer-authored versions without an assessor guide are "not standardized" (section 11) |

## 1. Versioning

The standard has a version string, `MAS-<major>.<minor>`. Every assessor guide and every quality report stores the version it was
written or checked against, so a later standard never silently re-judges an approved version. A minor version may add warnings;
only a major version may add errors (checks that block approval). The machine-readable copy (`STANDARD_VERSION` in
`standard.py`) and this document change together, in the same commit.

## 2. Anatomy of an assessment

Every assessment has three layers. They are separated by storage and by database authorization, not by convention.

| Layer | Holds | Who can read it | Where it is stored |
| --- | --- | --- | --- |
| **Candidate brief** | Scenario, company context, objective, tasks and their instructions, deliverables, effort, window, rules, tools, assumptions and AI-use policy, submission format | The candidate, once the version is published and assigned | `assessment_versions` (scenario, instructions, timing) and its `candidate_package`; `assessment_tasks` (instructions, deliverables and materials per task in `config`) |
| **Materials** | Every input the work needs: tables, logs, policies, documents, each with provenance | The candidate | `candidate_package.materials` (small, inline) or files attached to the version |
| **Assessor guide** | Scope and limits, reference solution per task, expected outputs, calculations, decision points, accepted alternatives, common mistakes, verification steps, criterion level descriptors and evidence requirements, sources, approval notes | Organization staff only (owner, admin, recruiter, reviewer). **Never** a candidate | `assessment_assessor_guides` (row-level security; no candidate path) |
| **Rubric** | Criteria with points and answer keys | Organization staff; the candidate only if the employer chooses to share criterion descriptions (never answer keys) | `rubric_criteria` (existing) |

Rules:

1. Nothing that only the assessor may see is written into a candidate-facing field: not a reference figure, not an answer, not a
   common mistake, not a level descriptor. The quality evaluator checks this (section 9, `separation`).
2. Objective answer keys live only in `rubric_criteria.answer_key`, as before.
3. Once a version is published, its brief, materials, tasks, rubric and guide are immutable together.

## 3. Candidate brief

Required, in Arabic **and** English:

| Field | Requirement |
| --- | --- |
| Company context | A fictional company, stated as fictional, whose **type** and **sector** match the job's (section 7). Never a real organization's name, data or branding |
| Scenario | The situation the candidate is placed in, written as work, not as an exam. At least 40 words |
| Objective | What the work must achieve, in one or two sentences |
| Required work | One task per distinct piece of work; each task names its deliverables and the materials it uses |
| Effort | Suggested minutes, presented as an estimate, never a timer unless the employer sets one. Within the job family's range for the level (section 10) |
| Window | Hours from invitation to deadline, 24–168 (references use 72) |
| Deliverables | Each with a name, format (`pdf`, `docx`, `xlsx`, `csv`, `md`, `code_repository`, `link`, `text`), what it must contain, and the tasks it answers |
| Rules | At least: rely on the provided materials; state any extra assumption explicitly; show working where a figure is asked for |
| Tools | What may be used. If a tool is required, it must be freely available |
| Assumptions policy | How to handle missing or ambiguous information: state it, don't invent it |
| AI-use policy | `allowed_with_disclosure`, `not_allowed` or `company_decides` — stated before the attempt |
| Submission format | How to hand in: a single file, files plus a link, or answers in MIDAN |

## 4. Materials (the data package)

1. **Sufficient:** every figure the reference solution relies on is derivable from the materials. A calculation whose input is not
   in a material is an error.
2. **Structured:** tables declare their columns with meaning and unit (a data dictionary); logs declare their fields; documents and
   policies have titles.
3. **Facts versus assumptions:** a material is `fictional` (made by MIDAN for the assessment), a `public_dataset` (with source and
   licence), or `employer_provided` (with source). Real-world claims inside fictional material (a law, a market figure) follow
   section 8.
4. **Deliberate gaps are declared:** if the task tests whether a candidate notices missing information, the gap is listed in the
   assessor guide as a decision point; it must not be an accident.
5. **No irrelevant noise without purpose:** distractor records are allowed when the guide names them and says what a strong answer
   does with them.

## 5. Tasks and deliverables

1. Every task maps to at least one stated responsibility, required skill or workbook skill of the job (section 6).
2. Every task has at least one deliverable; every deliverable is answered by at least one task.
3. Instructions are numbered observable actions ("calculate", "list", "rank", "write"), not "discuss" or "be aware".
4. No hidden requirements: anything a criterion scores is asked for in a task's instructions or follows unavoidably from them.
5. No personal attributes are asked about (age, gender, nationality, religion, family, health).
6. Written work: 2 or more criteria per task. Objective questions: each question has 2 or more distinct options and exactly one
   answer, stored in the answer key.

## 6. Skill coverage and mapping

- Each task records the skills (`skill_ids`), workbook skills (`reference_skill_ids`) and responsibilities (`requirement_ids`) it
  measures. Only ids the job states may be used.
- Every mandatory responsibility and every required workbook skill is measured by at least one task **and** at least one criterion.
- The guide's skill map says, per task, how each mapped skill shows in the work.

## 7. Context: company type, sector and level

Generation receives, and the brief must reflect:

| Input | Values |
| --- | --- |
| Company type | `private_company`, `startup`, `sme`, `large_enterprise`, `government_entity`, `semi_government`, `nonprofit`, `multinational` |
| Sector | `digital`, `culture_entertainment`, `tourism_hospitality`, `manufacturing`, `construction_real_estate`, `financial_services`, `wholesale_retail`, `other` (the job's existing sector values) |
| Level | `entry`, `junior`, `mid`, `senior`, `lead` (the job's existing experience level) |

When the employer has stated a company type or sector, the company context and scenario must be recognisably of that type and
sector (the evaluator looks for the sector's vocabulary). Context the employer didn't state is not invented as fact.

## 8. Content boundaries

1. **Fictional by default.** Companies, people, systems and figures are fictional and labelled so.
2. **No fabricated source data.** A material that claims to be real (public dataset, employer data) names its source; a public
   dataset also names its licence.
3. **Legal and regulatory claims.** Any reference to a law, regulation, standard or authority (in any layer) needs an entry in the
   guide's sources with: kind (`official`, `press`, `dataset`, `internal_fictional`), and verification status (`verified` with an
   access date, or `unverified`). Unverified sources are allowed in a draft but produce a warning that a specialist must check
   them before use. A press report is never cited as the rule itself.
4. **No legal, investment or medical advice** is requested from candidates or given by the guide as authoritative.
5. **No pass mark and no automatic rejection.** The guide states that the score supports a person's decision. `pass_mark` must be
   empty.
6. **Approval notes.** The guide says what must happen before use: specialist review of the reference solution, verification of
   sources, and a pilot with a small group when the assessment is new.

## 9. Rubric

| Rule | Value |
| --- | --- |
| Total | Exactly **100 points** across the assessment |
| Criteria | 3–10 in total; written tasks 2–5 each |
| Points per criterion | 5–40 |
| Levels | **0–4** for every criterion: 0 no evidence · 1 major errors · 2 partial · 3 correct with minor gaps · 4 complete. Each criterion has its own descriptor for each level, distinct from the others |
| Evidence | Each criterion says which part of which deliverable the assessor must point to |
| Score | `criterion score = points × level ÷ 4`; assessment score = sum. Stored as `max_score = 4`, `weight = points`, and task weight = the sum of its criteria's points, which the existing evaluation already computes as exactly this sum |
| Objective tasks | One criterion, `max_score` = number of questions, `weight` = its points |
| Justification | The assessor records the evidence and a reason for every level given (existing review flow) |

## 10. Complexity and effort by job family

The job family decides which guide elements are mandatory and the effort range. A job may have a primary family and secondary
families; the requirements are the union.

| Family | Effort range (minutes, by level entry → lead) | Mandatory in the guide | Typical deliverables |
| --- | --- | --- | --- |
| `technical_build` | 180–360 | ≥ 3 runnable verification steps; accepted alternative designs | `code_repository`, `md` |
| `technical_operations` | 90–240 | Timeline or sequence reconstruction; decision points; verification steps | `md`, `pdf`, `csv` |
| `data_analytical` | 90–300 | ≥ 1 calculation per analysis task with its inputs; a table material with a data dictionary | `xlsx`, `pdf`, `csv` |
| `financial` | 90–180 | Calculations; thresholds marked as assumptions | `xlsx`, `pdf` |
| `regulatory_compliance` | 90–180 | Sources with verification status for every rule cited; boundary: no legal advice | `pdf`, `docx` |
| `operational_coordination` | 60–90 | Constraints in a material; a reference solution meeting all of them; "any solution meeting every constraint is accepted" | `pdf`, `xlsx` |
| `creative_content` | 90–240 | Mandatory constraints (accessibility, rights, brand) in the rules; what is not scored | `link`, `pdf` |
| `customer_service` | 45–90 | Policy material; decision points on what may be offered | `text`, `docx` |
| `engineering_quality` | 90–180 | Data dictionary with units; declared gaps; safety boundary | `xlsx`, `pdf` |

Within a range, effort scales with level: entry and junior sit in the lower half, senior and lead in the upper half, and senior
and lead assessments carry at least two decision points.

## 11. Validation and the quality gate

The evaluator (`quality.py`) scores 14 dimensions from 0 to 100, each with evidence, missing elements, errors and warnings:

`completeness` · `relevance` (job, company type, sector) · `skill_coverage` · `realism` · `difficulty` · `clarity` ·
`data_sufficiency` · `measurability` · `rubric_quality` · `scoring_consistency` · `reference_consistency` · `separation` ·
`integrity` (unsupported claims, fabricated data, personal attributes) · `language` (Arabic and English).

| Verdict | Condition | Effect |
| --- | --- | --- |
| `blocked` | Any error | Cannot be approved |
| `needs_revision` | No errors, but the overall score is under 75 or a dimension is under 50 | Cannot be approved |
| `ready` | No errors, overall ≥ 75, every dimension ≥ 50 | May be approved (after the editing policy's review) |

The report lists required revisions, one per error and one per weak dimension.

**Enforcement.** A version that has an assessor guide — every version MIDAN generates under this standard, and any revision of it —
can be published only with a quality report that is `ready` **and** was computed on the version's current content (a content
digest the database computes). A change after the check makes the report stale and approval is refused until it is checked again.
Reports are written only by MIDAN's service role, never by an organization's users. An assessment that once had a guide keeps
needing one: a later version without its guide is refused.

**Not standardized.** Versions without a guide (employer-authored assessments, and drafts made by the template fallback when no model
is configured) keep today's behaviour and validation. The evaluator reports them as not standardized. The owner decided on
2026-11-07 that only generated versions are gated, not every version (`docs/DECISIONS.md`).

**Similarity is not quality.** The evaluator never compares a draft with a reference package and has no similarity input. A draft
is judged against this standard's rules, its own job's inputs, and its own materials.

## 12. Validation rules (codes)

Errors block; warnings inform the reviewer. The full list with severities is `RULES` in `standard.py`; the main ones:

| Code | Severity | Rule |
| --- | --- | --- |
| `brief_field_missing` | error | A required brief field (section 3) is empty in either language |
| `no_materials` | error | A family that needs data has no material |
| `calculation_input_missing` | error | A calculation names an input not in the materials |
| `reference_check_failed` | error | A reference figure recomputed from the materials doesn't match the guide |
| `task_without_solution` | error | A task has no reference solution or expected output |
| `task_without_deliverable` / `deliverable_unused` | error | Section 5.2 |
| `rubric_total_not_100` | error | Points don't sum to 100 |
| `criterion_points_out_of_range` | error | Outside 5–40 |
| `criterion_levels_incomplete` | error | Not all of levels 0–4, or two levels share a descriptor |
| `criterion_without_evidence` | error | No evidence requirement |
| `task_weight_mismatch` | error | Task weight ≠ sum of its criteria's points |
| `requirement_not_measured` / `skill_not_measured` | error | Section 6 |
| `context_ignored` | error | Stated company type or sector not reflected in the company context |
| `assessor_content_exposed` | error | A reference figure, answer or guide-only phrase appears in candidate-facing text |
| `regulatory_claim_unsourced` | error | A law or authority is referenced without a source entry |
| `material_unsourced` | error | Non-fictional material without a source (and licence, for a public dataset) |
| `personal_attribute` | error | A task asks about a personal attribute |
| `pass_mark_set` | error | The guide sets a pass mark |
| `language_missing` | error | A candidate-facing field lacks Arabic or English text |
| `source_unverified` | warning | A cited source is not verified |
| `effort_out_of_range` | warning | Effort outside the family's range for the level |
| `vague_instruction` | warning | Unbounded wording ("etc.", "as appropriate") in instructions |
| `few_decision_points` | warning | Senior or lead with fewer than two decision points |
| `placeholder_text` | error | "TODO", "lorem", "xxx", "[...]" in any layer |

## 13. What the standard does not decide

- A pass mark (the employer's decision, per role; MIDAN sets none).
- Legal accuracy of cited regulations: the standard requires sources and verification status; a specialist verifies them.
