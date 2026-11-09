# MIDAN — demo data guide

`scripts/demo-seed.mjs` builds a complete, fictional recruitment dataset through MIDAN's real API. The dataset is in
`scripts/demo-data/dataset.mjs`.

## Where the demo data is (read first)
- **The seeded DEMO dataset exists only on the local stack** (`scripts/dev-all.sh`, local Postgres and Auth). It has
  **not** been written to Supabase Cloud: that needs the owner's approval and the project's secret key (see below).
- **The cloud demo** (`scripts/dev-all.sh --cloud`) uses the fictional test accounts already in the cloud project
  (`midan.test.*@example.com`; passwords in the main project's git-ignored `.env.test.local`) and the records they created
  there today: the approved test organization "Cloud test organization … (synthetic)", its jobs, applications, evaluations.
- Never present local demo records as cloud data, or the other way round: the two databases are separate.

## What is real and what isn't
- The **employer registry** holds ten reference employers (Ministry of Commerce, General Entertainment Authority, Elm,
  Diriyah Gate, stc, SDAIA, Sipchem, Saudi Red Sea Authority, Ministry of Finance, Saudi Industrial Development Fund). They
  are reference records, `partnership_status = not_partner`. **The seed never changes or links them.** The data model
  forbids linking a demo or test organization to a registry entity (`admin_link_organization_employer`), because a link
  means "this account is that entity".
- The **demo tenants** are separate MIDAN organizations named "DEMO · <employer> (sample tenant)", flagged `is_demo`, with
  a description stating they are fictional, not affiliated and not partners. Their jobs end in "(DEMO)", are flagged
  `is_demo`, and appear only in the labelled demo listing (`/opportunities?demo=1`), never among real jobs.
- **People** are fictional. Emails are `midan.demo.<employer|candidate>.<key>@example.com`.

## Contents
| | |
|---|---|
| Tenants | 10, each with one owner account, approved through MIDAN's organization review by a platform administrator |
| Jobs | 20 (2 per tenant): description, 2–3 requirements (some mandatory, some with minimum years), 2–3 skills marked required or preferred with levels 1–5, an assessment (generated, then approved by the owner) |
| Candidates | 10, one per scenario below |
| Applications | 14, with submitted assessments, evaluations reviewed and released by a person, the strongest shortlisted, the weak one declined |

| Candidate (key) | Scenario | Applies to |
|---|---|---|
| `strong-data` | Strong match (English) | Elm Data Analyst, SDAIA Data Scientist |
| `partial-swe` | Partial match | Elm Software Engineer |
| `weak-event` | Weak match | stc Cybersecurity Analyst |
| `entry-finance` | Entry level (Arabic) | Ministry of Finance Budget and Financial Analyst |
| `experienced-credit` | Experienced | SIDF Credit Analyst, Industrial Investment Analyst |
| `arabic-hr-events` | Arabic profile | GEA Event Operations Coordinator |
| `mixed-ml` | Mixed Arabic/English | SDAIA Machine Learning Engineer |
| `missing-quals` | Missing qualification (no degree for a degree-mandatory job) | Diriyah Gate Civil Engineer |
| `different-terms` | Relevant experience in different words ("predicted material needs" for "demand forecasting") | Sipchem Supply Chain Analyst |
| `compliance` | Strong match, mixed language | Red Sea Regulatory Compliance, Commerce Compliance |

Expected matching outcomes: strong and different-terminology candidates show most requirements as Shown or Partly shown
(the latter through e5's semantic similarity, with no shared words); the missing-qualification candidate shows the degree
requirement as Not shown; the weak candidate shows little. Assessment results follow the scenario (strong 85%, partial
55%, weak 20% of each criterion, scored by the seed's "person" and labelled DEMO).

## Running it
```
node scripts/demo-seed.mjs                       # local stack (the default; refuses anything else)
node scripts/demo-seed.mjs --clean               # removes only the seed's organizations (and their jobs, applications,
                                                 # evaluations) and the midan.demo.* accounts
```
Supabase Cloud, only with the owner's approval and the project's secret key in `.env.cloud` (`SUPABASE_SECRET_KEY`;
it's used for Auth administration only and never committed):
```
node scripts/demo-seed.mjs --target cloud --approved-by-owner squpszwbrqkflezfltoj --fixtures <path to the cloud .env.test.local>
```
- **Idempotent**: everything is looked up by slug or email first; a rerun completes what's missing and duplicates nothing
  (verified: a second local run left every count unchanged).
- **Accounts** are created through Supabase Auth administration with confirmed emails, never by writing Auth tables. They
  pass the sign-up gate with the server's access code. Passwords are random, created once, and kept only in
  `.local/demo/demo-accounts-<target>.json` (git-ignored, mode 600).
- **Database writes outside the API**: only the `is_demo` flags on the seed's own organizations and jobs (the API can't set
  them), and `--clean`.
- The organization review is approved by a platform administrator from the test fixtures (`--admin-email`, default the
  fixture admin locally, `midan.test.org-b-owner@example.com` on the cloud).

## Accounts
Sign in at `/en/login` (candidates) or `/en/login?as=organization` (employers) with an email from the table and its
password from `.local/demo/demo-accounts-<target>.json`.

| Role | Email |
|---|---|
| Employer, DEMO Elm | `midan.demo.employer.elm@example.com` (likewise `sdaia`, `stc`, `mof`, `gea`, `dgda`, `moc`, `sipchem`, `redsea`, `sidf`) |
| Candidate | `midan.demo.candidate.<key>@example.com`, keys in the table above |

## Verified (local stack, 2026-11-10)
10 tenants approved, 20 DEMO jobs published, 10 candidates, 14 applications, 13 submitted assessments, 13 evaluations
reviewed by a person and released, 9 shortlisted, 1 declined. One generated assessment (Elm Software Engineer) is a live
draft that the MIDAN Assessment Standard (MAS-1.0) blocks: quality 98/100, verdict "blocked", one error,
`rubric_total_not_100` ("The rubric's points don't sum to 100: 40"). The model returned a single task worth 40 points
(likely cut short by Groq's per-minute token limit). It stays a draft for the employer to regenerate or edit, so that
application has no assessment. Registry:
10 `not_partner`, 0 linked. In the browser: the candidate sees the DEMO listing and a released report; the employer sees the
applicant's requirements match with e5 similarities.
