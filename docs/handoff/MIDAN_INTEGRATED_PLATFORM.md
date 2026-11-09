# MIDAN — the integrated platform

Branch `feature/midan-integration` = `feature/midan-candidate-experience` (approved design, palette, candidate work)
+ `feature/midan-employer-experience` (organization approval, admin review, job translation, shortlist before interview).
`feature/midan-auth-jobs-ai-assessments` and `feature/midan-teammate-completion` were already contained. Both feature
branches are unchanged; `main` is untouched.

## Start everything with one command
```
scripts/dev-all.sh            # build, start, wait for health, stay in the foreground (Ctrl+C stops all)
SKIP_BUILD=1 scripts/dev-all.sh
scripts/dev-all.sh --stop
```
It runs one local environment: Postgres 127.0.0.1:54322 (all migrations applied), the Supabase gateway on :54321 (Auth
with email verification, REST, Storage, and the mail inbox at `/__mail`), the AI service on :8000 (Groq + local e5
matching), the Core API on :4000 and the website on **http://localhost:3100**. It refuses to start if `.env` points the
database anywhere else, so local and hosted data are never mixed. Logs: `.local/logs/`. On Windows run it from Git Bash or
WSL (the services themselves are listed in `MIDAN_CANDIDATE_CURRENT_STATE.md` for PowerShell).

## Verified on 2026-11-10 (real browser, real services, one database)
- Auth: 58/58 checks: candidate sign-up (English and Arabic) and organization sign-up through the landing buttons, the
  emailed verification link, login, persistence, token refresh, expiry, logout, password reset, role isolation.
- Employer (English): organization profile + commercial registration document + submit → platform admin approves →
  job with description → requirement → skills suggested and chosen by the live AI model (8 linked) → assessment generated
  by the live model, MIDAN quality standard **Ready 100** → approved and published → job published.
- Candidate (Arabic): sign in → CV upload → finds the job → applies → the approved assessment is assigned → answers,
  choices and a file → submits.
- Employer: applicant with the requirements match → proposed scores (1 by the model, 3 left for the person because of
  the provider limit) → a person scores, approves and releases.
- Candidate: reads the released report (overall 40/100, skill levels), with no reviewer notes.

### After merging the employer branch's Windows stack (940a311), final build
- Auth audit 58/58 again. Full journey 19/19 with fresh accounts while Groq's daily quota (200,000 tokens) was used up:
  skills fell back to the labelled similarity shortlist, the assessment to MIDAN's templates (labelled "Demo mode"), and
  scoring left 7 of 8 criteria for the person. Every step stayed usable; nothing was presented as AI work.
- A run between the two produced a live draft scoring 98 but **Blocked** by one finding of the quality standard: it can't
  be approved, as intended. The employer removes it and generates again.

## Gaps found (employer side, for the employer developer)
1. A job can be published while its assessment is still a draft; applicants then receive no assessment.
2. An assessment approved after people applied isn't assigned to them automatically (the employer must invite them).

## Hosted Supabase (production)
Not used by this environment and not changed. Moving the hosted project to this code needs, in one approval: the newer
migrations, the access-code hash for sign-up, redirect URLs for the site, and an email provider.

## ATS matching model (verified 2026-11-09)
- `.env`: `EMBEDDING_PROVIDER=e5-local`. The AI service's `/health` reports `matching: e5-local`, and generation uses
  Groq `openai/gpt-oss-120b`. The model files sit in `.local/hf` (about 1.1 GB, loaded offline), with
  sentence-transformers 3.4.1 and torch installed through `uv run --extra matching`.
- Direct `/match/requirements` call (Arabic CV evidence against English requirements): provenance `provider: e5-local`,
  `model_version: intfloat/multilingual-e5-base`, with no `fallback` field, in 1.3 s on a cold start.
- Through the app: the employer's applicant match and the candidate's own match both return e5-local results (about
  120 ms warm). In the browser, both "Requirements match" panels (employer, English and Arabic) and both "How your
  profile meets each requirement" panels (candidate, English and Arabic) show these results.
- e5's similarity scores sit close together, so MIDAN's conservative thresholds (match 0.80/0.83, review floor 0.77)
  mark many lines "partly shown" or "needs review" rather than "shown". This is by design: a person confirms.
- If the model can't load, matching falls back to lexical and records `fallback` in the result's provenance, so a
  fallback is never shown as e5. BGE-M3 and paid hosted models are not used.
