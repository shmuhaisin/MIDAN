# MIDAN — employer access control (2026-11-10)

**Rule (owner's instruction):** only the employers in the registry (the ten selected organizations) are eligible, and
nobody gets employer access without a MIDAN platform administrator's approval. Branch:
`feature/midan-employer-access-control`, from `feature/midan-final-integration`.

## How it works now
1. **Registration** (`/register?as=organization`): the representative chooses one of the registry's employers (only those
   are listed, from `GET /reference/employers`), gives their full name, job title, work email, password, an optional work
   phone and verification details. There is no free-text organization name anymore.
2. **Email verification** opens an **employer access request**, status `pending_approval`. It never creates an
   organization or a membership.
3. **Awaiting page** (`/organization/new`): "Awaiting MIDAN administrator approval", with the employer, the representative
   and the date. Any workspace URL is refused.
4. **Platform administrator** (`/admin/access`, existing `/admin` area and `PlatformAdminGuard`): pending requests with the
   representative's details and verification evidence; approve (choosing the role) or reject (note required); revoke
   approved access (reason required); every employer's workspace and its members; the decision history.
5. **Approval** adds the representative to the employer's **single** workspace, created by the first approval (owner
   first, later representatives get the role chosen, default recruiter). Approvals by a fixture (test) administrator go
   into a separate test workspace, never the real one.

## Enforced on the server (migration `20261112090000_employer_access_requests`)
| Way in | Before | Now |
|---|---|---|
| `create_organization` (API `POST /organizations`, Data API RPC) | anyone signed in | platform administrators and the fixture accounts (`midan.test.*`, `midan.demo.*`) only |
| Sign-up provisioning | created an organization from free-text metadata | opens a pending request for the chosen registry employer |
| `organization_members` insert (Data API) | organization owners and admins | only in test/demo sandboxes that aren't a registry employer's workspace |
| `organization_members` update | any column | the role only (no moving a membership to another account) |
| Invitation accepted | joined at once | into a registry employer's workspace: opens a request for the administrator |
| Decisions | — | `admin_decide_employer_access`, `admin_revoke_employer_access`: platform administrators only, never on their own request |
| Requests table | — | RLS: a person reads their own, administrators read all; no direct writes at all |

Also: one open request per person; a candidate account can't request employer access; registry records and their
`not_partner` status are never written; an administrator may revoke a workspace's only owner (the last-owner rule
otherwise stays).

## Test results (local stack)
- **API end-to-end, `employer-access.e2e-spec.ts`: 11/11.** Covers: verified registration → pending request, no
  membership; arbitrary organizations refused through the API, the RPC and the table; unknown employer refused; candidate
  refused; one open request; unapproved representative refused by every workspace endpoint and by administration;
  requester, organization owner and the RPC can't approve; nobody can write a request directly; approval → owner of the
  single workspace, second representative → recruiter in the same workspace, no duplicate; decided requests can't be
  re-decided; tenant isolation through the API and the Data API; no direct member insert or membership hijack by update;
  invitation → pending request; rejection; revocation (including the only owner) removes access; history recorded;
  existing employer and fixture accounts keep working; registry unchanged.
- **Browser, `access-journey`: 12/12.** English and Arabic registration list exactly the 10 employers and no free-text
  fields; registration → verification email → awaiting page; a workspace URL by hand is refused; the administrator sees
  the request with its details, approves with a note; the Arabic administration page is right to left; the representative
  then reaches the Elm workspace. Screenshots: `docs/testing/screenshots/employer-access/`.
- **Migration rehearsal (PostgreSQL 17, cloud starting point): passed.** All 35 pending-from-baseline migrations apply,
  roll back to an identical schema and data, apply again; full rollback returns to the cloud's fingerprint.
- **Full API end-to-end regression (designed setup: cleaned test data, AI in demo mode, lexical matching): 215/215** across 11 suites (the 204 existing tests plus the 11 new ones): nothing else changed behaviour.

## Production (Supabase Cloud): needs the owner's approval — not applied
- **Migration `20261112090000_employer_access_requests`** (cloud is at 57). Effects on existing data: none of the cloud's
  rows change. It adds a table and functions, replaces `create_organization`, `provision_account`,
  `accept_organization_invitation` and `guard_last_owner`, replaces the member insert policy, narrows member updates to the
  role column, and turns the one-workspace-per-employer unique constraint into two partial unique indexes (real; test).
  The cloud has no registry-linked organization today. Existing memberships and organizations are unchanged; the test
  organization and its members keep working (it isn't a registry employer's workspace). Rollback:
  `supabase/rollback/20261112090000_employer_access_requests.down.sql` (rehearsed).
- To apply after approval: `scripts/apply-hosted-migrations.sh --check` then the same apply process as before (backup
  verified by restore, one migration per transaction).
- **A real platform administrator:** on the cloud the only administrator is the fixture `midan.test.org-b-owner`, whose
  approvals create *test* workspaces. For real representatives, add a real administrator account to
  `private.platform_admins` (owner's decision; one SQL row).
