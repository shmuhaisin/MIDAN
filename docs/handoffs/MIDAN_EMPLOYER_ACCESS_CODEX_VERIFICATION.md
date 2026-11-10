# Employer Access continuation — 2026-11-10

## Provenance and checkpoints

Source: `feature/midan-employer-access-control`, commit `cf172cf39bbf6026642547ef16375e788d7c3ec3`.
Its parent and merge-base with the final integrated branch are `d198fc14f7b60a42235f86a4ac76d910b141f6f2`.
No integration merge was necessary. Work continues on `fix/midan-employer-access-authorization`.
Checkpoint 2: `ca95320523703dd01d278f0e54e8ef5910945bf8`, pushed and verified through `git ls-remote`.

This session started in a fresh cloud workspace, without a project checkout. No Claude working tree,
untracked migrations, authorization test file, or five-failure log was available to recover. The pushed
checkpoint contains the migration, rollback, controllers and UI, but no Employer Access test suite.
Checkpoint 1 was therefore not applicable; no recovered work was discarded or checkpointed falsely.
The five original failure assertions cannot be identified without the previous workspace or test log.

## Changes and observed failures

| Finding | Classification | Correction / verification |
| --- | --- | --- |
| Direct insertion into registry-linked test workspaces returned 201 | Security defect | Fixture insertion now requires `employer_registry_id IS NULL`; regression expects 403 |
| Test/demo invitations skipped approval even when linked to the registry | Security defect | Direct acceptance now requires an unlinked sandbox; linked invitations create pending requests |
| Rollback left explicit `UPDATE(role)` ACL behind | Migration defect | Explicit column revoke before restoring table UPDATE; catalog assertion and two schema round trips |
| Access page started privileged requests concurrently with its denying layout | UI implementation defect | Page checks admin authorization before its data reads; non-admin browser renders not-found without data or page errors |
| Unauthorized role update returned 200 with no changed rows | Expected PostgreSQL RLS behavior | Test checks empty response and unchanged database role; identity updates still return 403 |
| Unknown registry returned 422 rather than 400 | Expected API error mapping | Test matches the existing check-constraint error mapping; validation remains enforced |
| Revoking the sole owner returned 422 | Existing integrity safeguard | Preserved; test approves a replacement owner before revocation |

These are independently reproduced findings, not a claim to have recovered Claude's five original failures.
The initial new suite also exposed a missing invitation expiry in its fixture; the fixture now supplies it.

## Final verification

- Employer Access API/database regression suite: **10/10 passed**.
- Existing foundation authentication, database access, tenant isolation, role and signup-gate subset: **25/25 passed**, 74 unrelated tests excluded.
- Existing account/candidate/job and organization-review suites: **16/16 passed**.
- API unit tests: **84/84 passed**; web unit/translation tests: **40/40 passed**.
- Both workspace TypeScript checks passed.
- `supabase/tests/security_phase1.sql`: all checks passed against isolated PostgreSQL 17.11.
- `node scripts/verify-employer-access-migration.mjs`: two forward/rollback cycles passed. Compares
  public/private function definitions and grants, column/table ACLs, policies, indexes, memberships and registry records.
  All rehearsal changes occur within a transaction that rolls back, including on failure.
- Chromium: Arabic and English registration each show exactly ten employers; authorized Admin Access pages render
  with correct RTL/LTR; signed-out access goes to login; a candidate sees not-found without registry data or JS errors.
- Chromium full approval flow: real local Auth signup and email verification → Awaiting Approval with zero memberships
  → administrator clicks Approve access → membership exists → representative reaches the correct workspace.
  Temporary browser account/workspace was removed afterward.
- Production Admin UI is disabled by `NODE_ENV === 'production'`; backend operations independently enforce
  `private.platform_admins` using the authenticated caller. Localhost is not treated as authorization.
- React review: guards precede privileged work; remaining independent reads stay parallel; no client secrets or new hooks.

The first broad foundation run was **79 passed / 20 failed**: it started before the AI service was ready and before the
demo seed existed; private source workbooks/reference skills are absent from the public checkout. It was not treated as a
passing full-system verification. A first filtered rerun encountered earlier suite leftovers and one accidentally selected
test without its setup. After removing only documented isolated test leftovers and correcting the filter, the 25 intended
authorization checks passed. Candidate/job and employer regressions above pass, but a complete AI/CV/reference-data journey
is not certified by this session. No application feature was rewritten to accommodate missing fixtures.

## Running dashboard and data source

- `http://localhost:3100/en/admin/access`
- `http://localhost:3100/ar/admin/access`
- Overview: `/en/admin` or `/ar/admin`; existing registry, users, membership and audit pages are reused.
- These addresses are on the session's cloud machine; they are not a server on the owner's personal laptop.
  Use the environment preview/forwarding facility, or run the same checkout locally.
- Current dashboard uses **isolated local data**, not live Cloud administration. The ten public registry identity rows
  were copied read-only from Cloud with their exact IDs and `not_partner` status. No Cloud users/passwords were copied.
- Local fixture administrator: `midan.test.platform-admin@example.com`; password remains only in ignored `.env.test.local`.
  Do not reuse local fixture credentials in Cloud.

## Read-only production evidence and required approvals

Project `al-midan-ya-hamidan`, ref `squpszwbrqkflezfltoj`:

- 57 applied migrations; `20261112090000_employer_access_requests` is absent.
- `public.employer_access_requests` does not exist.
- Ten registry employers, all `not_partner`; zero linked workspaces or duplicate registry links.
- Four existing memberships. No member, registry identity, account, or production privilege was changed.
- One Platform Admin: `midan.test.org-b-owner@example.com`, granted at `2026-11-09T21:11:08.872247Z`.
- Existing membership table has table-level UPDATE, no explicit role-column ACL, and the original admins-insert policy.
  This matches the migration's expected starting grants. Existing memberships are not rewritten by the forward migration.

Approval is still required for **both independent production actions**:

1. Apply the reviewed `20261112090000_employer_access_requests.sql` migration to this project after a fresh backup and
   migration/precondition check. This adds requests and decision/audit functions, restricts organization creation and
   provisioning, gates linked invitations, changes member insertion policy, narrows UPDATE to role, and replaces the
   registry-link unique constraint with separate real/test workspace indexes. Apply only this migration, not a reset or
   all branches. Verify supported requests, tenant isolation, grants and unchanged registry IDs/status/memberships afterward.
   Rollback deletes requests and their audit entries, preserves granted memberships, and restores the previous workflow.
   It refuses duplicate real/test links under the restored unique constraint. Do not remove either workspace automatically.
2. Establish a dedicated administrator. The owner must choose an email/account and explicitly approve its grant.
   Create/verify that account through the normal Auth flow; check that it has no employer membership or candidate profile.
   While authenticated as the currently authorized administrator, use the existing `POST /v1/admin/admins` with
   `{ "email": "<owner-approved-verified-email>", "grant": true }`. Confirm it can administer the platform in a fresh session.
   Revoking `midan.test.org-b-owner@example.com` is a separate explicit approval; do not revoke the only admin first.
   No new admin endpoint, password in documentation, or automatic bootstrap grant is needed.

Once approved changes exist, a local dashboard may point its existing server-side configuration at Cloud using the normal
restricted API database role and Supabase Auth. Keep secrets server-side. Do not permanently switch the candidate system
to the isolated stack. This session has no production runtime secrets configured, and does not claim Cloud dashboard access.

`main` was neither checked out for edits, merged, nor pushed. Its observed remote SHA remained
`8f0235bfdf9e57d0dbdba017bbfd074a047e32da`. No force-push or teammate branch overwrite was used.
