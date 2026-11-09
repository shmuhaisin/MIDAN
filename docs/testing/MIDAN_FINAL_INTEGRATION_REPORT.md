# MIDAN — final integration report (2026-11-10)

## Branches
| | |
|---|---|
| Final integration | `feature/midan-final-integration` (https://github.com/shmuhaisin/MIDAN/tree/feature/midan-final-integration) |
| Built from | `feature/midan-integration` at `46ccee7` (candidate experience, structured CV extraction, CV review cards, one evidence line per responsibility) |
| Merged | `feature/midan-employer-experience` at `c1f06f3` (Supabase Cloud setup, test-organization privacy on job links, `/admin` sign-in redirect, Windows migration rehearsal, `apply-cloud-migrations`, bilingual Auth email templates, employer handoff) |
| Merge | `2fdba7c`, no conflicts (the employer branch already carried the integration work up to `08161d9`; no file overlapped the three later commits) |
| Unchanged | `main` `8f0235b`, `feature/midan-integration` `46ccee7`, `feature/midan-employer-experience` `c1f06f3` |

Later commits on the branch: matching calibration (`b20a3f9`), demo seeder and dataset (`80b8316`, `d4599ef`), demo data guide
(`9f77a77`), this report. Secret scan before each push: no keys, tokens or cloud credentials (only placeholders and the
local stack's development passwords for 127.0.0.1).

## Environment
- **Website:** http://localhost:3100, started with `scripts/dev-all.sh --cloud` (the `midan-cloud` preview entry). Web,
  API (`:4000`, with the background worker) and AI service (`:8000`) run locally; database, Auth and Storage are Supabase
  Cloud **al-midan-ya-hamidan** (`squpszwbrqkflezfltoj`). The script refuses to mix a local and a cloud service. Checked: the
  web build references only the cloud project; `/admin` redirects to sign-in (the employer branch's change), so the merged
  build is what's served.
- **Schema:** 57 of 57 migrations applied (`scripts/apply-hosted-migrations.sh --check`). The merge added none.
- **AI:** Groq `openai/gpt-oss-120b` (assessment generation, scoring, structured CV extraction, the assistant).
  `intfloat/multilingual-e5-base` locally, `EMBEDDING_PROVIDER=e5-local` (requirement matching, skill ranking).
- **Isolated test environment:** the local stack (`scripts/dev-all.sh`): its own Postgres, Auth, Storage and mail inbox.

## Test results
| Suite | Result | Where |
|---|---|---|
| API end-to-end (`jest.e2e.json`): accounts and roles, RLS tenant isolation, recruitment, pipeline, matching, skills, discovery, organization review | **204/204** | local stack, run as designed: test data cleaned (`supabase/test-cleanup.sql`), AI service `AI_PROVIDER=demo`, `EMBEDDING_PROVIDER=lexical` |
| API unit | 84/84 | |
| Web unit + type check | 40/40, types clean | |
| AI service | 273 passed, 10 skipped (live-model tests) | |
| Demo data seed | 10 tenants, 20 jobs, 10 candidates, 14 applications, 13 submitted assessments, 13 evaluations reviewed and released; a second run changed nothing | local stack |
| Browser, demo data | 17/17: demo listing, applications, released report, employer workspace, requirements match with e5 similarities, 12 language × theme × width combinations (RTL/LTR, no horizontal overflow) | local stack |
| Browser, cloud (earlier today, same code paths) | full journey 16/16; CV upload → structured review → approval saved; e5 matching panels in English and Arabic | Supabase Cloud |
| Cloud, final build (read-only) | pages 200; employer match API returns `e5-local` / `intfloat/multilingual-e5-base`, no fallback | Supabase Cloud |

A first full API run had 15 failures; each was traced to running the suite outside its designed setup (live Groq instead
of demo mode, e5 instead of lexical matching, leftovers from earlier runs). In the designed setup all 204 pass. No code was
changed to make a test pass.

## End-to-end scenarios
| Scenario | Status |
|---|---|
| 1 Registration | Cloud: sign-in, session, logout, unverified refusal verified. Sign-up reaches Cloud Auth, but cloud Auth refuses `example.com` and the built-in email only reaches the project team, so a full sign-up with verification needs a real mailbox (yours) or custom SMTP. Local: verified with the mail inbox (auth audit, earlier). |
| 2 CV extraction | Verified on the cloud in the browser (Groq and local fallback), structured cards, approval saved. |
| 3 Job creation | Verified on the cloud (journey) and by the seed: requirements, AI and manual skills with levels, generated assessment, approval, publishing. |
| 4 ATS matching | Verified on the cloud: English and Arabic, e5 provenance, requirement-level evidence. |
| 5 Assessment | Verified (journey; seed: 13 submissions). |
| 6 Evaluation | Verified: proposals where the model answers, a person scores the rest, approves and releases; candidate reads the report without reviewer notes. |
| 7 Hiring | Shortlist and decisions verified (seed, e2e). Interviews: covered by the e2e suite; calendar invitations need a Google refresh token (not configured). |
| 8 Security | e2e: role separation, tenant isolation (API and RLS alone), duplicate applications, private answers, guidance not exposed, expired tokens. |
| 9 Localization | 12 combinations verified in the browser. |
| 10 Failure recovery | Groq quota out → CV local reading (labelled), assessments from templates ("Demo mode"), scoring left to a person; invalid key → local reading; invalid uploads refused; duplicate applies return the same application. |

## Fixed today (each with a regression test and a rerun)
1. **CV extraction:** a job title taken as the name erased words from the CV; lines became separate entries; Arabic PDFs failed. Structure, validation and the review cards were rebuilt (`834247b`, `5b22836`).
2. **CV analysis failed when Groq refused:** now uses MIDAN's local reading, labelled (`08161d9`).
3. **Diluted matching evidence:** one evidence line per responsibility (`46ccee7`).
4. **Unrelated short skills read as "partial":** measured on 575 labelled short-skill pairs; brief evidence now needs 0.815 for partial (false partials 15.4% → 5.1%; 5 of 31 true short matches move to needs-review, none to missing) (`b20a3f9`).
5. **Migration check** reported a migrated project as having 34 pending (`b20a3f9`).
6. **Demo seed:** organization review needs the company type; the reviewer must score every criterion the model didn't (`d4599ef`).

## Remaining defects and limits
- **Groq free tier:** 200,000 tokens per day. When used up, everything falls back visibly (above). Several runs today used it up.
- **Email:** Supabase's built-in sender only reaches the project team, a few per hour. Custom SMTP is needed for other addresses.
- **Auth URL configuration:** the dashboard must allow `http://localhost:3100/**`. It can't be read from here.
- **Leaked-password protection:** off in Cloud Auth (security advisor warning).
- **Employer-side gaps reported on 2026-11-09:** a job can be published with a draft assessment; an assessment approved after people applied isn't assigned to them. Not re-verified on this branch.
- **One generated assessment** in the demo set (Elm Software Engineer) didn't meet the MIDAN Assessment Standard and stays a draft.
- **Interviews:** calendar invitations need a Google Calendar refresh token.

## Waiting for the owner's approval
1. **Demo data on Supabase Cloud.** The seed is verified on the local stack. To run it on the cloud: approval to create the
   10 DEMO tenants, 20 DEMO jobs, 20 accounts (`midan.demo.*@example.com`) and their applications, plus the project's
   **secret key** in `.env.cloud` as `SUPABASE_SECRET_KEY` (Auth administration only; never committed). Then:
   `node scripts/demo-seed.mjs --target cloud --approved-by-owner squpszwbrqkflezfltoj --fixtures <cloud .env.test.local>`.
   It removes only its own records with `--clean`.
2. **Dashboard settings:** custom SMTP, redirect URLs, leaked-password protection.
