# MIDAN company journey: what was fixed, and what the acceptance run showed (2026-11-10)

Branch `feature/midan-company-journey`, from `b6d7c72`, local only: not pushed, not merged. The audit this work follows
is [MIDAN_COMPANY_JOURNEY_AUDIT.md](MIDAN_COMPANY_JOURNEY_AUDIT.md). Nothing was changed in Supabase Cloud, and the
demo worktree (`D:\Downloads\MIDAN-integration-email-cloud`) was not touched. The three new migrations are local only.

## Fixes (in commit order)
| Commit | What |
| --- | --- |
| `8a07474` | The audit document |
| `6f2b0ee`, `3a97924` | Migration `20261113090000`: a job that has an assessment is published only once the assessment is approved (it was possible to publish with a draft). Registry workspaces take the registry's official website, and the government company type only where the entity type states it. An auto-assignment trigger for late approvals was tried, then removed: it conflicted with the designed choice of which assessment to invite to, and the publish rule makes it unnecessary for new jobs |
| `7fb11d3` | The public job posting shows the workspace's logo and colour. Assessment generation receives the registry employer's business domain (for example "Telecommunications"), and the prompt (`gen-v5-mas1-domain`) frames every task, technical ones included, around a problem of that business. The scenario's company stays fictional, as before |
| `20dedcd`, `5218fe1` | `GET /organizations/:orgId/jobs/:jobId/ranking` and the "Applicant ranking" section on the job page (English and Arabic). Every active applicant is listed: the CV match from the matching model (the existing rule, applied to staff-reviewed statuses), strengths and gaps, the reviewed assessment score, the interview ratings and the stage. It's computed on every read, so new evaluations re-rank. **There is no overall percentage**: no approved rule weighs the stages against each other, and the screen says so. The employer chooses the stage to rank by. Ties share a rank, and applicants with a pending stage follow unranked |
| `7f70d49` | Interview preparation: questions and an evaluation form per candidate (competencies, criteria, a description for each rating 1 to 4), from numbered facts (approved requirements, company context, CV match, reviewed assessment). Every item must cite those facts or it's refused. Only the live model writes them; without it, nothing is written. Migration `20261113100000` (`interview_preparations`, staff-only, audited, every version kept). Shown beside the candidate and on the interviewer's interview page. The form fills in the interviewers' feedback form, which keeps its existing rules |
| `5a6edc3` | Development report: drafted from the candidate's own evidence (requirements shown or not, reviewed assessment criteria, interview competencies as average ratings, never names, notes or evidence text), written by the live model from cited facts. Staff release it, the candidate is notified in-app, and the report is then fixed. Migration `20261113110000` (`candidate_development_reports`). The candidate sees it on their application |
| `2ea496e` | `company-journey.e2e-spec.ts`. The recruitment and pipeline tests now publish the assessment before the job |
| `5ab7122` | The applicant page called a client helper from the server (found by opening it in a browser); ranking wording and numerals |
| `051e69d` | `scripts/company-journey-acceptance.mjs`, the 18-step acceptance run |

## Tests run on this machine
- AI service: 272 passed, 11 skipped, plus 7 new interview/report tests (run with no provider key, as the suite expects).
- API unit: 90/90 (16 suites, including the new ranking rules).
- API end to end, on a freshly reset local database with the AI service in demo mode: 12 of 13 suites passed on the
  first pass, including foundation, recruitment and the new company-journey suite. `pipeline` failed at sign-in with
  ECONNRESET from the local gateway (it ran first). Run on its own after the ordering fix, its journey tests pass, and
  the only failures are the 4 external-listing tests that always fail on a second run against the same database
  (documented in `MIDAN_EMPLOYER_CURRENT_STATE.md` §19).
- Web: type check clean; unit tests pass (including Arabic and English message parity).
- Browser: the repository's Playwright suites weren't run. The new screens (ranking in English and Arabic, interview
  preparation, development report, branded job posting, the candidate's application) were opened in headless Chromium
  against the local stack and rendered without page errors, after the fix in `5ab7122`.

## Acceptance: the 18 steps on the isolated local stack
Run `mwaf6a34`, `node scripts/company-journey-acceptance.mjs`, on a freshly reset local database (PostgreSQL 54533,
gateway 54521, AI 8500, API 4500, web 3500). Fictional candidates. The workspace is the **test** workspace of one registry
employer (stc), created through the real employer-access approval: `is_test`, slug `midan-test-employer-*`, hidden from
public listings. **The AI service ran in demo mode**, because the shared Groq key was exhausted (see "What stays open").
Evidence is in `.local/acceptance/` (git-ignored). The new screens were then opened in headless Chromium
(`.local/acceptance/screens/`); that check found, and led to the fix of, a server/client error on the applicant page.

| # | Step | Result | What the system returned |
| --- | --- | --- | --- |
| 1 | Branded workspace | **Passed** | Two representatives approved by a platform admin share one workspace, named from the registry and carrying its official website; logo and colours set and shown on the job posting |
| 2 | Create job | **Passed** | Job with bilingual details and 4 approved requirements |
| 3 | HR-based requirement suggestions, edited and approved | **Not passed** | 12 suggestions from the sector workbooks, then 11 kept, 1 removed, 1 own skill added and the list accepted. But **no reasons**: without the live model the shortlist is returned labelled, without reasons |
| 4 | Business-context, branded assessment | **Not passed** | Without the model, generation used MIDAN's templates (labelled demo), not framed in the business domain. The domain context is in the code and the prompt, but no live generation ran after the change |
| 5 | Publish | **Passed** | Publishing before the assessment was approved was refused (422); after approval the job was published, with branding |
| 6 | Several candidates apply with CVs | **Passed** | 4 fictional CVs (PDF) uploaded and read by MIDAN's local reading (`local_only`), approved by each candidate, then 4 applications |
| 7 | HF model analyzes the CVs | **Not passed** | The matching backend reported `token-overlap-v1` (lexical): e5 isn't installed on this machine |
| 8 | ATS scores CV and assessment | **Passed**, with a caveat | CV scored for all 4 by the existing rule. Assessment proposed (demo heuristic, 1 of 16 criteria), and a fictional reviewer scored and released 3 attempts. The CV scores are lexical (0–5%), not e5 |
| 9 | All candidates ranked | **Passed** | 4 of 4 listed with CV %, assessment %, interview, strengths and gaps, rank and stage; overall % shown as unavailable (no approved weights); pending stages unranked |
| 10 | Shortlist | **Passed** | 2 shortlisted by a person; an interview for a candidate not shortlisted was refused (422) |
| 11 | Schedule via Google Calendar | **Not passed** | Interviews created; `calendar_status: not_configured` (no refresh token) |
| 12 | Invitations received | **Not passed** | Not tested: no real event, and real invitations need the owner's approval |
| 13 | Per-candidate questions | **Not passed** | 503 `not_configured`: no live model, so nothing was written |
| 14 | Per-candidate evaluation form | **Not passed** | 503 `not_configured`, as above |
| 15 | Form submitted | **Passed**, with a caveat | Two interviewers submitted rated feedback per candidate; changing a submitted form was refused. The competencies came from the job's requirements, because no generated form existed |
| 16 | Scores and ranking updated | **Passed** | The ranking by interview shows each candidate's average rating and rank |
| 17 | Manual hire decision | **Passed** | Hired and not selected, both issued by a person; the other applications were untouched |
| 18 | Per-candidate development reports | **Not passed** | 503 `not_configured`: no live model, so no report was written. The release, notification and visibility rules passed in `company-journey.e2e-spec.ts` with a stored draft |

**10 of 18 passed** (8 and 15 with the caveats above). Not passed: 3, 4, 13, 14 and 18 need the live model, 7 needs the
HF model installed, and 11 and 12 need Calendar credentials and the owner's approval.


## What stays open
1. **Hugging Face model.** `intfloat/multilingual-e5-base` isn't installed here: no `sentence-transformers` or torch in the
   venv, and no model files. Every CV match on this machine, including the demo's, runs the lexical fallback, and its
   provenance says so. Installing it needs a download of about 2 GB, which needs the owner's approval.
2. **Overall score.** No approved rule combines the CV, assessment and interview scores. An overall percentage and a
   cumulative ranking need weights decided by the owner.
3. **Google Calendar.** `GOOGLE_CALENDAR_REFRESH_TOKEN` is empty. No real event or invitation was created. Testing this
   needs a token and the owner's approval, because it sends real invitations.
4. **Live-model features.** The live model wrote nothing in the final acceptance run: Groq answered `quota_exhausted`,
   and the key was then removed from the local stack, because it's the same key the demo uses. That covers interview
   questions, the evaluation form, the development report and contextual generation. Their code paths are tested with a
   fake model (AI unit tests), and their refusal without a model is tested end to end. A live run is still needed.
5. **Homepage metric.** The home page at `b6d7c72` shows no hiring number. The element the brief meant isn't identified,
   so nothing was changed there.
6. Migrations `20261113090000`, `20261113100000` and `20261113110000` exist only locally. They need the owner's approval
   before Cloud, as does `20261112090000`.
