# MIDAN product experience: requirement status (2026-11-10)

Branch `feature/midan-product-experience`. Started this session at `5f78231` (remote HEAD verified; the earlier
"unpushed" commits `a7eaae4`, `9db619e`, `7826b11` and the CV-library work `5f78231` were all on the remote). A teammate
(Nada Al-Nashwan) pushed to the same branch during the session (`16e384a`, `bcb26f4`, `2e860d7`, `de17574`, `3a9a287`);
every push here was rebased on theirs, never forced.

Only what was run is marked tested. "Live" means with the configured model (Groq `openai/gpt-oss-120b`).

## Environment as verified

| Check | Result |
| --- | --- |
| `AI_PROVIDER` | `groq` |
| `GROQ_API_KEY` | present (not printed) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| Local stack | `scripts/local-setup.sh`, then `scripts/dev-all.sh`: PostgreSQL 16 on `127.0.0.1:54323`, gateway 54321, AI 8000, API 4000, web 3100 |
| API database | process environment `DATABASE_URL=…@127.0.0.1:54323/midan`; `pg_stat_activity` shows `midan_api` connected from 127.0.0.1. The container's cloud `DATABASE_URL` is overridden by `scripts/with-env.mjs .env` |
| AI health | `{"mode":"live","provider":"groq","model":"openai/gpt-oss-120b","matching":"e5-rerank","checkpointer":"postgres"}` |
| One real Groq request | `JsonLLMProvider` → `{"ok":true,"capital_of_saudi_arabia":"Riyadh"}` in 1.0 s |
| Hugging Face models | `intfloat/multilingual-e5-base` and `BAAI/bge-reranker-v2-m3` in `.local/hf` (git-ignored), offline |

## Blockers found (external)

1. **Groq daily token limit.** The key's organization has 200,000 tokens per day for `openai/gpt-oss-120b` (Groq's
   `on_demand` tier) and 8,000 per minute. By mid-afternoon the rolling 24 hours were used up (199,998 of 200,000), and they
   free up slowly. One assessment generation needs about 20,000 tokens. Every live feature (generation, requirement reasons,
   interview questions and forms, development reports, ATS stage 3, career readiness, Humaidan) shares this budget.
   Options: Groq's Dev tier, or the owner's decision on the other configured keys (`GROQ_API_KEY1`, `GROQ_API_KEY_2…5`),
   which were not used. A teammate's environment may share the same key.
2. **Official data not in the checkout** (`data/source/README.md`: no permission to publish). Without the employer
   workbook there is no STC registry entry, and without the sector workbooks there are no job families or reference
   skills. Local-only fixtures were added for testing (STC from public facts, two "Local fixture employer" rows), labelled
   `source_file = 'local-fixture'`.
3. **Google Calendar**: `GOOGLE_CALENDAR_CLIENT_ID` and `_SECRET` are set; `GOOGLE_CALENDAR_REFRESH_TOKEN` is empty, so no
   real event is created and the screens say so.
4. **Email**: no SMTP provider is configured; local Auth mails into the gateway's sink (`/__mail`).
5. **Daily.co**: `DAILY_API_KEY` is set; the embedded call was not run in this session.

## Requirement status

Legend: **Tested** (implemented and run end to end or in the browser), **Tested (unit)**, **Implemented, live run
blocked** (code and fake-model tests done; needs Groq quota), **Blocked by configuration**, **Not done**.

### Setup and git
| Requirement | Status | Evidence |
| --- | --- | --- |
| Verify branch, remote HEAD, earlier commits present | Tested | see top |
| Local DB, not Supabase Cloud | Tested | see Environment |
| AI service token mismatch in a shell with its own `AI_SERVICE_TOKEN` | Fixed, tested | `855154e`: AI service started through `with-env.mjs` |
| Restart left the old web server serving a stale build (404 chunks) | Fixed, tested | `4a0722c` |

### Assessment generation (handoff §5)
| Requirement | Status | Evidence |
| --- | --- | --- |
| No silent template fallback with a configured model | Tested (live) | every failed live run returned 503 with the reason (`invalid_reply`, `quota_exhausted`); no draft stored |
| Root cause of live failure | Fixed | the whole bilingual package can't fit Groq's 8,000 tokens a minute: both live attempts stopped at the output limit. Now four validated parts (`faa2fa9`, `c7aecdb`, `7ff659a`): case, materials, assessor guide, levels; each part's output budget is what the minute leaves |
| Company-specific case, requirements as criteria, generic titles refused | Implemented (`9db619e`, earlier) + case prompt `7ff659a` | unit tests |
| Synthetic data labelled | In the prompts and the standard's check | unit tests |
| Arabic and English equivalent | Generated together in every part | unit tests |
| **STC Data Analyst assessment, live, both languages** | **Live run blocked** (Groq daily limit) | Parts 1 (case) and 2 (materials) were written live for one job before the limit stopped part 3. A stopped generation now resumes from the parts already written (`6bb3afb`); `scripts/stc-assessment-live.mjs` retries on the same job; output goes to `.local/stc-assessment/assessment.json` |
| Employer approval before publishing | Tested | `company-journey.e2e` "publishes a job with an assessment only after the assessment is approved" |

### Employer onboarding, branding and requirements (handoff §4)
| Requirement | Status | Evidence |
| --- | --- | --- |
| Onboarding saves and moves on; inputs kept; real errors | Tested | `company-setup.spec` (Chromium): registration → admin approval → details saved in under 15 s → logo → team |
| Logo palette extraction, light and dark, approval | Tested | same suite: two companies, each workspace in the palette read from its own logo, light and dark, MIDAN's header unchanged |
| New logo is a suggestion; approved palette kept until approved | Tested, bug fixed | a logo picked while the page was still loading was silently dropped; fixed in `9f6546a`, reproduced and verified in Chromium |
| No cross-company branding or access | Tested | same suite (API 403/404, other workspace not rendered) and `employer-access.e2e` |
| AI requirement suggestions with category, mandatory/preferred, proficiency, reason; add, edit, remove, approve; only approved feed ATS and assessment | Implemented, live run blocked (`bab5141`) | AI tests 4; database guards checked (AI suggestion stored as draft, origin and suggestion unchangeable); job page renders ar/en without errors |
| Job page copy promised a template fallback | Fixed (`55186aa`) | |

### Hybrid ATS (handoff §6)
| Requirement | Status | Evidence |
| --- | --- | --- |
| Stage 1 e5, Stage 2 bge-reranker-v2-m3, e5 fallback | Tested (earlier `7826b11`, teammate `16e384a`, `bcb26f4`) | benchmark in `docs/ai/ATS_MATCHING.md` |
| Stage 3 structured AI evaluation per requirement | Implemented, live run blocked (`f96b871`) | reading, cited lines only, relevant experience, explanation, missing, confidence, manual-review flag; AI tests 5 |
| Scoring formula and weights unchanged | Unchanged | `services/ai/midan_ai/matching.py` `match()`: mandatory 2, optional 1; matched 1, partial 0.5, missing 0; needs-review excluded. Stage 3 never writes a score |
| No combined overall score (owner's decision) | Unchanged | stages side by side; `company-journey.e2e` ranking test |
| Ranking all applicants, missing never zero, deterministic ties | Tested | `company-journey.e2e` |

### Candidate (handoff §7)
| Requirement | Status | Evidence |
| --- | --- | --- |
| Email confirmation screen, address shown, resend, cooldown | Tested (forms suite, local Auth stand-in) | 14 of 15 forms tests; the 15th needs the employer workbook |
| CV library (5 kept), choose saved CV, per-application copy | Tested | foundation e2e (updated test `8482060`) |
| Apply page hydration error | Not present | headless Chromium, ar and en: 0 console errors, 0 page errors |
| English numerals everywhere | Tested | theme audit: 160 renders, 0 Arabic-Indic digits; browser check of apply, readiness, profile |

### Career development and Humaidan (handoff §8, §9)
| Requirement | Status | Evidence |
| --- | --- | --- |
| Exact target title → requirements → profile comparison → readiness assessment → evaluation → roadmap | Implemented, live run blocked (`cd1dad4`) | `/development/readiness`; comparison by e5 on the candidate's own lines; AI tests 4; page renders ar/en without errors |
| Real courses and certifications only | Tested | `scripts/verify-learning-catalog.mjs`: 25 of 28 verified from official pages (HTTP 200, title names it, no retirement notice); the model may recommend only catalog ids |
| Humaidan connected to the candidate's data | Implemented (`cd1dad4`); live answer blocked | facts now include profile/CV lines, latest readiness check, roadmap, recommendations; existing grounded assistant (cites only supplied facts) |

### Interviews (handoff §10)
| Requirement | Status | Evidence |
| --- | --- | --- |
| Shortlist before scheduling; Riyadh time; no duplicates | Tested | foundation e2e (stand-ins for Google and Daily), `a7eaae4` |
| Reschedule, cancel, notifications, calendar failure reported | Tested against stand-ins | foundation e2e "keeps the appointment until a replacement is set", "reports calendar results as they happened" |
| Real Google Calendar | Blocked by configuration | refresh token empty |
| Candidate-specific questions and evaluation form | Implemented earlier; live run blocked | `company-journey.e2e` (refusal without a model) |

### Admin and authorization (handoff §12)
| Requirement | Status | Evidence |
| --- | --- | --- |
| Platform admin decides; no self-approval; workspace isolation; no direct insert | Tested | `employer-access.e2e` 11/11 (with local fixtures), concurrency suite passed |

### Global quality (handoff §13)
| Requirement | Status | Evidence |
| --- | --- | --- |
| Light/dark contrast incl. form controls | Tested | theme audit: 160 renders, 0 failures, 0 wrong theme |
| Funnel chart theme-aware | Already done (`05ff0fd`) | colours are `var(--button)`/`var(--accent)` mixes and `var(--gold)` |
| RTL/LTR | Tested | `dir` rtl/ltr on every page checked |

## Tests run this session
- AI service: 317 passed, 11 skipped (without the live key in the environment).
- API unit: 105/105. Web unit: 59/59 (includes Arabic/English message parity). Web type check clean.
- API e2e (AI service in demo mode on port 8100, so no quota was spent): company-journey, recruitment, employer-access
  (11/11 with fixtures), employer-access-concurrency passed; foundation + match + career: 103 of 109, of which 4 need the
  sector workbooks and 1 needs a clean database (`supabase/test-cleanup.sql`); the CV-library test was updated (`8482060`).
- Forms (Playwright, local Auth stand-in): 14 of 15 (the other needs the employer workbook); the sign-up test was updated
  for the pending-address cookie (`65d67c6`).
- Company setup (Playwright, real local stack): passes, with local registry fixtures for STC and Elm.
- Theme audit: 160 renders, 0 contrast failures, 0 Arabic-Indic digits.

## Migrations
- `20261116090000_career_readiness.sql` (+ rollback): `career_readiness`, catalog columns.
- `20261116100000_requirement_suggestions.sql` (+ rollback): `job_requirements.suggestion`, a guard on origin and suggestion.
Both local only; Cloud needs the owner's approval like the earlier ones.

## To continue
1. Resolve the Groq quota (Dev tier, or the owner's decision on the other keys), then run, in this order:
   `node scripts/stc-assessment-live.mjs` (writes `.local/stc-assessment/assessment.json`), a readiness check on
   `/development/readiness`, then `node scripts/company-journey-acceptance.mjs` for steps 3, 4, 13, 14 and 18 and stage 3.
2. Official data files in `data/source/`, then `node scripts/import-data.mjs …` and drop the local fixtures.
3. `GOOGLE_CALENDAR_REFRESH_TOKEN` (`node scripts/google-calendar-token.mjs`) and the owner's approval for real invitations.
