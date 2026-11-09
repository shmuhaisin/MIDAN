# MIDAN — continuation audit

Continuation of `feature/midan-auth-jobs-ai-assessments` at `c678c56d94285b17617d772bd751645e1feaa54c` on
`feature/midan-teammate-completion`, 2026-11-09. Read with `docs/audit/MIDAN_COMPLETE_IMPLEMENTATION_AUDIT.md`, which this
document doesn't repeat: it records what changed, what was verified here, and what could not be.

Status words: **Verified here**, **Implemented, not verified here**, **Partial**, **Missing**, **Blocked
(credentials/external)**, **Blocked (this machine)**, **Needs a decision**.

## 1. Git and preserved work

| Item | Finding |
| --- | --- |
| Source | `origin/feature/midan-auth-jobs-ai-assessments` fetched; its tip is exactly `c678c56d94285b17617d772bd751645e1feaa54c`. |
| This branch | `feature/midan-teammate-completion`, created from that commit in a separate git worktree (`MIDAN-teammate/`). The name was free locally and on GitHub. |
| Local checkout | `MIDAN/` is on `feature/midan-full-ui-redesign` (`d8ea977`) with 107 uncommitted or untracked files (UI redesign work done on this machine). **Not touched:** no reset, clean, stash or checkout. A worktree was used so the branch could start from the exact commit without moving that work. |
| Local work vs the checkpoint | Compared file by file, ignoring line endings: 76 of the 107 files are identical to `c678c56` (the checkpoint already contains them). 31 differ. In most the checkpoint is ahead (later development on the other machine); the lines that exist only locally are the last redesign rounds' refinements: right-to-left chevrons, the shared masthead on opportunities, development, invitations and the review page, the review title's direction isolation, the opportunity page header. They are **not** in this branch yet: re-applying them needs a reviewed port onto the checkpoint, not a merge (see section 6). |
| Remote branches touched | Only `feature/midan-teammate-completion` (new). `main` and `feature/midan-auth-jobs-ai-assessments` were not modified. |

## 2. This machine, and what it can verify

Windows 11, Node 22, PostgreSQL 14 and 18 binaries, no Docker, no WSL distribution, no Go, no Python environment for the
AI service.

- **Blocked (this machine):** the local Supabase stack. `scripts/local-db.sh` and `scripts/local-supabase.mjs` run Linux
  x86-64 (or source-built) GoTrue and PostgREST, and the database migrations need the `auth` schema GoTrue creates. So
  the API e2e suite, the browser suites, the sign-up/verification/recovery journeys and the full migration chain can't run
  here. Unblocking needs one of: Docker (the repo has `docker-compose.yml`), a WSL Linux distribution, or the Go toolchain
  to build GoTrue as the previous session did on macOS. Installing any of these is the owner's call.
- **Blocked (this machine):** the AI service tests (`services/ai`, Python with `uv.lock`; no environment installed).
- **Runs here:** type checks, API unit tests, web unit tests, both builds, and SQL checks on a throwaway PostgreSQL 18
  cluster for migrations that don't depend on the `auth` schema.

### Baseline at `c678c56` (before any change)

| Check | Result |
| --- | --- |
| API type check (`tsc --noEmit`, includes the e2e specs) | Pass |
| API unit tests (`jest`) | 80/80, 13 suites |
| Web type check | Pass |
| Web unit tests (`node --test`) | 31/31 |
| API e2e, browser, forms, AI service | Not run: blocked on this machine (above). Historical: 182/182 e2e, 6/6 AI skills (previous session). |

## 3. Feature classification

| Area | Status | Evidence / note |
| --- | --- | --- |
| Supabase Auth: sign-up with access code, verification, sign-in/out, recovery, refresh, role redirects | Implemented, not verified here | Code paths read (`apps/web/src/proxy.ts`, `lib/account.ts`, `lib/auth-actions.ts`, `auth.guard.ts`). Live journeys need GoTrue. Previous session: 50/50 browser checks. |
| Candidate/organization separation (database) | Implemented, not verified here | `20261109120000_account_type_separation`. |
| Employer registry (10 entities) | Verified here (source) | The attached `ALMIDAN_Employer_Database_10_Entities.xlsx` matches `data/source/SHA256SUMS` byte for byte (`b0fe8409…`): it's the same official workbook already imported. All ten are `not_partner`. It stays out of git (no permission to publish). |
| Registry organization chosen at employer sign-up | Needs a decision | Unchanged: sign-up creates its own tenant; a claim links it to the registry after admin approval. |
| Job description persistence and use by AI | Implemented, not verified here | `jobs.description_ar/en`; read by analysis, generation and matching. |
| Dynamic job skills (`20261110090000_job_skill_suggestions`) | Implemented, not verified here | Migration and rollback present; latest migration before this branch's. Not rebuilt or changed. |
| Assessment generation with Groq | Implemented, not verified here | Needs the AI service and a Groq key; free-tier quota was exhausted in the previous session. |
| Assessment editing (title, instructions, tasks, rubric, weights, change review) | Implemented, not verified here | Unchanged. |
| **Task reordering** | **Implemented in this branch; database part verified here** | See section 4. |
| Versioning (published versions immutable, candidates keep their version) | Implemented, not verified here | Guard trigger `guard_version_content`; e2e coverage exists. |
| Applications, duplicates, submission, uploads, evaluation, release | Implemented, not verified here | Unchanged. |
| AI scoring failures (quota, rate limit, timeout, invalid reply) | Partial | No invented scores: a criterion the model can't score gets no proposal and the reason `model_failed:<criterion>` (`services/ai/midan_ai/evaluation.py`); 429s retry with retry-after, then fail. Missing: the reason doesn't say *which* failure (quota vs timeout vs invalid reply), so the employer can't be told precisely. |
| ATS matching (multilingual E5) | Implemented, not verified here | Unchanged. |
| Demo reset with stable ids | Implemented, not verified here | Unchanged. |
| Email delivery (SMTP) | Blocked (credentials) | No SMTP credentials; local mail sink only. |
| Palette | Needs a decision | Unchanged (gold palette approved earlier vs the newer list `#0F5B46 #1F7A5C #DCEEE5 #F7F4EE #1F2A26`). |
| Candidate deletion (PDPL) | Needs a decision | Unchanged: retention policy required. |

## 4. Changes in this branch

### Assessment task reordering

The brief asked for reordering that persists, survives reload, keeps task ids and evaluation references, and never
touches candidates' versions.

- **Database** `supabase/migrations/20261110120000_assessment_task_order.sql` (rollback
  `supabase/rollback/20261110120000_assessment_task_order.down.sql`): the unique `(version_id, position)` constraint
  becomes `DEFERRABLE INITIALLY IMMEDIATE` under the name `assessment_tasks_version_position_key`. Every statement still
  checks it at once; only a transaction that asks can defer the check to commit. The migration finds the old constraint
  by its columns, not by an assumed name.
- **API** `PUT /organizations/:orgId/assessment-versions/:versionId/task-order` with `{ task_ids, reason? }`: builders
  only (`BUILDERS`), the body must list every task of the version exactly once (else 422), each moved task is updated
  once to its final position, unchanged tasks aren't touched, and the change history records the moves with the reason
  (default "Tasks reordered"), for review before approval like any other edit. A published or archived version is refused
  by the existing guard (422).
- **Web** move up / move down controls on each task of an editable draft (`components/workspace.tsx`), saving the whole
  order through `reorderTasks` (`lib/actions.ts`); the page then shows the saved positions. Labels in Arabic and English.
- **Prisma** schema notes the constraint's new name.
- **Tests**
  - Verified here, on a throwaway PostgreSQL 18 cluster with the table's original constraint: the migration finds and
    replaces it; without `SET CONSTRAINTS` a duplicate position is still refused immediately; a full reverse succeeds in
    one deferred transaction; a real duplicate is still refused at commit; the rollback restores the original constraint.
  - Added, not run here: `foundation.e2e-spec.ts` → "reordering the tasks of a draft": persistence and reload, ids and
    rubrics kept, one history entry per real move (no temporary positions), a no-op order records nothing, 422 for
    missing/repeated/foreign tasks, 403 for another organization and for a candidate, 422 after approval.

## 5. Test results at this checkpoint

| Check | Result |
| --- | --- |
| API type check (with specs) | Pass |
| API unit tests | 80/80 |
| API build | Pass |
| Web type check | Pass |
| Web unit tests | 31/31 |
| Web production build | Pass (75 routes) |
| Migration SQL on PostgreSQL 18 | Pass (section 4) |
| API e2e (including the new reorder tests), browser, AI | Not run: blocked on this machine |

## 6. Open items

1. **Run the blocked suites** (API e2e with the new reorder tests, browser, AI) once Docker, WSL or Go is available, or on
   the macOS machine the previous session used.
2. **Name the AI failure kind** in review reasons (quota, rate limit, unavailable, timeout, invalid reply, privacy) so the
   employer is told exactly why a criterion needs a person. Python change in `services/ai`; needs its test environment.
3. **Port this machine's last redesign refinements** (section 1) onto the checkpoint, file by file, with review.
4. Decisions for the owner: registry organization at sign-up, palette, candidate retention, SMTP provider.
