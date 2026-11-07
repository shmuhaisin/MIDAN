# Invitation approval fixes — 2026-11-07

Both findings from the approval review are addressed in the existing Company Workflow implementation. No team/production database, SDAIA provisioning script or real email recipient was used. Changes remain uncommitted on `feat/company-workflow`.

## 1. accepted_at integrity

The existing uncommitted migration `20261107090000_organization_members_and_invitations.sql` now adds `private.guard_invitation_insert()` and its BEFORE INSERT trigger. Every new invitation must have `accepted_at IS NULL`, including direct Data API inserts and privileged direct inserts. Existing accepted rows are not rewritten or rejected retrospectively.

The existing UPDATE revocation for authenticated remains. The approved SECURITY DEFINER acceptance function can still update `accepted_at` after checking the confirmed email, token, expiry and locks. No new role, invitation state, table or column was added. Database administrators retain administrative powers; the restriction applies to ordinary application write paths, not an assertion that a superuser cannot change database definitions.

PostgreSQL regression tests prove manager and direct-connection pre-accepted inserts fail with 23514, ordinary creation succeeds, and acceptance through the function creates membership and sets accepted_at. The connected test also sends a direct Supabase REST insert with a real local owner's JWT and verifies rejection with 23514.

## 2. Signup and confirmation context

- A valid link fragment is posted to the existing Core API's new `/v1/invitations/context` onboarding endpoint. It inspects the same invitation table; it is not a separate invitation system.
- The new read-only `inspect_organization_invitation(token, optional email)` SQL function returns **expiry only**, after validating pending/expiry/token and optionally the invited email. Anonymous execution is deliberately scoped to this token-proof function; it exposes no recipient/organization identity and grants no membership. The endpoint uses the existing throttle settings with an additional IP-based key so unverified Authorization headers cannot evade the IP bound.
- Next stores the validated token/expiry in `midan_invitation`, an HttpOnly, SameSite=Lax cookie, Secure in production, expiring at the invitation's existing expires_at. The original sessionStorage format is removed. Raw invitation tokens are not put in query parameters, Auth metadata or application logs.
- The cookie is not treated as authorization: signup, confirmation and acceptance validate the current invitation through the API; final acceptance independently verifies current confirmed Auth email and database state.
- The public query flag `returnTo=invitation` is navigation intent only, never a credential. It is propagated from login to signup; a missing/expired intended context never falls back to an independent organization signup.
- Valid invitation signup is allowed while general DEV_TEST_SIGNUP remains false, but only after matching the submitted email against the live invitation. It continues to use the existing server-held signup access-code gate. If that gate is not configured/usable, Auth still refuses signup; no allowlist or shared Auth setting was changed.
- Invited signup uses the existing `account_type=organization` value, omits org_name_ar/org_name_en even if supplied by the browser, and records only a non-secret `invitation_signup` presentation hint. Existing provisioning therefore creates no organization/owner membership and no new account-role type. That metadata hint never authorizes acceptance.
- Confirmation still uses the original `/ar/auth/confirmed` or `/en/auth/confirmed` path. The client removes Auth fragments before further operations. In invitation mode it verifies the access token against Auth on the server, requires the confirmed matching email, sets the existing session cookies, and redirects automatically to the **acceptance page**. Membership still requires explicit acceptance.
- If the Auth return has no usable session, login is required with the same fixed invitation return route. Auth errors do not log the user in or create membership. A valid context is retained for retry; invalid/expired context is cleared.
- The context works across tabs in the **same browser**. Another browser/device must reopen the original invitation link; no secret was added to the Auth confirmation query to implement cross-device recovery.
- Cookie expiry and server checks clean expired context; success deletes it. Invalid replacement links discard old context. An old tab's expiry callback does not erase a newer context from another tab.

## Files changed for these fixes

- SQL migration: INSERT guard + limited inspection function/grants.
- Core API: `invitation-context.controller.ts`, its HTTP tests and registration in `app.module.ts`.
- Next server helpers/actions: `invitation-context.ts`, `invitation-context-actions.ts`, `auth-actions.ts`, `member-actions.ts`.
- UI: accept component/page; login/register forms; register/check-email/confirmation pages; new `auth-confirmation.tsx`; Arabic/English messages.
- Regression coverage: PostgreSQL suite, members Playwright suite/stub, connected local runner.
- Handoff, project status and feature verification documents.

No dependency upgrades or changes to assessment tasks, skills, employment decisions, shared Supabase config or Prisma schema were made for this follow-up.

## Local setup and verification

Only the isolated `MIDAN_members_integration` stack was used. Its config copy outside the repository adds the actual test callback origins `http://127.0.0.1:3300/en/auth/confirmed` and `/ar/auth/confirmed`, with local email confirmations and SMTP capture enabled. The stack was restarted with its local state preserved. New SQL definitions were applied there; the separate PostgreSQL suite loads the entire candidate migration freshly.

The connected runner supplies a random **local** signup access code whose hash is inserted into the existing local gate. Its Next instance keeps general registration disabled, proving the invitation-specific path. It confirms real captured Auth emails in a new browser tab and checks database membership/metadata directly. Expiry between signup and confirmation is simulated only by updating that synthetic local fixture as the local test administrator.

Current checks:

| Check | Result |
| --- | --- |
| API Jest | 29 passed, 9 suites |
| Local PostgreSQL | 14 passed |
| Dedicated Playwright | 14 passed |
| Connected local Supabase journey | 13 checkpoints passed |
| Web unit tests | 7 passed |
| API build / workspace type checks / web Production Build | Passed |

Coverage includes new-tab signup confirmation, forced omission of organization names, context expiry/loss before submission, expiry before confirmation, real consumed/failed Auth verification, invalid replacement links, same-tab token replacement, old-tab expiry vs a newer context, direct REST pre-accepted INSERT rejection, valid acceptance and storage cleanup. The inspection HTTP tests validate format/unknown-field rejection; the DB tests enforce token/email/expiry and read-only output.

Connected verification continues to use the isolated official Prisma JS client/PG adapter because the native binary host remains blocked. Native Prisma runtime, legacy suites tied to team fixtures and real provider delivery remain unverified as documented in organization-members-verification.md. No network-policy bypass or real email-provider configuration was used.

Review stops after these fixes and their verification. No commit, push or merge was performed.
