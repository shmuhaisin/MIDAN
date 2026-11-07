# Organization members and invitations

Implemented on `feat/company-workflow`, based on `c5cb1af`. No hosted database or Auth setting was changed.

## Behavior and permissions

- Every member can list their own organization's members (projected name, email, role). This uses a scoped SQL function, not broader `users` RLS.
- Owner/admin can list, create, retry email and cancel invitations. Invitation roles are admin/recruiter/reviewer. Owners alone can change or remove owner memberships or promote a member to owner. The last owner cannot be removed or demoted, including concurrent requests.
- Invitations expire exactly seven days after creation. Pending/accepted/expired are derived display labels from the existing `accepted_at` and `expires_at` columns, not new database states. Cancellation deletes the row. Accepted invitations cannot be cancelled through the API.
- Acceptance requires a signed-in user with the matching **current, confirmed** Auth email. Both API and database check confirmation. A locked SQL operation creates the membership and marks acceptance atomically. Replay, expired/cancelled tokens, other email addresses and existing memberships are rejected; an existing member's role never changes through invitation acceptance.
- The email contains organization names, sender display name if available, role, expiry and an Accept Invitation link. Its token arrives in a URL fragment, is removed on load, and is retained only in an HttpOnly cookie bounded by the live invitation expiry while signing in/registering/confirming. See organization-invitation-fixes.md for the completed onboarding flow. It is posted only after explicit acceptance. Login returns to the fixed invitation route, with no arbitrary redirect URL.
- `request_id` is a client UUID and becomes the existing row ID. Retrying with that ID/email/role reuses the row, creation/expiry timestamps and token. Another active invitation for the same normalized email returns 409. After cancellation, recreating an ID produces a different token because creation time is included in token derivation.
- SMTP runs **after** commit, outside retryable DB callbacks. A failure/uncertain delivery returns 503 and leaves a pending invitation visible for retry. The UI never marks it sent. Success means SMTP accepted the message, not inbox delivery. SMTP cannot provide exactly-once delivery: retry after an ambiguous timeout may send the same valid link twice, but does not create another invitation row.

## API

All endpoints require the existing Bearer Auth guard and run as the restricted `midan_api` role with user claims.

| Method | Path under `/v1` | Body |
| --- | --- | --- |
| GET | `/organizations/:orgId/members` | — |
| PATCH | `/organizations/:orgId/members/:memberId` | `{ "role": "admin" }` |
| DELETE | `/organizations/:orgId/members/:memberId` | — |
| GET | `/organizations/:orgId/invitations` | — |
| POST | `/organizations/:orgId/invitations` | `{ "request_id": "<UUID>", "email": "...", "role": "reviewer" }` |
| DELETE | `/organizations/:orgId/invitations/:invitationId` | — |
| POST | `/invitations/context` | `{ "token": "...", "email": "optional signup address" }`; anonymous token proof, expiry-only response |
| POST | `/invitations/accept` | `{ "token": "<token from email fragment>" }` |

## Local application setup

Do not run the SDAIA demo script, link a hosted Supabase project, or reuse the team's Auth accounts/keys. Do not run the existing general E2E/form suites with team settings: `e2e-forms/stub-auth.mjs` fetches fixture sessions from the configured Supabase host.

1. Use an isolated local Supabase stack. Inspect `supabase/config.toml` first: local email confirmations are currently disabled. In a local-only configuration enable email confirmation and expose the capture's `smtp_port = 54325` under `[local_smtp]`. Its existing web UI is port 54324. Do not change shared/hosted Auth settings.
2. Install with `npm ci` (Prisma binaries require access to `binaries.prisma.sh`). The schema is unchanged, so Prisma introspection or edits to `schema.prisma` are unnecessary.
3. Start the local stack only after confirming Docker targets the local socket. Apply existing migrations and `20261107090000_organization_members_and_invitations.sql` **only to that isolated local database**, for example through the local Supabase migration workflow. `supabase db reset --local` is destructive: use it only for a fresh disposable stack, never an existing local database with work to preserve. Do not use `--linked` or a remote DB URL.
4. Put local Auth URL/keys, the local restricted `midan_api` connection URLs, and the existing local registration gate settings in an ignored local environment file, e.g. `.env.members.local`. The migrations define `midan_api` as NOLOGIN; provision LOGIN/password only in the disposable local database, retaining NOINHERIT/NOBYPASSRLS. Use local synthetic accounts and the existing signup access-code gate; do not assume `@example.com` bypasses the current gate.
5. Configure SMTP and `APP_URL` using `.env.example` as a reference. For local capture use `SMTP_HOST=127.0.0.1`, port 54325, no credentials, `SMTP_SECURE=false`, and a reserved-domain sender such as `MIDAN <local@example.com>`. Set `APP_URL` to the actual web origin. Generate `INVITATION_TOKEN_SECRET` securely (at least 32 random characters), keep it out of Git, and keep it stable across API instances/restarts. Rotating it preserves acceptance of links already sent (their stored hash is checked), but email retry for existing rows will fail; cancel/recreate those rows.
6. Build/start API with the local file overriding inherited values: `node --env-file=.env.members.local apps/api/dist/main.js` after `npm run build -w @midan/api`. Start web with the same explicit local variables, e.g. `node --env-file=../../.env.members.local ../../node_modules/next/dist/bin/next dev -p 3100` from `apps/web` (the working directory is required by the existing i18n configuration). Ensure all database/Auth destinations are loopback before starting.
7. Create a local owner and a separate invited user; confirm the invited email through local capture, create an invitation from `/ar/organization/<id>/members` or its `/en` counterpart, inspect the captured invitation email, and accept from that user's account. Test a different and an unconfirmed email as well.

Remote email needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, optional `SMTP_USER`/`SMTP_PASSWORD`, and a verified sender at the chosen provider. Remote transport requires STARTTLS, or `SMTP_SECURE=true` for implicit TLS. Outbound SMTP connectivity must be available in the deployment; the Cloud HTTP allowlist alone does not establish raw SMTP connectivity. No real provider credentials were supplied or tested.

## Isolated automated validation

- `npm test -w @midan/api -- --runInBand`: existing/new unit and HTTP tests. SMTP tests use a loopback capture server and test recipient rejection, missing configuration, escaping and content. API dependencies are mocked; they do not connect to Supabase.
- `npm run lint --workspaces --if-present` and `npm run build -w @midan/api`.
- `npm test -w @midan/web`.
- `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:members -w @midan/web`: dedicated fixture API on 54398 and Next on 3300. No .env credentials are used by the fixture, and Auth/API settings are explicitly loopback. This tests UI contracts (including role changes/removal, preserved success feedback, sign-in return and replacing/rejecting invitation fragments in one tab), not a real Auth/Prisma journey. Omit the executable override on machines with Playwright browsers installed.
- Database harness: start a **new disposable** PostgreSQL 17 container named for these tests, published only on `127.0.0.1:55432`, with database `midan_members_test`. Then `MIDAN_MEMBERS_TEST_DATABASE_URL=postgresql://<local-test-login>@127.0.0.1:55432/midan_members_test npm run test:members:db -w @midan/api`. This refuses non-loopback hosts and other database names. **It destroys/recreates public/auth/private schemas in that dedicated database.** Never point it at an existing development database. It loads the actual core schema, relevant original policies/helper/trigger and the new migration, with minimal local Auth fixtures. It is not a full Supabase stack migration test.

## Validation on Codex Cloud

Passed: API 27 tests; dedicated database 12 tests; web 7 tests; members browser 8 tests; both workspace type checks; API build. Database tests applied the migration solely to a newly created disposable local PostgreSQL container. They covered isolation, confirmed matching email, single-use acceptance under concurrency, existing membership protection, restricted role locks, RLS and last-owner concurrency.

The final production web build passes with the same approved fonts hosted locally. Production English/Arabic browser checks confirm actual font faces load without external requests; earlier development checks had used fallback fonts. Native Prisma engine download is blocked by the environment's policy for `binaries.prisma.sh`. Client code/types were generated with the installed Prisma generator's no-engine mode and npm-sourced schema WASM for compilation/unit tests, without disabling checksum/TLS verification. **This is not a working native Prisma runtime**; complete standard generation after enabling the required host before testing the full local Auth → API → database → SMTP journey. The full local Supabase journey has since passed with the real Auth service, Mailpit capture, Next.js, NestJS, and restricted Prisma/PostgreSQL access using the JS engine variant described below. Real email-provider delivery and the standard native Prisma engine remain unverified.


## Full local Supabase verification — 2026-11-07

The isolated stack lives outside the checkout at `/workspace/midan-members-integration`; its project ID is `MIDAN_members_integration`. Repository `supabase/config.toml` was not changed. Its local copy enables email confirmation, exposes SMTP capture on 54325, and raises the local-only Auth email rate for repeated synthetic tests. All repository migrations, including the new members migration, and the seed applied successfully to this full local stack.

`node scripts/verify-members-local.cjs` is an opt-in connected verification runner. It requires `MIDAN_MEMBERS_LOCAL_STATUS_FILE` pointing to a private JSON file produced by **local** Supabase status; it never reads repository `.env`. It rejects non-loopback destinations and any project ID other than `MIDAN_members_integration`, and refuses occupied test server ports (3300/3400). It creates synthetic reserved-domain accounts in this dedicated stack, stores a local signup-gate hash, and rotates the local `midan_api` password. Do not use this stack for other development work. Local test accounts/invitation records are retained as evidence; no team accounts or SDAIA provisioning script are used.

The runner starts the existing API with the restricted database role and the actual Next app from `apps/web`, then verifies eight checkpoints:

1. Signup, captured Auth confirmation email, verification and owner login.
2. Creating an invitation in the real UI, persisting it through the API, and receiving its distinct SMTP message in Mailpit.
3. A confirmed invitee accepting through the real UI/API, creating membership and `accepted_at`.
4. Owner changing the invited member's role through the UI/API.
5. Accepted status and exactly seven days between creation and expiry.
6. API refusal of last-owner deletion and replay of the accepted token.
7. Cancellation through the UI, deleting only that invitation.
8. Removal through the UI, followed by API refusal of the former member's access.

On an environment with standard Prisma generation available, build the API and run with the local status file:

```bash
npm run build -w @midan/api
MIDAN_MEMBERS_LOCAL_STATUS_FILE=/path/to/isolated-stack/status.json node scripts/verify-members-local.cjs
```

The private status file contains local credentials; never print it, commit it, or share it. Generate it with the CLI targeting the isolated workdir, with file permissions restricted to its owner. Start that local stack first and wait for startup completion, rather than relying only on the existence of its ports.

Because `binaries.prisma.sh` is blocked in this Cloud environment, the successful run used an isolated client generated from the unchanged repository schema with official Prisma `engineType=client` and `@prisma/adapter-pg`, version 6.19.3. These tools are outside the checkout. The runner supports the optional absolute module paths `MIDAN_MEMBERS_PRISMA_CLIENT` and `MIDAN_MEMBERS_PRISMA_ADAPTER`; neither changes the application's native-engine configuration. It bridges the JS adapter's error classes to the application's Prisma error filter while preserving the original PostgreSQL SQLSTATE/message. Assertions remain 422 for last-owner deletion and 403 for replay; this does not claim verification of the native engine.

In the current Cloud workspace the tested command is:

```bash
MIDAN_MEMBERS_LOCAL_STATUS_FILE=/workspace/midan-members-integration/status.json \
MIDAN_MEMBERS_PRISMA_CLIENT=/workspace/midan-tools/generated-client \
MIDAN_MEMBERS_PRISMA_ADAPTER=/workspace/midan-tools/node_modules/@prisma/adapter-pg \
node scripts/verify-members-local.cjs
```

Cloud-specific startup diagnosis: BusyBox `wget` in local Auth/Storage images ignored `no_proxy` and routed loopback health checks to the outbound proxy. A wrapper was installed **only in those disposable containers** to route loopback health requests directly and preserve proxy routing for outbound requests. The default Docker configuration was preserved; a private copy was used for the isolated stack. Restarting/recreating these containers may require the same local health-check correction. Do not disable TLS/checksums or bypass the proxy for external destinations.

Still outstanding: standard native Prisma generation/runtime, an explicitly configured real SMTP provider/deployment test. The production Next build now passes without Google network access; see organization-members-verification.md for final results and the expiry-under-lock correction. No commit, push or merge has been performed.

## Approval follow-up

The INSERT accepted_at gap and invited signup/confirmation gap are fixed. See organization-invitation-fixes.md for the current design, local configuration and results (29 API, 14 PostgreSQL, 14 browser, 13 connected checkpoints). The earlier eight-checkpoint report remains historical. Context is now an expiring HttpOnly cookie rather than sessionStorage; invited signup never supplies organization names to Auth provisioning.
