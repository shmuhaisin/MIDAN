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

## Hosted Supabase (production)
Not used by this environment and not changed. Moving the hosted project to this code needs, in one approval: the newer
migrations, the access-code hash for sign-up, redirect URLs for the site, and an email provider.
