> Follow-up: the later INSERT-integrity and invited-signup fixes, current counts and cookie-based context are documented in organization-invitation-fixes.md. Earlier sessionStorage behavior and counts below are historical.

# Final verification — 2026-11-07

Repository: `shmuhaisin/MIDAN`. Branch: `feat/company-workflow`. HEAD remains `c5cb1af365ef4ff7f1c2ef139be021347c6c35f6`; all implementation changes remain local and uncommitted. Existing local files/configuration were preserved. No team/production database or SDAIA provisioning script was used, and no real email recipients/provider credentials were used.

## Final changes

- Members API: scoped identity listing, role changes/removal, authorization on every operation and rejection of zero-row RLS mutations.
- Invitations API and SMTP: existing table/roles only, seven-day expiry, owner/admin management, no owner invitation, explicit delivery failure, stable same-row/link retry, hash-only token storage.
- SQL migration: scoped member-identity projection; locked acceptance with current confirmed Auth email; immutable member identity; serialized last-owner protection. Acceptance now checks `clock_timestamp()` after lock acquisition so a transaction that started before expiry cannot accept after waiting past expiry. A regression test verifies that the transaction starts before expiry, then waits past it.
- Web: Arabic/English members and acceptance pages, fixed login return route, feedback/loading/empty/error states, and safe handling of new/invalid invitation fragments in an existing tab.
- Fonts: same approved families/weights/CSS variables, hosted locally from pinned Google Fonts upstream sources with OFL licenses and checksums. Plex binaries remain unmodified. Noto/Bricolage use WOFF2; Bricolage's omitted axes are fixed at the same original defaults. No layout/color/type-size tokens were changed.
- Local verification tooling and documentation: an opt-in, loopback-only connected runner and separate fixture suites; no shared Supabase settings changed.

## Checks executed in the final round

| Check | Result | Scope/evidence |
| --- | --- | --- |
| API Jest suite | 27 passed, 8 suites | Unit, HTTP authorization/validation and loopback SMTP success/failure tests |
| Dedicated PostgreSQL suite | 12 passed | Actual migration/RLS/functions; tenant isolation, verified email, expiry under lock, replay, concurrent acceptance, owner/admin boundaries and concurrent last-owner removal |
| Members Playwright suite | 8 passed | Isolated API contract fixture, English/Arabic, retry/cancel, role/remove feedback, login return, invalid and replaced fragments |
| Web unit tests | 7 passed | Message shape and Humaidan asset rules |
| AI pytest suite | 23 passed | Existing demo graph/provider tests; no live LLM |
| Full connected local journey | 8 checkpoints passed | Actual Next/Nest, local Supabase Auth/confirmation, Mailpit, restricted Prisma/PostgreSQL; JS engine/PG adapter used only in the test harness |
| API production compile | Passed | `npm run build -w @midan/api` |
| Workspace type checks | Passed | `npm run lint --workspaces --if-present` (TypeScript, not ESLint) |
| Web Production Build | **Passed** | `npm run build -w @midan/web`; no Google font download needed |
| Production browser smoke | English and Arabic passed | HTTP 200, LTR/RTL, actual approved body/heading font faces loaded, all 7 font responses HTTP 200 on each page, zero external browser requests |
| Vendored font verification | 7 files passed | SHA-256 and internal family metadata; Bricolage retains only variable weight axis |
| Runner syntax / Git whitespace | Passed | `node --check scripts/verify-members-local.cjs`; `git diff --check` |
| Runner safety guards | Previously passed | Missing explicit config, remote destination and occupied test-port refusal; runner unchanged in final round |
| npm dependency audit | Exit 1: existing findings | 24 total: 4 high, 17 moderate, 3 low, 0 critical; identical counts and affected package names when auditing baseline `c5cb1af` separately |

The high audit chain is `prisma` / `@prisma/client` → `@prisma/config` → `deepmerge-ts` (recursive merge stack exhaustion). No new affected package names were introduced by this feature. This report does not treat audit findings as passing or apply broad dependency upgrades outside the feature; remediation needs a separately validated dependency change.

The connected runner has real database operations. The alternative JS adapter's error classes are bridged to the application's Prisma filter without changing PostgreSQL SQLSTATE/message or expected HTTP assertions. The native Prisma engine remains unverified; this distinction is deliberate.

## Security review

- Tenant IDs and membership/invitation IDs are validated and included in every scoped query; SQL uses bound parameters.
- Controller role checks supplement RLS. Membership permissions are rechecked after waiting for the organization lock.
- Owners alone can modify/grant owner membership; the database prevents deleting/demoting the last owner. No new role was added.
- Member identity is immutable. Reading teammates returns only projected identity/role fields through a function that independently checks membership, without widening candidate-profile RLS.
- Acceptance does not trust a submitted email, `user_metadata`, or decoded browser claims. The DB reads current `auth.users.email` and `email_confirmed_at` for `auth.uid()` and checks the token/expiry/acceptance under locks.
- Wrong/unverified email, expired/missing/cancelled/replayed tokens and existing-member role replacement are rejected. The expiry-under-lock edge case was corrected and tested.
- Raw invitation tokens and token hashes are excluded from API listings. Email links carry a fragment, cleared on load; tab storage is cleared after acceptance or when a new invalid fragment is supplied.
- SMTP uses TLS for remote hosts, escapes user-controlled HTML, and exposes generic delivery errors without credentials/tokens. SMTP acknowledgement is not proof of inbox delivery. Ambiguous timeout retries may send the same link twice but do not create a duplicate invitation row.
- Cancellation deletes a pending/expired invitation; no new persisted cancellation/delivery states, role types, task management or employment-decision reason fields were added.

## Checks blocked or intentionally unrun

### Native Prisma generation/runtime — blocked by environment policy

A fresh standard generation attempt failed before generation with HTTP 403 fetching the pinned schema-engine SHA-256 from `binaries.prisma.sh`. Runtime environment status reports an enforced restricted policy with no custom allowed hosts. Draft revision 3 already includes `binaries.prisma.sh`, but saving a draft proposal does not apply it. No runtime policy-change tool is available in this session. TLS/checksum verification was never disabled, and no alternate proxy route was used to bypass this host restriction.

Required next action: apply the saved network setting for `binaries.prisma.sh` through Cloud environment settings. Then run standard generation:

```bash
node node_modules/prisma/build/index.js generate --schema apps/api/prisma/schema.prisma
```

Repeat the connected local runner with **only** `MIDAN_MEMBERS_LOCAL_STATUS_FILE` set, leaving `MIDAN_MEMBERS_PRISMA_CLIENT` and `MIDAN_MEMBERS_PRISMA_ADAPTER` unset so it uses the standard native client. This runner explicitly selects a dedicated loopback stack before opening the database connection.

Google Fonts access is also still blocked, but that no longer blocks the production build: fonts are now local first-party assets. No design substitution or runtime font dependency was introduced.

### Legacy general integration/form suites — not run against their current fixtures

`apps/api/src/foundation.e2e-spec.ts`, `apps/web/e2e/journeys.spec.ts`, `apps/web/e2e/characters.spec.ts`, and the existing forms suite depend on the original root environment/test accounts. In particular, `e2e-forms/stub-auth.mjs` fetches actual sessions from the configured Auth host. Running the existing commands as configured could access team services, contrary to the user's constraint. They were not run, not marked passed/skipped by a runner, and not disabled.

To run them safely: provide fully isolated local fixture accounts/storage/AI configuration and local-only environment files, verify every Auth/database destination, and complete native Prisma setup for the default API integration suite. The new dedicated suites and connected runner were executed instead; they do not claim coverage of every legacy product journey.

### Real provider/inbox delivery — unrun

No approved SMTP provider configuration or real recipient data was supplied. Only local Mailpit and loopback SMTP captures were used. A deployment test requires approved SMTP transport/sender credentials and outbound SMTP connectivity, followed by explicit authorization to use real recipient data.

## Review artifacts

Implementation/setup details: `docs/organization-members.md`. Checklist: `docs/organization-members-checklist.md`. Font source/license details: `apps/web/src/fonts/README.md` and `manifest.json`.

Final-round command logs are local artifacts under `/tmp/midan-final-*`; private local stack status/configuration is outside the checkout under `/workspace/midan-members-integration`. Its status file contains local credentials and must not be printed, committed or shared. Temporary production/test servers started for final verification were stopped; the pre-existing local Supabase stack and prior user services were preserved.

No commit, push or merge was performed. Work stops after this verification report for user review.
