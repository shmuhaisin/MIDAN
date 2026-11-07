# MIDAN — Assessment Intelligence: Handoff

Written 2026-11-07. Implements the reference-based assessment standard, its quality benchmark and the unseen-job benchmark.
Local branch **`midan-assessment-intelligence`**, cut from `midan-assessment-editing-policy` at `0e0d1ff`, which contains the
canonical `midan-phases-2-3-4` (`ba1d25c`) plus the approved editing policy. It was cut from the editing-policy branch because the
brief requires building on that policy (audit, review, immutability) rather than duplicating it.

**Not pushed, not merged. No hosted Supabase migration applied. Nothing deployed.** Committed locally only.

## 1. Deliverables

| Deliverable | Where |
| --- | --- |
| Reference library inventory (structure only, no reference content) | `docs/assessment/REFERENCE_LIBRARY_INVENTORY.md` |
| MIDAN Assessment Standard MAS-1.0 | `docs/assessment/MIDAN_ASSESSMENT_STANDARD.md`; machine-readable `services/ai/midan_ai/standard.py` |
| Generation quality benchmark | `docs/assessment/GENERATION_QUALITY_BENCHMARK.md` |
| Unseen-job benchmark (Cybersecurity Analyst) | Candidate-facing: `docs/assessment/benchmarks/cybersecurity-analyst/`. Assessor-only: git-ignored `.local/assessment-benchmarks/cybersecurity-analyst/` (not committed) |
| This handoff | `docs/handoffs/MIDAN_ASSESSMENT_INTELLIGENCE_HANDOFF.md` |

## 2. What the references taught, in one paragraph

22 distinct packages (one duplicate archive) were read; their structure is in the inventory. The complete ones separate three
audiences — candidate brief, data package, assessor guide — and share a skeleton: a self-sufficient brief, sufficient fictional data,
an internal guide with a reference solution, calculations, decision points, common mistakes, a 100-point weighted rubric on a 0–4
scale, no pass mark, and sources with dates. They differ by job family in effort (60 minutes to 6 hours), deliverables and what the
guide must carry. Their inconsistencies (a 1–4 scale, fractions vs points, a version mismatch, guides without data that can't be
re-derived, regulatory claims without articles) became validation rules.

## 3. What changed

### AI service (`services/ai`)

| File | Change |
| --- | --- |
| `midan_ai/standard.py` (new) | MAS-1.0: 9 job families with effort ranges and required guide elements, company types, sector vocabulary, rubric rules, 52 validation rules with dimension and severity |
| `midan_ai/schemas.py` | `JobInput` gains `company_type`, `sector`, `experience_level` (**the known gap, fixed**). The package: `CandidateBrief`, `Material`, `Deliverable`, `AssessorGuide` (solutions, calculations with recompute checks, decision points, verification steps, boundaries, sources, approval notes, skill map), criterion `points`, level descriptors and evidence. All optional, so the earlier tasks-only drafts still validate |
| `midan_ai/quality.py` (new) | The evaluator (benchmark doc, section 2) |
| `midan_ai/package.py` (new) | Package ↔ database storage, both directions, in one place: the API writes what `to_stored` returns and sends back what it stored |
| `midan_ai/providers.py` | Generation prompt `gen-v2-mas1`: the full package, three separated layers, 100-point rubric, sources for any law cited, no pass mark |
| `midan_ai/assessment_builder.py` | The model receives company type, sector, level and a summary of the standard; a model sees **every** stated responsibility (the templates' limit of 4 no longer applies to it — found by the benchmark); a new `assess_quality` step before human review; the review payload carries the version fields, the guide and the report |
| `midan_ai/main.py` | `POST /quality/evaluate` (service token): checks a version as stored. No model called |
| `benchmarks/run_benchmark.py` (new) | Runs a package through Graph A (mock provider) and the evaluator with the attached files' rows |

Unchanged: the provider abstraction (`JsonLLMProvider`, `_openai`, `_gemini`, `get_provider`), evaluation (Graph B), the template
fallback, CV analysis. Gemini and OpenAI remain behind the same contract; the standard adds fields to it, not a second engine.

### Database: `supabase/migrations/20261107160000_assessment_intelligence.sql`

| Object | Purpose |
| --- | --- |
| `organizations.company_type` | One of the standard's 8 company types; owners and admins set it |
| `assessment_versions.candidate_package` | The structured brief and materials. Candidate-facing |
| `public.assessment_assessor_guides` | The guide, one per version. Read: organization members only (RLS, same rule as the rubric); never a candidate, another organization or an anonymous caller. Write: owners, admins, recruiters, draft only. No delete grant: a version under the standard keeps its guide |
| `private.write_assessment_audit()` (replaced) | Also records guide changes and `candidate_package` changes, with before and after |
| `private.is_reviewable_change()` (replaced), index | Guide edits must be reviewed before approval, like rubric edits |
| `private.assessment_version_content()` (replaced) | Kept copies (generated, revision base, approved) now include the package, each task's skills and the guide |
| `private.carry_standard_into_revision()` | A revision of an approved version starts with its guide and package (recorded as the revision's work) |
| `public.assessment_quality_reports` | Reports, readable by members; written only by `private.record_quality_report`, executable only by `midan_worker` (MIDAN's service role) |
| `private.assessment_content_digest()`, `public.assessment_content_digest()` | A fingerprint of everything the standard judges |
| `quality_gate` trigger | Approval of a version under the standard needs its guide and a `ready` report on its current digest |

**Rollback:** `supabase/rollback/20261107160000_assessment_intelligence.down.sql` restores the three replaced functions verbatim
from `20261107150000` and drops the rest. **Checked:** a schema dump with the 40 earlier migrations equals one taken after applying
this migration and rolling it back (apart from `pg_dump`'s random session token).

### Core API (`apps/api`)

| Change | Where |
| --- | --- |
| Generation sends company type (organization's, or `company_type` in the request), sector and level; never the company's name | `assessments.controller.ts` `generate`, `assessment-quality.ts` `loadJobInput` |
| A standard draft stores scenario, instructions, effort, window and `candidate_package` on the version and the guide in its own table, in the generation transaction (recorded as generation); then the check runs and its summary is returned | `generate` |
| `GET …/assessment-versions/:id/guide` (staff), `PUT …/guide` (builders; audited, reviewed), `POST …/quality` (builders; checks and records), `GET …/quality` (latest report and whether it is still current) | `assessments.controller.ts` |
| Publish of a version under the standard checks it first and answers 422 with the summary if it isn't ready | `publish` |
| `PATCH /organizations/:id/company-type` | `organizations.controller.ts` |
| New refusals map to 422 | `database-exception.filter.ts` |
| Prisma: `organizations.company_type`, `assessment_versions.candidate_package` | `prisma/schema.prisma` |

Web (`apps/web`): **not changed** (section 7).

## 4. Tests and exact results

Environment: Windows 11, Node 22.19, Python 3.14 (virtual environment with the AI service's dependencies), PostgreSQL 18.3 scratch
cluster (shim and minimal `auth` stand-in). No Docker or local Supabase stack. No provider keys.

| Check | Result |
| --- | --- |
| AI service `pytest` | **172 passed, 5 skipped** (147 + 3 skipped before; +22 standard tests, +5 benchmark tests; the 2 new skips are the real-provider tests) |
| `supabase/tests/assessment_intelligence.sql` (41 migrations, PostgreSQL 18) | **All passed**: company type; generated draft and guide kept; guide readable by owner, recruiter and reviewer, not by another organization's owner, a candidate or an anonymous caller; outsiders can't write or get a digest; guide and package edits audited and reviewable; no guide deletion; owners can't record or insert reports; stale digest refused; blocked report stops approval; a change after a ready report stops approval; a current ready report allows it; approved guide immutable; no report on an approved version; revision carries guide and package and is gated |
| `supabase/tests/assessment_editing_policy.sql`, `supabase/tests/security_phase1.sql` | **All passed** (unchanged behaviour) |
| Rollback | Schema identical before and after apply and roll back |
| API unit tests | **73 / 73**, 10 suites (69 before; +3 quality mapping, +1 error mapping) |
| Web unit tests | **23 / 23** (unchanged) |
| `npm run lint` (API and web type checks, including end-to-end specs) | **Passed** |
| API build, web production build | **Succeeded** |
| Real Gemini / OpenAI tests | **NOT RUN** — no keys |
| API end-to-end, browser journeys | **Not run** — they need the local Supabase stack. No new end-to-end tests were written for this work |

## 5. Benchmark result

Cybersecurity Analyst, fictional Saudi technology startup, mid level (benchmark doc, section 4). Authored by Claude (the coding
agent) to MAS-1.0 and run through Graph A via the **mock** provider path — not a live model. Verdict **ready**, overall **98**, 9 of
9 reference figures recomputed from the candidate's files, 3 warnings for unverified sources. Reviewed by hand against every
section of the standard after the automated check; three defects found and fixed before the final result. The same job through
the template fallback is `blocked` / not standardized, as it should be.

## 6. Confidentiality

- The repository is public. No reference package, reference text, figure, data row or answer key is committed; the inventory is
  structure only. The packages were extracted outside the repository.
- The benchmark's guide, job input, data generator and full report are in `.local/` (already git-ignored); only candidate-facing
  files and the guide's SHA-256 are committed. Keep `.local/assessment-benchmarks/` backed up privately; it is the only copy.
- The candidate-facing benchmark files are public now, so this dataset must not be used as a live assessment.

## 7. Not done, and next steps

1. **Web screens.** No screen shows the guide, the quality report or the structured materials yet. Today: staff use the new
   endpoints; candidates see the scenario, the composed instructions and the tasks (which already carry everything needed), but
   materials such as the CSV logs are not delivered to them by the product — the benchmark's files exist as documents only.
   Needed: a guide and quality panel beside the review panel; candidate rendering of `candidate_package` (tables, policies) and a
   way to attach material files to a version.
2. **Real providers.** Add keys locally and run `MIDAN_REAL_PROVIDER_TESTS=1` (benchmark doc, section 5); record what a real model's
   package scores. Expect some model drafts to be `blocked` at first; the report says what to revise.
3. **End-to-end tests** for generate → guide → quality → publish on the local stack, then browser checks.
4. **Rehearse the migration** with `scripts/rehearse-migrations.sh` (PostgreSQL 17, non-superuser) before any hosted window. It is
   the 18th pending migration for hosted, after the editing policy's, and must ship with this branch's API and AI service (the old
   API can't record reports, so standard versions couldn't be approved).
5. **Specialist review** of the benchmark's reference solution and the three unverified sources; pilot the 180-minute estimate.
6. The evaluator is heuristic for realism and relevance (benchmark doc, section 2). A model-assisted reviewer could be added later
   as advice, never as the gate.

## 8. Owner decisions needed

1. **Scope of the gate.** Today only versions under the standard (with a guide) are gated; employer-authored and template drafts
   keep today's behaviour. Should every version need the standard? (That would block template drafts, which can't meet it.)
2. **Who writes guides.** Employers may edit the guide under the editing policy (audited, reviewed). Confirm that matches the
   ownership decision, or restrict guide edits to MIDAN.
3. **Guide language.** MAS-1.0 requires both languages for everything candidates read and for criterion levels, but allows the
   guide's narrative in one. Require Arabic?
4. **Publishing benchmark materials.** The candidate-facing benchmark files are in the public repository. Keep them public, or move
   them to `.local/` too?

## 9. Rules followed

New branch from the approved baseline; no push, no merge; no hosted migration; no deployment; no confidential answer keys or
reference content committed; no source workbooks or assessor-only content exposed; nothing copied verbatim from the references;
existing behaviour preserved (all earlier tests pass); test results reported as run, with what wasn't run named.
`docs/handoffs/MIDAN_CURRENT_STATE_AND_NEXT_STEPS.md` remains untracked, as before.
