# Deployment candidate — 2026-11-10

Source: `feature/midan-product-experience` at `5f78231199af4c8d1f10655222b22b2665874ab6`.
It is the newest remote branch by commit date at inspection. It contains
`integration/midan-email-cloud-fixes` at `b6d7c72` and the updated Employer Access branch at `c41e0d8`.
No branch reintegration was needed. The deployment preparation branch is `deploy/midan-product-experience`.
No application code, teammate branch or main was changed during this inspection.

## Verified locally on the exact source

- Clean `npm ci` from the committed lockfile.
- API unit tests: **105/105**, across **17 suites**.
- Web unit/translation tests: **59/59**.
- API TypeScript build and Next.js production build succeeded; 94 static pages generated.
- Chromium against the production server: Arabic and English login render with correct RTL/LTR and no page errors.
  This is a public-page smoke test, not certification of authenticated Cloud journeys.
- Five outstanding migrations applied successfully inside a local PostgreSQL transaction, then rolled back in
  reverse order. Function definitions/ACLs, table/column ACLs and types, RLS policies and indexes matched the baseline.
  The three new tables had RLS enabled; report content was not directly updateable by authenticated clients.
  The rehearsal's outer transaction rolled back; no production query mutated data.

## Production database difference requiring explicit approval

Read-only Cloud inspection of `squpszwbrqkflezfltoj` found **58 migrations**; Employer Access is now applied.
This source contains **63 migrations**. Apply only these five after approval, a verified backup and a fresh
precondition check, not a reset or a bulk branch merge:

| Migration | Result |
| --- | --- |
| `20261113090000_company_journey_rules` | Publication guard for unapproved assessments; fills missing linked-workspace website/company type from registry identity; member-scoped business-domain lookup |
| `20261113100000_interview_preparation` | Staff-only stored interview questions/evaluation forms with RLS and auditing |
| `20261113110000_candidate_development_reports` | Draft/released candidate reports; candidates see released own reports; authorized staff release them |
| `20261114090000_brand_palette` | Suggested/approved branding palette columns |
| `20261115090000_application_cv_matches` | Stored application CV matches with organization isolation |

Existing rollback files reverse the schema additions. They delete newly generated interview preparation,
development-report and stored-match rows; they drop new palette fields. Registry-derived website/company type
values filled by the first migration intentionally remain. Do not describe a post-launch rollback as lossless.
No registry IDs or partnership statuses are changed by these migrations.

## Hosting prerequisites still to verify

The product has three components: Next.js web, NestJS API (including background queue processing), and private
Python AI (OCR and optional e5/reranker model dependencies). A web deployment alone does not host the other two.
Inspect existing hosting before selecting runtimes; preserve these behaviors and keep service secrets server-side.
`docs/deployment.md` describes the environment variables but includes an outdated migration count; use the fresh
58-to-63 comparison above instead.

Vercel project discovery returned 403 for account scope `nadaalnashwan`; the connection needs team access consent
for `team_HJbw1zGE3kXnSHlRvqjtCwIO`. An authorization link was supplied to the owner. No project or deployment
was created, and credentials/hosting environment settings are not yet inspected. Existing Vercel project settings,
API/AI origins and secret availability must be checked after consent; do not assume they are configured.

Before a release: ensure all services use this source and the intended Cloud project; validate required secrets
without printing them; configure the public HTTPS origin and authorized Auth redirects through the owner's approved
configuration flow; verify the browser-to-web-to-API-to-database/AI journey on the deployed candidate.
Production Auth/SMTP settings and database migrations retain their separate approval requirement.

## Release state

**Not deployed.** Local build, unit tests and migration rehearsal passed. Hosting access and production migration
approval are pending. No public deployment URL or successful external email delivery is claimed.
