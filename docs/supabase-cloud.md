# MIDAN on Supabase Cloud

MIDAN uses one Supabase Cloud project for everything Supabase provides: **al-midan-ya-hamidan** (ref
`squpszwbrqkflezfltoj`, eu-central-1). Auth (registration, sign-in, email verification, password recovery, sessions), the
Data API, Storage and PostgreSQL all run there. On a developer machine only MIDAN's own services run: the web app
(3100), the API (4000) and the AI service (8000). No local Supabase, no local mail sink.

```bash
powershell -ExecutionPolicy Bypass -File scripts\local-up-windows.ps1
```

With `NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co` in `.env`, the launcher checks that the cloud project answers,
then starts AI, API and web. It never starts a local database or local Supabase in their place, and the API refuses to
start without `DATABASE_URL` (it never falls back to another database). The local Supabase stack
(`scripts/local-supabase.mjs`, `scripts/local-db.sh`) is kept only for the automated test suites, which refuse to run
against any non-local address.

## Configuration (.env, never committed)

| Setting | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://squpszwbrqkflezfltoj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dashboard > Project Settings > API keys (publishable; safe in the browser) |
| `DATABASE_URL`, `DIRECT_URL` | The API's login, the `midan_api` role (no table access of its own; every query runs as the signed-in user under RLS). `node scripts/provision-db-credentials.mjs <file outside the repo>` writes them to `.env` and an SQL file with only a password verifier, which a project owner applies. Pooler format: `postgresql://midan_api.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5` (`DIRECT_URL`: port 5432, no `pgbouncer`). |
| `MIGRATION_DATABASE_URL` | Migrations only: the project's postgres connection (Session pooler, port 5432); read by `scripts/apply-cloud-migrations.mjs` and nothing else. |
| `CHECKPOINT_DATABASE_URL` | Optional. Empty: the AI service keeps workflow checkpoints in a local SQLite file. |
| `AI_PROVIDER`, `GROQ_*`, `GEMINI_*` | The AI provider keys (server only). |
| `DEV_TEST_SIGNUP`, `DEV_TEST_ACCESS_CODE` | Registration is closed unless `DEV_TEST_SIGNUP=true` and the access code matches a hash in the project's `private.signup_access`. |
| `APP_URL` | `http://localhost:3100` locally. Email links return here, so Auth must allow it (below). |

The service-role key is never used by MIDAN and must never be put in `.env` or frontend code.

## Supabase dashboard settings (project owner)

- **Authentication > URL Configuration:** Site URL = the deployed site; Redirect URLs include
  `http://localhost:3100/**` (local) and the deployed site's `/**`. Without it, verification and recovery links fall back to
  the Site URL.
- **Authentication > Providers > Email:** "Confirm email" on (it is: `mailer_autoconfirm` is false).
- **Authentication > Emails > SMTP:** Supabase's built-in sender only delivers to members of the project's team, a few
  emails an hour. Real users need a custom SMTP sender configured here. MIDAN's code doesn't choose the email provider.
- **Authentication > Emails > Templates:** optional bilingual MIDAN templates are in `supabase/templates`
  (Confirm signup, Reset password), with their subjects in `supabase/templates/README.md`.

## Schema

The cloud database must have every migration in `supabase/migrations`, applied in order and recorded with its own
version and text in `supabase_migrations.schema_migrations`. Applying them changes the production schema, so it is done
only with the owner's approval, after a rehearsal:

```bash
scripts/rehearse-migrations.sh
```

It rebuilds the cloud's starting point on a throwaway local cluster (checked against the cloud's fingerprint), applies
each pending migration, rolls it back to an identical state, applies it again, runs the post-change and security checks,
and finally rolls everything back to the starting point. Then, with the project's postgres connection (Dashboard >
Connect > Session pooler) as `MIGRATION_DATABASE_URL` in `.env` (the same git-ignored file as every other setting):

```bash
node scripts/apply-cloud-migrations.mjs
```

```bash
node scripts/apply-cloud-migrations.mjs --apply
```

The first shows what would be applied; the second applies each file in its own transaction (a failure rolls that file
back and stops), records it, and checks every stored text against its file. Only this script reads
`MIGRATION_DATABASE_URL`; the launcher doesn't pass it to the services. The API's `midan_api` login can't change the
schema, by design.

## Verified on 2026-11-09

- Cloud Auth health (GoTrue v2.197), sign-ups enabled, email confirmation on, Data API reads with the publishable key.
- The web app signs in against cloud Auth: a wrong password returned "Incorrect email or password", and the cloud project's
  Auth log recorded the request (`invalid_credentials`).
- The AI service runs in live mode with Groq.
