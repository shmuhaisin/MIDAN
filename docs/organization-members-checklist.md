# Members & invitations delivery checklist

Branch: `feat/company-workflow`; baseline `c5cb1af`. All feature changes remain uncommitted.

- [x] Preserve pre-existing local files/configuration and remain on the feature branch.
- [x] Member listing, roles and removal with API authorization and tenant isolation.
- [x] Last-owner protection, including database concurrency tests.
- [x] Invitations using existing tables/roles; fixed seven-day expiry; no owner invitations.
- [x] Confirmed matching email, atomic one-time acceptance, cancellation and replay refusal.
- [x] Automatic configurable SMTP, explicit delivery failures and same-row retries.
- [x] Arabic/English UI, loading/success/error/empty states, and same-tab invitation link regressions.
- [x] API/SMTP tests: 27 passed; browser contracts: 8 passed; web unit tests: 7 passed.
- [x] Dedicated PostgreSQL security tests: 12 passed, including expiry while waiting for a lock.
- [x] API build, workspace type checks and whitespace checks passed.
- [x] All migrations and seed applied to a separate full local Supabase stack.
- [x] Supabase Auth confirmation emails and invitation emails captured in actual local Mailpit.
- [x] Eight connected journey checkpoints passed with real Next/Nest, local Auth, restricted Prisma/PostgreSQL and SMTP; Prisma JS engine/PG adapter used in the isolated test harness.
- [x] Verification runner refuses missing configuration, remote destinations and occupied test-server ports.
- [x] Documentation and handoff updated; no shared Supabase settings changed.
- [ ] Standard native Prisma engine generation/runtime after allowing binaries.prisma.sh.
- [x] Production web build and English/Arabic production browser smoke passed using locally hosted versions of the same approved fonts; no external font requests.
- [ ] Real email-provider configuration and delivery verification (credentials not supplied).
- [ ] User review and explicit approval before commit/push/merge.

No team/production database was accessed, and the SDAIA provisioning script was not run. The successful local journey does not claim verification of the native Prisma engine or real inbox delivery. See organization-members.md for the local runner, its side effects, and Cloud-specific health-probe setup.

Final evidence and explicit unrun checks: organization-members-verification.md. AI suite: 23 passed. npm audit retains the baseline findings (24 total, 4 high); this is not a passing audit.

## Approval review findings — resolved

- [x] DB rejects every new invitation inserted with non-null accepted_at, including direct Supabase REST.
- [x] Approved function still accepts valid invitations and creates membership.
- [x] New invitee registration keeps context across real confirmation in a new tab.
- [x] No independent organization is provisioned for an invited staff signup.
- [x] HttpOnly context expires with invitation; invalid links and successful acceptance clear it.
- [x] Failure/expiry/lost-context and cross-tab cleanup regressions covered.

Latest verification and limitations: organization-invitation-fixes.md.
