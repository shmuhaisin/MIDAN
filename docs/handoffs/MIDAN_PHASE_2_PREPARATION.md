# MIDAN — Phase 2 preparation (hosted parity)

Written 2026-11-07. **Nothing here has been executed.** No hosted migration, setting, deployment or registration change
happens until the owner approves it in writing, using the checklist in section 10. Facts about hosted come from read-only
queries on that date.

## 1. Hosted today

| Item | Value |
| --- | --- |
| Project | `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`, eu-central-1. Never touch `ALNADA` |
| Plan | **Free**: no point-in-time recovery and no database branches, so section 4's manual backup is the only safety net |
| Database | PostgreSQL **17.11**. `postgres` isn't a superuser |
| Migrations | 23 applied, all with matching files in the repository |
| Accounts and data | 7 accounts, 2 organizations, 2 jobs, 0 applications, 5,073 reference skills, 10 employers |
| Personal data to protect | 1 candidate profile, 1 CV record, 1 file in `candidate-documents` |
| Still-live old rules | The old S1 storage policy and the old "org updates status" policy. Nothing is exposed while there are no applications |
| Roles | `midan_api` only. `midan_importer`, `midan_worker` and `midan_ai` don't exist yet |

## 2. Pending migrations

The owner's brief counted nine. The owner's application decisions added a tenth, so **ten** are pending. Apply them in this
order. Each file runs in its own transaction.

| # | Migration | What it does | Reverse if needed |
| --- | --- | --- | --- |
| 1 | `20261106140000_platform_admin_and_data_pipeline` | Platform admin list and functions, import runs with row-level lineage, more employer and listing columns, the `midan_importer` role | Additive. Drop the new tables, functions and columns |
| 2 | `20261106150000_background_jobs_and_job_analysis` | Background queue, `midan_worker` and `midan_ai` roles, `ai_checkpoints` schema, learning catalog, job analysis | Additive. Drop them. Permission fix in 3.1 |
| 3 | `20261106160000_assessment_reference_skills` | Tasks and rubric criteria can name the reference skill they measure | Additive. Drop the columns and trigger |
| 4 | `20261106170000_employer_profiles_and_job_links` | Links an organization and its jobs to the employer registry, employer search | Additive. Drop the column and functions |
| 5 | `20261107090000_scope_candidate_document_access` | **S1**: staff read only the CV for their own application, not the whole folder | Restore the old policy (not advised) |
| 6 | `20261107090100_application_status_transitions` | **S2**: status changes go through one function with fixed moves. Removes direct table updates | Recreate the policy and grant |
| 7 | `20261107090200_clear_finished_job_links` | **S5**: a job's CV link is deleted when it finishes | Restore the earlier function |
| 8 | `20261107100000_queue_link_isolation` | **S5**: closes the link leak and arbitrary-URL fetch, ends jobs whose worker keeps dying, refuses a CV job retry that can't work | Restore the earlier functions (not advised) |
| 9 | `20261107100100_hired_is_final_for_outcomes` | A later outcome can't undo a hire | Restore the earlier function |
| 10 | `20261107110000_application_decision_rules` | Owner decisions: reopening needs an owner or admin and is audited; an outcome hire needs a shortlist; no CV without a snapshot, plus explicit sharing | Restore the earlier functions |

## 3. Dependencies and coordination

**Order is strict.** #2 uses #1's admin check. #3 and #4 use the reference and registry tables that #1 extends. #7 and #8 need
#2. #9 and #10 replace functions from #5 and #6.

### 3.1 Fixed: schema permission in #2

`20261106150000` runs `create schema … authorization midan_ai`. PostgreSQL 16 and later refuse this unless the current role can
`SET ROLE` to the owner, and hosted `postgres` isn't a superuser. Local runs hid it because they use a superuser. The migration
now grants that right first, with the owner's approval.

**How it was checked:** `before the fix, a run as a non-superuser stopped at this migration with `must be able to SET ROLE "midan_ai"`. After it, all 33 applied, and section 5's rehearsal on PostgreSQL 17 confirms it. Hosted's `postgres` was confirmed non-superuser by a read-only query.`

### 3.2 Which migrations need an API release

No API or web app is deployed. The only thing connecting to hosted is a local checkout on `candidate-portal`, whose `.env` holds
hosted credentials. **Stop it before the window.**

| Migration | Old API after it | New API before it | Plan |
| --- | --- | --- | --- |
| #1, #3, #4 | Keeps working (additive) | Fails: Prisma and the admin screens expect the new columns | Migrate first |
| #2, #7, #8 | CV upload needs the queue, which the old API doesn't use | Worker reports "queue unavailable", CV analysis fails | Migrate first |
| #5 | Applications without a copy get 403 instead of a CV | Works | Either order |
| **#6** | **Every status change fails with 403: it writes the table directly** | Status changes fail: the function is missing | **Release together** |
| #9 | Works; another outcome after a hire gets 422 | Works | Either order |
| **#10** | Offers actions the database now refuses; no share button | **Share-CV fails: the function is missing** | **Release together** |

**Recommendation:** apply all ten in one window, then release API and web from this branch straight after. With nothing
deployed, there are no users to interrupt.

## 4. Backup, before anything else

The owner runs this on their own machine. Nobody pastes the password into chat.

1. **Freeze:** no sign-ups, tests or imports on hosted until section 7 passes.
2. **Set the password for this terminal only.** The shell doesn't echo it or save it to history:

   ```bash
   read -rs PGPASSWORD && export PGPASSWORD
   ```

3. **Dump the database** with a client at least as new as the server. Homebrew's `libpq` (18.6) qualifies; the `postgresql@16`
   client won't work against version 17. The file holds password hashes and personal data, so keep it outside any repository.

   ```bash
   /opt/homebrew/opt/libpq/bin/pg_dump -h aws-1-eu-central-1.pooler.supabase.com -p 5432 -U postgres.squpszwbrqkflezfltoj -d postgres -Fc -n public -n private -n auth -n storage -f ~/midan-backups/pre-phase2.dump
   ```

4. **Save the files:** `pg_dump` copies Storage's records but not the files themselves. Download the one object in
   `candidate-documents` from the dashboard.
5. **Save what the dump doesn't hold:** dashboard settings, and the role list (`select rolname from pg_roles where rolname like 'midan%'`).
6. **Check it:** `pg_restore --list` runs and `shasum -a 256` is recorded. Then restore it into a throwaway local database and
   compare row counts with section 1.
7. **Store it** on an encrypted disk or in a password manager's file vault. Delete it once it's no longer needed.

Finish with `unset PGPASSWORD`.

## 5. Rehearsal (done locally, with fictional data)

```bash
scripts/rehearse-migrations.sh
```

This needs `brew install postgresql@17`. It builds a throwaway PostgreSQL 17 cluster on port 54417 and connects to nothing hosted.

**How close it is to hosted**, as read from hosted on 2026-11-07:
- `postgres` is a non-superuser with `createrole`, `createdb`, `replication` and `bypassrls`, with the same memberships. `public` tables and schema have the same owners.
- Auth's real migrations build the `auth` schema.
- The 23 applied migrations then produce **the same fingerprint as hosted** for tables, columns, policies and functions (`supabase/rehearsal/hosted-baseline.txt`). The script stops if they don't.
- Data is fictional, in hosted's shape (`03_synthetic_hosted_shape.sql`). Nothing was copied from hosted. It adds two applications hosted doesn't have, so the migrations meet those rows.

**Results:**
- Backup, as in section 4, restored into a separate database: all 68 tables identical.
- Each of the ten migrations: applied, rolled back to an **identical** schema, roles and data, then applied again.
- All 17 post-change checks passed (`post_checks.sql`, read-only), as did the database security checks.
- All ten rolled back together, newest first: schema back to the starting point and to hosted's fingerprint.
- A deliberately wrong rollback script was caught, so the comparison does detect mistakes.
- `--keep` leaves the migrated cluster running. On it, the full platform passed: API end-to-end 113/113, browser 35/35, AI service 143 passed and 1 skipped.

**What it can't reproduce:**
- Supabase's `supautils`, which lets `postgres` manage policies and triggers on `auth` and `storage` tables. The rehearsal approximates it by inheriting from those tables' owners. The same kinds of statements ran on hosted in earlier migrations.
- Supabase's real Storage service: the local gateway stands in.
- Hosted's real data, its one CV and its settings. **So the real backup in section 4 is still required, and restoring it is still worth testing.**

## 6. Rollback and restoration

`supabase/rollback/<migration>.down.sql` reverses each migration, tested as in section 5. Run them as `postgres`, one transaction each,
newest first. They have only ever run locally, and running one on hosted needs the owner's approval.

**Data lost by rolling back:** anything stored in what the migration added. #1 loses import lineage and platform admins, #2 loses queued work,
AI checkpoints and job analyses, #4 loses employer links. #5, #6, #8, #9 and #10 restore the older, weaker rules, so they're for emergencies.
#1 can't complete if a listing has been saved with no Arabic or English title, because it restores those required columns.

| Situation | What happens | Action |
| --- | --- | --- |
| A migration fails | Its transaction rolls back by itself; earlier ones stay | Stop. Don't fix it by hand on hosted. Fix the file, rehearse again, resume from that migration |
| Applied, then a problem appears, and hosted data is still sound | | Prefer a new forward-fix migration, rehearsed first. Use the rollback script if that's not possible |
| Data is damaged | The Free plan has no point-in-time recovery | Restore the dump into a **new** project and repoint the app, keeping the old one for comparison. Restoring over the live `auth` and `storage` schemas is riskier and needs Supabase's guidance |
| API or web release fails | | Don't reopen access. Fix forward: there's no earlier hosted release to return to |

Anything written between the backup and a restore is lost, which is why the freeze lasts until checks pass.

## 7. Checks after the change

Read-only, on hosted, starting with `supabase/rehearsal/post_checks.sql`, where every row must say ok. **Don't run the end-to-end suites against hosted:** they write data.

| Check | Expected |
| --- | --- |
| `list_migrations` | 33, ending at `20261107110000` |
| `pg_policies` on `storage.objects` | "org reads applicant documents" uses `can_view_candidate_document` |
| `pg_policies` on `public.applications` | No "org updates status" |
| `has_table_privilege('authenticated', 'public.applications', 'update')` | false |
| `has_column_privilege('authenticated', 'public.background_jobs', 'payload', 'select')` | false |
| `to_regprocedure('public.enqueue_background_job(text, uuid, jsonb, text)')` | null |
| `to_regprocedure('public.share_cv_with_application(uuid, text)')` | present |
| `pg_roles` | `midan_importer`, `midan_worker`, `midan_ai` exist. Only the first and last can log in, once set up |
| Every table in `public` | RLS on |
| Security advisors | No new finding beyond the known list |
| Row counts | Accounts, organizations, the CV and the file match the backup |
| Re-run the import (`IMPORT_DATABASE_URL`) | Rows report unchanged, plus the one skill hosted lacks, giving 5,074. Two runs: `sector_skills`, `employer_registry` |
| API `/v1/health/db` from the release | `login: midan_api`, `bypass_rls: false` |
| Browser console on the deployed site | No CSP violations (`docs/deployment.md`) |

Then a short manual check with fictional accounts, with the owner's approval: sign in, see the status menu's rules, and share a CV.

## 8. What the owner must provide

**Never paste these into chat, commit them, or store them in a file in the project.** Generate them on your own machine, keep
them in a password manager, and enter them only into the place listed. Claude can confirm a value works from health checks
without ever seeing it.

| Item | Purpose | Where it goes | How to provide it |
| --- | --- | --- | --- |
| Hosted database password | Backup only | Your terminal, step 4 | From the dashboard or your password manager |
| `midan_importer` password | Re-running the import | `IMPORT_DATABASE_URL`, your terminal only | `\password midan_importer` in `psql`, which hashes it on your machine, then `alter role midan_importer login` |
| `midan_ai` password | AI checkpoints | `CHECKPOINT_DATABASE_URL`, host's secret manager | The same way |
| `midan_api` connection | The API | `DATABASE_URL`, host's secret manager | Exists already. Rotate with `\password` before production |
| `AI_SERVICE_TOKEN` | API to AI service | Host's secret manager, both services | `openssl rand -hex 32` |
| Gemini and/or OpenAI key, model name | Real AI | Host's secret manager, AI service | From each provider. Neither has passed a real-credential test yet |
| `DAILY_API_KEY` | Interviews | Host's secret manager, API | From Daily |
| `GOOGLE_CALENDAR_*` | Invitations | Host's secret manager, API | From Google Cloud |
| Google OAuth client ID and secret | Google sign-in | Supabase dashboard | From Google Cloud |
| SMTP host, user, password, sender | Verification and reset emails | Supabase dashboard | From your email provider |

`DEV_TEST_SIGNUP` and `DEV_TEST_ACCESS_CODE` stay unset in production. `TRUST_PROXY` stays unset until hosting is chosen.

**First platform administrator.** Tell Claude only the **email of an existing, verified account**, never a password. A one-line
`insert into private.platform_admins` then grants it, by you in the SQL editor or by Claude with your approval. New accounts
are refused while registration is closed, so it has to be one of the 7 existing accounts unless you decide otherwise.

**Dashboard decisions, made by you:**
1. Hosting provider, which sets `APP_URL`, `TRUST_PROXY` and HSTS.
2. Auth URLs: Site URL, plus `APP_URL/*/auth/confirmed`, `/*/reset-password` and `/*/auth/callback`.
3. SMTP sender.
4. Google provider on or off.
5. Leaked password protection on (recommended).
6. Whether to review the SECURITY DEFINER functions the advisors list, starting with `job_assessment_overview`, callable while signed out.
7. Public registration stays **off**.

## 9. External job platform cleanup (done, with the owner's approval)

The platform the owner removed from scope is gone from the code, and no longer reaches the database.

| Where | Change |
| --- | --- |
| `supabase/migrations/20261106140000…sql` | Edited before reaching hosted, with the owner's approval: the `source_type` value and the job ID field named after the platform are gone. Local databases need a reset (`scripts/local-setup.sh`) |
| `scripts/import-data.mjs` | The workbook no longer imports as listings, and the source type is gone. Listings come through `--listings` with `employer_provided`, `employer_career_site` or `other_authorized` |
| `scripts/extract-employers.py` | Reads the identity sheets only. The job sheet and the workbook's note about collecting jobs are left unread, and lineage records it only as "job sheet, out of scope" |
| `apps/web/src/messages/{ar,en}.json` | Admin label removed |
| `docs/database/README.md`, `docs/audits/MIDAN_PHASE_0_GAP_ANALYSIS.md` | Rewritten |
| `docs/handoffs/MIDAN_COMPLETE_IMPLEMENTATION_HANDOFF.md` | A note at the top. The older text stays as a record of that date |

**Where the name remains, deliberately:**
- Inside `ALMIDAN_Employer_Database_10_Entities.xlsx`, as an empty sheet and a note. The official file stays byte for byte with its checksums, unless you supply a new one.
- `data/source/README.md` and that older handoff, which describe the file as it is.
- Git history, unless you approve rewriting it.

## 10. `feat/company-workflow` compared with this branch (nothing merged)

One commit, `c5cb1af` by `sultana-ah`, on `main` at `8f0235b`. It lacks all 33 commits on this branch, including the candidate
experience and every security fix. A trial merge, which changed no branch, gives **4 conflicts**: `apps/web/next.config.ts`,
`apps/web/src/app/[locale]/auth/confirmed/page.tsx`, `apps/web/src/app/[locale]/check-email/page.tsx` and `package-lock.json`.

| Its change | Finding | Proposal |
| --- | --- | --- |
| Sign-up stops if `APP_URL` isn't set, instead of assuming localhost | Good. Conflicts only because `next.config.ts` was rewritten for S7 and S8 | Keep it, on this branch's version |
| Organization-aware confirmation and check-email pages, no mascot for organizations | Good, and matches the owner's Humaidan rules. Conflicts with the rebuilt screens | Keep the behaviour, re-apply on these screens, add a browser test |
| Reads the account type from the token in the confirmation link | Stays in the browser and drops the fragment. Acceptable | Keep |
| `organization/new` sends an account with an organization to it | Merges cleanly | Keep |
| `scripts/provision-sdaia-demo.mjs` | Needs a service-role key, which this project's design avoids, though it refuses the main project. **It creates a working employer account under the real name of a government authority. That authority is in the employer registry, marked not a partner, so a demo account could suggest it has joined** | The owner should approve or rename this before it merges |
| `apps/web/src/lib/employer-registry.ts` | 266 lines copying the employer registry, and nothing imports it. The database is the source now | Drop it |
| `supabase` CLI, `supabase/config.toml` and Docker-based local steps | A second local stack beside `scripts/local-setup.sh`, not tested with this branch | Decide on one. Keep it out of the first merge |
| Docs say to leave Supabase's Site URL unchanged | `docs/deployment.md` says to set it to `APP_URL` | Settle this during the dashboard step |

**Proposed order:**
1. Make the repository private, and decide how the workbooks leave this branch, because the owner has no permission to publish them and `main` doesn't hold them today.
2. Review `midan-security-completion` and merge it into `main`. It contains `candidate-portal` and both feature branches, so those need no separate merges.
3. Update `feat/company-workflow` from the new `main`, resolve the 4 conflicts as above, and run the test suites. Its author should do this or review it.
4. Merge that next, as a small change on the finished base.

Merging it first would put a branch without the security fixes into `main`, and leave the larger change to resolve the same conflicts.
**Nothing has been merged, and all of this needs the owner's approval.**

## 11. Phase 2 approval checklist

Nothing below starts until the owner approves it in writing.

**Decisions**
- [ ] Hosting provider chosen
- [ ] Which existing account becomes the first platform administrator
- [x] Are the workbooks allowed to be public? **No: the owner has no permission to publish them**
- [ ] Repository made private by its admin (`shmuhaisin`). Claude can't do this and hasn't. Checked: no forks on 2026-11-07
- [ ] Before anything merges into `main`: decide how the workbooks leave the branch. They aren't on `main` today, and a merge would add them. Deleting them or rewriting history needs separate approval
- [x] `feat/company-workflow` compared with this branch (section 10)
- [ ] The merge order approved, and the SDAIA demo script decided
- [ ] `midan-security-completion` reviewed and merged, or the migrations approved from this branch

**Changes to pending files**
- [x] The schema permission fix in `20261106150000` (3.1): approved and made
- [x] The platform cleanup, including the edit to `20261106140000` (section 9): approved and made

**Before the window (owner)**
- [ ] Local checkout using hosted credentials stopped
- [ ] Backup made and restored successfully into a throwaway database (section 4)
- [x] Rehearsal passed on PostgreSQL 17 as a non-superuser, with fictional data (section 5)
- [x] Rollback scripts prepared and rehearsed (section 6)
- [ ] Secrets entered in the host's secret manager (section 8), none in chat

**Explicit approval to run**
- [ ] Apply the ten migrations to `al-midan-ya-hamidan`, in order
- [ ] Run the checks in section 7
- [ ] Set up the `midan_importer` and `midan_ai` logins, and re-run the import
- [ ] Grant the first platform administrator
- [ ] Change the dashboard settings you chose
- [ ] Deploy API and web. **Separate approval**
- [ ] Public registration: stays off. **Separate approval, not part of Phase 2**
