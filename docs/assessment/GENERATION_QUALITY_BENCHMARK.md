# MIDAN — Generation Quality Benchmark

Written 2026-11-07 on branch `midan-assessment-intelligence`. Measures whether MIDAN's assessment generation meets the MIDAN
Assessment Standard (MAS-1.0, `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md`), and records what was and wasn't run.

## 1. How each result was produced

Every result below names how it reached a provider. These are different things and are never reported as each other:

| Label | Meaning |
| --- | --- |
| **evaluator** | The deterministic quality evaluator and mapping only. No provider involved |
| **mock** | A stand-in answers in the OpenAI or Gemini wire format (or as a plain function). Exercises MIDAN's real pipeline; **not** a real integration |
| **template** | MIDAN's template fallback, used when no model is configured (provenance mode `demo`) |
| **real** | A live Gemini or OpenAI call with real keys. **NOT RUN**: no keys exist in this environment |

## 2. The quality evaluator

`services/ai/midan_ai/quality.py`, version `quality-v1`. Deterministic: the same package gets the same report whichever provider
produced it.

- **14 dimensions**, each scored 0–100 with evidence, missing elements, errors and warnings: completeness, relevance (job, company
  type, sector), skill coverage, realism, difficulty, clarity, data sufficiency, measurability of deliverables, rubric quality,
  scoring consistency, reference-answer consistency, candidate/assessor separation, integrity (unsupported claims, fabricated data,
  personal attributes), language (Arabic and English).
- **Score:** a dimension starts at 100 and loses 35 per error and 10 per warning. Overall is the mean of the 14.
- **Verdict:** `blocked` on any error; `needs_revision` if overall < 75 or a dimension < 50; otherwise `ready`.
- **Reference figures are recomputed.** A guide's calculation may carry a `check` — a closed set of operations (`count`,
  `count_distinct`, `sum`, `min`, `max`, `first`, `last`, `argmax_count`) with filters — that the evaluator runs on the materials'
  rows. Nothing is evaluated as code.
- **Separation** compares every candidate-facing text with the guide's reference results and with guide-only phrases (answer key,
  reference solution, assessor guide, common mistakes, in both languages).
- **Similarity is not rewarded.** The evaluator takes `(job, package, rows)` and nothing else: no reference package is an input, and
  there is no similarity dimension. A test pads a draft with text written to sound like a reference package and checks the score
  doesn't rise (it falls: the padding mentions guide-only terms).
- **Enforcement:** see section 6.

What it cannot judge: whether a reference solution is *correct* beyond the figures it can recompute; whether a scenario is
*realistic* beyond structural proxies (length, fictional company, window, effort, no placeholders); relevance beyond the job's own
words and the sector's vocabulary. A specialist's review remains a step in the standard (approval notes) for that reason.

## 3. Benchmark tests and exact results

AI service: `services/ai/tests/test_assessment_standard.py` (22 tests) and `services/ai/tests/test_cyber_benchmark.py` (5 tests).

| Required benchmark (from the brief) | Test | Label | Result |
| --- | --- | --- | --- |
| Unseen job | `test_mock_the_benchmark_goes_through_graph_a_and_is_ready_with_every_figure_recomputed` | mock | **Passed** (needs the local guide; see section 5) |
| Different structures per job family | `test_job_families_require_different_structures` | evaluator | **Passed** |
| Arabic and English | `test_arabic_and_english_are_both_required` | evaluator | **Passed** |
| Company type and sector in the context | `test_company_type_and_sector_must_shape_the_context`; `test_mock_provider_package_is_stored_apart_and_checked_with_the_jobs_context` (the model receives company type, sector, level and the standard, never a company name) | evaluator, mock | **Passed** |
| Skill mapping | `test_every_task_maps_to_the_job_and_every_requirement_is_measured` | evaluator | **Passed** |
| Complete assessor guide | `test_a_complete_package_is_ready_and_every_dimension_has_evidence`; `test_reference_answers_must_follow_from_the_materials` | evaluator | **Passed** |
| 100-point rubric validation | `test_the_rubric_must_total_100_with_levels_and_evidence`; `test_a_levelled_criterion_scores_out_of_4_and_a_task_weighs_its_points` | evaluator | **Passed** |
| No candidate exposure | `test_assessor_only_content_never_reaches_the_candidate`; `test_the_stored_candidate_side_holds_no_guide_content_and_the_round_trip_keeps_the_report`; `test_the_candidate_view_holds_no_assessor_content`; `test_the_guide_never_appears_in_the_repository_files`; database: `supabase/tests/assessment_intelligence.sql` | evaluator, mock, database | **Passed** |
| No unsupported facts or legal claims | `test_no_unsupported_legal_claims`; `test_personal_attributes_are_refused` | evaluator | **Passed** |
| No fabricated source data | `test_no_fabricated_source_data`; `test_the_materials_match_their_declared_columns_and_are_fictional` | evaluator | **Passed** |
| Provider-independent validation | `test_mock_openai_and_gemini_wire_formats_get_the_same_validation` (identical reports) | mock | **Passed** |
| Template fallback is labelled | `test_template_fallback_is_labelled_and_not_standardized` | template | **Passed** |
| Real Gemini / OpenAI | `test_real_provider_generates_a_package_the_evaluator_can_judge[openai]`, `[gemini]` | real | **NOT RUN** — skipped: no keys. Runs with `MIDAN_REAL_PROVIDER_TESTS=1` and keys in the environment |
| Similarity not rewarded | `test_resembling_a_reference_earns_nothing` | evaluator | **Passed** |

Full AI suite: **172 passed, 5 skipped** (the 3 skips that existed before, plus the 2 real-provider tests). Without the local
guide, the 2 guide-dependent benchmark tests are also skipped, and say so.

## 4. The unseen job

**Cybersecurity Analyst**, mid level (3–5 years), at **Thamar Cloud**, a fictional Saudi technology startup of about 120 people
in Riyadh whose cloud platform serves small retailers. Company type `startup`, sector `digital`.

Fictional job description (the job input given to generation):

- **Responsibilities:** triage security alerts and separate real attacks from noise; investigate incidents from logs and
  reconstruct what happened; recommend containment and classify severity under the incident response policy. **Daily tasks:**
  write and tune detection rules; report findings clearly to management. **Education** (not mandatory): a computing degree or
  equivalent experience.
- **Required skills:** log analysis, incident response, detection engineering, security reporting.

No reference package covers this role or its family. The standard handles it by composition: primary family
`technical_operations` (investigate and operate systems), secondary `data_analytical` (compute from data) — so the package must
carry decision points and verification steps, a table or log with a full data dictionary, and a recomputable calculation behind
every data task.

### The generated package

| | |
| --- | --- |
| Scenario | Overnight high-severity endpoint alerts on the Finance file server; the team lead wants to know what happened, how serious it is under the policy, what to do now, and a rule to catch the first stage next time without paging on the approved scanner |
| Effort / window | 180 minutes (estimate, not a timer) / 72 hours |
| Materials | Sign-in log (314 rows × 8), endpoint alerts (8 × 7), asset inventory (5 × 6), incident response policy (English and Arabic). All fictional, every column with meaning and unit |
| Deliverables | Incident report (PDF); detection rule (Markdown); four questions answered in MIDAN |
| Tasks and points | 1. Investigate the incident — 50 (4 criteria) · 2. Classify, contain and report — 25 (3) · 3. Detection rule — 15 (2) · 4. Quick checks on the logs — 10 (4 questions) |
| Rubric | 100 points, 10 criteria, each with descriptors for levels 0–4 in Arabic and English and the evidence the assessor must point to |
| Assessor guide | Scope and limits; a reference solution, expected outputs, accepted alternatives and common mistakes per task; 9 calculations, each with a recompute check; 4 decision points; 5 verification steps; boundaries (no pass mark, no automatic rejection, no scoring of legal accuracy); what isn't scored; 4 sources with verification status; approval notes; skill map; a rationale per objective question |
| Skill mapping | Every responsibility and daily task, and all four skills, measured by at least one task (and every written task by its criteria) |

**How it was produced — stated plainly.** No provider key exists here, so no live model generated it. The package was **authored
by Claude, the coding agent in this session**, to the standard, from the fictional job input above; the data files were made by a
seeded script. It was then given to MIDAN's Graph A **as a model's reply through the mock provider path** (`JsonLLMProvider` with a
stand-in function, provenance `live` / `mock-benchmark-provider`), so it went through exactly the steps a real model's draft goes
through: the contract, the id and coverage checks, normalization, mapping to database storage, the quality step, and human review.
It is a benchmark of MIDAN's pipeline and standard, and an example of the output a model should produce; it is **not** evidence of
what Gemini or OpenAI would generate.

Files: candidate-facing in `docs/assessment/benchmarks/cybersecurity-analyst/`. Assessor-only (guide, job input, data generator,
full report) in the git-ignored `.local/assessment-benchmarks/cybersecurity-analyst/` on the owner's machine, never committed:

| Local file | SHA-256 |
| --- | --- |
| `package.json` (the full package, including the guide) | `15a5e0a446843525b0513464d51b470142a1be60ccabd1a1336240f05ef59d17` |
| `job.json` (the fictional job input) | `df71db6950ba98014b13787c5d6dfef3047bc485d304dc4769e5c385bd62876e` |

To rerun: `python services/ai/benchmarks/run_benchmark.py .local/assessment-benchmarks/cybersecurity-analyst/package.json
.local/assessment-benchmarks/cybersecurity-analyst/job.json docs/assessment/benchmarks/cybersecurity-analyst/candidate
.local/assessment-benchmarks/cybersecurity-analyst`.

### Automated result (mock)

Verdict **ready**, overall **98**. Reference figures recomputed from the candidate's CSV files: **9 of 9**, all matching.

| Dimension | Score | | Dimension | Score |
| --- | --- | --- | --- | --- |
| completeness | 100 | | measurability | 100 |
| relevance | 100 | | rubric_quality | 100 |
| skill_coverage | 100 | | scoring_consistency | 100 |
| realism | 100 | | reference_consistency | 100 |
| difficulty | 100 | | separation | 100 |
| clarity | 100 | | integrity | **70** |
| data_sufficiency | 100 | | language | 100 |

Errors: none. Warnings (3, `source_unverified`): the NCA's Essential Cybersecurity Controls, the PDPL and RFC 5737 are cited
without verification — no web access was used, so they are marked unverified, and a specialist must check them before use. They
appear only in the guide's boundaries (as context a candidate may raise, never scored) and to explain the addresses.

### Review against the standard (by hand, after the automated check)

The automated verdict is not the end of the review. The package was read against each section of the standard:

| Standard | Finding |
| --- | --- |
| §2 Separation | Candidate view (`assessment.json`) holds no rubric, guide, level descriptors or answers (also tested). Objective options include the answer among distractors, by design; the key is only in the rubric |
| §3 Brief | Every field present in both languages; the company is stated as fictional, a startup, in technology; effort is an estimate; AI use allowed with disclosure; submission format named |
| §4 Materials | Every figure in the reference solution is derivable from the CSVs (9 recomputed). Distractors are declared in the guide: the approved scanner's probes, a normal user's typos, unrelated low-severity alerts |
| §5 Tasks | Each task's instructions name every element its criteria score (checked one by one); no personal attributes |
| §6 Mapping | All five responsibilities and four skills measured |
| §8 Boundaries | No pass mark; no legal advice requested; regulations named only as unscored context with unverified sources; the policy is the company's own and fictional |
| §9 Rubric | 100 points; 10 criteria between 5 and 15 points; distinct level descriptors in both languages; evidence for each |
| §10 Effort | 180 minutes within `technical_operations` 90–240 for mid level; four decision points |

Three defects found by this review and **fixed** before the result above: (1) the reference solution's spray window ran to the
last MFA retry rather than the last account tried; (2) it didn't say why the VPN sign-in shows an approved MFA (the VPN rides on
the SSO session the user had approved); (3) one level descriptor said "As 3, …" instead of standing on its own. One the data
itself confirms: a distinct-accounts rule flags exactly two sources — the attack and the approved scanner — so task 3's exclusion
problem is real (tested). Remaining limitations: the guide's narrative is in English only (criteria, levels and evidence are in
both languages); the 180-minute estimate is unpiloted; and the candidate screens don't yet show the structured materials (handoff,
section 7).

### The same job through the template fallback (template)

No model configured: 5 tasks, four identical "A case study from the role" and one set of generic questions; only four of the five
responsibilities (the templates' limit); no materials, no guide. Reported `blocked` / not standardized, provenance `demo`. This is
the honest baseline the standard is meant to raise.

## 5. Real providers

**NOT RUN.** No Gemini or OpenAI key is configured. To run: put `GEMINI_API_KEY` and `GEMINI_MODEL` (or `OPENAI_API_KEY` and
`OPENAI_MODEL`) in your local `.env` yourself — never in a chat or a commit — then
`MIDAN_REAL_PROVIDER_TESTS=1 python -m pytest services/ai/tests/test_assessment_standard.py -k real`. The test asserts only that the
draft is judged and that a draft that isn't ready says what to revise; whether a real model's package reaches `ready` is the
measurement to record when it runs.

## 6. Enforcement in the product

- Graph A checks every draft after generation; the Core API stores the report.
- A version with an assessor guide is **under the standard**; so is every later version of the same assessment.
- Approval of such a version needs a quality report that is `ready` **and** whose content digest matches the version now (computed by
  the database). A report is written only by MIDAN's service role (`midan_worker`); organization users can't write or forge one.
- The API's publish runs the check first and answers 422 with the summary if the version isn't ready; the database refuses
  regardless (`supabase/migrations/20261107160000_assessment_intelligence.sql`, tested in `supabase/tests/assessment_intelligence.sql`).
- Versions without a guide (employer-authored, template drafts) keep today's behaviour; the report calls them not standardized.
