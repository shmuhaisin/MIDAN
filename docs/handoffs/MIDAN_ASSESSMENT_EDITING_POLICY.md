# MIDAN — Assessment Editing Policy: Implementation Report

Written 2026-11-07. Implements the owner's approved assessment editing policy. Local branch `midan-assessment-editing-policy`, cut
from `midan-phases-2-3-4` at `ba1d25c`. **Not pushed, not merged; nothing applied to hosted Supabase or deployed.**

## 1. The decision

Employers may add, edit and delete a draft's tasks, questions, instructions, rubric criteria, objective options and answer keys.
Every change is recorded and reviewed. MIDAN remains responsible for generation, skill mapping, quality validation and the
assessment framework. Recorded in `docs/DECISIONS.md` (top entry); it settles the two earlier ownership entries there.

## 2. What was there before, and what was reused

- **Audit trail:** `public.audit_logs`, written by `private.write_audit()` (`20261104220032`). Employers could already only read it
  (owners and admins, by RLS); no one had insert, update or delete grants. `20261107120000` had attached `write_audit` to updates
  and deletions of tasks and criteria, but that function records only status and role: no content, and nothing on additions.
- **Immutability:** `private.guard_version_content` already refused any change to a published version's tasks, criteria and links,
  and attempts could only point at published versions.
- **Assignment:** `private.assign_published_assessments` already gives a new applicant the newest published version.

Reused, not duplicated: the same `audit_logs` table, its read policies and its no-write grants; the same immutability guard; the
same assignment trigger. `private.write_audit()` itself was left alone, because widening it would copy candidate data (application
snapshots, for instance) into the log. A content-recording trigger function was added for assessment drafts only.

## 3. Schema changes: `supabase/migrations/20261107150000_assessment_editing_policy.sql`

| Object | What it does |
| --- | --- |
| `private.write_assessment_audit()` | Writes one `audit_logs` row per create, update or delete of `assessment_tasks`, `rubric_criteria`, `task_requirement_mappings`, and edits to a version's instructions and settings. Row: `org_id`, `actor_id` (the signed-in caller), `action` (`create`/`update`/`delete`), `entity`, `entity_id`, `created_at`, and `details` = `assessment_id`, `version_id`, `version_number`, `task_id`, `criterion_id`, `requirement_id`, `source` (`edit`, `generation` or `revision`), `kind` (`content` or `settings`), `reason`, `old`, `new`. A deleted task's `old` includes its rubric and requirement links. Updates that change nothing aren't recorded |
| Triggers | Replace the two `write_audit` triggers of `20261107120000` with `write_assessment_audit` (after insert/update; **before** delete on tasks, so the rubric is still there to record). Added on criteria, requirement links and version updates |
| Change source | Set per transaction by the Core API: `midan.assessment_change` = `generation` while it writes a generated draft, `revision` inside `create_assessment_revision`. Anything else, including a direct Data API write, is a person's `edit`. `midan.change_reason` carries the reason given |
| `public.assessment_version_snapshots` | MIDAN's kept copies: `generated` (the draft as MIDAN generated it), `revision_base` (a new version as copied from an approved one) and `approved` (written when the version is published). Readable by organization members; nobody can write, change or delete them except the functions here |
| `public.record_generated_draft(version)` | Called by the API in the generation transaction. Refused once anyone has changed the version, so a person can't record their own work as MIDAN's |
| `private.validate_assessment_version(version)`, `public.assessment_validation(version)` | MIDAN's checks (section 5) |
| `public.assessment_change_reviews` | A review: who, when, up to which change (`reviewed_through`), how many changes, the validation as it stood, and an optional note. Written only by `review_assessment_changes` |
| `public.review_assessment_changes(version, through, note)` | Owners and admins only, drafts only. Refused unless `through` is the latest change, so a change made after the reviewer looked is never approved by accident |
| `public.assessment_version_changes(version)`, `public.assessment_review_state(version)` | What the review screen shows: original, current, every person's change, reviews, validation, latest change, whether anything is unreviewed. Owners, admins and recruiters of the organization |
| `private.guard_version()` (replaced) | Same as `20261105231005`, plus three steps at publish: MIDAN validation errors block; unreviewed changes block; the approved copy is kept |
| `public.create_assessment_revision(version)` | Copies an approved version into a new draft (next version number). Links the job no longer has (retired requirements, unlinked workbook skills) aren't copied, and validation then shows the gap. One draft per assessment at a time |
| Index `audit_logs_assessment_version` | On `details ->> 'version_id'`, for the assessment entities |

**Rollback:** `supabase/rollback/20261107150000_assessment_editing_policy.down.sql` restores `guard_version` as `20261105231005`
defined it and the triggers of `20261107120000`, and drops everything else. Snapshots and reviews are lost; audit rows stay.
Checked: on a scratch PostgreSQL 18 with the 39 earlier migrations, a schema dump before applying, and another after applying and
rolling back, are identical (apart from `pg_dump`'s random session token).

**Hosted:** not applied. Hosted has 23 migrations; this is the 17th pending one (`docs/handoffs/MIDAN_PHASE_2_PREPARATION.md`).
It hasn't been through the PostgreSQL 17 non-superuser rehearsal yet (`scripts/rehearse-migrations.sh`); run that before any
window. It must be released together with this branch's API: the old API and screen can't review, so approving an edited draft
would fail.

## 4. API: `apps/api`

| Change | Where |
| --- | --- |
| Optional `reason` (≤ 1,000 characters) on every edit: add/edit task, add/edit criterion, objective questions, version settings, task requirement links; `?reason=` on task and criterion deletion | `assessments.controller.ts`, `jobs/requirements.controller.ts`, `common/change-reason.ts` |
| Generation marks its writes as `generation` and records the generated draft | `assessments.controller.ts` `generate` |
| `GET /v1/organizations/:orgId/assessment-versions/:versionId/changes` — the review state | Owners, admins, recruiters |
| `POST …/assessment-versions/:versionId/review` `{ reviewed_through, note? }` | Owners, admins |
| `POST …/assessment-versions/:versionId/publish` `{ reviewed_through?, note? }` — with `reviewed_through`, reviews and approves in one transaction; without it, a draft with unreviewed changes gets 422 | Owners, admins |
| `POST …/assessment-versions/:versionId/revise` — a new draft from an approved version | Owners, admins, recruiters |
| Error mapping: the new refusals give 422 (or 403 for a review by the wrong role) even when Prisma drops the error code | `common/database-exception.filter.ts` |

Unchanged: who may edit (owners, admins, recruiters, as before) and who may approve (owners and admins).

## 5. MIDAN's validation

| Check | Code | Severity |
| --- | --- | --- |
| Mandatory responsibility or daily task measured by no task and no criterion | `requirement_not_measured` | warning |
| Required workbook skill measured by no task | `required_skill_not_measured` | warning |
| No tasks | `no_tasks` | **error** |
| Task without criteria | `task_without_criteria` | **error** |
| Written task scored on one criterion | `written_task_single_criterion` | warning |
| Task tied to no responsibility, workbook skill or skill | `task_not_mapped` | warning |
| Criterion scoring a workbook skill its task doesn't measure | `criterion_skill_not_on_task` | warning |
| Objective task without questions | `objective_without_questions` | **error** |
| Answer key missing, naming a question that doesn't exist, or an answer not among the options; a question with fewer than two or duplicate options | `objective_answer_invalid` | **error** |
| Two tasks with the same title (Arabic normalized) or the same Arabic instructions | `duplicate_task` | warning |

Errors block approval. Warnings never block, by the owner's earlier choice that a company decides; they are shown on the screen,
and the review records them. "Contradictory" tasks are detected only as duplicates; deeper contradictions need a model or a person.

## 6. Web: `apps/web`

- `components/change-review.tsx`: the review panel. MIDAN's checks (errors and warnings); MIDAN's version beside the draft, task by
  task (unchanged, changed, added, removed); every change with who, when, the reason, and each field before and after, with changes
  that remove or unlink coverage listed first and marked **Weakens coverage**; earlier reviews; and, for owners and admins, "Mark
  these changes reviewed" with a note. `ReviseButton`: "Start a new version from this one" on an approved version.
- `components/workspace.tsx`: an optional reason field on the task, criterion, add-task and add-criterion forms. The approval panel
  says how many changes approving will record as reviewed, sends the last change it showed, and is replaced by an error message
  while MIDAN reports errors.
- `lib/assessment-review.ts`: `changedFields`, `weakensCoverage`, `compareTasks`, and the review state types. `lib/actions.ts`:
  `publishVersion` (with the reviewed change), `reviewChanges`, `reviseVersion`, reasons.
- `messages/{en,ar}.json`: 34 new keys in each language.

## 7. Tests and exact results

Environment: Windows 11, Node 22.19, Python 3.14 (virtual environment with `pyproject.toml`'s dependencies), PostgreSQL 18.3 binaries
for a scratch cluster. No Docker, WSL, `uv`, tesseract, or the Linux/macOS local Supabase stack.

| Check | Result |
| --- | --- |
| `supabase/tests/assessment_editing_policy.sql`, after all 40 migrations on PostgreSQL 18 (shim plus a minimal `auth` stand-in) | **All passed**: generated draft kept; add, edit (text, options, answer key, criterion) and delete each recorded with actor, organization, version, task or criterion, reason, before and after; deletion keeps the rubric; review state; refused for a reviewer, another organization and a candidate (nothing changed, nothing recorded); owners can't update, delete or insert audit rows, snapshots or reviews; validation warnings and an objective error; approval refused before review, after a later change, with errors, and for a recruiter; stale review refused; review by recruiter or reviewer refused; approved version kept and immutable; revision copies the version, leaves version 1 identical to its approved copy, keeps the first candidate on version 1 and gives a later candidate version 2; an edited copy can't be recorded as generated |
| `supabase/tests/security_phase1.sql` | **All passed**, after its setup was marked as MIDAN's generation (it writes a draft directly, as the API does) |
| Rollback | Schema identical before and after apply and roll back |
| API unit tests `npm test -w @midan/api` | **69 / 69**, 9 suites (65 before; 4 new error-mapping tests) |
| Web unit tests `npm test -w @midan/web` | **23 / 23** (19 before; 4 new for `changedFields`, `weakensCoverage`, `compareTasks`) |
| Type checks `npm run lint` | **Passed** (including all end-to-end specs) |
| API build, web production build | **Succeeded** |
| Build secret scan | **Passed**, 1,033 files |
| AI service `pytest` | **147 passed, 3 skipped** (unchanged; the AI service wasn't modified) |
| API end-to-end, browser, forms, live journey | **Not run**: they need the local Supabase stack |

New end-to-end tests, written and type-checked, **not run**: `foundation.e2e-spec.ts` "the assessment editing policy…" (8 cases:
generated draft kept; add, edit and delete recorded with reasons and before and after; refused roles and organizations; history
can't be edited; weakened coverage shown and recorded; review-before-approval and stale review; approved version immutable;
revision leaves attempts alone).

Existing tests changed because approval now needs a review: `foundation.e2e-spec.ts` (an `approve` helper that reviews then
publishes, used by every approval after an edit; the lifecycle test now also checks that approval is refused before the review),
`pipeline.e2e-spec.ts`, `live-journey.live-spec.ts`, `apps/web/e2e/candidate-journey.spec.ts`, `apps/web/e2e/characters.spec.ts`.
The browser journeys that approve through the screen are unchanged: the screen now sends the reviewed change itself.

## 8. Limitations and next steps

1. **Run the end-to-end suites** on the local stack (`docs/local-development.md`), then open the review panel in a browser. Neither
   has been done.
2. **Rehearse the migration** with `scripts/rehearse-migrations.sh` on PostgreSQL 17 as a non-superuser.
3. Drafts created before this migration have no recorded generated version; the screen says so and lists changes from then on.
4. Field names in the change list are shown as stored (`title_en`, `answer_key`); friendlier labels would help reviewers.
5. The same person may edit and review if they're an owner or admin. Requiring a different reviewer would need an owner decision.
6. Still open from the ownership decision, not part of this work: generation doesn't receive the job's sector or the company's
   type, and provenance has no separate provider field.
