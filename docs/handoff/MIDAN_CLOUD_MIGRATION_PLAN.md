# MIDAN on Supabase Cloud — migration plan

Project: **al-midan-ya-hamidan** (`squpszwbrqkflezfltoj`, eu-central-1, PostgreSQL 17). Checked on 2026-11-10.

## Status: applied on 2026-11-10, with the owner's approval
- `scripts/apply-hosted-migrations.sh --apply` re-checked the starting point, took a backup verified by restoring it
  (`.local/backups/squpszwbrqkflezfltoj-20261109T210326Z.dump`, identical row counts in 86 tables), applied the 34, and
  the 29 post-change checks passed. The project now has **57** migrations, the same as the repository.
- Afterwards: the real candidate's account, profile and CV unchanged; the 2 demo organizations approved; Supabase's
  security advisor reports no errors (warnings: security-definer functions callable by signed-in users, which check
  permissions themselves; leaked-password protection off; one function without a fixed search_path).
- Also approved by the owner: a new sign-up access code for the local server (hash in `private.signup_access`, the code
  only in `.env.cloud`), and the fictional `midan.test.org-b-owner@example.com` as platform administrator for the demo
  (`delete from private.platform_admins where user_id = …` reverses it).

## Verified on the cloud after the migrations (2026-11-10, real browser, `scripts/dev-all.sh --cloud`)
- Cloud Auth: password sign-in (tokens issued by `squpszwbrqkflezfltoj.supabase.co`), session read back, logout revokes
  the refresh token, an unverified account is refused. Sign-up through the website reaches Cloud Auth; cloud Auth refuses
  `example.com` addresses, so fictional test accounts can't be created there (use a real mailbox you control).
- Candidate (test candidate-one): profile saved and still there after reload; CV uploaded to the cloud
  `candidate-documents` bucket; the CV-reading job ran on the cloud queue and Groq read it (awaiting the candidate's review).
- Full journey, 16/16: employer (test org-a-owner) creates an organization, completes its profile, uploads the
  registration document and submits it → platform administrator (test org-b-owner) approves → job with description and a
  requirement → 9 skills chosen by the live AI model → assessment (MIDAN's labelled templates: Groq's daily token limit was
  used up) approved and published → job published → candidate (Arabic) uploads a CV, finds the job, applies, gets the
  assessment, answers and uploads a file, submits → employer opens the applicant with the requirements match → scoring
  (1 proposed by the model, 16 left for the person) → a person approves and releases → the candidate reads the result,
  without reviewer notes. Every record was then read back from the cloud database.

The sections below are the plan as it was approved.

## Where it stands
- Migration history: **23 applied**, identical to the repository's first 23. **34 pending** (listed by
  `scripts/apply-hosted-migrations.sh --check`).
- Schema fingerprint (tables 47, columns 454, policies 109, functions 60) is exactly `supabase/rehearsal/hosted-baseline.txt`:
  nothing was changed by hand.
- Data: 7 Auth accounts (6 fictional `midan.test.*@example.com`, **1 real candidate** with a profile and one CV in
  storage), 2 demo organizations without members, 2 published demo jobs, 0 applications, 5,073 reference skills.
- Auth: email sign-in on, sign-up open but gated by `private.guard_signup` (the `midan.test.%@example.com` pattern, or an
  access code whose hash is in `private.signup_access`), email confirmation required.
- Storage buckets: `candidate-documents`, `assessment-evidence`, `organization-assets` (public).
- The platform already runs against it (`scripts/dev-all.sh --cloud`): Cloud Auth signs in, the API reaches the cloud
  database, but signed-in pages fail on objects the pending migrations add (`saved_jobs`, `candidate_profiles.languages`,
  `organizations.employer_registry_id`, `private.claim_background_job`).

## What the 34 migrations change
Additive: new tables, columns, functions, policies, triggers, two storage buckets (`employer-claims`,
`organization-documents`) and roles (`midan_worker`, `midan_importer`, `midan_ai`). Policies and triggers that are dropped
are replaced in the same migration. No table or column with data is dropped; no column type changes.

Effects on existing rows:
1. `20261111090000_organization_verification`: the 2 existing (demo) organizations are recorded as **approved**, with one
   audit row each (`approved_before_review`), because they predate organization review. New organizations start as draft.
   Changed for this plan: existing rows get the status through the column default, so no trigger rewrites them.
2. `20261107090200_clear_finished_job_links`: clears links in finished queue jobs (the table is new and empty).
3. `20261111110000_worker_role_for_hosted_login` (new): the cloud `.env` logs the API in as `postgres`, which couldn't switch
   to `midan_worker`, so CV analysis jobs would fail. This lets it switch. `midan_worker` stays nologin and subject to RLS.

The real candidate's account, profile and CV are not modified by any migration.

## Proof before touching the project
- `scripts/rehearse-migrations.sh` on a PostgreSQL 17 copy with the cloud's roles, Auth migrations and exact starting
  fingerprint, plus synthetic data shaped like the cloud's: backup restores identically; each of the 34 applies, rolls
  back to an identical schema and data, and applies again; 29 post-change checks and the Phase 1 security checks pass; all
  34 rolled back together return exactly to the cloud's fingerprint. **Passed.**
- After the migrations, `postgres` can run the worker's claim; `midan_worker` still doesn't bypass RLS.
- Backup taken read-only: `.local/backups/squpszwbrqkflezfltoj-20261109T210053Z.dump` (schemas public, private, auth,
  storage, supabase_migrations), restored into a throwaway database with identical row counts in 86 tables.

## The step that needs approval
```
scripts/apply-hosted-migrations.sh --apply --approved-by-owner squpszwbrqkflezfltoj
```
It re-checks the starting point, takes and verifies a fresh backup, applies the 34 one per transaction (recorded in
`supabase_migrations.schema_migrations`), stops at the first error, and runs the read-only checks.

Rollback: `supabase/rollback/*.down.sql` newest first (rehearsed to return to the starting point exactly), or
`pg_restore` of the backup. Note: the organization-documents rollback deletes documents uploaded after the change.

## Separate decisions (not part of the migrations)
- **Who may register on the cloud:** today only `midan.test.*@example.com` addresses (they can't receive mail). Real
  people need an access code: add its SHA-256 hash to `private.signup_access` and set `DEV_TEST_ACCESS_CODE` in `.env.cloud`.
- **Email delivery:** Supabase's built-in sender only delivers to the project team's addresses, a few per hour. For
  other addresses, a custom SMTP provider in Auth settings.
- **Redirect URLs:** Auth → URL Configuration must allow `http://localhost:3100/**` (verification and reset links).
  Not readable from here; check in the dashboard.
